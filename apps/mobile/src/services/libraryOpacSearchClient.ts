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
 * - **已登入**且設定 **`EXPO_PUBLIC_LIBRARY_OPAC_PROXY_URL`**（Cloudflare Worker）時優先走 Worker（伺服端 Cookie／csrf）；失敗或未設定則裝置直連。
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
  coverUrl?: string;
  dataType?: string;
  availability?: string;
  isAvailable?: boolean;
  canReserve?: boolean;
  lendCount?: string;
  sourceName?: string;
  externalUrl?: string;
  raw?: Record<string, string>;
};

export type OpacSearchResult = {
  hits: OpacSearchHit[];
  rawTotalHint?: number;
  hyftdToken?: string | null;
  source: 'live' | 'skipped_web';
  error?: string;
};

export type OpacBookDetailField = {
  key: string;
  label: string;
  value: string;
  url?: string;
};

export type OpacBookDetail = {
  sid: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  coverUrl?: string;
  dataType?: string;
  availability?: string;
  isAvailable?: boolean;
  canReserve?: boolean;
  lendCount?: string;
  sourceName?: string;
  fields: OpacBookDetailField[];
  marc?: string;
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

function isTransientOpacStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export function clearOpacSession(): void {
  /* 預留：原生 Cookie 無法由 JS 清除；重新暖機即可換 csrf。 */
}

function extractCsrf(html: string): string | null {
  const m = html.match(/csrf-token["\s]*content="([^"]+)"/i);
  return m?.[1]?.trim() ?? null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  const obj = asObject(error);
  const msg = obj?.message;
  return msg == null ? undefined : String(msg);
}

function graphqlErrorsMessage(errors: unknown): string {
  if (!Array.isArray(errors)) return '';
  return errors
    .map((item) => pickStr(asObject(item)?.message))
    .filter(Boolean)
    .join('；');
}

/** HyLib WebPac search GraphQL（欄位依官方 schema；若改版請對照網頁請求） */
const SEARCH_QUERY = `
query search($searchForm: SearchForm) {
  search(Input: $searchForm) {
    display {
      field
      name
      type
    }
    list {
      values {
        ref {
          key
          value
        }
      }
    }
    info {
      total
      count
      limit
      pageNo
      totalPage
      hyftdToken
      searchToken
    }
  }
}
`;

const BOOK_DETAIL_QUERY = `
query bookdetail($marcId: Int) {
  getBookDetail(id: $marcId) {
    marc
    view {
      display {
        field
        name
        position
        type
      }
      list {
        values {
          ref {
            key
            value
          }
        }
      }
    }
    values {
      key
      value
    }
  }
}
`;

const OPAC_COMMON_LABELS: Record<string, string> = {
  'common:webpac.dataType.book': '一般圖書',
  'common:webpac.dataType.ebook': '電子書',
  'common:webpac.dataType.journal': '期刊',
  'common:webpac.dataType.thesis': '論文',
  'common:webpac.dataType.audioVisual': '視聽資料',
};

const DETAIL_FIELD_LABELS: Record<string, string> = {
  title: '題名',
  title2pu: '題名',
  author: '作者',
  author2: '其他作者',
  publisher: '出版者',
  place: '出版地',
  pubyear2: '出版年',
  publishYear: '出版年',
  isbn: 'ISBN／ISSN',
  issn: 'ISBN／ISSN',
  classno: '分類號',
  shelfno: '架位',
  subject2: '主題',
  series: '叢書',
  lang1: '語言',
  gmd: '資料類型',
  note: '附註',
  url: '電子資源',
  dataType: '資料類型',
  bookImgSourceType: '封面來源',
  lendcnt: '借閱次數',
  isCanLend: '借閱狀態',
  bookdesc: '內容簡介',
  authordesc: '作者簡介',
  recommdesc: '推薦說明',
};

const HIDDEN_DETAIL_KEYS = new Set([
  'sid',
  'bookImg',
  'bookImgSource',
  'bookImgSourceType',
  'dataTypeImg',
  'ExecCode1',
  'ExecCode2',
  'MarcKind',
  'CLN',
  'score',
  'pointSum',
  'pointCnt',
  'EBookId',
  'OPENURL_BTN',
  'SEARCH_DOWNLOAD_BTN',
  'SEARCH_RESERVE_BTN',
  'SEARCH_BORROWINLIB_BTN',
  'EBook_BORROW_BTN',
  'EBook_RESERVE_BTN',
  'MYEBook_BORROW_BTN',
  'MYEBook_RESERVE_BTN',
  'MYEBook_RESERVEArrived_BTN',
  'isCollection',
]);

function pickStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function normalizeCommonLabel(value: unknown): string {
  const s = pickStr(value);
  if (!s) return '';
  return OPAC_COMMON_LABELS[s] ?? s.replace(/^common:webpac\./, '');
}

function normalizeUrl(value: unknown): string {
  const raw = pickStr(value)
    .split('^')
    .map((x) => x.trim())
    .find((x) => /^https?:\/\//i.test(x));
  if (!raw) return '';
  return raw.replace(/^http:\/\//i, 'https://');
}

function normalizeCoverUrl(value: unknown): string {
  const raw = pickStr(value)
    .split('^')
    .map((x) => x.trim())
    .find((x) => /^https?:\/\//i.test(x));
  if (!raw) return '';
  if (/^https?:\/\/(?:www\.)?books\.com\.tw\/img\//i.test(raw)) {
    const original = raw.replace(/^https:\/\//i, 'http://');
    return `https://im1.book.com.tw/image/getImage?i=${encodeURIComponent(original)}&v=00000000&w=348&h=348`;
  }
  return raw.replace(/^http:\/\//i, 'https://');
}

function normalizeRawMap(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const str = pickStr(value);
    if (str) out[key] = str;
  }
  return out;
}

function availabilityFromRaw(raw: Record<string, unknown>): {
  availability: string;
  isAvailable: boolean | undefined;
  canReserve: boolean;
} {
  const canLend = pickStr(raw.isCanLend).toUpperCase();
  const reserve = pickStr(raw.SEARCH_RESERVE_BTN).toUpperCase() === 'Y';
  if (canLend === 'Y') {
    return { availability: '可借閱', isAvailable: true, canReserve: reserve };
  }
  if (reserve) {
    return { availability: '可預約', isAvailable: false, canReserve: reserve };
  }
  if (canLend === 'N') {
    return { availability: '需查複本', isAvailable: false, canReserve: reserve };
  }
  return { availability: '', isAvailable: undefined, canReserve: reserve };
}

function normalizeHit(raw: Record<string, unknown>): OpacSearchHit | null {
  const sidRaw = raw.sid ?? raw.biblioId ?? raw.id;
  const sid = pickStr(sidRaw);
  if (!sid) return null;
  const title = pickStr(
    raw.title2pu ?? raw.marcTitle ?? raw.title ?? raw.bookTitle ?? raw.mainTitle,
  );
  const availability = availabilityFromRaw(raw);
  return {
    sid,
    title: title || '（無題名）',
    author: pickStr(raw.author ?? raw.marcAuthor),
    publisher: pickStr(raw.publisher),
    year: pickStr(raw.pubyear2 ?? raw.publishYear ?? raw.year),
    coverUrl: normalizeCoverUrl(raw.bookImg ?? raw.coverUrl ?? raw.imageUrl),
    dataType: normalizeCommonLabel(raw.dataType),
    availability: availability.availability,
    isAvailable: availability.isAvailable,
    canReserve: availability.canReserve,
    lendCount: pickStr(raw.lendcnt),
    sourceName: pickStr(raw.bookImgSourceType),
    externalUrl: normalizeUrl(raw.openurl ?? raw.url),
    raw: normalizeRawMap(raw),
  };
}

function objectFromLayoutRefs(refs: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(refs)) return out;
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') continue;
    const key = pickStr((ref as Record<string, unknown>).key);
    if (!key) continue;
    out[key] = (ref as Record<string, unknown>).value;
  }
  return out;
}

function normalizeLayoutRow(raw: Record<string, unknown>): OpacSearchHit | null {
  const refMap = objectFromLayoutRefs(raw.ref ?? raw.values ?? raw.refs);
  return normalizeHit({
    sid: refMap.sid,
    title: refMap.title2pu ?? refMap.title ?? refMap.marcTitle,
    author: refMap.author,
    publisher: refMap.publisher,
    publishYear: refMap.pubyear2 ?? refMap.publishYear ?? refMap.year,
  });
}

function normalizeSearchPayload(json: unknown): {
  hits: OpacSearchHit[];
  hyftdToken?: string | null;
  rawTotalHint?: number;
  emptyConfirmed: boolean;
} {
  const data = asObject(asObject(json)?.data);
  const searchNode = asObject(data?.search ?? data?.Search);
  const info = asObject(searchNode?.info);
  const hyftdToken = pickStr(searchNode?.hyftdToken ?? info?.hyftdToken) || null;
  if (searchNode == null) {
    return { hits: [], hyftdToken, emptyConfirmed: false };
  }
  const legacyList = searchNode.bookList ?? searchNode.books ?? searchNode.items;
  const layoutList = asObject(searchNode.list)?.values;
  const listRaw = Array.isArray(legacyList) ? legacyList : layoutList;
  if (!Array.isArray(listRaw)) {
    return { hits: [], hyftdToken, rawTotalHint: Number(info?.total), emptyConfirmed: false };
  }
  const hits: OpacSearchHit[] = [];
  for (const row of listRaw) {
    if (row && typeof row === 'object') {
      const rowObj = row as Record<string, unknown>;
      const h = Array.isArray(rowObj.ref) ? normalizeLayoutRow(rowObj) : normalizeHit(rowObj);
      if (h) hits.push(h);
    }
  }
  return {
    hits,
    hyftdToken,
    rawTotalHint: Number(info?.total),
    emptyConfirmed: true,
  };
}

type OpacDetailDisplay = {
  field?: unknown;
  name?: unknown;
  position?: unknown;
};

function objectFromKeyValueArray(items: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const key = pickStr((item as Record<string, unknown>).key);
    if (!key) continue;
    out[key] = (item as Record<string, unknown>).value;
  }
  return out;
}

function isUsefulDetailValue(value: unknown): boolean {
  const s = pickStr(value);
  return Boolean(s && s !== '-' && s !== '—' && s !== 'N');
}

function labelForDetailField(key: string, officialName?: unknown): string {
  if (DETAIL_FIELD_LABELS[key]) return DETAIL_FIELD_LABELS[key];
  const name = pickStr(officialName);
  if (!name) return key;
  return name
    .replace(/^common:/, '')
    .replace(/^webpac\.book\./, '')
    .replace(/^webpac\./, '');
}

function detailFieldValue(key: string, value: unknown): { value: string; url?: string } {
  if (key === 'dataType') {
    return { value: normalizeCommonLabel(value) };
  }
  if (key === 'isCanLend') {
    return { value: pickStr(value).toUpperCase() === 'Y' ? '可借閱' : '需查複本' };
  }
  if (key === 'url') {
    const url = normalizeUrl(value);
    return { value: url || pickStr(value).replace(/\^/g, '\n'), url: url || undefined };
  }
  return { value: pickStr(value).replace(/\^/g, '\n') };
}

function buildDetailFields(
  merged: Record<string, unknown>,
  display: OpacDetailDisplay[],
): OpacBookDetailField[] {
  const fields: OpacBookDetailField[] = [];
  const used = new Set<string>();
  const sortedDisplay = [...display].sort((a, b) => {
    const ap = Number(a.position);
    const bp = Number(b.position);
    const aa = Number.isFinite(ap) && ap >= 0 ? ap : 999;
    const bb = Number.isFinite(bp) && bp >= 0 ? bp : 999;
    return aa - bb;
  });

  const pushField = (key: string, officialName?: unknown) => {
    if (!key || used.has(key) || HIDDEN_DETAIL_KEYS.has(key)) return;
    if (!isUsefulDetailValue(merged[key])) return;
    const normalized = detailFieldValue(key, merged[key]);
    if (!normalized.value) return;
    fields.push({
      key,
      label: labelForDetailField(key, officialName),
      value: normalized.value,
      url: normalized.url,
    });
    used.add(key);
  };

  for (const item of sortedDisplay) {
    pushField(pickStr(item.field), item.name);
  }
  for (const key of [
    'dataType',
    'isCanLend',
    'lendcnt',
    'bookImgSourceType',
    'bookdesc',
    'authordesc',
    'recommdesc',
  ]) {
    pushField(key);
  }

  return fields;
}

function normalizeBookDetailPayload(json: unknown, fallback?: OpacSearchHit): OpacBookDetail {
  const data = asObject(asObject(json)?.data);
  const node = asObject(data?.getBookDetail);
  if (!node) {
    return {
      sid: fallback?.sid ?? '',
      title: fallback?.title ?? '（無題名）',
      author: fallback?.author ?? '',
      publisher: fallback?.publisher ?? '',
      year: fallback?.year ?? '',
      coverUrl: fallback?.coverUrl,
      dataType: fallback?.dataType,
      availability: fallback?.availability,
      isAvailable: fallback?.isAvailable,
      canReserve: fallback?.canReserve,
      lendCount: fallback?.lendCount,
      sourceName: fallback?.sourceName,
      fields: [],
      error: '未取得書目詳細資料',
    };
  }

  const view = asObject(node.view);
  const viewList = asObject(view?.list);
  const viewListValues = Array.isArray(viewList?.values) ? viewList.values : [];
  const firstViewValue = asObject(viewListValues[0]);
  const viewValues = objectFromLayoutRefs(firstViewValue?.ref);
  const values = objectFromKeyValueArray(node.values);
  const merged = {
    ...(fallback?.raw ?? {}),
    ...values,
    ...viewValues,
  };
  const normalized = normalizeHit(merged) ?? fallback;
  const display = Array.isArray(view?.display)
    ? view.display.filter((item): item is OpacDetailDisplay => asObject(item) !== null)
    : [];

  return {
    sid: normalized?.sid ?? fallback?.sid ?? '',
    title: normalized?.title ?? fallback?.title ?? '（無題名）',
    author: normalized?.author ?? fallback?.author ?? '',
    publisher: normalized?.publisher ?? fallback?.publisher ?? '',
    year: normalized?.year ?? fallback?.year ?? '',
    coverUrl: normalized?.coverUrl || fallback?.coverUrl,
    dataType: normalized?.dataType || fallback?.dataType,
    availability: normalized?.availability || fallback?.availability,
    isAvailable: normalized?.isAvailable ?? fallback?.isAvailable,
    canReserve: normalized?.canReserve ?? fallback?.canReserve,
    lendCount: normalized?.lendCount || fallback?.lendCount,
    sourceName: normalized?.sourceName || fallback?.sourceName,
    fields: buildDetailFields(merged, display),
    marc: pickStr(node.marc),
  };
}

export function buildSearchForm(
  keyword: string,
  field: OpacSearchFieldKey,
): Record<string, unknown> {
  const q = keyword.trim();
  const qs = `searchField=${encodeURIComponent(field)}&searchInput=${encodeURIComponent(q)}`;
  return {
    queryString: qs,
    searchInput: [q],
    searchField: [field],
    op: [],
  };
}

export function buildLibraryBookDetailUrl(sid: string): string {
  const origin = new URL(getLibraryOpacBaseUrl()).origin;
  return `${origin}/bookDetail?id=${encodeURIComponent(sid)}`;
}

/**
 * 先 GET 首頁 → GET 空白搜尋頁 → GET `/search?searchField=...&searchInput=...`，
 * 讓原生 Cookie Jar 建立連線並從**最後一頁** HTML 取 csrf-token。
 */
async function fetchCsrfAfterCookieWarmup(
  keyword: string,
  field: OpacSearchFieldKey,
  signal?: AbortSignal,
): Promise<string | null> {
  const base = getLibraryOpacBaseUrl();
  const origin = base.replace(/\/+$/, '');
  const q = keyword.trim();

  const hHome = { ...COMMON_HEADERS, Referer: base };

  let res = await fetch(base, {
    method: 'GET',
    headers: hHome,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  await res.text().catch(() => '');

  const searchEmptyUrl = `${origin}/search?searchField=${encodeURIComponent(field)}&searchInput=`;
  res = await fetch(searchEmptyUrl, {
    method: 'GET',
    headers: { ...COMMON_HEADERS, Referer: base },
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  let html = await res.text();

  if (q) {
    const searchKwUrl = buildLibrarySearchUrl(q, field);
    res = await fetch(searchKwUrl, {
      method: 'GET',
      headers: { ...COMMON_HEADERS, Referer: searchEmptyUrl },
      credentials: 'include',
      redirect: 'follow',
      signal,
    });
    html = await res.text();
  }

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
    operationName: 'search',
    query: SEARCH_QUERY,
    variables,
  });

  const url = new URL(GRAPHQL_PATH, getLibraryOpacBaseUrl()).toString();
  return fetch(url, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json',
      Referer: buildLibrarySearchUrl(keyword.trim(), field),
      'X-CSRF-Token': csrf,
      'x-apollo-operation-name': 'search',
    },
    body,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
}

function graphqlPayloadToResult(json: unknown): OpacSearchResult {
  const root = asObject(json);
  const errors = root?.errors;
  if (Array.isArray(errors) && errors.length) {
    const msg = graphqlErrorsMessage(errors);
    return {
      hits: [],
      source: 'live',
      error: msg || 'GraphQL 查詢被拒絕',
    };
  }

  const { hits, hyftdToken, rawTotalHint, emptyConfirmed } = normalizeSearchPayload(json);
  let hint: string | undefined;
  if (hits.length === 0) {
    hint = emptyConfirmed
      ? '查無符合館藏。可換搜尋欄位、改用全文，或至瀏覽器使用進階檢索。'
      : '未取得書目列表（站台回應格式可能更新）。請改用下方「瀏覽器開啟」查看官方結果。';
  }
  return {
    hits,
    rawTotalHint: Number.isFinite(rawTotalHint) ? rawTotalHint : undefined,
    hyftdToken,
    source: 'live',
    error: hint,
  };
}

function parseFetchJsonResponse(_res: Response, text: string): OpacSearchResult {
  let json: unknown;
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

    const parsed = graphqlPayloadToResult(d.graphql);
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
      const csrf = await fetchCsrfAfterCookieWarmup(q, field, options?.signal);
      if (!csrf) {
        throw new Error('csrf_missing');
      }
      return postGraphqlSearch(q, field, csrf, options?.signal);
    };

    let res = await runOnce();
    if (res.status === 403 || isTransientOpacStatus(res.status)) {
      res = await runOnce();
    }

    if (res.status === 403) {
      return {
        hits: [],
        source: 'live',
        error:
          '館藏伺服器仍回傳 HTTP 403。若你已登入，請確認已設定並部署 OPAC Worker（EXPO_PUBLIC_LIBRARY_OPAC_PROXY_URL）；否則請使用「瀏覽器開啟」。',
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
  } catch (e) {
    const msg = errorMessage(e);
    if (msg === 'csrf_missing') {
      return {
        hits: [],
        source: 'live',
        error: '無法取得館藏系統安全憑證（csrf）。請稍後再試或改用瀏覽器開啟。',
      };
    }
    return {
      hits: [],
      source: 'live',
      error: msg ?? '連線失敗',
    };
  }
}

function fallbackBookDetail(
  hit: OpacSearchHit | undefined,
  sid: string,
  error: string,
): OpacBookDetail {
  const merged = hit?.raw ?? {};
  return {
    sid: hit?.sid ?? sid,
    title: hit?.title ?? '（無題名）',
    author: hit?.author ?? '',
    publisher: hit?.publisher ?? '',
    year: hit?.year ?? '',
    coverUrl: hit?.coverUrl,
    dataType: hit?.dataType,
    availability: hit?.availability,
    isAvailable: hit?.isAvailable,
    canReserve: hit?.canReserve,
    lendCount: hit?.lendCount,
    sourceName: hit?.sourceName,
    fields: buildDetailFields(merged, []),
    error,
  };
}

async function fetchCsrfForBookDetail(sid: string, signal?: AbortSignal): Promise<string | null> {
  const base = getLibraryOpacBaseUrl();
  const detailUrl = buildLibraryBookDetailUrl(sid);

  let res = await fetch(base, {
    method: 'GET',
    headers: { ...COMMON_HEADERS, Referer: base },
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  await res.text().catch(() => '');

  res = await fetch(detailUrl, {
    method: 'GET',
    headers: { ...COMMON_HEADERS, Referer: base },
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  const html = await res.text();
  return extractCsrf(html);
}

async function postGraphqlBookDetail(
  sid: string,
  csrf: string,
  signal?: AbortSignal,
): Promise<Response> {
  const marcId = Number(sid);
  const body = JSON.stringify({
    operationName: 'bookdetail',
    query: BOOK_DETAIL_QUERY,
    variables: { marcId },
  });

  const url = new URL(GRAPHQL_PATH, getLibraryOpacBaseUrl()).toString();
  return fetch(url, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/json',
      Referer: buildLibraryBookDetailUrl(sid),
      'X-CSRF-Token': csrf,
      'x-apollo-operation-name': 'bookdetail',
    },
    body,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
}

export async function fetchOpacBookDetail(
  input: OpacSearchHit | string,
  options?: { signal?: AbortSignal },
): Promise<OpacBookDetail> {
  const fallback = typeof input === 'string' ? undefined : input;
  const sid = typeof input === 'string' ? input.trim() : input.sid.trim();
  if (!sid || !Number.isFinite(Number(sid))) {
    return fallbackBookDetail(fallback, sid, '書目代碼不正確');
  }

  if (shouldSkipDirectOpacFetch()) {
    return fallbackBookDetail(
      fallback,
      sid,
      '網頁版無法直接讀取圖書館詳細 API。可先查看搜尋摘要，或用瀏覽器開啟官方書目。',
    );
  }

  try {
    const runOnce = async (): Promise<Response> => {
      const csrf = await fetchCsrfForBookDetail(sid, options?.signal);
      if (!csrf) throw new Error('csrf_missing');
      return postGraphqlBookDetail(sid, csrf, options?.signal);
    };

    let res = await runOnce();
    if (res.status === 403) {
      res = await runOnce();
    }
    if (res.status === 403) {
      return fallbackBookDetail(
        fallback,
        sid,
        '館藏詳細資料 API 仍回傳 HTTP 403，已先顯示搜尋摘要。',
      );
    }

    const text = await res.text();
    if (!res.ok) {
      return fallbackBookDetail(fallback, sid, `館藏詳細資料讀取失敗（HTTP ${res.status}）。`);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fallbackBookDetail(fallback, sid, '館藏詳細資料回應非 JSON。');
    }
    const errors = asObject(json)?.errors;
    if (Array.isArray(errors) && errors.length) {
      const msg = graphqlErrorsMessage(errors);
      return fallbackBookDetail(fallback, sid, msg || 'GraphQL 詳細資料查詢被拒絕');
    }
    return normalizeBookDetailPayload(json, fallback);
  } catch (e) {
    const errMsg = errorMessage(e);
    const msg =
      errMsg === 'csrf_missing'
        ? '無法取得館藏系統安全憑證（csrf）。'
        : errMsg
          ? errMsg
          : '館藏詳細資料連線失敗';
    return fallbackBookDetail(fallback, sid, msg);
  }
}

export function buildExternalFallbackUrl(keyword: string, field: OpacSearchFieldKey): string {
  const kw = keyword.trim();
  if (!kw) return buildLibraryOpacHomeUrl();
  const origin = new URL(getLibraryOpacBaseUrl()).origin;
  const qs = `searchField=${encodeURIComponent(field)}&searchInput=${encodeURIComponent(kw)}`;
  return `${origin}/search?${qs}`;
}
