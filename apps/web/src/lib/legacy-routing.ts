import type { Rewrite } from 'next/dist/lib/load-custom-routes';

export const LEGACY_ORIGIN = 'http://127.0.0.1:3001';
export const PLATFORM_CALLBACK_PATH = '/auth/platform/callback';

export function legacyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CAMPUS_LEGACY_ENABLED === 'true';
}

export function legacyRewrites(enabled: boolean): {
  beforeFiles: Rewrite[];
  afterFiles: Rewrite[];
  fallback: Rewrite[];
} {
  if (!enabled) return { beforeFiles: [], afterFiles: [], fallback: [] };
  const publishedPaths = [
    '/support/:path*',
    '/account-deletion/:path*',
    '/privacy/:path*',
    '/terms/:path*',
    '/.well-known/:path*',
    '/apple-app-site-association',
  ];
  return {
    beforeFiles: publishedPaths.map((source) => ({
      source,
      destination: `${LEGACY_ORIGIN}${source}`,
    })),
    afterFiles: [],
    // Existing Campus One routes and assets are resolved first. This retains the
    // old account endpoints, bookmarked pages and hashed assets in the same origin.
    fallback: [{ source: '/:path*', destination: `${LEGACY_ORIGIN}/:path*` }],
  };
}

export function isCampusOneCallback(
  queryState: string | null,
  transaction: Record<string, unknown> | null,
): boolean {
  // A stale new-login cookie must not capture an old login from another tab.
  // This only selects a handler; that handler still validates the whole transaction.
  return Boolean(queryState && transaction?.state === queryState);
}

export function legacyCallbackUrl(search: string): URL {
  const destination = new URL(PLATFORM_CALLBACK_PATH, LEGACY_ORIGIN);
  destination.search = search;
  return destination;
}
