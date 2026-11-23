import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  buildMonthCalendar,
  emptyPersonalEventDraft,
  MONTH_WEEKDAYS,
  type PersonalImportRecord,
} from '@campus/shared';
import { monthCalendarKeyboardDate } from './monthCalendarNavigation';
import styles from './MonthCalendar.module.css';

export function MonthCalendar({
  records,
  month,
  selectedDate,
  onDate,
  onEdit,
  onMonthChange,
  disabled,
}: {
  records: readonly PersonalImportRecord[];
  month: string;
  selectedDate: string;
  onDate: (date: string) => void;
  onEdit: (event: PersonalImportRecord, trigger?: HTMLButtonElement) => void;
  onMonthChange?: (month: string) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [focusState, setFocusState] = useState({ selection: selectedDate, date: selectedDate });
  const today = emptyPersonalEventDraft().date;
  const descriptionId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ date: string; origin: HTMLButtonElement } | null>(null);
  const days = useMemo(() => buildMonthCalendar(records, month), [records, month]);
  // External selection (for example “Today”) updates the next tab stop, never the active focus.
  if (focusState.selection !== selectedDate) {
    setFocusState({
      selection: selectedDate,
      date: selectedDate.startsWith(`${month}-`) ? selectedDate : focusState.date,
    });
  }
  const tabDate = days.some((day) => day?.date === focusState.date)
    ? focusState.date
    : days.some((day) => day?.date === selectedDate)
      ? selectedDate
      : today.startsWith(`${month}-`)
        ? today
        : `${month}-01`;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const selected = dateButtons.current.get(selectedDate);
    if (!viewport || !selected || viewport.clientWidth <= 0) return;
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    if (maxScroll <= 0) return;
    const bounds = viewport.getBoundingClientRect();
    const dateBounds = selected.getBoundingClientRect();
    const left = bounds.left + viewport.clientLeft;
    const right = left + viewport.clientWidth;
    const adjustment =
      dateBounds.left < left
        ? dateBounds.left - left
        : dateBounds.right > right
          ? dateBounds.right - right
          : 0;
    // Returning from the list creates a new viewport at scrollLeft=0. Reveal only
    // the selected column; keep focus and the page's vertical position untouched.
    if (adjustment !== 0)
      viewport.scrollLeft = Math.max(0, Math.min(maxScroll, viewport.scrollLeft + adjustment));
  }, [month, selectedDate]);

  useLayoutEffect(() => {
    const requested = pendingFocus.current;
    if (!requested || !requested.date.startsWith(`${month}-`)) return;
    const target = dateButtons.current.get(requested.date);
    if (!target) return;
    pendingFocus.current = null;
    if (document.activeElement !== requested.origin && document.activeElement !== document.body)
      return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [month, focusState.date]);

  const moveDate = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const target = monthCalendarKeyboardDate(date, event.key);
    if (!target || target === date) return;
    if (!target.startsWith(`${month}-`) && !onMonthChange) return;
    pendingFocus.current = { date: target, origin: event.currentTarget };
    setFocusState({ selection: selectedDate, date: target });
    if (!target.startsWith(`${month}-`)) onMonthChange?.(target.slice(0, 7));
  };

  return (
    <section className={styles.calendar} aria-label="每月行程">
      <header className={styles.header}>
        <p>個人行事曆</p>
        <h3>
          <time dateTime={month}>{month.replace('-', ' / ')}</time>
        </h3>
      </header>
      <div
        ref={viewportRef}
        className={styles.viewport}
        role="region"
        aria-label={`${month} 月格，週日起始`}
        aria-describedby={`${descriptionId}-keyboard`}
        tabIndex={0}
      >
        <div className={styles.grid} key={month}>
          {MONTH_WEEKDAYS.map((day) => (
            <div className={styles.weekday} key={day}>
              <span className={styles.srOnly}>週</span>
              {day}
            </div>
          ))}
          {days.map((day, index) =>
            day ? (
              <div className={styles.day} key={day.date}>
                <button
                  ref={(node) => {
                    if (node) dateButtons.current.set(day.date, node);
                    else dateButtons.current.delete(day.date);
                  }}
                  type="button"
                  className={styles.date}
                  aria-label={day.date}
                  aria-describedby={`${descriptionId}-${day.date}`}
                  aria-pressed={selectedDate === day.date}
                  aria-current={today === day.date ? 'date' : undefined}
                  tabIndex={tabDate === day.date ? 0 : -1}
                  onFocus={() => setFocusState({ selection: selectedDate, date: day.date })}
                  onKeyDown={(event) => moveDate(event, day.date)}
                  onClick={() => onDate(day.date)}
                >
                  <span className={styles.dateNumber}>{Number(day.date.slice(-2))}</span>
                  <span className={styles.markers} aria-hidden="true">
                    {day.events.slice(0, 3).map((event) => (
                      <span key={event.id} />
                    ))}
                  </span>
                </button>
                <span id={`${descriptionId}-${day.date}`} className={styles.srOnly}>
                  {today === day.date ? '今天，' : ''}
                  {day.events.length ? `${day.events.length} 筆行程` : '沒有個人行程'}
                </span>
                {(expanded.includes(day.date) ? day.events : day.events.slice(0, 2)).map(
                  (event) => (
                    <button
                      type="button"
                      className={styles.event}
                      aria-label={event.title}
                      key={event.id}
                      disabled={disabled}
                      onClick={(click) => onEdit(event, click.currentTarget)}
                    >
                      <span className={styles.eventTitle}>{event.title}</span>
                    </button>
                  ),
                )}
                {day.events.length > 2 && (
                  <button
                    type="button"
                    className={styles.more}
                    aria-expanded={expanded.includes(day.date)}
                    onClick={() =>
                      setExpanded((prev) =>
                        prev.includes(day.date)
                          ? prev.filter((date) => date !== day.date)
                          : [...prev, day.date],
                      )
                    }
                  >
                    {expanded.includes(day.date) ? '收合' : `還有 ${day.events.length - 2} 筆`}
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.blank} key={`blank-${index}`} aria-hidden="true" />
            ),
          )}
        </div>
      </div>
      <div className={styles.footer}>
        <p className={styles.hint}>選一天，查看當日行程</p>
        <p className={styles.legend}>
          <span aria-hidden="true" />
          有行程
        </p>
      </div>
      <p className={styles.srOnly} id={`${descriptionId}-keyboard`}>
        方向鍵移動日期，Home 與 End 移到本週首尾，PageUp 與 PageDown 切換月份，按 Enter
        或空白鍵選取日期。
      </p>
    </section>
  );
}
