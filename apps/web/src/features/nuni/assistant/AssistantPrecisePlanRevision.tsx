'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPlanProtection, type PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import type { PrecisePlanDraftContent } from '@/lib/assistantPrecisePlanDraft';
import { hasUnresolvedAssistantAction } from './planRevision';
import {
  buildPrecisePlanRevision, getPrecisePlanRevisionTargets, precisePlanTimeRange, samePrecisePlanEvent,
  type PrecisePlanRevisionChange, type PrecisePlanRevisionTarget,
} from './precisePlanRevision';
import type { V2ActionStates, V2Turn } from './types';
import styles from './AssistantPrecisePlanRevision.module.css';

export type PreciseRevisionDraftBridge = {
  status?: string;
  pendingRecovery?: boolean;
  recovery?: { id: string; match: 'exact' | 'fresh' | 'mismatch' | 'ambiguous' };
  onChange: (content: PrecisePlanDraftContent) => void;
  onReplace: (content: PrecisePlanDraftContent) => { ok: boolean; message?: string };
  onClear: () => { ok: boolean; message?: string };
  onApply: () => { ok: boolean; message?: string; content?: PrecisePlanDraftContent };
};

type Props = {
  turn: V2Turn;
  states: V2ActionStates;
  pending: boolean;
  enabled: boolean;
  draft?: PreciseRevisionDraftBridge;
  onPreview: (change: PrecisePlanRevisionChange) => Promise<{ ok: boolean; message: string }>;
};
type TimeFields = { date: string; endDate: string; startTime: string; endTime: string };
type Notice = { text: string; error: boolean } | null;
const initialFields = (target: PrecisePlanRevisionTarget): TimeFields => ({
  date: target.event.date, endDate: target.event.endDate ?? target.event.date,
  startTime: target.event.startTime, endTime: target.event.endTime,
});

function PreciseEditor({ turn, states, pending, enabled, onPreview, targets, draft }: Props & { targets: PrecisePlanRevisionTarget[] }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null), entry = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null), endTime = useRef<HTMLInputElement>(null);
  const mounted = useRef(false), busy = useRef(false), focusFrame = useRef<number | null>(null);
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false), [complete, setComplete] = useState(false);
  const [selected, setSelected] = useState(targets[0].mutationId);
  const [drafts, setDrafts] = useState<Record<string, TimeFields>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [draftNotice, setDraftNotice] = useState<Notice>(null);
  const [lastEditedIndex, setLastEditedIndex] = useState(targets[0].index);
  const target = targets.find(value => value.mutationId === selected)!;
  const fields = drafts[selected] ?? initialFields(target);
  const pristine = turn.reply.cards.every(card => states[card.mutationId] === undefined);
  const retryable = started && turn.reply.cards.every(card =>
    states[card.mutationId] === undefined || states[card.mutationId]?.status === 'cancelled');
  const unresolved = hasUnresolvedAssistantAction(states);
  const available = enabled && !unresolved && (pristine || retryable);
  const waiting = pending || submitting;
  const editedCount = Object.keys(drafts).length;
  const matchingRecovery = draft?.recovery?.match === 'exact' || draft?.recovery?.match === 'fresh';
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useEffect(() => { if (open) select.current?.focus(); }, [open]);

  function content(nextDrafts = drafts, selectedIndex = lastEditedIndex): PrecisePlanDraftContent {
    return { selectedIndex, edits: targets.flatMap(value => nextDrafts[value.mutationId]
      ? [{ index: value.index, ...nextDrafts[value.mutationId] }] : []) };
  }
  function changeField(field: keyof TimeFields, value: string) {
    if (waiting || busy.current || complete) return;
    const next = { ...drafts, [selected]: { ...fields, [field]: value } };
    const original = initialFields(target);
    if ((Object.keys(original) as (keyof TimeFields)[]).every(key => next[selected][key] === original[key])) delete next[selected];
    setDrafts(next);
    setLastEditedIndex(target.index);
    setNotice(null);
    setDraftNotice(null);
    // Save raw editing content only on actual field changes, never on reads or selection.
    if (draft && available) {
      try { draft.onChange(content(next, target.index)); }
      catch { setDraftNotice({ error: true, text: '時間欄位尚未確認暫存，目前輸入仍保留；請勿重新載入此頁。' }); }
    }
  }
  function clearDraft() {
    if (!draft || waiting || busy.current) return;
    try {
      const result = draft.onClear();
      if (!result.ok) {
        setDraftNotice({ error: true, text: result.message || '時間草稿尚未確認清除，目前時間欄位仍保留。' });
        return;
      }
      setDrafts({});
      setSelected(targets[0].mutationId);
      setLastEditedIndex(targets[0].index);
      setNotice(null);
      setDraftNotice({ error: false, text: result.message || '時間草稿已清除，欄位回到原提議；文字草稿與確認卡未變更。' });
      select.current?.focus();
    } catch { setDraftNotice({ error: true, text: '時間草稿尚未確認清除，目前時間欄位仍保留。' }); }
  }
  function replaceDraft() {
    if (!draft || !available || waiting || busy.current || !editedCount) return;
    try {
      const result = draft.onReplace(content());
      setDraftNotice({ error: !result.ok, text: result.message || (result.ok
        ? '已改存目前時間欄位，先前時間草稿已取代；文字草稿未變更。'
        : '目前時間欄位尚未確認儲存，先前草稿與目前輸入仍需保留。') });
    } catch { setDraftNotice({ error: true, text: '目前時間欄位尚未確認儲存，請保留此頁。' }); }
  }
  function applyDraft() {
    if (!draft?.recovery || !matchingRecovery || !available || waiting || busy.current) return;
    try {
      const result = draft.onApply();
      if (!result.ok || !result.content) {
        setDraftNotice({ error: true, text: result.message || '時間草稿尚未套用，目前欄位仍保留。' });
        return;
      }
      const restored = result.content, selectedTarget = targets.find(value => value.index === restored.selectedIndex);
      const next: Record<string, TimeFields> = {};
      if (!selectedTarget || !Array.isArray(restored.edits)) throw new Error();
      for (const edit of restored.edits) {
        const match = targets.find(value => value.index === edit.index);
        if (!match || next[match.mutationId] ||
          [edit.date, edit.endDate, edit.startTime, edit.endTime].some(value => typeof value !== 'string')) throw new Error();
        next[match.mutationId] = { date: edit.date, endDate: edit.endDate, startTime: edit.startTime, endTime: edit.endTime };
      }
      setDrafts(next);
      setSelected(selectedTarget.mutationId);
      setLastEditedIndex(restored.selectedIndex);
      setNotice(null);
      setDraftNotice({ error: false, text: result.message || '時間草稿已帶入，尚未預覽或送出；請核對選取項目與時間。' });
      select.current?.focus();
    } catch { setDraftNotice({ error: true, text: '時間草稿無法完整核對，目前時間欄位仍保留。' }); }
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
        {draft && <div className={styles.draftInfo}>
          <p className={styles.hint}>本分頁會分開暫存時間草稿與文字草稿，30 分鐘內可恢復。只有編輯時間欄位或明確改存時才更新暫存期限。</p>
          {draft.status && draft.status !== draftNotice?.text && <p className={styles.notice} role="status">{draft.status}</p>}
          {draft.recovery && <>
            <p className={styles.hint}>{draft.recovery.match === 'exact'
              ? '已核對為同一份來源，可手動帶回時間欄位。'
              : draft.recovery.match === 'fresh'
                ? '目前提議的完整內容與順序逐欄相同，且可唯一對應；可手動帶回時間欄位。'
                : draft.recovery.match === 'ambiguous'
                  ? '新提議含有完全相同的行程，無法唯一對應時間草稿；請核對草稿並重新選擇、填寫要調整的項目。'
                  : '目前提議的內容或順序已變更，不能直接套用時間草稿；請核對草稿並重新選擇、填寫要調整的項目。'}</p>
            {matchingRecovery && <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={!available || waiting} onClick={applyDraft}>
                {editedCount ? '以恢復草稿取代目前時間欄位' : '套用已恢復的時間草稿'}
              </button>
              {editedCount > 0 && <button type="button" className={styles.secondary} disabled={waiting}
                onClick={() => setDraftNotice({ error: false, text: '已保留目前時間欄位，沒有套用恢復草稿；先前草稿仍保留。' })}>保留目前時間欄位</button>}
            </div>}
          </>}
          {draft.pendingRecovery && editedCount > 0 && <>
            <p className={styles.hint}>本分頁另有時間草稿。改存目前時間欄位會取代先前時間草稿，不影響文字草稿。</p>
            <button type="button" className={styles.secondary} disabled={!available || waiting} onClick={replaceDraft}>改存目前時間欄位</button>
          </>}
        </div>}
        <label htmlFor={id + '-target'}>要調整的行程</label>
        <select ref={select} id={id + '-target'} value={selected} disabled={waiting}
          aria-describedby={id + '-original ' + id + '-scope'}
          onChange={event => { setSelected(event.target.value); setNotice(null); }}>
          {targets.map(value => <option key={value.mutationId} value={value.mutationId}>{value.label}</option>)}
        </select>
        <p id={id + '-original'} className={styles.original}>原提議：{target.label}</p>
        <p id={id + '-scope'} className={styles.hint}>只調整選取項目的時間，名稱與全天設定不變，其餘行程逐欄保持原樣。</p>
        {editedCount > 1 && <p className={styles.notice}>目前有 {editedCount} 項時間欄位尚未送出；這次只預覽選取項目，其餘已編輯時間不會套用。送出操作前會清除這份原提議的暫存草稿；若要調整其他項目，請在新提議重新填寫。</p>}
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
          {draft && <button type="button" className={styles.secondary} disabled={waiting} onClick={clearDraft}>清除時間草稿</button>}
        </div>
        {draftNotice && <p className={styles.notice} role={draftNotice.error ? 'alert' : 'status'}>{draftNotice.text}</p>}
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
