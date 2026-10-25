import type { Redirect, Rewrite } from 'next/dist/lib/load-custom-routes';

export const LEGACY_ORIGIN = 'http://127.0.0.1:3001';
export const PLATFORM_CALLBACK_PATH = '/auth/platform/callback';
export const ACCOUNT_ENTRY_PATH = '/auth/account';

// Association files are not HTML screens. Keep them in beforeFiles so the
// published app-site links still resolve when Campus One has no copy.
const ASSOCIATION_PATHS = [
  '/.well-known/:path*',
  '/apple-app-site-association',
];

// Login-completion HTML that IdP redirects still hit. These are not browsable
// entry screens; dropping them would break school/Google return after consent.
export const LEGACY_LOGIN_CALLBACK_PATHS = [
  '/auth/account/callback',
  '/auth/callback',
  '/auth/platform/callback',
];

// Route handlers and hashed assets the current login buttons still call.
// HTML /page routes from the pinned legacy manifest are intentionally absent.
export const LEGACY_ENDPOINT_PATHS = [
  '/auth/account/token',
  '/auth/find-school/interest',
  '/auth/find-school/search',
  '/auth/logout',
  '/auth/oidc/token',
  '/auth/school',
  '/auth/session',
  '/auth/shell-role',
  '/auth/product-qa/availability',
  '/auth/product-qa/enter',
  '/auth/platform/callback/apple',
  '/auth/platform/merchant-applications',
  '/auth/platform/realms',
  '/auth/platform/realms/:tenantId/:service/:path*',
  '/auth/platform/school-issued-session',
  '/auth/platform/session',
  '/auth/platform/token',
  '/auth/platform/providers',
  '/auth/platform/class-workspace-affiliations/:path*',
  '/auth/platform/merchant-workspaces/:path*',
  '/auth/platform/ops-api/:path*',
  '/auth/platform/class-workspaces/:path*',
  '/auth/platform/school-applications/:path*',
  '/api/campus/:path*',
  '/privacy/deletion-status-access',
  '/support/merchant/interest',
  '/_next/static/:path*',
];

// Old auth HTML screens that the new entry still links to, plus sibling
// platform shells. Product screens such as /academics are left unmatched (404).
const LEGACY_HTML_REDIRECT_SOURCES = [
  '/auth/find-school',
  '/auth/platform',
  '/auth/platform/account',
  '/auth/platform/class-workspace/:path*',
  '/auth/platform/class-workspace-affiliation-review',
  '/auth/platform/membership',
  '/auth/platform/ops',
  '/auth/platform/school-apply',
  '/auth/platform/school-review',
  '/auth/product-qa',
];

export function legacyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CAMPUS_LEGACY_ENABLED === 'true';
}

function loopbackRewrite(source: string): Rewrite {
  return { source, destination: `${LEGACY_ORIGIN}${source}` };
}

export function legacyRewrites(enabled: boolean): {
  beforeFiles: Rewrite[];
  afterFiles: Rewrite[];
  fallback: Rewrite[];
} {
  if (!enabled) return { beforeFiles: [], afterFiles: [], fallback: [] };
  return {
    beforeFiles: ASSOCIATION_PATHS.map(loopbackRewrite),
    afterFiles: [],
    fallback: [...LEGACY_LOGIN_CALLBACK_PATHS, ...LEGACY_ENDPOINT_PATHS].map(loopbackRewrite),
  };
}

export function legacyHtmlRedirects(): Redirect[] {
  return LEGACY_HTML_REDIRECT_SOURCES.map((source) => ({
    source,
    destination: ACCOUNT_ENTRY_PATH,
    permanent: false,
  }));
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
