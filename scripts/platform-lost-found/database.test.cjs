/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

assert(process.env.LOST_FOUND_COMPILED, 'Use scripts/test-platform-lost-found.mjs');
const { PlatformLostFoundService } = require(path.join(process.env.LOST_FOUND_COMPILED, 'service.js'));
const { registerPlatformLostFoundRoutes, isPlatformLostFoundRoute } = require(path.join(process.env.LOST_FOUND_COMPILED, 'routes.js'));
const { DomainError } = require(path.join(process.env.LOST_FOUND_COMPILED, '../domain-error.js'));
const embedded = process.env.LOST_FOUND_TEST_DRIVER === 'pglite';
const dependency = name => require(process.env.LOST_FOUND_TEST_DEPS ? path.join(process.env.LOST_FOUND_TEST_DEPS, name) : name);
const schema = `lost_found_${randomUUID().replaceAll('-', '')}`;
const applicationName = `lost-found-${schema}`;
let pool, admin, database, sql, service, first, second;
let schemaCreated = false;
const fields = { type: 'lost', title: '藍色水壺', description: '有星星貼紙', category: 'other',
  location: '圖書館', date: '2026-11-07', contactInfo: 'owner@example.test' };
const key = () => randomUUID();
const itemId = () => `plf_${randomUUID()}`;
const createInput = (extra = {}) => ({ schoolId: 'pu', id: itemId(), mutationId: key(), fields: { ...fields }, ...extra });
const mutation = (item, extra = {}) => ({ schoolId: item.schoolId, id: item.id, expectedVersion: item.version, mutationId: key(), ...extra });
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);

before(async () => {
  if (embedded) {
    const { PGlite } = dependency('@electric-sql/pglite');
    pool = new PGlite();
    await pool.waitReady;
    sql = (query, params = []) => pool.query(query, params);
    database = { transaction: callback => pool.transaction(tx => callback({ query: (query, params = []) => tx.query(query, [...params]) })) };
  } else {
    const input = new URL(process.env.LOST_FOUND_TEST_DATABASE_URL);
    assert(['postgres:', 'postgresql:'].includes(input.protocol));
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(input.hostname), 'Only loopback test databases are permitted');
    assert.equal(input.pathname, '/platform_lost_found_test');
    assert(input.port && !input.search && !input.hash, 'Explicit isolated port required, with no URL options');
    const { Pool, Client } = dependency('pg');
    admin = new Client({ connectionString: input.href, application_name: `${applicationName}-setup` });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    pool = new Pool({ connectionString: input.href, max: 8, options: `-c search_path=${schema}`, application_name: applicationName });
    sql = (query, params = []) => pool.query(query, params);
    database = { transaction: async callback => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await callback({ query: (query, params = []) => client.query(query, [...params]) });
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    } };
  }
  // Only this disposable fixture is created. No product connection settings or user records are consulted.
  const execute = source => embedded ? pool.exec(source) : sql(source);
  await execute(`CREATE TABLE platform_accounts (id text PRIMARY KEY,state text NOT NULL DEFAULT 'active');
    CREATE TABLE platform_account_credentials (id text PRIMARY KEY,
      platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,state text NOT NULL DEFAULT 'active');
    CREATE TABLE platform_account_sessions (token_sha256 text PRIMARY KEY,
      platform_account_id text NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
      credential_id text NOT NULL REFERENCES platform_account_credentials(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL);`);
  await execute(readFileSync(path.join(__dirname, '../../deploy/nuni-api/lost-found/282_platform_lost_found.sql'), 'utf8'));
  service = new PlatformLostFoundService(database);
}, { timeout: 60_000 });

async function account() {
  const sessionHandle = `ps_${randomBytes(32).toString('base64url')}`;
  const actor = { platformAccountId: `pa_${randomUUID()}`, credentialId: `pc_${randomUUID()}`,
    expiresAt: Date.now() + 3600_000, sessionHash: createHash('sha256').update(sessionHandle).digest('hex'), sessionHandle };
  await sql('INSERT INTO platform_accounts (id) VALUES ($1)', [actor.platformAccountId]);
  await sql('INSERT INTO platform_account_credentials (id,platform_account_id) VALUES ($1,$2)', [actor.credentialId, actor.platformAccountId]);
  await sql('INSERT INTO platform_account_sessions (token_sha256,platform_account_id,credential_id,expires_at) VALUES ($1,$2,$3,$4)',
    [actor.sessionHash, actor.platformAccountId, actor.credentialId, new Date(actor.expiresAt).toISOString()]);
  return actor;
}
beforeEach(async () => {
  await sql('TRUNCATE platform_accounts CASCADE');
  first = await account();
  second = await account();
});
after(async () => {
  if (embedded) await pool?.close();
  else {
    await pool?.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
  }
});

test('Google platform accounts publish/read across selected school groups without school identities', async () => {
  const input = createInput();
  const result = await service.create(first, input);
  assert.equal(result.item.version, 1);
  const page = await service.list(second, { schoolId: 'pu' });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].isOwner, false);
  assert.equal(Object.hasOwn(page.items[0], 'contactInfo'), false);
  assert.equal(Object.hasOwn(page.items[0], 'platformAccountId'), false);
  assert.equal((await service.get(second, { schoolId: input.schoolId, id: input.id })).item.contactInfo, fields.contactInfo);
  assert.equal((await service.list(second, { schoolId: 'pu', mine: true })).items.length, 0);
  assert.equal((await service.list(first, { schoolId: 'ntu' })).items.length, 0);
  const exported = await service.export(first, { schoolId: 'pu' });
  assert.equal(exported.items[0].contactInfo, fields.contactInfo);
  assert.equal(exported.items[0].isOwner, true);
  assert.equal((await service.export(second, { schoolId: 'pu' })).items.length, 0);
});

test('invalid input and claimed identities cannot write or choose ownership', async () => {
  for (const input of [createInput({ platformAccountId: second.platformAccountId }),
    createInput({ schoolId: 'all' }), createInput({ fields: { ...fields, userId: 'firebase-user' } }),
    createInput({ fields: { ...fields, date: '2026-02-30' } })]) {
    await reject(service.create(first, input), 'LOST_FOUND_INVALID_INPUT');
  }
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 0);
});

test('simultaneous identical creates produce one item and one receipt', async () => {
  const input = createInput();
  const results = await Promise.all(Array.from({ length: 4 }, () => service.create(first, input)));
  assert(results.every(result => result.item.id === input.id && result.item.version === 1));
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 1);
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_mutations')).rows[0].count, 1);
});

test('a mutation key binds its action, item and intent within one account', async () => {
  const input = createInput();
  const { item } = await service.create(first, input);
  await reject(service.create(first, { ...input, fields: { ...fields, title: 'changed' } }), 'LOST_FOUND_MUTATION_CONFLICT');
  await reject(service.update(first, { ...mutation(item), mutationId: input.mutationId, fields }), 'LOST_FOUND_MUTATION_CONFLICT');
  await reject(service.create(first, { ...input, id: itemId() }), 'LOST_FOUND_MUTATION_CONFLICT');
  const other = await service.create(second, { ...input, id: itemId() });
  assert.equal(other.item.isOwner, true);
});

test('expectedVersion makes concurrent edits reject stale changes instead of overwriting', async () => {
  const { item } = await service.create(first, createInput());
  const results = await Promise.allSettled([
    service.update(first, { ...mutation(item), fields: { ...fields, title: 'first edit' } }),
    service.update(first, { ...mutation(item), fields: { ...fields, title: 'second edit' } }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'LOST_FOUND_VERSION_CONFLICT');
  assert.equal((await service.get(first, { schoolId: 'pu', id: item.id })).item.version, 2);
});

test('foreign owners and wrong school scopes cannot edit, close, remove or steal an ID', async () => {
  const input = createInput();
  const { item } = await service.create(first, input);
  for (const actor of [first, second]) {
    const wrong = mutation(item, actor === first ? { schoolId: 'ntu' } : {});
    await reject(service.update(actor, { ...wrong, fields }), 'LOST_FOUND_NOT_FOUND');
    await reject(service.resolve(actor, wrong), 'LOST_FOUND_NOT_FOUND');
    await reject(service.remove(actor, wrong), 'LOST_FOUND_NOT_FOUND');
  }
  await reject(service.create(second, input), 'LOST_FOUND_NOT_FOUND');
  await reject(service.get(second, { schoolId: 'ntu', id: item.id }), 'LOST_FOUND_NOT_FOUND');
  assert.equal((await service.get(first, { schoolId: 'pu', id: item.id })).item.version, 1);
});

test('omitted contact survives an edit; explicit empty contact clears the stored value', async () => {
  const { item } = await service.create(first, createInput());
  const { contactInfo: _contact, ...withoutContact } = fields;
  const updated = (await service.update(first, { ...mutation(item), fields: withoutContact })).item;
  assert.equal(updated.contactInfo, fields.contactInfo);
  const cleared = (await service.update(first, { ...mutation(updated), fields: { ...fields, contactInfo: '' } })).item;
  assert.equal(cleared.contactInfo, '');
  assert.equal((await service.get(second, { schoolId: 'pu', id: item.id })).item.contactInfo, '');
});

test('retries never return an obsolete receipt or retained copies of prior contact information', async () => {
  const created = createInput();
  const { item } = await service.create(first, created);
  const edit = { ...mutation(item), fields: { ...fields, contactInfo: 'changed@example.test' } };
  const edited = (await service.update(first, edit)).item;
  assert.deepEqual(await service.update(first, edit), { item: edited });
  await reject(service.create(first, created), 'LOST_FOUND_REPLAY_CHANGED');
  const resolve = mutation(edited);
  const closed = (await service.resolve(first, resolve)).item;
  await reject(service.update(first, edit), 'LOST_FOUND_REPLAY_CHANGED');
  assert.deepEqual(await service.resolve(first, resolve), { item: closed });
  const journal = JSON.stringify((await sql('SELECT * FROM platform_lost_found_mutations')).rows);
  assert(!journal.includes(fields.contactInfo));
  assert(!journal.includes('changed@example.test'));
  assert(!journal.includes(fields.title));
});

test('resolve clears contact, leaves an owner export and refuses silent reopening', async () => {
  const { item } = await service.create(first, createInput());
  const closed = (await service.resolve(first, mutation(item))).item;
  assert.equal(closed.status, 'resolved');
  assert.equal(closed.contactInfo, '');
  assert.equal(closed.version, 2);
  assert.equal((await service.list(second, { schoolId: 'pu' })).items.length, 0);
  assert.equal((await service.list(second, { schoolId: 'pu', status: 'resolved' })).items[0].status, 'resolved');
  assert.equal((await service.list(first, { schoolId: 'pu', mine: true })).items.length, 1);
  assert.equal((await service.export(first, { schoolId: 'pu' })).items[0].contactInfo, '');
  await reject(service.update(first, { ...mutation(closed), fields }), 'LOST_FOUND_CLOSED');
  await reject(service.resolve(first, mutation(closed)), 'LOST_FOUND_CLOSED');
});

test('remove erases every editable field and a delayed create cannot resurrect the notice', async () => {
  const input = createInput();
  const { item } = await service.create(first, input);
  const removal = mutation(item);
  assert.deepEqual(await service.remove(first, removal), { removed: true, id: item.id, schoolId: 'pu' });
  const row = (await sql('SELECT * FROM platform_lost_found_items WHERE id=$1', [item.id])).rows[0];
  for (const column of ['item_type', 'title', 'description', 'category', 'location', 'item_date', 'contact_info', 'resolved_at']) assert.equal(row[column], null);
  assert.equal(row.state, 'removed');
  assert.deepEqual(await service.remove(first, removal), { removed: true, id: item.id, schoolId: 'pu' });
  await reject(service.create(first, input), 'LOST_FOUND_REMOVED');
  await reject(service.get(first, { id: item.id, schoolId: 'pu' }), 'LOST_FOUND_REMOVED');
  await reject(service.get(second, { id: item.id, schoolId: 'pu' }), 'LOST_FOUND_NOT_FOUND');
  assert.equal((await service.export(first, { schoolId: 'pu' })).items.length, 0);
  await sql('DELETE FROM platform_lost_found_mutations WHERE platform_account_id=$1', [first.platformAccountId]);
  await reject(service.create(first, input), 'LOST_FOUND_REMOVED');
  assert.equal((await service.remove(first, removal)).removed, true);
});

for (const state of ['expired-actor', 'expired-session', 'logged-out', 'revoked-credential', 'wrong-credential', 'wrong-account', 'suspended', 'deleted']) {
  test(`resolved session is rechecked in the transaction: ${state}`, async () => {
    let actor = first;
    if (state === 'expired-actor') actor = { ...first, expiresAt: Date.now() - 1 };
    if (state === 'expired-session') await sql("UPDATE platform_account_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_sha256=$1", [first.sessionHash]);
    if (state === 'logged-out') await sql('DELETE FROM platform_account_sessions WHERE token_sha256=$1', [first.sessionHash]);
    if (state === 'revoked-credential') await sql("UPDATE platform_account_credentials SET state='revoked' WHERE id=$1", [first.credentialId]);
    if (state === 'wrong-credential') actor = { ...first, credentialId: second.credentialId };
    if (state === 'wrong-account') actor = { ...first, platformAccountId: second.platformAccountId };
    if (state === 'suspended' || state === 'deleted') await sql('UPDATE platform_accounts SET state=$2 WHERE id=$1', [first.platformAccountId, state]);
    await reject(service.create(actor, createInput()), 'LOST_FOUND_SESSION_EXPIRED');
    await reject(service.list(actor, { schoolId: 'pu' }), 'LOST_FOUND_SESSION_EXPIRED');
    await reject(service.export(actor, { schoolId: 'pu' }), 'LOST_FOUND_SESSION_EXPIRED');
  });
}

test('account closure atomically removes posts, contacts, tombstones and replay history; another owner is untouched', async () => {
  const open = (await service.create(first, createInput())).item;
  const removed = (await service.create(first, createInput({ schoolId: 'ntu' }))).item;
  await service.remove(first, mutation(removed));
  const other = (await service.create(second, createInput())).item;
  await sql("UPDATE platform_accounts SET state='deleted' WHERE id=$1", [first.platformAccountId]);
  for (const table of ['platform_lost_found_items', 'platform_lost_found_mutations'])
    assert.equal((await sql(`SELECT count(*)::int AS count FROM ${table} WHERE platform_account_id=$1`, [first.platformAccountId])).rows[0].count, 0);
  await reject(service.get(second, { schoolId: 'pu', id: open.id }), 'LOST_FOUND_NOT_FOUND');
  assert.equal((await service.list(second, { schoolId: 'pu' })).items[0].id, other.id);
  await sql('DELETE FROM platform_accounts WHERE id=$1', [second.platformAccountId]);
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 0);
});

test('suspension immediately hides the author without deleting recoverable notices', async () => {
  const { item } = await service.create(first, createInput());
  await sql("UPDATE platform_accounts SET state='suspended' WHERE id=$1", [first.platformAccountId]);
  assert.equal((await service.list(second, { schoolId: 'pu' })).items.length, 0);
  await reject(service.get(second, { schoolId: 'pu', id: item.id }), 'LOST_FOUND_NOT_FOUND');
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 1);
  await sql("UPDATE platform_accounts SET state='active' WHERE id=$1", [first.platformAccountId]);
  assert.equal((await service.get(second, { schoolId: 'pu', id: item.id })).item.contactInfo, fields.contactInfo);
});

test('stable millisecond keyset pages have no duplicates and bind reader, school, filters and export scope', async () => {
  const ids = [];
  for (let index = 0; index < 5; index++) ids.push((await service.create(first, createInput())).item.id);
  await sql("UPDATE platform_lost_found_items SET created_at='2026-11-07T06:00:00.123Z'");
  const one = await service.list(second, { schoolId: 'pu', limit: 2 });
  assert(one.nextCursor);
  const two = await service.list(second, { schoolId: 'pu', limit: 2, cursor: one.nextCursor });
  const three = await service.list(second, { schoolId: 'pu', limit: 2, cursor: two.nextCursor });
  assert.equal(three.nextCursor, null);
  assert.deepEqual([...one.items, ...two.items, ...three.items].map(item => item.id), ids.sort().reverse());
  for (const scope of [{ schoolId: 'ntu' }, { schoolId: 'pu', mine: true }, { schoolId: 'pu', type: 'found' },
    { schoolId: 'pu', q: 'changed' }, { schoolId: 'pu', status: 'all' }])
    await reject(service.list(second, { ...scope, cursor: one.nextCursor }), 'LOST_FOUND_INVALID_CURSOR');
  await reject(service.list(first, { schoolId: 'pu', cursor: one.nextCursor }), 'LOST_FOUND_INVALID_CURSOR');
  await reject(service.export(second, { schoolId: 'pu', cursor: one.nextCursor }), 'LOST_FOUND_INVALID_CURSOR');
});

test('search treats percent/underscore/quotes as text and applies type/category/status on the server', async () => {
  const special = (await service.create(first, createInput({ fields: { ...fields, title: '100%_辨識牌', category: 'cards', type: 'found' } }))).item;
  await service.create(first, createInput());
  assert.deepEqual((await service.list(second, { schoolId: 'pu', q: '%_' })).items.map(item => item.id), [special.id]);
  assert.equal((await service.list(second, { schoolId: 'pu', q: "' OR 1=1 --" })).items.length, 0);
  assert.equal((await service.list(second, { schoolId: 'pu', category: 'cards', type: 'lost' })).items.length, 0);
  assert.deepEqual((await service.list(second, { schoolId: 'pu', category: 'cards', type: 'found' })).items.map(item => item.id), [special.id]);
});

test('database rate limits count real writes, while an identical successful retry is free', async () => {
  const input = createInput();
  const { item } = await service.create(first, input);
  await sql(`INSERT INTO platform_lost_found_mutations (platform_account_id,mutation_id,item_id,action,request_hash,receipt_version)
    SELECT $1,'rate-limit-' || number,$2,'update',repeat('a',64),1 FROM generate_series(1,19) number`, [first.platformAccountId, item.id]);
  assert.equal((await service.create(first, input)).item.id, item.id);
  await reject(service.update(first, { ...mutation(item), fields }), 'LOST_FOUND_RATE_LIMIT');
  assert.equal((await service.create(second, createInput())).item.version, 1);
});

test('daily create quota cannot be reset by deleting journal records or removing notices', async () => {
  await sql(`INSERT INTO platform_lost_found_items (id,platform_account_id,school_id,state,version)
    SELECT 'plf_00000000-0000-0000-0000-' || lpad(number::text,12,'0'),$1,'pu','removed',2 FROM generate_series(1,50) number`, [first.platformAccountId]);
  await reject(service.create(first, createInput()), 'LOST_FOUND_RATE_LIMIT');
});

test('bounded live-post and lifetime receipt quotas cannot be bypassed through another school', async () => {
  await sql(`INSERT INTO platform_lost_found_items
    (id,platform_account_id,school_id,state,version,item_type,title,description,category,location,item_date,contact_info,created_at)
    SELECT 'plf_00000000-0000-0000-0000-' || lpad(number::text,12,'0'),$1,'pu','open',1,
      'lost','test','test','other','test','2026-11-07','',clock_timestamp()-interval '2 days' FROM generate_series(1,200) number`, [first.platformAccountId]);
  await reject(service.create(first, createInput({ schoolId: 'ntu' })), 'LOST_FOUND_ITEM_LIMIT');
  await sql('DELETE FROM platform_lost_found_items WHERE platform_account_id=$1', [first.platformAccountId]);
  await sql(`INSERT INTO platform_lost_found_items (id,platform_account_id,school_id,state,version,created_at)
    SELECT 'plf_00000000-0000-0000-0000-' || lpad(number::text,12,'0'),$1,'pu','removed',2,
      clock_timestamp()-interval '2 days' FROM generate_series(1,5000) number`, [first.platformAccountId]);
  await reject(service.create(first, createInput({ schoolId: 'ntu' })), 'LOST_FOUND_ITEM_LIMIT');
});

test('journal pruning does not resurrect a previous create or accept stale expectedVersion', async () => {
  const input = createInput();
  const { item } = await service.create(first, input);
  await sql("UPDATE platform_lost_found_mutations SET created_at=clock_timestamp()-interval '3 hours'");
  await sql(`INSERT INTO platform_lost_found_mutations
    (platform_account_id,mutation_id,item_id,action,request_hash,receipt_version,created_at)
    SELECT $1,'old-mutation-' || number,$2,'update',repeat('a',64),1,clock_timestamp()-interval '2 hours'
      FROM generate_series(1,1000) number`, [first.platformAccountId, item.id]);
  await service.update(first, { ...mutation(item), fields });
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_mutations')).rows[0].count, 1000);
  await reject(service.create(first, input), 'LOST_FOUND_MUTATION_CONFLICT');
  await reject(service.update(first, { ...mutation(item), fields }), 'LOST_FOUND_VERSION_CONFLICT');
});

test('item and idempotency receipt commit together; a write failure rolls the item back', async () => {
  let failInsert = true;
  const failing = new PlatformLostFoundService({ transaction: work => database.transaction(tx => work({
    query: async (query, params) => {
      if (failInsert && query.includes('INSERT INTO platform_lost_found_mutations')) { failInsert = false; throw new Error('synthetic receipt failure'); }
      return tx.query(query, params);
    },
  })) });
  const input = createInput();
  await assert.rejects(failing.create(first, input), /synthetic receipt failure/);
  assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 0);
  assert.equal((await service.create(first, input)).item.version, 1);
});

async function waitForBlockedAccountRead() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await admin.query(`SELECT 1 FROM pg_stat_activity WHERE application_name=$1
      AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM platform_accounts%'`, [applicationName]);
    if (result.rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('The competing transaction never reached the account lock');
}
for (const close of [true, false]) {
  test(`queued write rechecks ${close ? 'account closure' : 'session logout'} after a concurrent account lock`, { skip: embedded }, async () => {
    const control = await pool.connect();
    let result;
    try {
      await control.query('BEGIN');
      await control.query('SELECT id FROM platform_accounts WHERE id=$1 FOR UPDATE', [first.platformAccountId]);
      result = service.create(first, createInput()).then(value => ({ value }), error => ({ error }));
      await waitForBlockedAccountRead();
      if (close) await control.query("UPDATE platform_accounts SET state='deleted' WHERE id=$1", [first.platformAccountId]);
      else await control.query('DELETE FROM platform_account_sessions WHERE token_sha256=$1', [first.sessionHash]);
      await control.query('COMMIT');
    } finally { await control.query('ROLLBACK'); control.release(); }
    assert.equal((await result).error.code, 'LOST_FOUND_SESSION_EXPIRED');
    assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 0);
  });
}

async function httpServer(enabled = true, db = database) {
  const fastify = require(path.join(process.env.LOST_FOUND_TEST_FASTIFY_DEPS, 'fastify'));
  const rateLimit = require(path.join(process.env.LOST_FOUND_TEST_FASTIFY_DEPS, '@fastify/rate-limit'));
  const app = fastify({ logger: false });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode ?? 500;
    reply.code(status).send({ error: { code: error.code ?? 'INTERNAL_ERROR' } });
  });
  // The isolated host resolves synthetic session rows; it never fabricates school/Firebase identities.
  // Full production auth/OAuth is a separate reconstructed-runtime acceptance gate.
  const accounts = { resolveSession: async authorization => {
    const match = /^Platform (ps_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match) throw new DomainError('PLATFORM_SESSION_INVALID', 'invalid session', 401);
    const hash = createHash('sha256').update(match[1]).digest('hex');
    const result = await sql(`SELECT s.platform_account_id,s.credential_id,s.expires_at FROM platform_account_sessions s
      JOIN platform_accounts a ON a.id=s.platform_account_id AND a.state='active'
      JOIN platform_account_credentials c ON c.id=s.credential_id AND c.platform_account_id=s.platform_account_id AND c.state='active'
      WHERE s.token_sha256=$1 AND s.expires_at>clock_timestamp()`, [hash]);
    const row = result.rows[0];
    if (!row) throw new DomainError('PLATFORM_SESSION_INVALID', 'invalid session', 401);
    return { platformAccountId: row.platform_account_id, credentialId: row.credential_id, expiresAt: new Date(row.expires_at).getTime() };
  } };
  const previous = process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED;
  try {
    process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED = enabled ? 'true' : 'false';
    registerPlatformLostFoundRoutes(app, db, accounts);
  } finally {
    if (previous === undefined) delete process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED;
    else process.env.CAMPUS_PLATFORM_LOST_FOUND_ENABLED = previous;
  }
  await app.ready();
  return app;
}
const http = (app, action, body, actor = first, extra = {}) => app.inject({
  method: 'POST', url: `/v1/auth/platform/lost-found/${action}`,
  headers: actor ? { authorization: `Platform ${actor.sessionHandle}` } : {}, payload: body, ...extra,
});

test('Fastify route classifier/registration is exact, POST-only and disabled by default', async () => {
  assert.equal(isPlatformLostFoundRoute('POST', '/v1/auth/platform/lost-found/list'), true);
  for (const [method, path] of [['GET', '/v1/auth/platform/lost-found/list'],
    ['POST', '/v1/auth/platform/lost-found/list/'], ['POST', '/v1/auth/platform/lost-found/list/extra'],
    ['POST', '/v1/auth/platform/lost-found/unknown']]) assert.equal(isPlatformLostFoundRoute(method, path), false);
  const app = await httpServer(false);
  try { assert.equal((await http(app, 'list', { schoolId: 'pu' })).statusCode, 404); }
  finally { await app.close(); }
});

test('Fastify routes require Platform authorization and reject cookie-only, wrong-method and query requests', async () => {
  const app = await httpServer();
  try {
    assert.equal((await http(app, 'list', { schoolId: 'pu' }, null)).statusCode, 401);
    assert.equal((await http(app, 'list', { schoolId: 'pu' }, null, { headers: { cookie: 'campus_session=not-a-platform-handle' } })).statusCode, 401);
    assert.equal((await http(app, 'list', { schoolId: 'pu' }, null, { headers: { authorization: `Bearer ${first.sessionHandle}` } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/v1/auth/platform/lost-found/list' })).statusCode, 404);
    assert.equal((await http(app, 'list?schoolId=ntu', { schoolId: 'pu' })).statusCode, 422);
    assert.equal((await http(app, 'unknown', { schoolId: 'pu' })).statusCode, 404);
    const read = await http(app, 'list', { schoolId: 'pu' });
    assert.equal(read.statusCode, 200);
    assert.equal(read.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('Fastify executes complete create/edit/detail/close/remove through real SQL and private no-store responses', async () => {
  const app = await httpServer();
  try {
    const input = createInput();
    const created = await http(app, 'create', input);
    assert.equal(created.statusCode, 200);
    assert.equal(created.headers['cache-control'], 'no-store');
    const item = created.json().item;
    const detail = await http(app, 'get', { schoolId: 'pu', id: item.id }, second);
    assert.equal(detail.json().item.contactInfo, fields.contactInfo);
    const list = await http(app, 'list', { schoolId: 'pu' }, second);
    assert.equal(Object.hasOwn(list.json().items[0], 'contactInfo'), false);
    assert.equal((await http(app, 'update', { ...mutation(item), fields }, second)).statusCode, 404);
    const edit = { ...mutation(item), fields: { ...fields, title: '已補充特徵' } };
    const updated = await http(app, 'update', edit);
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().item.title, edit.fields.title);
    assert.equal((await http(app, 'update', { ...edit, mutationId: key() })).json().error.code, 'LOST_FOUND_VERSION_CONFLICT');
    assert.equal((await http(app, 'create', input)).json().error.code, 'LOST_FOUND_REPLAY_CHANGED');
    const resolved = await http(app, 'resolve', mutation(updated.json().item));
    assert.equal(resolved.json().item.contactInfo, '');
    const removed = await http(app, 'remove', mutation(resolved.json().item));
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.json(), { removed: true, id: item.id, schoolId: 'pu' });
    assert.equal((await http(app, 'get', { schoolId: 'pu', id: item.id })).statusCode, 410);
    assert.equal((await http(app, 'export', { schoolId: 'pu' })).json().items.length, 0);
  } finally { await app.close(); }
});

test('Fastify rejects oversized/malformed JSON and invalid ownership fields before a write', async () => {
  const app = await httpServer();
  try {
    const oversized = await http(app, 'create', createInput({ padding: 'x'.repeat(17 * 1024) }));
    assert.equal(oversized.statusCode, 413);
    const invalid = await http(app, 'create', createInput({ platformAccountId: second.platformAccountId }));
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().error.code, 'LOST_FOUND_INVALID_INPUT');
    const malformed = await app.inject({ method: 'POST', url: '/v1/auth/platform/lost-found/create',
      headers: { authorization: `Platform ${first.sessionHandle}`, 'content-type': 'application/json' }, payload: '{invalid' });
    assert.equal(malformed.statusCode, 400);
    assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 0);
  } finally { await app.close(); }
});

test('Fastify rate limits repeated receipts even when the database correctly deduplicates writes', async () => {
  const app = await httpServer();
  const input = createInput();
  try {
    for (let number = 0; number < 30; number++) assert.equal((await http(app, 'create', input)).statusCode, 200);
    assert.equal((await http(app, 'create', input)).statusCode, 429);
    assert.equal((await sql('SELECT count(*)::int AS count FROM platform_lost_found_items')).rows[0].count, 1);
  } finally { await app.close(); }
});

test('Fastify maps write races to safe conflict responses without leaking PostgreSQL details', async () => {
  const app = await httpServer(true, { transaction: async () => { throw { code: '23505', detail: 'private database details' }; } });
  try {
    const response = await http(app, 'create', createInput());
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'LOST_FOUND_VERSION_CONFLICT');
    assert(!response.body.includes('private database details'));
  } finally { await app.close(); }
});
