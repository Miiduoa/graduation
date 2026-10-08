import { resolveDashboardRole } from '../services/dashboardRole';

test.each([
  ['student', 'student'],
  ['teacher', 'teacher'],
  ['ta', 'ta'],
  ['club_officer', 'club_officer'],
  ['department_head', 'department'],
  ['admin', 'admin'],
  ['alumni', 'alumni'],
  ['staff', 'staff'],
  ['guest', 'guest'],
])('authenticated role group %s selects %s', (roleGroup, expected) => {
  expect(resolveDashboardRole({ roleGroup })).toBe(expected);
});
test.each([
  ['professor', 'teacher'],
  ['vendor', 'vendor'],
  ['cafeteria', 'vendor'],
  ['assistant', 'ta'],
  ['service', 'staff'],
  ['principal', 'department'],
  ['school', 'admin'],
])('authenticated role %s selects %s', (role, expected) => {
  expect(resolveDashboardRole({ role })).toBe(expected);
});
test('never elevates or invents a role from a UID prefix', () => {
  for (const uid of ['demo_admin_sys', 'demo_teacher_chang', 'demo_cafeteria', 'demo_ta_lin']) {
    expect(resolveDashboardRole({ uid, roleGroup: 'student' })).toBe('student');
    expect(resolveDashboardRole({ uid })).toBe('guest');
  }
  expect(resolveDashboardRole(null)).toBe('guest');
  expect(resolveDashboardRole({ role: 'unknown' })).toBe('guest');
});
test('staff is not assumed to be a vendor; an explicit vendor role is required', () => {
  expect(resolveDashboardRole({ roleGroup: 'staff', role: 'staff' })).toBe('staff');
  expect(resolveDashboardRole({ roleGroup: 'staff', role: 'vendor' })).toBe('vendor');
});
