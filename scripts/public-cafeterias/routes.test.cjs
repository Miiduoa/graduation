const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const Fastify = require(
  join(process.env.PUBLIC_CAFETERIA_TEST_DEPS || join(__dirname, '../../node_modules'), 'fastify'),
);
const {
  isOrderingRoute,
  isOrderingWrite,
  isPublicCafeteriaRoute,
  onlineOrderingEnabled,
  registerPublicCafeteriaRoutes,
  resetPublicCafeteriaLimiter,
} = require(join(process.env.PUBLIC_CAFETERIA_COMPILED, 'routes.js'));
const { resetPublicCafeteriaCache } = require(
  join(process.env.PUBLIC_CAFETERIA_COMPILED, 'service.js'),
);

test('isPublicCafeteriaRoute matches only known exact catalog shapes', () => {
  assert.equal(isPublicCafeteriaRoute('GET', '/v1/public/schools/pu/cafeterias'), true);
  assert.equal(isPublicCafeteriaRoute('POST', '/v1/public/schools/pu/cafeterias'), true);
  assert.equal(isPublicCafeteriaRoute('GET', '/v1/public/cafeterias'), true);
  assert.equal(isPublicCafeteriaRoute('GET', '/v1/public/schools/cafeterias'), true);
  assert.equal(isPublicCafeteriaRoute('GET', '/v1/public/schools/pu/cafeterias?x=1'), true);
  assert.equal(isPublicCafeteriaRoute('DELETE', '/v1/public/schools/pu/cafeterias/extra'), false);
  assert.equal(isPublicCafeteriaRoute('POST', '/v1/public/schools/pu/cafeterias/orders'), false);
  assert.equal(isPublicCafeteriaRoute('GET', '/v1/public/schools/pu/food/orders'), false);
  assert.equal(isPublicCafeteriaRoute('POST', '/v1/food/orders'), false);
});

test('isOrderingRoute covers nuni-api order, quote, checkout and pickup writes', () => {
  for (const path of [
    '/v1/food/orders',
    '/v1/food/orders?cursor=1',
    '/v1/food/quotes',
    '/v1/food/pos-orders',
    '/v1/food/pickup-tokens',
    '/v1/food/pickup',
    '/v1/staff/food/orders/order-1/accept',
    '/v1/auth/platform/realms/pu/food/orders',
    '/v1/auth/platform/realms/pu/food/quotes',
    '/v1/auth/platform/realms/pu/food/orders/order-1/payment-session',
    '/v1/auth/platform/realms/pu/food/orders/order-1/cancel',
    '/v1/auth/platform/merchant-workspaces/pu/stall/orders',
    '/v1/auth/platform/merchant-workspaces/pu/stall/orders/order-1/accept',
    '/v1/merchant-workspaces/pu/stall/orders/order-1/fulfill',
  ]) {
    assert.equal(isOrderingRoute(path), true, path);
    assert.equal(isOrderingWrite('POST', path), true, path);
    assert.equal(isOrderingWrite('GET', path), false, path);
  }
  for (const path of [
    '/v1/public/schools/pu/cafeterias',
    '/v1/public/cafeterias',
    '/v1/food/locations',
    '/v1/food/locations/stall/menu',
    '/v1/auth/platform/realms/pu/food/locations',
    '/v1/auth/platform/food-order-realms',
    '/v1/auth/platform/merchant-workspaces/pu/stall/shift',
    '/v1/purchase-orders',
    '/v1/food/purchase-orders',
    '/v1/staff/food/purchase-orders/po-1',
  ]) {
    assert.equal(isOrderingRoute(path), false, path);
    assert.equal(isOrderingWrite('POST', path), false, path);
  }
});

test('onlineOrderingEnabled is only the literal true', () => {
  const prior = process.env.ONLINE_ORDERING_ENABLED;
  try {
    delete process.env.ONLINE_ORDERING_ENABLED;
    assert.equal(onlineOrderingEnabled(), false);
    for (const value of ['', 'false', 'FALSE', '1', 'yes', 'TRUE', 'on', 'true ']) {
      process.env.ONLINE_ORDERING_ENABLED = value;
      assert.equal(onlineOrderingEnabled(), false, value);
    }
    process.env.ONLINE_ORDERING_ENABLED = 'true';
    assert.equal(onlineOrderingEnabled(), true);
  } finally {
    if (prior === undefined) delete process.env.ONLINE_ORDERING_ENABLED;
    else process.env.ONLINE_ORDERING_ENABLED = prior;
  }
});

function catalogDb(options = {}) {
  return {
    async query(sql) {
      if (options.fail) throw new Error('db unavailable');
      if (sql.includes('FROM tenants')) {
        return { rows: [{ id: 'pu', state: 'open' }] };
      }
      if (sql.includes('FROM food_locations')) {
        return {
          rows: [
            {
              id: 'stall',
              name: '校內咖啡店',
              zone_label: '學生餐廳',
              opening_hours: null,
              description: null,
              merchant_mode: 'info_only',
              review_status: 'unverified',
              source_url: null,
              external_order_url: null,
              source_label: null,
              source_updated_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM food_menu_items')) {
        return {
          rows: [
            {
              id: 'toast',
              location_id: 'stall',
              name: '蔬菜吐司',
              section_name: '吐司',
              description: null,
              price_minor: 60,
              available: true,
              sold_out: false,
            },
          ],
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

async function buildApp(db = catalogDb()) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(async (error, _request, reply) => {
    if (error && (error.name === 'DomainError' || error.name === 'AuthError')) {
      return reply
        .code(error.statusCode || error.status || 400)
        .send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'internal' } });
  });
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname.startsWith('/v1/public/') && !isPublicCafeteriaRoute(request.method, pathname)) {
      return reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } });
    }
  });
  registerPublicCafeteriaRoutes(app, db);
  // Register after the adapter, matching createApp's ordering.
  app.get('/v1/food/orders', async () => ({ orders: [] }));
  app.post('/v1/food/orders', async () => ({ id: 'order-1' }));
  app.post('/v1/food/quotes', async () => ({ id: 'quote-1' }));
  app.post('/v1/food/pos-orders', async () => ({ id: 'pos-1' }));
  app.post('/v1/staff/food/orders/order-1/accept', async () => ({ accepted: true }));
  app.post('/v1/auth/platform/realms/pu/food/quotes', async () => ({ id: 'quote-1' }));
  app.post('/v1/auth/platform/realms/pu/food/orders', async () => ({ id: 'order-1' }));
  app.post('/v1/auth/platform/realms/pu/food/orders/order-1/payment-session', async () => ({
    id: 'pay-1',
  }));
  app.post('/v1/auth/platform/merchant-workspaces/pu/stall/orders/order-1/accept', async () => ({
    accepted: true,
  }));
  app.get('/v1/food/locations', async () => ({ locations: [] }));
  app.post('/v1/food/purchase-orders', async () => ({ id: 'po-1' }));
  await app.ready();
  return app;
}

function disabledOrdering(body) {
  assert.equal(body.statusCode, 412);
  assert.equal(body.json().error.code, 'ONLINE_ORDERING_DISABLED');
  assert.equal(body.json().error.message, '線上點餐尚未開放');
}

const orderingWrites = [
  ['POST', '/v1/food/orders'],
  ['PUT', '/v1/food/orders'],
  ['PATCH', '/v1/food/orders'],
  ['DELETE', '/v1/food/orders'],
  ['POST', '/v1/food/quotes'],
  ['POST', '/v1/food/pos-orders'],
  ['POST', '/v1/staff/food/orders/order-1/accept'],
  ['POST', '/v1/auth/platform/realms/pu/food/quotes'],
  ['POST', '/v1/auth/platform/realms/pu/food/orders'],
  ['POST', '/v1/auth/platform/realms/pu/food/orders/order-1/payment-session'],
  ['POST', '/v1/auth/platform/merchant-workspaces/pu/stall/orders/order-1/accept'],
];

test('Fastify inject: success, missing/invalid 400, limiter 429, nonGET 405, DB 500; orders untouched', async () => {
  const priorOrdering = process.env.ONLINE_ORDERING_ENABLED;
  delete process.env.ONLINE_ORDERING_ENABLED;
  resetPublicCafeteriaCache();
  resetPublicCafeteriaLimiter();
  const app = await buildApp();
  try {
    const ok = await app.inject({ method: 'GET', url: '/v1/public/schools/pu/cafeterias' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().schoolId, 'pu');
    assert.equal(ok.json().cafeterias[0].id, 'stall');
    assert.equal(ok.headers['cache-control'], 'public, max-age=60');

    for (const url of [
      '/v1/public/cafeterias',
      '/v1/public/schools/cafeterias',
      '/v1/public/schools/ALL/cafeterias',
    ]) {
      const bad = await app.inject({ method: 'GET', url });
      assert.equal(bad.statusCode, 400);
      assert.equal(bad.json().error.code, 'SCHOOL_ID_REQUIRED');
    }

    const denied = await app.inject({ method: 'POST', url: '/v1/public/schools/pu/cafeterias' });
    assert.equal(denied.statusCode, 405);
    assert.equal(denied.json().error.code, 'METHOD_NOT_ALLOWED');

    resetPublicCafeteriaLimiter();
    let limited;
    for (let i = 0; i < 61; i += 1) {
      limited = await app.inject({
        method: 'GET',
        url: '/v1/public/schools/pu/cafeterias',
        remoteAddress: '198.51.100.9',
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
      });
    }
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'RATE_LIMITED');

    const orderGet = await app.inject({ method: 'GET', url: '/v1/food/orders' });
    const locations = await app.inject({ method: 'GET', url: '/v1/food/locations' });
    const purchase = await app.inject({ method: 'POST', url: '/v1/food/purchase-orders' });
    assert.equal(orderGet.statusCode, 200);
    assert.equal(locations.statusCode, 200);
    assert.equal(purchase.statusCode, 200);
    assert.equal(purchase.json().id, 'po-1');
    for (const [method, url] of orderingWrites) {
      disabledOrdering(await app.inject({ method, url }));
    }
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/public/schools/pu/cafeterias/orders',
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.json().error.code, 'AUTH_REQUIRED');
  } finally {
    await app.close();
    if (priorOrdering === undefined) delete process.env.ONLINE_ORDERING_ENABLED;
    else process.env.ONLINE_ORDERING_ENABLED = priorOrdering;
  }

  resetPublicCafeteriaCache();
  resetPublicCafeteriaLimiter();
  const failing = await buildApp(catalogDb({ fail: true }));
  try {
    const boom = await failing.inject({ method: 'GET', url: '/v1/public/schools/pu/cafeterias' });
    assert.equal(boom.statusCode, 500);
    assert.equal(boom.json().error.code, 'INTERNAL_ERROR');
  } finally {
    await failing.close();
  }
});

test('switch off rejects ordering writes; switch on lets dummy handlers run', async () => {
  const priorOrdering = process.env.ONLINE_ORDERING_ENABLED;
  try {
    for (const off of [undefined, '', 'false', '1', 'TRUE']) {
      if (off === undefined) delete process.env.ONLINE_ORDERING_ENABLED;
      else process.env.ONLINE_ORDERING_ENABLED = off;
      resetPublicCafeteriaCache();
      resetPublicCafeteriaLimiter();
      const app = await buildApp();
      try {
        const catalog = await app.inject({ method: 'GET', url: '/v1/public/schools/pu/cafeterias' });
        assert.equal(catalog.statusCode, 200, off);
        assert.equal(catalog.json().schoolId, 'pu');
        for (const [method, url] of orderingWrites) {
          disabledOrdering(await app.inject({ method, url }));
        }
      } finally {
        await app.close();
      }
    }

    process.env.ONLINE_ORDERING_ENABLED = 'true';
    resetPublicCafeteriaCache();
    resetPublicCafeteriaLimiter();
    const enabled = await buildApp();
    try {
      const catalog = await enabled.inject({
        method: 'GET',
        url: '/v1/public/schools/pu/cafeterias',
      });
      assert.equal(catalog.statusCode, 200);
      const orderPost = await enabled.inject({ method: 'POST', url: '/v1/food/orders' });
      assert.equal(orderPost.statusCode, 200);
      assert.equal(orderPost.json().id, 'order-1');
      const quote = await enabled.inject({
        method: 'POST',
        url: '/v1/auth/platform/realms/pu/food/quotes',
      });
      assert.equal(quote.statusCode, 200);
      const checkout = await enabled.inject({
        method: 'POST',
        url: '/v1/auth/platform/realms/pu/food/orders/order-1/payment-session',
      });
      assert.equal(checkout.statusCode, 200);
    } finally {
      await enabled.close();
    }
  } finally {
    if (priorOrdering === undefined) delete process.env.ONLINE_ORDERING_ENABLED;
    else process.env.ONLINE_ORDERING_ENABLED = priorOrdering;
  }
});
