import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCourseAttendanceSituation,
  noticeCooldownKey,
  planCourseAttendanceInAppNotices,
  rememberAttendanceNoticeCooldown,
} from './attendanceMissingNotice';
import type { AttendanceSession } from './courseAttendance';

const NOW = '2026-05-15T10:00:00+08:00';

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
    expect(`${item?.title}${item?.body}`).not.toMatch(/缺席|曠課|扣分/);
  });

  it('規則2：老師端課表未連結時可用當日課日窗提示本堂尚未點名', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'unlinked' },
      teacherDayWindowFallback: true,
    });
    expect(situation?.scheduleStatus).toBe('ok');
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices.some((n) => n.kind === 'attendance_session_missing_teacher')).toBe(true);
    expect(notices[0]?.body).toContain('本堂尚未點名');
    expect(notices[0]?.body).not.toMatch(/缺席|曠課|扣分/);
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
  });

  it('規則6：老師標記缺席 → 不產 planner 站內提示', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'student',
      sessions: [session({ ownStatus: 'absent' })],
      meeting: { status: 'ready', startAt: '2026-05-15T09:00:00+08:00', endAt: '2026-05-15T12:00:00+08:00' },
    });
    const notices = planCourseAttendanceInAppNotices({
      now: NOW,
      situation: situation!,
      recentlySent: [],
    });
    expect(notices).toHaveLength(0);
  });

  it('cooldown：同一堂老師尚未點名提示會被記住', () => {
    const situation = buildCourseAttendanceSituation({
      now: NOW,
      courseId: 'c1',
      courseName: '資料結構',
      viewerRole: 'teacher',
      sessions: [],
      meeting: { status: 'unlinked' },
      teacherDayWindowFallback: true,
    })!;
    const first = planCourseAttendanceInAppNotices({
      now: NOW,
      situation,
      recentlySent: [],
    });
    expect(first).toHaveLength(1);
    rememberAttendanceNoticeCooldown(first, NOW);
    const second = planCourseAttendanceInAppNotices({ now: NOW, situation });
    expect(second).toHaveLength(0);
    expect(noticeCooldownKey(first[0])).toContain('c1::');
  });
});
