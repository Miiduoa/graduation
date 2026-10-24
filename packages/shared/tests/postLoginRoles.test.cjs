/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
/**
 * Regression: client-writable primaryRole must never escalate resolveUserRoles.
 * users.role remains canonical; school/TC/service evidence still applies for students.
 */
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const original = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(source, filename);
};
const { resolveUserRoles } = require('../src/postLoginRoles.ts');
require.extensions['.ts'] = original;

describe('resolveUserRoles authority boundary', () => {
  test('ignores polluted client primaryRole when users.role is student', () => {
    for (const polluted of ['admin', 'teacher', 'editor', 'staff', 'professor']) {
      const r = resolveUserRoles({
        userDoc: { role: 'student', primaryRole: polluted },
        tcCourses: [{ id: 1, course_code: 'S', role: 'student' }],
      });
      assert.equal(r.primaryRole, 'student');
      assert.equal(r.usedAuthoritativeUserRole, false);
    }
  });

  test('primaryRole alone cannot invent admin when role is missing/null', () => {
    const r = resolveUserRoles({
      userDoc: { role: null, primaryRole: 'admin' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'student');
    assert.equal(r.usedAuthoritativeUserRole, false);
  });

  test('still honors server-owned users.role admin even if primaryRole is student', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'admin', primaryRole: 'student' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'admin');
    assert.equal(r.usedAuthoritativeUserRole, true);
  });

  test('student can still elevate via school member admin evidence', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student', primaryRole: 'admin' },
      schoolMemberDoc: { role: 'admin', status: 'active' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'admin');
    assert.ok(r.orgRoles.includes('schoolAdmin'));
  });

  test('student + inactive school admin does not elevate primary or orgRoles', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'admin', status: 'inactive' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'student');
    assert.ok(!r.orgRoles.includes('schoolAdmin'));
    assert.ok(!r.roles.includes('schoolAdmin'));
  });

  test('student + inactive school editor does not elevate', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'editor', status: 'inactive' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'student');
    assert.ok(!r.orgRoles.includes('schoolEditor'));
  });

  test('missing or unknown member status is not elevated membership evidence', () => {
    for (const status of [undefined, null, '', 'pending', 'suspended', 'ACTIVE', 'Active']) {
      const r = resolveUserRoles({
        userDoc: { role: 'student' },
        schoolMemberDoc: { role: 'admin', ...(status === undefined ? {} : { status }) },
        tcCourses: [],
      });
      assert.equal(r.primaryRole, 'student', `status=${String(status)}`);
      assert.ok(!r.orgRoles.includes('schoolAdmin'), `status=${String(status)}`);
    }
  });

  test('active school editor still elevates to staff + schoolEditor', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'editor', status: 'active' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'staff');
    assert.ok(r.orgRoles.includes('schoolEditor'));
  });

  test('canonical users.role admin is unaffected by inactive school membership', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'admin' },
      schoolMemberDoc: { role: 'admin', status: 'inactive' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'admin');
    assert.equal(r.usedAuthoritativeUserRole, true);
    assert.ok(!r.orgRoles.includes('schoolAdmin'));
  });

  test('TC teacher + inactive school admin -> teacher, no schoolAdmin', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student' },
      schoolMemberDoc: { role: 'admin', status: 'inactive' },
      tcProfile: { role: 'teacher' },
      tcCourses: [],
    });
    assert.equal(r.primaryRole, 'teacher');
    assert.ok(r.teachingRoles.includes('teacher'));
    assert.ok(!r.orgRoles.includes('schoolAdmin'));
  });

  test('active service roles still apply; inactive service roles do not', () => {
    const active = resolveUserRoles({
      userDoc: { role: 'student' },
      serviceRolesDoc: { status: 'active', orders: true },
      tcCourses: [],
    });
    assert.equal(active.primaryRole, 'staff');
    assert.ok(active.orgRoles.includes('service:orders'));

    const inactive = resolveUserRoles({
      userDoc: { role: 'student' },
      serviceRolesDoc: { status: 'inactive', orders: true },
      tcCourses: [],
    });
    assert.equal(inactive.primaryRole, 'student');
    assert.ok(!inactive.orgRoles.includes('service:orders'));
  });

  test('student can still elevate via TC teaching course evidence', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'student', primaryRole: 'admin' },
      tcCourses: [{ id: 9, course_code: 'T', role: 'teacher' }],
    });
    assert.equal(r.primaryRole, 'teacher');
    assert.ok(r.teachingRoles.includes('teacher'));
  });

  test('respects non-student authoritative user role with teaching flags merged', () => {
    const r = resolveUserRoles({
      userDoc: { role: 'admin', primaryRole: 'student' },
      tcCourses: [{ id: 1, course_code: 'X', role: 'teacher' }],
    });
    assert.equal(r.primaryRole, 'admin');
    assert.equal(r.usedAuthoritativeUserRole, true);
    assert.ok(r.teachingRoles.includes('teacher'));
  });
});

// Keep path reference so tooling sees this as a shared package test.
assert.ok(fs.existsSync(path.join(__dirname, '../src/postLoginRoles.ts')));
