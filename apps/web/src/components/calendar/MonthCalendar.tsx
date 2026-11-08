import { useMemo, useState } from 'react';
import { buildMonthCalendar, MONTH_WEEKDAYS, type PersonalImportRecord } from '@campus/shared';
import styles from './MonthCalendar.module.css';

export function MonthCalendar({
  records,
  month,
  selectedDate,
  onDate,
  onEdit,
  disabled,
}: {
  records: readonly PersonalImportRecord[];
  month: string;
  selectedDate: string;
  onDate: (date: string) => void;
  onEdit: (event: PersonalImportRecord) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const days = useMemo(() => buildMonthCalendar(records, month), [records, month]);
  return (
    <section className={styles.calendar} aria-label="每月行程">
      <header className={styles.header}>
        <p>個人行事曆</p>
        <h3>
          <time dateTime={month}>{month.replace('-', ' / ')}</time>
        </h3>
      </header>
      <div
        className={styles.viewport}
        role="region"
        aria-label={`${month} 月格，週日起始`}
        tabIndex={0}
      >
        <div className={styles.grid}>
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
                  type="button"
                  className={styles.date}
                  aria-label={day.date}
                  aria-pressed={selectedDate === day.date}
                  onClick={() => onDate(day.date)}
                >
                  {Number(day.date.slice(-2))}
                </button>
                {(expanded.includes(day.date) ? day.events : day.events.slice(0, 2)).map(
                  (event) => (
                    <button
                      type="button"
                      className={styles.event}
                      aria-label={event.title}
                      key={event.id}
                      disabled={disabled}
                      onClick={() => onEdit(event)}
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
      <p className={styles.hint}>選一天，查看當日行程</p>
    </section>
  );
}
