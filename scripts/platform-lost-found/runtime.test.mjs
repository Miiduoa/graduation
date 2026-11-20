import assert from 'node:assert/strict';
import process from 'node:process';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

assert.equal(process.env.NODE_ENV, 'test');
assert(process.env.LOST_FOUND_RUNTIME_CHECKOUT, 'Use scripts/test-platform-lost-found-runtime.mjs');
const checkout = process.env.LOST_FOUND_RUNTIME_CHECKOUT;
const requireRuntime = createRequire(join(checkout, 'apps/api/package.json'));
const { SignJWT, exportJWK, generateKeyPair } = await import(pathToFileURL(requireRuntime.resolve('jose')).href);
assert(process.env.LOST_FOUND_RUNTIME_APP && process.env.LOST_FOUND_RUNTIME_DATABASE);
process.stdout.write('# Loading the exact compiled API modules.\n');
const { createApp, isPublicApiRoute } = await import(pathToFileURL(process.env.LOST_FOUND_RUNTIME_APP).href);
const { createDatabase } = await import(pathToFileURL(process.env.LOST_FOUND_RUNTIME_DATABASE).href);
const secret = 'disposable-lost-found-runtime-test-secret-over-thirty-two';
const actions = ['list', 'get', 'create', 'update', 'resolve', 'remove', 'export'];
const fields = { type: 'lost', title: '藍色水壺', description: '有星星貼紙', category: 'other',
  location: '圖書館', date: '2026-11-07', contactInfo: 'owner@example.test' };
const input = () => ({ schoolId: 'pu', id: `plf_${randomUUID()}`, mutationId: randomUUID(), fields: { ...fields } });
const mutation = item => ({ schoolId: item.schoolId, id: item.id, expectedVersion: item.version, mutationId: randomUUID() });
let database, disabled, enabled, privateKey, first, second, admin;
let schemaCreated = false;
const schema = `lost_found_runtime_${randomUUID().replaceAll('-', '')}`;
const auth = session => ({ authorization: `Platform ${session.sessionHandle}` });
const http = (app, action, body, session = first, extra = {}) => app.inject({
  method: 'POST', url: `/v1/auth/platform/lost-found/${action}`,
  headers: session ? auth(session) : {}, payload: body, ...extra,
});
function expectStatus(response, expected) {
  assert.equal(response.statusCode, expected, response.body);
  return response.json();
}

async function login(app, subject) {
  const transaction = expectStatus(await app.inject({ method: 'POST',
    url: '/v1/auth/platform/login-transactions', payload: { kind: 'google-consumer' } }), 200);
  const idToken = await new SignJWT({ nonce: transaction.nonce, email: `${subject}@example.test`, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'disposable-lost-found-key', typ: 'JWT' })
    .setIssuer('https://accounts.google.com').setAudience('disposable-lost-found-client')
    .setSubject(subject).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  return expectStatus(await app.inject({ method: 'POST', url: '/v1/auth/platform/sessions',
    payload: { kind: 'google-consumer', transactionId: transaction.transactionId,
      nonce: transaction.nonce, idToken, displayName: '測試帳號' } }), 201);
}

before(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  privateKey = keys.privateKey;
  const publicJwk = { ...await exportJWK(keys.publicKey), kid: 'disposable-lost-found-key', alg: 'RS256', use: 'sig' };
  let runtimeConfig = { kind: 'embedded', url: '' };
  if (process.env.LOST_FOUND_RUNTIME_DATABASE_URL) {
    const url = new URL(process.env.LOST_FOUND_RUNTIME_DATABASE_URL);
    assert(['postgres:', 'postgresql:'].includes(url.protocol));
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/platform_lost_found_test');
    assert(url.port && !url.search && !url.hash);
    const { Client } = requireRuntime('pg');
    admin = new Client({ connectionString: url.href, application_name: 'lost-found-runtime-setup' });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    runtimeConfig = { kind: 'postgres', url: url.href, schemaName: schema,
      pool: { max: 4, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 20000, ssl: false },
      applicationName: 'lost-found-full-runtime-test', tlsMode: 'disable' };
  }
  process.stdout.write(`# Applying the complete pinned migration manifest to disposable ${runtimeConfig.kind}.\n`);
  database = await createDatabase({ attendanceCodeSecret: secret, seedDemo: false, runtimeConfig });
  await database.query(`INSERT INTO platform_identity_providers
    (kind,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,state)
    VALUES ('google-consumer','https://accounts.google.com','disposable-lost-found-client',
      'https://www.googleapis.com/oauth2/v3/certs','https://accounts.google.com/o/oauth2/v2/auth',
      'https://oauth2.googleapis.com/token','enabled')`);
  const options = { auth: { mode: 'campus-account' }, attendanceCodeSecret: secret,
    campusAccountSessionSecret: 'separate-disposable-campus-account-session-secret-over-thirty-two',
    enableDemoAuth: false, enableProductQaAccounts: false,
    externalIdpJwksFetch: async url => {
      assert.equal(String(url), 'https://www.googleapis.com/oauth2/v3/certs');
      return new globalThis.Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    },
  };
  process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED = 'false';
  process.stdout.write('# Creating full apps and locally signed Platform login sessions.\n');
  disabled = await createApp(database, options);
  first = await login(disabled, 'first-lost-found-subject');
  second = await login(disabled, 'second-lost-found-subject');
  process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED = 'true';
  enabled = await createApp(database, options);
}, { timeout: 180_000 });

after(async () => {
  try {
    await enabled?.close();
    await disabled?.close();
    await database?.close();
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally { await admin?.end(); }
});

test('actual runtime applies migration 282 and Google-shaped login creates no school identity', async () => {
  const migrated = await database.query("SELECT id FROM schema_migrations WHERE id='282_platform_lost_found'");
  assert.equal(migrated.rows.length, 1);
  const memberships = expectStatus(await enabled.inject({ method: 'GET',
    url: '/v1/auth/platform/memberships', headers: auth(first) }), 200);
  assert.deepEqual(memberships.memberships, []);
  const campus = await enabled.inject({ method: 'GET', url: '/v1/bootstrap', headers: auth(first) });
  assert.equal(campus.statusCode, 401);
});

test('actual app returns flag-off 404 for each exact endpoint and keeps a valid Google session', async () => {
  for (const action of actions) {
    assert.equal(isPublicApiRoute('POST', `/v1/auth/platform/lost-found/${action}`), true);
    assert.equal((await http(disabled, action, { schoolId: 'pu' })).statusCode, 404);
  }
  const current = expectStatus(await disabled.inject({ method: 'GET',
    url: '/v1/auth/platform/sessions/current', headers: auth(first) }), 200);
  assert.equal(current.platformAccountId, first.platformAccountId);
  for (const [method, path] of [['GET', 'list'], ['PUT', 'create'], ['POST', 'unknown'],
    ['POST', 'list/'], ['POST', 'list/extra']]) {
    const url = `/v1/auth/platform/lost-found/${path}`;
    assert.equal(isPublicApiRoute(method, url), false);
    assert.equal((await disabled.inject({ method, url, headers: auth(first) })).statusCode, 401);
  }
});

test('actual app uses Platform auth, strict input and request-size protection when enabled', async () => {
  assert.equal((await http(enabled, 'list', { schoolId: 'pu' }, null)).statusCode, 401);
  assert.equal((await http(enabled, 'list', { schoolId: 'pu' }, null,
    { headers: { cookie: 'nuni_session=untrusted' } })).statusCode, 401);
  assert.equal((await http(enabled, 'list', { schoolId: 'pu' }, null,
    { headers: { authorization: `Bearer ${first.sessionHandle}` } })).statusCode, 401);
  const listed = await http(enabled, 'list', { schoolId: 'pu' });
  expectStatus(listed, 200);
  assert.equal(listed.headers['cache-control'], 'no-store');
  assert.equal((await http(enabled, 'list?schoolId=pu', { schoolId: 'pu' })).statusCode, 422);
  for (const schoolId of ['personal', 'all', 'unavailable-campus'])
    assert.equal((await http(enabled, 'list', { schoolId })).statusCode, 422);
  assert.equal((await http(enabled, 'create', { ...input(), ignored: 'x'.repeat(17 * 1024) })).statusCode, 413);
});

test('actual app CRUD preserves owner, version, replay, contact and school boundaries', async () => {
  const createdInput = input();
  let item = expectStatus(await http(enabled, 'create', createdInput), 200).item;
  assert.equal(item.version, 1);
  assert.equal(item.status, 'open');
  assert.equal(item.title, fields.title);
  assert.equal(expectStatus(await http(enabled, 'create', createdInput), 200).item.version, 1);
  const page = expectStatus(await http(enabled, 'list', { schoolId: 'pu' }, second), 200);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].isOwner, false);
  assert.equal(Object.hasOwn(page.items[0], 'contactInfo'), false);
  assert.equal(expectStatus(await http(enabled, 'get', { schoolId: 'pu', id: item.id }, second), 200).item.contactInfo, fields.contactInfo);
  assert.equal((await http(enabled, 'get', { schoolId: 'ntu', id: item.id })).statusCode, 404);
  assert.equal((await http(enabled, 'remove', mutation(item), second)).statusCode, 404);
  const updatedInput = { ...mutation(item), fields: { ...fields, title: '藍色保溫水壺' } };
  item = expectStatus(await http(enabled, 'update', updatedInput), 200).item;
  assert.equal(item.title, updatedInput.fields.title);
  assert.equal((await http(enabled, 'update', { ...updatedInput, mutationId: randomUUID() })).statusCode, 409);
  assert.equal((await http(enabled, 'create', createdInput)).statusCode, 409);
  assert.equal(expectStatus(await http(enabled, 'update', updatedInput), 200).item.version, 2);
  const resolvedInput = mutation(item);
  item = expectStatus(await http(enabled, 'resolve', resolvedInput), 200).item;
  assert.equal(item.status, 'resolved');
  assert.equal(item.version, 3);
  assert.equal(item.contactInfo, '');
  assert.deepEqual(expectStatus(await http(enabled, 'export', { schoolId: 'pu' }, second), 200).items, []);
  assert.equal(expectStatus(await http(enabled, 'export', { schoolId: 'pu' }), 200).items[0].contactInfo, '');
  const removedInput = mutation(item);
  const removed = expectStatus(await http(enabled, 'remove', removedInput), 200);
  assert.deepEqual(removed, { removed: true, schoolId: 'pu', id: item.id });
  assert.deepEqual(expectStatus(await http(enabled, 'remove', removedInput), 200), removed);
  assert.equal((await http(enabled, 'create', createdInput)).statusCode, 410);
  const tombstone = (await database.query('SELECT title,description,location,contact_info FROM platform_lost_found_items WHERE id=$1', [item.id])).rows[0];
  assert.deepEqual(tombstone, { title: null, description: null, location: null, contact_info: null });
});

test('actual platform logout prevents lost-found reuse without deleting another account', async () => {
  const session = await login(enabled, 'logout-lost-found-subject');
  expectStatus(await http(enabled, 'create', input(), session), 200);
  expectStatus(await enabled.inject({ method: 'POST', url: '/v1/auth/platform/logout', headers: auth(session) }), 200);
  assert.equal((await http(enabled, 'list', { schoolId: 'pu' }, session)).statusCode, 401);
  expectStatus(await http(enabled, 'list', { schoolId: 'pu' }, second), 200);
});

test('actual account-close route atomically erases notices, tombstones and replay data', async () => {
  const other = expectStatus(await http(enabled, 'create', input(), second), 200).item;
  expectStatus(await http(enabled, 'create', input()), 200);
  assert.equal((await enabled.inject({ method: 'POST', url: '/v1/auth/platform/account/close',
    headers: auth(first), payload: { confirmClose: false } })).statusCode, 400);
  const closed = expectStatus(await enabled.inject({ method: 'POST', url: '/v1/auth/platform/account/close',
    headers: auth(first), payload: { confirmClose: true } }), 200);
  assert.deepEqual(closed, { closed: true });
  for (const table of ['platform_lost_found_items', 'platform_lost_found_mutations']) {
    const remaining = await database.query(`SELECT count(*)::int AS count FROM ${table} WHERE platform_account_id=$1`, [first.platformAccountId]);
    assert.equal(remaining.rows[0].count, 0);
  }
  assert.equal((await http(enabled, 'create', input())).statusCode, 401);
  assert.equal((await http(enabled, 'export', { schoolId: 'pu' })).statusCode, 401);
  expectStatus(await http(enabled, 'get', { schoolId: 'pu', id: other.id }, second), 200);
});
