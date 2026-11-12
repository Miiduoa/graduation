import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import {
  applyAccountDemoSeed,
  buildAccountDemoStatements,
  loadFixtureModule,
  parseArguments,
  renderAccountDemoSql,
  validateSeedIdentity,
} from './seed-account-demo.mjs';

const require = createRequire(import.meta.url);
// PGlite is pinned by this repository's firebase-tools dependency; works with pnpm isolation too.
let PGlite;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
} catch {
  ({ PGlite } = createRequire(require.resolve('firebase-tools/package.json'))(
    '@electric-sql/pglite',
  ));
}
const accountId = 'pa_00000000-0000-4000-8000-000000000001';
const otherAccountId = 'pa_00000000-0000-4000-8000-000000000002';
const originalWorkspace = 'cw_00000000-0000-4000-8000-000000000003';
const email = 'student@example.test';
const now = new Date('2026-11-12T03:00:00.000Z');
let shared, db;
const create = (patch = {}) =>
  shared.createAccountDemoFixtures({
    accountId,
    schoolId: 'pu',
    displayName: '展示學生',
    schoolName: '靜宜大學',
    now,
    ...patch,
  });
const apply = (fixtures = create(), selectedEmail = email) =>
  applyAccountDemoSeed(db, fixtures, selectedEmail, shared);
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const counts = async () =>
  (
    await rows(`SELECT
  (SELECT count(*)::int FROM platform_accounts) AS accounts,
  (SELECT count(*)::int FROM platform_account_credentials) AS credentials,
  (SELECT count(*)::int FROM class_workspaces) AS workspaces,
  (SELECT count(*)::int FROM class_workspace_materials) AS materials,
  (SELECT count(*)::int FROM class_workspace_assignments) AS assignments,
  (SELECT count(*)::int FROM class_workspace_quizzes) AS quizzes,
  (SELECT count(*)::int FROM nuni_account_demos) AS demos,
  (SELECT count(*)::int FROM personal_import_ledgers) AS ledgers`)
  )[0];

before(
  async () => {
    shared = await loadFixtureModule();
    db = new PGlite();
    await db.exec(
      await readFile(new URL('./account-demo-test-schema.sql', import.meta.url), 'utf8'),
    );
    await db.exec(await readFile(new URL('./account-demo-schema.sql', import.meta.url), 'utf8'));
  },
  { timeout: 60_000 },
);
beforeEach(async () => {
  await db.exec('TRUNCATE platform_accounts CASCADE');
  await db.query(
    `INSERT INTO platform_accounts (id,display_name,primary_email) VALUES
    ($1,'原有帳號',$2),($3,'其他帳號','other@example.test')`,
    [accountId, email, otherAccountId],
  );
  await db.query(
    `INSERT INTO platform_account_credentials
    (id,platform_account_id,method,provider_issuer,provider_subject,email_at_registration,email_verified)
    VALUES ('credential-student',$1,'google','https://accounts.google.com','subject-one',$2,true),
      ('credential-other',$3,'google','https://accounts.google.com','subject-two','other@example.test',true)`,
    [accountId, email, otherAccountId],
  );
  await db.query(
    `INSERT INTO class_workspaces (id,owner_platform_account_id,title) VALUES ($1,$2,'已存在的真實課班')`,
    [originalWorkspace, accountId],
  );
  await db.query(
    `INSERT INTO class_workspace_members (workspace_id,platform_account_id,role) VALUES ($1,$2,'owner-teacher')`,
    [originalWorkspace, accountId],
  );
});
after(async () => {
  await db?.close();
});

test('fixtures use Taipei dates, current academic terms and account-scoped stable identities', () => {
  const first = create();
  assert.equal(first.records.filter((row) => row.kind === 'timetable').length, 5);
  assert.equal(first.records.filter((row) => row.kind === 'events').length, 3);
  assert.equal(first.records.filter((row) => row.kind === 'grades').length, 3);
  assert.equal(first.courses.filter((course) => course.memberRole === 'student').length, 2);
  assert.equal(first.courses[2].ownerAccountId, accountId);
  assert.equal(first.records[0].academicYear, '115');
  assert.equal(first.records[0].semester, '1');
  assert.equal(first.expiresAt, '2026-12-12T03:00:00.000Z');
  assert(Object.values(first.permissions).every((value) => value === true));
  assert(Object.values(first.state).every((value) => value === false));
  assert(
    first.records.every(
      (row) => row.batchId.startsWith(first.seedTag) && row.source.name.includes('合成'),
    ),
  );
  const later = create({ now: new Date('2026-11-12T16:01:00.000Z') });
  assert.equal(later.records.find((row) => row.kind === 'events').date, '2026-11-14');
  assert.deepEqual(
    first.records.map((row) => row.id),
    later.records.map((row) => row.id),
  );
  const another = create({ accountId: otherAccountId });
  assert.notEqual(first.fixtureOwner.id, another.fixtureOwner.id);
  assert.notEqual(first.courses[0].id, another.courses[0].id);
  assert.notEqual(first.profile.studentId, another.profile.studentId);
  assert.equal(create({ now: new Date('2027-01-01T00:00:00Z') }).records[0].academicYear, '115');
  assert.equal(create({ now: new Date('2027-02-01T00:00:00Z') }).records[0].semester, '2');
});

test('offline inputs reject ambiguous identity, unsafe mode combinations and missing arguments', () => {
  assert.throws(() => validateSeedIdentity({ accountId: 'dev-universal-student', email }));
  assert.throws(() => validateSeedIdentity({ accountId, email: ' student@example.test' }));
  assert.throws(() => parseArguments(['--apply', '--dry-run']));
  assert.throws(() => parseArguments(['--school-id']));
  assert.throws(() => parseArguments(['--email', email, '--email', email]));
  assert.throws(() => parseArguments(['--password', 'anything']));
  assert.throws(() => create({ schoolId: 'personal' }));
  assert.throws(() => create({ now: new Date('invalid') }));
});

test('merging preserves edited demo rows and naturally identical existing imports', () => {
  const fixtures = create();
  const original = fixtures.records[0];
  const edited = { ...original, title: '我修改的課名', location: '新的教室' };
  const equivalent = { ...fixtures.records[1], id: 'my-own-import', batchId: 'my-personal-batch' };
  const merged = shared.mergeAccountDemoRecords([edited, equivalent], fixtures.records, 'pu');
  assert.equal(merged.records.length, 11);
  assert.equal(merged.added, 9);
  assert.deepEqual(merged.records.slice(0, 2), [edited, equivalent]);
  assert.equal(shared.mergeAccountDemoRecords(merged.records, fixtures.records, 'pu').added, 0);
  assert.throws(() =>
    shared.mergeAccountDemoRecords([{ ...original, schoolId: 'other' }], fixtures.records, 'pu'),
  );
});

test('real SQL creates three private courses, pending student work and no extra login credentials', async () => {
  const fixtures = create();
  const result = await apply(fixtures);
  assert.equal(result.addedPersonalRecords, 11);
  assert.deepEqual(result.ledger, { revision: 1, records: 11 });
  assert.deepEqual(await counts(), {
    accounts: 3,
    credentials: 2,
    workspaces: 4,
    materials: 6,
    assignments: 6,
    quizzes: 3,
    demos: 1,
    ledgers: 1,
  });
  assert.deepEqual(
    await rows(`SELECT title FROM class_workspaces WHERE id=$1`, [originalWorkspace]),
    [{ title: '已存在的真實課班' }],
  );
  assert.deepEqual(
    await rows(`SELECT display_name,primary_email FROM platform_accounts WHERE id=$1`, [accountId]),
    [{ display_name: '原有帳號', primary_email: email }],
  );
  assert.equal(
    (
      await rows(
        `SELECT count(*)::int AS count FROM class_workspace_members WHERE platform_account_id=$1 AND role='student'`,
        [accountId],
      )
    )[0].count,
    2,
  );
  assert.equal(
    (
      await rows(
        `SELECT count(*)::int AS count FROM platform_account_credentials WHERE platform_account_id=$1`,
        [fixtures.fixtureOwner.id],
      )
    )[0].count,
    0,
  );
  assert.equal(
    (await rows('SELECT count(*)::int AS count FROM class_workspace_affiliations'))[0].count,
    0,
  );
});

test('reruns preserve edited titles, closed work, new personal rows and disabled feature permissions', async () => {
  const fixtures = create();
  await apply(fixtures);
  await db.query(`UPDATE class_workspaces SET title='我自己的展示課名' WHERE id=$1`, [
    fixtures.courses[0].id,
  ]);
  await db.query(
    `UPDATE class_workspace_assignments SET state='closed',closed_at=now() WHERE id=$1`,
    [fixtures.courses[0].assignments[0].id],
  );
  await db.query(
    `UPDATE nuni_account_demos SET permissions=jsonb_set(permissions,'{food}','false'::jsonb),
    state=jsonb_set(state,'{checkIn}','true'::jsonb) WHERE account_id=$1`,
    [accountId],
  );
  const saved = (
    await rows('SELECT records FROM personal_import_ledgers WHERE platform_account_id=$1', [
      accountId,
    ])
  )[0].records;
  saved[0].location = '我更改的教室';
  saved.push({
    ...saved.find((row) => row.kind === 'events'),
    id: 'my-event',
    batchId: 'my-batch',
    title: '我自行新增的行程',
  });
  await db.query(
    `UPDATE personal_import_ledgers SET records=$2::jsonb,revision=2 WHERE platform_account_id=$1`,
    [accountId, JSON.stringify(saved)],
  );
  const result = await apply(create({ now: new Date('2026-11-19T03:00:00Z') }));
  assert.deepEqual(result, { addedPersonalRecords: 0, ledger: { revision: 2, records: 12 } });
  assert.deepEqual(
    (
      await rows('SELECT records FROM personal_import_ledgers WHERE platform_account_id=$1', [
        accountId,
      ])
    )[0].records,
    saved,
  );
  assert.equal(
    (await rows('SELECT title FROM class_workspaces WHERE id=$1', [fixtures.courses[0].id]))[0]
      .title,
    '我自己的展示課名',
  );
  assert.equal(
    (
      await rows('SELECT state FROM class_workspace_assignments WHERE id=$1', [
        fixtures.courses[0].assignments[0].id,
      ])
    )[0].state,
    'closed',
  );
  const demo = (
    await rows('SELECT permissions,state FROM nuni_account_demos WHERE account_id=$1', [accountId])
  )[0];
  assert.equal(demo.permissions.food, false);
  assert.equal(demo.state.checkIn, true);
});

test('wrong email or an unverified Google credential rolls back all work', async () => {
  const before = await counts();
  await assert.rejects(apply(create(), 'other@example.test'), /VERIFIED_ACCOUNT_MISMATCH/);
  assert.deepEqual(await counts(), before);
  await db.query(
    `UPDATE platform_account_credentials SET email_verified=false WHERE platform_account_id=$1`,
    [accountId],
  );
  await assert.rejects(apply(), /VERIFIED_ACCOUNT_MISMATCH/);
  assert.deepEqual(await counts(), before);
});

test('a colliding workspace owned by someone else cannot be adopted', async () => {
  const fixtures = create();
  await db.query(
    'INSERT INTO class_workspaces(id,owner_platform_account_id,title) VALUES ($1,$2,$3)',
    [fixtures.courses[0].id, otherAccountId, '別人的課程'],
  );
  const before = await counts();
  await assert.rejects(apply(fixtures), /WORKSPACE_COLLISION/);
  assert.deepEqual(await counts(), before);
});

test('a late material collision rolls back earlier inserted demo account and courses', async () => {
  const fixtures = create();
  await db.query(
    'INSERT INTO class_workspace_materials(id,workspace_id,title,body,created_by_platform_account_id) VALUES ($1,$2,$3,$4,$5)',
    [fixtures.courses[2].materials[1].id, originalWorkspace, '既有教材', '保留原有內容', accountId],
  );
  const before = await counts();
  await assert.rejects(apply(fixtures), /MATERIAL_COLLISION/);
  assert.deepEqual(await counts(), before);
  assert.equal((await rows('SELECT body FROM class_workspace_materials'))[0].body, '保留原有內容');
});

test('malformed preexisting ledger is not replaced by the seed', async () => {
  await db.query(
    'INSERT INTO personal_import_ledgers(platform_account_id,school_id,revision,records) VALUES ($1,$2,1,$3)',
    [accountId, 'pu', JSON.stringify([{ title: '請保留這筆無法讀取的原資料' }])],
  );
  const before = await counts();
  await assert.rejects(apply());
  assert.deepEqual(await counts(), before);
  assert.deepEqual((await rows('SELECT records FROM personal_import_ledgers'))[0].records, [
    { title: '請保留這筆無法讀取的原資料' },
  ]);
});

test('rendered review SQL quotes input safely and executes the same guarded plan', async () => {
  const displayName = "展示 O'Brien'); DROP TABLE class_workspaces; --";
  const fixtures = create({ displayName });
  const ledger = { revision: 0, records: [] };
  const merged = shared.mergeAccountDemoRecords([], fixtures.records, 'pu');
  const sql = renderAccountDemoSql(buildAccountDemoStatements(fixtures, email, ledger, merged));
  await db.exec(sql);
  assert.equal(
    (await rows('SELECT profile FROM nuni_account_demos'))[0].profile.displayName,
    displayName,
  );
  assert.equal((await counts()).workspaces, 4);
  await db.query(`UPDATE personal_import_ledgers SET revision=2 WHERE platform_account_id=$1`, [
    accountId,
  ]);
  await assert.rejects(db.exec(sql), /LEDGER_CHANGED_REBUILD_PLAN/);
  await db.query('ROLLBACK');
  assert.equal((await rows('SELECT revision FROM personal_import_ledgers'))[0].revision, 2);
});

test('two separately authorized accounts get distinct fixture owners and class memberships', async () => {
  await apply();
  const other = create({ accountId: otherAccountId });
  await apply(other, 'other@example.test');
  assert.equal((await counts()).workspaces, 7);
  const myCourses = new Set(create().courses.map((course) => course.id));
  const wrongMemberships = (
    await rows('SELECT workspace_id FROM class_workspace_members WHERE platform_account_id=$1', [
      otherAccountId,
    ])
  ).filter((row) => myCourses.has(row.workspace_id));
  assert.equal(wrongMemberships.length, 0);
  assert.equal((await counts()).credentials, 2);
});
