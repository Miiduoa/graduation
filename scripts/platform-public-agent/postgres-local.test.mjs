import { test, before, after } from 'node:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  const legacyCompiled = process.env.CAMPUS_AGENT_PG_LEGACY_COMPILED;
  assert.ok(legacyCompiled);
  assert.equal(realpathSync(legacyCompiled), realpathSync(join(folder, 'legacy-compiled')));
  const { PlatformPublicAgentLedger: LegacyLedger } = await import(
    pathToFileURL(join(legacyCompiled, 'ledger.js')).href
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
    await ledger().beginDispatch(a, b, op.operationId, op.executionToken);
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
  test('verified not-dispatched tombstone forbids late dispatch and needs explicit ack', async () => {
    const a = await actor(),
      b = binding(),
      { result: op } = await claim(a, b);
    await ledger().markUnknown(a, b, op.operationId, op.executionToken);
    const newer = await secondSession(a);
    const reconciled = await ledger().reconcileNoDispatch(newer, {
      ...lookup(b),
      operationId: op.operationId,
    });
    assert.deepEqual(reconciled, { status: 'failed', operationId: op.operationId });
    await assert.rejects(ledger().beginDispatch(a, b, op.operationId, op.executionToken));
    await blocked(ledger().confirm(newer, binding()));
    await ack(newer, b, op.operationId);
    assert.equal(await ledger().status(newer, lookup(b)), null);
    const quota = await pool.query(
      "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
      [a.platformAccountId],
    );
    assert.equal(quota.rows[0].used, 1);
  });
  test('a fresh process can reconcile only a durable not-dispatched operation', async () => {
    const a = await actor(),
      b = binding(),
      { result: op } = await claim(a, b);
    await ledger().markUnknown(a, b, op.operationId, op.executionToken);
    const newer = await secondSession(a);
    const child = spawnSync(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), 'postgres-reconcile-child.mjs')],
      {
        input: JSON.stringify({ actor: newer, scope: lookup(b), operationId: op.operationId }),
        encoding: 'utf8',
        env: {
          PATH: '/usr/bin:/bin',
          CAMPUS_AGENT_PG_FOLDER: folder,
          CAMPUS_AGENT_PG_COMPILED: compiled,
          CAMPUS_AGENT_PG_PARENT: parent,
          C1_TEST_PARENT: String(process.pid),
        },
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const value = JSON.parse(child.stdout);
    assert.deepEqual(value.before, { status: 'unknown', operationId: op.operationId });
    assert.deepEqual(value.after, { status: 'failed', operationId: op.operationId });
    await assert.rejects(ledger().beginDispatch(a, b, op.operationId, op.executionToken));
    assert.deepEqual(await ledger().status(newer, lookup(b)), {
      status: 'failed',
      operationId: op.operationId,
    });
  });
  test('lost dispatch commit response remains unknown, cannot reconcile or dispatch again', async () => {
    const a = await actor(),
      b = binding(),
      { result: op } = await claim(a, b);
    const lost = new PlatformPublicAgentLedger(
      {
        async transaction(fn, opts) {
          await db.transaction(fn, opts);
          throw Error('synthetic lost dispatch commit');
        },
      },
      policy,
    );
    await assert.rejects(
      lost.beginDispatch(a, b, op.operationId, op.executionToken),
      /synthetic lost dispatch commit/u,
    );
    await ledger().markUnknown(a, b, op.operationId, op.executionToken);
    await assert.rejects(
      ledger().reconcileNoDispatch(a, { ...lookup(b), operationId: op.operationId }),
      { code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' },
    );
    await assert.rejects(ledger().beginDispatch(a, b, op.operationId, op.executionToken));
    assert.equal((await ledger().status(a, lookup(b))).status, 'unknown');
  });
  test('concurrent dispatch and no-dispatch reconcile never both succeed', async () => {
    for (let i = 0; i < 12; i++) {
      const a = await actor(),
        b = binding(),
        short = new PlatformPublicAgentLedger(db, { ...policy, operationTtlMs: 25 });
      const c = await short.confirm(a, b),
        op = await short.claim(a, b, c.confirmationId);
      const [start, reconcile] = await Promise.allSettled([
        short.beginDispatch(a, b, op.operationId, op.executionToken),
        short.reconcileNoDispatch(a, { ...lookup(b), operationId: op.operationId }),
      ]);
      assert.ok(!(start.status === 'fulfilled' && reconcile.status === 'fulfilled'));
      if (start.status === 'fulfilled') {
        await short.markUnknown(a, b, op.operationId, op.executionToken);
        await assert.rejects(
          short.reconcileNoDispatch(a, { ...lookup(b), operationId: op.operationId }),
        );
      } else if (reconcile.status === 'fulfilled') {
        await assert.rejects(short.beginDispatch(a, b, op.operationId, op.executionToken));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const final = await short.reconcileNoDispatch(a, {
          ...lookup(b),
          operationId: op.operationId,
        });
        assert.equal(final.status, 'failed');
      }
      const row = (
        await pool.query(
          'SELECT status,dispatch_started_at,failure_code FROM platform_public_agent_operations WHERE id=$1',
          [op.operationId],
        )
      ).rows[0];
      assert.ok(!(row.failure_code === 'NOT_DISPATCHED' && row.dispatch_started_at !== null));
    }
  });
  test('new session scope and revoked original session cannot forge dispatch evidence', async () => {
    const a = await actor(),
      b = binding(),
      { result: op } = await claim(a, b),
      newer = await secondSession(a),
      outsider = await actor();
    await assert.rejects(ledger().beginDispatch(newer, b, op.operationId, op.executionToken));
    await assert.rejects(
      ledger().reconcileNoDispatch(outsider, { ...lookup(b), operationId: op.operationId }),
      { code: 'PUBLIC_AGENT_OPERATION_NOT_FOUND' },
    );
    await pool.query('DELETE FROM platform_account_sessions WHERE token_sha256=$1', [
      a.sessionHash,
    ]);
    await assert.rejects(ledger().beginDispatch(a, b, op.operationId, op.executionToken), {
      code: 'PUBLIC_AGENT_SESSION_EXPIRED',
    });
    await assert.rejects(
      ledger().reconcileNoDispatch(newer, { ...lookup(b), operationId: op.operationId }),
      { code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' },
    );
  });
  test('mixed version: actual legacy ledger cannot create an unfenced operation or consume quota', async () => {
    const a = await actor(),
      b = binding(),
      old = new LegacyLedger(db, policy),
      c = await old.confirm(a, b);
    await assert.rejects(old.claim(a, b, c.confirmationId), { code: '23502' });
    const row = (
      await pool.query('SELECT consumed_at FROM platform_public_agent_confirmations WHERE id=$1', [
        c.confirmationId,
      ])
    ).rows[0];
    assert.equal(row.consumed_at, null);
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM platform_public_agent_operations WHERE platform_account_id=$1',
          [a.platformAccountId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM platform_public_agent_quota WHERE platform_account_id=$1',
          [a.platformAccountId],
        )
      ).rows[0].n,
      0,
    );
    const modern = await ledger().claim(a, b, c.confirmationId);
    assert.equal(modern.status, 'claimed');
    const legacyReplay = await old.claim(a, b, c.confirmationId);
    assert.equal(legacyReplay.status, 'pending');
    assert.notEqual(legacyReplay.status, 'claimed');
  });
  test('explicit provider failures require dispatch fence, never masquerade as NOT_DISPATCHED', async () => {
    for (const code of [
      'FREE_QUOTA_UNAVAILABLE',
      'DESTINATION_UNCLEAR',
      'INVALID_PROVIDER_RESPONSE',
    ]) {
      const a = await actor(),
        b = binding(),
        { result: op } = await claim(a, b);
      await assert.rejects(ledger().fail(a, b, op.operationId, op.executionToken, code));
      await ledger().beginDispatch(a, b, op.operationId, op.executionToken);
      const failed = await ledger().fail(a, b, op.operationId, op.executionToken, code);
      assert.equal(failed.status, 'failed');
      assert.equal(failed.failureCode, code);
      await assert.rejects(
        ledger().reconcileNoDispatch(a, { ...lookup(b), operationId: op.operationId }),
        { code: 'PUBLIC_AGENT_OUTCOME_UNKNOWN' },
      );
      const quota = (
        await pool.query(
          "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
          [a.platformAccountId],
        )
      ).rows[0];
      assert.equal(quota.used, 1);
    }
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
      (id,platform_account_id,credential_id,session_hash,task,request_id,school_id,payload_hash,provider,model,confirmation_id,status,execution_token_hash,expires_at,dispatch_fence_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'running',$12,clock_timestamp()+interval '10 seconds',1)`,
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
  test(
    'real Fastify 5.12.7 and PostgreSQL compose two confirmations around a synthetic Groq plan',
    { skip: !process.env.CAMPUS_AGENT_FASTIFY_ROOT },
    async () => {
      const { createRequire } = await import('node:module');
      const require = createRequire(join(process.env.CAMPUS_AGENT_FASTIFY_ROOT, 'package.json'));
      const fastify = require('fastify');
      assert.equal(require('fastify/package.json').version, '5.12.7');
      const { registerPlatformPublicTaskRoutes } = await import(
        pathToFileURL(join(compiled, 'fastify-candidate.js')).href
      );
      const { createGroqNavigationPlanner } = await import(
        pathToFileURL(join(compiled, 'groq-navigation-plan.js')).href
      );
      const a = await actor(),
        handle = `ps_${'a'.repeat(43)}`;
      await pool.query(
        'UPDATE platform_account_sessions SET token_sha256=$1 WHERE token_sha256=$2',
        [hash(handle), a.sessionHash],
      );
      a.sessionHash = hash(handle);
      const accounts = {
        async resolveSession(auth) {
          if (auth !== `Platform ${handle}`)
            throw Object.assign(new Error('synthetic invalid'), {
              code: 'PLATFORM_SESSION_INVALID',
            });
          const row = (
            await pool.query(
              'SELECT expires_at FROM platform_account_sessions WHERE token_sha256=$1 AND platform_account_id=$2',
              [a.sessionHash, a.platformAccountId],
            )
          ).rows[0];
          if (!row)
            throw Object.assign(new Error('synthetic revoked'), {
              code: 'PLATFORM_SESSION_INVALID',
            });
          return {
            platformAccountId: a.platformAccountId,
            credentialId: a.credentialId,
            expiresAt: a.expiresAt,
          };
        },
      };
      const catalog = {
        schoolId: 'pu',
        updatedAt: '2026-10-19',
        label: '合成公開來源',
        places: [
          {
            id: 'from',
            name: '甲樓',
            lat: 24,
            lng: 120,
            sourceUrl: 'https://www.openstreetmap.org/way/1',
          },
          {
            id: 'to',
            name: '乙館',
            lat: 24.1,
            lng: 120.1,
            sourceUrl: 'https://www.openstreetmap.org/way/2',
          },
        ],
      };
      let calls = 0,
        mode = 'success',
        loseFailureAck = false,
        loseDispatchAck = false,
        loseClaimAck = false;
      const serviceDb = {
        async transaction(fn, options) {
          let finalizing = false,
            dispatching = false,
            claiming = false;
          const result = await db.transaction(
            (tx) =>
              fn({
                query(sql, params) {
                  if (sql.includes('SET status=$6,result_json=$7::jsonb')) finalizing = true;
                  if (sql.includes('SET dispatch_started_at=clock_timestamp()')) dispatching = true;
                  if (sql.includes('INSERT INTO platform_public_agent_operations')) claiming = true;
                  return tx.query(sql, params);
                },
              }),
            options,
          );
          if ((dispatching && loseDispatchAck) || (claiming && loseClaimAck)) {
            loseDispatchAck = false;
            loseClaimAck = false;
            throw new Error('synthetic lost fence or claim acknowledgement');
          }
          if (finalizing && loseFailureAck) {
            loseFailureAck = false;
            throw new Error('synthetic lost commit acknowledgement');
          }
          return result;
        },
      };
      const readPublicCatalog = async () => globalThis.structuredClone(catalog);
      const groqPlan = createGroqNavigationPlanner({
        enabled: true,
        readPublicCatalog,
        fetch: async (_url, request) => {
          calls++;
          const sent = JSON.parse(request.body);
          assert.equal(sent.model, 'openai/gpt-oss-120b');
          if (mode === 'quota' || mode === 'lost') {
            if (mode === 'lost') loseFailureAck = true;
            return new globalThis.Response('{}', {
              status: 429,
              headers: { 'content-type': 'application/json' },
            });
          }
          const content =
            mode === 'unclear'
              ? JSON.stringify({ kind: 'unclear', fromId: null, toId: null })
              : mode === 'invalid'
                ? '{"kind":"route","fromId":"from","fromId":"to","toId":"to"}'
                : JSON.stringify({ kind: 'route', fromId: 'from', toId: 'to' });
          return new globalThis.Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content,
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      });
      const disabled = fastify();
      registerPlatformPublicTaskRoutes(disabled, {
        enabled: true,
        db,
        accounts,
        policy,
        readPublicCatalog,
        groqPlan,
      });
      const denied = await disabled.inject({
        method: 'POST',
        url: '/v1/auth/platform/public-agent/prepareGroq',
        headers: { authorization: `Platform ${handle}`, 'content-type': 'application/json' },
        payload: { schoolId: 'pu', query: '公開地點', requestId: 'free_not_verified_01' },
      });
      assert.equal(denied.statusCode, 503);
      assert.equal(denied.json().code, 'PUBLIC_AGENT_EXECUTOR_UNAVAILABLE');
      assert.equal(calls, 0);
      await disabled.close();
      let app = fastify();
      const register = () =>
        registerPlatformPublicTaskRoutes(app, {
          enabled: true,
          freeTierVerified: true,
          db: serviceDb,
          accounts,
          policy,
          readPublicCatalog,
          groqPlan,
        });
      register();
      const send = async (action, payload, headers = {}) => {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/auth/platform/public-agent/${action}`,
          headers: {
            authorization: `Platform ${handle}`,
            'content-type': 'application/json',
            ...headers,
          },
          payload,
        });
        return { status: res.statusCode, body: res.json() };
      };
      try {
        const input = {
          schoolId: 'pu',
          query: '從入口去圖書館',
          requestId: `http_${randomUUID()}`,
        };
        assert.equal(
          (await send('prepareGroq', input, { origin: 'https://untrusted.test' })).status,
          403,
        );
        const p = await send('prepareGroq', input);
        assert.equal(p.status, 200);
        assert.equal(p.body.provider, 'groq');
        assert.equal(calls, 0);
        assert.equal(
          (await send('confirm', { approved: false, request: p.body.request })).status,
          409,
        );
        assert.equal(calls, 0);
        const c = await send('confirm', { approved: true, request: p.body.request });
        assert.equal(c.status, 200);
        assert.equal(calls, 0);
        const payload = { confirmationId: c.body.confirmationId, request: p.body.request };
        const [first, second] = await Promise.all([
          send('execute', payload),
          send('execute', payload),
        ]);
        assert.ok([first.body.status, second.body.status].includes('completed'));
        assert.equal(calls, 1);
        const completed = first.body.status === 'completed' ? first.body : second.body;
        const route = {
          approved: true,
          operationId: completed.operationId,
          request: p.body.request,
          fromId: 'from',
          toId: 'to',
        };
        assert.equal((await send('route', { ...route, approved: false })).status, 409);
        assert.equal((await send('route', { ...route, fromId: 'to', toId: 'from' })).status, 502);
        const link = await send('route', route);
        assert.equal(link.status, 200);
        assert.equal(new globalThis.URL(link.body.receipt.url).hostname, 'www.google.com');
        await app.close();
        app = fastify();
        register();
        const restarted = await send('status', {
          task: 'public-campus-navigation',
          schoolId: 'pu',
        });
        assert.deepEqual(restarted.body, {
          status: 'completed',
          operationId: completed.operationId,
        });
        // A separate Node process reconstructs ledger and its pool using the same
        // owned socket. This cannot inherit the first process's in-memory state.
        const childSource = `import { Pool } from 'pg'; import { pathToFileURL } from 'node:url'; import { join } from 'node:path';
        let input=''; for await (const chunk of process.stdin) input += chunk; const actor=JSON.parse(input);
        const { PlatformPublicAgentLedger }=await import(pathToFileURL(join(process.env.CAMPUS_AGENT_PG_COMPILED,'ledger.js')).href);
        const pool=new Pool({host:join(process.env.CAMPUS_AGENT_PG_FOLDER,'socket'),port:55432,database:'postgres',user:'campus_synthetic',ssl:false});
        const db={async transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
        try { const ledger=new PlatformPublicAgentLedger(db,{providerBudgetKey:'synthetic-free',providerDailyLimit:1000,accountDailyLimit:1000}); const state=await ledger.status(actor,{task:'public-campus-navigation',schoolId:'pu'}); process.stdout.write(JSON.stringify(state)); } finally {await pool.end();}`;
        const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
          cwd: process.cwd(),
          env: process.env,
          input: JSON.stringify(a),
          encoding: 'utf8',
        });
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(JSON.parse(child.stdout), restarted.body);
        const next = await send('prepareGroq', { ...input, requestId: `after_${randomUUID()}` });
        assert.equal(
          (await send('confirm', { approved: true, request: next.body.request })).body.code,
          'PUBLIC_AGENT_OPEN_OPERATION',
        );
        const ack = await send('ack', {
          task: 'public-campus-navigation',
          schoolId: 'pu',
          operationId: completed.operationId,
          approved: true,
        });
        assert.equal(ack.body.status, 'acknowledged');
        assert.equal((await send('route', route)).status, 404);
        assert.equal((await send('read', p.body.request)).status, 404);
        for (const [kind, expected] of [
          ['quota', 'FREE_QUOTA_UNAVAILABLE'],
          ['unclear', 'DESTINATION_UNCLEAR'],
          ['invalid', 'INVALID_PROVIDER_RESPONSE'],
          ['lost', 'FREE_QUOTA_UNAVAILABLE'],
        ]) {
          mode = kind;
          const prep = await send('prepareGroq', { ...input, requestId: `case_${randomUUID()}` });
          const confirmation = await send('confirm', {
            approved: true,
            request: prep.body.request,
          });
          const request = {
            confirmationId: confirmation.body.confirmationId,
            request: prep.body.request,
          };
          const before = calls;
          const value = await send('execute', request);
          assert.equal(calls, before + 1);
          if (kind === 'lost') {
            assert.equal(value.status, 503);
            assert.equal(value.body.code, 'PUBLIC_AGENT_OUTCOME_UNKNOWN');
          } else {
            assert.equal(value.body.status, 'failed');
            assert.equal(value.body.failureCode, expected);
          }
          const status = await send('status', { task: 'public-campus-navigation', schoolId: 'pu' });
          assert.equal(status.body.status, 'failed');
          const blocked = await send('prepareGroq', {
            ...input,
            requestId: `later_${randomUUID()}`,
          });
          assert.equal(
            (await send('confirm', { approved: true, request: blocked.body.request })).body.code,
            'PUBLIC_AGENT_OPEN_OPERATION',
          );
          assert.equal((await send('execute', request)).body.status, 'failed');
          assert.equal(calls, before + 1);
          assert.equal(
            (
              await send('ack', {
                task: 'public-campus-navigation',
                schoolId: 'pu',
                operationId: status.body.operationId,
                approved: true,
              })
            ).body.status,
            'acknowledged',
          );
        }
        // Claim committed but its acknowledgement disappeared: no dispatch can
        // start, and only durable absence of the fence permits reconciliation.
        mode = 'success';
        const recoveryPrep = await send('prepareGroq', {
          ...input,
          requestId: `claim_${randomUUID()}`,
        });
        const recoveryConfirm = await send('confirm', {
          approved: true,
          request: recoveryPrep.body.request,
        });
        const recoveryRequest = {
          confirmationId: recoveryConfirm.body.confirmationId,
          request: recoveryPrep.body.request,
        };
        const beforeClaim = calls;
        loseClaimAck = true;
        assert.equal(
          (await send('execute', recoveryRequest)).body.code,
          'PUBLIC_AGENT_OUTCOME_UNKNOWN',
        );
        assert.equal(calls, beforeClaim);
        const pending = await send('status', { task: 'public-campus-navigation', schoolId: 'pu' });
        assert.equal(pending.body.status, 'pending');
        await pool.query(
          "UPDATE platform_public_agent_operations SET created_at=clock_timestamp()-interval '3 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
          [pending.body.operationId],
        );
        await app.close();
        app = fastify();
        register();
        const recovered = await send('reconcile', {
          task: 'public-campus-navigation',
          schoolId: 'pu',
          operationId: pending.body.operationId,
        });
        assert.deepEqual(recovered.body, {
          status: 'failed',
          operationId: pending.body.operationId,
        });
        const tombstone = await send('read', recoveryPrep.body.request);
        assert.equal(tombstone.body.failureCode, 'NOT_DISPATCHED');
        assert.equal(calls, beforeClaim);
        assert.equal(
          (
            await send('ack', {
              task: 'public-campus-navigation',
              schoolId: 'pu',
              operationId: pending.body.operationId,
              approved: true,
            })
          ).body.status,
          'acknowledged',
        );

        // A committed dispatch marker with lost ACK is fundamentally different:
        // no provider call, but the store cannot prove absence of dispatch.
        const fencePrep = await send('prepareGroq', {
          ...input,
          requestId: `fence_${randomUUID()}`,
        });
        const fenceConfirm = await send('confirm', {
          approved: true,
          request: fencePrep.body.request,
        });
        const fenceRequest = {
          confirmationId: fenceConfirm.body.confirmationId,
          request: fencePrep.body.request,
        };
        const beforeFence = calls;
        loseDispatchAck = true;
        assert.equal(
          (await send('execute', fenceRequest)).body.code,
          'PUBLIC_AGENT_OUTCOME_UNKNOWN',
        );
        assert.equal(calls, beforeFence);
        await app.close();
        app = fastify();
        register();
        const fenceState = await send('status', {
          task: 'public-campus-navigation',
          schoolId: 'pu',
        });
        assert.ok(['unknown', 'pending'].includes(fenceState.body.status));
        const stored = await pool.query(
          'SELECT dispatch_started_at FROM platform_public_agent_operations WHERE id=$1',
          [fenceState.body.operationId],
        );
        assert.ok(stored.rows[0].dispatch_started_at);
        assert.equal(
          (
            await send('reconcile', {
              task: 'public-campus-navigation',
              schoolId: 'pu',
              operationId: fenceState.body.operationId,
            })
          ).body.code,
          'PUBLIC_AGENT_OUTCOME_UNKNOWN',
        );
        const quotaBefore = await pool.query(
          "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
          [a.platformAccountId],
        );
        await send('execute', fenceRequest);
        const quotaAfter = await pool.query(
          "SELECT used FROM platform_public_agent_quota WHERE budget_kind='account' AND platform_account_id=$1",
          [a.platformAccountId],
        );
        assert.equal(quotaAfter.rows[0].used, quotaBefore.rows[0].used);
        assert.equal(calls, beforeFence);
      } finally {
        await app.close();
      }
    },
  );
}
