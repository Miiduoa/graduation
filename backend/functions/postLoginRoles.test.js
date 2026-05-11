const { resolveUserRoles } = require('../../packages/shared/dist-cjs/postLoginRoles');

describe('resolveUserRoles', () => {
  test('respects non-student authoritative user role', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'admin' },
      tcCourses: [{ id: 1, course_code: 'X', role: 'teacher' }],
    });
    expect(r.primaryRole).toBe('admin');
    expect(r.usedAuthoritativeUserRole).toBe(true);
    expect(r.teachingRoles).toContain('teacher');
  });

  test('infers teacher from TC teaching courses when user is student', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      tcCourses: [
        { id: 1, course_code: 'A', role: 'teacher' },
        { id: 2, course_code: 'B', role: 'student' },
      ],
    });
    expect(r.primaryRole).toBe('teacher');
    expect(r.usedAuthoritativeUserRole).toBe(false);
  });

  test('school editor becomes staff primary', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'editor', status: 'active' },
      tcCourses: [],
    });
    expect(r.primaryRole).toBe('staff');
    expect(r.orgRoles).toContain('schoolEditor');
  });
});
