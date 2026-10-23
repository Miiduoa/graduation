const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const c = require(join(process.env.COURSE_COMPILED, 'courseAccess.js'));
const { createCourseAccess, isCourseAccessPath } = require(join(process.env.COURSE_COMPILED, 'courseAccessClient.js'));
const id = (prefix, n = 1) => `${prefix}_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metadata = { schoolId: 'pu', academicYear: '115', semester: '1', title: '資料庫', courseCode: 'IM301', teacher: '王老師', className: '資管三B' };
const candidate = (n = 1, extra = {}) => ({ ...metadata, id: id('ccd', n), workspaceId: id('cw', n), version: 1, verification: 'administrator-reviewed', ...extra });
const receipt = extra => ({ id: id('car'), kind: 'student', state: 'pending', version: 1, workspaceId: id('cw'), courseId: id('ccd'), metadata, statement: '', decisionReason: null, createdAt: new Date().toISOString(), membershipActive: false, ...extra });
test('normalizes ROC/CE years and full width input without changing school identity', () => {
  assert.deepEqual(c.courseScope({ schoolId: 'PU', academicYear: '２０２６', semester: '上學期' }), { schoolId: 'pu', academicYear: '115', semester: '1' });
  assert.equal(c.courseScope({ ...metadata, academicYear: '115 學年度' }).academicYear, '115');
});
test('missing or ambiguous scope fails closed', () => {
  for (const extra of [{ schoolId: '' }, { academicYear: '115/116' }, { semester: '秋季' }]) assert.throws(() => c.courseScope({ ...metadata, ...extra }));
});
test('only whitelisted course metadata leaves the import record', () => {
  assert.deepEqual(c.courseHints({ ...metadata, source: { rawText: 'private screenshot' }, grade: '98', studentName: 'private' }), metadata);
});
test('ranking separates school, year and term', () => {
  assert.equal(c.recommendCourses(metadata, [candidate(1, { schoolId: 'other' }), candidate(2, { academicYear: '114' }), candidate(3, { semester: '2' })]).length, 0);
});
test('one exact match remains only a recommendation, never a selected or joined result', () => {
  const result = c.recommendCourses(metadata, [candidate()]); assert.equal(result.length, 1);
  assert.equal('joined' in result[0], false); assert.equal('selected' in result[0], false); assert.equal('linkedCourseId' in result[0], false);
});
test('multiple candidates retained, conflicts explicit, teacher name never grants authority', () => {
  const result = c.recommendCourses(metadata, [candidate(1), candidate(2, { teacher: '李老師', className: '資管三A' })]);
  assert.equal(result.length, 2); assert.deepEqual(result[1].conflicts, ['教師欄位不同', '班別不同']);
  assert.deepEqual(c.recommendCourses(metadata, [candidate(3, { courseCode: 'X', title: '其他課' })]), []);
});
test('no fuzzy course-code matching or unverified badge acceptance', () => {
  assert.equal(c.recommendCourses(metadata, [candidate(1, { courseCode: 'IM30I', title: '未知課' })]).length, 0);
  for (const verification of ['mock', 'school-verified', true, null]) assert.throws(() => c.parseCourseCandidate(candidate(1, { verification })));
});
test('untrusted role flags and controls rejected in metadata', () => {
  assert.throws(() => c.courseMetadata({ ...metadata, role: 'teacher' }));
  assert.throws(() => c.courseMetadata({ ...metadata, title: 'bad\u0000' }));
});
test('transport cannot smuggle another school or duplicate candidates', async () => {
  for (const candidates of [[candidate(1, { schoolId: 'other' })], [candidate(), candidate()]]) {
    await assert.rejects(createCourseAccess(async () => ({ candidates, truncated: false })).match(metadata));
  }
});
test('student receipt must match requested course and kind', async () => {
  for (const result of [receipt({ kind: 'teacher' }), receipt({ courseId: id('ccd', 5) }), receipt({ metadata: { ...metadata, schoolId: 'other' } })])
    await assert.rejects(createCourseAccess(async () => result).student({ courseId: id('ccd'), version: 1, metadata, confirmed: true, idempotencyKey: 'test-key-1' }));
});
test('unknown availability never becomes verified success', () => {
  assert.match(c.courseAccessErrorMessage({ status: 404 }), /尚未開放/);
  assert.throws(() => c.parseCourseCandidate({ ...candidate(), version: NaN }));
});

test('approved personal course shortcut needs both an active student membership and matching term', () => {
  const request = receipt({ state: 'approved', membershipActive: true });
  const member = { id: id('cw'), title: '正式資料庫', state: 'active', memberRole: 'student' };
  assert.deepEqual(c.approvedCourseLinks(metadata, [request], [member]), [{ id: id('cw'), title: '正式資料庫' }]);
  assert.deepEqual(c.approvedCourseLinks(metadata, [request, request], [member]), [{ id: id('cw'), title: '正式資料庫' }]);
  for (const stale of [
    receipt({ state: 'pending', membershipActive: false }),
    receipt({ state: 'revoked', membershipActive: false }),
    receipt({ state: 'approved', membershipActive: false }),
    receipt({ state: 'approved', membershipActive: true, metadata: { ...metadata, schoolId: 'other' } }),
    receipt({ state: 'approved', membershipActive: true, metadata: { ...metadata, academicYear: '114' } }),
    receipt({ state: 'approved', membershipActive: true, metadata: { ...metadata, semester: '2' } }),
  ]) assert.deepEqual(c.approvedCourseLinks(metadata, [stale], [member]), []);
  assert.deepEqual(c.approvedCourseLinks(metadata, [request], [{ ...member, state: 'archived' }]), []);
  assert.deepEqual(c.approvedCourseLinks(metadata, [request], [{ ...member, memberRole: 'owner-teacher' }]), []);
  assert.deepEqual(c.approvedCourseLinks(metadata, [request], [{ ...member, id: id('cw', 9) }]), []);
});

test('a conflicting course code, teacher or section cannot produce a direct-link shortcut', () => {
  const member = { id: id('cw'), title: '正式資料庫', state: 'active', memberRole: 'student' };
  const request = receipt({ state: 'approved', membershipActive: true });
  for (const field of [
    { courseCode: 'IM302' },
    { teacher: '另一位老師' },
    { className: '資管三A' },
    { courseCode: 'OTHER', title: metadata.title },
  ]) assert.deepEqual(c.approvedCourseLinks(metadata, [{ ...request, metadata: { ...metadata, ...field } }], [member]), []);
  assert.deepEqual(c.approvedCourseLinks({ ...metadata, academicYear: '' }, [request], [member]), []);
  assert.deepEqual(c.approvedCourseLinks({ ...metadata, courseCode: '', title: '另一門' }, [request], [member]), []);
});

test('BFF allowlist rejects path escape, arbitrary grants and malformed IDs', () => {
  for (const path of ['course-access/match', `course-access/requests/${id('car')}/decide`]) assert.equal(isCourseAccessPath(path), true);
  for (const path of ['course-access/../ops', 'course-access/grant-teacher', 'course-access/requests/pa_x/decide', 'course-access/match?school=other', 'course-access/match/']) assert.equal(isCourseAccessPath(path), false);
});

test('workspace readback is scoped, sanitized and never upgrades an unreviewed workspace', async () => {
  const good = { workspaceId: id('cw'), memberRole: 'student', membershipActive: true, status: 'reviewed', course: candidate() };
  assert.equal((await createCourseAccess(async () => good).workspace(id('cw'), 'pu')).course.teacher, metadata.teacher);
  const plain = await createCourseAccess(async () => ({ ...good, status: 'unreviewed', course: null, privateEvidence: 'never-emit' })).workspace(id('cw'), 'pu');
  assert.equal(plain.course, null); assert.equal('privateEvidence' in plain, false);
  for (const change of [{ workspaceId: id('cw', 2) }, { membershipActive: false }, { memberRole: 'co-teacher' }, { status: 'school-verified' }, { course: candidate(1, { schoolId: 'other' }) }, { course: candidate(2) }])
    await assert.rejects(createCourseAccess(async () => ({ ...good, ...change })).workspace(id('cw'), 'pu'));
  assert.equal(isCourseAccessPath('course-access/workspace-course'), true);
  assert.equal(isCourseAccessPath('course-access/workspace-course/other'), false);
});
