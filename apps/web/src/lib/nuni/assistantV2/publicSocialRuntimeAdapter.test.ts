// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from './adapter';
import { withOperationSignal } from './operation';

const schoolId = 'pu';
const account = 'pa_11111111-1111-4111-8111-111111111111';
const otherAccount = 'pa_22222222-2222-4222-8222-222222222222';
const session = { sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: Date.now() + 3600000 };
const principal = (platformAccountId = account) => ({ authenticated: true, platformAccountId, isPlatformOperator: false });
const feed = (tenantId = schoolId) => ({ items: [{ id: 'post-a', tenantId, tenantName: '靜宜大學',
  communityId: 'public-a', communityName: '公開交流', text: '週末讀書會',
  author: { displayName: '同學', isSelf: false }, publishedAt: '2026-11-17T07:00:00.000000Z', version: 1 }], nextCursor: null });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', vi.fn(async input => String(input).endsWith('/sessions/current')
    ? Response.json(principal()) : Response.json(feed())));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('public-social verified production adapter', () => {
  it('requires a verified principal and uses the same Platform session for an exact-school GET', async () => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await expect(source.adapter.publicSocial!({ limit: 2 })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetch).not.toHaveBeenCalled();
    await source.principal();
    await expect(source.adapter.publicSocial!({ limit: 2 })).resolves.toMatchObject({
      schoolId, source: 'platform-public-social', query: { limit: 2 }, status: 'ready',
      items: [{ id: 'post-a', tenantId: schoolId, communityId: 'public-a' }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = vi.mocked(fetch).mock.calls[1];
    expect(url).toBe('https://api.nuni.tw/v1/auth/platform/social/feed?tenantId=pu&limit=2');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Platform ' + session.sessionHandle });
    expect(init).not.toHaveProperty('body');
    expect(JSON.stringify({ url, body: init?.body, credentials: init?.credentials })).not.toMatch(/Firebase|uid|Cookie|pa_|ps_/);
    expect(source.apiCalls()).toBe(2);
    expect(source.adapter.remainingApiCalls!()).toBe(10);
  });

  it('rejects caller-controlled scopes and filters before using an API call', async () => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    for (const input of [{ limit: 6 }, { tenantId: 'foreign' }, { schoolId: 'foreign' }, { cursor: 'old' }, { board: 'private' }])
      await expect(source.adapter.publicSocial!(input as never)).rejects.toMatchObject({ code: 'PUBLIC_SOCIAL_INVALID_INPUT' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(source.apiCalls()).toBe(1);
  });

  it.each([
    [401, 'PLATFORM_SESSION_INVALID'],
    [403, 'PLATFORM_SOCIAL_ACCESS_DENIED'],
  ])('preserves HTTP %s without converting denial into an empty or unavailable feed', async (status, code) => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: code }, { status }));
    await expect(source.adapter.publicSocial!({})).rejects.toMatchObject({ status, code });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a source response for another school without fallback or salvage', async () => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(feed('nthu')));
    await expect(source.adapter.publicSocial!({})).rejects.toMatchObject({ code: 'INVALID_PUBLIC_SOCIAL_RESULT' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [404, 'NOT_CONNECTED'],
    [503, 'SOURCE_UNAVAILABLE'],
  ])('keeps HTTP %s source availability separate from a successful empty feed', async (status, unavailable) => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'UPSTREAM_UNAVAILABLE' }, { status }));
    await expect(source.adapter.publicSocial!({})).resolves.toMatchObject({
      schoolId, status: 'unavailable', unavailable, items: [], nextCursor: null, partial: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('counts source reads in the existing request budget and refuses the next network call', async () => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    for (let index = 0; index < 11; index++) await source.adapter.publicSocial!({ limit: 1 });
    expect(source.adapter.remainingApiCalls!()).toBe(0);
    await expect(source.adapter.publicSocial!({ limit: 1 })).rejects.toMatchObject({ code: 'API_BUDGET_EXCEEDED' });
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it('rejects an already cancelled request or operation before network access', async () => {
    const request = new AbortController();
    const source = createAdapter(session, schoolId, request.signal);
    await source.principal();
    request.abort();
    await expect(source.adapter.publicSocial!({})).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledOnce();
    const active = createAdapter(session, schoolId, new AbortController().signal);
    await active.principal();
    const operation = new AbortController();
    operation.abort();
    await expect(withOperationSignal(operation.signal, () => active.adapter.publicSocial!({}))).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['request', 'operation'] as const)('does not deliver a valid source reply arriving after %s cancellation', async scope => {
    const request = new AbortController();
    const operation = new AbortController();
    const source = createAdapter(session, schoolId, request.signal);
    await source.principal();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      (scope === 'request' ? request : operation).abort();
      return Response.json(feed());
    });
    await expect(withOperationSignal(operation.signal, () => source.adapter.publicSocial!({}))).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a late feed response when the verified principal changes during the read', async () => {
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    const started = deferred<void>();
    const response = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const pending = source.adapter.publicSocial!({});
    const rejected = expect(pending).rejects.toMatchObject({ status: 401, code: 'SESSION_CHANGED' });
    await started.promise;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(principal(otherAccount)));
    await source.principal();
    response.resolve(Response.json(feed()));
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
