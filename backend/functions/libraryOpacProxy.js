'use strict';

/**
 * 館藏 WebPac GraphQL 代理（Firebase Callable）
 *
 * 校方站台對 App 直連可能 403；由 Cloud Functions（Node 可正確處理 Set-Cookie）
 * 代為暖機並呼叫 `/api/HyLibWS/graphql`。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const REGION = 'asia-east1';
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

const COMMON_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
};

function extractCsrf(html) {
  const m = html.match(/csrf-token["\s]*content="([^"]+)"/i);
  return m?.[1]?.trim() ?? null;
}

function buildSearchForm(keyword, field) {
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

/** @param {Record<string, string>} jar */
function mergeSetCookiesIntoJar(res, jar) {
  const headersAny = /** @type {any} */ (res.headers);
  const lines =
    typeof headersAny.getSetCookie === 'function' ? headersAny.getSetCookie() : [];
  for (const line of lines) {
    const pair = String(line).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (name) jar[name] = val;
  }
}

/** @param {Record<string, string>} jar */
function cookieHeaderFromJar(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * @param {string} keyword
 * @param {string} field
 */
async function fetchOpacGraphqlJson(keyword, field) {
  const jar = {};

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
  let graphql;
  try {
    graphql = JSON.parse(text);
  } catch {
    return {
      ok: false,
      httpStatus: res.status,
      reason: 'invalid_json',
      bodyPreview: text.slice(0, 320),
    };
  }

  return {
    ok: res.ok && res.status < 400 && !graphql.errors?.length,
    httpStatus: res.status,
    graphql,
  };
}

exports.proxyLibraryOpacSearch = onCall(
  {
    region: REGION,
    timeoutSeconds: 45,
    memory: '256MiB',
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', '請先登入後使用雲端館藏查詢');
    }

    const keyword = String(request.data?.keyword ?? '').trim();
    const fieldRaw = String(request.data?.field ?? 'FullText').trim();
    if (!keyword || keyword.length > 200) {
      throw new HttpsError('invalid-argument', '請提供合法關鍵字（1～200 字）');
    }
    if (!ALLOWED_FIELDS.has(fieldRaw)) {
      throw new HttpsError('invalid-argument', '不支援的搜尋欄位');
    }

    try {
      let outcome = await fetchOpacGraphqlJson(keyword, fieldRaw);
      if (!outcome.ok && outcome.httpStatus === 403) {
        outcome = await fetchOpacGraphqlJson(keyword, fieldRaw);
      }
      return outcome;
    } catch (err) {
      console.error('[proxyLibraryOpacSearch]', err);
      throw new HttpsError('internal', '館藏代理查詢失敗');
    }
  },
);
