'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { buildPlanRevisionQuestion, getPlanRevisionEvents, hasUnresolvedAssistantAction, isUnattemptedCalendarPlan, type PlanRevisionEvent } from './planRevision';
import type { V2ActionStates, V2Turn } from './types';
import styles from './AssistantPlanRevision.module.css';

type Props = {
  turn: V2Turn;
  states: V2ActionStates;
  pending: boolean;
  enabled: boolean;
  onPreview: (instruction: string) => Promise<{ ok: boolean; message: string }>;
};

function eventTime(event: PlanRevisionEvent): string {
  if (event.allDay) return event.date + ' · 全天' + (event.endDate ? `（至 ${event.endDate}，不含結束日）` : '');
  return event.endDate && event.endDate !== event.date
    ? `${event.date} ${event.startTime} – ${event.endDate} ${event.endTime}（台灣時間）`
    : `${event.date} · ${event.startTime}–${event.endTime}（台灣時間）`;
}

function PlanRevision({ turn, states, pending, enabled, onPreview, events }: Props & { events: PlanRevisionEvent[] }) {
  const id = useId();
  const entry = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  const pristine = isUnattemptedCalendarPlan(turn, states);
  // The owner resumes only this registered revision, cancelling remaining cards first.
  const retryable = started && turn.reply.cards.every(card =>
    states[card.mutationId] === undefined || states[card.mutationId]?.status === 'cancelled');
  const unresolved = hasUnresolvedAssistantAction(states);
  const available = (pristine || retryable) && !unresolved && enabled;
  const waiting = pending || submitting;

  async function preview() {
    if (!available || waiting || busy.current || complete) return;
    try { buildPlanRevisionQuestion(turn, instruction); }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '請先確認修改條件，再重新預覽。');
      field.current?.focus();
      return;
    }
    busy.current = true;
    setStarted(true);
    setSubmitting(true);
    setMessage('');
    try {
      const result = await onPreview(instruction.trim());
      if (!mounted.current) return;
      setMessage(result.message || (result.ok ? '修改後的提議已備妥，請核對新的確認卡。' : '重新預覽尚未完成，修改條件已保留。'));
      if (result.ok) setComplete(true);
    } catch (cause) {
      if (mounted.current) setMessage(cause instanceof Error ? cause.message : '重新預覽尚未完成，修改條件已保留。');
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  if (!open && !started && !pristine) return null;
  return <section className={styles.panel} aria-label="修改行程提議">
    {complete ? <p role="status" className={styles.notice}>{message}</p> : <>
      <button ref={entry} type="button" className={styles.secondary}
        aria-expanded={open} aria-controls={id + '-editor'} disabled={!available || waiting}
        onClick={() => setOpen(value => !value)}>修改時間或條件</button>
      {unresolved && <p className={styles.notice} role="status">有原操作仍待核對，請先使用原確認卡的核對流程；目前不會重新規劃。</p>}
      {!unresolved && !available && open && <p className={styles.notice} role="status">目前不能重新預覽這份安排，請先核對原確認卡與助理狀態。</p>}
      {open && <form id={id + '-editor'} className={styles.editor} aria-label="修改安排再預覽"
        aria-busy={submitting || undefined} onSubmit={event => { event.preventDefault(); void preview(); }}>
        <p className={styles.heading}>原提議內容</p>
        <ol className={styles.events} aria-label="原提議行程">
          {events.map((event, index) => <li key={index}>
            <strong>{event.title}</strong><span>{eventTime(event)}</span>
          </li>)}
        </ol>
        <p id={id + '-notice'} className={styles.hint}>重新預覽會先撤銷整份未執行提議，再依修改條件產生新卡；未要求修改的行程會一併保留。新卡仍需你確認，才會寫入行事曆。</p>
        <label htmlFor={id + '-instruction'}>修改條件</label>
        <textarea ref={field} id={id + '-instruction'} value={instruction} maxLength={300} rows={3}
          disabled={waiting} aria-describedby={id + '-notice ' + id + '-count'}
          placeholder="例如：第一項改成明晚 20:00，其他安排保持原樣"
          onChange={event => { setInstruction(event.target.value); setMessage(''); }} />
        <p id={id + '-count'} className={styles.hint}>{instruction.length}/300 字</p>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!available || waiting || !instruction.trim()}>
            {submitting ? '正在重新預覽…' : '重新預覽'}
          </button>
          <button type="button" className={styles.secondary} disabled={waiting}
            onClick={() => { setOpen(false); entry.current?.focus(); }}>收起修改</button>
        </div>
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
