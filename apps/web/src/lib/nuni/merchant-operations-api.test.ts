// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const identity = {
  tenantId: 'school-one',
  locationId: 'food-location_11111111-1111-4111-8111-111111111111',
};
const root = `merchant-workspaces/${identity.tenantId}/${identity.locationId}`;
const workspace = {
  ...identity,
  tenantName: '測試校園',
  merchantName: '餐坊',
  locationName: '學生餐廳',
  campusName: '主校區',
  merchantId: 'merchant_11111111-1111-4111-8111-111111111111',
  applicationId: 'fma_11111111-1111-4111-8111-111111111111',
  campusId: 'main',
  merchantStatus: 'suspended',
  locationStatus: 'suspended',
  activated: false,
  publicAccess: false,
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  onlinePaymentAvailable: false,
  paymentCapabilityState: 'not-requested',
  managerConfirmed: false,
  termsVersion: null,
  readinessVersion: 1,
  publishedMenuItems: 0,
  missingRequirements: ['settings', 'menu'],
  merchantMode: 'full',
  merchantModeLabel: '店家服務',
  sourceLabel: '',
  sourceUpdatedAt: null,
  sourceLine: '',
};
const settings = {
  serviceModes: ['pickup'],
  paymentMode: 'counter-only',
  termsVersion: 'merchant-terms-v1',
  expectedVersion: 1,
};
const menu = {
  items: [{ name: '便當', description: '', priceMinor: 120, initialStock: 10, allergens: ['蛋'] }],
};
const fetcher = vi.fn();
function call(
  path = root,
  method = 'GET',
  body?: unknown,
  context = sessionContext(session),
  origin = 'https://nuni.tw',
) {
  return handleNuni(
    new NextRequest(`https://nuni.tw/api/nuni/${path}`, {
      method,
      headers: {
        Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
        'X-Campus-Session': context,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split('/'),
  );
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
  vi.stubEnv('BFF_SESSION_SECRET', 'merchant-test-session-secret-over-32-characters');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('loads one authorized location and rejects a response for another tenant or location', async () => {
  respond(workspace);
  expect((await call()).status).toBe(200);
  for (const other of [{ tenantId: 'another-school' }, { locationId: 'another-location' }]) {
    respond({ ...workspace, ...other });
    expect((await call()).status).toBe(502);
  }
});
it('keeps PUT settings behind same-origin and captured-session checks', async () => {
  expect((await call(`${root}/settings`, 'PUT', settings, 'stale')).status).toBe(409);
  expect(
    (
      await call(
        `${root}/settings`,
        'PUT',
        settings,
        sessionContext(session),
        'https://foreign.test',
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  respond({
    ...workspace,
    managerConfirmed: true,
    termsVersion: settings.termsVersion,
    readinessVersion: 2,
    missingRequirements: ['menu'],
  });
  expect((await call(`${root}/settings`, 'PUT', settings)).status).toBe(200);
  expect(fetcher).toHaveBeenCalledWith(
    `https://api.nuni.tw/v1/auth/platform/${root}/settings`,
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(settings),
      headers: expect.objectContaining({ Authorization: `Platform ${session.sessionHandle}` }),
    }),
  );
});
it.each(['logout', 'memberships', 'merchant-applications', 'class-workspaces'])(
  'never treats PUT %s as an existing POST mutation',
  async (path) => {
    expect((await call(path, 'PUT', {})).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('forwards validated initial-menu prices in whole TWD, and validates the creation receipt', async () => {
  respond(
    { menuVersionId: 'food-menu_11111111-1111-4111-8111-111111111111', createdItems: 1 },
    201,
  );
  expect((await call(`${root}/initial-menu`, 'POST', menu)).status).toBe(201);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).items[0].priceMinor).toBe(120);
  respond({ menuVersionId: 'food-menu_11111111-1111-4111-8111-111111111111', createdItems: 2 });
  expect((await call(`${root}/initial-menu`, 'POST', menu)).status).toBe(502);
});
it.each([
  ['settings', 'PUT', { ...settings, role: 'admin' }],
  ['settings', 'PUT', { ...settings, expectedVersion: 0 }],
  ['initial-menu', 'POST', { items: [{ ...menu.items[0], priceMinor: 1.2 }] }],
  ['initial-menu', 'POST', { ...menu, tenantId: 'another-school' }],
  ['activate', 'POST', { role: 'admin' }],
  ['availability', 'POST', { acceptingOrders: true, publicAccess: true }],
])(
  'rejects invalid or self-assigned authority on %s before network access',
  async (action, method, input) => {
    expect((await call(`${root}/${action}`, method as string, input)).status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('requires a matching activation or availability result before returning success', async () => {
  respond(workspace);
  expect((await call(`${root}/activate`, 'POST', {})).status).toBe(502);
  const active = {
    ...workspace,
    merchantStatus: 'active',
    activated: true,
    publicAccess: true,
    locationStatus: 'open',
    managerConfirmed: true,
    termsVersion: 'merchant-terms-v1',
    readinessVersion: 3,
    publishedMenuItems: 1,
    missingRequirements: [],
  };
  respond(active);
  expect((await call(`${root}/activate`, 'POST', {})).status).toBe(200);
  expect((await call(`${root}/availability`, 'POST', { acceptingOrders: false })).status).toBe(502);
  respond({ ...active, publicAccess: false, locationStatus: 'closed' });
  expect((await call(`${root}/availability`, 'POST', { acceptingOrders: false })).status).toBe(200);
});
it('does not forward unsupported actions, verb confusion, oversized menus or traversal', async () => {
  expect((await call(`${root}/settings`, 'POST', settings)).status).toBe(405);
  expect((await call(`${root}/orders`, 'POST', {})).status).toBe(405);
  expect(
    (await call(`${root}/initial-menu`, 'POST', { padding: 'x'.repeat(513 * 1024) })).status,
  ).toBe(413);
  expect((await call('merchant-workspaces/school-one/%2e%2e')).status).not.toBe(200);
  expect(fetcher).not.toHaveBeenCalled();
});
