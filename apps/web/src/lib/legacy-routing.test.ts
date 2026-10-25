// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import { proxy } from '../proxy';
import { LOGIN_COOKIE, sealCookie } from './nuni/server';
import {
  ACCOUNT_ENTRY_PATH,
  LEGACY_ENDPOINT_PATHS,
  LEGACY_LOGIN_CALLBACK_PATHS,
  LEGACY_ORIGIN,
  legacyEnabled,
  legacyHtmlRedirects,
  legacyRewrites,
} from './legacy-routing';

afterEach(() => vi.unstubAllEnvs());

const PINNED_MANIFEST = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../deploy/nuni-web-legacy/fixtures/pinned-app-path-routes-manifest.json',
    ),
    'utf8',
  ),
) as Record<string, string>;

const CAMPUS_ONE_OWNED_ENDPOINTS = new Set([
  '/me',
  '/sitemap.xml',
  '/health/live',
  '/health/ready',
  '/icon',
  '/pwa-icon/[size]',
]);

function examplePath(route: string): string {
  return route
    .replaceAll('[[...path]]', 'nested')
    .replaceAll('[...path]', 'nested')
    .replace(/\[(\w+)\]/g, 'example');
}

function pinnedHtmlPaths(): string[] {
  return Object.entries(PINNED_MANIFEST)
    .filter(([key]) => key.endsWith('/page'))
    .map(([, route]) => route);
}

function pinnedEndpointPaths(): string[] {
  return Object.entries(PINNED_MANIFEST)
    .filter(([key]) => key.endsWith('/route'))
    .map(([, route]) => route);
}

function expectMatchedRewrite(response: Response, path: string, search = '') {
  const destination = new URL(response.headers.get('x-middleware-rewrite')!);
  expect(destination.hostname).toBe('127.0.0.1');
  expect(destination.pathname).toBe(path);
  expect(destination.search).toBe(search);
}

function redirectLocation(response: Response): string | null {
  const header = response.headers.get('location');
  return header ? new URL(header, 'https://nuni.tw').pathname : null;
}

function shouldRedirectHtml(path: string): boolean {
  if (LEGACY_LOGIN_CALLBACK_PATHS.includes(path)) return false;
  if (path === '/auth/find-school' || path === '/auth/platform' || path === '/auth/product-qa') {
    return true;
  }
  return (
    path.startsWith('/auth/platform/class-workspace/') ||
    [
      '/auth/platform/account',
      '/auth/platform/class-workspace-affiliation-review',
      '/auth/platform/membership',
      '/auth/platform/ops',
      '/auth/platform/school-apply',
      '/auth/platform/school-review',
    ].includes(path)
  );
}

async function responseFor(path: string, search = '') {
  return unstable_getResponseFromNextConfig({
    url: `https://nuni.tw${path}${search}`,
    nextConfig: {
      redirects: async () => legacyHtmlRedirects(),
      rewrites: async () => legacyRewrites(true),
    },
  });
}

describe('legacy route configuration', () => {
  it('keeps compatibility disabled unless explicitly enabled', () => {
    expect(legacyEnabled({})).toBe(false);
    expect(legacyEnabled({ CAMPUS_LEGACY_ENABLED: 'false' })).toBe(false);
    expect(legacyEnabled({ CAMPUS_LEGACY_ENABLED: 'true' })).toBe(true);
    expect(legacyRewrites(false)).toEqual({ beforeFiles: [], afterFiles: [], fallback: [] });
  });

  it('does not keep a catch-all HTML fallback', () => {
    const rules = legacyRewrites(true);
    expect(rules.fallback.some((rule) => rule.source === '/:path*')).toBe(false);
    expect(rules.beforeFiles.map((rule) => rule.source)).toEqual([
      '/.well-known/:path*',
      '/apple-app-site-association',
    ]);
    expect(
      rules.beforeFiles.some((rule) =>
        ['/privacy', '/terms', '/support', '/account-deletion'].some((path) =>
          rule.source.startsWith(path),
        ),
      ),
    ).toBe(false);
  });

  it.each([
    '/.well-known/apple-app-site-association',
    '/.well-known/assetlinks.json',
    '/apple-app-site-association',
  ])('preserves published association file %s using Next rewrite matching', async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `https://nuni.tw${path}?receipt=opaque-value`,
      nextConfig: {
        rewrites: async () => ({ ...legacyRewrites(true), fallback: [] }),
      },
    });
    expectMatchedRewrite(response, path, '?receipt=opaque-value');
    expect(response.headers.has('location')).toBe(false);
  });

  it.each(['/support', '/account-deletion', '/privacy', '/terms'])(
    'lets Campus One serve published legal page %s',
    async (path) => {
      const response = await responseFor(path, '?receipt=opaque-value');
      expect(getRewrittenUrl(response)).toBeNull();
      expect(redirectLocation(response)).toBeNull();
    },
  );

  it.each([
    '/auth/account/token',
    '/auth/account/callback',
    '/auth/platform/token',
    '/auth/platform/providers',
    '/_next/static/chunks/old-hash.js',
  ])(
    'retains missing endpoint %s only after Campus One filesystem routes and assets',
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
    const response = await responseFor(
      '/auth/account/token',
      '?destination=https%3A%2F%2Felsewhere.test&host=elsewhere.test',
    );
    expect(new URL(getRewrittenUrl(response)!).hostname).toBe('127.0.0.1');
    expect(new URL(getRewrittenUrl(response)!).pathname).toBe('/auth/account/token');
  });

  it('retains port 3001 in the runtime destination parser', () => {
    // Next's experimental response helper reconstructs origins from hostname and
    // drops ports. Check the actual runtime parser separately, without that helper.
    for (const rule of [...legacyRewrites(true).beforeFiles, ...legacyRewrites(true).fallback]) {
      const result = prepareDestination({
        destination: rule.destination,
        params: { path: ['legacy-path'], tenantId: 'tenant', service: 'service' },
        query: { returnUrl: 'https://elsewhere.test' },
        appendParamsToQuery: true,
      });
      expect(result.parsedDestination.hostname).toBe('127.0.0.1');
      expect(result.parsedDestination.port).toBe('3001');
      expect(result.parsedDestination.protocol).toBe('http:');
    }
  });
});

describe('pinned legacy HTML screens are not forwarded', () => {
  it('covers every /page route from the pinned legacy manifest', () => {
    expect(pinnedHtmlPaths().length).toBeGreaterThan(80);
    expect(pinnedHtmlPaths()).toContain('/auth/account');
    expect(pinnedHtmlPaths()).toContain('/auth/find-school');
  });

  it('does not rewrite or serve old HTML for pinned page routes', async () => {
    for (const route of pinnedHtmlPaths()) {
      const path = examplePath(route);
      const response = await responseFor(path);
      if (LEGACY_LOGIN_CALLBACK_PATHS.includes(route)) {
        expectMatchedRewrite(response, path);
        expect(redirectLocation(response)).toBeNull();
        continue;
      }
      expect(getRewrittenUrl(response), path).toBeNull();
      if (shouldRedirectHtml(route) || shouldRedirectHtml(path)) {
        expect(redirectLocation(response), path).toBe(ACCOUNT_ENTRY_PATH);
      } else {
        expect(redirectLocation(response), path).toBeNull();
      }
    }
  });

  it('does not forward leftover unmatched HTML such as /old-page', async () => {
    const response = await responseFor('/old-page');
    expect(getRewrittenUrl(response)).toBeNull();
    expect(redirectLocation(response)).toBeNull();
  });

  it.each(['/auth/find-school', '/auth/platform', '/auth/platform/class-workspace/join'])(
    'sends old auth shell %s to the new account page',
    async (path) => {
      const response = await responseFor(path);
      expect(getRewrittenUrl(response)).toBeNull();
      expect(redirectLocation(response)).toBe(ACCOUNT_ENTRY_PATH);
    },
  );
});

describe('pinned legacy endpoints stay on the allowlist', () => {
  it('forwards every pinned /route that Campus One does not own', async () => {
    const forwarded = new Set<string>();
    for (const route of pinnedEndpointPaths()) {
      if (CAMPUS_ONE_OWNED_ENDPOINTS.has(route)) continue;
      const path = examplePath(route);
      const response = await responseFor(path);
      expect(getRewrittenUrl(response), path).not.toBeNull();
      expectMatchedRewrite(response, path);
      forwarded.add(route);
    }
    expect(forwarded.size).toBeGreaterThan(20);
    expect([...CAMPUS_ONE_OWNED_ENDPOINTS]).toEqual(
      pinnedEndpointPaths().filter((route) => CAMPUS_ONE_OWNED_ENDPOINTS.has(route)),
    );
  });

  it('does not steal Campus One-owned endpoints', async () => {
    for (const route of CAMPUS_ONE_OWNED_ENDPOINTS) {
      const path = examplePath(route);
      const response = await responseFor(path);
      expect(getRewrittenUrl(response), path).toBeNull();
    }
  });

  it('keeps optional catch-all API roots, not the HTML shells with similar names', async () => {
    const response = await responseFor('/auth/platform/class-workspaces');
    expectMatchedRewrite(response, '/auth/platform/class-workspaces');
    const html = await responseFor('/auth/platform/class-workspace/join');
    expect(getRewrittenUrl(html)).toBeNull();
    expect(redirectLocation(html)).toBe(ACCOUNT_ENTRY_PATH);
  });

  it('lists only endpoint and callback sources in the fallback rewrite table', () => {
    const sources = new Set(legacyRewrites(true).fallback.map((rule) => rule.source));
    for (const path of LEGACY_LOGIN_CALLBACK_PATHS) expect(sources.has(path)).toBe(true);
    for (const path of LEGACY_ENDPOINT_PATHS) expect(sources.has(path)).toBe(true);
    expect(sources.has('/auth/account')).toBe(false);
    expect(sources.has('/auth/find-school')).toBe(false);
    expect(sources.has('/privacy/:path*')).toBe(false);
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
