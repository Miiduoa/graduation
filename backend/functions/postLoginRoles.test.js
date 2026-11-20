const { resolveUserRoles } = require('./generated/shared/postLoginRoles');

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

  test('inactive school admin is not membership evidence', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'admin', status: 'inactive' },
      tcCourses: [],
    });
    expect(r.primaryRole).toBe('student');
    expect(r.orgRoles).not.toContain('schoolAdmin');
  });

  test('missing member status is not membership evidence', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'admin' },
      tcCourses: [],
    });
    expect(r.primaryRole).toBe('student');
    expect(r.orgRoles).not.toContain('schoolAdmin');
  });

  test('TC teacher evidence still elevates when school admin is inactive', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'admin', status: 'inactive' },
      tcProfile: { role: 'teacher' },
      tcCourses: [],
    });
    expect(r.primaryRole).toBe('teacher');
    expect(r.orgRoles).not.toContain('schoolAdmin');
  });
});
