import { afterEach, describe, expect, it, vi } from 'vitest';
import { attendanceNoticeTextIsSafe } from '@campus/shared';
import {
  ATTENDANCE_SCHEDULE_LINK_HINT,
  buildCourseAttendanceSituation,
  noticeCooldownKey,
  planCourseAttendanceInAppNotices,
  readAttendanceNoticeCooldown,
  rememberAttendanceNoticeCooldown,
} from './attendanceMissingNotice';
import type { AttendanceSession } from './courseAttendance';

const NOW = '2026-05-15T10:00:00+08:00';
const CLASS_START = '2026-05-15T09:00:00+08:00';
const CLASS_END = '2026-05-15T12:00:00+08:00';

function session(partial: Partial<AttendanceSession> = {}): AttendanceSession {
  return {
    id: 's1',
    teacherId: 't1',
    active: false,
    startedAt: '2026-05-15T09:00:00+08:00',
    endedAt: '2026-05-15T09:10:00+08:00',
    qrExpiresAt: '2026-05-15T09:10:00+08:00',
    attendeeCount: 0,
    ownRecord: null,
    ownStatus: null,
    ...partial,
  };
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('buildCourseAttendanceSituation', () => {
  it('規則4：已結束場次且無簽到 → attendance_no_checkin_record，文案不含缺席', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'student',
      sessions: [session()],
      meeting: { status: 'unlinked' },
    });
    expect(situation).toBeTruthy();
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    const item = notices.find((n) => n.kind === 'attendance_no_checkin_record');
    expect(item?.title).toContain('沒有簽到紀錄');
    expect(attendanceNoticeTextIsSafe(`${item?.title}${item?.body}`)).toBe(true);
  });

  it('規則2：老師端已對到本堂且已到上課時間 → 本堂尚未點名', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'ready', startAt: CLASS_START, endAt: CLASS_END },
    });
    expect(situation?.scheduleStatus).toBe('ok');
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices.some((n) => n.kind === 'attendance_session_missing_teacher')).toBe(true);
    expect(notices[0]?.body).toContain('本堂尚未點名');
    expect(attendanceNoticeTextIsSafe(`${notices[0]?.title}${notices[0]?.body}`)).toBe(true);
  });

  it('規則2：課表未連結 → 不出現本堂尚未點名', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'unlinked' },
    });
    expect(situation?.scheduleStatus).toBe('unlinked');
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices).toHaveLength(0);
    expect(notices.some((n) => n.body?.includes('本堂尚未點名'))).toBe(false);
  });

  it('假日／當天沒這門課（no_class_today）→ 不出現本堂尚未點名', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'ready', startAt: '', endAt: '' },
    });
    // ready 但起迄空白 → resolve 為 no_class_today（hasScheduleLink true 但無起迄）
    expect(situation?.scheduleStatus).toBe('no_class_today');
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices).toHaveLength(0);
  });

  it('還沒到上課時間 → 不出現本堂尚未點名', () => {
    const situation = buildCourseAttendanceSituation({
      now: '2026-05-15T08:00:00+08:00',
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'ready', startAt: CLASS_START, endAt: CLASS_END },
    });
    expect(situation?.scheduleStatus).toBe('before_class');
    const notices = planCourseAttendanceInAppNotices({
      now: '2026-05-15T08:00:00+08:00',
      situation: situation!,
      recentlySent: [],
    });
    expect(notices).toHaveLength(0);
  });

  it('規則2：學生端課表未連結且無場次 → 不推論', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'student',
      sessions: [],
      meeting: { status: 'unlinked' },
    });
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices).toHaveLength(0);
  });

  it('規則3：進行中場次 → 點名進行中請簽到', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'student',
      sessions: [session({ active: true, endedAt: null })],
      meeting: { status: 'unlinked' },
    });
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices.find((n) => n.kind === 'attendance_active')?.body).toBe('點名進行中，請簽到');
    expect(
      attendanceNoticeTextIsSafe(
        `${notices.find((n) => n.kind === 'attendance_active')?.title}${notices.find((n) => n.kind === 'attendance_active')?.body}`,
      ),
    ).toBe(true);
  });

  it('規則6：老師標記缺席 → 不產 planner 站內提示', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'student',
      sessions: [session({ ownStatus: 'absent' })],
      meeting: { status: 'ready', startAt: CLASS_START, endAt: CLASS_END },
    });
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices).toHaveLength(0);
  });

  it('cooldown：同一堂老師尚未點名提示會被記住（呼叫端傳 recentlySent）', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'ready', startAt: CLASS_START, endAt: CLASS_END },
    })!;
    const first = planCourseAttendanceInAppNotices({
      now: NOW,
      situation,
      recentlySent: [],
    });
    expect(first).toHaveLength(1);
    rememberAttendanceNoticeCooldown(first, NOW);
    const second = planCourseAttendanceInAppNotices({
      now: NOW,
      situation,
      recentlySent: readAttendanceNoticeCooldown(),
    });
    expect(second).toHaveLength(0);
    expect(noticeCooldownKey(first[0])).toContain('c1::');
  });

  it('SSR／無 sessionStorage：readCooldown 安全回空，plan 不預設讀 storage', () => {
    const original = globalThis.sessionStorage;
    // @ts-expect-error 模擬 SSR 無 sessionStorage
    delete globalThis.sessionStorage;
    expect(readAttendanceNoticeCooldown()).toEqual([]);
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'ready', startAt: CLASS_START, endAt: CLASS_END },
    })!;
    const notices = planCourseAttendanceInAppNotices({ now: NOW, situation });
    expect(notices).toHaveLength(1);
    expect(() => rememberAttendanceNoticeCooldown(notices, NOW)).not.toThrow();
    globalThis.sessionStorage = original;
  });

  it('中性連結提示文案通過安全檢查且不含本堂尚未點名誤報語意之外的禁字', () => {
    expect(attendanceNoticeTextIsSafe(ATTENDANCE_SCHEDULE_LINK_HINT)).toBe(true);
  });
});
