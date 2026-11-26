// @vitest-environment node
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createSqlTronClassPlatformClosureStore, createTronClassPlatformClosureWorker, verifyTronClassPlatformClosureReady } from './tronClassPlatformClosure';
import { createTronClassPlatformClosureDatabase } from './tronClassPlatformClosureDatabase';

// A disposable loopback test database only. Product DB URLs are never read.
const port = process.env.NUNI_TEST_POSTGRES_PORT;
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const schema = `tronclass_closure_${suffix}`;
const workerRole = `tc_worker_${suffix}`;
const closerRole = `tc_closer_${suffix}`;
type Client = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
const clients: Client[] = [];
let control: Client;
let first: Client;
let second: Client;
let initialEvents: Record<string, unknown>[] = [];
const a = 'pa_11111111-1111-4111-8111-111111111111';
const b = 'pa_22222222-2222-4222-8222-222222222222';
const c = 'pa_33333333-3333-4333-8333-333333333333';
async function connect(name: string) {
  const numericPort = Number(port);
  if (!/^\d+$/.test(port || '') || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
    throw new Error('An explicit disposable loopback PostgreSQL port is required');
  const { Client: PgClient } = createRequire(import.meta.url)('pg') as { Client: new (options: Record<string, unknown>) => Client };
  const client = new PgClient({ host: '127.0.0.1', port: numericPort, user: 'box', database: 'postgres',
    password: 'attachment_test_only', ssl: false, application_name: `${name}_${suffix}`,
    connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  await client.connect();
  clients.push(client);
  await client.query(`SET search_path TO ${schema}`);
  return client;
}
const store = (client: Client) => createSqlTronClassPlatformClosureStore(async (sql, parameters) => (await client.query(sql, parameters)).rows);
const events = async () => (await control.query('SELECT * FROM tronclass_account_closure_outbox ORDER BY id')).rows;
const close = (client = control, accountId = a) => client.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [accountId]);

describe.skipIf(!port)('real PostgreSQL platform closure outbox', () => {
  beforeAll(async () => {
    control = await connect('tc_setup');
    await control.query(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.platform_accounts (id text PRIMARY KEY, state text NOT NULL)`);
    await control.query("INSERT INTO platform_accounts (id, state) VALUES ($1,'active'),($2,'closed')", [a, c]);
    const migration = await readFile(path.resolve(process.cwd(), '../../deploy/nuni-api/tronclass-account-closure/001_tronclass_account_closure_outbox.sql'), 'utf8');
    await control.query('BEGIN');
    try { await control.query(migration); await control.query('COMMIT'); }
    catch (error) { await control.query('ROLLBACK'); throw error; }
    initialEvents = await events();
    await control.query(`CREATE ROLE ${workerRole}; CREATE ROLE ${closerRole};
      GRANT USAGE ON SCHEMA ${schema} TO ${workerRole}, ${closerRole};
      GRANT SELECT, DELETE ON tronclass_account_closure_outbox TO ${workerRole};
      GRANT UPDATE (attempts, next_attempt_at, lease_token, lease_expires_at, last_failure)
        ON tronclass_account_closure_outbox TO ${workerRole};
      GRANT SELECT (id, state), UPDATE (state), DELETE ON platform_accounts TO ${closerRole}`);
    first = await connect('tc_first');
    second = await connect('tc_second');
  }, 20_000);

  beforeEach(async () => {
    await Promise.all(clients.map(client => client.query('ROLLBACK; RESET ROLE')));
    await control.query('TRUNCATE platform_accounts, tronclass_account_closure_outbox RESTART IDENTITY');
    await control.query("INSERT INTO platform_accounts (id, state) VALUES ($1,'active'),($2,'active')", [a, b]);
  });

  afterAll(async () => {
    // The forged-trigger ACL test creates a role-owned TEMP table; closing that
    // connection first removes it before DROP ROLE, including on assertion failure.
    await Promise.all(clients.filter(client => client !== control).map(client => client.end()));
    if (control) {
      try {
        await control.query('ROLLBACK; RESET ROLE');
        await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${workerRole}; DROP ROLE IF EXISTS ${closerRole}`);
      } finally { await control.end(); }
    }
  });

  it.each(['closed', 'deleted'])('atomically records a real account transition to %s and keeps suspension out of the queue', async state => {
    await control.query("UPDATE platform_accounts SET state='suspended' WHERE id=$1", [a]);
    expect(await events()).toEqual([]);
    await control.query('UPDATE platform_accounts SET state=$1 WHERE id=$2', [state, a]);
    expect(await events()).toEqual([expect.objectContaining({ platform_account_id: a, reason: state, attempts: 0, lease_token: null })]);
    await control.query('UPDATE platform_accounts SET state=$1 WHERE id=$2', [state, a]);
    expect(await events()).toHaveLength(1);
  });

  it('backfills only authoritative already-closed rows when the candidate migration is applied', () => {
    expect(initialEvents).toEqual([expect.objectContaining({ platform_account_id: c, reason: 'closed', attempts: 0 })]);
  });

  it('records an inserted closed account while leaving active inserts alone', async () => {
    expect(await events()).toEqual([]);
    await control.query("INSERT INTO platform_accounts (id, state) VALUES ($1,'closed')", [c]);
    expect(await events()).toEqual([expect.objectContaining({ platform_account_id: c, reason: 'closed' })]);
  });

  it('keeps the verified identity after hard deletion and removes it only after successful cleanup', async () => {
    await control.query('DELETE FROM platform_accounts WHERE id=$1', [a]);
    expect((await control.query('SELECT id FROM platform_accounts WHERE id=$1', [a])).rows).toEqual([]);
    expect(await events()).toEqual([expect.objectContaining({ platform_account_id: a, reason: 'deleted' })]);
    const closeOwner = vi.fn(async () => {});
    expect(await createTronClassPlatformClosureWorker({ store: store(first), closeOwner })())
      .toEqual({ claimed: 1, completed: 1, failed: 0, stale: 0 });
    expect(closeOwner).toHaveBeenCalledExactlyOnceWith(`platform:${a}`);
    expect(await events()).toEqual([]);
    expect((await control.query('SELECT id, state FROM platform_accounts')).rows).toEqual([{ id: b, state: 'active' }]);
  });

  it('does not clean an uncommitted or rolled-back closure', async () => {
    await first.query('BEGIN');
    await close(first);
    expect(await store(second).claim()).toBeNull();
    await first.query('ROLLBACK');
    expect(await events()).toEqual([]);
    expect((await control.query('SELECT state FROM platform_accounts WHERE id=$1', [a])).rows).toEqual([{ state: 'active' }]);
    await first.query('BEGIN');
    await close(first);
    await first.query('COMMIT');
    expect(await store(second).claim()).toMatchObject({ accountId: a, attempts: 1 });
  });

  it('deduplicates pending closure/deletion and permits a later idempotent deletion event after cleanup', async () => {
    await close();
    await control.query("UPDATE platform_accounts SET state='deleted' WHERE id=$1", [a]);
    expect(await events()).toHaveLength(1);
    const closeOwner = vi.fn(async () => {});
    const worker = createTronClassPlatformClosureWorker({ store: store(first), closeOwner });
    expect((await worker()).completed).toBe(1);
    await control.query('DELETE FROM platform_accounts WHERE id=$1', [a]);
    expect(await events()).toHaveLength(1);
    expect((await worker()).completed).toBe(1);
    expect(closeOwner).toHaveBeenNthCalledWith(1, `platform:${a}`);
    expect(closeOwner).toHaveBeenNthCalledWith(2, `platform:${a}`);
    expect(await events()).toEqual([]);
  });

  it('persists backoff after cleanup failure and retries from a new worker instance', async () => {
    await close();
    const failed = createTronClassPlatformClosureWorker({ store: store(first), closeOwner: async () => { throw new Error('private-cookie'); } });
    expect(await failed()).toEqual({ claimed: 1, completed: 0, failed: 1, stale: 0 });
    const [pending] = await events();
    expect(pending).toMatchObject({ attempts: 1, lease_token: null, lease_expires_at: null, last_failure: 'cleanup_failed' });
    expect(JSON.stringify(pending)).not.toContain('private-cookie');
    expect(await store(second).claim()).toBeNull();
    // Backing-off events are invisible to claim() but still count as unfinished cleanup.
    expect(await store(second).retrying()).toBe(1);
    expect((await control.query('SELECT next_attempt_at > clock_timestamp() AS waiting FROM tronclass_account_closure_outbox')).rows)
      .toEqual([{ waiting: true }]);
    await control.query("UPDATE tronclass_account_closure_outbox SET next_attempt_at=clock_timestamp()-interval '1 second'");
    const closeOwner = vi.fn(async () => {});
    expect(await createTronClassPlatformClosureWorker({ store: store(second), closeOwner })())
      .toEqual({ claimed: 1, completed: 1, failed: 0, stale: 0 });
    expect(closeOwner).toHaveBeenCalledExactlyOnceWith(`platform:${a}`);
    expect(await events()).toEqual([]);
  });

  it('recovers an expired crash lease and rejects stale-token completion or retry', async () => {
    await close();
    const old = (await store(first).claim())!;
    expect(await store(second).claim()).toBeNull();
    await control.query("UPDATE tronclass_account_closure_outbox SET lease_expires_at=clock_timestamp()-interval '1 second'");
    const current = (await store(second).claim())!;
    expect(current).toMatchObject({ id: old.id, accountId: a, attempts: 2 });
    expect(current.token).not.toBe(old.token);
    expect(await store(first).complete(old)).toBe(false);
    expect(await store(first).retry(old)).toBe(false);
    expect(await events()).toHaveLength(1);
    expect(await store(second).complete(current)).toBe(true);
    expect(await events()).toEqual([]);
  });

  it('allows only one simultaneous database connection to claim a single event', async () => {
    await close();
    const claims = await Promise.all([store(first).claim(), store(second).claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await events())[0]).toMatchObject({ attempts: 1 });
  });

  it('lets concurrent workers clean different events without duplicating an owner', async () => {
    await close(control, a); await close(control, b);
    const closeOwner = vi.fn<(owner: string) => Promise<void>>().mockResolvedValue(undefined);
    const outcomes = await Promise.all([
      createTronClassPlatformClosureWorker({ store: store(first), closeOwner })(1),
      createTronClassPlatformClosureWorker({ store: store(second), closeOwner })(1),
    ]);
    expect(outcomes.map(outcome => outcome.completed)).toEqual([1, 1]);
    expect(new Set(closeOwner.mock.calls.map(([owner]) => owner))).toEqual(new Set([`platform:${a}`, `platform:${b}`]));
    expect(await events()).toEqual([]);
  });

  it('skips an already locked queue row instead of waiting on another transaction', async () => {
    await close();
    await first.query('BEGIN');
    await first.query('SELECT id FROM tronclass_account_closure_outbox FOR UPDATE');
    try { expect(await store(second).claim()).toBeNull(); }
    finally { await first.query('ROLLBACK'); }
    expect(await store(second).claim()).toMatchObject({ accountId: a });
  });

  it('runs under the worker ACL without allowing event creation, identity replacement or account edits', async () => {
    await close();
    await first.query(`SET ROLE ${workerRole}`);
    try {
      const held = (await store(first).claim())!;
      expect(held.accountId).toBe(a);
      await expect(first.query("INSERT INTO tronclass_account_closure_outbox (platform_account_id, reason) VALUES ($1,'closed')", [b])).rejects.toThrow();
      await expect(first.query('UPDATE tronclass_account_closure_outbox SET platform_account_id=$1', [b])).rejects.toThrow();
      await expect(first.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [b])).rejects.toThrow();
      expect(await store(first).retry(held)).toBe(true);
      await control.query("UPDATE tronclass_account_closure_outbox SET next_attempt_at=clock_timestamp()-interval '1 second'");
      expect(await store(first).complete((await store(first).claim())!)).toBe(true);
    } finally { await first.query('RESET ROLE'); }
    expect(await events()).toEqual([]);
  });

  it('reports the closure pipeline ready only with the worker ACL and both triggers firing for ordinary transactions', async () => {
    const ready = () => verifyTronClassPlatformClosureReady(async (sql, parameters) => (await first.query(sql, parameters)).rows);
    await first.query(`SET ROLE ${workerRole}`);
    try { await expect(ready()).resolves.toBeUndefined(); }
    finally { await first.query('RESET ROLE'); }
    await first.query(`SET ROLE ${closerRole}`);
    try { await expect(ready()).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' }); }
    finally { await first.query('RESET ROLE'); }
    // The worker needs UPDATE on every lease and retry column, not just any one of them.
    for (const column of ['attempts', 'next_attempt_at', 'lease_token', 'lease_expires_at', 'last_failure']) {
      await control.query(`REVOKE UPDATE (${column}) ON tronclass_account_closure_outbox FROM ${workerRole}`);
      await first.query(`SET ROLE ${workerRole}`);
      try { await expect(ready()).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' }); }
      finally {
        await first.query('RESET ROLE');
        await control.query(`GRANT UPDATE (${column}) ON tronclass_account_closure_outbox TO ${workerRole}`);
      }
    }
    // A replica-only trigger does not fire for ordinary closure transactions.
    for (const [trigger, mode] of ['tronclass_account_closed', 'tronclass_account_deleted']
      .flatMap(name => [[name, 'DISABLE TRIGGER'], [name, 'ENABLE REPLICA TRIGGER']] as const)) {
      await control.query(`ALTER TABLE platform_accounts ${mode} ${trigger}`);
      await first.query(`SET ROLE ${workerRole}`);
      try { await expect(ready()).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' }); }
      finally {
        await first.query('RESET ROLE');
        await control.query(`ALTER TABLE platform_accounts ENABLE TRIGGER ${trigger}`);
      }
    }
    await first.query('SET search_path TO public');
    try { await expect(ready()).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' }); }
    finally { await first.query(`SET search_path TO ${schema}`); }
  });

  it('lets the platform closure trigger enqueue without granting the API role direct queue or trigger-function access', async () => {
    await first.query(`SET ROLE ${closerRole}`);
    try {
      await close(first);
      await expect(first.query('SELECT * FROM tronclass_account_closure_outbox')).rejects.toThrow();
      await expect(first.query("INSERT INTO tronclass_account_closure_outbox (platform_account_id, reason) VALUES ($1,'closed')", [b])).rejects.toThrow();
      await expect(first.query('SELECT enqueue_tronclass_account_closure()')).rejects.toThrow();
      await first.query('CREATE TEMP TABLE fake_accounts (id text, state text)');
      await expect(first.query(`CREATE TRIGGER forged_closure AFTER DELETE ON fake_accounts
        FOR EACH ROW EXECUTE FUNCTION ${schema}.enqueue_tronclass_account_closure()`)).rejects.toThrow();
      await first.query('DELETE FROM platform_accounts WHERE id=$1', [b]);
    } finally { await first.query('RESET ROLE'); }
    expect((await events()).map(event => event.platform_account_id)).toEqual([a, b]);
  });

  it('fails closed when the candidate migration is missing instead of scanning platform or Firestore accounts', async () => {
    await control.query('ALTER TABLE tronclass_account_closure_outbox RENAME TO temporarily_missing_closure_outbox');
    try {
      await expect(store(first).claim()).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' });
    } finally { await control.query('ALTER TABLE temporarily_missing_closure_outbox RENAME TO tronclass_account_closure_outbox'); }
  });

  it('enforces real server query deadlines and recovers the dedicated pool after a timeout', async () => {
    const database = createTronClassPlatformClosureDatabase(`postgresql://box:attachment_test_only@127.0.0.1:${port}/postgres?sslmode=disable`);
    try {
      expect(await database.query('SHOW statement_timeout')).toEqual([{ statement_timeout: '10s' }]);
      expect(await database.query('SHOW search_path')).toEqual([{ search_path: 'pg_catalog,public,pg_temp' }]);
      const started = Date.now();
      await expect(database.query('SELECT pg_sleep(60)')).rejects.toMatchObject({ code: 'TRONCLASS_PLATFORM_CLOSURE_UNAVAILABLE' });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(await database.query('SELECT 1 AS alive')).toEqual([{ alive: 1 }]);
    } finally { await database.close(); }
  }, 20_000);
});
