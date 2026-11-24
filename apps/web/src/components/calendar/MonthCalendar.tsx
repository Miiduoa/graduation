import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  dateRevealRevision = 0,
  onDate,
  onEdit,
  onMonthChange,
  disabled,
}: {
  records: readonly PersonalImportRecord[];
  month: string;
  selectedDate: string;
  dateRevealRevision?: number;
  onDate: (date: string) => void;
  onEdit: (event: PersonalImportRecord, trigger?: HTMLButtonElement) => void;
  onMonthChange?: (month: string) => void;
  disabled: boolean;
}) {
  const [expandedMonth, setExpandedMonth] = useState(month);
  const [expanded, setExpanded] = useState<string[]>([]);
  if (expandedMonth !== month) {
    setExpandedMonth(month);
    setExpanded([]);
  }
  const today = emptyPersonalEventDraft().date;
  const descriptionId = useId();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ date: string; origin: HTMLButtonElement } | null>(null);
  const days = useMemo(() => buildMonthCalendar(records, month), [records, month]);
  const selectedCellIndex = days.findIndex((day) => day?.date === selectedDate);
  const revealWeek = useCallback((columnIndex: number) => {
    const viewport = viewportRef.current;
    const weekdayColumns = gridRef.current?.children;
    const sunday = weekdayColumns?.[0];
    const selectedColumn = weekdayColumns?.[Math.max(0, columnIndex) % MONTH_WEEKDAYS.length];
    if (!viewport || !sunday || !selectedColumn || viewport.clientWidth <= 0) return;
    scrollWeekIntoView(viewport, sunday, selectedColumn);
  }, []);
  const focusDateButton = useCallback((button: HTMLButtonElement) => {
    button.focus({ preventScroll: true });
    const date = button.getAttribute('aria-label') ?? '';
    revealWeek(days.findIndex((day) => day?.date === date));
    scrollVerticallyIntoView(button);
  }, [days, revealWeek]);

  useLayoutEffect(() => {
    revealWeek(selectedCellIndex);
  }, [month, selectedDate, selectedCellIndex, dateRevealRevision, revealWeek]);

  useLayoutEffect(() => {
    const requested = pendingFocus.current;
    if (!requested || !requested.date.startsWith(`${month}-`)) return;
    const target = dateButtons.current.get(requested.date);
    if (!target) return;
    pendingFocus.current = null;
    if (document.activeElement !== requested.origin && document.activeElement !== document.body)
      return;
    focusDateButton(target);
  }, [month, focusDateButton]);

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
    if (target.startsWith(`${month}-`)) {
      const button = dateButtons.current.get(target);
      if (button) focusDateButton(button);
    } else if (onMonthChange) {
      pendingFocus.current = { date: target, origin: event.currentTarget };
      onMonthChange(target.slice(0, 7));
    }
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
        key={month}
        ref={viewportRef}
        className={styles.viewport}
        role="region"
        aria-label={`${month} 月格，週日起始`}
        aria-describedby={`${descriptionId}-keyboard`}
        tabIndex={0}
      >
        <div ref={gridRef} className={styles.grid}>
          {MONTH_WEEKDAYS.map((day) => (
            <div className={styles.weekday} key={day}>
              <span className={styles.srOnly}>週</span>
              {day}
            </div>
          ))}
          {days.map((day, index) =>
            day ? (
              <div
                className={styles.day}
                key={day.date}
                data-preview={
                  selectedDate !== day.date && !expanded.includes(day.date) ? '' : undefined
                }
              >
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
                  onKeyDown={(event) => moveDate(event, day.date)}
                  onClick={() => onDate(day.date)}
                >
                  <span className={styles.dateNumber}>{Number(day.date.slice(-2))}</span>
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
      </div>
      <p className={styles.srOnly} id={`${descriptionId}-keyboard`}>
        按 Tab 可逐一瀏覽日期與行程。方向鍵移動日期，Home 與 End 移到本週首尾，PageUp 與 PageDown
        切換月份，按 Enter 或空白鍵選取日期。
      </p>
    </section>
  );
}


function scrollVerticallyIntoView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return;
  const margin = 8;
  if (rect.top < margin) window.scrollBy(0, rect.top - margin);
  else if (rect.bottom > window.innerHeight - margin)
    window.scrollBy(0, rect.bottom - (window.innerHeight - margin));
}

function scrollWeekIntoView(
  viewport: HTMLDivElement,
  sunday: Element,
  selectedColumn: Element,
) {
  const maxScroll = viewport.scrollWidth - viewport.clientWidth;
  if (maxScroll <= 0) return;
  const viewportLeft = viewport.getBoundingClientRect().left + viewport.clientLeft;
  const weekStart = sunday.getBoundingClientRect().left - viewportLeft + viewport.scrollLeft;
  const columnEnd =
    selectedColumn.getBoundingClientRect().right - viewportLeft + viewport.scrollLeft;
  // Keep Sunday fully visible. When the span overflows, its start also gives
  // the selected column the most space available without clipping Sunday.
  const target = Math.min(
    Math.max(viewport.scrollLeft, columnEnd - viewport.clientWidth),
    weekStart,
  );
  viewport.scrollLeft = Math.max(0, Math.min(maxScroll, target));
}
