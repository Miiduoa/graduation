// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handlePlatformAdmin, handlePlatformSocial, schoolDirectory } from './platform-gateway';
import { SESSION_COOKIE, openCookie, sealCookie, sessionContext } from './nuni/server';
const account = 'pa_33333333-3333-4333-8333-333333333333';
const fetcher = vi.fn();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const active = () => ({ sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 });
function req(
  path: string,
  options: { body?: object; auth?: boolean; context?: string; origin?: string } = {},
) {
  const session = active();
  return new NextRequest(`https://nuni.tw/api/${path}`, {
    method: options.body ? 'POST' : 'GET',
    headers: {
      ...(options.auth
        ? {
            Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
            'X-Campus-Session': options.context ?? sessionContext(session),
          }
        : {}),
      ...(options.body
        ? { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://nuni.tw' }
        : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}
beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('BFF_SESSION_SECRET', 'unit-test-session-secret-longer-than-32-characters');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('rejects absent sessions and stale account context before API requests', async () => {
  expect((await handlePlatformAdmin(req('platform-admin/schools'), ['schools'])).status).toBe(401);
  expect(
    (
      await handlePlatformAdmin(
        req('platform-admin/schools', { auth: true, context: 'b'.repeat(43) }),
        ['schools'],
      )
    ).status,
  ).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
});
it('checks live operator authority and never fetches private operations for a normal account', async () => {
  fetcher.mockResolvedValue(
    json({ authenticated: true, platformAccountId: account, isPlatformOperator: false }),
  );
  expect(
    (await handlePlatformAdmin(req('platform-admin/schools', { auth: true }), ['schools'])).status,
  ).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toMatch(/sessions\/current$/);
});
it('does not retain a prior operator grant across requests', async () => {
  fetcher
    .mockResolvedValueOnce(
      json({ authenticated: true, platformAccountId: account, isPlatformOperator: true }),
    )
    .mockResolvedValueOnce(json({ schools: [] }));
  expect(
    (await handlePlatformAdmin(req('platform-admin/schools?q=台灣&', { auth: true }), ['schools']))
      .status,
  ).toBe(200);
  expect(fetcher.mock.calls[1][0]).toBe(
    'https://api.nuni.tw/v1/auth/platform/ops/schools?q=%E5%8F%B0%E7%81%A3',
  );
  fetcher.mockResolvedValue(
    json({ authenticated: true, platformAccountId: account, isPlatformOperator: false }),
  );
  expect(
    (await handlePlatformAdmin(req('platform-admin/schools', { auth: true }), ['schools'])).status,
  ).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects cross-origin writes before login or operator lookup', async () => {
  expect(
    (
      await handlePlatformAdmin(
        req('platform-admin/login', {
          body: { email: 'operator@example.test', password: 'local-test-password' },
          origin: 'https://evil.test',
        }),
        ['login'],
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handlePlatformSocial(
        req('social/posts', { auth: true, body: {}, origin: 'https://evil.test' }),
        ['posts'],
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it('never replaces an existing browser account during password login', async () => {
  const response = await handlePlatformAdmin(
    req('platform-admin/login', {
      auth: true,
      body: { email: 'operator@example.test', password: 'local-test-password' },
    }),
    ['login'],
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'SIGN_OUT_REQUIRED' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('stores only an encrypted HttpOnly session and returns no password or bearer handle', async () => {
  fetcher.mockResolvedValue(
    json({
      sessionHandle: active().sessionHandle,
      expiresInSeconds: 3600,
      platformAccountId: account,
      isPlatformOperator: true,
    }),
  );
  const response = await handlePlatformAdmin(
    req('platform-admin/login', {
      body: { email: 'operator@example.test', password: 'local-test-password' },
    }),
    ['login'],
  );
  expect(response.status).toBe(200);
  const output = await response.text();
  expect(output).not.toContain('local-test-password');
  expect(output).not.toContain('ps_');
  const cookie = response.cookies.get(SESSION_COOKIE);
  expect(cookie?.httpOnly).toBe(true);
  expect(openCookie(SESSION_COOKIE, cookie?.value)?.sessionHandle).toBe(active().sessionHandle);
});
it('revokes an invalid upstream login session instead of installing it', async () => {
  fetcher
    .mockResolvedValueOnce(
      json({
        sessionHandle: active().sessionHandle,
        expiresInSeconds: 86400,
        platformAccountId: account,
        isPlatformOperator: true,
      }),
    )
    .mockResolvedValueOnce(json({ signedOut: true }));
  const response = await handlePlatformAdmin(
    req('platform-admin/login', {
      body: { email: 'operator@example.test', password: 'local-test-password' },
    }),
    ['login'],
  );
  expect(response.status).toBe(502);
  expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  expect(fetcher.mock.calls[1][0]).toMatch(/logout$/);
});
it('constrains social routes and query scope before forwarding', async () => {
  expect(
    (await handlePlatformSocial(req('social/ops/reports', { auth: true }), ['ops', 'reports']))
      .status,
  ).toBe(404);
  expect(
    (
      await handlePlatformSocial(req('social/feed?tenantId=pu&tenantId=other', { auth: true }), [
        'feed',
      ])
    ).status,
  ).toBe(400);
  expect(
    (
      await handlePlatformSocial(
        req('social/posts', { auth: true, body: { text: 'hello', authorId: account } }),
        ['posts'],
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it('forwards a scoped social request using only the sealed current session', async () => {
  fetcher.mockResolvedValue(json({ items: [], nextCursor: null }));
  const response = await handlePlatformSocial(req('social/feed?tenantId=pu', { auth: true }), [
    'feed',
  ]);
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toMatch(/social\/feed\?tenantId=pu$/);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Platform ${active().sessionHandle}`);
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
});
it('projects only actual public school metadata', async () => {
  fetcher.mockResolvedValue(
    json({
      schools: [{ tenantId: 'pu', displayName: '靜宜大學', status: 'open', internal: 'private' }],
    }),
  );
  const response = await schoolDirectory(req('schools'));
  expect(await response.json()).toEqual({
    schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }],
  });
});
