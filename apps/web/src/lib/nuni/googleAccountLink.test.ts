// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { startGoogleLink, finishGoogleLink, GOOGLE_LINK_COOKIE, GOOGLE_LINK_PAGE } from './googleAccountLink';
import { LOGIN_COOKIE, SESSION_COOKIE, sealCookie, openCookie, sessionContext } from './server';

const fetcher = vi.fn();
const handle = 'ps_' + 'a'.repeat(43);
const session = () => ({ sessionHandle: handle, expiresAt: Date.now() + 3600_000 });
const cookie = (name: string, value: object) => name + '=' + sealCookie(name, value);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const startResponse = {
  transactionId: 'gl_' + 'b'.repeat(43), nonce: 'c'.repeat(43),
  clientId: 'test.apps.googleusercontent.com', issuer: 'https://accounts.google.com',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token', expiresInSeconds: 300,
};
const idToken = 'fixture-not-a-real-google-token-'.repeat(2);
const accountId = 'pa_11111111-1111-4111-8111-111111111111';

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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function startRequest(options: { context?: string; origin?: string; confirm?: string; noSession?: boolean } = {}) {
  const value = session();
  return new NextRequest('https://nuni.tw' + GOOGLE_LINK_PAGE + '/start', {
    method: 'POST',
    headers: {
      Origin: options.origin ?? 'https://nuni.tw',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(options.noSession ? {} : { Cookie: cookie(SESSION_COOKIE, value) }),
    },
    body: new URLSearchParams({ context: options.context ?? sessionContext(value), confirm: options.confirm ?? 'link-google' }).toString(),
  });
}
function pending(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: startResponse.transactionId, nonce: startResponse.nonce, clientId: startResponse.clientId,
    state: 'd'.repeat(43), verifier: 'e'.repeat(43), context: sessionContext(session()),
    callback: 'https://nuni.tw' + GOOGLE_LINK_PAGE + '/callback', expiresAt: Date.now() + 240_000,
    ...overrides,
  };
}
function callback(query: URLSearchParams, tx = pending(), options: { switched?: boolean; logout?: boolean; ordinary?: boolean } = {}) {
  const value = { ...session(), ...(options.switched ? { sessionHandle: 'ps_' + 'z'.repeat(43) } : {}), ...(options.logout ? { pendingLogout: true } : {}) };
  return new NextRequest('https://nuni.tw' + GOOGLE_LINK_PAGE + '/callback?' + query.toString(), {
    headers: { Cookie: cookie(SESSION_COOKIE, value) + '; ' + cookie(options.ordinary ? LOGIN_COOKIE : GOOGLE_LINK_COOKIE, tx) },
  });
}
const validQuery = () => new URLSearchParams({ state: 'd'.repeat(43), code: 'one-time-code' });
function unchanged(response: Response) {
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.get('cache-control')).toContain('no-store');
}
function outcome(response: Response, expected: string) {
  expect(response.headers.get('location')).toBe('https://nuni.tw' + GOOGLE_LINK_PAGE + '?result=' + expected);
  unchanged(response);
}

describe('dedicated Google account linking', () => {
  it('is closed by default and does not touch existing authentication', async () => {
    vi.stubEnv('NUNI_GOOGLE_ACCOUNT_LINK_ENABLED', '');
    const start = await startGoogleLink(startRequest());
    const finish = await finishGoogleLink(callback(validQuery()));
    expect(start.status).toBe(404);
    expect(finish.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    unchanged(start); unchanged(finish);
  });
  it.each([
    [{ origin: 'https://other.example' }, 403, null],
    [{ context: 'z'.repeat(43) }, 303, 'reauth'],
    [{ confirm: 'no' }, 303, 'invalid'],
    [{ noSession: true }, 303, 'reauth'],
  ] as const)('rejects unauthorized or unconfirmed starts (%o)', async (options, status, expected) => {
    const response = await startGoogleLink(startRequest(options));
    expect(response.status).toBe(status);
    if (expected) outcome(response, expected);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses a separate encrypted transaction cookie, state, nonce, PKCE and fixed callback', async () => {
    fetcher.mockResolvedValueOnce(json(startResponse));
    const response = await startGoogleLink(startRequest());
    const url = new URL(response.headers.get('location')!);
    const raw = response.cookies.get(GOOGLE_LINK_COOKIE)!;
    const tx = openCookie(GOOGLE_LINK_COOKIE, raw.value)!;
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://nuni.tw' + GOOGLE_LINK_PAGE + '/callback');
    expect(url.searchParams.get('state')).toBe(tx.state);
    expect(url.searchParams.get('nonce')).toBe(startResponse.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(String(tx.verifier)).digest('base64url'));
    expect(tx.context).toBe(sessionContext(session()));
    expect(tx).not.toHaveProperty('sessionHandle');
    expect(raw.httpOnly).toBe(true);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(response.cookies.get(LOGIN_COOKIE)).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://api.nuni.tw/v1/auth/platform/account-links/google/start');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Platform ' + handle);
  });
  it('does not follow an upstream-supplied provider URL or retry a lost start', async () => {
    fetcher.mockResolvedValueOnce(json({ ...startResponse, authorizationEndpoint: 'https://other.example/auth' }));
    outcome(await startGoogleLink(startRequest()), 'unknown');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockReset().mockRejectedValueOnce(new TypeError('connection lost'));
    outcome(await startGoogleLink(startRequest()), 'unknown');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects callbacks from switched or signed-out sessions and ordinary login cookies without clearing a newer cookie', async () => {
    outcome(await finishGoogleLink(callback(validQuery(), pending(), { switched: true })), 'invalid');
    outcome(await finishGoogleLink(callback(validQuery(), pending(), { logout: true })), 'reauth');
    outcome(await finishGoogleLink(callback(validQuery(), pending(), { ordinary: true })), 'invalid');
    outcome(await finishGoogleLink(callback(validQuery(), pending({ expiresAt: Date.now() - 1000 }))), 'invalid');
    outcome(await finishGoogleLink(callback(new URLSearchParams('state=wrong&code=one'))), 'invalid');
    const duplicate = validQuery(); duplicate.append('state', 'd'.repeat(43));
    outcome(await finishGoogleLink(callback(duplicate)), 'invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the existing platform session for completion, never mints or replaces a session', async () => {
    fetcher.mockResolvedValueOnce(json({ id_token: idToken })).mockResolvedValueOnce(json({ status: 'linked', platformAccountId: accountId }));
    const response = await finishGoogleLink(callback(validQuery()));
    outcome(response, 'acknowledged');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://api.nuni.tw/v1/auth/platform/account-links/google/complete',
    ]);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(new URLSearchParams(fetcher.mock.calls[0][1].body).get('code_verifier')).toBe('e'.repeat(43));
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Platform ' + handle);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ transactionId: startResponse.transactionId, nonce: startResponse.nonce, idToken });
  });
  it('cancels only the matching provider-denied request and does not claim not-pending means cancelled', async () => {
    const query = new URLSearchParams({ state: 'd'.repeat(43), error: 'access_denied' });
    fetcher.mockResolvedValueOnce(json({ status: 'cancelled' })).mockResolvedValueOnce(json({ status: 'not-pending' }));
    outcome(await finishGoogleLink(callback(query)), 'cancelled');
    outcome(await finishGoogleLink(callback(query)), 'unknown');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(Array(2).fill('https://api.nuni.tw/v1/auth/platform/account-links/google/cancel'));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ transactionId: startResponse.transactionId, nonce: startResponse.nonce });
    query.append('code', 'unexpected');
    outcome(await finishGoogleLink(callback(query)), 'invalid');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry a token exchange or ambiguous completion', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('lost token response'));
    outcome(await finishGoogleLink(callback(validQuery())), 'unknown');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockReset().mockResolvedValueOnce(json({ id_token: idToken })).mockRejectedValueOnce(new TypeError('lost write response'));
    outcome(await finishGoogleLink(callback(validQuery())), 'unknown');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('handles account conflict without changing cookies or exposing identity data', async () => {
    fetcher.mockResolvedValueOnce(json({ id_token: idToken })).mockResolvedValueOnce(json({ error: { code: 'GOOGLE_LINK_CONFLICT', message: 'private details' } }, 409));
    outcome(await finishGoogleLink(callback(validQuery())), 'conflict');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
