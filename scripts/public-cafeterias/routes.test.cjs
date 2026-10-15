const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const Fastify = require(
  join(process.env.PUBLIC_CAFETERIA_TEST_DEPS || join(__dirname, '../../node_modules'), 'fastify'),
);
const {
  isPublicCafeteriaRoute,
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
  app.post('/v1/staff/food/orders/order-1/accept', async () => ({ accepted: true }));
  await app.ready();
  return app;
}

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
    const orderPost = await app.inject({ method: 'POST', url: '/v1/food/orders' });
    assert.equal(orderGet.statusCode, 200);
    assert.equal(orderPost.statusCode, 200);
    assert.equal(orderPost.json().id, 'order-1');
    const accept = await app.inject({
      method: 'POST',
      url: '/v1/staff/food/orders/order-1/accept',
    });
    assert.equal(accept.statusCode, 200);
    assert.deepEqual(accept.json(), { accepted: true });
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
