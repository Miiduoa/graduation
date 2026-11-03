import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

// The ordinary test harness cannot connect to a DB. This test is only enabled
// by the parent process that created an ephemeral Unix-socket-only cluster.
const folder = process.env.CAMPUS_AGENT_PG_FOLDER;
if (!folder) {
  test('real PostgreSQL is only run by the isolated local runner', { skip: true }, () => {});
} else {
  const parent = process.env.CAMPUS_AGENT_PG_PARENT;
  const safeRoot = realpathSync('/tmp');
  assert.match(folder, new RegExp(`^${safeRoot}/c1pg-[A-Za-z0-9]+$`, 'u'));
  assert.equal(realpathSync(folder), folder);
  assert.equal(lstatSync(folder).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(folder, 'socket')).mode & 0o777, 0o700);
  assert.equal(parent, String(process.ppid));
  assert.equal(readFileSync(join(folder, 'owner'), 'utf8').trim(), parent);
  const compiled = process.env.CAMPUS_AGENT_PG_COMPILED;
  assert.equal(compiled, join(folder.replace('/private/tmp/', '/tmp/'), 'compiled'));
  const { PlatformPublicAgentLedger } = await import(
    pathToFileURL(join(compiled, 'ledger.js')).href
  );
  const { Pool } = await import('pg');
  const pool = new Pool({
    host: join(folder, 'socket'),
    port: 55432,
    database: 'postgres',
    user: 'campus_synthetic',
    ssl: false,
    max: 12,
  });
  const db = {
    async transaction(fn, options) {
      assert.equal(options?.isolationLevel, 'read committed');
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const policy = {
    providerBudgetKey: 'synthetic-free',
    providerDailyLimit: 1000,
    accountDailyLimit: 1000,
    operationTtlMs: 30_000,
  };
  const ledger = () => new PlatformPublicAgentLedger(db, policy);
  const hash = (text) => createHash('sha256').update(text).digest('hex');
  const binding = (extra = {}) => ({
    task: 'public-campus-navigation',
    requestId: `req_${randomUUID()}`,
    schoolId: 'pu',
    payloadHash: hash('synthetic payload'),
    provider: 'deterministic',
    model: 'public-poi-exact-match-v1',
    ...extra,
  });
  const lookup = (b) => ({ task: b.task, schoolId: b.schoolId });
  const ack = (actor, b, operationId, approved = true) =>
    ledger().ack(actor, { ...lookup(b), operationId, approved });
  async function actor() {
    const platformAccountId = `pa_${randomUUID()}`,
      credentialId = `pac_${randomUUID()}`;
    const sessionHash = hash(randomUUID()),
      expiresAt = Date.now() + 3_600_000;
    await pool.query("INSERT INTO platform_accounts VALUES ($1,'active')", [platformAccountId]);
    await pool.query("INSERT INTO platform_account_credentials VALUES ($1,$2,'active','google')", [
      credentialId,
      platformAccountId,
    ]);
    await pool.query('INSERT INTO platform_account_sessions VALUES ($1,$2,$3,$4)', [
      sessionHash,
      platformAccountId,
      credentialId,
      new Date(expiresAt),
    ]);
    return { platformAccountId, credentialId, sessionHash, expiresAt };
  }
  async function secondSession(owner) {
    const sessionHash = hash(randomUUID());
    await pool.query('INSERT INTO platform_account_sessions VALUES ($1,$2,$3,$4)', [
      sessionHash,
      owner.platformAccountId,
      owner.credentialId,
      new Date(owner.expiresAt),
    ]);
    return { ...owner, sessionHash };
  }
  async function claim(actor, b) {
    const c = await ledger().confirm(actor, b);
    return { c, result: await ledger().claim(actor, b, c.confirmationId) };
  }
  const result = (b) => ({
    task: b.task,
    schoolId: b.schoolId,
    sourceFingerprint: hash('source'),
    checkedAt: Date.now(),
    receipt: { kind: 'synthetic' },
  });
  const blocked = (promise) => assert.rejects(promise, { code: 'PUBLIC_AGENT_OPEN_OPERATION' });
  before(async () => {
    await pool.query(`CREATE TABLE platform_accounts (id text PRIMARY KEY, state text NOT NULL);
      CREATE TABLE platform_account_credentials (id text PRIMARY KEY, platform_account_id text REFERENCES platform_accounts(id), state text NOT NULL, method text NOT NULL);
      CREATE TABLE platform_account_sessions (token_sha256 text PRIMARY KEY, platform_account_id text REFERENCES platform_accounts(id), credential_id text REFERENCES platform_account_credentials(id), expires_at timestamptz NOT NULL);
      CREATE TABLE platform_operator_assignments (platform_account_id text REFERENCES platform_accounts(id), role_key text, state text, PRIMARY KEY(platform_account_id,role_key));`);
    await pool.query(
      readFileSync('deploy/nuni-api/platform-public-agent/schema.candidate.sql', 'utf8'),
    );
  });
  after(async () => {
    await pool.end();
  });

  test('parallel different requests: only one claim and one pair of quota debits', async () => {
    const a = await actor(),
      first = binding(),
      second = binding({ payloadHash: hash('another source and text') });
    const [c1, c2] = await Promise.all([ledger().confirm(a, first), ledger().confirm(a, second)]);
    const values = await Promise.allSettled([
      ledger().claim(a, first, c1.confirmationId),
      ledger().claim(a, second, c2.confirmationId),
    ]);
    assert.equal(
      values.filter((x) => x.status === 'fulfilled' && x.value.status === 'claimed').length,
      1,
    );
    assert.equal(
      values.filter(
        (x) => x.status === 'rejected' && x.reason.code === 'PUBLIC_AGENT_OPEN_OPERATION',
      ).length,
      1,
    );
    const ops = await pool.query(
      'SELECT count(*)::int AS count FROM platform_public_agent_operations WHERE platform_account_id=$1',
      [a.platformAccountId],
    );
    const quota = await pool.query(
      "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
      [a.platformAccountId],
    );
    assert.equal(ops.rows[0].count, 1);
    assert.equal(quota.rows[0].used, 1);
  });
  test('reload/new session cannot bypass unknown with changed request or payload', async () => {
    const a = await actor(),
      b = binding(),
      { result: op } = await claim(a, b);
    await ledger().markUnknown(a, b, op.operationId, op.executionToken);
    const refreshed = await secondSession(a),
      resumed = ledger();
    const status = await resumed.status(refreshed, lookup(b));
    assert.equal(status.status, 'unknown');
    assert.equal(status.operationId, op.operationId);
    await blocked(
      resumed.confirm(refreshed, binding({ payloadHash: hash('changed source and payload') })),
    );
    await assert.rejects(ack(refreshed, b, op.operationId));
    const repeated = await ledger().claim(a, b, (await ledger().confirm(a, b)).confirmationId);
    assert.equal(repeated.status, 'unknown');
    const count = await pool.query(
      "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
      [a.platformAccountId],
    );
    assert.equal(count.rows[0].used, 1);
  });
  test('other account or school cannot inspect or block the owner scope', async () => {
    const a = await actor(),
      other = await actor(),
      b = binding();
    await claim(a, b);
    assert.equal(await ledger().status(other, lookup(b)), null);
    assert.equal(await ledger().status(a, { ...lookup(b), schoolId: 'other' }), null);
    assert.equal((await claim(other, binding())).result.status, 'claimed');
    assert.equal((await claim(a, binding({ schoolId: 'other' }))).result.status, 'claimed');
  });
  test('revoked session fails even if operation exists; a new valid session can only inspect opaque state', async () => {
    const a = await actor(),
      b = binding(),
      { result: op } = await claim(a, b),
      next = await secondSession(a);
    await pool.query('DELETE FROM platform_account_sessions WHERE token_sha256=$1', [
      a.sessionHash,
    ]);
    await assert.rejects(ledger().status(a, lookup(b)), { code: 'PUBLIC_AGENT_SESSION_EXPIRED' });
    const state = await ledger().status(next, lookup(b));
    assert.equal(state.operationId, op.operationId);
    assert.equal(JSON.stringify(state).includes('payloadHash'), false);
    assert.equal(JSON.stringify(state).includes('sessionHash'), false);
  });
  test('terminal acknowledgement requires explicit approval and unblocks once, without another debit', async () => {
    const a = await actor(),
      b = binding(),
      { c, result: op } = await claim(a, b);
    await assert.rejects(ack(a, b, op.operationId, false));
    await assert.rejects(ack(a, b, op.operationId));
    const done = await ledger().complete(a, b, op.operationId, op.executionToken, result(b));
    assert.equal(done.status, 'completed');
    const status = await ledger().status(a, lookup(b));
    assert.equal(status.status, 'completed');
    await assert.rejects(ack(a, b, op.operationId, false));
    await ack(a, b, op.operationId);
    assert.equal(await ledger().status(a, lookup(b)), null);
    assert.equal((await ledger().claim(a, b, c.confirmationId)).status, 'completed');
    const quota = await pool.query(
      "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
      [a.platformAccountId],
    );
    assert.equal(quota.rows[0].used, 1);
    assert.equal((await claim(a, binding())).result.status, 'claimed');
  });
  test('lost commit acknowledgement survives a new ledger and never double-debits', async () => {
    const a = await actor(),
      b = binding(),
      c = await ledger().confirm(a, b);
    const disconnect = {
      async transaction(fn, options) {
        await db.transaction(fn, options);
        throw new Error('synthetic lost commit response');
      },
    };
    const lost = new PlatformPublicAgentLedger(disconnect, policy);
    await assert.rejects(lost.claim(a, b, c.confirmationId), /synthetic lost commit response/);
    assert.equal((await ledger().status(a, lookup(b))).status, 'pending');
    assert.equal((await ledger().claim(a, b, c.confirmationId)).status, 'pending');
    const quota = await pool.query(
      "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
      [a.platformAccountId],
    );
    assert.equal(quota.rows[0].used, 1);
  });
  test('database partial unique index independently rejects duplicate unresolved scope', async () => {
    const a = await actor(),
      b = binding(),
      other = binding(),
      c = await ledger().confirm(a, other);
    await claim(a, b);
    await assert.rejects(
      pool.query(
        `INSERT INTO platform_public_agent_operations
      (id,platform_account_id,credential_id,session_hash,task,request_id,school_id,payload_hash,provider,model,confirmation_id,status,execution_token_hash,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',$12,clock_timestamp()+interval '10 seconds')`,
        [
          `pago_${randomUUID()}`,
          a.platformAccountId,
          a.credentialId,
          a.sessionHash,
          other.task,
          other.requestId,
          other.schoolId,
          other.payloadHash,
          other.provider,
          other.model,
          c.confirmationId,
          hash('synthetic token'),
        ],
      ),
      { code: '23505' },
    );
  });
  test('quota failure rolls back consumed confirmation and operation atomically', async () => {
    const a = await actor(),
      b = binding();
    const zeroBudget = new PlatformPublicAgentLedger(db, { ...policy, accountDailyLimit: 1 });
    const c = await zeroBudget.confirm(a, b);
    const day = new Date().toISOString().slice(0, 10);
    await pool.query("INSERT INTO platform_public_agent_quota VALUES ('account',$1,$1,$2,1)", [
      a.platformAccountId,
      day,
    ]);
    await assert.rejects(zeroBudget.claim(a, b, c.confirmationId), {
      code: 'PUBLIC_AGENT_FREE_QUOTA_UNAVAILABLE',
    });
    const conf = await pool.query(
      'SELECT consumed_at FROM platform_public_agent_confirmations WHERE id=$1',
      [c.confirmationId],
    );
    const ops = await pool.query(
      'SELECT count(*)::int AS count FROM platform_public_agent_operations WHERE platform_account_id=$1',
      [a.platformAccountId],
    );
    assert.equal(conf.rows[0].consumed_at, null);
    assert.equal(ops.rows[0].count, 0);
  });
}
