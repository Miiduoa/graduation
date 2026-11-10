// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { handlePlatformSocial } from '../platform-gateway';
import { SESSION_COOKIE, readSession, sealCookie, sessionContext, platformServiceAccess, requirePlatformService, withPlatformServiceAccess } from './server';

const handle = 'ps_' + 'p'.repeat(43);
const current = () => ({ sessionHandle: handle, expiresAt: Date.now() + 3600_000 });
const fetcher = vi.fn();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function req(
  path: string,
  session: ReturnType<typeof current> & { restrictedServices?: { social?: true; cloudAi?: true } },
  post?: object,
  context = sessionContext(session),
  origin = 'https://nuni.tw',
) {
  return new NextRequest('https://nuni.tw/api/' + path, {
    method: post ? 'POST' : 'GET',
    headers: {
      Cookie: SESSION_COOKIE + '=' + sealCookie(SESSION_COOKIE, session),
      'X-Campus-Session': context,
      ...(post ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
    },
    ...(post ? { body: JSON.stringify(post) } : {}),
  });
}

beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', '');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'unit-test-platform-service-secret-longer-than-32');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const principal = {
  authenticated: true,
  platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  isPlatformOperator: false,
};

it.each([
  { social: false, cloudAi: true },
  { social: true, cloudAi: false },
  { social: false, cloudAi: false },
])('rejects a disable request %j without writing a cookie or changing access', async (input) => {
  fetcher.mockImplementation(async () => json(principal));
  const session = current();
  const saved = await handleNuni(req('nuni/service-access', session, input), ['service-access']);
  expect(saved.status).toBe(422);
  expect(await saved.json()).toEqual({ error: 'PLATFORM_SERVICE_ALWAYS_ENABLED' });
  expect(saved.headers.has('set-cookie')).toBe(false);
  const reread = await handleNuni(req('nuni/service-access', session), ['service-access']);
  expect(await reread.json()).toEqual({ social: true, cloudAi: true, scope: 'web-session' });
});

it.each([undefined, { social: true, cloudAi: true }, { social: false }, null, 'legacy', { unknown: true }])(
  'ignores missing and obsolete restrictions %j when reading and refreshing cookies', async (restrictedServices) => {
    fetcher.mockImplementation(async () => json(principal));
    const session = { ...current(), restrictedServices } as ReturnType<typeof current>;
    const read = readSession(req('nuni/service-access', session));
    expect(read).toEqual({ sessionHandle: session.sessionHandle, expiresAt: session.expiresAt });
    expect(read?.restrictedServices).toBeUndefined();
    expect(platformServiceAccess(session)).toEqual({ social: true, cloudAi: true });
    expect(() => requirePlatformService(session, 'social')).not.toThrow();
    expect(() => requirePlatformService(session, 'cloudAi')).not.toThrow();
    expect(withPlatformServiceAccess(session, { social: false, cloudAi: false })).toEqual(read);
    const response = await handleNuni(req('nuni/service-access', session), ['service-access']);
    expect(await response.json()).toEqual({ social: true, cloudAi: true, scope: 'web-session' });
    const saved = await handleNuni(req('nuni/service-access', session, { social: true, cloudAi: true }), ['service-access']);
    expect(saved.status).toBe(200);
    const cookie = saved.cookies.get(SESSION_COOKIE)?.value;
    expect(cookie).toBeTruthy();
    const updated = readSession(new NextRequest('https://nuni.tw', {
      headers: { Cookie: SESSION_COOKIE + '=' + cookie },
    }));
    expect(updated).toEqual(read);
  },
);

it('forwards social reads, writes, blocks and reports despite legacy restrictions', async () => {
  const session = { ...current(), restrictedServices: { social: true as const, cloudAi: true as const } };
  fetcher.mockImplementation(async () => json({ items: [] }));
  for (const path of ['feed', 'boards', 'blocks', 'reports']) {
    const response = await handlePlatformSocial(req('social/' + path, session), [path]);
    expect(response.status).toBe(200);
  }
  for (const path of ['posts', 'blocks', 'reports']) {
    const response = await handlePlatformSocial(req('social/' + path, session, {}), [path]);
    expect(response.status).toBe(200);
  }
  expect(fetcher).toHaveBeenCalledTimes(7);
});

it('forwards assistant capability and ask despite legacy restrictions', async () => {
  const session = { ...current(), restrictedServices: { cloudAi: true as const } };
  fetcher.mockImplementation(async () => json({ enabled: true, ready: true, simulation: false }));
  const capability = await handleNuni(req('nuni/assistant/capability', session), ['assistant', 'capability']);
  expect(capability.status).toBe(200);
  // An upstream error proves the request reached the provider rather than a preference gate.
  fetcher.mockImplementation(async () => json({ error: { code: 'PROVIDER_UNAVAILABLE' } }, 429));
  const ask = await handleNuni(req('nuni/assistant/ask', session, {
    schoolId: 'pu', intent: 'map', consent: true, confirmation: 'test',
  }), ['assistant', 'ask']);
  expect(ask.status).toBe(429);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects stale context, cross-origin, invalid fields and revoked upstream sessions', async () => {
  const session = current();
  expect((await handleNuni(req('nuni/service-access', session, { social: false, cloudAi: true }, 'other'), ['service-access'])).status).toBe(409);
  expect((await handleNuni(req('nuni/service-access', session, { social: false, cloudAi: true }, sessionContext(session), 'https://evil.test'), ['service-access'])).status).toBe(403);
  fetcher.mockResolvedValue(json({ authenticated: true, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', isPlatformOperator: false }));
  const invalid = await handleNuni(req('nuni/service-access', session, { social: true, cloudAi: false, role: 'admin' }), ['service-access']);
  expect(invalid.status).toBe(422);
  expect(invalid.headers.has('set-cookie')).toBe(false);
  fetcher.mockResolvedValue(json({ error: { code: 'AUTH_REQUIRED' } }, 401));
  const revoked = await handleNuni(req('nuni/service-access', session, { social: false, cloudAi: false }), ['service-access']);
  expect(revoked.status).toBe(401);
  expect(revoked.headers.has('set-cookie')).toBe(false);
});
