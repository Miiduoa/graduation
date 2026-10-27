'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { useAuth } from '@/components/AuthGuard';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
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

type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; response: CampusAssistantEnvelope };
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

function AssistantConversation({
  userId,
  groupId,
  initialDraft,
  schoolId,
}: {
  userId: string;
  groupId: string;
  initialDraft: string;
  schoolId: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [senseRevision, setSenseRevision] = useState(0);
  const sessionId = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const functionsReady = areFunctionsConfigured();

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
    if (!content || request.current || !functionsReady) return;
    if (!isWebOnlineOrderingEnabled() && isWebOrderStatusQuestion(content)) {
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
    sessionId.current ??= crypto.randomUUID();
    setPending(true);
    setError('');
    try {
      const response = await callCampusAssistant(
        {
          userId,
          schoolId,
          groupId: groupId || undefined,
          sessionId: sessionId.current,
          messages: [
            ...messages.map(({ role, content: text }) => ({ role, content: text })),
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
      setDraft('');
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller)
        setError(requestError(failure));
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        request.current = null;
        setPending(false);
        composer.current?.focus();
      }
    }
  }

  function clearConversation() {
    request.current?.abort();
    request.current = null;
    sessionId.current = null;
    setMessages([]);
    setDraft('');
    setError('');
    setPending(false);
    composer.current?.focus();
  }

  return (
    <section className={styles.conversation} aria-label="校園助理對話">
      {functionsReady && (
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
          {!functionsReady
            ? '雲端助理尚未啟用。'
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
      {messages.length === 0 && !pending && (
        <div className={styles.empty}>
          <h2>{functionsReady ? '今天需要什麼幫忙？' : '雲端助理尚未啟用'}</h2>
          <p>
            {functionsReady
              ? '寫下問題，可以補充課程名稱、日期或地點。若要排課、找空堂，請用課表裡的「幫我安排」。'
              : '正式站尚未接上雲端函式服務，因此無法詢問助理。設定完成前請改用課表、地圖、公車與公開公告。'}
          </p>
          {functionsReady && (
            <div className={styles.exampleQuestions} aria-label="常用問題">
              {['這週有哪些作業要交？', '如何前往圖書館？', '校園裡有哪些餐廳？'].map((question) => (
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
            <Link href="/timetable">我的課表</Link>
            <Link href="/#courses">課程</Link>
            <Link href="/map">校園地圖</Link>
            <Link href="/cafeteria">餐廳</Link>
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
            <p className={styles.content}>
              {message.role === 'assistant' &&
              !isWebOnlineOrderingEnabled() &&
              hasOrderProposal(message.response)
                ? ONLINE_ORDERING_OFF_TEXT
                : message.content}
            </p>
            {message.role === 'assistant' && (
              <>
                {index === messages.length - 1 && assistantWriteProposals(message.response).map((proposal, proposalIndex) => (
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
                    這段對話不會送出訂單。訂單狀態和取餐號碼請看<Link href="/orders">我的訂單</Link>
                    。
                  </p>
                )}
                {assistantSources(message.response.citations).length > 0 && (
                  <ul className={styles.sources} aria-label="參考來源">
                    {assistantSources(message.response.citations).map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          {source.label}
                        </a>
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
        <label htmlFor="assistant-question">你的問題</label>
        <textarea
          ref={composer}
          id="assistant-question"
          value={draft}
          maxLength={4000}
          rows={3}
          readOnly={pending || !functionsReady}
          disabled={!functionsReady}
          placeholder={functionsReady ? '例如：圖書館怎麼走？' : '雲端助理尚未啟用'}
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
          aria-describedby={error ? 'assistant-error' : 'assistant-note'}
        />
        <div className={styles.voiceRow}>
          <VoiceDictationButton
            disabled={pending || !functionsReady}
            onTranscript={(text) => {
              setDraft((previous) => [previous.trim(), text.trim()].filter(Boolean).join(' ').slice(0, 4000));
              setError('');
              composer.current?.focus();
            }}
          />
          <span className={styles.note}>說完可修改文字，再送出。Enter 送出、Shift + Enter 換行。</span>
        </div>
        {error && (
          <p id="assistant-error" role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.submitRow}>
          <p id="assistant-note" className={styles.note}>
            {!functionsReady
              ? '尚未接上雲端函式服務，輸入與送出已停用。'
              : isWebOnlineOrderingEnabled()
                ? '回覆可能有誤；申請、繳費與訂單請以服務頁面的紀錄為準。'
                : '回覆可能有誤；申請、繳費請以服務頁面的紀錄為準。'}
          </p>
          <button
            type="submit"
            className={home.primary}
            disabled={!functionsReady || pending || !draft.trim()}
          >
            {pending ? '查詢中…' : functionsReady && error ? '重試' : '送出'}
          </button>
        </div>
      </form>
    </section>
  );
}

function AssistantRoute() {
  const { user, loading, error } = useAuth();
  const search = useSearchParams();
  const campus = useCampusBrowseContext({
    campus: search.get('campus') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    school: search.get('school') ?? undefined,
  });
  const groupId = search.get('courseId') || search.get('groupId') || '';
  const initialDraft = (search.get('q') || '').slice(0, 4000);
  if (campus.status !== 'ready' || !campus.schoolId) {
    return (
      <p role="status">
        {campus.status === 'loading'
          ? '正在確認校園…'
          : campus.status === 'error'
            ? '無法載入校園資料，請稍後重試。'
            : '請先選擇一所學校，再使用校園助理。'}
      </p>
    );
  }
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error) return <p role="alert">無法確認登入狀態，請重新整理後再試。</p>;
  if (!user)
    return (
      <SchoolAccountRequired
        returnUrl={`/ai-assistant${search.size ? `?${search.toString()}` : ''}`}
        alternative="校園資訊可先從地圖、公車和公開公告查。"
      />
    );
  return (
    <AssistantConversation
      key={JSON.stringify([user.uid, campus.schoolId, groupId, initialDraft])}
      userId={user.uid}
      groupId={groupId}
      initialDraft={initialDraft}
      schoolId={campus.schoolId}
    />
  );
}

export default function AssistantPage() {
  return (
    <SiteShell title="助理" subtitle="從一個問題開始，找到需要的資訊。">
      <Suspense fallback={<p role="status">載入中…</p>}>
        <AssistantRoute />
      </Suspense>
    </SiteShell>
  );
}
