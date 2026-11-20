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

/** 課表未連結時的中性提示（非規則 2；不得暗示已缺席或本堂尚未點名） */
export const ATTENDANCE_SCHEDULE_LINK_HINT =
  '連結課表後才能提醒是否尚未點名';

export type CourseMeetingInput =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unlinked' }
  | { status: 'ready'; startAt: string; endAt: string };

const COOLDOWN_STORAGE_KEY = 'nuni.attendanceMissingNotice.recent';

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
 * 規則 2 僅在 meeting.status === 'ready' 且已對到本堂、已到上課時間時成立；
 * 課表未連結／讀取失敗不得偽造成本堂尚未點名（不再使用台北整天後備窗）。
 */
export function buildCourseAttendanceSituation(input: {
  now: string;
  courseId: string;
  courseName: string;
  viewerRole: 'student' | 'teacher';
  sessions: readonly AttendanceSession[];
  meeting: CourseMeetingInput;
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

export type AttendanceNoticeCooldownRow = {
  kind: NotificationKind;
  key: string;
  at: string;
};

const EMPTY_COOLDOWN: AttendanceNoticeCooldownRow[] = [];

let cooldownSnapshotCacheKey = '';
let cooldownSnapshotCache: AttendanceNoticeCooldownRow[] = EMPTY_COOLDOWN;

export function readAttendanceNoticeCooldown(): AttendanceNoticeCooldownRow[] {
  if (typeof sessionStorage === 'undefined') return EMPTY_COOLDOWN;
  try {
    const raw = sessionStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return EMPTY_COOLDOWN;
    const parsed = JSON.parse(raw) as AttendanceNoticeCooldownRow[];
    if (!Array.isArray(parsed)) return EMPTY_COOLDOWN;
    return parsed.filter((row) => typeof row?.kind === 'string' && typeof row?.key === 'string');
  } catch {
    return EMPTY_COOLDOWN;
  }
}

/** useSyncExternalStore：client getSnapshot（結果須可快取，避免無限重繪） */
export function getAttendanceNoticeCooldownSnapshot(): AttendanceNoticeCooldownRow[] {
  const rows = readAttendanceNoticeCooldown();
  const key = JSON.stringify(rows);
  if (key === cooldownSnapshotCacheKey) return cooldownSnapshotCache;
  cooldownSnapshotCacheKey = key;
  cooldownSnapshotCache = rows.length ? rows : EMPTY_COOLDOWN;
  return cooldownSnapshotCache;
}

/** useSyncExternalStore：SSR／hydrate 一律空 cooldown，避免與 client 首畫不一致 */
export function getAttendanceNoticeCooldownServerSnapshot(): AttendanceNoticeCooldownRow[] {
  return EMPTY_COOLDOWN;
}

/** 同頁寫入 cooldown 不依賴 storage 事件；跨分頁可選訂閱 */
export function subscribeAttendanceNoticeCooldown(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    cooldownSnapshotCacheKey = '';
    onStoreChange();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
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
    cooldownSnapshotCacheKey = '';
  } catch {
    // cooldown 僅降低打擾，寫入失敗時仍顯示本次提示。
  }
}

/**
 * 規劃點名站內提示。呼叫端必須自行傳入 recentlySent；
 * 預設空陣列，避免 render／SSR 路徑讀取 sessionStorage。
 */
export function planCourseAttendanceInAppNotices(input: {
  now: string;
  situation: TodayAttendanceSituation;
  cooldownHours?: number;
  recentlySent?: Array<{ kind: NotificationKind; key: string; at: string }>;
}): NotificationItem[] {
  const planned = planNotifications(
    { now: input.now, todayAttendanceSituations: [input.situation] },
    {
      recentlySent: input.recentlySent ?? [],
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
