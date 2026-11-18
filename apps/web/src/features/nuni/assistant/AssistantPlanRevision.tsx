'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { exclusiveAllDayEnd } from '@campus/shared/src/imports/eventCalendar';
import { buildPlanRevisionQuestion, getPlanRevisionEvents, hasUnresolvedAssistantAction, isUnattemptedCalendarPlan, type PlanRevisionEvent } from './planRevision';
import type { V2ActionStates, V2Turn } from './types';
import styles from './AssistantPlanRevision.module.css';

export type RevisionDraftBridge = {
  status?: string;
  recovery?: { id: string; sameContent: boolean };
  onChange: (instruction: string, protectedIndices: readonly number[]) => void;
  onClear: () => { ok: boolean; message?: string };
  onApply: () => { ok: boolean; message?: string; content?: { instruction: string; protectedIndices: number[] } };
};

type Props = {
  turn: V2Turn;
  states: V2ActionStates;
  pending: boolean;
  enabled: boolean;
  draft?: RevisionDraftBridge;
  protectedSelection?: readonly number[];
  onProtectedSelectionChange?: (indices: number[]) => void;
  onPreview: (instruction: string, protectedIndices: readonly number[]) => Promise<{ ok: boolean; message: string }>;
};

function eventTime(event: PlanRevisionEvent): string {
  if (event.allDay) {
    const endDate = exclusiveAllDayEnd(event.date, event.endDate);
    return event.date + ' · 全天' + (endDate ? `（至 ${endDate}，不含結束日）` : '');
  }
  return event.endDate && event.endDate !== event.date
    ? `${event.date} ${event.startTime} – ${event.endDate} ${event.endTime}（台灣時間）`
    : `${event.date} · ${event.startTime}–${event.endTime}（台灣時間）`;
}

function PlanRevision({ turn, states, pending, enabled, onPreview, events, draft, protectedSelection, onProtectedSelectionChange }: Props & { events: PlanRevisionEvent[] }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const focusFrame = useRef<number | null>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [localProtectedIndices, setLocalProtectedIndices] = useState<number[]>([]);
  const protectedIndices = protectedSelection ?? localProtectedIndices;
  function setProtectedIndices(indices: number[]) {
    setLocalProtectedIndices(indices);
    onProtectedSelectionChange?.(indices);
  }
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState('');
  const [draftNotice, setDraftNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    };
  }, []);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  const pristine = isUnattemptedCalendarPlan(turn, states);
  // The owner resumes only this registered revision, cancelling remaining cards first.
  const retryable = started && turn.reply.cards.every(card =>
    states[card.mutationId] === undefined || states[card.mutationId]?.status === 'cancelled');
  const unresolved = hasUnresolvedAssistantAction(states);
  const available = (pristine || retryable) && !unresolved && enabled;
  const waiting = pending || submitting;
  const allProtected = protectedIndices.length === events.length;
  const hasRevoked = turn.reply.cards.some(card => states[card.mutationId]?.status === 'cancelled');
  const allProtectedMessage = hasRevoked
    ? '全部項目已勾選保留原樣，這次不會重新預覽。舊提議已有項目撤銷，不能恢復原確認卡。'
    : pristine
      ? '全部項目已勾選保留原樣，不需重新預覽；原提議保持不變。'
      : '全部項目已勾選保留原樣，這次不會重新預覽；請依原確認卡顯示的結果核對。';

  function revealFocusedControl(target: EventTarget) {
    if (!(target instanceof HTMLElement) || !target.matches('button, input, textarea')) return;
    if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      focusFrame.current = null;
      if (!mounted.current || document.activeElement !== target || !panel.current?.contains(target)) return;
      const style = window.getComputedStyle(target);
      const topMargin = Number.parseFloat(style.scrollMarginBlockStart) || 0;
      const bottomMargin = Number.parseFloat(style.scrollMarginBlockEnd) || 0;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const bounds = target.getBoundingClientRect();
      // Explicit alignment reveals controls hidden by the sticky dock even when
      // they are still inside the layout viewport and nearest would not move.
      if (bounds.bottom > bottom - bottomMargin)
        target.scrollIntoView?.({ block: 'end', inline: 'nearest', behavior: 'instant' });
      else if (bounds.top < top + topMargin)
        target.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'instant' });
    });
  }

  function closeEditor() {
    setOpen(false);
    if (entry.current && !entry.current.disabled) entry.current.focus();
    else panel.current?.focus();
  }

  function clearDraft() {
    if (!draft || waiting || busy.current) return;
    try {
      const result = draft.onClear();
      if (!result.ok) {
        setDraftNotice({ text: result.message || '修改內容尚未清除，原內容仍保留。', error: true });
        return;
      }
      setInstruction('');
      setProtectedIndices([]);
      setMessage('');
      setDraftNotice({ text: result.message || '修改內容已清除，原確認卡未變更。', error: false });
      field.current?.focus();
    } catch (cause) {
      setDraftNotice({ text: cause instanceof Error ? cause.message : '修改內容尚未清除，原內容仍保留。', error: true });
    }
  }

  function applyDraft() {
    if (!draft?.recovery || !available || waiting || busy.current) return;
    try {
      const result = draft.onApply();
      if (!result.ok || !result.content) {
        setDraftNotice({ text: result.message || '草稿尚未套用，請核對目前提議後再試。', error: true });
        return;
      }
      setInstruction(result.content.instruction);
      setProtectedIndices([...result.content.protectedIndices]);
      setMessage('');
      setDraftNotice({ text: result.message || '草稿已帶入，請核對後再重新預覽。', error: false });
      field.current?.focus();
    } catch (cause) {
      setDraftNotice({ text: cause instanceof Error ? cause.message : '草稿尚未套用，原修改內容仍保留。', error: true });
    }
  }

  async function preview() {
    // All-protected is a local no-op, including a direct form submit without text.
    if (allProtected || !available || waiting || busy.current || complete) return;
    const selection = [...protectedIndices];
    try { buildPlanRevisionQuestion(turn, instruction, selection); }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '請先確認修改條件與保留項目，再重新預覽。');
      field.current?.focus();
      return;
    }
    busy.current = true;
    setStarted(true);
    setSubmitting(true);
    setMessage('');
    try {
      const result = await onPreview(instruction.trim(), selection);
      if (!mounted.current) return;
      setMessage(result.message || (result.ok ? '修改後的提議已備妥，請核對新的確認卡。' : '重新預覽尚未完成，修改條件與保留項目已保留。'));
      if (result.ok) setComplete(true);
    } catch (cause) {
      if (mounted.current) setMessage(cause instanceof Error ? cause.message : '重新預覽尚未完成，修改條件與保留項目已保留。');
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  if (!open && !started && !pristine) return null;
  return <section ref={panel} tabIndex={-1} className={styles.panel} aria-label="修改行程提議"
    onFocusCapture={event => revealFocusedControl(event.target)}>
    {complete ? <p role="status" className={styles.notice}>{message}</p> : <>
      <button ref={entry} type="button" className={styles.secondary}
        aria-expanded={open} aria-controls={id + '-editor'} disabled={!available || waiting}
        onClick={() => setOpen(value => !value)}>修改時間或條件</button>
      {unresolved && <p className={styles.notice} role="status">有原操作仍待核對，請先使用原確認卡的核對流程；目前不會重新規劃。</p>}
      {!unresolved && !available && open && <p className={styles.notice} role="status">目前不能重新預覽這份安排，請先核對原確認卡與助理狀態。</p>}
      {allProtected && <p role="status" className={styles.notice}>{allProtectedMessage}</p>}
      {open && <form id={id + '-editor'} className={styles.editor} aria-label="修改安排再預覽"
        aria-busy={submitting || undefined} onSubmit={event => { event.preventDefault(); void preview(); }}>
        {draft && <div className={styles.draftInfo}>
          <p className={styles.hint}>本分頁只暫存最近一份修訂草稿，30 分鐘內可恢復。</p>
          {draft.status && draft.status !== draftNotice?.text && <p className={styles.notice} role="status">{draft.status}</p>}
          {draft.recovery && <>
            <p className={styles.hint}>{draft.recovery.sameContent
              ? '目前提議內容逐欄相同，可帶回保留選項。'
              : '只帶入文字，保留項目須重新選擇。'}</p>
            <button type="button" className={styles.secondary} disabled={!available || waiting} onClick={applyDraft}>套用已恢復的草稿</button>
          </>}
        </div>}
        <fieldset className={styles.protectedEvents}>
          <legend className={styles.heading}>原提議內容</legend>
          <p id={id + '-protection'} className={styles.hint}>勾選的項目會保留名稱、開始／結束日期、全天設定及開始／結束時間。整組調時會排除勾選項目；若要移動，請先取消保留勾選。若無法可靠核對，就不會加入新的確認卡。</p>
          <ol className={styles.events} aria-label="原提議行程">
            {events.map((event, index) => <li key={index}>
              <strong id={`${id}-title-${index}`}>{event.title}</strong>
              <span id={`${id}-when-${index}`}>{eventTime(event)}</span>
              <label className={styles.protection} htmlFor={`${id}-protect-${index}`}>
                <input id={`${id}-protect-${index}`} type="checkbox" checked={protectedIndices.includes(index)} disabled={waiting}
                  aria-labelledby={`${id}-protect-label-${index} ${id}-ordinal-${index} ${id}-title-${index} ${id}-when-${index}`}
                  aria-describedby={id + '-protection'}
                  onChange={event => {
                    const checked = event.target.checked;
                    const selection = checked ? [...protectedIndices, index].sort((left, right) => left - right)
                      : protectedIndices.filter(value => value !== index);
                    setProtectedIndices(selection);
                    setMessage('');
                    setDraftNotice(null);
                    draft?.onChange(instruction, selection);
                  }} />
                <span id={`${id}-protect-label-${index}`}>保留原樣</span>
                <span id={`${id}-ordinal-${index}`} className={styles.visuallyHidden}>第 {index + 1} 項</span>
              </label>
            </li>)}
          </ol>
        </fieldset>
        <p id={id + '-notice'} className={styles.hint}>保留原樣只保留提議內容。重新預覽會先撤銷整份未執行提議，再依修改條件產生新卡；新卡仍需你確認，才會寫入行事曆。</p>
        <label htmlFor={id + '-instruction'}>修改條件</label>
        <textarea ref={field} id={id + '-instruction'} value={instruction} maxLength={300} rows={3}
          disabled={waiting} aria-describedby={id + '-notice ' + id + '-count'}
          placeholder="例如：第一項改成明晚 20:00，其他安排保持原樣"
          onChange={event => {
            const value = event.target.value;
            setInstruction(value);
            setMessage('');
            setDraftNotice(null);
            draft?.onChange(value, protectedIndices);
          }} />
        <p id={id + '-count'} className={styles.hint}>{instruction.length}/300 字</p>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={allProtected || !available || waiting || !instruction.trim()}>
            {submitting ? '正在重新預覽…' : '重新預覽'}
          </button>
          <button type="button" className={styles.secondary} disabled={waiting} onClick={closeEditor}>
            {allProtected ? '回到原提議' : '收起修改'}
          </button>
          {draft && <button type="button" className={styles.secondary} disabled={waiting} onClick={clearDraft}>清除修改內容</button>}
        </div>
        {draftNotice && <p className={styles.notice} role={draftNotice.error ? 'alert' : 'status'}>{draftNotice.text}</p>}
        {message && <p className={styles.notice} role="alert">{message}</p>}
      </form>}
    </>}
  </section>;
}

export function AssistantPlanRevision(props: Props) {
  let events: PlanRevisionEvent[];
  try { events = getPlanRevisionEvents(props.turn); }
  catch { return null; }
  // A different proposal must never inherit another request's draft or late response.
  const key = JSON.stringify([props.turn.reply.cards.map(card => card.mutationId), events]);
  return <PlanRevision key={key} {...props} events={events} />;
}
