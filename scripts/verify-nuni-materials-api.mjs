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
assert.equal(databaseUrl.pathname, '/campus_nuni_materials_acceptance');
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
const schemaName = `materials_accept_${randomUUID().replaceAll('-', '')}`;
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
  const teacher = await login('materials-teacher');
  const student = await login('materials-student');
  const outsider = await login('materials-outsider');
  const workspace = await request('POST', `${base}/class-workspaces`, teacher,
    { title: '完整教材分頁驗收', idempotencyKey: 'ws-key-01' }, 201);
  const course = `${base}/class-workspaces/${workspace.id}`;
  const invite = await request('POST', `${course}/invites`, teacher,
    { idempotencyKey: 'inv-key-01' }, 201);
  await request('POST', `${base}/class-workspaces/join`, student,
    { code: invite.code, idempotencyKey: 'jn-key-01' }, 201);
  const other = await request('POST', `${base}/class-workspaces`, teacher,
    { title: '另一個課程', idempotencyKey: 'ws-key-02' }, 201);
  const otherPage = `${base}/class-workspaces/${other.id}/materials/page`;
  assert.deepEqual(await request('GET', otherPage, teacher), { materials: [], nextCursor: null });
  passed('Signed teacher/student sessions use the real course membership and empty page HTTP path');

  // Deliberately share milliseconds and tie every three timestamps. Rounding the
  // cursor through Date would skip the remaining 170 rows after the first page.
  await db.query(`INSERT INTO class_workspace_materials
    (id,workspace_id,title,body,created_by_platform_account_id,created_at)
    SELECT 'cwm_00000000-0000-4000-8000-' || lpad(i::text,12,'0'), $1,
      '教材 ' || i::text, '隔離驗收內容 ' || i::text, $2,
      '2026-01-01T00:00:00.123000Z'::timestamptz + (i / 3) * interval '1 microsecond'
    FROM generate_series(1,220) AS i`, [workspace.id, teacher.platformAccountId]);
  const expected = (await db.query(`SELECT id FROM class_workspace_materials
    WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC`, [workspace.id])).rows.map(row => row.id);
  const legacy = await request('GET', `${course}/materials`, student);
  assert.deepEqual(Object.keys(legacy), ['materials']);
  assert.deepEqual(legacy.materials.map(row => row.id), expected.slice(0,100));
  passed('Legacy materials keeps its original response and most-recent 100 ordering');

  const pagePath = `${course}/materials/page`;
  const first = await request('GET', pagePath, student);
  assert.equal(first.materials.length,50);
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]{1,500}$/);
  const cursorState = JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8'));
  assert.equal(cursorState.t, '2026-01-01T00:00:00.123057Z');
  const newer = await request('POST', `${course}/materials`, teacher,
    { title: '翻頁期間新發布', body: '下一次更新首屏顯示', idempotencyKey: 'ilv-key-01' },201);
  let page = first;
  const ids = first.materials.map(row => row.id);
  let pageCount = 1;
  while (page.nextCursor !== null) {
    assert.ok(pageCount < 10, 'cursor traversal must terminate');
    const suffix = `?cursor=${page.nextCursor}`;
    const next = await request('GET', pagePath + suffix, student);
    assert.deepEqual(await request('GET', pagePath + suffix, student), next, 'retry is the same ordered page');
    assert.ok(next.materials.length <= 50);
    ids.push(...next.materials.map(row => row.id));
    page=next; pageCount++;
  }
  assert.equal(pageCount,5);
  assert.deepEqual(ids,expected);
  assert.equal(new Set(ids).size,220);
  assert.ok(!ids.includes(newer.id));
  assert.equal((await request('GET',pagePath,student)).materials[0].id,newer.id);
  report.materialCount=ids.length; report.pageCount=pageCount;
  passed('220 real PostgreSQL rows traverse exactly once over five pages, including subms boundaries and timestamp/ID ties');
  passed('New publication between pages does not shift or duplicate the traversal; refresh sees it; retry is stable');

  for (const cursor of ['', 'e30', 'x'.repeat(501), first.nextCursor+'=',
    Buffer.from(JSON.stringify({...cursorState,t:'0000-01-01T00:00:00.123456Z'})).toString('base64url'),
    Buffer.from(JSON.stringify({...cursorState,t:'2026-02-31T00:00:00.123456Z'})).toString('base64url')])
    await request('GET', `${pagePath}?cursor=${encodeURIComponent(cursor)}`, student, undefined,422);
  await request('GET',`${pagePath}?cursor=${first.nextCursor}&cursor=${first.nextCursor}`,student,undefined,422);
  await request('GET',`${pagePath}?owner=other`,student,undefined,422);
  await request('GET',`${otherPage}?cursor=${first.nextCursor}`,teacher,undefined,422);
  await request('GET',pagePath,outsider,undefined,404);
  await request('GET',`${pagePath}?cursor=${first.nextCursor}`,outsider,undefined,404);
  await request('GET',pagePath,null,undefined,401);
  passed('Malformed/oversized/noncanonical/duplicate/unknown/cross-course cursors fail; outsiders and guests cannot read');

  // Membership changes use fixture SQL because self-service co-teacher assignment
  // and ownership operations are a separate product task, not part of pagination.
  await db.query(`INSERT INTO class_workspace_members(workspace_id,platform_account_id,role,state)
    VALUES($1,$2,'co-teacher','active')`,[workspace.id,outsider.platformAccountId]);
  assert.deepEqual((await request('GET',pagePath,outsider)).materials,(await request('GET',pagePath,teacher)).materials);
  await db.query(`UPDATE class_workspaces SET state='archived',archived_at=now() WHERE id=$1`,[workspace.id]);
  assert.equal((await request('GET',`${pagePath}?cursor=${first.nextCursor}`,student)).materials.length,50);
  await db.query(`UPDATE class_workspace_members SET state='removed',removed_at=now()
    WHERE workspace_id=$1 AND platform_account_id=$2`,[workspace.id,student.platformAccountId]);
  await request('GET',`${pagePath}?cursor=${first.nextCursor}`,student,undefined,404);
  await request('GET',pagePath,student,undefined,404);
  await db.query(`UPDATE class_workspace_members SET state='removed',removed_at=now()
    WHERE workspace_id=$1 AND platform_account_id=$2`,[workspace.id,outsider.platformAccountId]);
  await request('GET',`${pagePath}?cursor=${first.nextCursor}`,outsider,undefined,404);
  passed('Owner/co-teacher/student can read; archives stay readable; removed members lose next-page and first-page access');
  await request('POST',`${base}/logout`,teacher,{});
  await request('GET',`${pagePath}?cursor=${first.nextCursor}`,teacher,undefined,401);
  passed('Logout revokes the real platform session before any next-page read');
  report.status='passed';
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
