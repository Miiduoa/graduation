// @vitest-environment node
// Uses PostgreSQL bundled with the existing, lockfile-pinned Firebase test toolchain.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createAccountDemoStore } from './accountDemoStore';
import {
  createAccountDemoPermissions,
  createAccountDemoState,
} from '@campus/shared/src/accountDemo';

type TestDatabase = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};
const rootRequire = createRequire(import.meta.url);
const firebaseToolsRequire = createRequire(rootRequire.resolve('firebase-tools/package.json'));
const { PGlite } = firebaseToolsRequire('@electric-sql/pglite') as {
  PGlite: new () => TestDatabase;
};
const schema = readFileSync(
  new URL('../../../../../scripts/demo/account-demo-schema.sql', import.meta.url),
  'utf8',
);

it('runs the committed schema and store SQL against isolated PostgreSQL, including RLS and atomic compare-and-swap', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE platform_accounts(id text PRIMARY KEY,state text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO platform_accounts (id,state) VALUES ('pa_11111111-1111-4111-8111-111111111111','active'),
      ('pa_22222222-2222-4222-8222-222222222222','active');`);
    await db.exec(schema);
    // Rehearse the upgrade from the initially shipped restrictive foreign key.
    await db.exec(`ALTER TABLE nuni_account_demos DROP CONSTRAINT nuni_account_demos_account_id_fkey;
      ALTER TABLE nuni_account_demos ADD CONSTRAINT nuni_account_demos_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES platform_accounts(id);`);
    await db.exec(schema);
    const id = 'pa_11111111-1111-4111-8111-111111111111';
    const other = 'pa_22222222-2222-4222-8222-222222222222';
    const profile = {
      displayName: '示範同學',
      schoolId: 'pu',
      schoolName: '靜宜大學',
      studentId: 'DEMO1140001',
      department: '資訊管理學系',
    };
    await db.query(
      `INSERT INTO nuni_account_demos (account_id,enabled,expires_at,profile,permissions,state,seed_tag)
      VALUES ($1,true,now()+interval '30 days',$2,$3,$4,'isolated-test')`,
      [
        id,
        JSON.stringify(profile),
        JSON.stringify(createAccountDemoPermissions(true)),
        JSON.stringify(createAccountDemoState()),
      ],
    );
    await db.exec(`CREATE ROLE nuni_web_files NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT SELECT ON platform_accounts TO nuni_web_files;
      GRANT ALL PRIVILEGES ON nuni_account_demos TO nuni_web_files;
      GRANT UPDATE (enabled, expires_at, profile, account_id) ON nuni_account_demos TO nuni_web_files;
      SET ROLE nuni_web_files;`);
    // Reproduce both original production blockers using the real runtime role.
    expect((await db.query(`SELECT * FROM nuni_account_demos`)).rows).toEqual([]);
    await expect(
      db.query(`SELECT id FROM platform_accounts WHERE id=$1 FOR SHARE`, [id]),
    ).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
    await db.exec(schema);
    await db.exec(schema);
    await db.exec('SET ROLE nuni_web_files');
    const role = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`,
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const store = createAccountDemoStore(
      async (text, params) => (await db.query(text, params)).rows as Record<string, unknown>[],
    );
    for (const denied of [
      `UPDATE nuni_account_demos SET enabled=false WHERE account_id=$1`,
      `UPDATE nuni_account_demos SET expires_at=now()+interval '1 year' WHERE account_id=$1`,
      `UPDATE nuni_account_demos SET profile='{}'::jsonb WHERE account_id=$1`,
      `UPDATE nuni_account_demos SET account_id=account_id WHERE account_id=$1`,
      `DELETE FROM nuni_account_demos WHERE account_id=$1`,
      `UPDATE platform_accounts SET state='suspended' WHERE id=$1`,
      `INSERT INTO nuni_account_demos (account_id,enabled,expires_at,profile,permissions,state,seed_tag)
       VALUES ($1,true,now()+interval '1 day','{}','{}','{}','forbidden')`,
    ])
      await expect(db.query(denied, [id])).rejects.toThrow(/permission denied/);
    expect((await store.read(id))?.profile.studentId).toBe('DEMO1140001');
    expect(await store.read(other)).toBeNull();
    const saved = await store.mutate(id, { expectedRevision: 0, action: 'checkIn' });
    expect(saved.revision).toBe(1);
    expect(saved.state.checkIn).toBe(true);
    await expect(store.mutate(id, { expectedRevision: 0, action: 'requestLeave' })).rejects.toThrow(
      'DEMO_REVISION_CHANGED',
    );
    const competing = await Promise.allSettled([
      store.mutate(id, { expectedRevision: 1, action: 'requestLeave' }),
      store.mutate(id, { expectedRevision: 1, action: 'submitAssignment' }),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await store.read(id))?.revision).toBe(2);
    await store.mutate(id, {
      expectedRevision: 2,
      permissions: createAccountDemoPermissions(false),
    });
    await expect(store.mutate(id, { expectedRevision: 3, action: 'createOrder' })).rejects.toThrow(
      'DEMO_FEATURE_DISABLED',
    );
    await db.exec('RESET ROLE');
    await db.query(`UPDATE nuni_account_demos SET enabled=false WHERE account_id=$1`, [id]);
    await db.exec('SET ROLE nuni_web_files');
    expect(await store.read(id)).toBeNull();
    await db.exec('RESET ROLE');
    await db.query(
      `UPDATE nuni_account_demos SET enabled=true,expires_at=now()-interval '1 second' WHERE account_id=$1`,
      [id],
    );
    await db.exec('SET ROLE nuni_web_files');
    expect(await store.read(id)).toBeNull();
    await db.exec('RESET ROLE');
    await db.query(
      `UPDATE nuni_account_demos SET expires_at=now()+interval '1 day' WHERE account_id=$1`,
      [id],
    );
    await db.query(`UPDATE platform_accounts SET state='suspended' WHERE id=$1`, [id]);
    await db.exec('SET ROLE nuni_web_files');
    expect(await store.read(id)).toBeNull();
    await expect(store.mutate(id, { expectedRevision: 3, action: 'reset' })).rejects.toThrow(
      'ACCOUNT_DEMO_UNAVAILABLE',
    );
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname='nuni_account_demos'`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    await db.exec(`RESET ROLE; CREATE ROLE demo_reader; SET ROLE demo_reader;`);
    await expect(db.query(`SELECT * FROM nuni_account_demos`)).rejects.toThrow(/permission denied/);
    await db.exec(
      `RESET ROLE; GRANT SELECT ON nuni_account_demos TO demo_reader; SET ROLE demo_reader;`,
    );
    expect((await db.query(`SELECT * FROM nuni_account_demos`)).rows).toEqual([]);
    await db.exec('RESET ROLE');
    await db.query(`DELETE FROM platform_accounts WHERE id=$1`, [id]);
    expect(
      (await db.query(`SELECT * FROM nuni_account_demos WHERE account_id=$1`, [id])).rows,
    ).toEqual([]);
  } finally {
    await db.close();
  }
}, 60_000);
