import {
  periodEnd,
  periodStart,
  WEEKDAY_LABELS,
  type PeriodProfileId,
  type PersonalCourse,
} from '@campus/shared';
import styles from './timetableAgenda.module.css';

type TimetableAgendaProps = {
  courses: PersonalCourse[];
  day?: number;
  periodProfile: PeriodProfileId;
  disabled: boolean;
  onOpen: (course: PersonalCourse) => void;
};

export function TimetableAgenda({
  courses,
  day,
  periodProfile,
  disabled,
  onOpen,
}: TimetableAgendaProps) {
  return (
    <div className={styles.agenda} role="region" aria-label={day ? '單日課程' : '一週課程'}>
      {WEEKDAY_LABELS.map((weekday, index) => {
        const weekdayNumber = index + 1;
        if (day && day !== weekdayNumber) return null;
        const entries = courses
          .filter((course) => course.day === weekdayNumber)
          .sort((a, b) => a.start - b.start);
        return (
          <section key={weekday} className={entries.length ? styles.day : styles.emptyDay}>
            <h3 className={styles.dayHeading}>{weekday}</h3>
            {entries.length ? (
              <ul className={styles.rows}>
                {entries.map((course) => {
                  const start = periodStart(course.start, periodProfile);
                  const end = periodEnd(course.end, periodProfile);
                  const time = start && end ? `${start}–${end}` : '時間待定';
                  const room = course.room || '教室未填';
                  const locationLabel = course.room ? `教室 ${course.room}` : room;
                  const action = course.id.startsWith('import:') ? '檢視匯入紀錄' : '編輯';
                  return (
                    <li key={course.id}>
                      <button
                        type="button"
                        className={styles.row}
                        data-course-focus-id={course.id}
                        disabled={disabled}
                        aria-label={[
                          `${action} ${course.name}`,
                          `${weekday} ${time}`,
                          locationLabel,
                          course.teacher && `教師 ${course.teacher}`,
                        ]
                          .filter(Boolean)
                          .join('，')}
                        onClick={() => onOpen(course)}
                      >
                        <span className={styles.time}>
                          {start && end ? (
                            <>
                              <time dateTime={start}>{start}</time>
                              <span className={styles.end}>
                                –<time dateTime={end}>{end}</time>
                              </span>
                            </>
                          ) : (
                            time
                          )}
                        </span>
                        <span className={styles.title}>{course.name}</span>
                        <span className={styles.details}>
                          {room}
                          {course.teacher ? ` · ${course.teacher}` : ''}
                        </span>
                        <span className={styles.chevron} aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyText}>
                {day ? '這天尚無已排定的課程。' : '尚無已排課程'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
