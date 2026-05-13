/**
 * 靜宜蓋夏圖書館 WebPac（HyLib Next）— 館藏查詢 Client
 *
 * 與 `puDirectScraper.ts` 相同：**React Native 無法讀取 Set-Cookie**，不得自行拼 `Cookie:`；
 * 一律使用 `credentials: 'include'`，由 iOS／Android **原生 Cookie Jar** 附帶 HYSESSION 等，
 * 再從搜尋頁 HTML 取 `csrf-token` 後呼叫 `/api/HyLibWS/graphql`。
 *
 * 官方站台：https://webpacx.lib.pu.edu.tw/
 *
 * 限制：
 * - Web 版 Expo：無可靠的第三方 Cookie，略過直連（與課綱查詢相同）。
 * - **已登入**且設定 **`EXPO_PUBLIC_LIBRARY_OPAC_PROXY_URL`**（Cloudflare Worker）時可嘗試代理；若館方阻擋資料中心 IP 仍會失敗。
 * - API 若 **HTTP 403**：請用館藏畫面「**App 內官方搜尋頁**」（WebView）或外部瀏覽器，與官網行為一致。
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getAuthInstance } from '../firebase';
import {
  buildLibraryOpacHomeUrl,
  buildLibrarySearchUrl,
  getLibraryOpacBaseUrl,
} from './libraryOpacClient';

const GRAPHQL_PATH = '/api/HyLibWS/graphql';

/** 與官網網址列 query 一致（見 Next search 頁） */
export const OPAC_SEARCH_FIELDS = [
  { key: 'FullText', label: '全文' },
  { key: 'Title', label: '題名' },
  { key: 'Author', label: '作者' },
  { key: 'ISBN', label: 'ISBN' },
  { key: 'Publisher', label: '出版者' },
  { key: 'Subject', label: '主題／標題' },
] as const;

export type OpacSearchFieldKey = (typeof OPAC_SEARCH_FIELDS)[number]['key'];

export type OpacSearchHit = {
  sid: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
};

export type OpacSearchResult = {
  hits: OpacSearchHit[];
  rawTotalHint?: number;
  hyftdToken?: string | null;
  source: 'live' | 'skipped_web';
  error?: string;
};

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
  'X-Requested-With': 'XMLHttpRequest',
  Origin: new URL(getLibraryOpacBaseUrl()).origin,
};

function shouldSkipDirectOpacFetch(): boolean {
  return Platform.OS === 'web';
}

export function clearOpacSession(): void {
  /* 預留：原生 Cookie 無法由 JS 清除；重新暖機即可換 csrf。 */
}

function extractCsrf(html: string): string | null {
  const m = html.match(/csrf-token["\s]*content="([^"]+)"/i);
  return m?.[1]?.trim() ?? null;
}

/** HyLib WebPac search GraphQL（欄位依官方 schema；若改版請對照網頁請求） */
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

function pickStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function normalizeHit(raw: Record<string, unknown>): OpacSearchHit | null {
  const sidRaw = raw.sid ?? raw.biblioId ?? raw.id;
  const sid = pickStr(sidRaw);
  if (!sid) return null;
  const title = pickStr(raw.marcTitle ?? raw.title ?? raw.bookTitle ?? raw.mainTitle);
  return {
    sid,
    title: title || '（無題名）',
    author: pickStr(raw.author ?? raw.marcAuthor),
    publisher: pickStr(raw.publisher),
    year: pickStr(raw.publishYear ?? raw.year),
  };
}

function normalizeSearchPayload(json: any): {
  hits: OpacSearchHit[];
  hyftdToken?: string | null;
  emptyConfirmed: boolean;
} {
  const searchNode = json?.data?.search ?? json?.data?.Search;
  const hyftdToken = searchNode?.hyftdToken ?? null;
  if (searchNode == null) {
    return { hits: [], hyftdToken, emptyConfirmed: false };
  }
  const listRaw = searchNode?.bookList ?? searchNode?.books ?? searchNode?.items;
  if (!Array.isArray(listRaw)) {
    return { hits: [], hyftdToken, emptyConfirmed: false };
  }
  const hits: OpacSearchHit[] = [];
  for (const row of listRaw) {
    if (row && typeof row === 'object') {
      const h = normalizeHit(row as Record<string, unknown>);
      if (h) hits.push(h);
    }
  }
  return { hits, hyftdToken, emptyConfirmed: true };
}

export function buildSearchForm(keyword: string, field: OpacSearchFieldKey): Record<string, unknown> {
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

export function buildLibraryBookDetailUrl(sid: string): string {
  const origin = new URL(getLibraryOpacBaseUrl()).origin;
  return `${origin}/bookDetail?id=${encodeURIComponent(sid)}`;
}

/**
 * 先 GET 首頁再 GET 搜尋頁，讓原生 Cookie Jar 建立連線；
 * 回傳 HTML 內 csrf-token。
 */
async function fetchCsrfAfterCookieWarmup(signal?: AbortSignal): Promise<string | null> {
  const base = getLibraryOpacBaseUrl();
  const origin = base.replace(/\/+$/, '');

  const hHome = { ...COMMON_HEADERS, Referer: base };

  let res = await fetch(base, {
    method: 'GET',
    headers: hHome,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  await res.text().catch(() => '');

  const searchUrl = `${origin}/search?q=`;
  res = await fetch(searchUrl, {
    method: 'GET',
    headers: { ...COMMON_HEADERS, Referer: base },
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  const html = await res.text();
  return extractCsrf(html);
}

async function postGraphqlSearch(
  keyword: string,
  field: OpacSearchFieldKey,
  csrf: string,
  signal?: AbortSignal,
): Promise<Response> {
  const variables = { searchForm: buildSearchForm(keyword.trim(), field) };
  const body = JSON.stringify({
    operationName: 'campusAppSearch',
    query: SEARCH_QUERY,
    variables,
  });

  const url = new URL(GRAPHQL_PATH, getLibraryOpacBaseUrl()).toString();
  return fetch(url, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json',
      Referer: buildLibrarySearchUrl(keyword.trim()),
      'csrf-token': csrf,
      'x-apollo-operation-name': 'campusAppSearch',
    },
    body,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
}

function graphqlPayloadToResult(json: any): OpacSearchResult {
  if (json.errors?.length) {
    const msg = json.errors.map((e: any) => e?.message).filter(Boolean).join('；');
    return {
      hits: [],
      source: 'live',
      error: msg || 'GraphQL 查詢被拒絕',
    };
  }

  const { hits, hyftdToken, emptyConfirmed } = normalizeSearchPayload(json);
  let hint: string | undefined;
  if (hits.length === 0) {
    hint = emptyConfirmed
      ? '查無符合館藏。可換搜尋欄位、改用全文，或至瀏覽器使用進階檢索。'
      : '未取得書目列表（站台回應格式可能更新）。請改用下方「瀏覽器開啟」查看官方結果。';
  }
  return {
    hits,
    hyftdToken,
    source: 'live',
    error: hint,
  };
}

function parseFetchJsonResponse(_res: Response, text: string): OpacSearchResult {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return { hits: [], source: 'live', error: '館藏伺服器回應非 JSON，請改用瀏覽器查詢。' };
  }
  return graphqlPayloadToResult(json);
}

type ProxyLibraryOpacSearchData = {
  ok?: boolean;
  httpStatus?: number;
  reason?: string;
  graphql?: unknown;
  error?: string;
};

function getLibraryOpacWorkerBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExtra =
    typeof extra?.libraryOpacProxyUrl === 'string' ? extra.libraryOpacProxyUrl.trim() : '';
  if (fromExtra) return fromExtra;
  return String(process.env.EXPO_PUBLIC_LIBRARY_OPAC_PROXY_URL ?? '').trim();
}

/**
 * 已登入且 Worker URL 已設定時優先 POST Worker（Bearer ID token）；網路／403／csrf 等改走裝置直連。
 */
async function tryWorkerProxy(
  keyword: string,
  field: OpacSearchFieldKey,
  signal?: AbortSignal,
): Promise<{ used: boolean; result?: OpacSearchResult }> {
  const baseUrl = getLibraryOpacWorkerBaseUrl();
  if (!baseUrl) return { used: false };

  try {
    const auth = getAuthInstance().currentUser;
    if (!auth) return { used: false };

    const token = await auth.getIdToken();
    const url = `${baseUrl.replace(/\/+$/, '')}/`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keyword, field }),
      signal,
    });

    if (res.status === 401 || res.status === 403) return { used: false };

    const text = await res.text();
    let d: ProxyLibraryOpacSearchData;
    try {
      d = JSON.parse(text) as ProxyLibraryOpacSearchData;
    } catch {
      return { used: false };
    }

    if (!d || typeof d !== 'object') return { used: false };
    if (d.graphql == null || typeof d.graphql !== 'object') return { used: false };

    const parsed = graphqlPayloadToResult(d.graphql as any);
    if (d.ok) return { used: true, result: parsed };
    if (d.httpStatus === 403 || d.reason === 'csrf_missing') return { used: false };
    return { used: true, result: parsed };
  } catch {
    return { used: false };
  }
}

export async function searchOpacBiblios(
  keyword: string,
  field: OpacSearchFieldKey,
  options?: { signal?: AbortSignal },
): Promise<OpacSearchResult> {
  if (shouldSkipDirectOpacFetch()) {
    return {
      hits: [],
      source: 'skipped_web',
      error:
        '網頁版無法直接連線圖書館查詢 API（與課綱查詢相同限制）。請使用 iOS／Android App，或改以外部瀏覽器開啟 WebPac。',
    };
  }

  const q = keyword.trim();
  if (!q) {
    return { hits: [], source: 'live', error: '請輸入關鍵字' };
  }

  try {
    const proxied = await tryWorkerProxy(q, field, options?.signal);
    if (proxied.used && proxied.result) {
      return proxied.result;
    }

    const runOnce = async (): Promise<Response> => {
      const csrf = await fetchCsrfAfterCookieWarmup(options?.signal);
      if (!csrf) {
        throw new Error('csrf_missing');
      }
      return postGraphqlSearch(q, field, csrf, options?.signal);
    };

    let res = await runOnce();
    if (res.status === 403) {
      res = await runOnce();
    }

    if (res.status === 403) {
      return {
        hits: [],
        source: 'live',
        error:
          '館藏 API 回傳 HTTP 403：圖書館端常阻擋「非網頁」程式呼叫（與是否付費代理無關）。請在下方點「App 內官方搜尋頁」或「瀏覽器開啟」；原生列表需館方開放介面才可能恢復。',
      };
    }

    const text = await res.text();
    if (!res.ok) {
      return {
        hits: [],
        source: 'live',
        error: `館藏查詢失敗（HTTP ${res.status}）。請改用瀏覽器開啟 WebPac。`,
      };
    }

    return parseFetchJsonResponse(res, text);
  } catch (e: any) {
    if (e?.message === 'csrf_missing') {
      return {
        hits: [],
        source: 'live',
        error: '無法取得館藏系統安全憑證（csrf）。請稍後再試或改用瀏覽器開啟。',
      };
    }
    return {
      hits: [],
      source: 'live',
      error: e?.message ? String(e.message) : '連線失敗',
    };
  }
}

export function buildExternalFallbackUrl(keyword: string, field: OpacSearchFieldKey): string {
  const kw = keyword.trim();
  if (!kw) return buildLibraryOpacHomeUrl();
  const origin = new URL(getLibraryOpacBaseUrl()).origin;
  const qs = `searchField=${encodeURIComponent(field)}&searchInput=${encodeURIComponent(kw)}`;
  return `${origin}/search?${qs}`;
}
