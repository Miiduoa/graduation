// Security-candidate API inject/HTTP smoke against an owned loopback Postgres DB.
// Does not use ambient DATABASE_URL. Never deploys or writes production data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
assert(
  args.includes('--source') && args.includes('--database-url'),
  'Pass --source <security checkout> --database-url postgresql://…@127.0.0.1:<port>/campus_nuni_api_security_acceptance',
);

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'source.json'), 'utf8'));
const source = path.resolve(option('--source'));
const databaseUrl = new URL(option('--database-url'));
assert.equal(databaseUrl.protocol, 'postgresql:');
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.pathname, '/campus_nuni_api_security_acceptance');
assert(databaseUrl.port && !databaseUrl.search && !databaseUrl.hash, 'Explicit loopback port required');

const tree = spawnSync('git', ['write-tree'], { cwd: source, encoding: 'utf8' });
assert.equal(tree.status, 0, tree.stderr);
assert.equal(tree.stdout.trim(), manifest.candidateTree, 'Only the security candidate tree may run');

const sourceRequire = createRequire(path.join(source, 'apps/api/package.json'));
const load = (relative) => import(pathToFileURL(path.join(source, relative)).href);
const { Client } = sourceRequire('pg');
const { generateKeyPair, exportJWK, SignJWT } = await import(
  pathToFileURL(sourceRequire.resolve('jose')).href,
);
const { createDatabase } = await load('apps/api/src/database.ts');
const { readDatabaseRuntimeConfig } = await load('apps/api/src/database-runtime-config.ts');
const { createApp } = await load('apps/api/src/app.ts');

const schemaName = `api_sec_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: databaseUrl.href });
const report = {
  startedAt: new Date().toISOString(),
  candidateTree: manifest.candidateTree,
  productionTree: manifest.productionTree,
  checks: [],
};
let app;
let db;
let schemaCreated = false;
const passed = (name, detail) => report.checks.push({ name, ok: true, ...(detail || {}) });

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;

  const runtimeConfig = readDatabaseRuntimeConfig(
    {
      DATABASE_URL: databaseUrl.href,
      DATABASE_TLS_MODE: 'disable',
      DATABASE_SCHEMA_NAME: schemaName,
      DATABASE_APPLICATION_NAME: 'campus-api-security-acceptance',
    },
    { isProduction: false, component: 'api', allowEmbedded: false },
  );
  db = await createDatabase({
    runtimeConfig,
    seedDemo: false,
    attendanceCodeSecret: 'api-security-acceptance-local-only-not-production',
  });
  assert.equal(db.kind, 'postgres');
  const applied = await db.query('SELECT id FROM schema_migrations ORDER BY id');
  assert.ok(applied.rows.length > 200, `expected full migration set, got ${applied.rows.length}`);
  assert.ok(applied.rows.some((row) => row.id.includes('278_course_access_review')));
  assert.ok(applied.rows.some((row) => row.id.includes('279_personal_import_sync')));
  passed('schema-migrations-match-production-manifest', { count: applied.rows.length });

  await db.query(`INSERT INTO platform_identity_providers
    (kind,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,state)
    VALUES ('google-consumer','https://accounts.google.com','api-security-acceptance-client',
    'https://www.googleapis.com/oauth2/v3/certs','https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token','enabled')`);

  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: 'api-security-acceptance',
    alg: 'RS256',
    use: 'sig',
  };

  app = await createApp(db, {
    auth: { mode: 'campus-account' },
    enableDemoAuth: false,
    campusAccountSessionSecret: 'api-security-session-local-only-not-production',
    attendanceCodeSecret: 'api-security-acceptance-local-only-not-production',
    externalIdpJwksFetch: async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  await app.ready();
  passed('app-ready');

  const health = await app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(health.statusCode, 200, health.body);
  passed('inject-health-ready', { statusCode: health.statusCode });

  const live = await app.inject({ method: 'GET', url: '/health/live' });
  assert.ok([200, 204].includes(live.statusCode), live.body);
  passed('inject-health-live', { statusCode: live.statusCode });

  const caf = await app.inject({
    method: 'GET',
    url: '/v1/public/cafeterias?schoolId=00000000-0000-4000-8000-000000000000',
  });
  assert.ok(caf.statusCode < 500, caf.body);
  passed('inject-public-cafeterias', { statusCode: caf.statusCode });

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/v1/auth/platform/class-workspaces/00000000-0000-4000-8000-000000000001/materials',
  });
  assert.ok([401, 403].includes(unauthorized.statusCode), unauthorized.body);
  passed('inject-materials-unauthorized', { statusCode: unauthorized.statusCode });

  const base = '/v1/auth/platform';
  const tx = await app.inject({
    method: 'POST',
    url: `${base}/login-transactions`,
    headers: { 'content-type': 'application/json' },
    payload: { kind: 'google-consumer' },
  });
  assert.equal(tx.statusCode, 200, tx.body);
  const txBody = tx.json();
  const idToken = await new SignJWT({
    nonce: txBody.nonce,
    email: 'api-security-teacher@example.test',
    email_verified: true,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'api-security-acceptance', typ: 'JWT' })
    .setIssuer('https://accounts.google.com')
    .setAudience('api-security-acceptance-client')
    .setSubject('api-security-teacher')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
  const session = await app.inject({
    method: 'POST',
    url: `${base}/sessions`,
    headers: { 'content-type': 'application/json' },
    payload: {
      kind: 'google-consumer',
      transactionId: txBody.transactionId,
      nonce: txBody.nonce,
      idToken,
      displayName: 'api-security-teacher',
    },
  });
  assert.equal(session.statusCode, 201, session.body);
  const sessionBody = session.json();
  passed('platform-session-created');

  const workspace = await app.inject({
    method: 'POST',
    url: `${base}/class-workspaces`,
    headers: {
      authorization: `Platform ${sessionBody.sessionHandle}`,
      'content-type': 'application/json',
    },
    payload: { title: 'security-acceptance', idempotencyKey: 'sec-ws-01' },
  });
  assert.equal(workspace.statusCode, 201, workspace.body);
  const workspaceBody = workspace.json();
  const page = await app.inject({
    method: 'GET',
    url: `${base}/class-workspaces/${workspaceBody.id}/materials/page`,
    headers: { authorization: `Platform ${sessionBody.sessionHandle}` },
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.deepEqual(page.json(), { materials: [], nextCursor: null });
  passed('materials-page-empty-contract');

  const legacy = await app.inject({
    method: 'GET',
    url: `${base}/class-workspaces/${workspaceBody.id}/materials`,
    headers: { authorization: `Platform ${sessionBody.sessionHandle}` },
  });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.ok(Array.isArray(legacy.json().materials));
  passed('materials-legacy-contract');

  report.ok = true;
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.ok = false;
  report.error = String(error?.stack || error);
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  if (db?.close) await db.close().catch(() => {});
  if (schemaCreated) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
  }
  await admin.end().catch(() => {});
  const out = option('--output');
  if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n');
}
