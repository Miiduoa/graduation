'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPlanProtection, type PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import { hasUnresolvedAssistantAction } from './planRevision';
import {
  buildPrecisePlanRevision, getPrecisePlanRevisionTargets, precisePlanTimeRange, samePrecisePlanEvent,
  type PrecisePlanRevisionChange, type PrecisePlanRevisionTarget,
} from './precisePlanRevision';
import type { V2ActionStates, V2Turn } from './types';
import styles from './AssistantPrecisePlanRevision.module.css';

type Props = {
  turn: V2Turn;
  states: V2ActionStates;
  pending: boolean;
  enabled: boolean;
  onPreview: (change: PrecisePlanRevisionChange) => Promise<{ ok: boolean; message: string }>;
};
type TimeFields = { date: string; endDate: string; startTime: string; endTime: string };
type Notice = { text: string; error: boolean } | null;
const initialFields = (target: PrecisePlanRevisionTarget): TimeFields => ({
  date: target.event.date, endDate: target.event.endDate ?? target.event.date,
  startTime: target.event.startTime, endTime: target.event.endTime,
});

function PreciseEditor({ turn, states, pending, enabled, onPreview, targets }: Props & { targets: PrecisePlanRevisionTarget[] }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null), entry = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null), endTime = useRef<HTMLInputElement>(null);
  const mounted = useRef(false), busy = useRef(false), focusFrame = useRef<number | null>(null);
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false), [complete, setComplete] = useState(false);
  const [selected, setSelected] = useState(targets[0].mutationId);
  const [drafts, setDrafts] = useState<Record<string, TimeFields>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const target = targets.find(value => value.mutationId === selected)!;
  const fields = drafts[selected] ?? initialFields(target);
  const pristine = turn.reply.cards.every(card => states[card.mutationId] === undefined);
  const retryable = started && turn.reply.cards.every(card =>
    states[card.mutationId] === undefined || states[card.mutationId]?.status === 'cancelled');
  const unresolved = hasUnresolvedAssistantAction(states);
  const available = enabled && !unresolved && (pristine || retryable);
  const waiting = pending || submitting;
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useEffect(() => { if (open) select.current?.focus(); }, [open]);

  function changeField(field: keyof TimeFields, value: string) {
    setDrafts(previous => ({ ...previous, [selected]: { ...(previous[selected] ?? initialFields(target)), [field]: value } }));
    setNotice(null);
  }
  function close() {
    setOpen(false);
    if (entry.current && !entry.current.disabled) entry.current.focus();
    else panel.current?.focus();
  }
  function revealFocusedControl(target: EventTarget) {
    if (!(target instanceof HTMLElement) || !target.matches('button, input, select')) return;
    if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      focusFrame.current = null;
      if (!mounted.current || document.activeElement !== target || !panel.current?.contains(target)) return;
      const style = window.getComputedStyle(target), bounds = target.getBoundingClientRect();
      const top = window.visualViewport?.offsetTop ?? 0;
      const bottom = top + (window.visualViewport?.height ?? window.innerHeight);
      if (bounds.bottom > bottom - (Number.parseFloat(style.scrollMarginBlockEnd) || 0))
        target.scrollIntoView?.({ block: 'end', inline: 'nearest', behavior: 'instant' });
      else if (bounds.top < top + (Number.parseFloat(style.scrollMarginBlockStart) || 0))
        target.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'instant' });
    });
  }
  async function preview() {
    if (!available || waiting || busy.current || complete) return;
    const change: PrecisePlanRevisionChange = { mutationId: selected, ...fields };
    try {
      const candidate = buildPrecisePlanRevision(turn, change);
      if (!candidate.changed) {
        const revoked = turn.reply.cards.some(card => states[card.mutationId]?.status === 'cancelled');
        setNotice({ error: false, text: revoked
          ? '時間與原提議相同，這次沒有送出新預覽。原提議已有項目撤銷，不會恢復舊確認卡。'
          : '時間沒有變更，原提議保持原狀；這次沒有送出預覽。' });
        return;
      }
    } catch (cause) {
      setNotice({ error: true, text: cause instanceof Error ? cause.message : '請確認日期與時間後再試。' });
      endTime.current?.focus();
      return;
    }
    busy.current = true;
    setStarted(true);
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await onPreview(change);
      if (!mounted.current) return;
      setNotice({ error: !result.ok, text: result.message || (result.ok
        ? '新的時間提議已備妥，請核對確認卡。' : '時間調整尚未完成，欄位已保留，請調整後再試。') });
      if (result.ok) setComplete(true);
    } catch (cause) {
      if (mounted.current) setNotice({ error: true, text: cause instanceof Error ? cause.message : '時間調整尚未完成，欄位已保留。' });
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  if (!open && !started && !pristine) return null;
  return <section ref={panel} tabIndex={-1} className={styles.panel} aria-label="精確時間調整"
    onFocusCapture={event => revealFocusedControl(event.target)}>
    {complete ? <p role="status" className={styles.notice}>{notice?.text}</p> : <>
      <button ref={entry} type="button" className={styles.secondary} aria-expanded={open}
        aria-controls={id + '-form'} disabled={!available || waiting} onClick={() => setOpen(value => !value)}>
        精確調整時間
      </button>
      {unresolved && <p role="status" className={styles.notice}>有操作尚未核對，請先使用原確認卡的核對流程；目前不能預覽時間調整。</p>}
      {!unresolved && !available && open && <p role="status" className={styles.notice}>目前不能預覽這份時間調整，請依原確認卡與登入狀態核對。</p>}
      {open && <form id={id + '-form'} className={styles.editor} aria-label="精確調整行程時間"
        aria-busy={submitting || undefined} noValidate onSubmit={event => { event.preventDefault(); void preview(); }}>
        <label htmlFor={id + '-target'}>要調整的行程</label>
        <select ref={select} id={id + '-target'} value={selected} disabled={waiting}
          aria-describedby={id + '-original ' + id + '-scope'}
          onChange={event => { setSelected(event.target.value); setNotice(null); }}>
          {targets.map(value => <option key={value.mutationId} value={value.mutationId}>{value.label}</option>)}
        </select>
        <p id={id + '-original'} className={styles.original}>原提議：{target.label}</p>
        <p id={id + '-scope'} className={styles.hint}>只調整選取項目的時間，名稱與全天設定不變，其餘行程逐欄保持原樣。</p>
        <p id={id + '-zone'} className={styles.hint}>所有日期與時間皆為台灣時間（UTC+8）。跨日請填寫實際結束日期，開始與結束日期最多相隔 31 天。</p>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={id + '-date'}>開始日期</label>
            <input id={id + '-date'} type="date" required value={fields.date} disabled={waiting}
              aria-describedby={id + '-zone'} onChange={event => changeField('date', event.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor={id + '-start'}>開始時間</label>
            <input id={id + '-start'} type="time" required step={60} value={fields.startTime} disabled={waiting}
              aria-describedby={id + '-zone'} onChange={event => changeField('startTime', event.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor={id + '-end-date'}>結束日期</label>
            <input id={id + '-end-date'} type="date" required value={fields.endDate} disabled={waiting}
              aria-describedby={id + '-zone'} onChange={event => changeField('endDate', event.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor={id + '-end'}>結束時間</label>
            <input ref={endTime} id={id + '-end'} type="time" required step={60} value={fields.endTime} disabled={waiting}
              aria-describedby={id + '-zone'} onChange={event => changeField('endTime', event.target.value)} />
          </div>
        </div>
        <p className={styles.hint}>這項操作不會把內容送給模型。預覽前會先撤銷整批舊提議，再核對衝突並產生新確認卡；仍需逐張手動確認才會寫入行事曆。</p>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!available || waiting}>
            {submitting ? '正在預覽時間調整…' : '預覽時間調整'}
          </button>
          <button type="button" className={styles.secondary} disabled={waiting} onClick={close}>收起時間調整</button>
        </div>
        {notice && <p className={styles.notice} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      </form>}
    </>}
  </section>;
}

export function AssistantPrecisePlanRevision(props: Props) {
  let targets: PrecisePlanRevisionTarget[];
  try { targets = getPrecisePlanRevisionTargets(props.turn); }
  catch { return null; }
  if (!targets.length) return null;
  // A changed proposal gets its own fields; a late result cannot affect another plan.
  const key = JSON.stringify(props.turn.reply.cards.map(card => [card.mutationId, card.schoolId, card.args]));
  return <PreciseEditor key={key} {...props} targets={targets} />;
}

/** The owner has an exact authenticated target index; never infer pairing by name. */
export function AssistantPrecisePlanComparison({ before, after, index }: {
  before: PlanProtectionEvent[]; after: PlanProtectionEvent[]; index: number;
}) {
  const id = useId();
  let original: PlanProtectionEvent[], next: PlanProtectionEvent[];
  try {
    original = createPlanProtection(before, []).originalEvents;
    next = createPlanProtection(after, []).originalEvents;
    if (original.length !== next.length || !Number.isInteger(index) || index < 0 || index >= original.length ||
      original[index].allDay || next[index].allDay || original[index].title !== next[index].title ||
      original.some((event, position) => position !== index && !samePrecisePlanEvent(event, next[position])) ||
      samePrecisePlanEvent(original[index], next[index])) return null;
  } catch { return null; }
  return <section className={styles.comparison} aria-labelledby={id + '-heading'}>
    <h3 id={id + '-heading'}>時間調整摘要</h3>
    <p className={styles.original}>第 {index + 1} 項 · {original[index].title}</p>
    <dl className={styles.ranges}>
      <div><dt>原時段</dt><dd>{precisePlanTimeRange(original[index])}</dd></div>
      <div><dt>新時段</dt><dd>{precisePlanTimeRange(next[index])}</dd></div>
    </dl>
    <p className={styles.hint}>台灣時間（UTC+8）{original.length > 1 ? `；其餘 ${original.length - 1} 項行程內容保持不變。` : '。'}</p>
    <p className={styles.hint}>以上是這次時間調整的提議內容；是否已寫入，請依確認卡的結果核對。</p>
  </section>;
}
