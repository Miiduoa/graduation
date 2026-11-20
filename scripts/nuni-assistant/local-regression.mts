import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const root = process.cwd();
const require = createRequire(root + '/apps/api/package.json');
const { Pool } = require('pg');
const { createDatabase } = await import(root + '/apps/api/src/database.ts');
const { readDatabaseRuntimeConfig } = await import(
  root + '/apps/api/src/database-runtime-config.ts'
);
const { createApp, isPublicApiRoute } = await import(root + '/apps/api/src/app.ts');
const url = process.env.NUNI_ASSISTANT_LOCAL_DB!;
// The launcher validates this before any connection; independently reject all other destinations.
const parsed = new URL(url);
assert.equal(parsed.hostname, '127.0.0.1');
assert.equal(parsed.port, '55432');
assert.equal(parsed.username, 'nuni_test');
assert.equal(parsed.password, '');
assert.equal(parsed.search, '');
const admin = new Pool({ connectionString: url, ssl: false });
const schema = 'assistant_test_' + randomUUID().replaceAll('-', '');
const secret = 'synthetic-local-regression-secret-over-32-characters';
let db: any;
const apps: any[] = [];
try {
  assert.match((await admin.query('SHOW server_version')).rows[0].server_version, /^17\./);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const runtimeConfig = readDatabaseRuntimeConfig(
    {
      DATABASE_URL: url,
      DATABASE_SCHEMA_NAME: schema,
      DATABASE_TLS_MODE: 'disable',
      DATABASE_TRUSTED_SIDECAR: 'true',
    },
    { isProduction: true, component: 'migrate', allowEmbedded: false },
  );
  db = await createDatabase({ runtimeConfig, attendanceCodeSecret: secret });
  assert.ok(Number((await db.query('SELECT count(*) FROM schema_migrations')).rows[0].count) > 200);
  const prefix = '/v1/auth/platform/assistant/';
  const options = {
    auth: { mode: 'campus-account' },
    attendanceCodeSecret: secret,
    campusAccountSessionSecret: secret + ':campus',
  };
  const app = await createApp(db, options);
  apps.push(app);
  await app.ready();
  const account = 'pa_' + randomUUID(),
    credential = 'pac_' + randomUUID();
  const second = 'pa_' + randomUUID(),
    secondCredential = 'pac_' + randomUUID();
  const handle = 'ps_' + 't'.repeat(43),
    otherHandle = 'ps_' + 'u'.repeat(43);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  for (const [id, cid, token] of [
    [account, credential, handle],
    [second, secondCredential, otherHandle],
  ]) {
    await db.query(
      'INSERT INTO platform_accounts (id,display_name,primary_email) VALUES ($1,$2,$3)',
      [id, '合成王小明', 'synthetic-private@example.test'],
    );
    await db.query(
      `INSERT INTO platform_account_credentials
      (id,platform_account_id,method,provider_issuer,provider_subject,email_at_registration,verified_at,last_authenticated_at)
      VALUES ($1,$2,'google','https://synthetic.invalid',$3,$4,now(),now())`,
      [cid, id, id, 'synthetic-private@example.test'],
    );
    await db.query(
      `INSERT INTO platform_account_sessions (token_sha256,platform_account_id,credential_id,expires_at)
      VALUES ($1,$2,$3,now()+interval '1 hour')`,
      [hash(token), id, cid],
    );
  }
  const headers = { authorization: 'Platform ' + handle };
  const capability = () => app.inject({ url: prefix + 'capability', headers });
  assert.equal((await capability()).statusCode, 200, 'active session');
  await db.query('DELETE FROM platform_account_sessions WHERE token_sha256=$1', [hash(handle)]);
  assert.equal((await capability()).statusCode, 401, 'revoked session');
  await db.query(
    `INSERT INTO platform_account_sessions (token_sha256,platform_account_id,credential_id,created_at,expires_at)
    VALUES ($1,$2,$3,now()-interval '2 hours',now()-interval '1 hour')`,
    [hash(handle), account, credential],
  );
  assert.equal((await capability()).statusCode, 401, 'expired session');
  await db.query(
    "UPDATE platform_account_sessions SET expires_at=now()+interval '1 hour' WHERE token_sha256=$1",
    [hash(handle)],
  );
  await db.query("UPDATE platform_accounts SET state='suspended',suspended_at=now() WHERE id=$1", [
    account,
  ]);
  assert.equal((await capability()).statusCode, 401, 'suspended account');
  await db.query("UPDATE platform_accounts SET state='active',suspended_at=NULL WHERE id=$1", [
    account,
  ]);
  await db.query(
    "UPDATE platform_account_credentials SET state='revoked',revoked_at=now() WHERE id=$1",
    [credential],
  );
  assert.equal((await capability()).statusCode, 401, 'revoked credential');
  await db.query(
    "UPDATE platform_account_credentials SET state='active',revoked_at=NULL WHERE id=$1",
    [credential],
  );
  for (const method of ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
    for (const name of ['capability', 'preview', 'ask', 'route', 'execute', 'enqueue']) {
      assert.equal(
        isPublicApiRoute(method, prefix + name),
        (method === 'GET' && name === 'capability') || (method === 'POST' && name !== 'capability'),
      );
    }
    for (const path of [
      'capability/',
      'capability/extra',
      'capability%2f',
      'unknown',
      '../capability',
    ])
      assert.equal(isPublicApiRoute(method, prefix + path), false);
  }
  assert.equal(
    (await app.inject({ url: '/v1/me', headers })).statusCode,
    401,
    'global guard still authenticates existing API',
  );
  assert.equal((await app.inject({ url: prefix + 'capability' })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'HEAD', url: prefix + 'capability', headers })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: prefix + 'capability?unexpected=1', headers })).statusCode,
    422,
  );
  for (const action of ['preview', 'ask', 'route', 'execute', 'enqueue']) {
    assert.equal((await app.inject({ method: 'POST', url: prefix + action })).statusCode, 401);
  }
  for (const action of ['execute', 'enqueue']) {
    assert.equal(
      (await app.inject({ method: 'POST', url: prefix + action, headers })).statusCode,
      403,
    );
  }
  const bodyAtLimit = JSON.stringify({
    question: 'x'.repeat(8192 - JSON.stringify({ question: '' }).length),
  });
  assert.equal(Buffer.byteLength(bodyAtLimit), 8192);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: prefix + 'preview',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: bodyAtLimit,
      })
    ).statusCode,
    422,
  );
  const bodyOverLimit = bodyAtLimit.replace('xxx', 'xxxx');
  assert.equal(Buffer.byteLength(bodyOverLimit), 8193);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: prefix + 'preview',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: bodyOverLimit,
      })
    ).statusCode,
    413,
  );
  const text = '合成王小明 S123456789 synthetic-private@example.test 原文唯一標記 圖書館';
  const preview = await app.inject({
    method: 'POST',
    url: prefix + 'preview',
    headers,
    payload: { schoolId: 'pu', question: text },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: prefix + 'preview',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: '{"question": broken}',
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: prefix + 'preview',
        headers,
        payload: { question: text.repeat(1000) },
      })
    ).statusCode,
    413,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: prefix + 'ask',
        headers,
        payload: {
          schoolId: 'pu',
          intent: preview.json().intent,
          confirmation: preview.json().confirmation,
          consent: true,
        },
      })
    ).statusCode,
    503,
  );
  // Account quota spans sessions and route actions, but never shares BFF egress quotas between accounts.
  const limited = await createApp(db, options);
  apps.push(limited);
  for (let i = 0; i < 30; i++)
    assert.equal((await limited.inject({ url: prefix + 'capability', headers })).statusCode, 200);
  assert.equal((await limited.inject({ url: prefix + 'capability', headers })).statusCode, 429);
  assert.equal(
    (
      await limited.inject({
        url: prefix + 'capability',
        headers: { authorization: 'Platform ' + otherHandle },
      })
    ).statusCode,
    200,
  );
  const newHandle = 'ps_' + 'v'.repeat(43);
  await db.query(
    `INSERT INTO platform_account_sessions (token_sha256,platform_account_id,credential_id,expires_at)
    VALUES ($1,$2,$3,now()+interval '1 hour')`,
    [hash(newHandle), account, credential],
  );
  assert.equal(
    (
      await limited.inject({
        url: prefix + 'capability',
        headers: { authorization: 'Platform ' + newHandle, 'x-forwarded-for': '192.0.2.8' },
      })
    ).statusCode,
    429,
  );
  // The much larger IP quota runs onRequest, including unauthenticated traffic, before session parsing.
  for (let i = 0; i < 600; i++)
    assert.equal(
      (await limited.inject({ url: prefix + 'capability', remoteAddress: '192.0.2.10' }))
        .statusCode,
      401,
    );
  assert.equal(
    (
      await limited.inject({
        url: prefix + 'capability',
        remoteAddress: '192.0.2.10',
        headers: { 'x-forwarded-for': '198.51.100.8' },
      })
    ).statusCode,
    429,
  );
  const trusted = await createApp(db, { ...options, trustedProxyCidrs: ['127.0.0.1/32'] });
  apps.push(trusted);
  let observed = '';
  trusted.addHook('onRequest', async (request: any) => {
    observed = request.ip;
  });
  await trusted.ready();
  await trusted.inject({
    url: prefix + 'capability',
    remoteAddress: '192.0.2.20',
    headers: { 'x-forwarded-for': '198.51.100.8' },
  });
  assert.equal(observed, '192.0.2.20', 'untrusted peer cannot spoof forwarding headers');
  await trusted.inject({
    url: prefix + 'capability',
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': '198.51.100.8' },
  });
  assert.equal(observed, '198.51.100.8', 'explicitly trusted proxy is honored');
  process.env.CAMPUS_ASSISTANT_ENABLED = 'false';
  assert.equal(isPublicApiRoute('GET', prefix + 'capability'), false);
  const disabled = await createApp(db, options);
  apps.push(disabled);
  assert.notEqual((await disabled.inject({ url: prefix + 'capability', headers })).statusCode, 200);
  console.log('LOCAL_REGRESSION_OK');
} finally {
  for (const app of apps) await app.close();
  if (db) await db.close();
  // Drop tables in separate transactions to fit the local server's lock budget.
  const tables = await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema]);
  for (const { tablename } of tables.rows) {
    const name = '"' + tablename.replaceAll('"', '""') + '"';
    await admin.query(`DROP TABLE IF EXISTS ${schema}.${name} CASCADE`);
  }
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
