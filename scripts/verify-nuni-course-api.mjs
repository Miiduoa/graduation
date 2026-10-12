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
assert.equal(databaseUrl.pathname, '/campus_nuni_course_acceptance');
assert(
  databaseUrl.port && !databaseUrl.search && !databaseUrl.hash,
  'Explicit loopback port required',
);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(repository, 'deploy/nuni-api/source.json'), 'utf8'),
);
for (const patch of manifest.patches) {
  const bytes = await readFile(path.join(repository, 'deploy/nuni-api/patches', patch.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), patch.sha256);
}
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
const schemaName = `course_accept_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: databaseUrl.href });
const report = {
  startedAt: new Date().toISOString(),
  candidateCommit: manifest.candidateCommit,
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
  const teacher = await login('acceptance-teacher');
  const student = await login('acceptance-student');
  const outsider = await login('acceptance-outsider');
  assert.equal(new Set([teacher, student, outsider].map((item) => item.platformAccountId)).size, 3);
  passed('Three distinct signed identities complete the real platform account/session HTTP flow');
  const workspace = await request(
    'POST',
    `${base}/class-workspaces`,
    teacher,
    { title: '課程驗收', idempotencyKey: 'course-accept-create-0001' },
    201,
  );
  const course = `${base}/class-workspaces/${workspace.id}`;
  assert.equal(workspace.memberRole, 'owner-teacher');
  const invite = await request(
    'POST',
    `${course}/invites`,
    teacher,
    { idempotencyKey: 'course-accept-invite-0001' },
    201,
  );
  const joined = await request(
    'POST',
    `${base}/class-workspaces/join`,
    student,
    { code: invite.code, idempotencyKey: 'course-accept-join-0001' },
    201,
  );
  assert.equal(joined.memberRole, 'student');
  await request('GET', course, outsider, undefined, 404);
  passed('Teacher creates a workspace; student joins by its real invite; outsider is denied');

  for (const kind of ['assignments', 'quizzes']) {
    const quiz = kind === 'quizzes';
    const textField = quiz ? 'answer' : 'body';
    const receiptField = quiz ? 'myResponse' : 'mySubmission';
    const countField = quiz ? 'responseCount' : 'submissionCount';
    const collection = quiz ? 'responses' : 'submissions';
    const activity = await request(
      'POST',
      `${course}/${kind}`,
      teacher,
      {
        title: quiz ? '驗收文字測驗' : '驗收作業',
        [quiz ? 'prompt' : 'instructions']: '說明你的觀察',
        idempotencyKey: `${kind}-publish-0001`,
      },
      201,
    );
    const activityPath = `${course}/${kind}/${activity.id}`;
    const feedbackPath = `${activityPath}/${collection}/${student.platformAccountId}/feedback`;
    await request(
      'POST',
      `${course}/${kind}`,
      student,
      {
        title: '不應發布',
        [quiz ? 'prompt' : 'instructions']: '學生越權',
        idempotencyKey: `${kind}-denied-publish`,
      },
      403,
    );
    await request(
      'POST',
      `${activityPath}/submit`,
      teacher,
      { [textField]: '老師不能當學生繳交', idempotencyKey: `${kind}-denied-submit` },
      403,
    );
    const initial = { [textField]: '第一份內容', idempotencyKey: `${kind}-submit-0001` };
    const receipts = await Promise.all(
      [0, 1].map(() => request('POST', `${activityPath}/submit`, student, initial)),
    );
    assert.deepEqual(receipts[0][receiptField], receipts[1][receiptField]);
    assert.equal(receipts[0][countField], 1);
    const receipt = receipts[0][receiptField];
    assert.equal(receipt[textField], initial[textField]);
    assert.equal(receipt.platformAccountId, student.platformAccountId);
    assert(Number.isFinite(Date.parse(receipt.submittedAt)));
    const stored = await db.query(
      `SELECT count(*)::int AS count FROM ${quiz ? 'class_workspace_quiz_responses' : 'class_workspace_assignment_submissions'}
      WHERE ${quiz ? 'quiz_id' : 'assignment_id'}=$1 AND platform_account_id=$2`,
      [activity.id, student.platformAccountId],
    );
    assert.equal(stored.rows[0].count, 1);
    await request('GET', `${activityPath}/${collection}`, student, undefined, 403);
    await request(
      'POST',
      feedbackPath,
      student,
      { feedback: '越權回饋', idempotencyKey: `${kind}-denied-feedback` },
      403,
    );
    const feedback = await request('POST', feedbackPath, teacher, {
      feedback: '針對第一份內容的回饋',
      idempotencyKey: `${kind}-feedback-0001`,
    });
    assert.equal(feedback.teacherFeedback, '針對第一份內容的回饋');
    assert(Number.isFinite(Date.parse(feedback.reviewedAt)));
    const listed = await request('GET', `${course}/${kind}`, student);
    assert.equal(
      listed[kind].find((item) => item.id === activity.id)[receiptField].teacherFeedback,
      feedback.teacherFeedback,
    );
    passed(
      `${kind}: publish → concurrent same-key submit → one durable receipt → teacher feedback → student reload; role denials hold`,
    );

    const changed = await request('POST', `${activityPath}/submit`, student, {
      [textField]: '更新後的第二份內容',
      idempotencyKey: `${kind}-submit-0002`,
    });
    assert.equal(changed[receiptField][textField], '更新後的第二份內容');
    assert.equal(changed[countField], 1);
    const retriedOld = await request('POST', `${activityPath}/submit`, student, initial);
    assert.equal(retriedOld[receiptField][textField], '更新後的第二份內容');
    report.observations.push({
      kind,
      resubmitSupported: true,
      previousFeedbackRetained: changed[receiptField].teacherFeedback === feedback.teacherFeedback,
      previousReviewTimestampRetained: changed[receiptField].reviewedAt === feedback.reviewedAt,
      oldKeyReturnsCurrentContent: true,
    });
    const feedback2 = await request('POST', feedbackPath, teacher, {
      feedback: '第二份內容的回饋',
      idempotencyKey: `${kind}-feedback-0002`,
    });
    const oldFeedbackRetry = await request('POST', feedbackPath, teacher, {
      feedback: '不應覆盖新回饋',
      idempotencyKey: `${kind}-feedback-0001`,
    });
    assert.equal(oldFeedbackRetry.teacherFeedback, feedback2.teacherFeedback);
    passed(`${kind}: new keys update content/feedback; old keys preserve the latest saved content`);
    const closed = await request('POST', `${activityPath}/close`, teacher, {});
    assert.equal(closed.state, 'closed');
    await request(
      'POST',
      `${activityPath}/submit`,
      student,
      { [textField]: '關閉後更新', idempotencyKey: `${kind}-after-close-0001` },
      409,
    );
    await request('POST', `${activityPath}/submit`, student, initial, 409);
    const closedList = await request('GET', `${course}/${kind}`, student);
    const saved = closedList[kind].find((item) => item.id === activity.id)[receiptField];
    assert.equal(saved[textField], '更新後的第二份內容');
    assert.equal(saved.teacherFeedback, feedback2.teacherFeedback);
    passed(
      `${kind}: closing rejects writes and old-key retries while GET retains saved content and feedback`,
    );
  }
  await request('POST', `${base}/logout`, student, {});
  await request('GET', `${base}/sessions/current`, student, undefined, 401);
  await request('GET', `${course}/assignments`, student, undefined, 401);
  passed('Logout revokes the session at the real HTTP boundary');
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
        await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
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
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
