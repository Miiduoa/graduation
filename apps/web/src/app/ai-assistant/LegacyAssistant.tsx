'use client';

import { AssistantReplyAnchor, AssistantReplyLink } from '@/components/AssistantReplyLink';
import { useAssistantWorkspaceHandoff } from '@/components/AssistantWorkspaceContext';
import { assistantTaskProfileForWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { SiteShell } from '@/components/SiteShell';
import { PublicCourseAssistantResult } from '@/components/PublicCourseAssistantResult';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { answerPublicCourseQuestion, type PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { SpokenReply, stopSpokenReply } from '@/components/SpokenReply';
import { AssistantServiceLinks } from '@/components/AssistantServiceLinks';
import { SchoolSelector } from '@/components/SchoolSelector';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { getAssistantRoleProfile, type AssistantRoleProfile, type AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import { assistantRoleTaskGuide, assistantRoleWorkServices } from '@campus/shared/src/assistantRoleTasks';
import { getAssistantService, type AssistantServiceId } from '@campus/shared/src/assistantServices';
import {
  answerAssistantLocally,
  canAnswerAssistantLocally,
  type LocalAssistantResult,
} from '@/lib/assistantLocalActions';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { useOptionalCampusDraft } from '@/components/CampusDraftProvider';
import { useCampusBrowseContext, type CampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';
import {
  callCampusAssistant,
  CampusAssistantError,
  type CampusAssistantEnvelope,
} from '@/lib/campusAssistantClient';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import {
  assistantSources,
  assistantSuggestions,
  assistantWriteProposals,
  hasOrderProposal,
  readOnlyAssistantCards,
} from '@/lib/assistantPresentation';
import { AgentCardList } from './AgentCards';
import { AgentWritePanel } from './AgentWritePanel';
import { CampusSensePanel } from './CampusSensePanel';
import {
  isWebOnlineOrderingEnabled,
  isWebOrderStatusQuestion,
  ONLINE_ORDERING_OFF_TEXT,
} from '@/lib/onlineOrdering';
import home from '../home.module.css';
import styles from './assistant.module.css';

type Message = (
  | { role: 'user'; content: string; local?: never }
  | { role: 'assistant'; content: string; response: CampusAssistantEnvelope; local?: LocalAssistantResult }
) & { publicCourse?: { read?: PublicCourseAssistantRead } };
function visibleMessage(message: Message) {
  return message.role === 'assistant' && !isWebOnlineOrderingEnabled() && hasOrderProposal(message.response)
    ? ONLINE_ORDERING_OFF_TEXT
    : message.content;
}

function requestError(error: unknown): string {
  if (error instanceof CampusAssistantError && error.code === 'unconfigured')
    return '雲端助理尚未啟用。';
  if (error instanceof CampusAssistantError && error.code === 'session-changed')
    return '登入狀態已變更，請重新登入後再試。';
  const code = (error as { code?: string } | null)?.code;
  if (code === 'unconfigured' || code === 'functions-unconfigured') return '雲端助理尚未啟用。';
  if (code === 'functions/unauthenticated') return '登入已逾時，請重新登入後再試。';
  if (code === 'functions/permission-denied')
    return '目前帳號無法查詢這項資料。你可以修改問題後再試。';
  if (code === 'functions/resource-exhausted')
    return '目前詢問較頻繁，請稍候再試。你的問題已保留。';
  return '這次未能取得回覆。你的問題已保留，請稍後重試。';
}

export function AssistantConversation({
  userId,
  localOwner,
  groupId,
  initialDraft,
  schoolId,
  taskProfile: initialTaskProfile = 'student',
  inline = false,
  inlineDraft,
}: {
  userId: string;
  localOwner: string;
  groupId: string;
  initialDraft: string;
  schoolId: string;
  taskProfile?: AssistantRoleProfileId;
  inline?: boolean;
  inlineDraft?: { text: string; setText: Dispatch<SetStateAction<string>> };
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [entryTaskProfile, setEntryTaskProfile] = useState<AssistantRoleProfileId | null>(null);
  const taskProfile = entryTaskProfile ?? initialTaskProfile;
  const campusDraft = useOptionalCampusDraft('assistant');
  const [localDraft, setLocalDraft] = useState(initialDraft);
  const sharedDraft = !inline && campusDraft.available ? campusDraft : undefined;
  const draftState = sharedDraft ?? inlineDraft;
  const draft = draftState?.text ?? localDraft;
  const setDraft = draftState?.setText ?? setLocalDraft;
  const instanceId = useId();
  const idPrefix = inline ? `assistant-${instanceId}` : 'assistant';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [senseRevision, setSenseRevision] = useState(0);
  const [guideTime] = useState(() => Date.now());
  const sessionId = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const seededUrlDraft = useRef(false);
  const functionsReady = areFunctionsConfigured();
  // Legacy Functions have no professional overview reader. A URL task context
  // can choose service guidance, but cannot select an identity or grant a role.
  const roleGuide = assistantRoleTaskGuide(taskProfile, draft.trim(), guideTime, false);
  const publicCourseIntent = resolvePublicCourseAssistantIntent(draft, schoolId);
  const localQuestion = Boolean(roleGuide) || canAnswerAssistantLocally(draft);
  const examples = taskProfile !== 'student'
    ? assistantRoleWorkServices(taskProfile).flatMap((id) => {
        const service = getAssistantService(id);
        return service ? [`開啟${service.label}`] : [];
      })
    : functionsReady ? ['這週有哪些作業要交？', '如何前往圖書館？', '校園裡有哪些餐廳？']
      : ['你能做什麼？', '查看我的匯入成績', '開啟圖書館'];
  const latestCloudReply = messages.findLastIndex((message) => message.role === 'assistant' && !message.local && !message.publicCourse);
  useAssistantWorkspaceHandoff(inline, (entry) => {
    if (pending || request.current) return { ok: false, message: '請先等待目前的回答，或停止後再帶入新問題。原草稿尚未變更。' };
    if (entry.workContext) setEntryTaskProfile(assistantTaskProfileForWorkContext(entry.workContext));
    setDraft(entry.prompt);
    return { ok: true };
  });

  useLayoutEffect(() => {
    // 網址 ?q= 有值且與現有草稿不同：以網址為準覆寫（明確深連結手遞）；無 q 才保留草稿。
    if (!sharedDraft || seededUrlDraft.current || !initialDraft) return;
    seededUrlDraft.current = true;
    if (sharedDraft.text === initialDraft) return;
    sharedDraft.setText(initialDraft);
  }, [initialDraft, sharedDraft]);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || request.current) return;
    if (inline) stopSpokenReply();
    const submittedRoleGuide = assistantRoleTaskGuide(taskProfile, content, Date.now(), false);
    const local: LocalAssistantResult | null = submittedRoleGuide
      ? {
          kind: 'services',
          content: '這個助理入口尚未連接此類工作資料。請到對應服務核對，工作區會確認你的帳號與權限。這次沒有讀取或變更工作資料。',
          serviceIds: [...submittedRoleGuide.serviceIds],
        }
      : answerAssistantLocally(content, { owner: localOwner, schoolId }, { preferCampusReads: functionsReady });
    if (local && (submittedRoleGuide || !publicCourseIntent)) {
      setMessages((previous) => [...previous, { role: 'user', content },
        { role: 'assistant', content: local.content, response: { content: local.content }, local }]);
      setDraft('');
      setError('');
      composer.current?.focus();
      return;
    }
    if (!publicCourseIntent && !functionsReady) return;
    if (!publicCourseIntent && !isWebOnlineOrderingEnabled() && isWebOrderStatusQuestion(content)) {
      setMessages((previous) => [
        ...previous,
        { role: 'user', content },
        {
          role: 'assistant',
          content: ONLINE_ORDERING_OFF_TEXT,
          response: { content: ONLINE_ORDERING_OFF_TEXT },
        },
      ]);
      setDraft('');
      setError('');
      composer.current?.focus();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      if (publicCourseIntent) {
        const result = await answerPublicCourseQuestion({
          question: content,
          schoolId,
          origin: 'web',
          signal: controller.signal,
          isCurrent: () => request.current === controller && !controller.signal.aborted,
        });
        if (controller.signal.aborted || request.current !== controller || !result) return;
        setMessages((previous) => [
          ...previous,
          { role: 'user', content, publicCourse: {} },
          {
            role: 'assistant',
            content: result.content,
            response: { content: result.content },
            publicCourse: { read: result.read },
          },
        ]);
        setDraft((current) => current.trim() === content ? '' : current);
        return;
      }
      sessionId.current ??= crypto.randomUUID();
      const response = await callCampusAssistant(
        {
          userId,
          schoolId,
          groupId: groupId || undefined,
          sessionId: sessionId.current,
          messages: [
            ...messages
              .filter((message, index) => !message.publicCourse && !message.local && !messages[index + 1]?.local)
              .map(({ role, content: text }) => ({ role, content: text })),
            { role: 'user', content },
          ],
        },
        controller.signal,
      );
      if (controller.signal.aborted || request.current !== controller) return;
      setMessages((previous) => [
        ...previous,
        { role: 'user', content },
        { role: 'assistant', content: response.content, response },
      ]);
      setDraft((draft) => draft.trim() === content ? '' : draft);
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller)
        setError(requestError(failure));
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        request.current = null;
        setPending(false);
        if (!inline) composer.current?.focus();
      }
    }
  }

  function stopAsking() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    composer.current?.focus();
  }

  function clearConversation() {
    stopAsking();
    sessionId.current = null;
    setMessages([]);
    setDraft('');
    setError('');
  }

  return (
    <section
      className={inline ? `${styles.conversation} ${styles.inline}` : styles.conversation}
      aria-label="校園助理對話"
    >
      {!inline && functionsReady && taskProfile === 'student' && (
        <CampusSensePanel
          userId={userId}
          schoolId={schoolId}
          revision={senseRevision}
          onAsk={(question) => {
            setDraft(question);
            setError('');
            composer.current?.focus();
          }}
        />
      )}
      <div className={styles.toolbar}>
        <p className={home.intro}>
          {taskProfile !== 'student'
            ? '查詢校園資訊，或開啟對應工作服務。'
            : !functionsReady
            ? '雲端助理尚未啟用，可先查詢清大、暨大的公開開課資料。'
            : groupId
              ? '正在這門課的範圍內詢問。'
              : '查詢課務、校園地點或服務資訊。'}
        </p>
        {(messages.length > 0 || pending) && (
          <button type="button" className={home.secondary} onClick={clearConversation}>
            清除對話
          </button>
        )}
      </div>
      {!inline && messages.length === 0 && !pending && (
        <div className={styles.empty}>
          <h2>{functionsReady ? '今天需要什麼幫忙？' : '雲端助理尚未啟用'}</h2>
          <p>
            {taskProfile !== 'student'
              ? '這個助理入口目前以服務導覽接續工作。授課、門市與管理資料請到對應工作區核對。'
              : functionsReady
              ? '寫下問題，可以補充課程名稱、日期或地點。若要排課、找空堂，請用課表裡的「幫我安排」。'
              : '正式站尚未接上雲端函式服務。你仍可查詢公開開課資料、開啟校園服務，或查看此帳號在這台裝置匯入的成績紀錄。'}
          </p>
          {(
            <div className={styles.exampleQuestions} aria-label="常用問題">
              {examples.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => {
                    setDraft(question);
                    composer.current?.focus();
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          )}
          <nav aria-label="直接開啟服務" className={styles.serviceLinks}>
            <AssistantReplyLink href="/timetable">我的課表</AssistantReplyLink>
            <AssistantReplyLink href="/#courses">課程</AssistantReplyLink>
            <AssistantReplyLink href="/map">校園地圖</AssistantReplyLink>
            <AssistantReplyLink href="/cafeteria">餐廳</AssistantReplyLink>
          </nav>
        </div>
      )}
      <div
        role="log"
        aria-label="對話紀錄"
        aria-live="polite"
        aria-relevant="additions"
        className={styles.messages}
      >
        {messages.map((message, index) => (
          <article
            key={index}
            className={message.role === 'user' ? styles.question : styles.answer}
          >
            <p className={styles.author}>{message.role === 'user' ? '你' : '校園助理'}</p>
            {!message.publicCourse?.read && <p className={styles.content}>{visibleMessage(message)}</p>}
            {message.role === 'assistant' && (
              <>
                {message.publicCourse?.read && <PublicCourseAssistantResult read={message.publicCourse.read} />}
                {inline && <SpokenReply text={visibleMessage(message)} disabled={pending} />}
                {message.local && <AssistantServiceLinks serviceIds={message.local.serviceIds} schoolId={schoolId} />}
                {index === latestCloudReply && assistantWriteProposals(message.response).map((proposal, proposalIndex) => (
                  <AgentWritePanel
                    key={proposal.agentRunId + ':' + proposal.toolName + ':' + proposalIndex}
                    proposal={proposal}
                    userId={userId}
                    schoolId={schoolId}
                    groupId={groupId || undefined}
                    onCompleted={() => setSenseRevision((value) => value + 1)}
                  />
                ))}
                <div className={styles.cards}>
                  <AgentCardList
                    cards={readOnlyAssistantCards(message.response.cards, schoolId)}
                    schoolId={schoolId}
                  />
                </div>
                {isWebOnlineOrderingEnabled() && hasOrderProposal(message.response) && (
                  <p className={styles.note}>
                    這段對話不會送出訂單。訂單狀態和取餐號碼請看<AssistantReplyLink href="/orders">我的訂單</AssistantReplyLink>
                    。
                  </p>
                )}
                {assistantSources(message.response.citations).length > 0 && (
                  <ul className={styles.sources} aria-label="參考來源">
                    {assistantSources(message.response.citations).map((source) => (
                      <li key={source.url}>
                        <AssistantReplyAnchor href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.label}
                        </AssistantReplyAnchor>
                      </li>
                    ))}
                  </ul>
                )}
                {index === messages.length - 1 &&
                  assistantSuggestions(message.response).length > 0 && (
                    <div className={styles.suggestions} aria-label="接續詢問">
                      {assistantSuggestions(message.response).map((suggestion, suggestionIndex) => (
                        <button
                          type="button"
                          key={suggestionIndex}
                          disabled={pending}
                          onClick={() => {
                            setDraft(suggestion);
                            setError('');
                            composer.current?.focus();
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
              </>
            )}
          </article>
        ))}
      </div>
      {pending && (
        <p role="status" className={styles.note}>
          正在查詢，請稍候…
        </p>
      )}
      <form onSubmit={send} className={styles.composer} aria-label="傳送問題">
        <label htmlFor={`${idPrefix}-question`}>你的問題</label>
        <textarea
          ref={composer}
          id={`${idPrefix}-question`}
          value={draft}
          maxLength={4000}
          rows={inline ? 2 : 3}
          readOnly={pending}
          placeholder={functionsReady ? '例如：圖書館怎麼走？' : '例如：開啟圖書館、查看我的匯入成績'}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          aria-describedby={`${idPrefix}-${error ? 'error' : 'note'}`}
        />
        <div className={styles.voiceRow}>
          <VoiceDictationButton
            disabled={pending}
            onTranscript={(text) => {
              setDraft((previous) => [previous.trim(), text.trim()].filter(Boolean).join(' ').slice(0, 4000));
              setError('');
              composer.current?.focus();
            }}
          />
          <span className={styles.note}>說完可修改文字，再送出。Enter 送出、Shift + Enter 換行。</span>
        </div>
        {error && (
          <p id={`${idPrefix}-error`} role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.submitRow}>
          <p id={`${idPrefix}-note`} className={styles.note}>
            {!functionsReady
              ? '雲端助理尚未啟用；仍可查詢公開開課資料、尋找服務與查看這台裝置的個人匯入紀錄。'
              : isWebOnlineOrderingEnabled()
                ? '回覆可能有誤；申請、繳費與訂單請以服務頁面的紀錄為準。'
                : '回覆可能有誤；申請、繳費請以服務頁面的紀錄為準。'}
          </p>
          {inline && pending ? (
            <button key="stop" type="button" className={home.primary} onClick={stopAsking} data-assistant-stop-read="true">
              停止回答
            </button>
          ) : (
            <button
              key="send"
              type="submit"
              className={home.primary}
              disabled={(!functionsReady && !localQuestion && !publicCourseIntent) || pending || !draft.trim()}
            >
              {pending ? '查詢中…' : functionsReady && error ? '重試' : '送出'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function EntryServiceLinks({
  serviceIds,
  navigationSearch,
  label,
}: {
  serviceIds: readonly AssistantServiceId[];
  navigationSearch: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className={styles.recoveryServices}>
      {serviceIds.map((id) => {
        const service = getAssistantService(id);
        return service ? (
          <AssistantReplyLink key={id} href={campusServiceHref(service.href, navigationSearch)}>
            {service.label}
          </AssistantReplyLink>
        ) : null;
      })}
    </nav>
  );
}

function EntryTaskContext({ profile, navigationSearch }: {
  profile: AssistantRoleProfile | null;
  navigationSearch: string;
}) {
  if (!profile || profile.id === 'student') return null;
  return (
    <section className={styles.entryTask} aria-label="目前任務情境">
      <h3>任務情境：{profile.label}</h3>
      <p>相關工作資料請到對應服務核對。選擇情境不會更換帳號或取得權限；工作區會確認你的登入資格。</p>
      <EntryServiceLinks serviceIds={assistantRoleWorkServices(profile.id)} navigationSearch={navigationSearch} label="相關工作服務" />
    </section>
  );
}

type EntryRecoveryState = 'campus-loading' | 'campus-error' | 'campus-unselected' | 'auth-loading' | 'auth-error' | 'guest';

function AssistantEntryRecovery({ state, initialDraft, profile, campus, navigationSearch, returnUrl }: {
  state: EntryRecoveryState;
  initialDraft: string;
  profile: AssistantRoleProfile | null;
  campus: CampusBrowseContext;
  navigationSearch: string;
  returnUrl: string;
}) {
  const selection = useOptionalSelectedSchool();
  const title = state === 'campus-error' ? '校園資料暫時連不上'
    : state === 'campus-unselected' ? '先選擇要使用的校園'
      : state === 'auth-error' ? '暫時無法確認登入狀態'
        : state === 'guest' ? '準備好問題，接著選擇服務'
          : '正在準備你的助理';
  const note = state === 'campus-error' ? '尚未取得校園目錄，無法確認目前可用的學校。你可以重新讀取，或先開啟服務查看連線狀態。'
    : state === 'campus-unselected' ? '請先選擇一所學校，再使用校園助理。'
      : state === 'auth-error' ? '這次沒有取得帳號確認結果。重新載入後再試，或先開啟公開服務。'
        : state === 'guest' ? '校園資訊可先從地圖、公車和公開公告查。個人或工作資料會在對應服務確認登入資格。'
          : state === 'campus-loading' ? '正在確認校園…' : '正在確認登入狀態…';
  return (
    <section className={styles.recovery} aria-labelledby="assistant-entry-title">
      <header>
        <h2 id="assistant-entry-title">{title}</h2>
        <p role={state.endsWith('error') ? 'alert' : 'status'}>{note}</p>
      </header>
      {initialDraft && (
        <div className={`${styles.composer} ${styles.recoveryDraft}`}>
          <label htmlFor="assistant-preserved-question">保留的問題</label>
          <textarea id="assistant-preserved-question" value={initialDraft} readOnly rows={3} aria-describedby="assistant-preserved-note" />
          <p id="assistant-preserved-note" className={styles.note}>問題尚未送出。完成校園與登入確認後，仍由你按下送出。</p>
        </div>
      )}
      {!areFunctionsConfigured() && <p className={styles.note}>雲端助理尚未啟用。仍可開啟下方服務，各服務會顯示實際可用的資料與功能。</p>}
      {state === 'campus-unselected' && selection && <SchoolSelector />}
      {state === 'guest' && campus.schoolId && (
        <SchoolAccountRequired returnUrl={returnUrl} alternative="校園資訊可先從地圖、公車和公開公告查。" />
      )}
      <div className={styles.recoveryActions}>
        {state === 'campus-error' && (selection?.onRetryCatalog ? (
          <button type="button" className={home.primary} onClick={selection.onRetryCatalog}>重新讀取校園</button>
        ) : (
          <a className={home.primary} href={returnUrl}>重新載入此頁</a>
        ))}
        {state === 'auth-error' && <a className={home.primary} href={returnUrl}>重新確認登入狀態</a>}
        <AssistantReplyLink className={home.secondary} href={campusServiceHref('/explore', navigationSearch)}>返回探索</AssistantReplyLink>
        {state === 'guest' && selection && <SchoolSelector compact />}
      </div>
      <EntryTaskContext profile={profile} navigationSearch={navigationSearch} />
      <section aria-labelledby="assistant-public-services">
        <h3 id="assistant-public-services">先從校園服務開始</h3>
        <p>這些入口可讓訪客瀏覽公開資訊；有校園範圍的資料會依你的選擇載入。</p>
        <EntryServiceLinks serviceIds={['map', 'bus', 'library', 'announcements', 'events', 'cafeteria']} navigationSearch={navigationSearch} label="公開校園服務" />
      </section>
    </section>
  );
}

function AssistantRoute() {
  const { user, loading, error } = useAuth();
  const platform = useOptionalNuniSession();
  const search = useSearchParams();
  const campus = useCampusBrowseContext({
    campus: search.get('campus') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    school: search.get('school') ?? undefined,
  });
  const groupId = search.get('courseId') || search.get('groupId') || '';
  const initialDraft = (search.get('q') || '').slice(0, 4000);
  const profile = getAssistantRoleProfile(search.get('taskProfile'));
  const navigationSearch = useCampusNavigationSearch(search);
  const recoveryState: EntryRecoveryState | null = campus.status === 'loading' ? 'campus-loading'
    : campus.status === 'error' ? 'campus-error'
      : campus.status !== 'ready' || !campus.schoolId ? 'campus-unselected'
        : loading ? 'auth-loading' : error ? 'auth-error' : !user ? 'guest' : null;
  if (recoveryState || !user || !campus.schoolId) return (
    <AssistantEntryRecovery
      state={recoveryState ?? 'guest'}
      initialDraft={initialDraft}
      profile={profile}
      campus={campus}
      navigationSearch={navigationSearch}
      returnUrl={`/ai-assistant${search.size ? `?${search.toString()}` : ''}`}
    />
  );
  const localOwner = platform && (platform.loading || platform.error || platform.pendingLogout)
    ? ''
    : platform?.session
      ? 'platform:' + platform.session.platformAccountId
      : 'school:' + user.uid;
  return (
    <>
      <div className={styles.entryContext}><EntryTaskContext profile={profile} navigationSearch={navigationSearch} /></div>
      <AssistantConversation
        key={JSON.stringify([user.uid, localOwner, platform?.session?.context, campus.schoolId, groupId, initialDraft, profile?.id])}
        userId={user.uid}
        localOwner={localOwner}
        groupId={groupId}
        initialDraft={initialDraft}
        schoolId={campus.schoolId}
        taskProfile={profile?.id}
      />
    </>
  );
}

export default function AssistantPage({ children }: { children?: ReactNode }) {
  return (
    <SiteShell title="助理">
      {children}
      <Suspense fallback={<p role="status">載入中…</p>}>
        <AssistantRoute />
      </Suspense>
    </SiteShell>
  );
}
