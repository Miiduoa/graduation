import {
  planNotifications,
  resolveAttendanceScheduleStatus,
  type AttendanceScheduleStatus,
  type NotificationItem,
  type NotificationKind,
  type TodayAttendanceSituation,
} from '@campus/shared';
import type { AttendanceSession } from '@/lib/courseAttendance';

export const ATTENDANCE_IN_APP_KINDS: readonly NotificationKind[] = [
  'attendance_session_missing_teacher',
  'attendance_session_missing_student',
  'attendance_active',
  'attendance_no_checkin_record',
] as const;

export type CourseMeetingInput =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unlinked' }
  | { status: 'ready'; startAt: string; endAt: string };

const COOLDOWN_STORAGE_KEY = 'nuni.attendanceMissingNotice.recent';

function taipeiDayWindow(nowIso: string): { startAt: string; endAt: string } | null {
  const ms = new Date(nowIso).getTime();
  if (!Number.isFinite(ms)) return null;
  const taipei = new Date(ms + 8 * 60 * 60 * 1000);
  const y = taipei.getUTCFullYear();
  const m = String(taipei.getUTCMonth() + 1).padStart(2, '0');
  const d = String(taipei.getUTCDate()).padStart(2, '0');
  return {
    startAt: `${y}-${m}-${d}T00:00:00+08:00`,
    endAt: `${y}-${m}-${d}T23:59:59.999+08:00`,
  };
}

function isSameTaipeiDay(iso: string | null, nowIso: string): boolean {
  if (!iso) return false;
  const left = new Date(iso).getTime();
  const right = new Date(nowIso).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const a = new Date(left + 8 * 60 * 60 * 1000);
  const b = new Date(right + 8 * 60 * 60 * 1000);
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function pickSessionForNotice(
  sessions: readonly AttendanceSession[],
  nowIso: string,
): AttendanceSession | null {
  const active = sessions.filter((session) => session.active);
  if (active.length) {
    return [...active].sort((left, right) =>
      String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? '')),
    )[0];
  }
  const endedToday = sessions.filter(
    (session) => !session.active && isSameTaipeiDay(session.startedAt, nowIso),
  );
  if (endedToday.length) {
    return [...endedToday].sort((left, right) =>
      String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? '')),
    )[0];
  }
  return null;
}

function sessionStatus(
  session: AttendanceSession | null,
): TodayAttendanceSituation['session'] {
  if (!session) return { kind: 'none' };
  const checkedIn = Boolean(session.ownRecord?.checkedInAt);
  if (session.active) {
    return { kind: 'active', id: session.id, studentCheckedIn: checkedIn };
  }
  return {
    kind: 'ended',
    id: session.id,
    studentCheckedIn: checkedIn,
    studentMarkedAbsent: session.ownStatus === 'absent',
    studentMarkedExcused: session.ownStatus === 'excused',
  };
}

/**
 * 將課程點名頁既有資料編成 TodayAttendanceSituation。
 * 老師端課表未連結時，若今日尚無場次，可用當日課日窗作為規則 2 後備（明示傳入，非隱性狀態）。
 * 學生端不啟用此後備，避免未連結課表時誤提示。
 */
export function buildCourseAttendanceSituation(input: {
  now: string;
  courseId: string;
  courseName: string;
  viewerRole: 'student' | 'teacher';
  sessions: readonly AttendanceSession[];
  meeting: CourseMeetingInput;
  /** 老師點名頁：課表未連結時是否以當日 00:00–23:59 作為本堂後備窗 */
  teacherDayWindowFallback?: boolean;
}): TodayAttendanceSituation | null {
  if (input.meeting.status === 'loading') return null;

  const picked = pickSessionForNotice(input.sessions, input.now);
  let scheduleStatus: AttendanceScheduleStatus;
  let classStartAt: string | null = null;
  let classEndAt: string | null = null;

  if (input.meeting.status === 'error') {
    scheduleStatus = 'error';
  } else if (input.meeting.status === 'ready') {
    classStartAt = input.meeting.startAt;
    classEndAt = input.meeting.endAt;
    scheduleStatus = resolveAttendanceScheduleStatus({
      now: input.now,
      hasScheduleLink: true,
      classStartAt,
      classEndAt,
    });
  } else if (
    input.viewerRole === 'teacher' &&
    input.teacherDayWindowFallback !== false &&
    !picked
  ) {
    const window = taipeiDayWindow(input.now);
    if (window) {
      classStartAt = window.startAt;
      classEndAt = window.endAt;
      scheduleStatus = resolveAttendanceScheduleStatus({
        now: input.now,
        hasScheduleLink: true,
        classStartAt,
        classEndAt,
      });
    } else {
      scheduleStatus = 'error';
    }
  } else {
    scheduleStatus = 'unlinked';
  }

  return {
    courseId: input.courseId,
    courseName: input.courseName,
    viewerRole: input.viewerRole,
    scheduleStatus,
    classStartAt,
    classEndAt,
    session: sessionStatus(picked),
  };
}

export function readAttendanceNoticeCooldown(): Array<{
  kind: NotificationKind;
  key: string;
  at: string;
}> {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ kind: NotificationKind; key: string; at: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => typeof row?.kind === 'string' && typeof row?.key === 'string');
  } catch {
    return [];
  }
}

export function rememberAttendanceNoticeCooldown(items: readonly NotificationItem[], at: string) {
  if (typeof sessionStorage === 'undefined') return;
  const attendance = items.filter((item) => ATTENDANCE_IN_APP_KINDS.includes(item.kind));
  if (!attendance.length) return;
  try {
    const previous = readAttendanceNoticeCooldown();
    const next = [
      ...attendance.map((item) => ({
        kind: item.kind,
        key: noticeCooldownKey(item),
        at,
      })),
      ...previous,
    ].slice(0, 40);
    sessionStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // cooldown 僅降低打擾，寫入失敗時仍顯示本次提示。
  }
}

export function planCourseAttendanceInAppNotices(input: {
  now: string;
  situation: TodayAttendanceSituation;
  cooldownHours?: number;
  recentlySent?: Array<{ kind: NotificationKind; key: string; at: string }>;
}): NotificationItem[] {
  const planned = planNotifications(
    { now: input.now, todayAttendanceSituations: [input.situation] },
    {
      recentlySent: input.recentlySent ?? readAttendanceNoticeCooldown(),
      cooldownHours: input.cooldownHours ?? 12,
    },
  );
  return planned.filter((item) => ATTENDANCE_IN_APP_KINDS.includes(item.kind));
}

export function noticeCooldownKey(item: NotificationItem): string {
  const sep = item.id.indexOf('::');
  return sep >= 0 ? item.id.slice(sep + 2) : item.id;
}

export function attendanceInAppNoticeHref(
  courseId: string,
  audience: 'student' | 'teacher',
  schoolSearch = '',
): string {
  const base =
    audience === 'teacher'
      ? `/teacher/course/${encodeURIComponent(courseId)}/attendance`
      : `/course/${encodeURIComponent(courseId)}/attendance`;
  return `${base}${schoolSearch}`;
}
