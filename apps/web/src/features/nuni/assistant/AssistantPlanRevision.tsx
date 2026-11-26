'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

type TabPosition = {
  event: KeyboardEvent;
  visibleControls: Set<HTMLElement>;
  left: number;
  top: number;
  ancestors: { element: HTMLElement; left: number; top: number }[];
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

function focusGeometry(target: HTMLElement) {
  const style = window.getComputedStyle(target);
  // Native alignment reserves one extra CSS pixel for scroll-offset rounding.
  // Visibility still requires the original clearance, not that alignment buffer.
  const roundingBuffer = Math.max(0, Number.parseFloat(style.getPropertyValue('--assistant-focus-rounding-buffer')) || 0);
  const topMargin = Math.max(0, (Number.parseFloat(style.scrollMarginBlockStart) || 0) - roundingBuffer);
  const bottomMargin = Math.max(0, (Number.parseFloat(style.scrollMarginBlockEnd) || 0) - roundingBuffer);
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const left = viewport?.offsetLeft ?? 0;
  const height = viewport?.height ?? window.innerHeight;
  const width = viewport?.width ?? window.innerWidth;
  const bounds = target.getBoundingClientRect();
  const block = bounds.bottom > top + height - bottomMargin ? 'end' as const
    : bounds.top < top + topMargin ? 'start' as const : undefined;
  return { block,
    visible: !block && bounds.width > 0 && bounds.height > 0 && bounds.left >= left && bounds.right <= left + width };
}

function hasClippingOrScrollingAncestor(target: HTMLElement): boolean {
  for (let parent = target.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) return true;
  }
  return false;
}

function focusRevisionControl(target: HTMLElement | null) {
  if (!target) return;
  // The focus handler reveals document-level controls instantly. Nested scroll
  // containers still need native focus to reveal their clipped descendants.
  if (hasClippingOrScrollingAncestor(target)) target.focus();
  else target.focus({ preventScroll: true });
}

function PlanRevision({ turn, states, pending, enabled, onPreview, events, draft, protectedSelection, onProtectedSelectionChange }: Props & { events: PlanRevisionEvent[] }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const focusFrame = useRef<number | null>(null);
  const tabPosition = useRef<TabPosition | null>(null);
  const tabFrame = useRef<number | null>(null);
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
      if (tabFrame.current !== null) window.cancelAnimationFrame(tabFrame.current);
      focusFrame.current = null;
      tabFrame.current = null;
      tabPosition.current = null;
    };
  }, []);
  useEffect(() => { if (open) focusRevisionControl(field.current); }, [open]);
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

  function focusVisibleTabControl(event: ReactKeyboardEvent<HTMLElement>) {
    if (!mounted.current || event.key !== 'Tab' || event.nativeEvent.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const root = panel.current;
    const current = document.activeElement;
    if (!root || !(current instanceof HTMLElement) || current !== event.target || !root.contains(current)) return;
    const controls: HTMLElement[] = [];
    for (const target of root.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex], [contenteditable]')) {
      const style = window.getComputedStyle(target);
      if (target.matches(':disabled') || target.closest('[hidden], [inert]') || style.display === 'none' ||
        style.visibility === 'hidden' || style.visibility === 'collapse') continue;
      const bounds = target.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) continue;
      if (target.tabIndex < 0 && !target.matches('[contenteditable]:not([contenteditable="false"])')) continue;
      // Only this panel's ordinary native controls have a known DOM Tab order.
      // Positive tabindex, radios and custom stops keep the browser's behavior.
      if (target.tabIndex !== 0 || !target.matches('button, input[type="checkbox"], textarea')) return;
      controls.push(target);
    }
    const index = controls.indexOf(current);
    if (index < 0) return;
    const next = controls[index + (event.shiftKey ? -1 : 1)];
    if (!next || !focusGeometry(next).visible) return;
    // Inline threads can have their own clipping/scroller. Leave those to native
    // Tab rather than preventing a needed scroll of an ancestor.
    if (hasClippingOrScrollingAncestor(next)) return;
    event.preventDefault();
    // preventScroll blocks a new focus scroll, but not one already in flight.
    // Request cancellation at the current offset before transferring focus.
    window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' });
    next.focus({ preventScroll: true });
  }

  function clearTabPosition() {
    if (tabFrame.current !== null) window.cancelAnimationFrame(tabFrame.current);
    tabFrame.current = null;
    tabPosition.current = null;
  }

  function rememberTabPosition(event: ReactKeyboardEvent<HTMLElement>) {
    clearTabPosition();
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey ||
      event.nativeEvent.isComposing || event.defaultPrevented || !panel.current) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const left = viewport?.offsetLeft ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const visibleControls = new Set<HTMLElement>();
    panel.current.querySelectorAll<HTMLElement>('button, input, textarea').forEach(control => {
      const bounds = control.getBoundingClientRect();
      const style = window.getComputedStyle(control);
      if (bounds.width > 0 && bounds.height > 0 && bounds.left >= left && bounds.right <= right &&
        bounds.top >= top + (Number.parseFloat(style.scrollMarginBlockStart) || 0) &&
        bounds.bottom <= bottom - (Number.parseFloat(style.scrollMarginBlockEnd) || 0)) {
        visibleControls.add(control);
      }
    });
    if (!visibleControls.size) return;
    const ancestors: TabPosition['ancestors'] = [];
    for (let element = panel.current.parentElement; element && element !== document.scrollingElement;
      element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
        ancestors.push({ element, left: element.scrollLeft, top: element.scrollTop });
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
        const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        for (const control of visibleControls) {
          const box = control.getBoundingClientRect();
          if ((clipsX && (box.left < bounds.left + element.clientLeft ||
            box.right > bounds.left + element.clientLeft + element.clientWidth)) ||
            (clipsY && (box.top < bounds.top + element.clientTop ||
              box.bottom > bounds.top + element.clientTop + element.clientHeight))) {
            visibleControls.delete(control);
          }
        }
      }
    }
    if (!visibleControls.size) return;
    tabPosition.current = { event: event.nativeEvent, visibleControls,
      left: window.scrollX, top: window.scrollY, ancestors };
    // Native Tab changes focus in this event turn. A later pointer/programmatic
    // focus must not inherit an old keyboard reading position.
    tabFrame.current = window.requestAnimationFrame(() => {
      tabFrame.current = null;
      tabPosition.current = null;
    });
  }

  function revealFocusedControl(target: EventTarget) {
    if (!(target instanceof HTMLElement) || !target.matches('button, input, textarea')) return;
    const position = tabPosition.current;
    clearTabPosition();
    if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      focusFrame.current = null;
      if (!mounted.current || document.activeElement !== target || !panel.current?.contains(target)) return;
      // Native focus scrolling can race an earlier smooth reveal. Keep a control
      // that was already readable at the person's position before Tab; do not
      // change the browser's focus order or suppress its keyboard event.
      if (position && !position.event.defaultPrevented && position.visibleControls.has(target)) {
        for (const ancestor of position.ancestors) {
          if (ancestor.element.isConnected && ancestor.element.contains(target)) {
            ancestor.element.scrollTo({ left: ancestor.left, top: ancestor.top, behavior: 'instant' });
          }
        }
        window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' });
      }
      const geometry = focusGeometry(target);
      // Explicit alignment reveals controls hidden by the sticky dock even when
      // they are still inside the layout viewport and nearest would not move.
      if (geometry.block)
        target.scrollIntoView?.({ block: geometry.block, inline: 'nearest', behavior: 'instant' });
    });
  }

  function closeEditor() {
    setOpen(false);
    if (entry.current && !entry.current.disabled) focusRevisionControl(entry.current);
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
      focusRevisionControl(field.current);
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
      focusRevisionControl(field.current);
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
      focusRevisionControl(field.current);
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
  return <section ref={panel} tabIndex={-1} className={styles.panel} aria-label="修改行程提議" data-assistant-plan-revision="true"
    onKeyDown={focusVisibleTabControl}
    onKeyDownCapture={rememberTabPosition}
    onPointerDownCapture={clearTabPosition}
    onBlurCapture={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clearTabPosition();
    }}
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
