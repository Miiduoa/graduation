// Run with the pinned Nuni checkout's tsx loader. This creates and drops only a
// fresh schema in the named loopback acceptance database; it never uses ambient DATABASE_URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertFoodOrderingSource, loadFoodOrderingCandidate } from './nuni-merchant-source.mjs';
import { nativeLoopbackFetch } from './nuni-merchant-native-transport.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const sourceOnly = args.includes('--verify-source-only');
const nativeClient = args.includes('--native-client');
assert(
  !(nativeClient && args.includes('--serve')),
  '--native-client cannot be combined with --serve',
);
assert(
  !(nativeClient && sourceOnly),
  '--native-client requires HTTP acceptance, not --verify-source-only',
);
assert(
  args.includes('--source') && (sourceOnly || args.includes('--database-url')),
  'Pass --source <pinned checkout> --database-url <owned loopback acceptance database> (or --verify-source-only)',
);
const source = path.resolve(option('--source'));
const databaseUrl = sourceOnly ? null : new URL(option('--database-url'));
if (databaseUrl) {
  assert.equal(databaseUrl.protocol, 'postgresql:');
  assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.pathname, '/campus_nuni_merchant_acceptance');
  assert(
    databaseUrl.port && !databaseUrl.search && !databaseUrl.hash,
    'Explicit loopback port required',
  );
}
assert(
  args.includes('--food-ordering-candidate'),
  'Pass --food-ordering-candidate explicitly; the default v20 source does not support complete ordering',
);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await loadFoodOrderingCandidate(repository);
const tree = assertFoodOrderingSource(source, manifest);
if (sourceOnly) {
  console.log(
    JSON.stringify({
      candidate: 'food-ordering',
      candidateCommit: manifest.candidateCommit,
      candidateTree: tree,
      databaseAccessed: false,
    }),
  );
  process.exit(0);
}
const sourceRequire = createRequire(path.join(source, 'apps/api/package.json'));
const load = (relative) => import(pathToFileURL(path.join(source, relative)).href);
const { Client } = sourceRequire('pg');
const { generateKeyPair, exportJWK, SignJWT } = await import(
  pathToFileURL(sourceRequire.resolve('jose')).href
);
const { createDatabase } = await load('apps/api/src/database.ts');
const { readDatabaseRuntimeConfig } = await load('apps/api/src/database-runtime-config.ts');
const { createApp } = await load('apps/api/src/app.ts');
const nativeRequest = nativeClient
  ? (
      await import(
        pathToFileURL(path.join(repository, 'apps/mobile/src/services/nuniClient.ts')).href
      )
    ).nuniPlatformRequest
  : null;
const schemaName = `merchant_accept_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: databaseUrl.href });
const report = {
  startedAt: new Date().toISOString(),
  candidate: 'food-ordering',
  candidateCommit: manifest.candidateCommit,
  candidateTree: tree,
  authMode: 'campus-account',
  demoAuthEnabled: false,
  seedDemo: false,
  identityProvider: 'Isolated RS256 test keys; real nonce, signature, account and session handlers',
  transport: 'loopback HTTP',
  database: 'PostgreSQL',
  audit: nativeClient
    ? 'native-transport-shared-client-student-merchant-pickup-and-refund'
    : 'shared-client-student-merchant-pickup-and-refund',
  ...(nativeClient
    ? {
        nativeTransport: {
          source: 'apps/mobile/src/services/nuniClient.ts',
          requests: [],
          uiOrDeviceValidated: false,
        },
      }
    : {}),
  checks: [],
  observations: [],
};
let app;
let db;
let schemaCreated = false;
let origin;
let requestCount = 0;
let nativeExpected = null;
let nativeLogicalRequests = 0;
const originalFetch = globalThis.fetch;
const fixtureFile = path.join(repository, '../.food-browser-fixture.json');
let fixtureCreated = false;
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
  if (nativeClient) {
    globalThis.fetch = nativeLoopbackFetch(
      origin,
      originalFetch,
      () => nativeExpected,
      (entry) => {
        ++requestCount;
        report.nativeTransport.requests.push(entry);
      },
    );
  }
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
  if (args.includes('--serve')) {
    // Own-schema credentials are ephemeral and never printed or added to the report.
    await writeFile(
      fixtureFile,
      JSON.stringify({
        apiOrigin: origin,
        tenantId: tenant,
        locationId: location,
        merchant,
        customer: outsider,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    fixtureCreated = true;
    process.stdout.write(
      `Isolated food browser fixture ready at ${origin}; waiting for SIGINT/SIGTERM.\n`,
    );
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    report.status = 'browser-fixture-stopped';
  } else {
    // Every test mutation below targets this owned random schema, never production.
    const customer = outsider;
    const foodBase = `${base}/realms/${tenant}/food`;
    assert.equal(
      Number(
        (
          await db.query('SELECT count(*) AS count FROM social_communities WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].count,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await db.query('SELECT count(*) AS count FROM food_locations WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].count,
      ),
      1,
    );
    const { createNuniFoodClient } = await import(
      pathToFileURL(path.join(repository, 'packages/shared/src/nuniFood.ts')).href
    );
    const foodTransport = (actor) => async (resource, input, query) => {
      const search = new URLSearchParams(query).toString();
      const created = input && (/\/(quotes|orders)$/.test(resource) || resource.endsWith('/shift'));
      report.lastResource = resource;
      if (nativeRequest) {
        assert.equal(nativeExpected, null, 'Native acceptance requests must not overlap');
        ++nativeLogicalRequests;
        nativeExpected = {
          method: input ? 'POST' : 'GET',
          path: `${base}/${resource}${search ? `?${search}` : ''}`,
          authorization: `Platform ${actor.sessionHandle}`,
          status: created ? 201 : 200,
        };
        try {
          return await nativeRequest(
            resource,
            actor.sessionHandle,
            input,
            undefined,
            undefined,
            query,
          );
        } finally {
          nativeExpected = null;
        }
      }
      const value = await request(
        input ? 'POST' : 'GET',
        `${base}/${resource}${search ? `?${search}` : ''}`,
        actor,
        input,
        created ? 201 : 200,
      );
      return value;
    };
    const customerFood = createNuniFoodClient(foodTransport(customer));
    const merchantFood = createNuniFoodClient(foodTransport(merchant));
    assert((await customerFood.listRealms()).some((realm) => realm.tenantId === tenant));
    assert((await customerFood.listLocations(tenant)).locations.some((row) => row.id === location));
    assert.deepEqual(await customerFood.listOrderRealms(), []);
    const paymentMethods = await customerFood.getPaymentMethods(tenant, location);
    assert(paymentMethods.methods.every((method) => method.available === false));
    const customerMenu = await customerFood.getMenu(tenant, location);
    const menuItem = customerMenu.sections.flatMap((section) => section.items)[0];
    assert(menuItem?.available);
    async function placeCustomerOrder(suffix) {
      const quote = await customerFood.createQuote(tenant, {
        locationId: location,
        requestedPickupAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
        idempotencyKey: `pause-audit-quote-${suffix}`,
      });
      assert.equal(quote.total.amountMinor, 120);
      const order = await customerFood.createOrder(tenant, {
        quoteId: quote.id,
        idempotencyKey: `pause-audit-order-${suffix}`,
      });
      assert.equal(order.state, 'payment-pending');
      return order;
    }
    const readyOrder = await placeCustomerOrder('ready-one');
    const cancelOrder = await placeCustomerOrder('cancel-two');
    await merchantFood.openShift(tenant, location, {
      openingCashMinor: 0,
      idempotencyKey: 'pause-audit-open-shift-0001',
    });
    assert.equal((await merchantFood.getShift(tenant, location)).state, 'open');
    await merchantFood.recordCounterPayment(tenant, location, readyOrder.orderId, {
      idempotencyKey: 'pause-audit-counter-0001',
    });
    const accepted = await merchantFood.acceptOrder(tenant, location, readyOrder.orderId, {
      idempotencyKey: 'pause-audit-accept-0001',
    });
    await merchantFood.startTicket(tenant, location, readyOrder.orderId, accepted.kitchenTicketId, {
      idempotencyKey: 'pause-audit-start-0001',
    });
    await merchantFood.readyTicket(tenant, location, readyOrder.orderId, accepted.kitchenTicketId, {
      idempotencyKey: 'pause-audit-ready-0001',
    });
    const beforeReady = await customerFood.getOrder(tenant, readyOrder.orderId);
    assert.equal(beforeReady.state, 'ready');
    assert(beforeReady.pickup.credential?.token);
    const beforeCancel = await customerFood.getOrder(tenant, cancelOrder.orderId);
    assert.equal(beforeCancel.state, 'payment-pending');
    passed(
      'Before pause, two real HTTP-created customer orders are readable; first is paid/accepted/prepared/ready with a one-time pickup token, second awaits payment',
    );
    report.orderBeforePause = {
      readyOrder: beforeReady.state,
      readyTokenAvailable: true,
      cancelOrder: beforeCancel.state,
      onlyLocation: true,
      publicCommunityCount: 0,
    };
    detail = await ops.setAvailability(tenant, location, false);
    assert.equal(detail.locationStatus, 'closed');
    assert.equal(detail.publicAccess, false);
    assert((await customerFood.listOrderRealms()).some((realm) => realm.tenantId === tenant));
    assert.deepEqual(await merchantFood.listOrderRealms(), []);
    const pausedList = await customerFood.listOrders(tenant);
    const firstPage = await customerFood.listOrders(tenant, { limit: 1 });
    assert(firstPage.nextCursor);
    const nextPage = await customerFood.listOrders(tenant, {
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    assert.notEqual(firstPage.orders[0].id, nextPage.orders[0].id);
    assert(pausedList.orders.some((order) => order.id === readyOrder.orderId));
    const pausedReady = await customerFood.getOrder(tenant, readyOrder.orderId);
    assert.equal(pausedReady.state, 'ready');
    assert(pausedReady.pickup.credential?.token);
    const pausedPending = await customerFood.getOrder(tenant, cancelOrder.orderId);
    assert.equal(pausedPending.state, 'payment-pending');
    await request('GET', `${foodBase}/orders/${readyOrder.orderId}`, merchant, undefined, 404);
    await request(
      'POST',
      `${foodBase}/orders/${cancelOrder.orderId}/cancel`,
      merchant,
      {
        reason: 'changed-mind',
        idempotencyKey: 'pause-audit-foreign-cancel-0001',
      },
      404,
    );
    await request('GET', `${foodBase}/locations/${location}/menu`, customer, undefined, 404);
    await request(
      'POST',
      `${foodBase}/quotes`,
      customer,
      {
        locationId: location,
        requestedPickupAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
        idempotencyKey: 'pause-audit-new-quote-denied',
      },
      404,
    );
    const pausedQueue = await merchantFood.listMerchantOrders(tenant, location);
    assert(
      pausedQueue.orders.some(
        (order) => order.id === readyOrder.orderId && order.state === 'ready',
      ),
    );
    const canceled = await customerFood.cancelOrder(tenant, cancelOrder.orderId, {
      reason: 'changed-mind',
      idempotencyKey: 'pause-audit-cancel-0001',
    });
    assert.equal(canceled.state, 'canceled');
    const fulfilled = await merchantFood.fulfillOrder(tenant, location, readyOrder.orderId, {
      pickupToken: pausedReady.pickup.credential.token,
      idempotencyKey: 'pause-audit-fulfill-0001',
    });
    assert.equal(fulfilled.state, 'fulfilled');
    const fulfillmentReplay = await merchantFood.fulfillOrder(
      tenant,
      location,
      readyOrder.orderId,
      {
        pickupToken: pausedReady.pickup.credential.token,
        idempotencyKey: 'pause-audit-fulfill-0001',
      },
    );
    assert.equal(fulfillmentReplay.replayed, true);
    await request(
      'POST',
      `${route}/orders/${readyOrder.orderId}/fulfill`,
      merchant,
      {
        pickupToken: pausedReady.pickup.credential.token,
        idempotencyKey: 'pause-audit-consumed-token',
      },
      409,
    );
    const finalOrder = await customerFood.getOrder(tenant, readyOrder.orderId);
    assert.equal(finalOrder.state, 'fulfilled');
    assert.equal(finalOrder.pickup.credential, undefined);
    const storedOrders = await db.query(
      'SELECT id,state FROM food_orders WHERE tenant_id=$1 ORDER BY id',
      [tenant],
    );
    assert.deepEqual(storedOrders.rows.map((row) => row.state).sort(), ['cancelled', 'fulfilled']);
    report.paused = {
      customerListStatus: 200,
      readyTokenAvailable: true,
      cancellationState: canceled.state,
      fulfillmentState: fulfilled.state,
      merchantQueueStatus: 200,
      foreignOrderDenied: true,
      publicMenuAndNewQuoteDenied: true,
      fulfillmentReplayed: true,
      consumedTokenDenied: true,
      databaseOrderStates: storedOrders.rows.map((row) => row.state).sort(),
    };
    passed(
      'Pausing the last public location preserves only the existing customer order list/detail/cancel and pickup credential; merchant fulfillment still works and foreign orders/new quotes remain denied',
    );
    const replay = await ops.activate(tenant, location);
    assert.equal(replay.locationStatus, 'closed');
    detail = await ops.setAvailability(tenant, location, true);
    assert.equal(detail.locationStatus, 'open');
    passed(
      'Shared client validates actual API activation and pause/resume receipts; replaying activation does not reopen a paused store',
    );
    const replayCanceled = await customerFood.cancelOrder(tenant, cancelOrder.orderId, {
      reason: 'changed-mind',
      idempotencyKey: 'pause-audit-cancel-0001',
    });
    assert.equal(replayCanceled.state, 'canceled');
    assert.equal(replayCanceled.replayed, true);
    report.resumed = { cancellationReplayed: true };
    passed(
      'Restoring order acceptance keeps existing order receipts and the original cancellation idempotency key',
    );

    const refundOrder = await placeCustomerOrder('refund-three');
    await merchantFood.recordCounterPayment(tenant, location, refundOrder.orderId, {
      idempotencyKey: 'flow-paid-refund-three',
    });
    const pendingRefund = await customerFood.cancelOrder(tenant, refundOrder.orderId, {
      reason: 'changed-mind',
      idempotencyKey: 'flow-cancel-refund-three',
    });
    assert.equal(pendingRefund.state, 'cancellation-pending-refund');
    const refundQueue = await merchantFood.listMerchantOrders(tenant, location);
    assert(
      refundQueue.orders
        .find((order) => order.id === refundOrder.orderId)
        .allowedActions.includes('confirm-counter-refund'),
    );
    const refunded = await merchantFood.confirmCounterRefund(
      tenant,
      location,
      refundOrder.orderId,
      { idempotencyKey: 'flow-refund-three' },
    );
    assert.equal(refunded.state, 'canceled');
    assert.equal(
      (await customerFood.getOrder(tenant, refundOrder.orderId)).refund.state,
      'completed',
    );
    const rejectedOrder = await placeCustomerOrder('reject-four');
    await merchantFood.recordCounterPayment(tenant, location, rejectedOrder.orderId, {
      idempotencyKey: 'flow-paid-reject-four',
    });
    assert.equal(
      (
        await merchantFood.rejectOrder(tenant, location, rejectedOrder.orderId, {
          reason: 'item-unavailable',
          idempotencyKey: 'flow-reject-four',
        })
      ).state,
      'rejection-pending-refund',
    );
    assert.equal(
      (
        await merchantFood.confirmCounterRefund(tenant, location, rejectedOrder.orderId, {
          idempotencyKey: 'flow-refund-four',
        })
      ).state,
      'rejected',
    );
    const canceledAccepted = await placeCustomerOrder('accepted-five');
    await merchantFood.recordCounterPayment(tenant, location, canceledAccepted.orderId, {
      idempotencyKey: 'flow-paid-accepted-five',
    });
    await merchantFood.acceptOrder(tenant, location, canceledAccepted.orderId, {
      idempotencyKey: 'flow-accept-five',
    });
    assert.equal(
      (
        await merchantFood.cancelAcceptedOrder(tenant, location, canceledAccepted.orderId, {
          reason: 'item-unavailable',
          idempotencyKey: 'flow-cancel-five',
        })
      ).state,
      'cancellation-pending-refund',
    );
    await merchantFood.confirmCounterRefund(tenant, location, canceledAccepted.orderId, {
      idempotencyKey: 'flow-refund-five',
    });
    assert.equal(
      (await customerFood.getOrder(tenant, canceledAccepted.orderId)).refund.state,
      'completed',
    );
    const handover = await merchantFood.handoverShift(tenant, location, {
      countedCashMinor: 120,
      openNext: false,
      idempotencyKey: 'flow-handover-final',
    });
    assert.equal(handover.closed.state, 'closed');
    assert.equal(handover.closed.expectedCash.amountMinor, 120);
    passed(
      'Shared client validates real API quote/menu/list/pagination/shift/fulfillment; paid customer cancellation, merchant rejection and accepted-order cancellation each require and complete a counter refund, then cash handover reconciles NT$120',
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
    if (nativeClient) {
      const requests = report.nativeTransport.requests;
      assert.equal(
        requests.length,
        nativeLogicalRequests,
        'Every native operation must reach the real API exactly once',
      );
      for (const [method, suffix] of [
        ['GET', '/food-order-realms'],
        ['POST', '/quotes'],
        ['POST', '/orders'],
        ['POST', '/counter-payment'],
        ['POST', '/accept'],
        ['POST', '/start'],
        ['POST', '/ready'],
        ['POST', '/fulfill'],
        ['POST', '/cancel'],
        ['POST', '/reject'],
        ['POST', '/confirm-counter-refund'],
        ['POST', '/shift/handover'],
      ]) {
        assert(
          requests.some((entry) => entry.method === method && entry.path.endsWith(suffix)),
          `Native workflow did not exercise ${method} ${suffix}`,
        );
      }
      report.nativeTransport.httpRequests = requests.length;
      report.nativeTransport.methodPathAndStatusVerified = true;
      report.observations.push(
        'App transport and shared client used real HTTP responses through an acceptance-process-only loopback origin adapter. This is not native UI, camera, simulator or physical-device evidence.',
      );
      passed(
        'The production App nuniPlatformRequest completed the student/merchant lifecycle through the same real HTTP API; every method, path/query, actor and status matched the requested operation',
      );
    }
    report.status = 'passed';
  }
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  nativeExpected = null;
  report.schemaRemoved = false;
  report.cleanupErrors = [];
  for (const cleanup of [
    async () => {
      if (fixtureCreated) await unlink(fixtureFile);
    },
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
