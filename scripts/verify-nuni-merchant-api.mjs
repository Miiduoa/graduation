// Run with the pinned Nuni checkout's tsx loader. This creates and drops only a
// fresh schema in the named loopback acceptance database; it never uses ambient DATABASE_URL.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPinnedNuniSource } from './lib/nuni-course-source.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
assert(
  args.includes('--source') && args.includes('--database-url'),
  'Pass --source <pinned checkout> --database-url <owned loopback acceptance database>',
);
const source = path.resolve(option('--source'));
const databaseUrl = new URL(option('--database-url'));
assert.equal(databaseUrl.protocol, 'postgresql:');
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.pathname, '/campus_nuni_merchant_acceptance');
assert(
  databaseUrl.port && !databaseUrl.search && !databaseUrl.hash,
  'Explicit loopback port required',
);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(repository, 'deploy/nuni-api/source.json'), 'utf8'),
);
for (const patch of manifest.patches) {
  const bytes = await readFile(path.join(repository, 'deploy/nuni-api/patches', patch.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), patch.sha256);
}
const tree = assertPinnedNuniSource(source, manifest.candidateTree);
const sourceRequire = createRequire(path.join(source, 'apps/api/package.json'));
const load = (relative) => import(pathToFileURL(path.join(source, relative)).href);
const { Client } = sourceRequire('pg');
const { generateKeyPair, exportJWK, SignJWT } = await import(
  pathToFileURL(sourceRequire.resolve('jose')).href
);
const { createDatabase } = await load('apps/api/src/database.ts');
const { readDatabaseRuntimeConfig } = await load('apps/api/src/database-runtime-config.ts');
const { createApp } = await load('apps/api/src/app.ts');
const schemaName = `merchant_accept_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: databaseUrl.href });
const report = {
  startedAt: new Date().toISOString(),
  candidateCommit: manifest.candidateCommit,
  candidateTree: tree,
  authMode: 'campus-account',
  demoAuthEnabled: false,
  seedDemo: false,
  identityProvider: 'Isolated RS256 test keys; real nonce, signature, account and session handlers',
  transport: 'loopback HTTP',
  database: 'PostgreSQL',
  checks: [],
  observations: [],
};
let app;
let db;
let schemaCreated = false;
let origin;
let requestCount = 0;
async function request(method, route, session, payload, expected = 200) {
  ++requestCount;
  const response = await fetch(`${origin}${route}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(session ? { Authorization: `Platform ${session.sessionHandle}` } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const value = await response.json();
  // Do not print successful session responses, bearer handles or ID tokens.
  assert.equal(
    response.status,
    expected,
    `${method} ${route}: ${value?.error?.code || response.status}`,
  );
  return value;
}
const passed = (name) => report.checks.push(name);

try {
  await admin.connect();
  report.postgresVersion = (await admin.query('SHOW server_version')).rows[0].server_version;
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;
  const runtimeConfig = readDatabaseRuntimeConfig(
    {
      DATABASE_URL: databaseUrl.href,
      DATABASE_TLS_MODE: 'disable',
      DATABASE_SCHEMA_NAME: schemaName,
      DATABASE_APPLICATION_NAME: 'campus-merchant-acceptance',
    },
    { isProduction: false, component: 'api', allowEmbedded: false },
  );
  db = await createDatabase({
    runtimeConfig,
    seedDemo: false,
    attendanceCodeSecret: 'merchant-acceptance-local-only-not-production',
  });
  assert.equal(db.kind, 'postgres');
  await db.query(`INSERT INTO platform_identity_providers
    (kind,issuer,client_id,jwks_uri,authorization_endpoint,token_endpoint,state)
    VALUES ('google-consumer','https://accounts.google.com','merchant-acceptance-client',
    'https://www.googleapis.com/oauth2/v3/certs','https://accounts.google.com/o/oauth2/v2/auth',
    'https://oauth2.googleapis.com/token','enabled')`);
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: 'merchant-acceptance',
    alg: 'RS256',
    use: 'sig',
  };
  app = await createApp(db, {
    auth: { mode: 'campus-account' },
    enableDemoAuth: false,
    campusAccountSessionSecret: 'merchant-acceptance-session-local-only-not-production',
    attendanceCodeSecret: 'merchant-acceptance-local-only-not-production',
    externalIdpJwksFetch: async () =>
      new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const base = '/v1/auth/platform';
  async function login(subject) {
    const tx = await request('POST', `${base}/login-transactions`, null, {
      kind: 'google-consumer',
    });
    const idToken = await new SignJWT({
      nonce: tx.nonce,
      email: `${subject}@example.test`,
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'merchant-acceptance', typ: 'JWT' })
      .setIssuer('https://accounts.google.com')
      .setAudience('merchant-acceptance-client')
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    return request(
      'POST',
      `${base}/sessions`,
      null,
      {
        kind: 'google-consumer',
        transactionId: tx.transactionId,
        nonce: tx.nonce,
        idToken,
        displayName: subject,
      },
      201,
    );
  }

  const merchant = await login('merchant-acceptance-owner');
  const outsider = await login('merchant-acceptance-outsider');
  assert.notEqual(merchant.platformAccountId, outsider.platformAccountId);
  passed(
    'Two distinct accounts complete real signed platform login over loopback HTTP; demo auth disabled',
  );
  const tenant = 'merchant-acceptance';
  await db.query(
    `INSERT INTO tenants (id,display_name,state,directory_source)
    VALUES ($1,'隔離驗收場域','open','manual')`,
    [tenant],
  );
  await db.query(
    `INSERT INTO campuses (tenant_id,id,display_name)
    VALUES ($1,'main-campus','主校區')`,
    [tenant],
  );
  await db.query(
    `INSERT INTO food_merchant_onboarding_policies (tenant_id,state)
    VALUES ($1,'open')`,
    [tenant],
  );
  await db.query(
    `INSERT INTO people
    (tenant_id,id,student_number,display_name,program,curriculum_version,study_year,campus,campus_id,credential_status)
    VALUES ($1,'acceptance-reviewer','reviewer','驗收審核員','營運','test',1,'主校區','main-campus','active')`,
    [tenant],
  );
  await db.query(
    `INSERT INTO food_tenant_staff_assignments (tenant_id,staff_id,role)
    VALUES ($1,'acceptance-reviewer','onboarding-reviewer')`,
    [tenant],
  );
  const programs = await request('GET', `${base}/merchant-onboarding-programs`, merchant);
  assert(programs.programs.some((program) => program.tenantId === tenant));
  const application = await request(
    'POST',
    `${base}/merchant-applications`,
    merchant,
    {
      tenantId: tenant,
      campusId: 'main-campus',
      idempotencyKey: 'merchant-acceptance-application-0001',
      businessKind: 'campus-stall',
      legalName: '驗收餐飲合作社',
      brandName: '驗收餐坊',
      contactName: '驗收店長',
      contactEmail: 'merchant@example.test',
      contactPhone: '0912345678',
      locationName: '主校區門市',
      operatingAddress: '主校區活動中心一樓',
      serviceModes: ['pickup'],
    },
    201,
  );
  assert.equal(application.state, 'submitted');
  assert.equal(
    (await request('GET', `${base}/merchant-workspaces`, merchant)).workspaces.length,
    0,
  );
  const { FoodMerchantOnboardingService } = await load(
    'apps/api/src/food/food-merchant-onboarding-service.ts',
  );
  // The test reviewer is provisioned only in this temporary schema. This invokes the real
  // approval service, but does not claim a real school administrator login or registry check.
  const approved = await new FoodMerchantOnboardingService(db).review(
    {
      tenantId: tenant,
      personId: 'acceptance-reviewer',
      roles: ['food-staff'],
    },
    application.applicationId,
    {
      action: 'approve',
      reasonCode: 'registry-and-site-verified',
      reviewerNote: '隔離資料驗收',
      businessRegistryCheck: 'not-applicable',
      foodRegistryCheck: 'matched',
      expectedVersion: 1,
    },
  );
  assert.equal(approved.state, 'approved');
  const location = approved.locationId;
  const route = `${base}/merchant-workspaces/${tenant}/${location}`;
  const { createMerchantOperations } = await import(
    pathToFileURL(path.join(repository, 'packages/shared/src/nuniMerchantOperations.ts')).href
  );
  const transport = async (resource, input, method) =>
    request(
      method ?? (input ? 'POST' : 'GET'),
      `${base}/${resource}`,
      merchant,
      input,
      resource.endsWith('/initial-menu') ? 201 : 200,
    );
  const ops = createMerchantOperations(transport);
  let detail = await ops.get(tenant, location);
  assert.equal(detail.activated, false);
  assert.equal(detail.publicAccess, false);
  await request('GET', route, outsider, undefined, 404);
  await request('POST', `${route}/activate`, outsider, {}, 404);
  await request(
    'GET',
    `${base}/merchant-workspaces/another-school/${location}`,
    merchant,
    undefined,
    404,
  );
  await request('POST', `${route}/activate`, merchant, {}, 422);
  passed(
    'Application approval creates a private, suspended location; outsiders and other tenants cannot operate it',
  );
  const settings = {
    serviceModes: ['pickup'],
    paymentMode: 'counter-only',
    termsVersion: 'merchant-terms-v1',
    expectedVersion: detail.readinessVersion,
  };
  detail = await ops.updateSettings(tenant, location, settings);
  assert.equal(detail.managerConfirmed, true);
  await request('PUT', `${route}/settings`, merchant, settings, 409);
  const menu = {
    items: [
      {
        name: '驗收便當',
        description: '隔離測試品項',
        priceMinor: 120,
        initialStock: 10,
        allergens: ['蛋'],
      },
    ],
  };
  const attempts = await Promise.all(
    [0, 1].map(async () => {
      const response = await fetch(`${origin}${route}/initial-menu`, {
        method: 'POST',
        headers: {
          Authorization: `Platform ${merchant.sessionHandle}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(menu),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      ++requestCount;
      return { status: response.status, value: await response.json() };
    }),
  );
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
  const { parseMerchantInitialMenuReceipt } = await import(
    pathToFileURL(path.join(repository, 'packages/shared/src/nuniMerchantOperations.ts')).href
  );
  parseMerchantInitialMenuReceipt(attempts.find((result) => result.status === 201).value, 1);
  const menuState = await db.query(
    `SELECT item.price_minor,stock.on_hand FROM food_menu_versions menu
    JOIN food_menu_items item ON item.tenant_id=menu.tenant_id AND item.menu_version_id=menu.id
    JOIN food_stock_items stock ON stock.tenant_id=item.tenant_id AND stock.id=item.stock_item_id
    WHERE menu.tenant_id=$1 AND menu.location_id=$2`,
    [tenant, location],
  );
  assert.equal(menuState.rows.length, 1);
  assert.equal(menuState.rows[0].price_minor, 120);
  assert.equal(menuState.rows[0].on_hand, 10);
  detail = await ops.get(tenant, location);
  assert.equal(detail.publishedMenuItems, 1);
  assert.deepEqual(detail.missingRequirements, []);
  passed(
    'Settings enforce optimistic version checking; concurrent initial-menu requests persist exactly one NT$120 item and stock 10',
  );
  detail = await ops.activate(tenant, location);
  assert.equal(detail.activated, true);
  assert.equal(detail.locationStatus, 'open');
  assert.equal(detail.publicAccess, true);
  detail = await ops.setAvailability(tenant, location, false);
  assert.equal(detail.locationStatus, 'closed');
  assert.equal(detail.publicAccess, false);
  const replay = await ops.activate(tenant, location);
  assert.equal(replay.locationStatus, 'closed');
  detail = await ops.setAvailability(tenant, location, true);
  assert.equal(detail.locationStatus, 'open');
  passed(
    'Shared client validates actual API activation and pause/resume receipts; replaying activation does not reopen a paused store',
  );
  await db.query(
    `UPDATE food_locations SET status='suspended',public_access=false WHERE tenant_id=$1 AND id=$2`,
    [tenant, location],
  );
  await request('POST', `${route}/availability`, merchant, { acceptingOrders: true }, 409);
  await db.query(`DELETE FROM food_staff_assignments WHERE tenant_id=$1 AND location_id=$2`, [
    tenant,
    location,
  ]);
  await request('GET', route, merchant, undefined, 404);
  await request('POST', `${route}/activate`, merchant, {}, 404);
  await request('POST', `${base}/logout`, merchant, {});
  await request('GET', route, merchant, undefined, 401);
  passed(
    'School suspension, revoked manager assignment and revoked session block further operations',
  );
  report.observations.push(
    'Approval uses a schema-local reviewer fixture with the real service; no real school login, merchant, payment or production data is exercised.',
  );
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.schemaRemoved = false;
  report.cleanupErrors = [];
  for (const cleanup of [
    () => app?.close(),
    () => db?.close(),
    async () => {
      if (schemaCreated) {
        await admin.query(`DROP SCHEMA "${schemaName}" CASCADE`);
        report.schemaRemoved = true;
      }
    },
    () => admin.end(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      report.cleanupErrors.push(error instanceof Error ? error.message : String(error));
      report.status = 'failed';
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  report.httpRequests = requestCount;
  if (args.includes('--output'))
    await writeFile(path.resolve(option('--output')), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
