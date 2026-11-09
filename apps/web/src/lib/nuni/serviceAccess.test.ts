// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { handlePlatformSocial } from '../platform-gateway';
import { SESSION_COOKIE, readSession, sealCookie, sessionContext } from './server';

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

it('verifies the live session and persists restrictions inside the encrypted session cookie', async () => {
  fetcher.mockResolvedValue(json({
    authenticated: true,
    platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    isPlatformOperator: false,
  }));
  const original = current();
  const first = await handleNuni(req('nuni/service-access', original), ['service-access']);
  expect(await first.json()).toEqual({ social: true, cloudAi: true, scope: 'web-session' });
  expect(first.headers.has('set-cookie')).toBe(false);
  const saved = await handleNuni(req('nuni/service-access', original, { social: false, cloudAi: false }), ['service-access']);
  expect(saved.status).toBe(200);
  const cookie = saved.cookies.get(SESSION_COOKIE)?.value;
  expect(cookie).toBeTruthy();
  const updated = readSession(new NextRequest('https://nuni.tw', {
    headers: { Cookie: SESSION_COOKIE + '=' + cookie },
  }));
  expect(updated?.restrictedServices).toEqual({ social: true, cloudAi: true });
  expect(updated?.expiresAt).toBe(original.expiresAt);
  expect(sessionContext(updated!)).toBe(sessionContext(original));
  const reread = await handleNuni(req('nuni/service-access', updated!), ['service-access']);
  expect(await reread.json()).toEqual({ social: false, cloudAi: false, scope: 'web-session' });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('blocks social reads and writes, and AI provider requests, before upstream', async () => {
  const session = { ...current(), restrictedServices: { social: true as const, cloudAi: true as const } };
  expect((await handlePlatformSocial(req('social/feed', session), ['feed'])).status).toBe(403);
  expect((await handlePlatformSocial(req('social/posts', session, { text: 'test' }), ['posts'])).status).toBe(403);
  expect((await handleNuni(req('nuni/assistant/capability', session), ['assistant', 'capability'])).status).toBe(403);
  expect((await handleNuni(req('nuni/assistant/ask', session, {}), ['assistant', 'ask'])).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
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

it('rejects malformed encrypted permissions as an invalid session', async () => {
  const invalid = { ...current(), restrictedServices: { social: false } };
  expect((await handleNuni(req('nuni/service-access', invalid as ReturnType<typeof current>), ['service-access'])).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
