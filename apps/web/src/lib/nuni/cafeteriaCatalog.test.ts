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

it('returns 400 when schoolId is missing and does not list every school', async () => {
  const response = await handleCafeteriaCatalog(request('/api/cafeterias'));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('returns 400 for invalid or unexpected school params for guests and signed-in users', async () => {
  const cookie = sealCookie(SESSION_COOKIE, session);
  for (const [path, cookieValue] of [
    ['/api/cafeterias?schoolId=', undefined],
    ['/api/cafeterias?schoolId=CGU', undefined],
    ['/api/cafeterias?schoolId=cgu&extra=1', undefined],
    ['/api/cafeterias?schoolId=', cookie],
    ['/api/cafeterias?schoolId=CGU', cookie],
    ['/api/cafeterias?schoolId=cgu&extra=1', cookie],
    ['/api/cafeterias/stall?schoolId=', undefined],
    ['/api/cafeterias/stall?schoolId=Not-A-Tenant', cookie],
    ['/api/cafeterias/stall?schoolId=cgu&extra=1', cookie],
  ] as const) {
    fetcher.mockReset();
    const response = await (path.includes('/stall')
      ? handleCafeteriaDetail(request(path, cookieValue), 'stall')
      : handleCafeteriaCatalog(request(path, cookieValue)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  }
});

it('falls back to the public NCKU dining list when the live catalog is empty', async () => {
  fetcher.mockResolvedValueOnce(json({ schoolId: 'ncku', cafeterias: [], menus: [] }));
  const response = await handleCafeteriaCatalog(request('/api/cafeterias?schoolId=ncku'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.schoolId).toBe('ncku');
  expect(body.menus).toEqual([]);
  expect(body.cafeterias.some((row: { name: string }) => row.name === '光復餐廳')).toBe(true);
  expect(body.cafeterias.every((row: { schoolId: string }) => row.schoolId === 'ncku')).toBe(true);
  expect(body.cafeterias.every((row: { merchantMode: string }) => row.merchantMode === 'info_only')).toBe(
    true,
  );
});

it('does not leak NTPU dining into another school empty catalog', async () => {
  fetcher.mockResolvedValueOnce(json({ schoolId: 'cgu', cafeterias: [], menus: [] }));
  const response = await handleCafeteriaCatalog(request('/api/cafeterias?schoolId=cgu'));
  const body = await response.json();
  expect(body.cafeterias).toEqual([]);
  expect(JSON.stringify(body)).not.toContain('優米自助餐');
});

it('reads the public school catalog when nobody is signed in', async () => {
  fetcher.mockResolvedValueOnce(json({ schoolId: 'cgu', cafeterias: [], menus: [] }));
  const response = await handleCafeteriaCatalog(request('/api/cafeterias?schoolId=cgu'));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schoolId: 'cgu', cafeterias: [], menus: [] });
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.nuni.tw/v1/public/schools/cgu/cafeterias',
    expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }),
  );
  expect(String(fetcher.mock.calls[0][0])).not.toContain('/v1/auth/platform/');
});

it('uses the requested schoolId for signed-in cross-school catalog without memberships fetch', async () => {
  fetcher.mockResolvedValueOnce(json({ schoolId: 'cgu', cafeterias: [], menus: [] }));
  const response = await handleCafeteriaCatalog(
    request('/api/cafeterias?schoolId=cgu', sealCookie(SESSION_COOKIE, session)),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schoolId: 'cgu', cafeterias: [], menus: [] });
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://api.nuni.tw/v1/public/schools/cgu/cafeterias');
  expect(fetcher.mock.calls.some((call) => String(call[0]).includes('/v1/auth/platform/'))).toBe(
    false,
  );
  expect(fetcher.mock.calls.some((call) => String(call[0]).includes('/memberships'))).toBe(false);
});

it('uses the requested schoolId for signed-in cross-school detail without memberships fetch', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'cgu',
      cafeterias: [{ id: 'stall', name: '校內咖啡店', merchantMode: 'info_only' }],
      menus: [{ id: 'toast', name: '蔬菜吐司', cafeteriaId: 'stall', price: 60 }],
    }),
  );
  const response = await handleCafeteriaDetail(
    request('/api/cafeterias/stall?schoolId=cgu', sealCookie(SESSION_COOKIE, session)),
    'stall',
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.schoolId).toBe('cgu');
  expect(body.cafeteria).toMatchObject({ id: 'stall', name: '校內咖啡店' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://api.nuni.tw/v1/public/schools/cgu/cafeterias');
  expect(fetcher.mock.calls.some((call) => String(call[0]).includes('/memberships'))).toBe(false);
});

it('keeps guest detail parity with the public catalog contract', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'pu',
      cafeterias: [{ id: 'stall', name: '校內咖啡店', merchantMode: 'info_only' }],
      menus: [{ id: 'toast', name: '蔬菜吐司', cafeteriaId: 'stall', price: 60 }],
    }),
  );
  const response = await handleCafeteriaDetail(
    request('/api/cafeterias/stall?schoolId=pu'),
    'stall',
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  const body = await response.json();
  expect(body.schoolId).toBe('pu');
  expect(body.cafeteria).toMatchObject({
    id: 'stall',
    name: '校內咖啡店',
    reviewStatus: 'unverified',
  });
  expect(body.menus).toEqual([
    expect.objectContaining({ id: 'toast', cafeteriaId: 'stall', price: 60 }),
  ]);
  expect(String(fetcher.mock.calls[0][0])).not.toContain('/v1/auth/platform/');
});

it('keeps a missing shop as null instead of failing the page', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'pu',
      cafeterias: [{ id: 'jingyuan', name: '靜園餐廳', merchantMode: 'info_only' }],
      menus: [],
    }),
  );
  const response = await handleCafeteriaDetail(
    request('/api/cafeterias/cafe-1?schoolId=pu'),
    'cafe-1',
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schoolId: 'pu', cafeteria: null, menus: [] });
});

it('loads the selected shop menu from the public catalog', async () => {
  fetcher.mockResolvedValueOnce(
    json({
      schoolId: 'pu',
      cafeterias: [{ id: 'stall', name: '校內咖啡店', merchantMode: 'info_only' }],
      menus: [{ id: 'toast', name: '蔬菜吐司', cafeteriaId: 'stall', price: 60 }],
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
  expect(body.cafeteria).not.toHaveProperty('phone');
  expect(body.cafeteria).not.toHaveProperty('email');
  expect(body.cafeteria).not.toHaveProperty('contact');
  expect(body.cafeteria).not.toHaveProperty('reviewNote');
  expect(body.cafeteria).not.toHaveProperty('reviewer');
  expect(body.cafeteria).not.toHaveProperty('orders');
  expect(body.cafeteria).not.toHaveProperty('revenue');
});

it('surfaces a backend failure instead of pretending the school has no shops', async () => {
  fetcher.mockResolvedValueOnce(json({ error: 'AUTH_REQUIRED' }, 401));
  const response = await handleCafeteriaCatalog(request('/api/cafeterias?schoolId=pu'));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' });
});

it('rejects a missing schoolId for signed-in catalog and detail the same as guests', async () => {
  const cookie = sealCookie(SESSION_COOKIE, session);
  for (const response of [
    await handleCafeteriaCatalog(request('/api/cafeterias', cookie)),
    await handleCafeteriaDetail(request('/api/cafeterias/stall', cookie), 'stall'),
  ]) {
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'INVALID_INPUT' });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
