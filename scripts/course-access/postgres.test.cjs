// Synthetic accounts in an ephemeral PostgreSQL schema only. No formal identity is verified here.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { CourseAccessService } = require(join(process.env.COURSE_COMPILED, 'service.js'));
const metadata = { schoolId: 'pu', academicYear: '115', semester: '1', title: '資料庫', courseCode: 'IM301', teacher: '測試教師', className: '三B' };
if (!process.env.COURSE_TEST_DATABASE_URL) {
  test('PostgreSQL integration requires COURSE_TEST_DATABASE_URL; not run locally without PostgreSQL', { skip: true }, () => {});
} else {
  const { Pool } = require(process.env.COURSE_TEST_DEPS ? join(process.env.COURSE_TEST_DEPS, 'pg') : 'pg');
  const schema = `course_test_${randomUUID().replaceAll('-', '')}`;
  const control = new Pool({ connectionString: process.env.COURSE_TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.COURSE_TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 12 });
  const db = { async transaction(run) { const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } } };
  const service = new CourseAccessService(db);
  before(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    // Minimal existing-table contract fixture, NOT a replacement for running the complete private API migrations.
    await pool.query(`CREATE TABLE platform_accounts (id text PRIMARY KEY, state text NOT NULL);
      CREATE TABLE platform_account_credentials (id text PRIMARY KEY, platform_account_id text REFERENCES platform_accounts(id), state text NOT NULL);
      CREATE TABLE platform_operator_assignments (platform_account_id text REFERENCES platform_accounts(id), role_key text, state text, PRIMARY KEY(platform_account_id,role_key));
      CREATE TABLE tenants (id text PRIMARY KEY, state text NOT NULL);
      CREATE TABLE class_workspaces (id text PRIMARY KEY, owner_platform_account_id text REFERENCES platform_accounts(id), title text, state text NOT NULL);
      CREATE TABLE class_workspace_members (workspace_id text REFERENCES class_workspaces(id), platform_account_id text REFERENCES platform_accounts(id),
        role text NOT NULL, state text NOT NULL, joined_at timestamptz DEFAULT now(), removed_at timestamptz, updated_at timestamptz DEFAULT now(), PRIMARY KEY(workspace_id,platform_account_id));
      CREATE TABLE class_workspace_affiliations (workspace_id text PRIMARY KEY REFERENCES class_workspaces(id), tenant_id text REFERENCES tenants(id), section_id text, state text NOT NULL);`);
    await pool.query(readFileSync(resolve('deploy/nuni-api/course-access/278_course_access_review.sql'), 'utf8'));
  });
  after(async () => { await pool.end(); await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end(); });
  async function actor(operator = false) {
    const platformAccountId = `pa_${randomUUID()}`, credentialId = `pac_${randomUUID()}`;
    await pool.query("INSERT INTO platform_accounts VALUES ($1,'active')", [platformAccountId]);
    await pool.query("INSERT INTO platform_account_credentials VALUES ($1,$2,'active')", [credentialId, platformAccountId]);
    if (operator) await pool.query("INSERT INTO platform_operator_assignments VALUES ($1,'platform-operator','active')", [platformAccountId]);
    return { platformAccountId, credentialId, expiresAt: Date.now() + 3600000 };
  }
  async function fixture({ approved = true, affiliation = true, schoolId = 'pu' } = {}) {
    await pool.query("INSERT INTO tenants VALUES ($1,'open') ON CONFLICT (id) DO NOTHING", [schoolId]);
    const teacher = await actor(), student = await actor(), operator = await actor(true), workspaceId = `cw_${randomUUID()}`;
    await pool.query("INSERT INTO class_workspaces VALUES ($1,$2,'Test course','active')", [workspaceId, teacher.platformAccountId]);
    await pool.query("INSERT INTO class_workspace_members (workspace_id,platform_account_id,role,state) VALUES ($1,$2,'owner-teacher','active')", [workspaceId, teacher.platformAccountId]);
    if (affiliation) await pool.query("INSERT INTO class_workspace_affiliations VALUES ($1,$2,'official-section-fixture','active')", [workspaceId, schoolId]);
    const hints = { ...metadata, schoolId };
    let request = await service.teacher(teacher, { workspaceId, metadata: hints, statement: 'Synthetic authorization case for an isolated integration test only.', confirmed: true, idempotencyKey: randomUUID() });
    if (approved) request = await service.decide(operator, request.id, decision(request));
    return { teacher, student, operator, workspaceId, request, hints };
  }
  function decision(request, extra = {}) { return { version: request.version, decision: 'approve', reason: '獨立測試案件核對', evidenceReference: 'TEST-ONLY-CASE-0001', independentlyVerified: true, idempotencyKey: randomUUID(), ...extra }; }
  function studentInput(f, extra = {}) { return { courseId: f.request.courseId, version: 1, metadata: f.hints, confirmed: true, idempotencyKey: randomUUID(), ...extra }; }
  async function membership(f, account = f.student) {
    return (await pool.query('SELECT * FROM class_workspace_members WHERE workspace_id=$1 AND platform_account_id=$2', [f.workspaceId, account.platformAccountId])).rows[0];
  }
  async function legacyJoin(f, account = f.student, role = 'student') {
    return pool.query("INSERT INTO class_workspace_members (workspace_id,platform_account_id,role,state) VALUES ($1,$2,$3,'active') ON CONFLICT (workspace_id,platform_account_id) DO UPDATE SET role=EXCLUDED.role,state='active'", [f.workspaceId, account.platformAccountId, role]);
  }
  test('teacher application remains pending; no directory or campus roles are fabricated', async () => {
    const f = await fixture({ approved: false }); assert.equal(f.request.state, 'pending'); assert.equal(f.request.membershipActive, false);
    assert.equal((await pool.query('SELECT * FROM course_access_directory WHERE workspace_id=$1', [f.workspaceId])).rowCount, 0);
  });
  test('existing owner role, screenshot metadata and school name cannot replace authorized affiliation', async () => {
    const f = await fixture({ approved: false, affiliation: false });
    await assert.rejects(service.decide(f.operator, f.request.id, decision(f.request)), { code: 'COURSE_AUTHORIZED_AFFILIATION_REQUIRED' });
  });
  test('non-operator and self-approval rejected by real database authorization', async () => {
    const f = await fixture({ approved: false });
    await assert.rejects(service.decide(f.student, f.request.id, decision(f.request)), { statusCode: 403 });
    await pool.query("INSERT INTO platform_operator_assignments VALUES ($1,'platform-operator','active')", [f.teacher.platformAccountId]);
    await assert.rejects(service.decide(f.teacher, f.request.id, decision(f.request)), { code: 'COURSE_SELF_REVIEW_FORBIDDEN' });
  });
  test('independent evidence and confirmation are mandatory', async () => {
    const f = await fixture({ approved: false });
    await assert.rejects(service.decide(f.operator, f.request.id, decision(f.request, { independentlyVerified: false })), { code: 'COURSE_INDEPENDENT_REVIEW_REQUIRED' });
    await assert.rejects(service.decide(f.operator, f.request.id, decision(f.request, { evidenceReference: '' })), { code: 'COURSE_INDEPENDENT_REVIEW_REQUIRED' });
  });
  test('student pending request does not create membership; old invite path cannot bypass it', async () => {
    const f = await fixture(); const request = await service.student(f.student, studentInput(f));
    assert.equal(request.state, 'pending'); assert.equal(request.membershipActive, false); assert.equal(await membership(f), undefined);
    await assert.rejects(legacyJoin(f), { code: '42501' });
  });
  test('student approval grants student only; legacy role elevation is blocked', async () => {
    const f = await fixture(), request = await service.student(f.student, studentInput(f));
    const approved = await service.decide(f.operator, request.id, decision(request));
    assert.equal(approved.membershipActive, true); assert.equal((await membership(f)).role, 'student');
    await assert.rejects(legacyJoin(f, f.student, 'co-teacher'), { code: '42501' });
    await assert.rejects(legacyJoin(f, f.student, 'owner-teacher'), { code: '42501' });
  });
  test('cross-school/term/year and stale-directory requests fail', async () => {
    const f = await fixture();
    for (const extra of [{ schoolId: 'other' }, { academicYear: '114' }, { semester: '2' }])
      await assert.rejects(service.student(f.student, studentInput(f, { metadata: { ...f.hints, ...extra } })), { statusCode: 409 });
    await assert.rejects(service.student(f.student, studentInput(f, { version: 2 })), { statusCode: 409 });
  });
  test('match returns only reviewed metadata in the requested scope', async () => {
    const f = await fixture({ schoolId: 'isolation-a' });
    await fixture({ schoolId: 'isolation-b' });
    const result = await service.match(f.student, f.hints);
    assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].schoolId, 'isolation-a');
    assert.equal('applicantId' in result.candidates[0], false); assert.equal('evidenceReference' in result.candidates[0], false);
  });
  test('course filter happens before catalog limit', async () => {
    const f = await fixture({ schoolId: 'filter-school' });
    const result = await service.match(f.student, { ...f.hints, title: 'Unrelated title', courseCode: 'MISSING' });
    assert.deepEqual(result, { candidates: [], truncated: false });
  });
  test('repeated and concurrent same-key requests create one application and one audit event', async () => {
    const f = await fixture(), input = studentInput(f);
    const results = await Promise.all(Array.from({ length: 6 }, () => service.student(f.student, input)));
    assert.equal(new Set(results.map(item => item.id)).size, 1);
    assert.equal((await pool.query("SELECT * FROM course_access_audit WHERE request_id=$1 AND action='student-requested'", [results[0].id])).rowCount, 1);
    await assert.rejects(service.student(f.student, { ...input, metadata: { ...f.hints, title: 'Changed payload' } }), { code: 'COURSE_IDEMPOTENCY_CONFLICT' });
  });
  test('changed approval version is rejected without a second grant', async () => {
    const f = await fixture(), request = await service.student(f.student, studentInput(f));
    await service.decide(f.operator, request.id, decision(request));
    await assert.rejects(service.decide(f.operator, request.id, decision(request)), { statusCode: 409 });
  });
  test('revoke removes student; stale request replay returns revoked and never rejoins', async () => {
    const f = await fixture(), input = studentInput(f), request = await service.student(f.student, input);
    const approved = await service.decide(f.operator, request.id, decision(request));
    const revoked = await service.decide(f.operator, request.id, decision(approved, { decision: 'revoke', evidenceReference: '' }));
    assert.equal(revoked.membershipActive, false); assert.equal((await membership(f)).state, 'removed');
    assert.equal((await service.student(f.student, input)).state, 'revoked');
    await assert.rejects(legacyJoin(f), { code: '42501' });
  });
  test('legacy leave/removal invalidates approval before an old invite can reactivate it', async () => {
    const f = await fixture(), request = await service.student(f.student, studentInput(f));
    await service.decide(f.operator, request.id, decision(request));
    await pool.query("UPDATE class_workspace_members SET state='removed' WHERE workspace_id=$1 AND platform_account_id=$2", [f.workspaceId, f.student.platformAccountId]);
    assert.equal((await service.list(f.student, {})).requests[0].state, 'revoked');
    await assert.rejects(legacyJoin(f), { code: '42501' });
  });
  test('teacher revocation archives workspace and prevents reactivation', async () => {
    const f = await fixture(); await service.decide(f.operator, f.request.id, decision(f.request, { decision: 'revoke' }));
    assert.equal((await pool.query('SELECT state FROM class_workspaces WHERE id=$1', [f.workspaceId])).rows[0].state, 'archived');
    await assert.rejects(pool.query("UPDATE class_workspaces SET state='active' WHERE id=$1", [f.workspaceId]), { code: '42501' });
  });
  test('affiliation change revokes directory rather than silently moving students to another school', async () => {
    const f = await fixture();
    await pool.query("UPDATE class_workspace_affiliations SET section_id='different-section' WHERE workspace_id=$1", [f.workspaceId]);
    assert.equal((await pool.query('SELECT state FROM course_access_directory WHERE workspace_id=$1', [f.workspaceId])).rows[0].state, 'revoked');
  });
  test('existing unreviewed members prevent publishing a personal workspace as a reviewed course', async () => {
    const f = await fixture({ approved: false }); await legacyJoin(f);
    await assert.rejects(service.decide(f.operator, f.request.id, decision(f.request)), { code: 'COURSE_MEMBER_MIGRATION_REVIEW_REQUIRED' });
  });
  test('personal non-directory workspaces preserve their invitation behavior', async () => {
    const f = await fixture({ approved: false }); await legacyJoin(f); assert.equal((await membership(f)).role, 'student');
  });
  test('request ownership and operator queue isolate private application details', async () => {
    const f = await fixture(), request = await service.student(f.student, studentInput(f)), other = await actor();
    assert.deepEqual((await service.list(other, {})).requests, []);
    await assert.rejects(service.withdraw(other, request.id, { version: 1, idempotencyKey: randomUUID() }), { statusCode: 404 });
    await assert.rejects(service.list(other, { schoolId: 'pu' }, true), { statusCode: 403 });
    const mine = (await service.list(f.student, {})).requests; assert.equal('applicantId' in mine[0], false);
    assert.ok((await service.list(f.operator, { schoolId: 'pu' }, true)).requests.every(item => item.metadata.schoolId === 'pu' && item.applicantId));
  });
  test('expired sessions, revoked credentials and client-supplied roles rejected', async () => {
    const f = await fixture();
    await assert.rejects(service.student({ ...f.student, expiresAt: 0 }, studentInput(f)), { statusCode: 401 });
    await assert.rejects(service.student(f.student, studentInput(f, { role: 'teacher' })), { code: 'COURSE_INVALID_INPUT' });
    await pool.query("UPDATE platform_account_credentials SET state='revoked' WHERE id=$1", [f.student.credentialId]);
    await assert.rejects(service.match(f.student, f.hints), { statusCode: 401 });
  });
  test('closing teacher account archives reviewed workspaces used by old APIs', async () => {
    const f = await fixture(); await pool.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [f.teacher.platformAccountId]);
    assert.equal((await pool.query('SELECT state FROM class_workspaces WHERE id=$1', [f.workspaceId])).rows[0].state, 'archived');
    await assert.rejects(legacyJoin(f), { code: '42501' });
  });
  test('closing school archives course authority without claiming a new verification', async () => {
    const f = await fixture({ schoolId: 'closed-school' }); await pool.query("UPDATE tenants SET state='closed' WHERE id='closed-school'");
    assert.equal((await pool.query('SELECT state FROM class_workspaces WHERE id=$1', [f.workspaceId])).rows[0].state, 'archived');
    await assert.rejects(service.match(f.student, f.hints), { statusCode: 404 });
  });
  test('readback requires current membership, reviewed authority and requested school', async () => {
    const f = await fixture();
    const input = { workspaceId: f.workspaceId, schoolId: 'pu' };
    await assert.rejects(service.workspace(f.student, input), { statusCode: 404 });
    const teacher = await service.workspace(f.teacher, input);
    assert.equal(teacher.status, 'reviewed'); assert.equal(teacher.course.teacher, metadata.teacher);
    assert.equal('teacher_id' in teacher.course, false);
    const request = await service.student(f.student, studentInput(f));
    await assert.rejects(service.workspace(f.student, input), { statusCode: 404 });
    const approved = await service.decide(f.operator, request.id, decision(request));
    assert.equal((await service.workspace(f.student, input)).memberRole, 'student');
    await assert.rejects(service.workspace(f.student, { ...input, schoolId: 'other' }), { statusCode: 404 });
    await service.decide(f.operator, approved.id, decision(approved, { decision: 'revoke' }));
    await assert.rejects(service.workspace(f.student, input), { statusCode: 404 });
  });
  test('unreviewed member workspace remains explicitly unreviewed; revoked directory never downgrades', async () => {
    const f = await fixture({ approved: false });
    assert.deepEqual(await service.workspace(f.teacher, { workspaceId: f.workspaceId, schoolId: 'pu' }),
      { workspaceId: f.workspaceId, memberRole: 'owner-teacher', membershipActive: true, status: 'unreviewed', course: null });
    const reviewed = await fixture();
    await service.decide(reviewed.operator, reviewed.request.id, decision(reviewed.request, { decision: 'revoke' }));
    await assert.rejects(service.workspace(reviewed.teacher, { workspaceId: reviewed.workspaceId, schoolId: 'pu' }), { statusCode: 404 });
  });
  test('withdrawal creates no membership and requires a fresh request afterwards', async () => {
    const f = await fixture(), input = studentInput(f), request = await service.student(f.student, input);
    const withdrawn = await service.withdraw(f.student, request.id, { version: request.version, idempotencyKey: randomUUID() });
    assert.equal(withdrawn.state, 'withdrawn'); assert.equal(await membership(f), undefined);
    await assert.rejects(service.decide(f.operator, request.id, decision(request)), { statusCode: 409 });
    assert.notEqual((await service.student(f.student, studentInput(f))).id, request.id);
  });
}
