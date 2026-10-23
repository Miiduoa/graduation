/** Run only in the isolated complete API checkout. All identities and evidence here are synthetic. */
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { createDatabase, type CampusDatabase } from '../database';

const secret = 'course-access-http-test-secret-over-thirty-two';
const prefix = '/v1/auth/platform/';
let db: CampusDatabase;
let app: Awaited<ReturnType<typeof createApp>>;
let privateKey: CryptoKey;
type Login = { sessionHandle: string; platformAccountId: string };
const metadata = { schoolId: 'campus-demo', academicYear: '115', semester: '1', title: 'HTTP測試課程', courseCode: 'TEST301', teacher: '合成測試授課者', className: '測試班' };

beforeAll(async () => {
  vi.stubEnv('CAMPUS_COURSE_ACCESS_ENABLED', 'true');
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'course-access-http', alg: 'RS256', use: 'sig' };
  db = await createDatabase({ attendanceCodeSecret: secret, seedDemo: true });
  await db.query(`INSERT INTO platform_identity_providers
    (kind,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,state)
    VALUES ('google-consumer','https://accounts.google.com','course-access-http-client',
    'https://www.googleapis.com/oauth2/v3/certs','https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token','enabled')`);
  app = await createApp(db, { auth: { mode: 'demo', sessionSecret: secret }, attendanceCodeSecret: secret, enableDemoAuth: true,
    externalIdpJwksFetch: async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } }) });
}, 120_000);
afterAll(async () => { await app?.close(); await db?.close(); vi.unstubAllEnvs(); });
async function post(path: string, payload: unknown, actor?: Login) {
  return app.inject({ method: 'POST', url: prefix + path, headers: actor ? { authorization: `Platform ${actor.sessionHandle}` } : {}, payload: payload as Record<string, unknown> });
}
async function login(subject: string): Promise<Login> {
  const begin = await post('login-transactions', { kind: 'google-consumer' });
  expect(begin.statusCode).toBe(200);
  const transaction = begin.json();
  const idToken = await new SignJWT({ nonce: transaction.nonce, email: `${subject}@example.com`, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'course-access-http', typ: 'JWT' })
    .setIssuer('https://accounts.google.com').setAudience('course-access-http-client').setSubject(subject)
    .setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const completed = await post('sessions', { kind: 'google-consumer', transactionId: transaction.transactionId, nonce: transaction.nonce, idToken, displayName: `Synthetic ${subject}` });
  expect(completed.statusCode).toBe(201);
  return completed.json();
}
const decision = (version: number, action = 'approve') => ({ version, decision: action, reason: '合成測試案件，非正式身分驗證', evidenceReference: 'SYNTHETIC-HTTP-TEST-ONLY', independentlyVerified: true, idempotencyKey: randomUUID() });

it('complete HTTP session → affiliation → independent teacher review → student approval → readback → revoke', async () => {
  const teacher = await login('course-teacher'), operator = await login('course-operator'), student = await login('course-student');
  await db.query(`INSERT INTO platform_operator_assignments (platform_account_id,role_key,state) VALUES ($1,'platform-operator','active')`, [operator.platformAccountId]);
  const created = await post('class-workspaces', { title: 'HTTP 合成測試課班', idempotencyKey: randomUUID() }, teacher);
  expect(created.statusCode).toBe(201);
  const workspaceId = created.json().id;
  const plain = await post('course-access/workspace-course', { workspaceId, schoolId: metadata.schoolId }, teacher);
  expect(plain.statusCode).toBe(200); expect(plain.json()).toMatchObject({ status: 'unreviewed', course: null });
  const section = (await db.query<{ id: string }>(`SELECT id FROM sections WHERE tenant_id='campus-demo' ORDER BY id LIMIT 1`)).rows[0]!.id;
  const affiliation = await post(`class-workspaces/${workspaceId}/affiliation-applications`, { tenantId: 'campus-demo', sectionId: section, justification: '獨立測試的正式班次掛靠流程', idempotencyKey: randomUUID() }, teacher);
  expect(affiliation.statusCode).toBe(201);
  expect((await post(`class-workspace-affiliation-applications/${affiliation.json().id}/decision`, { decision: 'approve', reason: '合成掛靠測試，非正式認證', idempotencyKey: randomUUID() }, operator)).statusCode).toBe(200);
  const applied = await post('course-access/teacher-requests', { workspaceId, metadata, statement: 'Synthetic integration test evidence only; not a real teacher identity.', confirmed: true, idempotencyKey: randomUUID() }, teacher);
  expect(applied.statusCode).toBe(200); expect(applied.json().state).toBe('pending');
  expect((await post(`course-access/requests/${applied.json().id}/decide`, decision(1), teacher)).statusCode).toBe(403);
  const approvedTeacher = await post(`course-access/requests/${applied.json().id}/decide`, decision(1), operator);
  expect(approvedTeacher.statusCode).toBe(200); expect(approvedTeacher.json().state).toBe('approved');
  const found = await post('course-access/match', metadata, student);
  expect(found.statusCode).toBe(200);
  const course = found.json().candidates.find((entry: { workspaceId: string }) => entry.workspaceId === workspaceId);
  expect(course).toMatchObject({ verification: 'administrator-reviewed', teacher: metadata.teacher });
  expect((await post('course-access/workspace-course', { workspaceId, schoolId: metadata.schoolId }, student)).statusCode).toBe(404);
  const requested = await post('course-access/student-requests', { courseId: course.id, version: course.version, metadata, confirmed: true, idempotencyKey: randomUUID() }, student);
  expect(requested.statusCode).toBe(200); expect(requested.json().membershipActive).toBe(false);
  const approvedStudent = await post(`course-access/requests/${requested.json().id}/decide`, decision(1), operator);
  expect(approvedStudent.statusCode).toBe(200); expect(approvedStudent.json().membershipActive).toBe(true);
  const readback = await post('course-access/workspace-course', { workspaceId, schoolId: metadata.schoolId }, student);
  expect(readback.statusCode).toBe(200); expect(readback.headers['cache-control']).toBe('no-store');
  expect(readback.json()).toMatchObject({ status: 'reviewed', memberRole: 'student', course: { teacher: metadata.teacher, academicYear: '115' } });
  expect(JSON.stringify(readback.json())).not.toContain('evidence_reference');
  expect((await post('course-access/workspace-course', { workspaceId, schoolId: 'other-school' }, student)).statusCode).toBe(404);
  const revoked = await post(`course-access/requests/${requested.json().id}/decide`, decision(approvedStudent.json().version, 'revoke'), operator);
  expect(revoked.statusCode).toBe(200);
  expect((await post('course-access/workspace-course', { workspaceId, schoolId: metadata.schoolId }, student)).statusCode).toBe(404);
  expect((await post('course-access/match', metadata)).statusCode).toBe(401);
  expect((await post('course-access/match?school=other', metadata, student)).statusCode).toBe(422);
  const counts = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM identity_subjects WHERE id=ANY($1::text[])`, [[teacher.platformAccountId, student.platformAccountId]]);
  expect(counts.rows[0]?.count).toBe(0);
}, 120_000);
