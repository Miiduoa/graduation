/**
 * roleEventTargets — 避免「老師把假單送給老師」這類角色錯亂的單元測試
 *
 * 主要驗證：
 *   1. 每個角色 → 目標清單合理，且永遠不含自己
 *   2. emit 層也會把 actor 自己過濾掉（保險絲）
 *   3. 不適用的角色（vendor / alumni / guest）拿到空目標清單
 */
import {
  getLeaveRequestTargets,
  getDormRepairTargets,
  getHelpRequestTargets,
  getDiscussionTargets,
  getAttendanceCheckInTargets,
  getOrderPlacedTargets,
  canSubmitLeaveRequest,
  canSubmitDormRepair,
  canRequestHelp,
  canPostDiscussion,
  canCheckInAttendance,
  canPlaceOrder,
} from '../services/roleEventTargets';

describe('roleEventTargets — 角色路由不會送給自己', () => {
  describe('請假流程', () => {
    test('學生請假 → 老師 + 系主任，不含自己', () => {
      const t = getLeaveRequestTargets('student', 'demo_student_kuchih');
      expect(t).toContain('demo_teacher_chang');
      expect(t).toContain('demo_admin_huang');
      expect(t).not.toContain('demo_student_kuchih');
    });

    test('🚨 教師請假 → 系主任，絕對不能含老師自己', () => {
      const t = getLeaveRequestTargets('teacher', 'demo_teacher_chang');
      expect(t).toEqual(['demo_admin_huang']);
      expect(t).not.toContain('demo_teacher_chang'); // 核心 bug
    });

    test('系主任請假 → admin_sys，不含自己', () => {
      const t = getLeaveRequestTargets('department_head', 'demo_admin_huang');
      expect(t).toEqual(['demo_admin_sys']);
      expect(t).not.toContain('demo_admin_huang');
    });

    test('餐廳員工 / 校友 / 訪客：無請假流程', () => {
      expect(canSubmitLeaveRequest('vendor')).toBe(false);
      expect(canSubmitLeaveRequest('alumni')).toBe(false);
      expect(canSubmitLeaveRequest('guest')).toBe(false);
      expect(getLeaveRequestTargets('vendor', 'demo_cafeteria')).toEqual([]);
      expect(getLeaveRequestTargets('alumni', 'demo_alumni_chang')).toEqual([]);
      expect(getLeaveRequestTargets('guest', 'demo_guest')).toEqual([]);
    });

    test('TA / 社團幹部 → 跟學生一樣，但不含自己', () => {
      const ta = getLeaveRequestTargets('ta', 'demo_ta_lin');
      expect(ta).toContain('demo_teacher_chang');
      expect(ta).toContain('demo_admin_huang');
      expect(ta).not.toContain('demo_ta_lin');

      const club = getLeaveRequestTargets('club_officer', 'demo_club_wei');
      expect(club).toContain('demo_teacher_chang');
      expect(club).not.toContain('demo_club_wei');
    });
  });

  describe('宿舍報修', () => {
    test('教師不該能報宿舍修', () => {
      expect(canSubmitDormRepair('teacher')).toBe(false);
      expect(canSubmitDormRepair('department_head')).toBe(false);
      expect(canSubmitDormRepair('vendor')).toBe(false);
    });

    test('學生報修 → 系主任，不含自己', () => {
      const t = getDormRepairTargets('demo_student_kuchih');
      expect(t).toEqual(['demo_admin_huang']);
    });
  });

  describe('求助', () => {
    test('🚨 教師求助：教師不應使用學生求助管道', () => {
      expect(canRequestHelp('teacher')).toBe(false);
      expect(canRequestHelp('ta')).toBe(false);
    });

    test('學生求助 → TA + 老師，不含自己', () => {
      const t = getHelpRequestTargets('demo_student_kuchih');
      expect(t).toContain('demo_ta_lin');
      expect(t).toContain('demo_teacher_chang');
      expect(t).not.toContain('demo_student_kuchih');
    });
  });

  describe('討論', () => {
    test('學生發討論 → 老師 + TA，不含自己', () => {
      const t = getDiscussionTargets('student', 'demo_student_kuchih');
      expect(t).toContain('demo_teacher_chang');
      expect(t).toContain('demo_ta_lin');
      expect(t).not.toContain('demo_student_kuchih');
    });

    test('教師發討論 → 廣播給全班（undefined）', () => {
      const t = getDiscussionTargets('teacher', 'demo_teacher_chang');
      expect(t).toBeUndefined();
    });
  });

  describe('簽到', () => {
    test('🚨 教師不能對自己簽到', () => {
      expect(canCheckInAttendance('teacher')).toBe(false);
    });

    test('學生簽到 → 老師，不含自己', () => {
      const t = getAttendanceCheckInTargets('demo_student_kuchih');
      expect(t).toEqual(['demo_teacher_chang']);
    });
  });

  describe('下單', () => {
    test('所有 demo 角色都能在校園 app 內下單', () => {
      expect(canPlaceOrder('student')).toBe(true);
      expect(canPlaceOrder('teacher')).toBe(true);
      expect(canPlaceOrder('ta')).toBe(true);
      expect(canPlaceOrder('club_officer')).toBe(true);
      expect(canPlaceOrder('department_head')).toBe(true);
      expect(canPlaceOrder('admin')).toBe(true);
      expect(canPlaceOrder('vendor')).toBe(true);
      expect(canPlaceOrder('alumni')).toBe(true);
      expect(canPlaceOrder('guest')).toBe(true);
    });

    test('使用者下單 → 商家，不含自己', () => {
      const t = getOrderPlacedTargets('demo_student_kuchih', 'demo_cafeteria');
      expect(t).toEqual(['demo_cafeteria']);
    });

    test('如果學生 uid 不小心等於商家 uid，會被過濾掉', () => {
      const t = getOrderPlacedTargets('demo_cafeteria', 'demo_cafeteria');
      expect(t).toEqual([]);
    });
  });

  describe('共通：actor 自排除（保險絲）', () => {
    test.each([
      ['demo_teacher_chang', 'teacher', getLeaveRequestTargets],
      ['demo_admin_huang', 'department_head', getLeaveRequestTargets],
      ['demo_ta_lin', 'ta', getLeaveRequestTargets],
      ['demo_student_kuchih', 'student', getLeaveRequestTargets],
    ])('%s (%s) 不會在自己的請假 target 裡', (uid, role, fn) => {
      const t = (fn as typeof getLeaveRequestTargets)(role, uid);
      expect(t).not.toContain(uid);
    });
  });
});
