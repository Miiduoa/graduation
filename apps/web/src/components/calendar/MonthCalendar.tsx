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
    <div className={styles.grid} aria-label={`${month} 月格，週日起始`}>
      {MONTH_WEEKDAYS.map((day) => (
        <div className={styles.weekday} key={day}>
          週{day}
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
            {(expanded.includes(day.date) ? day.events : day.events.slice(0, 2)).map((event) => (
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
            ))}
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
          <div key={`blank-${index}`} aria-hidden="true" />
        ),
      )}
    </div>
  );
}
