// Run with the pinned Nuni checkout's tsx loader. This creates and drops only a
// fresh schema in the named loopback acceptance database; it never uses ambient DATABASE_URL.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPinnedNuniSource } from './lib/nuni-course-source.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
assert(
  args.includes('--source') && args.includes('--database-url'),
  'Pass --source <pinned checkout> --database-url <owned loopback acceptance database>',
);
const source = path.resolve(option('--source'));
const databaseUrl = new URL(option('--database-url'));
assert.equal(databaseUrl.protocol, 'postgresql:');
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.pathname, '/campus_nuni_import_acceptance');
assert(
  databaseUrl.port && !databaseUrl.search && !databaseUrl.hash,
  'Explicit loopback port required',
);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(repository, 'deploy/nuni-api/composed/source.json'), 'utf8'),
);
const tree = assertPinnedNuniSource(source, manifest.candidateTree);
const sourceRequire = createRequire(path.join(source, 'apps/api/package.json'));
const load = (relative) => import(pathToFileURL(path.join(source, relative)).href);
const { Client } = sourceRequire('pg');
const { generateKeyPair, exportJWK, SignJWT } = await import(
  pathToFileURL(sourceRequire.resolve('jose')).href
);
const { createDatabase } = await load('apps/api/src/database.ts');
const { readDatabaseRuntimeConfig } = await load('apps/api/src/database-runtime-config.ts');
const { createApp } = await load('apps/api/src/app.ts');
const schemaName = `import_accept_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: databaseUrl.href });
const report = {
  startedAt: new Date().toISOString(),
  candidateTreeManifest: 'deploy/nuni-api/composed/source.json',
  candidateTree: tree,
  authMode: 'campus-account',
  demoAuthEnabled: false,
  seedDemo: false,
  identityProvider: 'Isolated RS256 test keys; real nonce, signature, account and session handlers',
  transport: 'loopback HTTP',
  database: 'PostgreSQL',
  checks: [],
  observations: [],
};
let app;
let db;
let schemaCreated = false;
let origin;
let requestCount = 0;
async function request(method, route, session, payload, expected = 200) {
  ++requestCount;
  const response = await fetch(`${origin}${route}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(session ? { Authorization: `Platform ${session.sessionHandle}` } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const value = await response.json();
  // Do not print successful session responses, bearer handles or ID tokens.
  assert.equal(
    response.status,
    expected,
    `${method} ${route}: ${value?.error?.code || response.status}`,
  );
  return value;
}
const passed = (name) => report.checks.push(name);

try {
  await admin.connect();
  report.postgresVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;
  const runtimeConfig = readDatabaseRuntimeConfig(
    {
      DATABASE_URL: databaseUrl.href,
      DATABASE_TLS_MODE: 'disable',
      DATABASE_SCHEMA_NAME: schemaName,
      DATABASE_APPLICATION_NAME: 'campus-course-acceptance',
    },
    { isProduction: false, component: 'api', allowEmbedded: false },
  );
  db = await createDatabase({
    runtimeConfig,
    seedDemo: false,
    attendanceCodeSecret: 'course-acceptance-local-only-not-production',
  });
  assert.equal(db.kind, 'postgres');
  await db.query(`INSERT INTO platform_identity_providers
    (kind,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,state)
    VALUES ('google-consumer','https://accounts.google.com','course-acceptance-client',
    'https://www.googleapis.com/oauth2/v3/certs','https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token','enabled')`);
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: 'course-acceptance',
    alg: 'RS256',
    use: 'sig',
  };
  process.env.CAMPUS_COURSE_ACCESS_ENABLED = 'true';
  process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED = 'true';
  app = await createApp(db, {
    auth: { mode: 'campus-account' },
    enableDemoAuth: false,
    campusAccountSessionSecret: 'course-acceptance-session-local-only-not-production',
    attendanceCodeSecret: 'course-acceptance-local-only-not-production',
    externalIdpJwksFetch: async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const base = '/v1/auth/platform';
  async function login(subject) {
    const tx = await request('POST', `${base}/login-transactions`, null, {
      kind: 'google-consumer',
    });
    const idToken = await new SignJWT({
      nonce: tx.nonce,
      email: `${subject}@example.test`,
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'course-acceptance', typ: 'JWT' })
      .setIssuer('https://accounts.google.com')
      .setAudience('course-acceptance-client')
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    return request(
      'POST',
      `${base}/sessions`,
      null,
      {
        kind: 'google-consumer',
        transactionId: tx.transactionId,
        nonce: tx.nonce,
        idToken,
        displayName: subject,
      },
      201,
    );
  }
  const teacher = await login('import-acceptance-teacher');
  const operator = await login('import-acceptance-operator');
  const student = await login('import-acceptance-student');
  const secondSession = await login('import-acceptance-student');
  const outsider = await login('import-acceptance-outsider');
  assert.equal(student.platformAccountId, secondSession.platformAccountId);
  assert.notEqual(student.sessionHandle, secondSession.sessionHandle);
  passed('Two separately signed logins issue independent sessions for the same account');
  // Only the disposable schema receives synthetic school fixtures. These are not real school attestations.
  const schoolId = 'import-acceptance-school';
  await db.query(
    `INSERT INTO tenants (id,display_name,state,directory_source)
    VALUES ($1,'Synthetic import acceptance school','open','manual')`,
    [schoolId],
  );
  await db.query(
    `INSERT INTO courses (tenant_id,id,code,name,credits) VALUES ($1,'acceptance-course','TEST301','合成資料庫課程',3)`,
    [schoolId],
  );
  await db.query(
    `INSERT INTO sections (tenant_id,id,course_id,term,instructor,room,starts_at,ends_at,capacity,enrollment_opens_at,enrollment_closes_at,drop_deadline)
    VALUES ($1,'acceptance-section','acceptance-course','115-1','合成測試教師','測試教室',now()+interval '30 days',now()+interval '30 days 2 hours',10,now()-interval '1 day',now()+interval '7 days',now()+interval '8 days')`,
    [schoolId],
  );
  await db.query(
    `INSERT INTO platform_operator_assignments (platform_account_id,role_key,state)
    VALUES ($1,'platform-operator','active')`,
    [operator.platformAccountId],
  );
  const workspace = await request(
    'POST',
    `${base}/class-workspaces`,
    teacher,
    { title: '合成匯入驗收課班', idempotencyKey: randomUUID() },
    201,
  );
  const course = `${base}/class-workspaces/${workspace.id}`;
  const affiliation = await request(
    'POST',
    `${course}/affiliation-applications`,
    teacher,
    {
      tenantId: schoolId,
      sectionId: 'acceptance-section',
      justification: 'Synthetic isolated acceptance only',
      idempotencyKey: randomUUID(),
    },
    201,
  );
  await request(
    'POST',
    `${base}/class-workspace-affiliation-applications/${affiliation.id}/decision`,
    operator,
    { decision: 'approve', reason: 'Synthetic isolated test only', idempotencyKey: randomUUID() },
  );
  const metadata = {
    schoolId,
    academicYear: '115',
    semester: '1',
    title: '合成資料庫課程',
    courseCode: 'TEST301',
    teacher: '合成測試教師',
    className: '測試班',
  };
  const decision = (version, action = 'approve') => ({
    version,
    decision: action,
    reason: '合成驗收資料，非正式身份認證',
    evidenceReference: 'SYNTHETIC-IMPORT-ACCEPTANCE-ONLY',
    independentlyVerified: true,
    idempotencyKey: randomUUID(),
  });
  const teacherRequest = await request('POST', `${base}/course-access/teacher-requests`, teacher, {
    workspaceId: workspace.id,
    metadata,
    statement: 'Synthetic test only. No real school identity is certified.',
    confirmed: true,
    idempotencyKey: randomUUID(),
  });
  await request(
    'POST',
    `${base}/course-access/requests/${teacherRequest.id}/decide`,
    teacher,
    decision(1),
    403,
  );
  await request(
    'POST',
    `${base}/course-access/requests/${teacherRequest.id}/decide`,
    operator,
    decision(1),
  );
  const matches = await request('POST', `${base}/course-access/match`, student, metadata);
  const candidate = matches.candidates.find((item) => item.workspaceId === workspace.id);
  assert.equal(candidate.teacher, metadata.teacher);
  assert.equal(candidate.verification, 'administrator-reviewed');
  const studentRequest = await request('POST', `${base}/course-access/student-requests`, student, {
    courseId: candidate.id,
    version: candidate.version,
    metadata,
    confirmed: true,
    idempotencyKey: randomUUID(),
  });
  assert.equal(studentRequest.membershipActive, false);
  await request(
    'POST',
    `${base}/course-access/workspace-course`,
    student,
    { schoolId, workspaceId: workspace.id },
    404,
  );
  const studentApproval = await request(
    'POST',
    `${base}/course-access/requests/${studentRequest.id}/decide`,
    operator,
    decision(1),
  );
  assert.equal(studentApproval.membershipActive, true);
  const reviewed = await request('POST', `${base}/course-access/workspace-course`, student, {
    schoolId,
    workspaceId: workspace.id,
  });
  assert.equal(reviewed.course.teacher, metadata.teacher);
  passed(
    'Teacher affiliation and independent review precede student approval and verified teacher readback',
  );
  const row = {
    id: `acceptance-${randomUUID()}`,
    batchId: `acceptance-${randomUUID()}`,
    importedAt: new Date().toISOString(),
    kind: 'grades',
    ...metadata,
    credits: 3,
    grade: '90',
    linkedCourseId: workspace.id,
    source: {
      type: 'file',
      name: 'synthetic-import.xlsx',
      line: 1,
      rawText: 'TEST301,合成資料庫課程,90',
    },
  };
  const route = `${base}/personal-imports`;
  const read = (actor) => request('POST', `${route}/read`, actor, { schoolId });
  const first = { schoolId, expectedRevision: 0, mutationId: randomUUID(), records: [row] };
  await request('POST', `${route}/read`, null, { schoolId }, 401);
  await request(
    'POST',
    `${route}/write`,
    student,
    { ...first, ownerId: outsider.platformAccountId },
    422,
  );
  assert.equal((await request('POST', `${route}/write`, student, first)).revision, 1);
  assert.deepEqual((await read(secondSession)).records, [row]);
  assert.deepEqual((await read(outsider)).records, []);
  const revision2 = {
    ...first,
    expectedRevision: 1,
    mutationId: randomUUID(),
    records: [{ ...row, grade: '91' }],
  };
  assert.equal((await request('POST', `${route}/write`, student, revision2)).revision, 2);
  const stale = await request(
    'POST',
    `${route}/write`,
    secondSession,
    { ...revision2, mutationId: randomUUID(), records: [{ ...row, grade: '92' }] },
    409,
  );
  assert.equal(stale.error.code, 'PERSONAL_IMPORT_REVISION_CONFLICT');
  assert.equal((await read(secondSession)).records[0].grade, '91');
  passed(
    'Full HTTP API preserves two-session changes, rejects stale writes, and isolates other accounts',
  );
  await request(
    'POST',
    `${base}/course-access/requests/${studentRequest.id}/decide`,
    operator,
    decision(studentApproval.version, 'revoke'),
  );
  const detached = await read(secondSession);
  assert.equal(detached.records[0].linkedCourseId, undefined);
  assert.equal(detached.records[0].teacher, metadata.teacher);
  assert.equal(detached.records[0].grade, '91');
  assert.deepEqual(detached.detachedCourseLinks, [row.id]);
  passed(
    'Revoking reviewed course access detaches its reference while retaining personal grades and teacher text',
  );
  const deletion = await request('POST', `${route}/write`, secondSession, {
    schoolId,
    expectedRevision: 2,
    mutationId: randomUUID(),
    records: [],
  });
  assert.equal(deletion.revision, 3);
  assert.deepEqual((await read(student)).records, []);
  const retry = await request('POST', `${route}/write`, student, first);
  assert.equal(retry.revision, 3);
  assert.deepEqual(retry.records, []);
  passed(
    'Deletion reaches the second session and delayed mutation retry cannot resurrect deleted records',
  );
  await request('POST', `${base}/logout`, secondSession, {});
  await request('POST', `${route}/read`, secondSession, { schoolId }, 401);
  assert.equal((await read(student)).revision, 3);
  passed('Logging out one session revokes it while the other account session remains usable');
  report.runtimePrivileges = [];
  for (const table of [
    'personal_import_ledgers',
    'personal_import_mutations',
    'course_access_requests',
    'course_access_directory',
    'course_access_idempotency',
    'course_access_audit',
  ]) {
    const grants = (
      await db.query(
        `SELECT has_table_privilege(current_user,$1,'SELECT') AS select,
      has_table_privilege(current_user,$1,'INSERT') AS insert,has_table_privilege(current_user,$1,'UPDATE') AS update,
      has_table_privilege(current_user,$1,'DELETE') AS delete`,
        [`${schemaName}.${table}`],
      )
    ).rows[0];
    assert.equal(grants.select, true);
    assert.equal(grants.insert, true);
    report.runtimePrivileges.push({ table, ...grants });
  }
  report.migrations = (
    await db.query('SELECT id,checksum FROM schema_migrations ORDER BY id')
  ).rows;
  assert(report.migrations.some((item) => item.id === '279_personal_import_sync'));
  report.productionVerified = false;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.schemaRemoved = false;
  report.cleanupErrors = [];
  for (const cleanup of [
    () => app?.close(),
    () => db?.close(),
    async () => {
      if (schemaCreated) {
        // The full schema has thousands of dependent objects. Drop owned tables in
        // bounded transactions so small local PostgreSQL lock tables can clean up.
        const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
        const tables = (
          await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schemaName])
        ).rows;
        for (const { tablename } of tables)
          await admin.query(
            `DROP TABLE IF EXISTS ${quote(schemaName)}.${quote(tablename)} CASCADE`,
          );
        await admin.query(`DROP SCHEMA ${quote(schemaName)} CASCADE`);
        report.schemaRemoved = true;
      }
    },
    () => admin.end(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      report.cleanupErrors.push(error instanceof Error ? error.message : String(error));
      report.status = 'failed';
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  report.httpRequests = requestCount;
  if (args.includes('--output'))
    await writeFile(path.resolve(option('--output')), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ ...report, migrations: report.migrations?.length }, null, 2)}\n`,
  );
}
