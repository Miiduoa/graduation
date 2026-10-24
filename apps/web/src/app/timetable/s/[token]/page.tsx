'use client';

import { use, useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import {
  WEEKDAY_LABELS,
  courseTimeLabel,
  periodEnd,
  periodProfileForSchool,
  periodStart,
  sharedTimetableTitle,
  type PersonalCourse,
  type TimetableMeta,
} from '@campus/shared';
import { loadSharedTimetable } from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';

function periodRangeCopy(start: number, end: number): string {
  return start === end ? `第 ${start} 節` : `第 ${start}–${end} 節`;
}

/** Snapshot clock labels follow the share's schoolId only — never browsing school or PU default. */
function snapshotCourseTimeLabel(
  course: Pick<PersonalCourse, 'day' | 'start' | 'end'>,
  schoolId: string | null,
): string {
  if (course.day === 0 || course.start === 0) return '時間待定';
  const profile = periodProfileForSchool(schoolId);
  if (!profile) return `${periodRangeCopy(course.start, course.end)}，時間待確認`;
  const start = periodStart(course.start, profile);
  const end = periodEnd(course.end, profile);
  if (!start || !end) return `${periodRangeCopy(course.start, course.end)}，時間待確認`;
  return courseTimeLabel(course, profile);
}

function SharedTimetableSnapshot({ token }: { token: string }) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | {
        status: 'ready';
        name: string;
        courses: PersonalCourse[];
        meta: TimetableMeta;
        expiresAt: string;
        schoolId: string | null;
      }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    loadSharedTimetable(token)
      .then((data) => {
        if (!alive) return;
        setState({
          status: 'ready',
          name: data.name,
          courses: data.courses,
          meta: data.meta,
          expiresAt: data.expiresAt,
          schoolId: data.schoolId ?? null,
        });
      })
      .catch((error: Error) => {
        const message =
          error.message === 'expired'
            ? '這份分享已過期。'
            : error.message === 'revoked'
              ? '這份分享已經關掉了。'
              : error.message === 'unconfigured'
                ? '這個環境還沒接上資料庫，沒有可顯示的分享課表。'
                : '找不到這份分享。';
        if (alive) setState({ status: 'error', message });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <SiteShell
      title={state.status === 'ready' ? sharedTimetableTitle(state.expiresAt) : '同學分享的課表'}
      subtitle="這是對方主動分享的快照，不是學校正式課表。"
    >
      {state.status === 'loading' && <p className={styles.notice}>正在讀取分享課表…</p>}
      {state.status === 'error' && (
        <p className={styles.note} role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <h2>同學分享的課表</h2>
          <div className={styles.week}>
            {WEEKDAY_LABELS.map((label, index) => {
              const entries = state.courses.filter((course) => course.day === index + 1);
              return (
                <section className={styles.day} key={label}>
                  <h3>{label}</h3>
                  {entries.length ? (
                    entries.map((course) => (
                      <article className={styles.course} key={course.id}>
                        <time>{snapshotCourseTimeLabel(course, state.schoolId)}</time>
                        <h4>{course.name}</h4>
                        <p>{course.room || '教室未填'}</p>
                      </article>
                    ))
                  ) : (
                    <p className={styles.empty}>無課</p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </SiteShell>
  );
}

export default function SharedTimetablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <SharedTimetableSnapshot key={token} token={token} />;
}
