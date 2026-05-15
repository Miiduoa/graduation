/**
 * @jest-environment node
 *
 * 對 RoleAwareTodayScreen.resolveDashboardRole 完整單元測試。
 */
import { resolveDashboardRole } from '../screens/RoleAwareTodayScreen';

describe('resolveDashboardRole', () => {
  it('null profile → student', () => {
    expect(resolveDashboardRole(null)).toBe('student');
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

  it('demo admin uid → department', () => {
    expect(resolveDashboardRole({ uid: 'demo_admin_huang' })).toBe('department');
  });

  it('demo cafeteria uid → vendor', () => {
    expect(resolveDashboardRole({ uid: 'demo_cafeteria' })).toBe('vendor');
  });

  it('roleGroup=admin → department', () => {
    expect(resolveDashboardRole({ roleGroup: 'admin' })).toBe('department');
  });

  it('roleGroup=department_head → department', () => {
    expect(resolveDashboardRole({ roleGroup: 'department_head' })).toBe('department');
  });

  it('roleGroup=teacher → teacher', () => {
    expect(resolveDashboardRole({ roleGroup: 'teacher' })).toBe('teacher');
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
