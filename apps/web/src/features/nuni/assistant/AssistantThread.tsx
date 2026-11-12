import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { SpokenReply } from '@/components/SpokenReply';
import { AssistantCardStack } from './AssistantCards';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantServiceLinks } from '@/components/AssistantServiceLinks';
import { canAnswerAssistantLocally } from '@/lib/assistantLocalActions';
import { SUGGESTIONS, stepFamily, stepStatus } from './copy';
import styles from './AssistantReply.module.css';
import draftStyles from './AssistantDraft.module.css';
import { EMPTY_COMPOSER_DRAFT, chooseComposerSuggestion, editComposerDraft, restoreComposerDraft, sendComposerDraft } from './composerDraft';
import type { V2ActionStates, V2Card, V2Turn } from './types';

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
  onStop,
  onConfirm,
  onCancel,
  onReconcile,
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
  onStop?: () => void;
  onConfirm: (cards: V2Turn['reply']['cards']) => void;
  onCancel: (turn: V2Turn, index: number) => void;
  onReconcile?: (card: V2Card) => void;
}) {
  const fieldId = useId();
  const log = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [draft, setDraft] = useState(EMPTY_COMPOSER_DRAFT);
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
    if (inline) {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    end.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  }, [inline, turns, pending, error]);
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = Math.min(node.scrollHeight, 132) + 'px';
  }, [question]);
  const schoolQuery = '?schoolId=' + encodeURIComponent(schoolId);
  const canSubmit = !pending && !onStop && !!question.trim() &&
    (canAnswerAssistantLocally(question) || (consent && ready));
  function submitQuestion() {
    // Rejected keyboard/form submits must not resume automatic scrolling.
    if (!canSubmit) return;
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
    <section ref={shell} className={inline ? styles.inlineShell : styles.shell} aria-label="情境助理 v2">
      {!inline && (
        <>
          <p className={styles.intro}>可直接查詢這台裝置保存的課表與行程；雲端查詢涵蓋已同步資料。建立個人事件不會發送推播提醒。</p>
          <nav className={styles.services} aria-label="校園服務入口">
            <Link href={'/map' + schoolQuery}>校園地圖</Link>
            <Link href={'/bus' + schoolQuery}>公車資訊</Link>
            <Link href={'/cafeteria' + schoolQuery}>餐廳資訊</Link>
          </nav>
        </>
      )}
      {!ready ? (
        <p className={styles.notice} role="status">
          雲端查詢暫時無法使用，這台裝置保存的課表、行程與匯入成績仍可直接查詢。
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
            <p>可以問作業截止、下一堂課、校園餐廳或幫你排一段讀書時間。回覆會整理成卡片，需你確認後才會寫入。</p>
            <div className={styles.chips}>
              {SUGGESTIONS.map((phrase) => (
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
                {inline ? (
                  <SpokenReply text={turn.reply.answer} disabled={pending}>
                    {turn.reply.local || turn.reply.dataRead === true
                      ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.reply.answer}</p>
                      : <AssistantMarkdown text={turn.reply.answer} />}
                  </SpokenReply>
                ) : turn.reply.local || turn.reply.dataRead === true
                  ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.reply.answer}</p>
                  : <AssistantMarkdown text={turn.reply.answer} />}
                {turn.reply.local && <AssistantServiceLinks serviceIds={turn.reply.local.serviceIds} schoolId={schoolId} audience="platform" />}
                {turn.reply.simulation ? <p className={styles.sim}>模擬資料</p> : null}
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
            <AssistantCardStack
              cards={turn.reply.cards}
              states={states}
              pending={pending}
              onConfirm={onConfirm}
              onCancel={(index) => onCancel(turn, index)}
              onReconcile={onReconcile}
            />
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
            {SUGGESTIONS.map((phrase) => (
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
            placeholder={inline && turns.length ? '接著問…' : '輸入問題'}
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
            {['下一堂課在哪裡？', '這週有哪些作業要交？'].map((phrase) => (
              <button type="button" key={phrase} className={styles.chip} onClick={() => applyChip(phrase)}>
                {phrase}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
