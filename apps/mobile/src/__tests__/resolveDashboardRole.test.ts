/**
 * @jest-environment node
 *
 * 對 RoleAwareTodayScreen.resolveDashboardRole 完整單元測試。
 */
import { resolveDashboardRole } from '../screens/RoleAwareTodayScreen';

describe('resolveDashboardRole', () => {
  // null profile = 未登入 = 訪客（改：原回 'student'，現拆出 guest dashboard）
  it('null profile → guest', () => {
    expect(resolveDashboardRole(null)).toBe('guest');
  });

  it('demo student uid → student', () => {
    expect(resolveDashboardRole({ uid: 'demo_student_kuchih' })).toBe('student');
  });

  it('demo teacher uid → teacher', () => {
    expect(resolveDashboardRole({ uid: 'demo_teacher_chang' })).toBe('teacher');
  });

  it('demo TA uid → ta', () => {
    expect(resolveDashboardRole({ uid: 'demo_ta_lin' })).toBe('ta');
  });

  it('demo 系主任 uid (demo_admin_huang) → department', () => {
    expect(resolveDashboardRole({ uid: 'demo_admin_huang' })).toBe('department');
  });

  it('demo 系統管理員 uid (demo_admin_sys) → admin', () => {
    expect(resolveDashboardRole({ uid: 'demo_admin_sys' })).toBe('admin');
  });

  it('demo 社團幹部 uid (demo_club_wei) → club_officer', () => {
    expect(resolveDashboardRole({ uid: 'demo_club_wei' })).toBe('club_officer');
  });

  it('demo 校友 uid (demo_alumni_chang) → alumni', () => {
    expect(resolveDashboardRole({ uid: 'demo_alumni_chang' })).toBe('alumni');
  });

  it('demo 訪客 uid (demo_guest) → guest', () => {
    expect(resolveDashboardRole({ uid: 'demo_guest' })).toBe('guest');
  });

  it('demo cafeteria uid → vendor', () => {
    expect(resolveDashboardRole({ uid: 'demo_cafeteria' })).toBe('vendor');
  });

  // roleGroup=admin 改為 'admin'（系統管理員獨立 dashboard），不再與 department 共用
  it('roleGroup=admin → admin', () => {
    expect(resolveDashboardRole({ roleGroup: 'admin' })).toBe('admin');
  });

  it('roleGroup=department_head → department', () => {
    expect(resolveDashboardRole({ roleGroup: 'department_head' })).toBe('department');
  });

  it('roleGroup=teacher → teacher', () => {
    expect(resolveDashboardRole({ roleGroup: 'teacher' })).toBe('teacher');
  });

  it('roleGroup=club_officer → club_officer', () => {
    expect(resolveDashboardRole({ roleGroup: 'club_officer' })).toBe('club_officer');
  });

  it('roleGroup=alumni → alumni', () => {
    expect(resolveDashboardRole({ roleGroup: 'alumni' })).toBe('alumni');
  });

  it('roleGroup=guest → guest', () => {
    expect(resolveDashboardRole({ roleGroup: 'guest' })).toBe('guest');
  });

  it('role=teacher → teacher', () => {
    expect(resolveDashboardRole({ role: 'teacher' })).toBe('teacher');
  });

  it('role=professor → teacher', () => {
    expect(resolveDashboardRole({ role: 'professor' })).toBe('teacher');
  });

  it('role=vendor → vendor', () => {
    expect(resolveDashboardRole({ role: 'vendor' })).toBe('vendor');
  });

  it('role=cafeteria → vendor', () => {
    expect(resolveDashboardRole({ role: 'cafeteria' })).toBe('vendor');
  });

  it('role=ta → ta', () => {
    expect(resolveDashboardRole({ role: 'ta' })).toBe('ta');
  });

  it('role=club_officer → club_officer', () => {
    expect(resolveDashboardRole({ role: 'club_officer' })).toBe('club_officer');
  });

  it('role=alumni → alumni', () => {
    expect(resolveDashboardRole({ role: 'alumni' })).toBe('alumni');
  });

  it('role=guest → guest', () => {
    expect(resolveDashboardRole({ role: 'guest' })).toBe('guest');
  });

  it('未知 role → student', () => {
    expect(resolveDashboardRole({ role: 'mystery' })).toBe('student');
  });

  it('uid 優先於 roleGroup（demo 帳號）', () => {
    // demo_teacher_chang 應該被認為是 teacher 即使 roleGroup 是 student
    expect(
      resolveDashboardRole({
        uid: 'demo_teacher_chang',
        roleGroup: 'student',
      }),
    ).toBe('teacher');
  });
});
