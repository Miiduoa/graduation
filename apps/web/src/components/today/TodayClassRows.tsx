import Link from 'next/link';
import { buildCampusClassroomMapHref } from '@campus/shared/src/campusClassroomLookup';
import { useId, useState } from 'react';
import { formatClock, TODAY_COPY, type TodayClass } from '@campus/shared/src/pickNextAction';
import { courseWeekHref } from '@/lib/todayScreen';
import styles from './StudentToday.module.css';

export function TodayClassRows({
  classes,
  primaryId,
  now,
  timetableHref,
  timetableSchoolId,
}: {
  classes: TodayClass[];
  primaryId?: string;
  now: Date;
  timetableHref: string;
  timetableSchoolId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const visible = expanded ? classes : classes.slice(0, 4);
  const nextClass = classes.find((item) => item.endAt > now.getTime());

  return (
    <>
      <ul className={styles.list} id={listId}>
        {visible.map((item) => {
          const ended = item.endAt <= now.getTime();
          const current = !ended && item.startAt <= now.getTime();
          const state = current
            ? '上課中'
            : ended
              ? '已結束'
              : item.id === nextClass?.id
                ? TODAY_COPY.nextClass
                : '';
          const courseHref = courseWeekHref(item.courseId);
          const mapHref = buildCampusClassroomMapHref({ schoolId: timetableSchoolId, location: item.location });
          return (
            <li key={item.id} className={styles.classRowWithMap} data-testid={item.id === primaryId ? 'next-action' : undefined}>
              <Link
                href={courseHref === '/timetable' ? timetableHref : courseHref}
                className={styles.row + ' ' + styles.scheduleRow + (current ? ' ' + styles.current : ended ? ' ' + styles.ended : '')}
              >
                <span className={styles.time}>
                  <span>{formatClock(item.startAt)}</span>
                  <small>至 {formatClock(item.endAt)}</small>
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.rowHeading}>
                    <span className={styles.rowTitle}>{item.title}</span>
                    {state && <span className={styles.classStatus}>{state}</span>}
                  </span>
                  <span className={styles.rowMeta}>{item.location || '教室未填'}</span>
                </span>
                <span className={styles.rowChevron} aria-hidden="true" />
                <span className={styles.srOnly}>
                  {courseHref === '/timetable' ? TODAY_COPY.viewWeek : TODAY_COPY.viewCourse}
                </span>
              </Link>
              {mapHref && <Link className={styles.classroomLink} href={mapHref} aria-label={`找教室：${item.location}`}>找教室</Link>}
            </li>
          );
        })}
      </ul>
      {classes.length > 4 && (
        <button
          type="button"
          className={styles.more}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起課程' : `再看 ${classes.length - visible.length} 堂課`}
        </button>
      )}
    </>
  );
}
