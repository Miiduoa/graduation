'use client';

import { use, useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { WEEKDAY_LABELS, courseTimeLabel, type PersonalCourse, type TimetableMeta } from '@campus/shared';
import { loadSharedTimetable } from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';

export default function SharedTimetablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; name: string; courses: PersonalCourse[]; meta: TimetableMeta; expiresAt: string }
    | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    loadSharedTimetable(token)
      .then((data) => {
        if (alive) setState({ status: 'ready', ...data });
      })
      .catch((error: Error) => {
        const message =
          error.message === 'expired'
            ? '這份分享已過期。'
            : error.message === 'revoked'
              ? '這份分享已撤回。'
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
    <SiteShell title="分享的課表" subtitle="這是對方主動分享的快照，不是學校正式課表。">
      {state.status === 'loading' && <p className={styles.notice}>正在讀取分享課表…</p>}
      {state.status === 'error' && (
        <p className={styles.note} role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <p className={styles.notice}>
            {state.name} · 這份連結在 {new Date(state.expiresAt).toLocaleString('zh-TW')} 前有效。
          </p>
          <div className={styles.week}>
            {WEEKDAY_LABELS.map((label, index) => {
              const entries = state.courses.filter((course) => course.day === index + 1);
              return (
                <section className={styles.day} key={label}>
                  <h3>{label}</h3>
                  {entries.length ? (
                    entries.map((course) => (
                      <article className={styles.course} key={course.id}>
                        <time>{courseTimeLabel(course)}</time>
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
