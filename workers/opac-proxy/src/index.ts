/**
 * PU Library HyLib WebPac GraphQL proxy for React Native (cookie/csrf warmup server-side).
 * Auth: Firebase ID token (Authorization: Bearer). Verified via Google JWKS (no Admin SDK).
 */
import * as jose from 'jose';

export interface Env {
  FIREBASE_PROJECT_ID: string;
}

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const OPAC_ORIGIN = 'https://webpacx.lib.pu.edu.tw';
const OPAC_HOME = `${OPAC_ORIGIN}/`;
const GRAPHQL_URL = `${OPAC_ORIGIN}/api/HyLibWS/graphql`;

const ALLOWED_FIELDS = new Set([
  'FullText',
  'Title',
  'Author',
  'ISBN',
  'Publisher',
  'Subject',
]);

const SEARCH_QUERY = `
query campusAppSearch($searchForm: SearchForm!) {
  search(Input: $searchForm) {
    hyftdToken
    bookList {
      sid
      marcTitle
      author
      publisher
      publishYear
    }
  }
}
`;

const COMMON_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
};

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...corsHeaders(),
    },
  });
}

function extractCsrf(html: string): string | null {
  const m = html.match(/csrf-token["\s]*content="([^"]+)"/i);
  return m?.[1]?.trim() ?? null;
}

function buildSearchForm(keyword: string, field: string): Record<string, unknown> {
  const q = keyword.trim();
  const qs = `searchField=${encodeURIComponent(field)}&searchInput=${encodeURIComponent(q)}`;
  return {
    queryString: qs,
    searchInput: [q],
    searchField: [field],
    searchCondition: ['and'],
    boolSearchCondition: 'and',
    keepSite: [],
    keepRoom: [],
    collection: [],
    tableLan: [],
  };
}

function mergeSetCookiesIntoJar(res: Response, jar: Record<string, string>): void {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const lines = typeof h.getSetCookie === 'function' ? h.getSetCookie() : [];
  for (const line of lines) {
    const pair = String(line).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (name) jar[name] = val;
  }
}

function cookieHeaderFromJar(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

type OpacOutcome =
  | {
      ok: boolean;
      httpStatus: number;
      graphql?: unknown;
      reason?: string;
      bodyPreview?: string;
    }
  | {
      ok: boolean;
      httpStatus: number;
      graphql: unknown;
    };

async function fetchOpacGraphqlJson(keyword: string, field: string): Promise<OpacOutcome> {
  const jar: Record<string, string> = {};

  let res = await fetch(OPAC_HOME, {
    redirect: 'follow',
    headers: {
      ...COMMON_FETCH_HEADERS,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      Referer: OPAC_HOME,
    },
  });
  mergeSetCookiesIntoJar(res, jar);
  await res.text();

  const searchEmptyUrl = `${OPAC_ORIGIN}/search?q=`;
  res = await fetch(searchEmptyUrl, {
    redirect: 'follow',
    headers: {
      ...COMMON_FETCH_HEADERS,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      Referer: OPAC_HOME,
      ...(Object.keys(jar).length ? { Cookie: cookieHeaderFromJar(jar) } : {}),
    },
  });
  mergeSetCookiesIntoJar(res, jar);
  const html = await res.text();
  const csrf = extractCsrf(html);
  if (!csrf) {
    return {
      ok: false,
      httpStatus: res.status,
      reason: 'csrf_missing',
      bodyPreview: html.slice(0, 240),
    };
  }

  const refererSearch = `${OPAC_ORIGIN}/search?searchField=${encodeURIComponent(field)}&searchInput=${encodeURIComponent(keyword.trim())}`;
  const payload = JSON.stringify({
    operationName: 'campusAppSearch',
    query: SEARCH_QUERY,
    variables: { searchForm: buildSearchForm(keyword, field) },
  });

  res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      ...COMMON_FETCH_HEADERS,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: OPAC_ORIGIN,
      Referer: refererSearch,
      'csrf-token': csrf,
      'x-apollo-operation-name': 'campusAppSearch',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieHeaderFromJar(jar),
    },
    body: payload,
  });
  mergeSetCookiesIntoJar(res, jar);

  const text = await res.text();
  let graphql: unknown;
  try {
    graphql = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      reason: 'invalid_json',
      bodyPreview: text.slice(0, 320),
    };
  }

  const gqlObj = graphql as { errors?: unknown[] };
  return {
    ok: res.ok && res.status < 400 && !gqlObj.errors?.length,
    httpStatus: res.status,
    graphql,
  };
}

let jwks: jose.JWTVerifyGetKey | null = null;

function getJwks(): jose.JWTVerifyGetKey {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(JWKS_URL));
  }
  return jwks;
}

async function verifyFirebaseIdToken(token: string, env: Env): Promise<void> {
  const pid = String(env.FIREBASE_PROJECT_ID ?? '').trim();
  if (!pid || pid === 'REPLACE_WITH_FIREBASE_PROJECT_ID') {
    throw new Error('misconfigured_project');
  }
  await jose.jwtVerify(token, getJwks(), {
    issuer: `https://securetoken.google.com/${pid}`,
    audience: pid,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'POST' || (url.pathname !== '/' && url.pathname !== '/search')) {
      return json({ error: 'not_found' }, 404);
    }

    const auth = request.headers.get('Authorization');
    const tokenMatch = auth?.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch?.[1]) {
      return json({ error: 'unauthorized', message: 'Missing Bearer token' }, 401);
    }

    try {
      await verifyFirebaseIdToken(tokenMatch[1].trim(), env);
    } catch {
      return json({ error: 'unauthorized', message: 'Invalid or expired token' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_argument', message: 'Body must be JSON' }, 400);
    }

    const data = body as { keyword?: string; field?: string };
    const keyword = String(data.keyword ?? '').trim();
    const fieldRaw = String(data.field ?? 'FullText').trim();

    if (!keyword || keyword.length > 200) {
      return json({ error: 'invalid_argument', message: 'keyword required (1–200 chars)' }, 400);
    }
    if (!ALLOWED_FIELDS.has(fieldRaw)) {
      return json({ error: 'invalid_argument', message: 'unsupported field' }, 400);
    }

    try {
      let outcome = await fetchOpacGraphqlJson(keyword, fieldRaw);
      if (!outcome.ok && outcome.httpStatus === 403) {
        outcome = await fetchOpacGraphqlJson(keyword, fieldRaw);
      }
      return json(outcome);
    } catch {
      return json({ ok: false, httpStatus: 0, reason: 'worker_fetch_failed' }, 500);
    }
  },
};
