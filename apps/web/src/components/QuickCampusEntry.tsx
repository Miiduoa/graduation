'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import {
  forgetDirectorySearch,
  rememberDirectorySearch,
  restoreDirectorySearch,
} from '@/lib/campusDirectorySearch';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import { VoiceDictationButton } from './VoiceDictationButton';
import { CampusIcon } from './CampusIcon';
import {
  resolveCampusActions,
  getQuickCampusActions,
  QUICK_CAMPUS_EXAMPLES,
} from '@/lib/quickCampusActions';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import {
  answerPublicCourseQuestion,
  type PublicCourseAssistantAnswer,
} from '@campus/shared/src/publicCourseAssistantClient';
import { PublicCourseAssistantResult } from './PublicCourseAssistantResult';
import {
  ASSISTANT_SERVICES,
  assistantServiceHref,
  resolveAssistantServiceIntent,
  type AssistantServiceId,
} from '@campus/shared/src/assistantServices';
import { AssistantServiceLinks } from './AssistantServiceLinks';
import { useCampusFinderAccount, useCampusFinderDraftScope } from '@/lib/useCampusFinderAccount';
import { AssistantLinkNavigation, useAssistantLinkNavigation } from './AssistantReplyLink';
import styles from './QuickCampusEntry.module.css';

type Analysis = {
  scope: string;
  phrase: string;
  state: 'loading' | 'ready' | 'error';
  result?: CampusSemanticResult;
  publicAnswer?: PublicCourseAssistantAnswer;
  message?: string;
};

export function QuickCampusEntry({
  onAsk,
  onNavigate,
  compact = false,
  inlineDraft,
}: {
  onAsk?: ((phrase: string) => void) | null;
  onNavigate?: (href: string) => void;
  compact?: boolean;
  /** An in-memory workspace draft; never persisted as directory search history. */
  inlineDraft?: { text: string; setText: Dispatch<SetStateAction<string>> };
} = {}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const selection = useOptionalSelectedSchool();
  const account = useCampusFinderAccount();
  const { uid, platformAudience } = account;
  const campusReady = !selection || (!selection.loading && selection.catalogStatus === 'ready');
  const canInterpret = account.canInterpret && campusReady;
  const canUseAssistant = account.canUseAssistant && campusReady;
  const canRemember = account.canRemember && campusReady;
  const selected = selection?.selectedSchool;
  const selectedSchoolId = selected?.id || '';
  const scope = JSON.stringify([
    account.responseScope,
    selectedSchoolId,
    Boolean(selection?.loading),
    selection?.catalogStatus,
  ]);
  const storageScope = JSON.stringify([account.ownerScope, selectedSchoolId]);
  const draftScope = useCampusFinderDraftScope(
    account.ownerScope,
    campusReady ? selectedSchoolId : null,
  );
  const campusSearch = buildCampusNavigationSearch(
    null,
    selected ? { id: selected.id, code: selected.code } : null,
    Boolean(selection && !selection.loading && selection.catalogStatus === 'ready'),
  );
  const [draft, setDraft] = useState({ scope: draftScope, query: '', edited: false });
  const query = inlineDraft?.text ?? (draft.scope === draftScope ? draft.query : '');
  if (draft.scope !== draftScope) setDraft({ scope: draftScope, query: '', edited: false });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentScope = useRef(scope);
  const restoredScope = useRef<string | null>(null);
  useLayoutEffect(() => {
    currentScope.current = scope;
    // A later return to the same account must not revive its earlier response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnalysis(null);
    return () => {
      sequence.current += 1;
      controller.current?.abort();
    };
  }, [scope]);
  useLayoutEffect(() => {
    if (inlineDraft || !canRemember || restoredScope.current === storageScope) return;
    restoredScope.current = storageScope;
    // A deferred history restore must not replace text entered while campus resolution was pending.
    const snapshot = restoreDirectorySearch('quick', window.location.pathname || '/', storageScope);
    if (draft.edited || !snapshot) return;
    // Restore the typed request after history navigation back to this page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({ scope: draftScope, query: snapshot.query.slice(0, 160), edited: false });
  }, [canRemember, draftScope, storageScope, draft.edited, inlineDraft]);
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  const phrase = query.trim();
  const serviceIntent = resolveAssistantServiceIntent(phrase);
  const active = analysis?.phrase === phrase && analysis.scope === scope ? analysis : null;
  const aiResult = active?.state === 'ready' ? active.result : null;
  const publicIntent = resolvePublicCourseAssistantIntent(phrase, selectedSchoolId);
  const publicAnswer = active?.state === 'ready' ? active.publicAnswer : null;
  const semanticActions =
    aiResult?.status === 'understood'
      ? resolveCampusActions(aiResult.destinations, schoolLmsEnabled)
      : null;
  const actions =
    semanticActions ||
    getQuickCampusActions(phrase, schoolLmsEnabled, platformAudience ? 'platform' : 'school');
  const analysisNotice =
    active?.state === 'loading' || !phrase
      ? ''
      : publicAnswer
        ? '公開課程查詢已回覆。'
        : aiResult?.status === 'clarify'
          ? `需要補充需求。${aiResult.clarifyingQuestion || ''}`
          : publicIntent || serviceIntent?.kind === 'catalog'
            ? ''
            : aiResult?.status === 'understood'
              ? `服務建議已更新，共 ${actions.length} 個入口。`
              : actions.length
                ? `找到 ${actions.length} 個服務入口。`
                : '尚未找到對應服務，可以換個說法。';
  const route = (href: string, serviceId?: AssistantServiceId) =>
    campusServiceHref(
      serviceId
        ? (assistantServiceHref(serviceId, undefined, platformAudience ? 'platform' : 'school') ??
            href)
        : href,
      campusSearch,
    );
  const searchHref = route(
    '/search' + (phrase ? '?q=' + encodeURIComponent(phrase.slice(0, 100)) : ''),
  );
  const assistantHref = route('/ai-assistant?q=' + encodeURIComponent(phrase.slice(0, 4000)));
  const primaryHandoff = Boolean(
    phrase &&
    platformAudience &&
    canUseAssistant &&
    !canInterpret &&
    !publicIntent &&
    !serviceIntent &&
    onAsk !== null,
  );

  function updateQuery(value: string) {
    sequence.current += 1;
    controller.current?.abort();
    setAnalysis(null);
    if (inlineDraft) inlineDraft.setText(value.slice(0, 1000));
    else setDraft({ scope: draftScope, query: value.slice(0, 320), edited: true });
  }

  function startOver() {
    forgetDirectorySearch('quick');
    updateQuery('');
    input.current?.focus();
  }

  function rememberQuick(href: string) {
    if (inlineDraft || !canRemember) return;
    rememberDirectorySearch('quick', {
      path: window.location.pathname || '/',
      destination: href,
      query,
      open: true,
      scope: storageScope,
    });
  }

  const panelNavigation = useContext(AssistantLinkNavigation);
  const navigate = onNavigate ?? panelNavigation;
  const notifyNavigation = useAssistantLinkNavigation(navigate);
  function navigateQuick(event: React.MouseEvent<HTMLAnchorElement>) {
    rememberQuick(event.currentTarget.getAttribute('href') ?? '');
    notifyNavigation(event);
  }

  async function analyze(input: string) {
    const text = input.trim();
    const publicRequest = resolvePublicCourseAssistantIntent(text, selectedSchoolId);
    if (!text || (!canInterpret && !publicRequest)) return;
    controller.current?.abort();
    const activeController = new AbortController();
    controller.current = activeController;
    if (!publicRequest && resolveAssistantServiceIntent(text)) return;
    const request = ++sequence.current;
    const requestScope = scope;
    setAnalysis({ phrase: text, scope: requestScope, state: 'loading' });
    try {
      if (publicRequest) {
        const lookup = await answerPublicCourseQuestion({
          question: text,
          schoolId: selectedSchoolId,
          origin: 'web',
          signal: activeController.signal,
          isCurrent: () => request === sequence.current && currentScope.current === requestScope,
        });
        if (lookup) {
          if (
            request === sequence.current &&
            currentScope.current === requestScope &&
            !activeController.signal.aborted
          ) {
            setAnalysis({
              phrase: text,
              scope: requestScope,
              state: 'ready',
              publicAnswer: lookup,
            });
          }
          return;
        }
        if (!canInterpret) {
          if (request === sequence.current && currentScope.current === requestScope) {
            setAnalysis({
              phrase: text,
              scope: requestScope,
              state: 'error',
              message: '暫時查不到這項公開課程，請調整條件後重試。',
            });
          }
          return;
        }
      }
      if (
        request !== sequence.current ||
        currentScope.current !== requestScope ||
        activeController.signal.aborted
      )
        return;
      if (text.length > 160) {
        setAnalysis({
          phrase: text,
          scope: requestScope,
          state: 'error',
          message: '一般需求請縮短至 160 字以內，再送出分析。',
        });
        return;
      }
      const result = await interpretCampusRequest({
        uid,
        schoolId: selectedSchoolId,
        utterance: text,
      });
      if (
        request === sequence.current &&
        currentScope.current === requestScope &&
        !activeController.signal.aborted
      ) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'ready', result });
      }
    } catch {
      if (
        request === sequence.current &&
        currentScope.current === requestScope &&
        !activeController.signal.aborted
      ) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'error' });
      }
    }
  }

  function onVoiceTranscript(text: string) {
    const transcript = text.slice(0, 320);
    updateQuery(transcript);
    // Starting a speech capture is an explicit interaction; only the transcript is sent to AI.
    if (
      resolvePublicCourseAssistantIntent(transcript, selectedSchoolId) ||
      (canInterpret && !resolveAssistantServiceIntent(transcript))
    )
      void analyze(transcript);
  }

  const analysisAction =
    phrase && (publicIntent || (canInterpret && !serviceIntent)) ? (
      <div className={styles.aiRow}>
        <button
          type="button"
          className={styles.analyzeButton}
          disabled={active?.state === 'loading'}
          onClick={() => void analyze(phrase)}
        >
          {active?.state === 'loading'
            ? publicIntent
              ? '正在查詢課程…'
              : 'AI 正在理解…'
            : publicIntent
              ? '查詢公開課程'
              : '用 AI 理解這句話'}
        </button>
        <span className={styles.hint}>
          {publicIntent
            ? '從校方公開資料找課，可接著查看完整課程。'
            : '語音完成後會自動分析轉寫文字；打字則由你決定是否送出。'}
        </span>
      </div>
    ) : null;

  return (
    <section
      className={compact ? styles.compactEntry : styles.entry}
      aria-labelledby={`${id}-title`}
    >
      <p role="status" aria-atomic="true" className={styles.srOnly}>
        {analysisNotice}
      </p>
      <div className={styles.heading}>
        {compact ? (
          <h2 id={`${id}-title`} className={styles.compactHeading}>
            搜尋服務
          </h2>
        ) : (
          <div>
            <p className={styles.eyebrow}>快速開始</p>
            <h2 id={`${id}-title`}>想做什麼？從這裡開始。</h2>
            <p className={styles.subtitle}>先找到服務，也可以把需求交給校園助理接著處理。</p>
          </div>
        )}
        <Link
          className={styles.allServices}
          href={searchHref}
          onClick={navigateQuick}
        >
          所有服務 <CampusIcon name="arrow" size={16} />
        </Link>
      </div>
      <form
        className={styles.searchForm}
        role="search"
        aria-label="快速尋找服務"
        onSubmit={(event) => {
          event.preventDefault();
          if (composing.current) return;
          // Enter confirms the local search. AI and assistant handoffs stay explicit actions.
          if (phrase) results.current?.focus();
          else input.current?.focus();
        }}
      >
        <div className={styles.inputRow}>
          <label className={styles.srOnly} htmlFor={`${id}-input`}>
            想做什麼？
          </label>
          <CampusIcon name="search" size={20} />
          <input
            ref={input}
            id={`${id}-input`}
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={inlineDraft ? 1000 : 320}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              const isComposing =
                composing.current || event.nativeEvent.isComposing || event.keyCode === 229;
              if (event.key === 'Enter' && isComposing) event.preventDefault();
              if (event.key === 'Escape' && isComposing) event.stopPropagation();
              // Leave ordinary Escape to the surrounding assistant panel so it
              // can close without clearing the person's draft.
            }}
            placeholder="例如：明天沒課，想讀書再吃飯"
          />
          <button type="submit" className={styles.searchButton}>
            查看結果
          </button>
        </div>
        <div className={styles.inputTools}>
          <VoiceDictationButton onTranscript={onVoiceTranscript} />
          <details className={styles.privacy}>
            <summary>語音與資料使用</summary>
            <p>
              轉寫結果可修改。語音辨識可能由瀏覽器供應商處理；公開查課只傳送校別與搜尋條件，其他 AI
              分析會將轉寫文字傳給雲端模型，不會上傳本功能的錄音檔。此入口不會自行繳交、付款或更改資料。
            </p>
          </details>
        </div>
      </form>
      {!publicIntent && analysisAction}
      {primaryHandoff ? (
        <div className={styles.aiRow}>
          {onAsk ? (
            <button type="button" className={styles.analyzeButton} onClick={() => onAsk(phrase)}>
              交給校園助理
            </button>
          ) : (
            <Link
              className={styles.analyzeButton}
              href={assistantHref}
              onClick={navigateQuick}
            >
              交給校園助理
            </Link>
          )}
          <span className={styles.hint}>把這段需求帶入助理，檢查後再送出。</span>
        </div>
      ) : null}
      {!phrase ? (
        <div className={styles.examples} aria-label="常用需求">
          {[...QUICK_CAMPUS_EXAMPLES, '查清大資料庫課程'].map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                updateQuery(example);
                input.current?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : (
        <div
          ref={results}
          className={styles.results}
          role="region"
          aria-label="服務搜尋結果"
          tabIndex={-1}
        >
          {publicIntent && analysisAction}
          {serviceIntent?.kind === 'catalog' && selectedSchoolId && (
            <AssistantLinkNavigation.Provider value={navigate}>
              <AssistantServiceLinks
                serviceIds={ASSISTANT_SERVICES.map((service) => service.id)}
                schoolId={selectedSchoolId}
                audience={platformAudience ? 'platform' : 'school'}
              />
            </AssistantLinkNavigation.Provider>
          )}
          {serviceIntent?.kind === 'catalog' && !selectedSchoolId && (
            <p>先選擇學校，即可查看對應的服務入口。</p>
          )}
          {active?.state === 'loading' && (
            <p role="status" className={styles.hint}>
              {publicIntent
                ? '正在讀取校方公開課程…'
                : 'AI 正在理解你想完成的事情，不會直接執行操作。'}
            </p>
          )}
          {publicAnswer?.read ? (
            <PublicCourseAssistantResult read={publicAnswer.read} />
          ) : publicAnswer ? (
            <p role="status">{publicAnswer.content}</p>
          ) : null}
          {aiResult?.source === 'model' && (
            <div className={styles.understanding}>
              <strong>{aiResult.status === 'clarify' ? '需要再確認一下' : 'AI 理解的需求'}</strong>
              <p>{aiResult.summary}</p>
              {aiResult.clarifyingQuestion && <p>{aiResult.clarifyingQuestion}</p>}
            </div>
          )}
          {(active?.state === 'error' || aiResult?.status === 'unavailable') && (
            <p role="status" className={styles.hint}>
              {active?.message || 'AI 暫時無法使用。以下是基本關鍵字捷徑，並非 AI 理解結果。'}
            </p>
          )}
          {!canInterpret && !serviceIntent && !publicIntent && (
            <p className={styles.hint}>
              {!campusReady
                ? selection?.catalogStatus === 'error'
                  ? '暫時無法確認校園；你可以先搜尋服務，重新確認校園後再分析需求。'
                  : '正在確認校園；你可以先搜尋服務，輸入的文字會保留。'
                : account.status === 'checking'
                  ? '正在確認帳號；你可以先搜尋服務。'
                  : account.status === 'signing-out'
                    ? '正在確認登出狀態；公開服務仍可瀏覽。'
                    : account.status === 'error'
                      ? '暫時無法確認帳號；公開服務仍可瀏覽，請重新確認登入狀態後使用助理。'
                      : platformAudience
                        ? '服務捷徑可直接開啟；複合需求可以交給目前帳號的校園助理。'
                        : '目前顯示服務捷徑；登入 Google 或學校帳號後，可使用校園助理。'}
            </p>
          )}
          {publicAnswer ||
          publicIntent ||
          serviceIntent?.kind === 'catalog' ? null : actions.length ? (
            <>
              <p className={styles.resultHeading}>
                {semanticActions ? 'AI 建議先開啟' : '基本快速入口'}
              </p>
              <div className={styles.actionGrid}>
                {actions.map((action) => (
                  <Link
                    key={action.href}
                    href={route(action.href, action.serviceId)}
                    className={styles.action}
                    onClick={navigateQuick}
                  >
                    <span>
                      <strong>{action.name}</strong>
                      <small>{action.text}</small>
                      {aiResult?.previews
                        ?.filter((preview) => preview.destination === action.destination)
                        .map((preview) => (
                          <span key={preview.destination} className={styles.serviceSnapshot}>
                            <span>
                              {preview.source === 'campus-platform' ? 'nuni 資料' : '接通狀態'}：
                              {preview.message}
                            </span>
                            {preview.items.map((item, index) => (
                              <span key={index} className={styles.snapshotItem}>
                                {item.title}
                                {item.detail ? ' · ' + item.detail : ''}
                              </span>
                            ))}
                          </span>
                        ))}
                    </span>
                    <CampusIcon name="arrow" size={18} />
                  </Link>
                ))}
              </div>
            </>
          ) : !publicAnswer && !publicIntent && aiResult?.status !== 'clarify' ? (
            <p className={styles.noMatch}>沒有找到明確入口，可以補充需求或詢問校園助理。</p>
          ) : null}
          <div className={styles.footerLinks}>
            <Link href={searchHref} onClick={navigateQuick}>
              搜尋更多服務
            </Link>
            {!primaryHandoff && onAsk && canUseAssistant ? (
              <button type="button" onClick={() => onAsk(phrase)}>
                詢問校園助理
              </button>
            ) : !primaryHandoff &&
              onAsk === undefined &&
              campusReady &&
              (canUseAssistant || account.status === 'guest') ? (
              <Link href={assistantHref} onClick={navigateQuick}>
                {account.status === 'guest' ? '登入後詢問助理' : '詢問校園助理'}
              </Link>
            ) : null}
            <button type="button" onClick={startOver}>
              重新輸入
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
