import Link from 'next/link';
import type { ReactNode } from 'react';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { publicCourseCompoundRequest } from '@campus/shared/src/publicCourseCompound';
import { parseAssistantPublicCourseResults } from '@campus/shared/src/assistantPublicCourseResults';
import { PublicCourseAssistantResult } from '@/components/PublicCourseAssistantResult';
import { useEffect, useId, useRef, useState } from 'react';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { SpokenReply } from '@/components/SpokenReply';
import { AssistantCardStack } from './AssistantCards';
import { AssistantTaskPlan } from './AssistantTaskPlan';
import { AssistantCampusEvents } from './AssistantCampusEvents';
import { parseCampusEventCommand, type AssistantCampusEventTarget } from '@/lib/assistantCampusEvent';
import { parseCampusMapCommand } from '@/lib/nuni/assistantV2/campusMapRequest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { isAssistantTaskRetryQuestion, type AssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantServiceLinks } from '@/components/AssistantServiceLinks';
import { canAnswerAssistantLocally } from '@/lib/assistantLocalActions';
import { canAnswerAssistantPersonalQuestion } from '@/lib/assistantPersonalReads';
import { courseworkStudyFollowup, parseAssistantCourseworkTargets, type AssistantCourseworkTarget } from '@/lib/assistantCoursework';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { assistantPermissionSettingsHref, stepFamily, stepStatus } from './copy';
import { assistantWorkContextFromQuestion, getAssistantRoleWorkflow, type AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import { AssistantRoleTasks } from './AssistantRoleTasks';
import styles from './AssistantReply.module.css';
import draftStyles from './AssistantDraft.module.css';
import { EMPTY_COMPOSER_DRAFT, chooseComposerSuggestion, editComposerDraft, restoreComposerDraft, sendComposerDraft } from './composerDraft';
import type { V2ActionStates, V2Card, V2Turn } from './types';

function ReplyBody({ reply }: { reply: V2Turn['reply'] }) {
  if (parseAssistantTaskPlan(reply.taskPlan))
    return <p>已逐項整理這次任務，結果與尚待處理的項目如下。</p>;
  if (reply.local || reply.dataRead || reply.publicCourseResults !== undefined || reply.eventTargets !== undefined || reply.campusEventPreview)
    return <div className={styles.prose}><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reply.answer}</p></div>;
  return <AssistantMarkdown text={reply.answer} />;
}

function PublicCourseResults({ results }: { results: unknown }) {
  if (results === undefined) return null;
  const reads = parseAssistantPublicCourseResults(results);
  if (!reads) return <p className={styles.muted}>公開課程結果尚未通過核對，請重新查詢。</p>;
  return reads.map((read, index) => <PublicCourseAssistantResult key={read.schoolId + ':' + index} read={read} />);
}

export function AssistantThread({
  inline = false,
  schoolId,
  ready,
  fallback,
  consent,
  onConsent,
  question,
  onQuestion,
  turns,
  states,
  pending,
  pendingLabel,
  asking,
  onStopAsk,
  error,
  recoverableQuestion,
  onRecoverQuestion,
  onAsk,
  onStudyTarget,
  onEventTarget,
  eventBlockedReason,
  onTaskRetry,
  taskRetryForTurn,
  onStop,
  onConfirm,
  onCancel,
  onReconcile,
  renderPlanRevision,
  renderPlanComparison,
  allowBatchConfirmation,
  preferredWorkContext,
}: {
  inline?: boolean;
  schoolId: string;
  ready: boolean;
  fallback: boolean;
  consent: boolean;
  onConsent: (value: boolean) => void;
  question: string;
  onQuestion: (value: string) => void;
  turns: V2Turn[];
  states: V2ActionStates;
  pending: boolean;
  pendingLabel?: string;
  asking: boolean;
  onStopAsk: () => void;
  error: string;
  recoverableQuestion: string;
  onRecoverQuestion: () => void;
  onAsk: () => void;
  onStudyTarget?: (target: AssistantCourseworkTarget, date?: string) => void;
  onEventTarget?: (turn: V2Turn, target: AssistantCampusEventTarget) => void;
  eventBlockedReason?: string;
  onTaskRetry?: (turn: V2Turn, stepIds: string[]) => void;
  taskRetryForTurn?: (turn: V2Turn) => AssistantTaskRetry | null;
  onStop?: () => void;
  onConfirm: (cards: V2Turn['reply']['cards']) => void;
  onCancel: (turn: V2Turn, index: number) => void;
  onReconcile?: (card: V2Card) => void;
  renderPlanRevision?: (turn: V2Turn) => ReactNode;
  renderPlanComparison?: (turn: V2Turn) => ReactNode;
  allowBatchConfirmation?: (turn: V2Turn) => boolean;
  /** Display preference from an already-loaded workspace, never authorization. */
  preferredWorkContext?: AssistantWorkContext;
}) {
  const fieldId = useId();
  const log = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const revisionFocus = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [draft, setDraft] = useState(EMPTY_COMPOSER_DRAFT);
  const [chosenWorkContext, setWorkContext] = useState<AssistantWorkContext | null>(null);
  const [initialWorkContext] = useState(() => assistantWorkContextFromQuestion(question));
  const workContext = chosenWorkContext ?? preferredWorkContext ?? initialWorkContext;
  const workflow = getAssistantRoleWorkflow(workContext);
  useEffect(() => {
    const root = shell.current;
    const node = dock.current;
    if (inline || !root || !node) return;
    const apply = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty('--assistant-dock-height', `${height}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [inline, turns.length, question, pending, draft]);
  useEffect(() => {
    const node = log.current;
    const scrollTarget = inline ? node : window;
    if (!scrollTarget) return;
    // The inline thread owns its scroll position; outer page scrolling must not change it.
    const trackScroll = () => {
      if (!end.current || turns.length === 0) return;
      const nearLatest = inline && node
        ? node.scrollHeight - node.clientHeight - Math.max(0, node.scrollTop) <= 48
        : end.current.getBoundingClientRect().top - window.innerHeight <= 144;
      followLatest.current = nearLatest;
      setShowJump(!nearLatest);
    };
    scrollTarget.addEventListener('scroll', trackScroll, { passive: true });
    return () => scrollTarget.removeEventListener('scroll', trackScroll);
  }, [inline, turns.length]);
  useEffect(() => {
    if (!followLatest.current || (!turns.length && !pending && !error)) return;
    const active = document.activeElement;
    // After a disabled-control blur, a later external focus does not bubble
    // through this thread. Treat a real destination differently from body/html.
    if (revisionFocus.current && active instanceof Element && active !== document.body &&
      active !== document.documentElement && !shell.current?.contains(active)) revisionFocus.current = false;
    if (revisionFocus.current) {
      // Reply updates must not move the form while someone is editing a plan.
      // The existing jump action or a new question explicitly resumes following.
      followLatest.current = false;
      setShowJump(true);
      return;
    }
    if (inline) {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
      return;
    }
    // Automatic updates must finish before the next keyboard interaction. An
    // in-flight smooth scroll can outlive a later focus({ preventScroll: true }).
    // Only the explicit jump action below requests animated scrolling.
    end.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [inline, turns, pending, error]);
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = Math.min(node.scrollHeight, 132) + 'px';
  }, [question]);
  const schoolQuery = '?schoolId=' + encodeURIComponent(schoolId);
  const publicCompound = publicCourseCompoundRequest(question, schoolId);
  const publicCourseIntent = !publicCompound && resolvePublicCourseAssistantIntent(question, schoolId);
  const canSubmit = !pending && !onStop && !!question.trim() &&
    ((consent && ready) || parseCampusMapCommand(question) !== null || (onEventTarget && parseCampusEventCommand(question) !== null) || (onTaskRetry && isAssistantTaskRetryQuestion(question)) || (!publicCompound && (!!publicCourseIntent || canAnswerAssistantLocally(question) || canAnswerAssistantPersonalQuestion(question) ||
      (onStudyTarget && courseworkStudyFollowup(question) !== null))));
  function submitQuestion() {
    // Rejected keyboard/form submits must not resume automatic scrolling.
    if (!canSubmit) return;
    revisionFocus.current = false;
    followLatest.current = true;
    setShowJump(false);
    setDraft(sendComposerDraft(draft, question));
    onAsk();
  }
  function applyChip(phrase: string) {
    const next = chooseComposerSuggestion(draft, question, phrase);
    setDraft(next.draft);
    if (next.question !== question) onQuestion(next.question);
    field.current?.focus();
  }
  function restoreDraft() {
    const next = restoreComposerDraft(draft, question);
    setDraft(next.draft);
    if (next.question !== question) onQuestion(next.question);
    field.current?.focus();
  }
  const consentControl = (
    <label className={styles.consent}>
      <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} />
      同意在本次對話將問題、對話紀錄及必要課表、作業、匯入紀錄摘要（成績欄位會遮罩）、個人事件、訂單取餐資訊、餐點偏好與社團貼文摘要傳送
      Groq
      {fallback ? '；若主要模型無法連線，可能改送到 Cloudflare Workers AI' : ''}
    </label>
  );
  return (
    <section ref={shell} className={inline ? styles.inlineShell : styles.shell} aria-label="情境助理 v2"
      onFocusCapture={event => {
        const target = event.target;
        // Keep this intent if pending disables the editor and the browser blurs it.
        // A deliberate focus elsewhere in this thread replaces the intent.
        revisionFocus.current = target instanceof HTMLElement && !!log.current?.contains(target) &&
          !!target.closest('[data-assistant-plan-revision="true"]');
      }}
      onBlurCapture={event => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) revisionFocus.current = false;
      }}>
      {!inline && (
        <>
          <p className={styles.intro}>依目前工作查資料、接續安排事情。查詢會核對帳號可用的課程與門市；新增行程會先列出內容，確認後再處理。建立個人事件不會發送推播提醒。</p>
          <nav className={styles.services} aria-label="校園服務入口">
            <Link href={'/map' + schoolQuery}>校園地圖</Link>
            <Link href={'/bus' + schoolQuery}>公車資訊</Link>
            <Link href={'/cafeteria' + schoolQuery}>餐廳資訊</Link>
          </nav>
        </>
      )}
      <AssistantRoleTasks context={workContext} onContext={setWorkContext} schoolId={schoolId}
        compact={inline || turns.length > 0} />
      {!ready ? (
        <p className={styles.notice} role="status">
          雲端回答暫時無法使用，仍可直接查詢保存的課表、個人行程、匯入成績與已接通的 nuni 作業，也可查校園地點、核對下一堂課教室，從作業清單安排準備時間，或查詢清大、暨大的公開開課資料。
        </p>
      ) : null}
      {inline && turns.length > 0 && consent ? (
        <details className={styles.consentSettings}>
          <summary>本次對話的資料使用設定</summary>
          {consentControl}
        </details>
      ) : consentControl}
      <div ref={log} className={styles.log} role="log" aria-label="對話紀錄"
        tabIndex={inline ? 0 : undefined} aria-busy={pending || undefined}>
        {!inline && turns.length === 0 && !pending ? (
          <div className={styles.empty}>
            <h2>今天想問什麼？</h2>
            <p>選一個問題後，可以在下方修改再送出。安排個人行程時，會先提供確認卡。</p>
            <div className={styles.chips}>
              {workflow.suggestions.map((phrase) => (
                <button key={phrase} type="button" className={styles.chip} onClick={() => applyChip(phrase)}>
                  {phrase}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((turn, i) => (
          <article className={styles.turn} style={i === turns.length - 1 ? undefined : { animation: 'none' }} key={i}>
            <div className={`${styles.row} ${styles.rowUser}`}>
              <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                <p>{turn.question}</p>
              </div>
            </div>
            <div className={`${styles.row} ${styles.rowAssistant}`}>
              <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                {turn.publicCourse?.read ? <PublicCourseAssistantResult read={turn.publicCourse.read} /> : turn.publicCourse ? <p>{turn.reply.answer}</p> : inline ? (
                  <SpokenReply text={turn.reply.answer} disabled={pending}>
                    <ReplyBody reply={turn.reply} />
                  </SpokenReply>
                ) : <ReplyBody reply={turn.reply} />}
                {onStudyTarget && parseAssistantCourseworkTargets(turn.reply.courseworkTargets).length > 0 ? (
                  <div className={styles.courseworkChoices} role="group" aria-label="安排作業準備時間">
                    <p className={styles.muted}>先找時段並預覽，確認後才加入個人行程。</p>
                    {parseAssistantCourseworkTargets(turn.reply.courseworkTargets).map((target) => (
                      <button key={target.workspaceId + ':' + target.kind + ':' + target.taskId}
                        type="button" className={styles.courseworkChoice}
                        disabled={pending || !!onStop}
                        aria-label={`替${target.courseTitle}的${target.title}安排30分鐘`}
                        onClick={() => onStudyTarget(target, turn.reply.courseworkDate)}>
                        <strong>{target.title}</strong>
                        <span>{target.courseTitle} · {formatTaipeiDateTime(target.dueAt, { seconds: false })} 截止</span>
                        <span className={styles.courseworkAction}>安排 30 分鐘</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <AssistantCampusEvents targets={turn.reply.eventTargets} schoolId={schoolId}
                  pending={pending || !!onStop} blockedReason={eventBlockedReason}
                  sourceOnly={turn.reply.campusEventPreview === true}
                  onSelect={onEventTarget ? target => onEventTarget(turn, target) : undefined} />
                {turn.reply.local && <AssistantServiceLinks serviceIds={turn.reply.local.serviceIds} schoolId={schoolId} audience="platform" />}
                {turn.reply.simulation ? <p className={styles.sim}>模擬資料</p> : null}
                <AssistantTaskPlan plan={turn.reply.taskPlan} cards={turn.reply.cards} states={states}
                  retry={taskRetryForTurn ? taskRetryForTurn(turn) : turn.reply.taskRetry}
                  pending={pending || !!onStop}
                  onRetry={onTaskRetry ? stepIds => onTaskRetry(turn, stepIds) : undefined} />
                <PublicCourseResults results={turn.reply.publicCourseResults} />
                {turn.reply.steps.length ? (
                  <details className={styles.sources}>
                    <summary>查了哪些資料</summary>
                    <ul>
                      {turn.reply.steps.map((s, j) => (
                        <li key={j}>
                          {stepFamily(s.name)}：{stepStatus(s.status)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </div>
            {renderPlanComparison?.(turn)}
            <AssistantCardStack
              cards={turn.reply.cards}
              allowBatchConfirmation={allowBatchConfirmation?.(turn) ?? true}
              states={states}
              pending={pending}
              onConfirm={onConfirm}
              onCancel={(index) => onCancel(turn, index)}
              onReconcile={onReconcile}
            />
            {!turn.reply.campusEventPreview && renderPlanRevision?.(turn)}
          </article>
        ))}
        {pending ? (
          <div className={`${styles.row} ${styles.rowAssistant}`}>
            <div className={`${styles.bubble} ${styles.bubbleAssistant} ${styles.typing}`} role="status">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className={styles.muted}>{pendingLabel ?? (asking ? '正在整理回覆' : '正在核對操作結果')}</span>
              {asking ? (
                <button type="button" className={styles.stopReply} onClick={onStopAsk}>
                  停止這次回答
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
            {assistantPermissionSettingsHref(error) && <>
              {' '}<Link href={assistantPermissionSettingsHref(error)!}>設定 AI 代辦權限</Link>
            </>}
          </p>
        ) : null}
        {recoverableQuestion ? (
          <div className={styles.recover} role="group" aria-label="未完成的問題">
            <p>未完成的問題已保留，切換時不會刪除現在的草稿。</p>
            <p className={styles.recoverText}>{recoverableQuestion}</p>
            <button type="button" disabled={pending} onClick={onRecoverQuestion}>
              切換到這個問題
            </button>
          </div>
        ) : null}
        <div ref={end} className={styles.logEnd} />
      </div>
      <div ref={dock} className={styles.composerDock}>
        {showJump ? (
          <button
            type="button"
            className={styles.jumpLatest}
            onClick={() => {
              revisionFocus.current = false;
              followLatest.current = true;
              setShowJump(false);
              if (inline) {
                // Keep the homepage in place and leave keyboard focus on a persistent target.
                const node = log.current;
                if (node) {
                  node.focus({ preventScroll: true });
                  node.scrollTop = node.scrollHeight;
                }
              } else {
                const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                end.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
              }
            }}
          >
            回到最新回覆
          </button>
        ) : null}
        {turns.length > 0 && !inline ? (
          <div className={`${styles.chips} ${styles.chipsCompact}`} aria-label="建議問題">
            {workflow.suggestions.map((phrase) => (
              <button key={phrase} type="button" className={styles.chip} onClick={() => applyChip(phrase)}>
                {phrase}
              </button>
            ))}
          </div>
        ) : null}
        {draft.saved !== null ? (
          <div className={draftStyles.restore} role="group" aria-label="已保留的輸入內容">
            <span>另有一份草稿已保留</span>
            <button type="button" onClick={restoreDraft}>切換保留草稿</button>
          </div>
        ) : null}
        {draft.notice ? <p className={draftStyles.notice} role="status">{draft.notice}</p> : null}
        <form
          className={styles.composer}
          aria-label="傳送問題"
          onSubmit={(e) => {
            e.preventDefault();
            submitQuestion();
          }}
        >
          <label htmlFor={fieldId}>問題</label>
          <textarea
            id={fieldId}
            aria-describedby={`${fieldId}-hint`}
            ref={field}
            value={question}
            maxLength={1000}
            rows={1}
            placeholder={inline && turns.length ? '接著問…' : workflow.placeholder}
            onChange={(e) => {
              setDraft(editComposerDraft(draft));
              onQuestion(e.target.value);
            }}
            onKeyDown={(e) => {
              // In Chinese/Japanese IMEs Enter selects a candidate; it is not a send gesture.
              if (e.key === 'Enter' && !e.shiftKey &&
                  !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                submitQuestion();
              }
            }}
          />
          {inline && (
            <VoiceDictationButton
              disabled={pending || !ready}
              onTranscript={(text) => {
                setDraft(editComposerDraft(draft));
                onQuestion([question.trim(), text.trim()].filter(Boolean).join(' ').slice(0, 1000));
                field.current?.focus();
              }}
            />
          )}
          {onStop ? (
            <button
              key="stop"
              type="button"
              className={styles.send}
              onClick={() => {
                onStop();
                field.current?.focus();
              }}
            >
              停止回答
            </button>
          ) : (
            <button key="send" className={styles.send} disabled={!canSubmit}>
              送出
            </button>
          )}
        </form>
        <p id={`${fieldId}-hint`} className={styles.composerHint}>
          {pending ? '正在處理上一個問題，可以先輸入下一句。' : 'Enter 送出 · Shift + Enter 換行'}
        </p>
        {inline && ready && !turns.length && !question && !pending && (
          <div className={styles.chips} aria-label="試著問">
            {(workContext === 'student' ? ['下一堂課在哪裡？', '這週有哪些作業要交？'] : workflow.suggestions.slice(0, 2)).map((phrase) => (
              <button type="button" key={phrase} className={styles.chip} onClick={() => applyChip(phrase)}>
                {phrase}
              </button>
            ))}
          </div>
        )}
        {publicCourseIntent && <p className={styles.muted}>直接查詢校方公開資料；到查課頁核對後再匯入課表。</p>}
      </div>
    </section>
  );
}
