// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleCafeteriaCatalog, handleCafeteriaDetail } from './cafeteriaCatalog';
import { SESSION_COOKIE, sealCookie } from './server';

const fetcher = vi.fn();
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };

function request(path: string, cookie?: string) {
  return new NextRequest(`https://nuni.tw${path}`, {
    method: 'GET',
    headers: cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'test-session-secret-longer-than-32-characters');
  vi.stubGlobal('fetch', fetcher.mockReset());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('returns an empty catalog for a school with no locations', async () => {
  fetcher.mockResolvedValueOnce(json({ locations: [] }));
  const response = await handleCafeteriaCatalog(request('/api/cafeterias?schoolId=cgu'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schoolId: 'cgu', cafeterias: [], menus: [] });
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.nuni.tw/v1/auth/platform/realms/cgu/food/locations',
    expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }),
  );
});

it('forwards a platform session when the browser has one', async () => {
  fetcher.mockResolvedValueOnce(json({ locations: [] }));
  await handleCafeteriaCatalog(
    request('/api/cafeterias?schoolId=pu', sealCookie(SESSION_COOKIE, session)),
  );
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Platform ${session.sessionHandle}`);
});

it('keeps a missing shop as null instead of failing the page', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      locations: [{ id: 'jingyuan', name: '靜園餐廳', merchantMode: 'info_only' }],
    }),
  );
  const response = await handleCafeteriaDetail(
    request('/api/cafeterias/cafe-1?schoolId=pu'),
    'cafe-1',
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schoolId: 'pu', cafeteria: null, menus: [] });
});

it('loads the selected shop menu after listing locations', async () => {
  fetcher
    .mockResolvedValueOnce(
      json({
        locations: [{ id: 'stall', name: '校內咖啡店', merchantMode: 'info_only' }],
      }),
    )
    .mockResolvedValueOnce(
      json({
        location: { id: 'stall', name: '校內咖啡店' },
        items: [{ id: 'toast', name: '蔬菜吐司', price: 60 }],
      }),
    );
  const response = await handleCafeteriaDetail(
    request('/api/cafeterias/stall?schoolId=pu'),
    'stall',
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.cafeteria).toMatchObject({
    id: 'stall',
    name: '校內咖啡店',
    reviewStatus: 'unverified',
  });
  expect(body.menus).toEqual([
    expect.objectContaining({ id: 'toast', cafeteriaId: 'stall', price: 60 }),
  ]);
});

it('surfaces a backend failure instead of pretending the school has no shops', async () => {
  fetcher.mockResolvedValueOnce(json({ error: 'AUTH_REQUIRED' }, 401));
  const response = await handleCafeteriaCatalog(request('/api/cafeterias?schoolId=pu'));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' });
});
