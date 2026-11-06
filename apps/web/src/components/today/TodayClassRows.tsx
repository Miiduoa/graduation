import Link from 'next/link';
import { useId, useState } from 'react';
import { formatClock, TODAY_COPY, type TodayClass } from '@campus/shared/src/pickNextAction';
import { courseWeekHref } from '@/lib/todayScreen';
import styles from './StudentToday.module.css';

export function TodayClassRows({
  classes,
  now,
  timetableHref,
}: {
  classes: TodayClass[];
  now: Date;
  timetableHref: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? classes : classes.slice(0, 4);

  return (
    <>
      <ul className={styles.list} id={listId}>
        {visible.map((item) => {
          const ended = item.endAt <= now.getTime();
          const current = !ended && item.startAt <= now.getTime();
          const courseHref = courseWeekHref(item.courseId);
          return (
            <li key={item.id}>
              <Link
                href={courseHref === '/timetable' ? timetableHref : courseHref}
                className={`${styles.row} ${current ? styles.current : ended ? styles.ended : ''}`}
              >
                <span className={styles.time}>
                  <span>{formatClock(item.startAt)}</span>
                  <small>至 {formatClock(item.endAt)}</small>
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  <span className={styles.rowMeta}>{item.location || '教室未填'}</span>
                </span>
                {(current || ended) && (
                  <span className={styles.classStatus}>{current ? '上課中' : '已結束'}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {classes.length > 4 && (
        <div className={styles.scheduleActions}>
          <button
            type="button"
            className={styles.more}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起課程' : `再看 ${classes.length - visible.length} 堂課`}
          </button>
          <Link className={styles.import} href={timetableHref}>
            {TODAY_COPY.viewFullTimetable}
          </Link>
        </div>
      )}
    </>
  );
}
