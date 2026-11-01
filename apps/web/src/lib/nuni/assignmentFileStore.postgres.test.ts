// @vitest-environment node
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSqlIndexStore, type FileRecord } from './assignmentFileStore';

type Client = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};
// 指定隔離測試 PostgreSQL 的本機連接埠即可啟用，無須任何產品連線設定。
const port = process.env.NUNI_TEST_POSTGRES_PORT;
const clients: Client[] = [];
const schema = `attachment_race_${process.pid}`;
const older = '2026-10-21T11:00:01.000Z';
const newer = '2026-10-21T11:00:02.000Z';
const file: FileRecord = {
  id: 'shared-file', workspaceId: 'workspace', assignmentId: 'assignment',
  platformAccountId: 'student', originalName: 'photo.jpg', contentType: 'image/jpeg',
  byteSize: 64, sha256: '', kind: 'image', storageKey: 'photo',
  createdAt: older, uploadedAt: older, submittedAt: null, supersededAt: null, late: false,
};

async function client(name: string) {
  const { Client: PgClient } = createRequire(import.meta.url)('pg') as {
    Client: new (config: Record<string, unknown>) => Client;
  };
  const connection = new PgClient({ host: '127.0.0.1', port: Number(port),
    user: 'box', database: 'postgres', application_name: name });
  await connection.connect();
  clients.push(connection);
  await connection.query(`SET search_path TO ${schema}`);
  return connection;
}

beforeAll(async () => {
  if (!port) return;
  const setup = await client('attachment-setup');
  await setup.query(`CREATE SCHEMA ${schema}`);
  // 隔離測試結構，不讀取連線設定，也不執行產品 migration。
  await setup.query(`CREATE TABLE class_assignment_file_idempotency (
    actor_id text, key text, request_hash text NOT NULL, payload jsonb NOT NULL,
    PRIMARY KEY (actor_id, key));
    CREATE TABLE class_assignment_submission_files (
    id text PRIMARY KEY, workspace_id text, assignment_id text, platform_account_id text,
    original_name text, content_type text, byte_size integer, sha256 text, kind text,
    storage_key text, created_at timestamptz, uploaded_at timestamptz,
    submitted_at timestamptz, superseded_at timestamptz, late boolean);
    CREATE FUNCTION pause_older() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('application_name') IN ('attachment-older', 'attachment-file-older') THEN
        PERFORM pg_advisory_xact_lock(34808);
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER pause_older BEFORE INSERT ON class_assignment_file_idempotency
    FOR EACH ROW WHEN (current_setting('application_name') = 'attachment-older') EXECUTE FUNCTION pause_older();
    CREATE TRIGGER pause_file BEFORE INSERT ON class_assignment_submission_files
    FOR EACH ROW WHEN (current_setting('application_name') = 'attachment-file-older')
    EXECUTE FUNCTION pause_older()`);
});

afterAll(async () => {
  if (clients[0]) await clients[0].query(`DROP SCHEMA ${schema} CASCADE`);
  await Promise.all(clients.map(connection => connection.end()));
});

it.skipIf(!port).each([
  [false, false], [false, true], [true, false], [true, true],
])('keeps newer files when an older statement resumes: existing=%s rollback=%s', async (existing, rollback) => {
  const control = await client('attachment-control');
  const a = await client('attachment-older');
  const b = await client('attachment-newer');
  const store = (connection: Client) => createSqlIndexStore(async (sql, params) =>
    (await connection.query(sql, params)).rows);
  const first = store(a);
  const second = store(b);
  await control.query('TRUNCATE class_assignment_file_idempotency, class_assignment_submission_files');
  await second.putFile(file);
  if (existing) await second.advanceVersion(file.assignmentId, file.platformAccountId, older);
  await control.query('SELECT pg_advisory_lock(34808)');
  // A 已取得敘述快照，在首次版本列 INSERT 前停住；B 必須能完成。
  const pending = first.putFile(rollback ? file : { ...file, submittedAt: older }, older);
  const outcome = pending.then(() => null, (error: unknown) => error);
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await control.query(`SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'attachment-older' AND wait_event = 'advisory'`);
      if (result.rows.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await second.advanceVersion(file.assignmentId, file.platformAccountId, newer);
    await second.putFile({ ...file, submittedAt: newer }, newer);
  } finally {
    await control.query('SELECT pg_advisory_unlock(34808)');
  }
  expect(await outcome).toMatchObject({ code: 'ASSIGNMENT_SUBMISSION_SUPERSEDED' });
  expect(await second.currentVersion(file.assignmentId, file.platformAccountId)).toBe(newer);
  expect((await second.getFile(file.id))?.submittedAt).toBe(newer);
  expect(await second.listVisible(file.assignmentId, file.platformAccountId)).toHaveLength(1);
}, 10000);

it.skipIf(!port)('does not promote a placeholder to a successful submission', async () => {
  const connection = await client('attachment-placeholder');
  const index = createSqlIndexStore(async (sql, params) => (await connection.query(sql, params)).rows);
  await connection.query('TRUNCATE class_assignment_file_idempotency, class_assignment_submission_files');
  await index.putFile(file, older);
  expect(await index.currentVersion(file.assignmentId, file.platformAccountId)).toBeNull();
  await index.advanceVersion(file.assignmentId, file.platformAccountId, newer);
  await index.advanceVersion(file.assignmentId, file.platformAccountId, older);
  expect(await index.currentVersion(file.assignmentId, file.platformAccountId)).toBe(newer);
});

it.skipIf(!port).each([false, true])('serializes version advancement while file writing is paused: existing=%s', async existing => {
  const control = await client('attachment-file-control');
  const a = await client('attachment-file-older');
  const b = await client('attachment-file-newer');
  const first = createSqlIndexStore(async (sql, params) => (await a.query(sql, params)).rows);
  const second = createSqlIndexStore(async (sql, params) => (await b.query(sql, params)).rows);
  await control.query('TRUNCATE class_assignment_file_idempotency, class_assignment_submission_files');
  await second.putFile(file);
  if (existing) await second.advanceVersion(file.assignmentId, file.platformAccountId, older);
  await control.query('SELECT pg_advisory_lock(34808)');
  const pending = first.putFile({ ...file, submittedAt: older }, older);
  let advancing: Promise<void> | undefined;
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await control.query(`SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'attachment-file-older' AND wait_event = 'advisory'`);
      if (result.rows.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    advancing = second.advanceVersion(file.assignmentId, file.platformAccountId, newer);
    let waitingForVersion = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await control.query(`SELECT 1 FROM pg_stat_activity
        WHERE application_name = 'attachment-file-newer' AND wait_event_type = 'Lock'`);
      if (result.rows.length) { waitingForVersion = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waitingForVersion).toBe(true);
  } finally {
    await control.query('SELECT pg_advisory_unlock(34808)');
    await pending;
    await advancing;
  }
  await second.putFile({ ...file, submittedAt: newer }, newer);
  expect((await second.getFile(file.id))?.submittedAt).toBe(newer);
  expect(await second.currentVersion(file.assignmentId, file.platformAccountId)).toBe(newer);
}, 10000);
