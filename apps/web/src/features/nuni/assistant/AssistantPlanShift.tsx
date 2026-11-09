'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { buildPlanShift } from '@/lib/assistantPlanShift';
import type { ShiftPlanDraftContent } from '@/lib/assistantShiftPlanDraft';
import { createPlanProtection, type PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import { hasUnresolvedAssistantAction } from './planRevision';
import { getPlanSelectionTargets, planSelectionEventTime, type PlanSelectionTarget } from './planSelection';
import { samePrecisePlanEvent } from './precisePlanRevision';
import { buildShiftPlanRevision, type PlanShiftChange } from './shiftPlanRevision';
import type { V2ActionStates, V2Turn } from './types';
import styles from './AssistantPlanShift.module.css';

export type ShiftPlanDraftBridge = {
  status?: string;
  pendingRecovery?: boolean;
  recovery?: { id: string; match: 'exact' | 'reselect' };
  onChange: (content: ShiftPlanDraftContent) => void;
  onReplace: (content: ShiftPlanDraftContent) => { ok: boolean; message?: string };
  onClear: () => { ok: boolean; message?: string };
  onApply: () => { ok: boolean; message?: string; content?: ShiftPlanDraftContent };
};

type Props = {
  turn: V2Turn;
  states: V2ActionStates;
  pending: boolean;
  enabled: boolean;
  protectedIndices: number[];
  draft?: ShiftPlanDraftBridge;
  onReleaseProtection?: (index: number) => void;
  onPreview: (change: PlanShiftChange) => Promise<{ ok: boolean; message: string }>;
};
type Notice = { text: string; error: boolean } | null;

function ShiftEditor({ turn, states, pending, enabled, protectedIndices, onReleaseProtection, onPreview, targets, draft }: Props & { targets: PlanSelectionTarget[] }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null), entry = useRef<HTMLButtonElement>(null);
  const directionField = useRef<HTMLSelectElement>(null), minutesField = useRef<HTMLInputElement>(null);
  const mounted = useRef(false), busy = useRef(false), focusFrame = useRef<number | null>(null);
  const releaseFocus = useRef<{ index: number; button: HTMLButtonElement } | null>(null);
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false), [complete, setComplete] = useState(false);
  const [direction, setDirection] = useState<'later' | 'earlier'>('later'), [minutes, setMinutes] = useState('30');
  const locked = new Set(protectedIndices), lockKey = [...locked].sort((left, right) => left - right).join(',');
  const allowed = targets.filter(target => !target.event.allDay && !locked.has(target.index));
  const [selection, setSelection] = useState(() => ({ lockKey, ids: allowed.map(target => target.mutationId) }));
  const [notice, setNotice] = useState<Notice>(null);
  const [draftNotice, setDraftNotice] = useState<Notice>(null);
  const [hasLocalInput, setHasLocalInput] = useState(false);
  const openedOnce = useRef(false);
  // A newly locked row is removed permanently from this local selection. Unlocking
  // never restores it automatically, even before an effect has had time to run.
  if (selection.lockKey !== lockKey) {
    setSelection({ lockKey, ids: selection.ids.filter(value => allowed.some(target => target.mutationId === value)) });
    setNotice({ error: false, text: '保留原樣設定已變更，鎖定項目不會平移；解除保留後也須重新勾選。' });
  }
  const selected = allowed.filter(target => selection.ids.includes(target.mutationId)).map(target => target.mutationId);
  const pristine = targets.every(target => states[target.mutationId] === undefined);
  const retryable = started && targets.every(target =>
    states[target.mutationId] === undefined || states[target.mutationId]?.status === 'cancelled');
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
  useEffect(() => { if (open) directionField.current?.focus(); }, [open]);
  useLayoutEffect(() => {
    const released = releaseFocus.current;
    if (!released) return;
    releaseFocus.current = null;
    if (lockKey.split(',').includes(String(released.index))) return;
    const stillAtRelease = document.activeElement === released.button ||
      (!released.button.isConnected && document.activeElement === document.body);
    if (!stillAtRelease) return;
    const checkbox = panel.current?.querySelector<HTMLInputElement>(`input[data-shift-index="${released.index}"]`);
    if (checkbox && !checkbox.disabled) checkbox.focus();
    else directionField.current?.focus();
    // Focus follows only this explicit release when its lock state changes.
  }, [lockKey]);

  function content(ids = selected, nextDirection = direction, nextMinutes = minutes): ShiftPlanDraftContent {
    return { mode: 'shift', direction: nextDirection, minutes: nextMinutes,
      selectedIndices: targets.filter(target => ids.includes(target.mutationId) && !target.event.allDay && !locked.has(target.index))
        .map(target => target.index), protectedIndices: [...locked].sort((left, right) => left - right) };
  }
  function saveContent(value: ShiftPlanDraftContent) {
    if (!draft || !available || waiting || busy.current || complete) return;
    try { draft.onChange(value); }
    catch { setDraftNotice({ error: true, text: '平移設定尚未確認暫存，目前輸入仍保留；請勿重新載入此頁。' }); }
  }
  function toggleEditor() {
    if (!available || waiting || busy.current || complete) return;
    if (!open && !openedOnce.current) {
      openedOnce.current = true;
      saveContent(content());
    }
    setOpen(value => !value);
  }
  function toggle(mutationId: string, checked: boolean) {
    if (waiting || busy.current || complete || !allowed.some(target => target.mutationId === mutationId)) return;
    const ids = allowed.filter(target => target.mutationId === mutationId ? checked : selected.includes(target.mutationId))
      .map(target => target.mutationId);
    setSelection({ lockKey, ids });
    setHasLocalInput(true);
    setNotice(null); setDraftNotice(null);
    saveContent(content(ids));
  }
  function clearDraft() {
    if (!draft || waiting || busy.current) return;
    try {
      const result = draft.onClear();
      if (!result.ok) {
        setDraftNotice({ error: true, text: result.message || '平移草稿尚未確認清除，目前設定仍保留。' });
        return;
      }
      setDirection('later'); setMinutes('30'); setSelection({ lockKey, ids: [] });
      setHasLocalInput(false); setNotice(null);
      setDraftNotice({ error: false, text: result.message || '平移草稿已清除，請重新勾選項目；其他草稿與保留原樣設定未變更。' });
      directionField.current?.focus();
    } catch { setDraftNotice({ error: true, text: '平移草稿尚未確認清除，目前設定仍保留。' }); }
  }
  function replaceDraft() {
    if (!draft || !available || waiting || busy.current || complete) return;
    try {
      const result = draft.onReplace(content());
      setDraftNotice({ error: !result.ok, text: result.message || (result.ok
        ? '已改存目前平移設定，先前平移草稿已取代；其他草稿未變更。'
        : '目前平移設定尚未確認暫存，請保留此頁。') });
    } catch { setDraftNotice({ error: true, text: '目前平移設定尚未確認暫存，請保留此頁。' }); }
  }
  function applyDraft() {
    if (!draft?.recovery || !available || waiting || busy.current || complete) return;
    try {
      const result = draft.onApply();
      if (!result.ok || !result.content) {
        setDraftNotice({ error: true, text: result.message || '平移草稿尚未套用，目前設定仍保留。' });
        return;
      }
      const value = result.content;
      if (value.mode !== 'shift' || !['later', 'earlier'].includes(value.direction) || typeof value.minutes !== 'string' ||
        !Array.isArray(value.selectedIndices) || !Array.isArray(value.protectedIndices) ||
        value.selectedIndices.length > targets.length || new Set(value.selectedIndices).size !== value.selectedIndices.length ||
        new Set(value.protectedIndices).size !== value.protectedIndices.length ||
        value.protectedIndices.length !== locked.size || value.protectedIndices.some(index => !locked.has(index)) ||
        value.selectedIndices.some(index => !Number.isInteger(index) || !targets[index] || targets[index].event.allDay || locked.has(index)) ||
        (draft.recovery.match === 'reselect' && value.selectedIndices.length !== 0)) throw new Error();
      const ids = targets.filter(target => value.selectedIndices.includes(target.index)).map(target => target.mutationId);
      setDirection(value.direction); setMinutes(value.minutes); setSelection({ lockKey, ids });
      setHasLocalInput(true); setNotice(null);
      setDraftNotice({ error: false, text: result.message || (draft.recovery.match === 'exact'
        ? '平移草稿已帶入，尚未預覽或送出；請核對選取項目。'
        : '已帶入方向與分鐘；來源或保留設定不同，請重新勾選要平移的項目。') });
      directionField.current?.focus();
    } catch { setDraftNotice({ error: true, text: '平移草稿無法完整核對，目前設定仍保留。' }); }
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
    let change: PlanShiftChange;
    try {
      const amount = Number(minutes);
      if (!/^\d+$/.test(minutes) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1440)
        throw new Error('請填寫 1 到 1440 之間的整數分鐘。');
      change = { mutationIds: selected, offsetMinutes: direction === 'earlier' ? -amount : amount };
      buildShiftPlanRevision(turn, change, protectedIndices);
    } catch (cause) {
      setNotice({ error: true, text: cause instanceof Error ? cause.message : '整份時間調整無法核對，請確認選取項目與分鐘數。' });
      minutesField.current?.focus();
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
        ? '整組時間的新提議已備妥，請核對新的確認卡。'
        : '整組時間調整尚未完成，選取項目與分鐘數已保留。') });
      if (result.ok) setComplete(true);
    } catch (cause) {
      if (mounted.current) setNotice({ error: true, text: cause instanceof Error ? cause.message : '整組時間調整尚未完成，目前輸入仍保留。' });
    } finally {
      busy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  if (!open && !started && !pristine) return null;
  return <section ref={panel} tabIndex={-1} className={styles.panel} aria-label="整組時間調整"
    onFocusCapture={event => revealFocusedControl(event.target)}>
    {complete ? <p role="status" className={styles.notice}>{notice?.text}</p> : <>
      <button ref={entry} type="button" className={styles.secondary} aria-expanded={open} aria-controls={id + '-form'}
        disabled={!available || waiting} onClick={toggleEditor}>整組調整時間</button>
      {unresolved && <p role="status" className={styles.notice}>有操作尚未核對，請先使用原確認卡的核對流程；目前不能預覽整組時間。</p>}
      {!unresolved && !available && open && <p role="status" className={styles.notice}>目前不能調整這份提議，請依原確認卡與登入狀態核對。</p>}
      {open && <form id={id + '-form'} className={styles.editor} aria-label="整組調整待確認時間" noValidate
        aria-busy={submitting || undefined} onSubmit={event => { event.preventDefault(); void preview(); }}>
        {draft && <div className={styles.draftInfo}>
          <p className={styles.hint}>本分頁會分開暫存平移、精確時間與文字草稿，30 分鐘內可恢復。恢復只帶回設定，不會授權或送出行程操作。</p>
          {draft.status && draft.status !== draftNotice?.text && <p className={styles.notice} role="status">{draft.status}</p>}
          {draft.recovery && <>
            <p className={styles.hint}>{draft.recovery.match === 'exact'
              ? '來源與保留原樣設定均相同，可手動帶回原選取項目。'
              : '來源、順序或保留原樣設定不同，只帶回方向與分鐘；原選取與保留項目不會自動套用，須重新勾選。'}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={!available || waiting} onClick={applyDraft}>
                {hasLocalInput ? '以恢復草稿取代目前平移設定' : '套用已恢復的平移草稿'}
              </button>
              {hasLocalInput && <button type="button" className={styles.secondary} disabled={waiting}
                onClick={() => setDraftNotice({ error: false, text: '已保留目前平移設定，沒有套用恢復草稿；先前平移草稿仍保留。' })}>保留目前平移設定</button>}
            </div>
          </>}
          {draft.pendingRecovery && <>
            <p className={styles.hint}>本分頁另有平移草稿。改存目前設定會取代先前平移草稿，不影響其他模式的草稿。</p>
            <button type="button" className={styles.secondary} disabled={!available || waiting} onClick={replaceDraft}>改存目前平移設定</button>
          </>}
        </div>}
        <p id={id + '-scope'} className={styles.hint}>所選項目會等量平移，保留各自時長、彼此間隔與原卡順序；未選項目固定不動，因此與未選項目之間的間隔可能改變。</p>
        <p className={styles.hint}>日期與時間皆為台灣時間（UTC+8）。全天或已保留原樣的項目不能平移；解除保留後須自行勾選。</p>
        <fieldset className={styles.fieldset} aria-describedby={id + '-scope'}>
          <legend>選擇要平移的行程</legend>
          <ol className={styles.choices} aria-label="整組平移項目">
            {targets.map(target => {
              const isLocked = locked.has(target.index), disabled = isLocked || target.event.allDay;
              const reasonId = `${id}-reason-${target.index}`;
              return <li key={target.mutationId}>
                <label className={styles.choice}>
                  <input type="checkbox" data-shift-index={target.index} checked={selected.includes(target.mutationId)} disabled={waiting || disabled}
                    aria-describedby={disabled ? reasonId : undefined} onChange={event => toggle(target.mutationId, event.target.checked)} />
                  <span>平移 {target.label}</span>
                </label>
                {disabled && <p id={reasonId} className={styles.hint}>{target.event.allDay ? '全天項目不能平移時間。' : ''}{isLocked ? '保留原樣，本次不平移。' : ''}</p>}
                {isLocked && onReleaseProtection && <button type="button" className={styles.secondary}
                  disabled={!available || waiting} aria-describedby={reasonId}
                  onClick={event => {
                    if (!available || waiting || busy.current) return;
                    releaseFocus.current = document.activeElement === event.currentTarget ? { index: target.index, button: event.currentTarget } : null;
                    onReleaseProtection(target.index);
                  }}>
                  解除第 {target.index + 1} 項的保留
                </button>}
              </li>;
            })}
          </ol>
        </fieldset>
        <div className={styles.fields}>
          <div className={styles.field}>
            <label htmlFor={id + '-direction'}>調整方向</label>
            <select ref={directionField} id={id + '-direction'} value={direction} disabled={waiting}
              onChange={event => {
                if (waiting || busy.current || !['later', 'earlier'].includes(event.target.value)) return;
                const value = event.target.value as 'later' | 'earlier';
                setDirection(value); setHasLocalInput(true); setNotice(null); setDraftNotice(null); saveContent(content(selected, value));
              }}><option value="later">延後</option><option value="earlier">提前</option></select>
          </div>
          <div className={styles.field}>
            <label htmlFor={id + '-minutes'}>調整分鐘數</label>
            <input ref={minutesField} id={id + '-minutes'} type="number" inputMode="numeric" min={1} max={1440} step={1}
              required value={minutes} disabled={waiting} aria-describedby={id + '-limits'}
              onChange={event => {
                if (waiting || busy.current) return;
                const value = event.target.value;
                setMinutes(value); setHasLocalInput(true); setNotice(null); setDraftNotice(null); saveContent(content(selected, direction, value));
              }} />
          </div>
        </div>
        {minutes.trim() && !/^\d+$/.test(minutes) && <p className={styles.hint}>草稿分鐘原值：<span style={{ whiteSpace: 'pre-wrap' }}>{minutes}</span>。請填寫有效整數後再預覽。</p>}
        <p id={id + '-limits'} className={styles.hint}>每次可提前或延後 1–1440 分鐘。整份安排通過日期與時間驗證後，才會送出預覽。</p>
        <p className={styles.notice} role="status">已選 {selected.length} 項平移，其餘 {targets.length - selected.length} 項內容保持原樣。</p>
        {!selected.length && <p className={styles.hint}>請至少勾選一項可平移的行程。</p>}
        <p className={styles.hint}>這項調整不會送給模型。預覽前會先撤銷整份舊提議，再核對衝突並重新產生確認卡；預覽不會寫入行程，仍需逐張手動確認。</p>
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!available || waiting || !selected.length}>
            {submitting ? '正在預覽整組時間…' : '預覽整組時間'}
          </button>
          <button type="button" className={styles.secondary} disabled={waiting} onClick={close}>收起整組調整</button>
          {draft && <button type="button" className={styles.secondary} disabled={waiting} onClick={clearDraft}>清除平移草稿</button>}
        </div>
        {draftNotice && <p role={draftNotice.error ? 'alert' : 'status'} className={styles.notice}>{draftNotice.text}</p>}
        {notice && <p role={notice.error ? 'alert' : 'status'} className={styles.notice}>{notice.text}</p>}
      </form>}
    </>}
  </section>;
}

export function AssistantPlanShift(props: Props) {
  let targets: PlanSelectionTarget[];
  try {
    targets = getPlanSelectionTargets(props.turn);
    if (!Array.isArray(props.protectedIndices) || new Set(props.protectedIndices).size !== props.protectedIndices.length ||
      props.protectedIndices.some(index => !Number.isInteger(index) || index < 0 || index >= targets.length)) return null;
  } catch { return null; }
  const key = JSON.stringify(targets.map(target => [target.mutationId, props.turn.reply.cards[target.index].schoolId, target.event]));
  return <ShiftEditor key={key} {...props} targets={targets} />;
}

/** Compare an exact deterministic translation, never infer pairing from titles. */
export function AssistantPlanShiftComparison({ before, after, selectedIndices, offsetMinutes }: {
  before: PlanProtectionEvent[]; after: PlanProtectionEvent[]; selectedIndices: number[]; offsetMinutes: number;
}) {
  const id = useId();
  let result: ReturnType<typeof buildPlanShift>;
  try {
    result = buildPlanShift(before, selectedIndices, offsetMinutes, []);
    const actual = createPlanProtection(after, []).originalEvents;
    if (actual.length !== result.after.length || actual.some((event, index) => !samePrecisePlanEvent(event, result.after[index]))) return null;
  } catch { return null; }
  const unchanged = result.before.length - result.selectedIndices.length;
  return <section className={styles.comparison} aria-labelledby={id + '-heading'}>
    <h3 id={id + '-heading'}>整組時間調整摘要</h3>
    <p className={styles.hint}>{result.selectedIndices.length} 項{offsetMinutes > 0 ? '延後' : '提前'} {Math.abs(offsetMinutes)} 分鐘；所選項目的時長、彼此間隔與原卡順序保持不變。</p>
    <ol className={styles.summaryList} aria-label="平移項目的時間差異">
      {result.selectedIndices.map(index => <li key={index}>
        <h4>第 {index + 1} 項 · {result.before[index].title}</h4>
        <dl className={styles.ranges}>
          <div><dt>原時段</dt><dd>{planSelectionEventTime(result.before[index])}</dd></div>
          <div><dt>新時段</dt><dd>{planSelectionEventTime(result.after[index])}</dd></div>
        </dl>
      </li>)}
    </ol>
    <p className={styles.hint}>台灣時間（UTC+8）。{unchanged > 0 ? `其餘 ${unchanged} 項內容保持原樣；與未移動項目的間隔可能改變。` : '所有項目均等量平移。'}</p>
    <p className={styles.hint}>以上是當次提議的時間差異；是否已建立，請依確認卡的結果核對。</p>
  </section>;
}
