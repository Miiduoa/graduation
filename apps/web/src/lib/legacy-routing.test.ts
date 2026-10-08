// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import { proxy } from '../proxy';
import { LOGIN_COOKIE, sealCookie } from './nuni/server';
import { LEGACY_ORIGIN, legacyEnabled, legacyRewrites } from './legacy-routing';

afterEach(() => vi.unstubAllEnvs());

function expectMatchedRewrite(response: Response, path: string, search = '') {
  const destination = new URL(response.headers.get('x-middleware-rewrite')!);
  expect(destination.hostname).toBe('127.0.0.1');
  expect(destination.pathname).toBe(path);
  expect(destination.search).toBe(search);
}

describe('legacy route configuration', () => {
  it('keeps compatibility disabled unless explicitly enabled', () => {
    expect(legacyEnabled({})).toBe(false);
    expect(legacyEnabled({ CAMPUS_LEGACY_ENABLED: 'false' })).toBe(false);
    expect(legacyEnabled({ CAMPUS_LEGACY_ENABLED: 'true' })).toBe(true);
    expect(legacyRewrites(false)).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
  });

  it.each([
    '/support',
    '/support/merchant',
    '/account-deletion',
    '/privacy',
    '/privacy/deletion-status',
    '/privacy/deletion-status-access',
    '/terms',
    '/.well-known/apple-app-site-association',
    '/.well-known/assetlinks.json',
    '/apple-app-site-association',
  ])('preserves published route %s using Next rewrite matching', async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://nuni.tw${path}?receipt=opaque-value`,
      nextConfig: {
        rewrites: async () => ({ ...legacyRewrites(true), fallback: [] }),
      },
    });
    expectMatchedRewrite(response, path, '?receipt=opaque-value');
    expect(response.headers.has('location')).toBe(false);
  });

  it.each([
    '/auth/account',
    '/auth/platform/token',
    '/_next/static/chunks/old-hash.js',
    '/old-page',
  ])(
    'retains missing route %s only after Campus One filesystem routes and assets',
    async (path) => {
      const rules = legacyRewrites(true);
      expect(rules.afterFiles).toEqual([]);
      const primary = await unstable_getResponseFromNextConfig({
        url: `https://nuni.tw${path}`,
        nextConfig: { rewrites: async () => ({ ...rules, fallback: [] }) },
      });
      expect(getRewrittenUrl(primary)).toBeNull();
      const fallback = await unstable_getResponseFromNextConfig({
        url: `https://nuni.tw${path}`,
        nextConfig: { rewrites: async () => rules },
      });
      expectMatchedRewrite(fallback, path);
    },
  );

  it('does not allow a query parameter to change the fixed loopback destination', async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: 'https://nuni.tw/auth/account?destination=https%3A%2F%2Felsewhere.test&host=elsewhere.test',
      nextConfig: { rewrites: async () => legacyRewrites(true) },
    });
    expect(new URL(getRewrittenUrl(response)!).hostname).toBe('127.0.0.1');
  });

  it('retains port 3001 in the runtime destination parser', () => {
    // Next's experimental response helper reconstructs origins from hostname and
    // drops ports. Check the actual runtime parser separately, without that helper.
    for (const rule of [...legacyRewrites(true).beforeFiles, ...legacyRewrites(true).fallback]) {
      const result = prepareDestination({
        destination: rule.destination,
        params: { path: ['legacy-path'] },
        query: { returnUrl: 'https://elsewhere.test' },
        appendParamsToQuery: true,
      });
      expect(result.parsedDestination.hostname).toBe('127.0.0.1');
      expect(result.parsedDestination.port).toBe('3001');
      expect(result.parsedDestination.protocol).toBe('http:');
    }
  });
});

describe('shared OAuth callback ownership', () => {
  beforeEach(() => {
    vi.stubEnv('CAMPUS_LEGACY_ENABLED', 'true');
    vi.stubEnv('BFF_SESSION_SECRET', 'test-secret-with-more-than-thirty-two-characters');
  });

  function request(state: string, transactionState?: string, method = 'GET') {
    const cookie = transactionState
      ? `${LOGIN_COOKIE}=${sealCookie(LOGIN_COOKIE, { state: transactionState })}`
      : '';
    return new NextRequest(
      `https://nuni.tw/auth/platform/callback?state=${state}&code=opaque-code`,
      {
        method,
        headers: { Cookie: cookie, Origin: 'https://nuni.tw', Authorization: 'Bearer original' },
        ...(method === 'POST' ? { body: 'preserved=body' } : {}),
      },
    );
  }

  it('lets the new callback validate its own matching sealed transaction', () => {
    const response = proxy(request('new-state', 'new-state'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(getRewrittenUrl(response)).toBeNull();
  });

  it.each([undefined, 'stale-new-state'])(
    'routes an old callback to legacy despite an absent or stale new transaction',
    (transactionState) => {
      const response = proxy(request('old-state', transactionState));
      expect(getRewrittenUrl(response)).toBe(
        `${LEGACY_ORIGIN}/auth/platform/callback?state=old-state&code=opaque-code`,
      );
      expect(response.headers.has('location')).toBe(false);
      expect(response.headers.has('set-cookie')).toBe(false);
    },
  );

  it('does not consume POST bodies or replace Origin, Cookie or authorization headers', async () => {
    const incoming = request('old-state', undefined, 'POST');
    const headers = Array.from(incoming.headers);
    const response = proxy(incoming);
    expect(Array.from(incoming.headers)).toEqual(headers);
    expect(await incoming.text()).toBe('preserved=body');
    expect(response.headers.has('x-middleware-override-headers')).toBe(false);
    expect(new URL(getRewrittenUrl(response)!).origin).toBe(LEGACY_ORIGIN);
  });

  it('keeps existing application behavior when compatibility is disabled', () => {
    vi.stubEnv('CAMPUS_LEGACY_ENABLED', 'false');
    expect(proxy(request('old-state')).headers.get('x-middleware-next')).toBe('1');
  });
});
