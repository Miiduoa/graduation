import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const folder = process.env.C1_MIGRATION_FOLDER;
if (!folder) {
  test('full source migration requires owned isolated runner', { skip: true }, () => {});
} else {
  assert.match(folder, new RegExp(`^${realpathSync('/tmp')}/c1migration-[A-Za-z0-9]+$`, 'u'));
  assert.equal(realpathSync(folder), folder);
  assert.equal(lstatSync(folder).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(folder, 'socket')).mode & 0o777, 0o700);
  assert.equal(process.env.C1_MIGRATION_PARENT, String(process.ppid));
  assert.equal(readFileSync(join(folder, 'owner'), 'utf8').trim(), String(process.ppid));
  const { Pool } = await import('pg');
  const socket = join(folder, 'socket');
  const pool = new Pool({
    host: socket,
    port: 55432,
    user: 'campus_synthetic',
    database: 'postgres',
    ssl: false,
    max: 2,
  });
  const { createDatabase: before } = await import(
    pathToFileURL(join(folder, 'before/database.mjs')).href
  );
  const { createDatabase: candidate } = await import(
    pathToFileURL(join(folder, 'candidate/database.mjs')).href
  );
  const { createDatabase: rollback } = await import(
    pathToFileURL(join(folder, 'rollback/database.mjs')).href
  );
  const config = {
    kind: 'postgres',
    url: `postgresql://campus_synthetic@${encodeURIComponent(socket)}:55432/postgres`,
    pool: { ssl: false },
    applicationName: 'isolated-migration-test',
    tlsMode: 'disable',
  };
  const options = (schemaMode) => ({
    runtimeConfig: config,
    schemaMode,
    seedDemo: false,
    attendanceCodeSecret: 'synthetic-only',
  });
  const id = '999_public_agent_isolated_test_only';
  const readMigrations = async () =>
    (await pool.query('SELECT id,checksum FROM schema_migrations ORDER BY id')).rows;
  const open = async (fn, mode) => {
    const db = await fn(options(mode));
    await db.close();
  };
  try {
    await test('actual pinned runner applies full old manifest and preserves account', async () => {
      await open(before, 'apply');
      const rows = await readMigrations();
      assert.ok(rows.length > 200);
      assert.ok(rows.some((row) => row.id === '279_personal_import_sync'));
      await pool.query('INSERT INTO platform_accounts(id,state,display_name) VALUES ($1,$2,$3)', [
        `pa_${randomUUID()}`,
        'active',
        '合成帳號',
      ]);
      await open(before, 'verify');
    });
    const baseline = await readMigrations();
    await test('existing colliding table causes fail-closed without data or manifest loss', async () => {
      await pool.query('CREATE TABLE platform_public_agent_confirmations (sentinel text NOT NULL)');
      await pool.query("INSERT INTO platform_public_agent_confirmations VALUES ('preserve')");
      await assert.rejects(open(candidate, 'apply'), /already exists/u);
      assert.equal(
        (await pool.query('SELECT sentinel FROM platform_public_agent_confirmations')).rows[0]
          .sentinel,
        'preserve',
      );
      assert.deepEqual(await readMigrations(), baseline);
      await pool.query('DROP TABLE platform_public_agent_confirmations');
    });
    await test('existing manifest checksum drift stops candidate without changes', async () => {
      const record = baseline.find((row) => row.id === '279_personal_import_sync');
      assert.ok(record);
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE id=$2', [
        'synthetic-drift',
        record.id,
      ]);
      await assert.rejects(open(candidate, 'apply'), /changed after it was applied/u);
      assert.equal(
        (await pool.query("SELECT to_regclass('public.platform_public_agent_operations') AS name"))
          .rows[0].name,
        null,
      );
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE id=$2', [
        record.checksum,
        record.id,
      ]);
      assert.deepEqual(await readMigrations(), baseline);
    });
    await test('DDL and manifest registration roll back together when insertion fails', async () => {
      await pool.query(
        `CREATE FUNCTION fail_agent_manifest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${id}' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        'CREATE TRIGGER fail_agent_manifest BEFORE INSERT ON schema_migrations FOR EACH ROW EXECUTE FUNCTION fail_agent_manifest()',
      );
      await assert.rejects(open(candidate, 'apply'), /synthetic failure/u);
      assert.equal(
        (await pool.query("SELECT to_regclass('public.platform_public_agent_operations') AS name"))
          .rows[0].name,
        null,
      );
      assert.deepEqual(await readMigrations(), baseline);
      await pool.query('DROP TRIGGER fail_agent_manifest ON schema_migrations');
      await pool.query('DROP FUNCTION fail_agent_manifest()');
    });
    await test('candidate applies additively, retains old checksums and existing data', async () => {
      await open(candidate, 'apply');
      const rows = await readMigrations();
      assert.deepEqual(
        rows.filter((row) => row.id !== id),
        baseline,
      );
      const sql = readFileSync(join(folder, 'candidate/migrations', `${id}.sql`), 'utf8');
      assert.equal(
        rows.find((row) => row.id === id)?.checksum,
        createHash('sha256').update(sql).digest('hex'),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM platform_accounts WHERE display_name='合成帳號'",
          )
        ).rows[0].count,
        1,
      );
      await open(candidate, 'verify');
    });
    await test('old rollback source rejects extra migration; compatible manifest accepts identical bytes', async () => {
      await assert.rejects(open(before, 'verify'), /unexpected migration/u);
      await open(rollback, 'verify');
      const path = join(folder, 'rollback/migrations', `${id}.sql`),
        original = readFileSync(path, 'utf8');
      writeFileSync(path, `${original}\n-- changed test bytes\n`);
      await assert.rejects(open(rollback, 'verify'), /checksum drift/u);
      writeFileSync(path, original);
      await open(rollback, 'verify');
    });
    await test('row locks need update privilege on each platform table: synthetic role only', async () => {
      await pool.query('CREATE ROLE c1_runtime NOLOGIN');
      await pool.query('GRANT USAGE ON SCHEMA public TO c1_runtime');
      const tables = [
        ['platform_accounts', 'state'],
        ['platform_account_credentials', 'state'],
        ['platform_account_sessions', 'expires_at'],
        ['platform_operator_assignments', 'state'],
      ];
      const client = await pool.connect();
      try {
        for (const [table, column] of tables) {
          await pool.query(`GRANT SELECT ON ${table} TO c1_runtime`);
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE c1_runtime');
          await assert.rejects(
            client.query(`SELECT * FROM ${table} FOR SHARE`),
            (e) => e.code === '42501',
          );
          await client.query('ROLLBACK');
          await pool.query(`GRANT UPDATE(${column}) ON ${table} TO c1_runtime`);
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE c1_runtime');
          await client.query(`SELECT * FROM ${table} FOR SHARE`);
          await client.query('ROLLBACK');
        }
      } finally {
        client.release();
      }
    });
  } finally {
    await pool.end();
  }
}
