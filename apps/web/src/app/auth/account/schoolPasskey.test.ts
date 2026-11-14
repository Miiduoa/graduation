import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_SOURCE_KEY, signInWithPasskey } from './legacyLogin';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it('keeps the school session established by the passkey when another platform account is present', async () => {
  class Assertion {
    clientDataJSON = new Uint8Array([1]).buffer;
    authenticatorData = new Uint8Array([2]).buffer;
    signature = new Uint8Array([3]).buffer;
  }
  class Credential {
    id = 'school-passkey';
    response = new Assertion();
  }
  vi.stubGlobal('AuthenticatorAssertionResponse', Assertion);
  vi.stubGlobal('PublicKeyCredential', Credential);
  vi.stubGlobal('navigator', { credentials: { get: async () => new Credential() } });
  const replace = vi.fn();
  vi.stubGlobal('location', { origin: 'https://nuni.tw', replace });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/auth/account/token') {
      const grant = JSON.parse(String(init?.body)).grantType;
      return Response.json(
        grant === 'passkey-challenge'
          ? { challengeId: 'challenge-id', publicKey: { challenge: 'AQ', rpId: 'nuni.tw' } }
          : { authenticated: true, expiresIn: 3600 },
      );
    }
    if (url === '/auth/platform/session') {
      return Response.json({ hasSchoolIssuedRole: true, hasApprovedMerchant: true });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);

  await signInWithPasskey('school-1', '/teacher?token=private');

  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/auth/account/token',
    '/auth/account/token',
  ]);
  expect(sessionStorage.getItem(AUTH_SOURCE_KEY)).toBe('campus-account');
  expect(replace).toHaveBeenCalledWith('/teacher');
});
