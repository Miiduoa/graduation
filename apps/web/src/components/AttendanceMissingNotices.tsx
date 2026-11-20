'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { NotificationItem } from '@campus/shared';
import {
  ATTENDANCE_SCHEDULE_LINK_HINT,
  buildCourseAttendanceSituation,
  getAttendanceNoticeCooldownServerSnapshot,
  getAttendanceNoticeCooldownSnapshot,
  planCourseAttendanceInAppNotices,
  rememberAttendanceNoticeCooldown,
  subscribeAttendanceNoticeCooldown,
  type CourseMeetingInput,
} from '@/lib/attendanceMissingNotice';
import type { AttendanceSession } from '@/lib/courseAttendance';
import styles from './course-attendance.module.css';

export function AttendanceMissingNotices({
  courseId,
  courseName,
  viewerRole,
  sessions,
  meeting,
  nowIso,
}: {
  courseId: string;
  courseName: string;
  viewerRole: 'student' | 'teacher';
  sessions: readonly AttendanceSession[];
  meeting: CourseMeetingInput;
  nowIso?: string;
}) {
  const now = nowIso ?? new Date().toISOString();
  /** SSR／hydrate 用空 cooldown；client 以 useSyncExternalStore 讀取，不在 render 直接碰 storage 分支造成不一致 */
  const cooldown = useSyncExternalStore(
    subscribeAttendanceNoticeCooldown,
    getAttendanceNoticeCooldownSnapshot,
    getAttendanceNoticeCooldownServerSnapshot,
  );

  const notices = useMemo(() => {
    const situation = buildCourseAttendanceSituation({
      now,
      courseId,
      courseName,
      viewerRole,
      sessions,
      meeting,
    });
    if (!situation) return [] as NotificationItem[];
    return planCourseAttendanceInAppNotices({
      now,
      situation,
      recentlySent: cooldown,
    });
  }, [now, courseId, courseName, viewerRole, sessions, meeting, cooldown]);

  useEffect(() => {
    if (!notices.length) return;
    rememberAttendanceNoticeCooldown(notices, now);
  }, [notices, now]);

  const showScheduleLinkHint =
    meeting.status === 'unlinked' &&
    notices.length === 0 &&
    sessions.every((session) => !session.active);

  if (!notices.length && !showScheduleLinkHint) return null;

  return (
    <section className={styles.plannerNotices} aria-label="點名狀態提示" data-testid="attendance-missing-notices">
      {notices.map((item) => (
        <p key={item.id} role="status" className={styles.plannerNotice} data-kind={item.kind}>
          <strong>{item.title}</strong>
          <span>{item.body}</span>
        </p>
      ))}
      {showScheduleLinkHint ? (
        <p
          role="status"
          className={styles.plannerNotice}
          data-kind="attendance_schedule_link_hint"
          data-testid="attendance-schedule-link-hint"
        >
          <span>{ATTENDANCE_SCHEDULE_LINK_HINT}</span>
        </p>
      ) : null}
    </section>
  );
}
