// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { NuniLostFoundTransport } from '@campus/shared/src/nuniLostFound';
import { V2Error } from './contracts';
import { readLostFound } from './lostFoundAdapter';
import { createAdapter } from './adapter';

const schoolId = 'pu', now = Date.parse('2026-11-16T02:00:00.000Z');
const row = { id: 'plf_00000000-0000-4000-8000-000000000000', schoolId, type: 'found', title: '學生證',
  description: '已交服務台', category: 'cards', location: '圖書館', date: '2026-11-15', status: 'open',
  version: 1, isOwner: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), resolvedAt: null };

describe('original platform lost-found list adapter', () => {
  it('uses only the strict list transport with fixed school, bound and complete query', async () => {
    const transport = vi.fn<NuniLostFoundTransport>().mockResolvedValue({ schoolId, items: [row], nextCursor: 'next-page' });
    const result = await readLostFound(schoolId, { q: '學生證', type: 'found' }, transport, now);
    expect(transport).toHaveBeenCalledExactlyOnceWith('lost-found/list', { schoolId, q: '學生證', type: 'found', limit: 5, status: 'open' });
    expect(result).toMatchObject({ source: 'platform-lost-found', schoolId, status: 'ready', partial: true,
      checkedAt: '2026-11-16T02:00:00.000Z', query: { q: '學生證', type: 'found', limit: 5, status: 'open' }, items: [row] });
    expect(result.href).toBe('/lost-found?schoolId=pu&source=platform');
    expect(result).not.toHaveProperty('contactInfo');
  });

  it('rejects invalid arguments without calling any transport', async () => {
    const transport = vi.fn<NuniLostFoundTransport>();
    for (const raw of [{ limit: 6 }, { schoolId: 'foreign' }, { cursor: 'previous' }, { q: '' }])
      await expect(readLostFound(schoolId, raw, transport, now)).rejects.toMatchObject({ code: 'LOST_FOUND_INVALID_INPUT' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { schoolId: 'foreign', items: [row], nextCursor: null },
    { schoolId, items: [{ ...row, schoolId: 'foreign' }], nextCursor: null },
    { schoolId, items: [{ ...row, contactInfo: 'private@example.test' }], nextCursor: null },
    { schoolId, items: [{ ...row, type: 'lost' }], nextCursor: null },
    { schoolId, items: [row], nextCursor: 'contains space' },
  ])('does not salvage a corrupt or broader response into a successful result', async response => {
    const transport = vi.fn<NuniLostFoundTransport>().mockResolvedValue(response);
    await expect(readLostFound(schoolId, { type: 'found' }, transport, now)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    [new NuniError(404, 'NOT_FOUND'), 'NOT_CONNECTED'],
    [new V2Error(503, 'LOST_FOUND_UNAVAILABLE'), 'NOT_CONNECTED'],
    [new V2Error(503, 'UPSTREAM_UNAVAILABLE'), 'SOURCE_UNAVAILABLE'],
  ] as const)('reports source unavailability without asserting an empty list', async (error, unavailable) => {
    const transport = vi.fn<NuniLostFoundTransport>().mockRejectedValue(error);
    await expect(readLostFound(schoolId, {}, transport, now)).resolves.toMatchObject({
      status: 'unavailable', unavailable, items: [], nextCursor: null, partial: false,
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    new V2Error(401, 'UNAUTHENTICATED'), new V2Error(401, 'LOST_FOUND_UNAVAILABLE'),
    new V2Error(403, 'FORBIDDEN_SCOPE'), new V2Error(429, 'API_BUDGET_EXCEEDED'),
    new V2Error(503, 'TOOL_TIMEOUT'), new V2Error(502, 'INVALID_RESPONSE'),
    new DOMException('Request stopped', 'AbortError'),
  ])('preserves permission, cancellation, budget and integrity failures without retries', async error => {
    const transport = vi.fn<NuniLostFoundTransport>().mockRejectedValue(error);
    await expect(readLostFound(schoolId, {}, transport, now)).rejects.toBe(error);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('keeps explicitly owned posts isolated and has no fallback to another source', async () => {
    const transport = vi.fn<NuniLostFoundTransport>().mockResolvedValue({ schoolId, items: [row], nextCursor: null });
    await expect(readLostFound(schoolId, { mine: true }, transport, now)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(transport).toHaveBeenCalledExactlyOnceWith('lost-found/list', { schoolId, mine: true, limit: 5, status: 'all' });
  });
});

describe('verified production platform transport', () => {
  const sessionHandle = 'ps_' + 'a'.repeat(43);
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
    vi.stubGlobal('fetch', vi.fn(async input => String(input).endsWith('/sessions/current')
      ? Response.json({ authenticated: true, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', isPlatformOperator: false })
      : Response.json({ schoolId, items: [row], nextCursor: null })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('requires a verified principal and reuses the exact Platform session without school Firebase credentials', async () => {
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, new AbortController().signal);
    await expect(source.adapter.lostFound!({ q: '學生證' })).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
    await source.principal();
    await expect(source.adapter.lostFound!({ q: '學生證', type: 'found' })).resolves.toMatchObject({ status: 'ready', schoolId });
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe('https://api.nuni.tw/v1/auth/platform/lost-found/list');
    expect(calls[1][1]).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { Authorization: 'Platform ' + sessionHandle } });
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({ schoolId, q: '學生證', type: 'found', limit: 5, status: 'open' });
    expect(source.apiCalls()).toBe(2);
  });

  it('cancels before and after transport delivery instead of accepting a late source reply', async () => {
    const controller = new AbortController();
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, controller.signal);
    await source.principal();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      controller.abort();
      return Response.json({ schoolId, items: [row], nextCursor: null });
    });
    await expect(source.adapter.lostFound!({})).rejects.toBeDefined();
    const calls = vi.mocked(fetch).mock.calls.length;
    await expect(source.adapter.lostFound!({})).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it('counts the reader against the same bounded API budget as principal and other tools', async () => {
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, new AbortController().signal);
    await source.principal();
    for (let index = 0; index < 11; index++) await source.adapter.lostFound!({ limit: 1 });
    await expect(source.adapter.lostFound!({ limit: 1 })).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it('classifies a legacy route 401 using one same-session probe without repeating the list', async () => {
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, new AbortController().signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'AUTH_INVALID' }, { status: 401 }));
    await expect(source.adapter.lostFound!({ q: '學生證' })).resolves.toMatchObject({ status: 'unavailable', unavailable: 'NOT_CONNECTED' });
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
      'https://api.nuni.tw/v1/auth/platform/sessions/current',
      'https://api.nuni.tw/v1/auth/platform/lost-found/list',
      'https://api.nuni.tw/v1/auth/platform/sessions/current',
    ]);
    expect(vi.mocked(fetch).mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Platform ' + sessionHandle });
    expect(source.apiCalls()).toBe(3);
  });

  it.each([
    [401, { error: 'PLATFORM_SESSION_INVALID' }, 'PLATFORM_SESSION_INVALID'],
    [200, { authenticated: true, platformAccountId: 'pa_22222222-2222-4222-8222-222222222222', isPlatformOperator: false }, 'SESSION_CHANGED'],
  ] as const)('terminates the whole task when its probed identity is invalid or changes: %s', async (status, body, code) => {
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, new AbortController().signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'AUTH_INVALID' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json(body, { status }));
    await expect(source.adapter.lostFound!({})).rejects.toMatchObject({ status: 401, code });
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(source.adapter.lostFound!({})).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    [200, { authenticated: false }],
    [200, { authenticated: true, platformAccountId: 'malformed', isPlatformOperator: false }],
    [503, { error: 'UPSTREAM_UNAVAILABLE' }],
  ] as const)('does not assume a valid session when the legacy-route probe cannot be verified: %s', async (status, body) => {
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, new AbortController().signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'AUTH_INVALID' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json(body, { status }));
    await expect(source.adapter.lostFound!({})).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps cancellation and the shared API limit terminal while probing a legacy route', async () => {
    const controller = new AbortController();
    const source = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, controller.signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'AUTH_INVALID' }, { status: 401 }))
      .mockImplementationOnce(async () => { controller.abort(); return Response.json({ authenticated: true,
        platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', isPlatformOperator: false }); });
    await expect(source.adapter.lostFound!({})).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(3);

    const boundedSource = createAdapter({ sessionHandle, expiresAt: now + 3600000 }, schoolId, new AbortController().signal);
    await boundedSource.principal();
    for (let index = 0; index < 10; index++) await boundedSource.adapter.lostFound!({ limit: 1 });
    const before = vi.mocked(fetch).mock.calls.length;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'AUTH_INVALID' }, { status: 401 }));
    await expect(boundedSource.adapter.lostFound!({})).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
    expect(fetch).toHaveBeenCalledTimes(before + 1);
  });
});
