// Synthetic personal records and sessions in a disposable PostgreSQL schema. No production identities.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PersonalImportSyncService } = require(join(process.env.IMPORT_SYNC_COMPILED, 'service.js'));

if (!process.env.IMPORT_SYNC_TEST_DATABASE_URL) {
  test('real PostgreSQL integration requires IMPORT_SYNC_TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const { Pool } = require(process.env.IMPORT_SYNC_TEST_DEPS ? join(process.env.IMPORT_SYNC_TEST_DEPS, 'pg') : 'pg');
  const schema = `import_sync_${randomUUID().replaceAll('-', '')}`;
  const control = new Pool({ connectionString: process.env.IMPORT_SYNC_TEST_DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.IMPORT_SYNC_TEST_DATABASE_URL, options: `-c search_path=${schema},public`, max: 12 });
  const db = { async transaction(run) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } };
  const service = new PersonalImportSyncService(db);
  before(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    // Minimal existing-table contract fixture. The release still runs the complete private API migrations.
    await pool.query(`CREATE TABLE platform_accounts (id text PRIMARY KEY,state text NOT NULL);
      CREATE TABLE platform_account_credentials (id text PRIMARY KEY,platform_account_id text REFERENCES platform_accounts(id),state text NOT NULL);
      CREATE TABLE platform_account_sessions (token_sha256 text PRIMARY KEY,platform_account_id text REFERENCES platform_accounts(id),credential_id text REFERENCES platform_account_credentials(id),expires_at timestamptz NOT NULL);
      CREATE TABLE class_workspaces (id text PRIMARY KEY,state text NOT NULL);
      CREATE TABLE class_workspace_members (workspace_id text REFERENCES class_workspaces(id),platform_account_id text REFERENCES platform_accounts(id),state text NOT NULL,PRIMARY KEY(workspace_id,platform_account_id));
      CREATE TABLE class_workspace_affiliations (workspace_id text PRIMARY KEY REFERENCES class_workspaces(id),tenant_id text NOT NULL,state text NOT NULL);`);
    await pool.query(readFileSync(resolve('deploy/nuni-api/personal-import-sync/279_personal_import_sync.sql'), 'utf8'));
  });
  after(async () => { await pool.end(); await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end(); });
  async function actor() {
    const platformAccountId = `pa_${randomUUID()}`, credentialId = `pac_${randomUUID()}`;
    const sessionHash = createHash('sha256').update(randomUUID()).digest('hex'), expiresAt = Date.now() + 3600000;
    await pool.query("INSERT INTO platform_accounts VALUES ($1,'active')", [platformAccountId]);
    await pool.query("INSERT INTO platform_account_credentials VALUES ($1,$2,'active')", [credentialId, platformAccountId]);
    await pool.query('INSERT INTO platform_account_sessions VALUES ($1,$2,$3,$4)', [sessionHash, platformAccountId, credentialId, new Date(expiresAt)]);
    return { platformAccountId, credentialId, sessionHash, expiresAt };
  }
  function row(extra = {}) {
    return { id: `row-${randomUUID()}`, batchId: `batch-${randomUUID()}`, importedAt: '2026-10-15T01:00:00.000Z',
      kind: 'grades', title: '資料庫', schoolId: 'pu', academicYear: '115', semester: '1', courseCode: `IM-${randomUUID()}`,
      credits: 3, grade: '90', teacher: '匯入資料上的老師姓名', source: { type: 'file', name: 'synthetic.csv', line: 1, rawText: 'IM301,資料庫,90' }, ...extra };
  }
  function input(records = [row()], extra = {}) {
    return { schoolId: 'pu', expectedRevision: 0, mutationId: randomUUID(), records, ...extra };
  }
  async function linkedClass(account, { member = true, schoolId, state = 'active', memberState = 'active', affiliationState = 'active' } = {}) {
    const id = `cw_${randomUUID()}`;
    await pool.query('INSERT INTO class_workspaces VALUES ($1,$2)', [id, state]);
    if (member) await pool.query('INSERT INTO class_workspace_members VALUES ($1,$2,$3)', [id, account.platformAccountId, memberState]);
    if (schoolId) await pool.query('INSERT INTO class_workspace_affiliations VALUES ($1,$2,$3)', [id, schoolId, affiliationState]);
    return id;
  }
  test('empty scope reads revision zero; a first write is visible to another session of the same account', async () => {
    const owner = await actor();
    assert.deepEqual(await service.read(owner, { schoolId: 'pu' }), { schoolId: 'pu', revision: 0, records: [], updatedAt: null, detachedCourseLinks: [] });
    const write = input(), stored = await service.write(owner, write);
    assert.equal(stored.revision, 1); assert.deepEqual(stored.records, write.records); assert.ok(stored.updatedAt);
    const sessionHash = createHash('sha256').update(randomUUID()).digest('hex');
    await pool.query('INSERT INTO platform_account_sessions VALUES ($1,$2,$3,$4)', [sessionHash, owner.platformAccountId, owner.credentialId, new Date(owner.expiresAt)]);
    assert.deepEqual(await service.read({ ...owner, sessionHash }, { schoolId: 'pu' }), stored);
  });
  test('different platform accounts and schools never share a ledger', async () => {
    const owner = await actor(), other = await actor(); await service.write(owner, input());
    assert.equal((await service.read(other, { schoolId: 'pu' })).records.length, 0);
    assert.equal((await service.read(owner, { schoolId: 'other-school' })).revision, 0);
    await service.write(other, input());
    assert.notDeepEqual((await service.read(owner, { schoolId: 'pu' })).records, (await service.read(other, { schoolId: 'pu' })).records);
  });
  test('a client-supplied owner, role or query-shaped input is rejected before any record is written', async () => {
    const owner = await actor();
    for (const extra of [{ platformAccountId: owner.platformAccountId }, { role: 'teacher' }, { schoolId: 'pu?owner=other' }])
      await assert.rejects(service.write(owner, input(undefined, extra)), { statusCode: 422 });
    await assert.rejects(service.read(owner, { schoolId: 'pu', ownerId: owner.platformAccountId }), { statusCode: 422 });
    assert.equal((await service.read(owner, { schoolId: 'pu' })).revision, 0);
  });
  test('a school that has no integration can still hold private imports; unspecified personal scope cannot sync', async () => {
    const owner = await actor();
    assert.equal((await service.write(owner, input([row({ schoolId: 'unintegrated-school' })], { schoolId: 'unintegrated-school' }))).revision, 1);
    await assert.rejects(service.read(owner, { schoolId: 'personal' }), { statusCode: 422 });
  });
  test('mixed schools, unknown record fields and duplicate record IDs cannot enter the ledger', async () => {
    const owner = await actor(), item = row();
    for (const records of [[row({ schoolId: 'other' })], [row({ roles: ['teacher'] })], [item, item]])
      await assert.rejects(service.write(owner, input(records)), { statusCode: 422 });
    assert.equal((await service.read(owner, { schoolId: 'pu' })).revision, 0);
  });
  test('invalid revision and mutation keys fail closed', async () => {
    const owner = await actor();
    for (const expectedRevision of [-1, 0.1, '0', NaN, 2147483647])
      await assert.rejects(service.write(owner, input([], { expectedRevision })), { statusCode: 422 });
    for (const mutationId of ['', 'short', 'a'.repeat(101), 'contains space', '../unsafe'])
      await assert.rejects(service.write(owner, input([], { mutationId })), { statusCode: 422 });
  });
  test('2001 records and a ledger over 8 MiB are rejected without advancing revision', async () => {
    const owner = await actor();
    await assert.rejects(service.write(owner, input(Array.from({ length: 2001 }, () => row()))), { statusCode: 422 });
    const large = Array.from({ length: 100 }, () => row({ source: { type: 'paste', line: 1, rawText: '學'.repeat(100000) } }));
    await assert.rejects(service.write(owner, input(large)), { statusCode: 422 });
    assert.equal((await service.read(owner, { schoolId: 'pu' })).revision, 0);
  });
  test('concurrent writes using the same base revision have exactly one winner', async () => {
    const owner = await actor();
    const writes = await Promise.allSettled([service.write(owner, input()), service.write(owner, input())]);
    assert.equal(writes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(writes.find(item => item.status === 'rejected').reason.code, 'PERSONAL_IMPORT_REVISION_CONFLICT');
    assert.equal((await service.read(owner, { schoolId: 'pu' })).revision, 1);
  });
  test('concurrent mutation retries create one revision and reject changed contents under that key', async () => {
    const owner = await actor(), write = input();
    const results = await Promise.all(Array.from({ length: 6 }, () => service.write(owner, write)));
    assert.deepEqual(results.map(item => item.revision), [1, 1, 1, 1, 1, 1]);
    await assert.rejects(service.write(owner, { ...write, records: [row()] }), { code: 'PERSONAL_IMPORT_MUTATION_CONFLICT' });
    await assert.rejects(service.write(owner, { ...write, expectedRevision: 1 }), { code: 'PERSONAL_IMPORT_MUTATION_CONFLICT' });
  });
  test('deleting the last record retains its revision; stale devices and retry keys cannot resurrect it', async () => {
    const owner = await actor(), original = input(); await service.write(owner, original);
    const deleted = await service.write(owner, input([], { expectedRevision: 1 }));
    assert.equal(deleted.revision, 2); assert.deepEqual(deleted.records, []);
    await assert.rejects(service.write(owner, input(original.records, { expectedRevision: 1 })), { code: 'PERSONAL_IMPORT_REVISION_CONFLICT' });
    assert.deepEqual(await service.write(owner, original), deleted);
  });
  test('session expiration, logout, credential revocation and account suspension deny reads and writes', async () => {
    for (const mutation of [
      async owner => { owner.expiresAt = 0; },
      async owner => pool.query('DELETE FROM platform_account_sessions WHERE token_sha256=$1', [owner.sessionHash]),
      async owner => pool.query("UPDATE platform_account_credentials SET state='revoked' WHERE id=$1", [owner.credentialId]),
      async owner => pool.query("UPDATE platform_accounts SET state='suspended' WHERE id=$1", [owner.platformAccountId]),
      async owner => pool.query("UPDATE platform_account_sessions SET expires_at=now()-interval '1 second' WHERE token_sha256=$1", [owner.sessionHash]),
    ]) {
      const owner = await actor(); await service.write(owner, input()); await mutation(owner);
      await assert.rejects(service.read(owner, { schoolId: 'pu' }), { statusCode: 401 });
      await assert.rejects(service.write(owner, input([], { expectedRevision: 1 })), { statusCode: 401 });
    }
  });
  test('another account session hash or credential cannot be combined with an owner ID', async () => {
    const owner = await actor(), other = await actor();
    await assert.rejects(service.write({ ...owner, sessionHash: other.sessionHash }, input()), { statusCode: 401 });
    await assert.rejects(service.read({ ...owner, credentialId: other.credentialId }, { schoolId: 'pu' }), { statusCode: 401 });
  });
  test('account closure removes content and mutation hashes atomically', async () => {
    const owner = await actor(); await service.write(owner, input());
    await pool.query("UPDATE platform_accounts SET state='deleted' WHERE id=$1", [owner.platformAccountId]);
    assert.equal((await pool.query('SELECT * FROM personal_import_ledgers WHERE platform_account_id=$1', [owner.platformAccountId])).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM personal_import_mutations WHERE platform_account_id=$1', [owner.platformAccountId])).rowCount, 0);
    await assert.rejects(service.read(owner, { schoolId: 'pu' }), { statusCode: 401 });
  });
  test('active class membership permits a reference but creates no authority or membership', async () => {
    const owner = await actor(), linkedCourseId = await linkedClass(owner, { schoolId: 'pu' });
    const stored = await service.write(owner, input([row({ linkedCourseId })]));
    assert.equal(stored.records[0].linkedCourseId, linkedCourseId); assert.deepEqual(stored.detachedCourseLinks, []);
    assert.equal((await pool.query('SELECT * FROM class_workspace_members WHERE platform_account_id=$1', [owner.platformAccountId])).rowCount, 1);
  });
  test('inaccessible, archived, removed and wrong-school class links detach while preserving personal grades and teacher text', async () => {
    const owner = await actor();
    const ids = await Promise.all([
      linkedClass(owner, { member: false }), linkedClass(owner, { state: 'archived' }),
      linkedClass(owner, { memberState: 'removed' }), linkedClass(owner, { schoolId: 'other' }),
      linkedClass(owner, { schoolId: 'pu', affiliationState: 'revoked' }),
    ]);
    const records = ids.map(linkedCourseId => row({ linkedCourseId }));
    const stored = await service.write(owner, input(records));
    assert.deepEqual(new Set(stored.detachedCourseLinks), new Set(records.map(item => item.id)));
    for (const item of stored.records) { assert.equal(item.linkedCourseId, undefined); assert.equal(item.grade, '90'); assert.equal(item.teacher, records[0].teacher); }
  });
  test('private un-affiliated workspaces remain personal references without claiming school verification', async () => {
    const owner = await actor(), linkedCourseId = await linkedClass(owner);
    assert.equal((await service.write(owner, input([row({ linkedCourseId })]))).records[0].linkedCourseId, linkedCourseId);
  });
  test('revoked membership is checked again on read and idempotent retry', async () => {
    const owner = await actor(), linkedCourseId = await linkedClass(owner), write = input([row({ linkedCourseId })]);
    await service.write(owner, write);
    await pool.query("UPDATE class_workspace_members SET state='removed' WHERE workspace_id=$1", [linkedCourseId]);
    for (const result of [await service.read(owner, { schoolId: 'pu' }), await service.write(owner, write)]) {
      assert.equal(result.records[0].linkedCourseId, undefined); assert.deepEqual(result.detachedCourseLinks, [write.records[0].id]);
      assert.equal(result.revision, 1);
    }
  });
  test('idempotency retention is bounded and an evicted old mutation still fails CAS', async () => {
    const owner = await actor(), first = input([]); await service.write(owner, first);
    for (let revision = 1; revision <= 101; revision++) await service.write(owner, input([], { expectedRevision: revision }));
    assert.equal((await pool.query('SELECT * FROM personal_import_mutations WHERE platform_account_id=$1', [owner.platformAccountId])).rowCount, 100);
    await assert.rejects(service.write(owner, first), { code: 'PERSONAL_IMPORT_REVISION_CONFLICT' });
    assert.equal((await service.read(owner, { schoolId: 'pu' })).revision, 102);
  });
  test('arbitrary school IDs cannot grow an account without a bound', async () => {
    const owner = await actor();
    for (let index = 0; index < 20; index++) await service.write(owner, input([], { schoolId: `school-${index}` }));
    await assert.rejects(service.write(owner, input([], { schoolId: 'school-21' })), { code: 'PERSONAL_IMPORT_SCHOOL_LIMIT' });
    assert.equal((await service.write(owner, input([], { schoolId: 'school-0', expectedRevision: 1 }))).revision, 2);
  });
  test('HTTP routes require the validated Platform session and return no-store snapshots', async () => {
    const fastify = require(process.env.IMPORT_SYNC_TEST_DEPS ? join(process.env.IMPORT_SYNC_TEST_DEPS, 'fastify') : 'fastify');
    const { registerPersonalImportSyncRoutes, isPersonalImportSyncRoute } = require(join(process.env.IMPORT_SYNC_COMPILED, 'routes.js'));
    const { DomainError } = require(join(process.env.IMPORT_SYNC_COMPILED, '../domain-error.js'));
    const owner = await actor(), handle = `test-session-${randomUUID()}`, authorization = `Platform ${handle}`;
    await pool.query('INSERT INTO platform_account_sessions VALUES ($1,$2,$3,$4)',
      [createHash('sha256').update(handle).digest('hex'), owner.platformAccountId, owner.credentialId, new Date(owner.expiresAt)]);
    const accounts = { async resolveSession(value) {
      if (value !== authorization) throw new DomainError('PLATFORM_SESSION_INVALID', '請先登入。', 401);
      return owner;
    } };
    const previousFlag = process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED;
    const app = fastify({ logger: false });
    process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED = 'true';
    try {
      registerPersonalImportSyncRoutes(app, db, accounts);
      const request = (path, payload, headers = { authorization }) => app.inject({ method: 'POST', url: `/v1/auth/platform/personal-imports/${path}`, payload, headers });
      assert.equal(isPersonalImportSyncRoute('POST', '/v1/auth/platform/personal-imports/write'), true);
      assert.equal(isPersonalImportSyncRoute('GET', '/v1/auth/platform/personal-imports/read'), false);
      assert.equal(isPersonalImportSyncRoute('POST', '/v1/auth/platform/personal-imports/read/extra'), false);
      assert.equal((await request('read', { schoolId: 'pu' }, {})).statusCode, 401);
      assert.equal((await request('read?owner=other', { schoolId: 'pu' })).statusCode, 422);
      const write = await request('write', input());
      assert.equal(write.statusCode, 200); assert.equal(write.headers['cache-control'], 'no-store'); assert.equal(write.json().revision, 1);
      const read = await request('read', { schoolId: 'pu' });
      assert.deepEqual(read.json(), write.json());
      assert.equal((await request('write', input())).statusCode, 409);
      assert.equal((await request('write', input(undefined, { role: 'teacher' }))).statusCode, 422);
      assert.equal((await request('write', { extra: 'x'.repeat(8 * 1024 * 1024 + 16 * 1024) })).statusCode, 413);
      assert.equal((await request('read', { schoolId: 'pu', extra: 'x'.repeat(4096) })).statusCode, 413);
    } finally {
      await app.close();
      if (previousFlag === undefined) delete process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED;
      else process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED = previousFlag;
    }
  });
  test('HTTP sync routes are absent unless the deployment explicitly enables them', async () => {
    const fastify = require(process.env.IMPORT_SYNC_TEST_DEPS ? join(process.env.IMPORT_SYNC_TEST_DEPS, 'fastify') : 'fastify');
    const { registerPersonalImportSyncRoutes } = require(join(process.env.IMPORT_SYNC_COMPILED, 'routes.js'));
    const previousFlag = process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED;
    delete process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED;
    const app = fastify({ logger: false });
    try {
      registerPersonalImportSyncRoutes(app, db, { resolveSession() { throw new Error('must not resolve a disabled route'); } });
      const result = await app.inject({ method: 'POST', url: '/v1/auth/platform/personal-imports/read', payload: { schoolId: 'pu' } });
      assert.equal(result.statusCode, 404);
    } finally {
      await app.close();
      if (previousFlag === undefined) delete process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED;
      else process.env.CAMPUS_PERSONAL_IMPORT_SYNC_ENABLED = previousFlag;
    }
  });
}
