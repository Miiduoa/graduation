// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const food = 'realms/school-one/food';
const merchant = 'merchant-workspaces/school-one/location-one';
const fetcher = vi.fn();
function call(
  path: string,
  method = 'GET',
  body?: unknown,
  context = sessionContext(session),
  origin = 'https://nuni.tw',
) {
  const request = new NextRequest(`https://nuni.tw/api/nuni/${path}`, {
    method,
    headers: {
      Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': context,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handleNuni(request, path.split('?')[0].split('/'));
}
function respond(value: unknown, status = 200) {
  fetcher.mockResolvedValue(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}
beforeEach(() => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', ['food-api', 'isolated-unit-test', 'session-placeholder', 'not-a-credential'].join('-'));
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('retrieves private order realms with session binding and no shared cache', async () => {
  respond({ realms: [{ tenantId: 'school-one', name: '學生餐廳' }] });
  const result = await call('food-order-realms');
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toBe('no-store, private');
  expect(await result.json()).toEqual({ realms: [{ tenantId: 'school-one', name: '學生餐廳' }] });
  expect((await call('food-order-realms', 'GET', undefined, 'stale')).status).toBe(409);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([`${food}/orders`, `${merchant}/orders`, `${food}/locations`])(
  'encodes cursor pagination only for an explicit list: %s',
  async (path) => {
    respond(path.endsWith('locations') ? { locations: [] } : { orders: [] });
    expect((await call(`${path}?limit=25&cursor=YWJj_123`)).status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toContain(`${path}?limit=25&cursor=YWJj_123`);
  },
);

it.each([
  [`${food}/orders?limit=0`, 'GET', undefined],
  [`${food}/orders?limit=101`, 'GET', undefined],
  [`${food}/orders?limit=5&limit=6`, 'GET', undefined],
  [`${food}/orders?personId=someone-else`, 'GET', undefined],
  [`${food}/orders/order-one?cursor=abc`, 'GET', undefined],
  [`${merchant}/shift?limit=5`, 'GET', undefined],
  ['food-order-realms?tenantId=another', 'GET', undefined],
  ['class-workspaces?cursor=abc', 'GET', undefined],
  [
    `${food}/orders/order-one/cancel?cursor=abc`,
    'POST',
    { reason: 'changed-mind', idempotencyKey: 'cancel-test-key' },
  ],
  [
    `${food}/orders/order-one/cancel`,
    'POST',
    { reason: 'changed-mind', idempotencyKey: 'cancel-test-key', personId: 'someone-else' },
  ],
  [
    `${merchant}/orders/order-one/fulfill`,
    'POST',
    { pickupToken: 'display-code', idempotencyKey: 'pickup-test-key' },
  ],
])(
  'rejects query, authority or pickup-code confusion before upstream: %s',
  async (path, method, body) => {
    expect((await call(path, method, body)).status).toBeGreaterThanOrEqual(400);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('requires same-origin and captured account for financial actions and verifies receipt identity', async () => {
  const path = `${merchant}/orders/order-one/counter-payment`;
  const body = { idempotencyKey: 'counter-test-key' };
  expect((await call(path, 'POST', body, 'stale')).status).toBe(409);
  expect(
    (await call(path, 'POST', body, sessionContext(session), 'https://foreign.test')).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  respond({
    orderId: 'order-one',
    state: 'paid',
    updatedAt: new Date().toISOString(),
    replayed: false,
  });
  expect((await call(path, 'POST', body)).status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(body);
  respond({
    orderId: 'someone-else',
    state: 'paid',
    updatedAt: new Date().toISOString(),
    replayed: false,
  });
  expect((await call(path, 'POST', body)).status).toBe(502);
});

it('never forwards arbitrary staff or social actions through food routes', async () => {
  for (const path of [
    `${merchant}/orders/order-one/refund-all`,
    `${food}/orders/order-one/admin`,
    'realms/school-one/social/posts',
  ]) {
    expect((await call(path, 'POST', {})).status).toBeGreaterThanOrEqual(400);
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('preserves bounded business error codes so an empty register can open its first shift', async () => {
  respond({ error: { code: 'FOOD_SHIFT_NOT_FOUND', message: 'private upstream details' } }, 404);
  const response = await call(`${merchant}/shift`);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'FOOD_SHIFT_NOT_FOUND' });
  respond({ error: { code: 'raw <private> details', message: 'secret' } }, 404);
  expect(await (await call(`${merchant}/shift`)).json()).toEqual({ error: 'REQUEST_FAILED' });
});
