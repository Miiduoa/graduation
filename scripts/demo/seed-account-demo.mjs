#!/usr/bin/env node
/**
 * Seed one verified Google account's private demonstration data.
 * Default: offline dry-run. Credentials and target identity are runtime inputs.
 *
 * node scripts/demo/seed-account-demo.mjs --account-id pa_UUID --email USER_EMAIL \
 *   --display-name NAME --school-id pu --school-name 靜宜大學 --sql-file /tmp/account-demo.sql
 *
 * With --apply, ACCOUNT_DEMO_DATABASE_URL is required. Existing rows and permissions
 * are preserved. This never creates a login credential or an official school identity.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import process from 'node:process';
import console from 'node:console';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ACCOUNT_ID = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function loadFixtureModule() {
  const { build } = await import('esbuild');
  const directory = await mkdtemp(join(tmpdir(), 'nuni-account-demo-'));
  const filename = join(directory, 'fixtures.cjs');
  try {
    await build({
      entryPoints: [join(REPO, 'packages/shared/src/accountDemoFixtures.ts')],
      outfile: filename,
      platform: 'node',
      format: 'cjs',
      bundle: true,
      logLevel: 'silent',
    });
    const result = await import(pathToFileURL(filename).href);
    return result.default;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function validateSeedIdentity({ accountId, email }) {
  if (
    !ACCOUNT_ID.test(accountId ?? '') ||
    typeof email !== 'string' ||
    email !== email.trim() ||
    email.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
      email,
    )
  ) {
    throw new Error('必須提供確切的 platform account ID 與已驗證 Google 信箱。');
  }
  return { accountId, email: email.toLowerCase() };
}

function statement(label, sql, parameters = []) {
  return { label, sql, parameters };
}
function assertion(label, condition, parameters, error) {
  return statement(
    label,
    `SELECT (CASE WHEN ${condition} THEN 'true' ELSE '${error}' END)::boolean AS verified`,
    parameters,
  );
}

/** The complete SQL plan includes identity/scope guards, row locks and a ledger CAS. */
export function buildAccountDemoStatements(fixtures, emailInput, ledger, merged) {
  const { accountId, schoolId, seedTag, fixtureOwner, courses } = fixtures;
  const { email } = validateSeedIdentity({ accountId, email: emailInput });
  if (
    !Number.isSafeInteger(ledger.revision) ||
    ledger.revision < 0 ||
    (ledger.revision === 0 && ledger.records.length) ||
    !Array.isArray(merged.records)
  ) {
    throw new Error('現有個人資料快照無效。');
  }
  const result = [
    statement('鎖定目標帳號', `SELECT id FROM platform_accounts WHERE id=$1 FOR UPDATE`, [
      accountId,
    ]),
    statement(
      '鎖定已驗證 Google 登入',
      `SELECT id FROM platform_account_credentials
      WHERE platform_account_id=$1 AND method='google' AND state='active'
        AND email_verified=true AND lower(email_at_registration)=$2 FOR SHARE`,
      [accountId, email],
    ),
    assertion(
      '驗證帳號與已驗證信箱',
      `EXISTS (SELECT 1 FROM platform_accounts a
      WHERE a.id=$1 AND a.state='active' AND lower(a.primary_email)=$2
        AND EXISTS (SELECT 1 FROM platform_account_credentials c WHERE c.platform_account_id=a.id
          AND c.method='google' AND c.state='active' AND c.email_verified=true
          AND c.provider_issuer='https://accounts.google.com' AND lower(c.email_at_registration)=$2))`,
      [accountId, email],
      'ACCOUNT_DEMO_VERIFIED_ACCOUNT_MISMATCH',
    ),
    assertion(
      '拒絕覆蓋其他展示配置',
      `NOT EXISTS (SELECT 1 FROM nuni_account_demos
      WHERE account_id=$1 AND (seed_tag<>$2 OR profile->>'schoolId' IS DISTINCT FROM $3))`,
      [accountId, seedTag, schoolId],
      'ACCOUNT_DEMO_SCOPE_COLLISION',
    ),
    assertion(
      '授課 fixture 不得有登入憑證',
      `NOT EXISTS (SELECT 1 FROM platform_accounts WHERE id=$1)
      OR (EXISTS (SELECT 1 FROM nuni_account_demos WHERE account_id=$2 AND seed_tag=$3
        AND profile->>'schoolId'=$4)
        AND EXISTS (SELECT 1 FROM platform_accounts WHERE id=$1 AND display_name=$5 AND primary_email IS NULL)
        AND NOT EXISTS (SELECT 1 FROM platform_account_credentials WHERE platform_account_id=$1))`,
      [fixtureOwner.id, accountId, seedTag, schoolId, fixtureOwner.displayName],
      'ACCOUNT_DEMO_FIXTURE_OWNER_COLLISION',
    ),
    statement('鎖定本帳號的個人匯入', `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `personal-import:${accountId}`,
    ]),
    statement(
      '鎖定既有個人資料',
      `SELECT revision FROM personal_import_ledgers
      WHERE platform_account_id=$1 AND school_id=$2 FOR UPDATE`,
      [accountId, schoolId],
    ),
    assertion(
      '核對產生計畫時的個人資料版本',
      `(CASE WHEN $3::integer=0
      THEN NOT EXISTS (SELECT 1 FROM personal_import_ledgers WHERE platform_account_id=$1 AND school_id=$2)
      ELSE EXISTS (SELECT 1 FROM personal_import_ledgers WHERE platform_account_id=$1 AND school_id=$2
        AND revision=$3 AND records=$4::jsonb) END)`,
      [accountId, schoolId, ledger.revision, JSON.stringify(ledger.records)],
      'ACCOUNT_DEMO_LEDGER_CHANGED_REBUILD_PLAN',
    ),
  ];
  for (const course of courses) {
    result.push(
      assertion(
        '課班識別碼只可屬於這份展示',
        `NOT EXISTS (SELECT 1 FROM class_workspaces WHERE id=$1)
      OR (EXISTS (SELECT 1 FROM nuni_account_demos WHERE account_id=$2 AND seed_tag=$3)
        AND EXISTS (SELECT 1 FROM class_workspaces WHERE id=$1 AND owner_platform_account_id=$4)
        AND NOT EXISTS (SELECT 1 FROM class_workspace_affiliations WHERE workspace_id=$1)
        AND NOT EXISTS (SELECT 1 FROM class_workspace_members WHERE workspace_id=$1 AND state='active'
          AND platform_account_id NOT IN ($2,$4)))`,
        [course.id, accountId, seedTag, course.ownerAccountId],
        'ACCOUNT_DEMO_WORKSPACE_COLLISION',
      ),
    );
  }
  result.push(
    statement(
      '建立沒有登入憑證的展示授課者',
      `INSERT INTO platform_accounts (id,display_name)
      VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
      [fixtureOwner.id, fixtureOwner.displayName],
    ),
    statement(
      '建立本人展示配置，保留既有進度及開關',
      `INSERT INTO nuni_account_demos
      (account_id,enabled,expires_at,profile,permissions,state,revision,seed_tag)
      VALUES ($1,true,$2::timestamptz,$3::jsonb,$4::jsonb,$5::jsonb,0,$6)
      ON CONFLICT (account_id) DO NOTHING`,
      [
        accountId,
        fixtures.expiresAt,
        JSON.stringify(fixtures.profile),
        JSON.stringify(fixtures.permissions),
        JSON.stringify(fixtures.state),
        seedTag,
      ],
    ),
  );
  for (const course of courses) {
    result.push(
      statement(
        '建立私人展示課班',
        `INSERT INTO class_workspaces (id,owner_platform_account_id,title)
      VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [course.id, course.ownerAccountId, course.title],
      ),
    );
    const members = [{ accountId: course.ownerAccountId, role: 'owner-teacher' }];
    if (course.ownerAccountId !== accountId) members.push({ accountId, role: 'student' });
    for (const member of members) {
      result.push(
        assertion(
          '成員角色不可與既有資料衝突',
          `NOT EXISTS (SELECT 1 FROM class_workspace_members
        WHERE workspace_id=$1 AND platform_account_id=$2 AND role<>$3)`,
          [course.id, member.accountId, member.role],
          'ACCOUNT_DEMO_MEMBER_ROLE_COLLISION',
        ),
      );
      result.push(
        statement(
          '建立展示課班成員',
          `INSERT INTO class_workspace_members (workspace_id,platform_account_id,role)
        VALUES ($1,$2,$3) ON CONFLICT (workspace_id,platform_account_id) DO NOTHING`,
          [course.id, member.accountId, member.role],
        ),
      );
    }
    result.push(
      assertion(
        '單元識別碼不可跨課班',
        `NOT EXISTS (SELECT 1 FROM class_workspace_units
      WHERE id=$1 AND (workspace_id<>$2 OR created_by_platform_account_id<>$3))`,
        [course.unit.id, course.id, course.ownerAccountId],
        'ACCOUNT_DEMO_UNIT_COLLISION',
      ),
    );
    result.push(
      statement(
        '建立展示單元',
        `INSERT INTO class_workspace_units
      (id,workspace_id,title,position,created_by_platform_account_id)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [course.unit.id, course.id, course.unit.title, course.unit.position, course.ownerAccountId],
      ),
    );
    for (const material of course.materials) {
      result.push(
        assertion(
          '教材識別碼不可跨課班',
          `NOT EXISTS (SELECT 1 FROM class_workspace_materials
        WHERE id=$1 AND (workspace_id<>$2 OR created_by_platform_account_id<>$3))`,
          [material.id, course.id, course.ownerAccountId],
          'ACCOUNT_DEMO_MATERIAL_COLLISION',
        ),
      );
      result.push(
        statement(
          '建立展示教材',
          `INSERT INTO class_workspace_materials
        (id,workspace_id,title,body,created_by_platform_account_id,unit_id)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [
            material.id,
            course.id,
            material.title,
            material.body,
            course.ownerAccountId,
            course.unit.id,
          ],
        ),
      );
    }
    for (const assignment of course.assignments) {
      result.push(
        assertion(
          '作業識別碼不可跨課班',
          `NOT EXISTS (SELECT 1 FROM class_workspace_assignments
        WHERE id=$1 AND (workspace_id<>$2 OR created_by_platform_account_id<>$3))`,
          [assignment.id, course.id, course.ownerAccountId],
          'ACCOUNT_DEMO_ASSIGNMENT_COLLISION',
        ),
      );
      result.push(
        statement(
          '建立近期展示作業',
          `INSERT INTO class_workspace_assignments
        (id,workspace_id,title,instructions,state,created_by_platform_account_id,due_at,unit_id,version)
        VALUES ($1,$2,$3,$4,'open',$5,$6::timestamptz,$7,1) ON CONFLICT (id) DO NOTHING`,
          [
            assignment.id,
            course.id,
            assignment.title,
            assignment.instructions,
            course.ownerAccountId,
            assignment.dueAt,
            course.unit.id,
          ],
        ),
      );
    }
    result.push(
      assertion(
        '測驗識別碼不可跨課班',
        `NOT EXISTS (SELECT 1 FROM class_workspace_quizzes
      WHERE id=$1 AND (workspace_id<>$2 OR created_by_platform_account_id<>$3))`,
        [course.quiz.id, course.id, course.ownerAccountId],
        'ACCOUNT_DEMO_QUIZ_COLLISION',
      ),
    );
    result.push(
      statement(
        '建立近期展示測驗',
        `INSERT INTO class_workspace_quizzes
      (id,workspace_id,title,prompt,state,created_by_platform_account_id,due_at,unit_id,version)
      VALUES ($1,$2,$3,$4,'open',$5,$6::timestamptz,$7,1) ON CONFLICT (id) DO NOTHING`,
        [
          course.quiz.id,
          course.id,
          course.quiz.title,
          course.quiz.prompt,
          course.ownerAccountId,
          course.quiz.dueAt,
          course.unit.id,
        ],
      ),
    );
  }
  if (merged.added > 0) {
    result.push(
      statement(
        '合併個人課表、行程與成績，不覆寫既有列',
        `INSERT INTO personal_import_ledgers
      (platform_account_id,school_id,revision,records) VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT (platform_account_id,school_id) DO UPDATE SET revision=EXCLUDED.revision,
        records=EXCLUDED.records,updated_at=now()
      WHERE personal_import_ledgers.revision=$5 AND personal_import_ledgers.records=$6::jsonb`,
        [
          accountId,
          schoolId,
          ledger.revision + 1,
          JSON.stringify(merged.records),
          ledger.revision,
          JSON.stringify(ledger.records),
        ],
      ),
    );
  }
  result.push(
    assertion(
      '確認保存的個人資料完全相符',
      `EXISTS (SELECT 1 FROM personal_import_ledgers
      WHERE platform_account_id=$1 AND school_id=$2 AND records=$3::jsonb)`,
      [accountId, schoolId, JSON.stringify(merged.records)],
      'ACCOUNT_DEMO_LEDGER_READBACK_MISMATCH',
    ),
    assertion(
      '確認沒有替 fixture 建立任何登入憑證',
      `NOT EXISTS (SELECT 1 FROM platform_account_credentials WHERE platform_account_id=$1)`,
      [fixtureOwner.id],
      'ACCOUNT_DEMO_FIXTURE_MUST_NOT_HAVE_CREDENTIALS',
    ),
  );
  return result;
}

function sqlLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== 'string' || value.includes('\u0000')) throw new Error('無法輸出 SQL 參數。');
  return `'${value.replaceAll("'", "''")}'`;
}
export function renderAccountDemoSql(statements) {
  const body = statements
    .map(({ label, sql, parameters }) => {
      const rendered = sql.replace(/\$(\d+)\b/g, (_match, number) => {
        const index = Number(number) - 1;
        if (index < 0 || index >= parameters.length) throw new Error('SQL 參數數量不符。');
        return sqlLiteral(parameters[index]);
      });
      return `-- ${label}\n${rendered};`;
    })
    .join('\n\n');
  return (
    `-- Private account demo seed. Review before applying. No login credentials are created.\n` +
    `-- This plan is tied to the reviewed ledger snapshot; regenerate it if the ledger changed.\n` +
    `BEGIN ISOLATION LEVEL SERIALIZABLE;\nSET LOCAL standard_conforming_strings=on;\n` +
    `SET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\n\n${body}\n\nCOMMIT;\n`
  );
}

/** Uses the same validated plan as --sql-file, with parameters sent separately. */
export async function applyAccountDemoSeed(client, fixtures, email, shared) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(`SET LOCAL lock_timeout='5s'`);
    await client.query(`SET LOCAL statement_timeout='30s'`);
    await client.query('SELECT id FROM platform_accounts WHERE id=$1 FOR UPDATE', [
      fixtures.accountId,
    ]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `personal-import:${fixtures.accountId}`,
    ]);
    const snapshot = await client.query(
      `SELECT revision,records FROM personal_import_ledgers
      WHERE platform_account_id=$1 AND school_id=$2 FOR UPDATE`,
      [fixtures.accountId, fixtures.schoolId],
    );
    const ledger = snapshot.rows[0] ?? { revision: 0, records: [] };
    const merged = shared.mergeAccountDemoRecords(
      ledger.records,
      fixtures.records,
      fixtures.schoolId,
    );
    const statements = buildAccountDemoStatements(fixtures, email, ledger, merged);
    for (const step of statements) await client.query(step.sql, step.parameters);
    const result = await client.query(
      `SELECT revision,jsonb_array_length(records) AS records
      FROM personal_import_ledgers WHERE platform_account_id=$1 AND school_id=$2`,
      [fixtures.accountId, fixtures.schoolId],
    );
    await client.query('COMMIT');
    return { addedPersonalRecords: merged.added, ledger: result.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export function parseArguments(argv) {
  const values = {};
  const allowed = new Set([
    'account-id',
    'email',
    'display-name',
    'school-id',
    'school-name',
    'department',
    'now',
    'existing-ledger',
    'sql-file',
    'fixtures-file',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--dry-run' || arg === '--help') {
      if (values[arg.slice(2)] !== undefined) throw new Error(`重複參數：${arg}`);
      values[arg.slice(2)] = true;
      continue;
    }
    if (
      !arg?.startsWith('--') ||
      !allowed.has(arg.slice(2)) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith('--')
    ) {
      throw new Error(`不支援或缺少值的參數：${arg}`);
    }
    if (values[arg.slice(2)] !== undefined) throw new Error(`重複參數：${arg}`);
    values[arg.slice(2)] = argv[++i];
  }
  if (values.apply && values['dry-run']) throw new Error('--apply 與 --dry-run 不可同時使用。');
  if (values.apply && (values['existing-ledger'] || values['sql-file'])) {
    throw new Error('--apply 會在交易內讀取最新資料；請先獨立輸出審核計畫。');
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(
      '用法：node scripts/demo/seed-account-demo.mjs --account-id pa_UUID --email EMAIL --display-name NAME --school-id pu --school-name 靜宜大學 [--now ISO_TIMESTAMP] [--existing-ledger FILE] [--sql-file FILE] [--fixtures-file FILE] [--apply]',
    );
    console.log(
      '預設只產生預覽；--apply 使用 ACCOUNT_DEMO_DATABASE_URL。現有帳號、課班、示範開關與進度皆保留。',
    );
    return;
  }
  const identity = validateSeedIdentity({ accountId: options['account-id'], email: options.email });
  const shared = await loadFixtureModule();
  const fixtures = shared.createAccountDemoFixtures({
    accountId: identity.accountId,
    schoolId: options['school-id'],
    displayName: options['display-name'],
    schoolName: options['school-name'],
    department: options.department,
    now: options.now ? new Date(options.now) : new Date(),
  });
  if (options['fixtures-file'])
    await writeFile(resolve(options['fixtures-file']), `${JSON.stringify(fixtures, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
  if (options.apply) {
    const connectionString = process.env.ACCOUNT_DEMO_DATABASE_URL;
    if (!connectionString)
      throw new Error('--apply 需要 ACCOUNT_DEMO_DATABASE_URL，不接受命令列密碼。');
    const { Client } = createRequire(join(REPO, 'apps/web/package.json'))('pg');
    const client = new Client({
      connectionString,
      application_name: 'nuni-account-demo-seed',
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      const result = await applyAccountDemoSeed(client, fixtures, identity.email, shared);
      console.log(
        JSON.stringify({ mode: 'applied', seedTag: fixtures.seedTag, ...result }, null, 2),
      );
    } finally {
      await client.end();
    }
    return;
  }
  const ledger = options['existing-ledger']
    ? JSON.parse(await readFile(resolve(options['existing-ledger']), 'utf8'))
    : { revision: 0, records: [] };
  if (ledger.schoolId !== undefined && ledger.schoolId !== fixtures.schoolId)
    throw new Error('快照校園不符。');
  const merged = shared.mergeAccountDemoRecords(
    ledger.records,
    fixtures.records,
    fixtures.schoolId,
  );
  const statements = buildAccountDemoStatements(fixtures, identity.email, ledger, merged);
  if (options['sql-file'])
    await writeFile(resolve(options['sql-file']), renderAccountDemoSql(statements), {
      mode: 0o600,
      flag: 'wx',
    });
  console.log(
    JSON.stringify(
      {
        mode: 'dry-run',
        seedTag: fixtures.seedTag,
        schoolId: fixtures.schoolId,
        privateCourses: fixtures.courses.length,
        studentCourses: fixtures.courses.filter((course) => course.memberRole === 'student').length,
        materials: fixtures.courses.reduce((sum, course) => sum + course.materials.length, 0),
        assignments: fixtures.courses.reduce((sum, course) => sum + course.assignments.length, 0),
        quizzes: fixtures.courses.length,
        personalRecordsToAdd: merged.added,
        expectedLedgerRevision: ledger.revision,
        featurePermissions: Object.keys(fixtures.permissions).length,
        expiresAt: fixtures.expiresAt,
        sqlStatements: statements.length,
        note: '尚未連線或寫入資料庫。若帳號已有個人資料，請提供最新快照重新產生計畫。',
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never print connection settings or a stack containing supplied credentials.
    console.error(error instanceof Error ? error.message : '示範資料作業失敗。');
    process.exitCode = 1;
  });
}
