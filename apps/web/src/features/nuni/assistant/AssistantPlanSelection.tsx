'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPlanProtection, type PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import { hasUnresolvedAssistantAction } from './planRevision';
import { buildPlanSelection, getPlanSelectionTargets, planSelectionEventTime, type PlanSelectionTarget } from './planSelection';
import type { V2ActionStates, V2Turn } from './types';
import styles from './AssistantPlanSelection.module.css';

type Props = {
  turn: V2Turn;
  states: V2ActionStates;
  pending: boolean;
  enabled: boolean;
  onPreview: (keepMutationIds: string[]) => Promise<{ ok: boolean; message: string }>;
};
type Notice = { text: string; error: boolean } | null;

function PlanSelectionEditor({ turn, states, pending, enabled, onPreview, targets }: Props & { targets: PlanSelectionTarget[] }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null), entry = useRef<HTMLButtonElement>(null), first = useRef<HTMLInputElement>(null);
  const mounted = useRef(false), busy = useRef(false), focusFrame = useRef<number | null>(null);
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false), [complete, setComplete] = useState(false);
  const [kept, setKept] = useState(() => targets.map(target => target.mutationId));
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const pristine = targets.every(target => states[target.mutationId] === undefined);
  const retryable = started && targets.every(target =>
    states[target.mutationId] === undefined || states[target.mutationId]?.status === 'cancelled');
  const unresolved = hasUnresolvedAssistantAction(states);
  const available = enabled && !unresolved && (pristine || retryable);
  const waiting = pending || submitting;
  const allKept = kept.length === targets.length, noneKept = kept.length === 0;
  const hasRevoked = targets.some(target => states[target.mutationId]?.status === 'cancelled');
  const noChange = hasRevoked
    ? '目前選擇與原提議相同，這次不會送出新預覽。原提議已有項目撤銷，不會恢復舊確認卡。'
    : pristine ? '目前保留全部項目，不需重新預覽；原提議保持原狀。'
      : '目前選擇與原提議相同，這次不會送出新預覽；請依原確認卡的結果核對。';

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);

  function toggle(mutationId: string, checked: boolean) {
    if (waiting || busy.current || complete) return;
    setKept(previous => targets.filter(target => target.mutationId === mutationId ? checked : previous.includes(target.mutationId))
      .map(target => target.mutationId));
    setAcknowledged(false);
    setNotice(null);
  }
  function close() {
    setOpen(false);
    if (entry.current && !entry.current.disabled) entry.current.focus();
    else panel.current?.focus();
  }
  function revealFocusedControl(target: EventTarget) {
    if (!(target instanceof HTMLElement) || !target.matches('button, input, summary')) return;
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
    let selection;
    try { selection = buildPlanSelection(turn, kept); }
    catch (cause) {
      setNotice({ error: true, text: cause instanceof Error ? cause.message : '請重新核對要保留的行程。' });
      return;
    }
    if (!selection.changed) { setNotice({ error: false, text: noChange }); return; }
    if (selection.allExcluded && !acknowledged) {
      setNotice({ error: true, text: '請先確認不建立任何項目，再撤銷整份待確認提議。' });
      return;
    }
    busy.current = true;
    setStarted(true);
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await onPreview(selection.keepMutationIds);
      if (!mounted.current) return;
      setNotice({ error: !result.ok, text: result.message || (result.ok
        ? selection.allExcluded ? '整份待確認提議已撤銷，沒有建立或刪除既有行程。' : '所選行程的新確認卡已備妥，請逐張核對。'
        : '行程選擇尚未完成，勾選已保留；請先核對原操作結果再試。') });
      if (result.ok) setComplete(true);
    } catch (cause) {
      if (mounted.current) setNotice({ error: true, text: cause instanceof Error ? cause.message : '行程選擇尚未完成，勾選仍保留。' });
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  if (!open && !started && !pristine) return null;
  return <section ref={panel} tabIndex={-1} className={styles.panel} aria-label="選擇待建立的提議項目"
    onFocusCapture={event => revealFocusedControl(event.target)}>
    {complete ? <p role="status" className={styles.notice}>{notice?.text}</p> : <>
      <button ref={entry} type="button" className={styles.secondary} aria-expanded={open} aria-controls={id + '-form'}
        disabled={!available || waiting} onClick={() => setOpen(value => !value)}>選擇要建立的行程</button>
      {unresolved && <p role="status" className={styles.notice}>有操作尚未核對，請先使用原確認卡的核對流程；目前不能預覽選擇或撤銷整份提議。</p>}
      {!unresolved && !available && open && <p role="status" className={styles.notice}>目前不能變更這份提議，請依原確認卡與登入狀態核對。</p>}
      {open && <form id={id + '-form'} className={styles.editor} aria-label="選擇待建立行程" noValidate
        aria-busy={submitting || undefined} onSubmit={event => { event.preventDefault(); void preview(); }}>
        <p id={id + '-scope'} className={styles.hint}>排除只是不建立，不會刪除既有行程。勾選的項目會保留原本的名稱、日期、時間與全天設定。</p>
        <p className={styles.hint}>所有日期與時段皆為台灣時間（UTC+8）。</p>
        <fieldset className={styles.fieldset} aria-describedby={id + '-scope'}>
          <legend>勾選要建立的項目</legend>
          <ol className={styles.choices} aria-label="原提議行程選擇">
            {targets.map((target, index) => <li key={target.mutationId}>
              <label className={styles.choice}>
                <input ref={index === 0 ? first : undefined} type="checkbox" checked={kept.includes(target.mutationId)}
                  disabled={waiting} onChange={event => toggle(target.mutationId, event.target.checked)} />
                <span>保留 {target.label}</span>
              </label>
            </li>)}
          </ol>
        </fieldset>
        <p className={styles.notice} role="status">保留 {kept.length} 項，排除 {targets.length - kept.length} 項。</p>
        {allKept && <p className={styles.hint}>{noChange}</p>}
        {noneKept ? <div className={styles.cancelAll}>
          <p className={styles.hint}>目前沒有保留項目。確認後只撤銷整份待確認提議，不會產生新確認卡，也不會刪除既有行程。</p>
          <label className={styles.choice}>
            <input type="checkbox" checked={acknowledged} disabled={waiting}
              onChange={event => { setAcknowledged(event.target.checked); setNotice(null); }} />
            <span>我確認不建立任何項目，並撤銷整份待確認提議</span>
          </label>
        </div> : <p className={styles.hint}>這項選擇不會送給模型。預覽前會先撤銷整份舊提議，再為所選項目產生新確認卡；仍須逐張手動確認才會寫入行事曆。</p>}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!available || waiting || allKept || (noneKept && !acknowledged)}>
            {submitting ? noneKept ? '正在撤銷提議…' : '正在預覽所選行程…' : noneKept ? '撤銷整份待確認提議' : '預覽所選行程'}
          </button>
          <button type="button" className={styles.secondary} disabled={waiting} onClick={close}>收起行程選擇</button>
        </div>
        {notice && <p role={notice.error ? 'alert' : 'status'} className={styles.notice}>{notice.text}</p>}
      </form>}
    </>}
  </section>;
}

export function AssistantPlanSelection(props: Props) {
  let targets: PlanSelectionTarget[];
  try { targets = getPlanSelectionTargets(props.turn); }
  catch { return null; }
  const key = JSON.stringify(targets.map(target => [target.mutationId, props.turn.reply.cards[target.index].schoolId, target.event]));
  return <PlanSelectionEditor key={key} {...props} targets={targets} />;
}

/** The owner validates retained content against the signed response before presenting this summary. */
export function AssistantPlanSelectionComparison({ before, retainedIndices }: {
  before: PlanProtectionEvent[]; retainedIndices: readonly number[];
}) {
  const id = useId();
  let original: PlanProtectionEvent[], indices: Set<number>;
  try {
    original = createPlanProtection(before, []).originalEvents;
    if (!Array.isArray(retainedIndices) || retainedIndices.length > original.length) return null;
    indices = new Set<number>();
    for (let position = 0; position < retainedIndices.length; position++) {
      const descriptor = Object.getOwnPropertyDescriptor(retainedIndices, String(position));
      if (!descriptor || !('value' in descriptor)) return null;
      const index = descriptor.value;
      if (!Number.isInteger(index) || index < 0 || index >= original.length || indices.has(index)) return null;
      indices.add(index);
    }
  } catch { return null; }
  const kept = original.map((event, index) => ({ event, index })).filter(value => indices.has(value.index));
  const excluded = original.map((event, index) => ({ event, index })).filter(value => !indices.has(value.index));
  return <section className={styles.comparison} aria-labelledby={id + '-heading'}>
    <h3 id={id + '-heading'}>行程選擇摘要</h3>
    <p className={styles.hint}>保留 {kept.length} 項；排除 {excluded.length} 項。以下編號沿用原提議，日期與時段皆為台灣時間（UTC+8）。</p>
    <h4>保留項目 · 內容不變</h4>
    {kept.length ? <ol className={styles.summaryList} aria-label="保留的原提議行程">
      {kept.map(({ event, index }) => <li key={index}><strong>第 {index + 1} 項 · {event.title}</strong><span>{planSelectionEventTime(event)}</span></li>)}
    </ol> : <p className={styles.hint}>沒有保留項目。</p>}
    <h4>排除項目 · 本次不建立</h4>
    {excluded.length ? <ol className={styles.summaryList} aria-label="排除的原提議行程">
      {excluded.map(({ event, index }) => <li key={index}><strong>第 {index + 1} 項 · {event.title}</strong><span>{planSelectionEventTime(event)}</span></li>)}
    </ol> : <p className={styles.hint}>沒有排除項目。</p>}
    <p className={styles.hint}>保留項目的內容均保持原樣；是否已建立，請依新確認卡的結果核對。排除項目不會因這次提議而建立，也不會刪除既有行程。</p>
  </section>;
}
