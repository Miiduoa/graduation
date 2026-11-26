// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parseAccountLoginMethods } from './accountLoginMethods';
import { ACCOUNT_LOGIN_METHODS_PATH, handleAccountLoginMethods } from './accountLoginMethodsRoute';
import { SESSION_COOKIE, sealCookie, sessionContext, type PlatformSession } from './server';

const fetcher = vi.fn();
const handle = 'ps_' + 'a'.repeat(43);
const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const inventory = {
  platformAccountId: accountId,
  currentMethod: 'apple',
  methods: ['apple'],
  googleLink: 'available',
};
const currentSession = (): PlatformSession => ({
  sessionHandle: handle,
  expiresAt: Date.now() + 3600_000,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'true');
  vi.stubEnv('CAMPUS_BACKEND', '');
  vi.stubEnv('NUNI_GOOGLE_ACCOUNT_LINK_ENABLED', 'true');
  vi.stubEnv('PLATFORM_GOOGLE_LOGIN_ENABLED', 'true');
  vi.stubEnv('PLATFORM_GOOGLE_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'fixture-secret-longer-than-thirty-two-characters');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(
  options: {
    session?: PlatformSession | null;
    context?: string | null;
    path?: string;
    origin?: string;
    site?: string;
    method?: string;
    body?: string;
  } = {},
) {
  const session = options.session === undefined ? currentSession() : options.session;
  const context =
    options.context === undefined && session ? sessionContext(session) : options.context;
  return new NextRequest('https://nuni.tw' + (options.path ?? ACCOUNT_LOGIN_METHODS_PATH), {
    method: options.method ?? 'GET',
    headers: {
      ...(session ? { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` } : {}),
      ...(context ? { 'X-Campus-Session': context } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.site ? { 'Sec-Fetch-Site': options.site } : {}),
    },
    ...(options.body ? { body: options.body } : {}),
  });
}

function privateRead(response: Response) {
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('cache-control')).toContain('private');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('vary')).toContain('X-Campus-Session');
  expect(response.headers.has('set-cookie')).toBe(false);
}

describe('account login method contract', () => {
  it('projects only supported public fields, without provider identity material', () => {
    expect(
      parseAccountLoginMethods({
        ...inventory,
        credentialId: 'private-credential',
        providerSubject: 'private-subject',
        email: 'private@example.test',
        sessionHandle: handle,
        nonce: 'private-nonce',
      }),
    ).toEqual(inventory);
    expect(
      parseAccountLoginMethods({ ...inventory, methods: ['apple', 'google'], googleLink: 'linked' })
        .methods,
    ).toEqual(['google', 'apple']);
  });

  it.each([
    null,
    [],
    {},
    { ...inventory, platformAccountId: 'caller-account' },
    { ...inventory, currentMethod: 'school' },
    { ...inventory, currentMethod: 'google' },
    { ...inventory, methods: [] },
    { ...inventory, methods: ['apple', 'apple'] },
    { ...inventory, methods: ['apple', 'school'] },
    { ...inventory, methods: ['apple', 'google', 'apple'] },
    { ...inventory, googleLink: true },
    { ...inventory, googleLink: 'linked' },
    { ...inventory, methods: ['apple', 'google'], googleLink: 'available' },
    { ...inventory, methods: ['apple', 'google'], googleLink: 'reauth-required' },
    { ...inventory, methods: ['apple', 'google'], googleLink: 'restricted' },
  ])('rejects inconsistent or unsupported inventory %#', (value) => {
    expect(() => parseAccountLoginMethods(value)).toThrow('INVALID_RESPONSE');
  });

  it('can inspect an existing current Google method when management is unavailable', () => {
    const result = {
      ...inventory,
      currentMethod: 'google',
      methods: ['google'],
      googleLink: 'unavailable',
    };
    expect(parseAccountLoginMethods(result)).toEqual(result);
  });
});

describe('session-bound login method read', () => {
  it('stays default-off without upstream calls or authentication-cookie changes', async () => {
    vi.stubEnv('NUNI_GOOGLE_ACCOUNT_LINK_ENABLED', '');
    const response = await handleAccountLoginMethods(request());
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    privateRead(response);
  });

  it.each([
    [{ session: null }, 401],
    [{ context: null }, 409],
    [{ context: 'z'.repeat(43) }, 409],
    [{ origin: 'https://other.example.test' }, 403],
    [{ site: 'cross-site' }, 403],
    [{ path: ACCOUNT_LOGIN_METHODS_PATH + '?platformAccountId=other' }, 400],
    [{ path: ACCOUNT_LOGIN_METHODS_PATH + '?result=acknowledged' }, 400],
    [{ path: ACCOUNT_LOGIN_METHODS_PATH + '/other' }, 400],
    [{ method: 'POST', body: '{}' }, 405],
  ] as const)(
    'rejects unauthorized and caller-selected read targets (%o)',
    async (options, status) => {
      const response = await handleAccountLoginMethods(request(options));
      expect(response.status).toBe(status);
      expect(fetcher).not.toHaveBeenCalled();
      privateRead(response);
    },
  );

  it('refuses an expired or pending-logout session before reading', async () => {
    for (const session of [
      { ...currentSession(), pendingLogout: true as const },
      { ...currentSession(), expiresAt: Date.now() - 1 },
    ]) {
      expect((await handleAccountLoginMethods(request({ session }))).status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the current bearer once, projects inventory and binds it to the caller context', async () => {
    const session = currentSession();
    fetcher.mockResolvedValueOnce(
      json({ ...inventory, subject: 'private-subject', nonce: 'private-nonce' }),
    );
    const response = await handleAccountLoginMethods(request({ session }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...inventory, context: sessionContext(session) });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.nuni.tw/v1/auth/platform/account-links/google/status');
    expect(options).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json', Authorization: 'Platform ' + handle },
    });
    expect(options.body).toBeUndefined();
    privateRead(response);
  });

  it('keeps reads available when reauthentication is required for a new link', async () => {
    fetcher.mockResolvedValueOnce(json({ ...inventory, googleLink: 'reauth-required' }));
    const response = await handleAccountLoginMethods(request());
    expect(response.status).toBe(200);
    expect((await response.json()).googleLink).toBe('reauth-required');
  });

  it.each(['PLATFORM_GOOGLE_LOGIN_ENABLED', 'PLATFORM_GOOGLE_CLIENT_SECRET'])(
    'keeps inventory readable when %s is disabled',
    async (key) => {
      vi.stubEnv(key, '');
      fetcher.mockResolvedValueOnce(
        json({ ...inventory, methods: ['apple', 'google'], googleLink: 'linked' }),
      );
      const linked = await handleAccountLoginMethods(request());
      expect(linked.status).toBe(200);
      expect((await linked.json()).googleLink).toBe('linked');
      fetcher.mockResolvedValueOnce(json(inventory));
      const available = await handleAccountLoginMethods(request());
      expect(available.status).toBe(200);
      expect((await available.json()).googleLink).toBe('unavailable');
    },
  );

  it('returns an unavailable read without retrying or exposing upstream error content', async () => {
    fetcher.mockRejectedValueOnce(new Error('private-token-and-sql-details'));
    const failed = await handleAccountLoginMethods(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: 'LOGIN_METHODS_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledOnce();
    privateRead(failed);
  });

  it('propagates source session revocation as a fresh sign-in requirement', async () => {
    fetcher.mockResolvedValueOnce(
      json({ error: { code: 'GOOGLE_LINK_INVALID', message: 'private-identity' } }, 401),
    );
    const response = await handleAccountLoginMethods(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'SIGN_IN_REQUIRED' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects malformed or oversized source inventories without changing any link', async () => {
    fetcher.mockResolvedValueOnce(json({ ...inventory, googleLink: 'linked' }));
    expect((await handleAccountLoginMethods(request())).status).toBe(502);
    fetcher.mockResolvedValueOnce(json({ ...inventory, unexpected: 'x'.repeat(4096) }));
    expect((await handleAccountLoginMethods(request())).status).toBe(502);
    expect(fetcher.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });

  it('does not publish a read that outlasted the local session', async () => {
    vi.useFakeTimers();
    const session = { ...currentSession(), expiresAt: Date.now() + 1000 };
    fetcher.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 2000);
      return json(inventory);
    });
    const response = await handleAccountLoginMethods(request({ session }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'SIGN_IN_REQUIRED' });
    privateRead(response);
  });
});
