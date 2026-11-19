// @vitest-environment node
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSqlPlatformAssistantPermissionStore, type PlatformAssistantPermissionStore } from './platformAssistantPermissionStore';

// Explicitly opt into CI's disposable loopback PostgreSQL or an embedded runtime.
// No ambient product DATABASE_URL, host, account, or persistent files are read.
const modulePath = process.env.NUNI_PERMISSION_TEST_PGLITE;
const port = process.env.NUNI_TEST_POSTGRES_PORT;
const suffix = `${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const schema = `assistant_permission_${suffix}`;
const writerRole = `permission_writer_${suffix}`;
const closerRole = `permission_closer_${suffix}`;
const roles: string[] = [];
type Database = {
  exec(sql: string): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
};
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
const clients: PgClient[] = [];
async function client(name: string) {
  const numericPort = Number(port);
  if (!/^\d+$/.test(port || '') || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
    throw new Error('NUNI_TEST_POSTGRES_PORT must be an explicit local test port');
  const { Client } = createRequire(import.meta.url)('pg') as {
    Client: new (options: Record<string, unknown>) => PgClient;
  };
  const connection = new Client({
    host: '127.0.0.1', port: numericPort, user: 'box', database: 'postgres',
    password: 'attachment_test_only', ssl: false,
    application_name: name, connectionTimeoutMillis: 3000, statement_timeout: 10000,
  });
  await connection.connect();
  clients.push(connection);
  await connection.query(`SET search_path TO ${schema}`);
  return connection;
}
const connectionStore = (connection: PgClient) => createSqlPlatformAssistantPermissionStore(
  async (sql, params) => (await connection.query(sql, params)).rows,
);
async function waitForLock(control: PgClient, applicationName: string, advisory = false) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await control.query(`SELECT 1 FROM pg_stat_activity
      WHERE application_name = $1 AND wait_event_type = 'Lock'
      AND ($2::boolean = false OR wait_event = 'advisory')`, [applicationName, advisory]);
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected isolated test connection ${applicationName} to be blocked`);
}
const a = 'pa_11111111-1111-4111-8111-111111111111';
const b = 'pa_22222222-2222-4222-8222-222222222222';
const closed = 'pa_33333333-3333-4333-8333-333333333333';
const enabled = { createPersonalEvent: true, prepareFoodOrder: true };
const disabled = { createPersonalEvent: false, prepareFoodOrder: false };
let db: Database;
let store: PlatformAssistantPermissionStore;

describe.skipIf(!modulePath && !port)('isolated PostgreSQL permission storage', () => {
  beforeAll(async () => {
    if (port) {
      const setup = await client(`permission_setup_${suffix}`);
      db = {
        exec: (sql) => setup.query(sql), query: (sql, params) => setup.query(sql, params),
        close: async () => { await Promise.all(clients.map((connection) => connection.end())); },
      };
    } else {
      const { PGlite } = createRequire(import.meta.url)(modulePath!) as { PGlite: new () => Database };
      db = new PGlite();
    }
    await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await db.exec("CREATE TABLE platform_accounts (id text PRIMARY KEY, state text NOT NULL)");
    const migration = await readFile(path.resolve(process.cwd(), '../../deploy/nuni-api/assistant-permissions/283_platform_assistant_permissions.sql'), 'utf8');
    await db.exec(migration);
    store = createSqlPlatformAssistantPermissionStore(async (sql, params) => (await db.query(sql, params)).rows);
  }, 20000);
  beforeEach(async () => {
    await db.exec('TRUNCATE platform_accounts CASCADE');
    await db.query("INSERT INTO platform_accounts (id, state) VALUES ($1,'active'),($2,'active'),($3,'closed')", [a, b, closed]);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.exec('RESET ROLE');
      await db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      for (const role of roles) await db.exec(`DROP ROLE IF EXISTS ${role}`);
    } finally { await db.close(); }
  });

  it('persists one account and keeps another account at open defaults', async () => {
    expect((await store.read(a)).permissions).toEqual(enabled);
    expect(await store.save(a, 0, enabled)).toEqual({ scope: 'platform-account', accountId: a, revision: 1, permissions: enabled });
    expect((await store.read(a)).permissions).toEqual(enabled);
    expect((await store.read(b)).permissions).toEqual(enabled);
    await expect(store.read(closed)).rejects.toMatchObject({ status: 401 });
    await expect(store.save(closed, 0, enabled)).rejects.toMatchObject({ status: 401 });
  });

  it('does not let two first saves both succeed or overwrite a newer revocation', async () => {
    const competing = await Promise.allSettled([store.save(a, 0, enabled), store.save(a, 0, disabled)]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((competing.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ status: 409, code: 'ASSISTANT_PERMISSION_REVISION_CONFLICT' });
    await store.save(a, 1, disabled);
    await expect(store.save(a, 1, enabled)).rejects.toMatchObject({ status: 409 });
    expect(await store.read(a)).toMatchObject({ revision: 2, permissions: disabled });
  });

  it('does not create a missing row using an invented nonzero revision', async () => {
    await expect(store.save(a, 3, enabled)).rejects.toMatchObject({ status: 409 });
    expect(await store.read(a)).toMatchObject({ revision: 0, permissions: enabled });
  });

  it('denies a suspended account and removes settings when the account is closed', async () => {
    await store.save(a, 0, enabled);
    await db.query("UPDATE platform_accounts SET state='suspended' WHERE id=$1", [a]);
    await expect(store.read(a)).rejects.toMatchObject({ status: 401 });
    await expect(store.save(a, 1, disabled)).rejects.toMatchObject({ status: 401 });
    expect((await db.query('SELECT revision FROM platform_assistant_permissions WHERE platform_account_id=$1', [a])).rows).toHaveLength(1);
    await db.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [a]);
    expect((await db.query('SELECT revision FROM platform_assistant_permissions WHERE platform_account_id=$1', [a])).rows).toHaveLength(0);
    await db.query("UPDATE platform_accounts SET state='active' WHERE id=$1", [a]);
    expect(await store.read(a)).toMatchObject({ revision: 0, permissions: enabled });
  });

  it('cascades hard account deletion without affecting another account', async () => {
    await store.save(a, 0, enabled);
    await store.save(b, 0, enabled);
    await db.query('DELETE FROM platform_accounts WHERE id=$1', [a]);
    expect((await db.query('SELECT platform_account_id FROM platform_assistant_permissions')).rows).toEqual([{ platform_account_id: b }]);
  });

  it('works with the documented BFF grants without allowing account-state edits or preference deletion', async () => {
    roles.push(writerRole);
    await db.exec(`CREATE ROLE ${writerRole};
      GRANT USAGE ON SCHEMA ${schema} TO ${writerRole};
      GRANT SELECT (id, state), UPDATE (id) ON platform_accounts TO ${writerRole};
      GRANT SELECT, INSERT, UPDATE ON platform_assistant_permissions TO ${writerRole};
      SET ROLE ${writerRole}`);
    try {
      expect((await store.read(a)).revision).toBe(0);
      expect((await store.save(a, 0, enabled)).revision).toBe(1);
      expect((await store.save(a, 1, disabled)).revision).toBe(2);
      await expect(db.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [a])).rejects.toThrow();
      await expect(db.query('DELETE FROM platform_assistant_permissions WHERE platform_account_id=$1', [a])).rejects.toThrow();
    } finally { await db.exec('RESET ROLE'); }
  });

  it('cleans up through the closure trigger using the documented API grants', async () => {
    await store.save(a, 0, enabled);
    roles.push(closerRole);
    await db.exec(`CREATE ROLE ${closerRole};
      GRANT USAGE ON SCHEMA ${schema} TO ${closerRole};
      GRANT SELECT (id, state), UPDATE (state) ON platform_accounts TO ${closerRole};
      GRANT DELETE, SELECT (platform_account_id) ON platform_assistant_permissions TO ${closerRole};
      SET ROLE ${closerRole}`);
    try { await db.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [a]); }
    finally { await db.exec('RESET ROLE'); }
    expect((await db.query('SELECT * FROM platform_assistant_permissions')).rows).toHaveLength(0);
  });

  it('reports a missing migration as unavailable instead of accepting a local setting', async () => {
    await db.exec('ALTER TABLE platform_assistant_permissions RENAME TO temporarily_missing_permissions');
    try {
      await expect(store.read(a)).rejects.toMatchObject({ status: 503, code: 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE' });
      await expect(store.save(a, 0, enabled)).rejects.toMatchObject({ status: 503, code: 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE' });
    } finally { await db.exec('ALTER TABLE temporarily_missing_permissions RENAME TO platform_assistant_permissions'); }
  });

  it.skipIf(!port)('allows only one real connection to update a shared revision', async () => {
    await store.save(a, 0, enabled);
    const control = await client(`permission_cas_control_${suffix}`);
    const nameA = `permission_cas_a_${suffix}`, nameB = `permission_cas_b_${suffix}`;
    const first = connectionStore(await client(nameA)), second = connectionStore(await client(nameB));
    await control.query('BEGIN');
    await control.query('SELECT revision FROM platform_assistant_permissions WHERE platform_account_id=$1 FOR UPDATE', [a]);
    const outcomes = Promise.allSettled([first.save(a, 1, disabled), second.save(a, 1, enabled)]);
    try {
      await waitForLock(control, nameA);
      await waitForLock(control, nameB);
    } finally {
      await control.query('COMMIT');
      await outcomes;
    }
    const result = await outcomes;
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((result.find((item) => item.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ code: 'ASSISTANT_PERMISSION_REVISION_CONFLICT' });
    await store.save(a, 2, disabled);
    await expect(first.save(a, 2, enabled)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_REVISION_CONFLICT' });
    expect(await store.read(a)).toMatchObject({ revision: 3, permissions: disabled });
  }, 15000);

  it.skipIf(!port).each([false, true])('finishes account closure after an in-flight save without reviving settings (existing=%s)', async (existing) => {
    if (existing) await store.save(a, 0, disabled);
    const control = await client(`permission_close_control_${suffix}`);
    const saverName = `permission_saver_${suffix}`, closerName = `permission_closing_${suffix}`;
    const saver = connectionStore(await client(saverName)), closer = await client(closerName);
    const lockId = parseInt(randomUUID().replaceAll('-', '').slice(0, 7), 16);
    await control.query(`CREATE FUNCTION pause_permission_save() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('application_name') = '${saverName}' THEN
          PERFORM pg_advisory_xact_lock(${lockId});
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pause_permission_save BEFORE INSERT OR UPDATE ON platform_assistant_permissions
      FOR EACH ROW EXECUTE FUNCTION pause_permission_save()`);
    await control.query('SELECT pg_advisory_lock($1::bigint)', [lockId]);
    const pending = saver.save(a, existing ? 1 : 0, enabled);
    const saved = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
    let closure: Promise<unknown> | undefined;
    try {
      // The save already owns FOR SHARE on the account before its preference write pauses.
      await waitForLock(control, saverName, true);
      closure = closer.query("UPDATE platform_accounts SET state='closed' WHERE id=$1", [a]);
      const settledClosure = closure.then(() => null, (error: unknown) => error);
      closure = settledClosure;
      await waitForLock(control, closerName);
    } finally {
      await control.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]);
      await saved;
      await closure;
      await control.query('DROP TRIGGER pause_permission_save ON platform_assistant_permissions; DROP FUNCTION pause_permission_save()');
    }
    expect(await saved).toMatchObject({ value: { permissions: enabled } });
    expect(await closure).toBeNull();
    expect((await db.query('SELECT * FROM platform_assistant_permissions WHERE platform_account_id=$1', [a])).rows).toHaveLength(0);
    await expect(store.read(a)).rejects.toMatchObject({ status: 401 });
    await expect(store.save(a, 0, enabled)).rejects.toMatchObject({ status: 401 });
  }, 15000);
});
