'use client';

import { useEffect, useMemo } from 'react';
import type { NotificationItem } from '@campus/shared';
import {
  buildCourseAttendanceSituation,
  planCourseAttendanceInAppNotices,
  rememberAttendanceNoticeCooldown,
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
  const notices = useMemo(() => {
    const situation = buildCourseAttendanceSituation({
      now,
      courseId,
      courseName,
      viewerRole,
      sessions,
      meeting,
      teacherDayWindowFallback: viewerRole === 'teacher',
    });
    if (!situation) return [] as NotificationItem[];
    return planCourseAttendanceInAppNotices({ now, situation });
  }, [now, courseId, courseName, viewerRole, sessions, meeting]);

  useEffect(() => {
    if (!notices.length) return;
    rememberAttendanceNoticeCooldown(notices, now);
  }, [notices, now]);

  if (!notices.length) return null;

  return (
    <section className={styles.plannerNotices} aria-label="點名狀態提示" data-testid="attendance-missing-notices">
      {notices.map((item) => (
        <p key={item.id} role="status" className={styles.plannerNotice} data-kind={item.kind}>
          <strong>{item.title}</strong>
          <span>{item.body}</span>
        </p>
      ))}
    </section>
  );
}
