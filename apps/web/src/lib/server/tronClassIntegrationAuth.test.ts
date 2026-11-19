// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../nuni/server';
import { authenticateTronClassActor, type TronClassIntegrationAuthDependencies } from './tronClassIntegrationAuth';

const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const principal = { authenticated: true, platformAccountId: 'pa_12345678-1234-1234-1234-123456789abc', isPlatformOperator: false };

function request(mode: 'web' | 'platform' | 'firebase' = 'web', method = 'POST') {
  return new NextRequest('https://nuni.tw/api/tronclass/binding', {
    method, headers: {
      Origin: 'https://nuni.tw', 'Sec-Fetch-Site': 'same-origin',
      ...(mode === 'web' ? { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`, 'X-Campus-Session': sessionContext(session) } : {}),
      ...(mode === 'platform' ? { Authorization: `Platform ${session.sessionHandle}` } : {}),
      ...(mode === 'firebase' ? { Authorization: 'Bearer firebase-token' } : {}),
    },
  });
}

function setup() {
  const verifyPlatformSession = vi.fn().mockResolvedValue(principal);
  const verifyIdToken = vi.fn().mockResolvedValue({ uid: 'pu-410123456' });
  const get = vi.fn().mockResolvedValue({ exists: true, data: () => ({ status: 'active' }) });
  const doc = vi.fn(() => ({ get }));
  const getAdmin = vi.fn(async () => ({ verifyIdToken, db: { doc } }));
  return { verifyPlatformSession, verifyIdToken, get, doc, getAdmin,
    dependencies: { verifyPlatformSession, getAdmin } satisfies TronClassIntegrationAuthDependencies };
}

beforeEach(() => {
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'tronclass-auth-test-only-secret-at-least-thirty-two');
});
afterEach(() => vi.unstubAllEnvs());

describe('TronClass actor resolution', () => {
  it.each(['web', 'platform'] as const)('accepts verified platform %s sessions without Firebase or school membership', async (mode) => {
    const { dependencies, verifyPlatformSession, getAdmin } = setup();
    expect(await authenticateTronClassActor(request(mode), dependencies)).toEqual({ ownerKey: `platform:${principal.platformAccountId}`, provider: 'platform' });
    expect(verifyPlatformSession).toHaveBeenCalledWith(expect.objectContaining({ sessionHandle: session.sessionHandle }));
    expect(getAdmin).not.toHaveBeenCalled();
  });

  it('uses Firebase revoked-token verification without requiring pu custom claims', async () => {
    const { dependencies, verifyIdToken, verifyPlatformSession, doc } = setup();
    expect(await authenticateTronClassActor(request('firebase'), dependencies)).toEqual({ ownerKey: 'firebase:pu-410123456', provider: 'firebase' });
    expect(verifyIdToken).toHaveBeenCalledWith('firebase-token', true);
    expect(doc).toHaveBeenCalledWith('users/pu-410123456');
    expect(verifyPlatformSession).not.toHaveBeenCalled();
  });

  it.each(['', 'Basic token', 'Platform invalid', 'Bearer a b'])('rejects malformed explicit authorization without using the browser account: %s', async (header) => {
    const { dependencies, verifyPlatformSession, verifyIdToken } = setup();
    const req = request();
    req.headers.set('Authorization', header);
    await expect(authenticateTronClassActor(req, dependencies)).rejects.toMatchObject({ status: 401 });
    expect(verifyPlatformSession).not.toHaveBeenCalled();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects cross-origin mutations and stale browser session contexts before verification', async () => {
    const { dependencies, verifyPlatformSession } = setup();
    const cross = request(); cross.headers.set('Origin', 'https://evil.example');
    await expect(authenticateTronClassActor(cross, dependencies)).rejects.toMatchObject({ status: 403 });
    const stale = request(); stale.headers.set('X-Campus-Session', 'old');
    await expect(authenticateTronClassActor(stale, dependencies)).rejects.toMatchObject({ status: 409 });
    expect(verifyPlatformSession).not.toHaveBeenCalled();
  });

  it('supports a same-origin browser GET without an Origin header and rejects cross-site GET', async () => {
    const { dependencies } = setup();
    const req = request('web', 'GET'); req.headers.delete('Origin');
    expect((await authenticateTronClassActor(req, dependencies)).provider).toBe('platform');
    req.headers.set('Sec-Fetch-Site', 'cross-site');
    await expect(authenticateTronClassActor(req, dependencies)).rejects.toMatchObject({ status: 403 });
  });

  it('does not treat a platform handle as proof of a current session', async () => {
    const { dependencies, verifyPlatformSession } = setup();
    verifyPlatformSession.mockRejectedValueOnce(new NuniError(401, 'SIGN_IN_REQUIRED'));
    await expect(authenticateTronClassActor(request('platform'), dependencies)).rejects.toMatchObject({ status: 401 });
    verifyPlatformSession.mockResolvedValueOnce({ ...principal, authenticated: false });
    await expect(authenticateTronClassActor(request('platform'), dependencies)).rejects.toMatchObject({ status: 503 });
  });

  it.each(['deleted', 'disabled', 'suspended', 'inactive'])('rejects disabled Firebase account status %s', async (status) => {
    const { dependencies, get } = setup();
    get.mockResolvedValue({ exists: true, data: () => ({ status }) });
    await expect(authenticateTronClassActor(request('firebase'), dependencies)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects account deletion and anonymous Firebase tokens', async () => {
    const { dependencies, get, verifyIdToken } = setup();
    get.mockResolvedValue({ exists: true, data: () => ({ accountDeletionInProgress: true }) });
    await expect(authenticateTronClassActor(request('firebase'), dependencies)).rejects.toMatchObject({ status: 403 });
    verifyIdToken.mockResolvedValue({ uid: 'anonymous', firebase: { sign_in_provider: 'anonymous' } });
    await expect(authenticateTronClassActor(request('firebase'), dependencies)).rejects.toMatchObject({ status: 401 });
  });

  it('returns a stable authentication error instead of leaking a verifier exception', async () => {
    const { dependencies, verifyIdToken } = setup();
    verifyIdToken.mockRejectedValue(new Error('raw private token and credentials'));
    await expect(authenticateTronClassActor(request('firebase'), dependencies)).rejects.toMatchObject({ status: 401, message: 'SIGN_IN_REQUIRED' });
  });
});
