import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { AssistantCardStack } from './AssistantCards';
import { AssistantMarkdown } from './AssistantMarkdown';
import { SUGGESTIONS, stepFamily, stepStatus } from './copy';
import styles from './AssistantReply.module.css';
import type { V2Turn } from './types';

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
  error,
  onAsk,
  onConfirm,
  onCancel,
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
  states: Record<string, string>;
  pending: boolean;
  error: string;
  onAsk: () => void;
  onConfirm: (cards: V2Turn['reply']['cards']) => void;
  onCancel: (turn: V2Turn, index: number) => void;
}) {
  const fieldId = useId();
  const log = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
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
  }, [inline, turns.length, question, pending]);
  useEffect(() => {
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
  function applyChip(phrase: string) {
    onQuestion(phrase);
    field.current?.focus();
  }
  return (
    <section ref={shell} className={inline ? styles.inlineShell : styles.shell} aria-label="情境助理 v2">
      {!inline && (
        <>
          <p className={styles.intro}>課表與事件僅包含已同步資料；建立個人事件不會發送推播提醒。</p>
          <nav className={styles.services} aria-label="校園服務入口">
            <Link href={'/map' + schoolQuery}>校園地圖</Link>
            <Link href={'/bus' + schoolQuery}>公車資訊</Link>
            <Link href={'/cafeteria' + schoolQuery}>餐廳資訊</Link>
          </nav>
        </>
      )}
      {!ready ? (
        <p className={styles.notice} role="status">
          模型目前無法使用。
        </p>
      ) : null}
      <label className={styles.consent}>
        <input type="checkbox" checked={consent} onChange={(e) => onConsent(e.target.checked)} />
        同意在本次對話將問題、對話紀錄及必要課表、作業、個人事件、訂單取餐資訊、餐點偏好與社團貼文摘要傳送
        Groq
        {fallback ? '；若主要模型無法連線，可能改送到 Cloudflare Workers AI' : ''}
      </label>
      <div ref={log} className={styles.log} role="log" aria-busy={pending || undefined}>
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
          <article className={styles.turn} key={i}>
            <div className={`${styles.row} ${styles.rowUser}`}>
              <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                <p>{turn.question}</p>
              </div>
            </div>
            <div className={`${styles.row} ${styles.rowAssistant}`}>
              <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
                <AssistantMarkdown text={turn.reply.answer} />
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
            />
          </article>
        ))}
        {pending ? (
          <div className={`${styles.row} ${styles.rowAssistant}`}>
            <div className={`${styles.bubble} ${styles.bubbleAssistant} ${styles.typing}`} role="status">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className={styles.muted}>正在整理回覆</span>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <div ref={end} className={styles.logEnd} />
      </div>
      <div ref={dock} className={styles.composerDock}>
        {turns.length > 0 && !inline ? (
          <div className={`${styles.chips} ${styles.chipsCompact}`} aria-label="建議問題">
            {SUGGESTIONS.map((phrase) => (
              <button key={phrase} type="button" className={styles.chip} onClick={() => applyChip(phrase)}>
                {phrase}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className={styles.composer}
          aria-label="傳送問題"
          onSubmit={(e) => {
            e.preventDefault();
            onAsk();
          }}
        >
          <label htmlFor={fieldId}>問題</label>
          <textarea
            id={fieldId}
            readOnly={pending}
            ref={field}
            value={question}
            maxLength={1000}
            rows={1}
            placeholder="輸入問題"
            onChange={(e) => onQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onAsk();
              }
            }}
          />
          {inline && (
            <VoiceDictationButton
              disabled={pending || !ready}
              onTranscript={(text) => {
                onQuestion([question.trim(), text.trim()].filter(Boolean).join(' ').slice(0, 1000));
                field.current?.focus();
              }}
            />
          )}
          <button className={styles.send} disabled={!consent || !ready || pending || !question.trim()}>
            送出
          </button>
        </form>
      </div>
    </section>
  );
}
