import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { CAMPUS_HOST_BLOCKED_CODE } from '@campus/shared/src/schoolLogin';
import {
  MAX_TRANSIENT_HOP_RETRIES,
  STUDENT_LOGIN_TOTAL_TIMEOUT_MS,
  studentLoginHopTimeoutMs,
} from '../schoolLoginTimeouts';
import { createPuRelayFetch, normalizeRelayHostname, normalizeRelayTarget } from './puEdgeRelay';
import {
  assertCampusHostAllowed,
  CampusHostBlockedError,
  noteCampusResponse,
} from './puCampusCircuit';
import { canonicalizePuStudentId } from './puIdentity';

const ALCAT_ORIGIN = 'https://alcat.pu.edu.tw';
const TRONCLASS_ORIGIN = 'https://tronclass.pu.edu.tw';
const IDENTITY_ORIGIN = 'https://identity.pu.edu.tw';
const IDENTITY_PASSWORD_HOST = 'identity.pu.edu.tw';
/** 單次校園 HTTP 逾時。Fly nrt 到學校比台灣慢，需大於舊版 10 秒。 */
export const DEFAULT_TIMEOUT_MS = 15_000;
const CAS_MIN_REMAINING_MS = 500;
const LMS_PROFILE_TIMEOUT_MS = 2_500;
const LMS_PROFILE_MIN_REMAINING_MS = 800;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type CampusErrorKind = 'credentials' | 'timeout' | 'closed' | 'unavailable' | 'unverified';
export type CampusLoginRoute = 'student' | 'teacher';
export type CampusLoginStage = 'home' | 'submit' | 'redirect' | 'verify';

export type CampusErrorDetails = {
  route?: CampusLoginRoute;
  stage?: CampusLoginStage;
  code?: string;
};

export class PuCampusError extends Error {
  readonly kind: CampusErrorKind;
  readonly route?: CampusLoginRoute;
  readonly stage?: CampusLoginStage;
  readonly code?: string;

  constructor(kind: CampusErrorKind, message: string, details: CampusErrorDetails = {}) {
    super(message);
    this.name = 'PuCampusError';
    this.kind = kind;
    this.route = details.route;
    this.stage = details.stage;
    this.code = details.code;
  }
}

export type CookieJar = Record<string, string>;

export type StudentCampusLogin = {
  cookies: CookieJar;
  studentName?: string;
  studentClass?: string;
};

export type StudentCampusInfo = {
  studentId?: string | null;
  name?: string | null;
  class?: string | null;
};

export type TronClassSession = {
  cookies: CookieJar;
  userId: number | null;
  userName: string;
  role: string;
  /** /api/profile JSON；學生登入必須用這份核對學號，不可只信 CAS HTML。 */
  profile?: Record<string, unknown>;
};

export type TronClassCourse = {
  name: string;
  role: string;
  teachers: Array<{ name?: string }>;
};

export type TronClassLoginOptions = {
  /** 整段 TronClass／CAS 總預算；未傳時每跳用 gateway 預設逾時。 */
  timeoutMs?: number;
  /** 單跳上限，需與總預算分開；未傳時等於 gateway 預設逾時。 */
  hopTimeoutMs?: number;
  route?: CampusLoginRoute;
};

export type StudentLoginOptions = {
  /** 整段 e 校園登入總預算；未傳時用 STUDENT_LOGIN_TOTAL_TIMEOUT_MS。 */
  timeoutMs?: number;
  /** 單跳上限，需與總預算分開；未傳時等於 gateway 預設逾時。 */
  hopTimeoutMs?: number;
};

export type PuCampusGateway = {
  loginStudent: (
    studentId: string,
    password: string,
    options?: StudentLoginOptions,
  ) => Promise<StudentCampusLogin>;
  fetchStudentInfo: (cookies: CookieJar) => Promise<StudentCampusInfo>;
  loginTronClass: (
    account: string,
    password: string,
    options?: TronClassLoginOptions,
  ) => Promise<TronClassSession>;
  fetchTronClassCourses: (session: TronClassSession) => Promise<TronClassCourse[]>;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type SentPage = {
  status: number;
  html: string;
  cookies: CookieJar;
  json: unknown;
  location: string | null;
  url: string;
};

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function mergeCookies(jar: CookieJar, headers: Headers): CookieJar {
  const next = { ...jar };
  const listed = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const fallback = headers.get('set-cookie');
  const lines = listed.length > 0 ? listed : fallback ? [fallback] : [];
  for (const line of lines) {
    const pair = String(line).split(';')[0]?.trim() || '';
    const idx = pair.indexOf('=');
    if (idx > 0) next[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return next;
}

export function rewriteAllowedCampusLocation(
  location: string | null | undefined,
  requestUrl: string,
  allowedOrigins: readonly string[],
): string | null {
  if (!location) return null;
  try {
    const target = new URL(location, requestUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (target.username || target.password) return null;
    const host = normalizeRelayHostname(target.hostname);
    if (!host) return null;
    target.hostname = host;
    const allowed = allowedOrigins.some((origin) => {
      const item = new URL(origin);
      return (
        host === normalizeRelayHostname(item.hostname) && target.port === item.port
      );
    });
    if (!allowed) return null;
    target.protocol = 'https:';
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

export function rewriteCampusPortalLocation(
  location: string | null | undefined,
  requestUrl: string,
  portalOrigin: string,
): string | null {
  return rewriteAllowedCampusLocation(location, requestUrl, [portalOrigin]);
}

/** CAS 含密碼的 POST 只能送到這個精確主機，不含帳密、也不接受非 443 連接埠。 */
export function isCasPasswordPostUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const target = new URL(url);
    return (
      target.protocol === 'https:' &&
      !target.username &&
      !target.password &&
      normalizeRelayHostname(target.hostname) === IDENTITY_PASSWORD_HOST &&
      (target.port === '' || target.port === '443')
    );
  } catch {
    return false;
  }
}

function hostnameOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = normalizeRelayHostname(new URL(url).hostname);
    return host || undefined;
  } catch {
    return undefined;
  }
}

function logCasPasswordPostRejected(details: {
  reason: 'untrusted_action' | 'redirect_preserves_body';
  host?: string;
  status?: number;
}): void {
  console.info(
    JSON.stringify({
      msg: 'pu_tronclass_cas_post_rejected',
      reason: details.reason,
      ...(details.host ? { host: details.host } : {}),
      ...(details.status != null ? { status: details.status } : {}),
    }),
  );
}

const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const TRANSIENT_NETWORK_CODES = new Set([
  ...TIMEOUT_CODES,
  'ECONNRESET',
  'EPIPE',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function readErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; cause?: unknown; name?: unknown };
    if (typeof record.code === 'string' && record.code.trim()) return record.code;
    if (record.name === 'AbortError' || record.name === 'TimeoutError') return String(record.name);
    current = record.cause;
  }
  return undefined;
}

const CLOSED_PAGE_TEXT = /尚未開放|系統維護|暫停服務|暫時關閉/;
const IGNORED_HTML_NODES = new Set(['#comment', 'script', 'style']);

type HtmlNode = DefaultTreeAdapterMap['node'];
type HtmlParent = DefaultTreeAdapterMap['parentNode'];

function isHtmlParent(node: HtmlNode): node is HtmlParent {
  return 'childNodes' in node && Array.isArray(node.childNodes);
}

function pruneIgnoredHtml(node: HtmlNode): void {
  if (!isHtmlParent(node)) return;
  node.childNodes = node.childNodes.filter((child) => {
    if (IGNORED_HTML_NODES.has(child.nodeName.toLowerCase())) return false;
    pruneIgnoredHtml(child);
    return true;
  });
}

function collectHtmlText(node: HtmlNode): string {
  if (node.nodeName === '#text' && 'value' in node) {
    return String(node.value || '');
  }
  if (!isHtmlParent(node)) return '';
  return node.childNodes.map(collectHtmlText).join(' ');
}

function inspectCampusHtml(html: string): { markup: string; text: string } {
  const fragment = parseFragment(String(html || ''));
  pruneIgnoredHtml(fragment);
  return {
    markup: serialize(fragment),
    text: collectHtmlText(fragment).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

function stripIgnoredHtml(html: string): string {
  return inspectCampusHtml(html).markup;
}

function visibleCampusText(html: string): string {
  return inspectCampusHtml(html).text;
}

export function campusPageHasLoginForm(html: string): boolean {
  const markup = stripIgnoredHtml(html).toLowerCase();
  return (
    markup.includes('action="index_check.php"') ||
    markup.includes("action='index_check.php'") ||
    (markup.includes('name="uid"') && markup.includes('name="upassword"'))
  );
}

function hasStudentContext(html: string): boolean {
  const markup = stripIgnoredHtml(html);
  return (
    markup.includes('學號(Student No.)') ||
    markup.includes('姓名(Student Name)') ||
    markup.includes('query_course')
  );
}

export function campusPageLooksClosed(html: string): boolean {
  if (campusPageHasLoginForm(html)) return false;
  return CLOSED_PAGE_TEXT.test(visibleCampusText(html));
}

function isClosedPage(html: string): boolean {
  return campusPageLooksClosed(html);
}

function isCredentialPage(html: string): boolean {
  return /帳號或密碼錯誤|login_fail|Login Failed|密碼錯誤|_INVALID_PASSWORD_|無效的使用者名稱或密碼|Invalid username or password|Invalid credentials/.test(
    stripIgnoredHtml(html),
  );
}

function extractCasLoginForm(
  html: string,
  fallbackUrl: string,
): { action: string; hiddenFields: Record<string, string> } | null {
  if (!/<form[\s>]/i.test(html)) return null;
  const formActionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
  const actionRaw = (formActionMatch?.[1] || fallbackUrl).replace(/&amp;/g, '&');
  let action: string;
  try {
    action = new URL(actionRaw, fallbackUrl).toString();
  } catch {
    return null;
  }
  const hiddenFields: Record<string, string> = {};
  const hiddenRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = hiddenRegex.exec(html)) !== null) {
    const nameMatch = match[0].match(/name=["']([^"']+)["']/i);
    const valueMatch = match[0].match(/value=["']([^"']*)["']/i);
    if (nameMatch?.[1]) hiddenFields[nameMatch[1]] = (valueMatch?.[1] ?? '').replace(/&amp;/g, '&');
  }
  return { action, hiddenFields };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveId(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sessionCookieValue(jar: CookieJar): string {
  for (const [key, value] of Object.entries(jar)) {
    if (key.toLowerCase() === 'session' && String(value || '').trim()) {
      return String(value);
    }
  }
  return '';
}

function parseTronClassUserIdFromHtml(html: string): number | null {
  const match =
    html.match(/userId['":\s]+(\d+)/) ||
    html.match(/user_id['":\s]+(\d+)/i) ||
    html.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i) ||
    html.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i);
  return positiveId(match?.[1]);
}

function parseTronClassUserNameFromHtml(html: string, fallback: string): string {
  const match =
    html.match(/class=["']user-?name["'][^>]*>([^<]+)</i) || html.match(/"name"\s*:\s*"([^"]+)"/);
  return readTrimmed(match?.[1]) || fallback;
}

function isTronClassUserIndexUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path === '/user/index' || path.startsWith('/user/index/');
  } catch {
    return false;
  }
}

function isCasLoginBounce(html: string): boolean {
  return html.includes('/auth/realms/pu') || html.includes('identity.pu.edu.tw');
}

function looksLikeHtml(body: string): boolean {
  return body.trimStart().startsWith('<');
}

function userIdFrom(data: Record<string, unknown>): number | null {
  const nested = asRecord(data.user);
  return positiveId(data.user_id ?? data.id ?? data.userId ?? nested.id ?? nested.user_id);
}

function displayNameFrom(data: Record<string, unknown>, fallback: string): string {
  const nested = asRecord(data.user);
  return (
    readTrimmed(data.name) ||
    readTrimmed(data.display_name) ||
    readTrimmed(nested.name) ||
    readTrimmed(nested.display_name) ||
    fallback
  );
}

function roleFrom(data: Record<string, unknown>): string {
  const nested = asRecord(data.user);
  return readTrimmed(data.role ?? nested.role).toLowerCase();
}

function accountIdentifiers(data: Record<string, unknown>): string[] {
  const nested = asRecord(data.user);
  const emails = [data.email, nested.email].map((value) => readTrimmed(value).toLowerCase());
  const locals = emails.map((email) => (email.includes('@') ? email.slice(0, email.indexOf('@')) : email));
  return [
    data.login_name,
    data.user_name,
    data.userName,
    nested.login_name,
    nested.user_name,
    nested.userName,
    ...emails,
    ...locals,
  ]
    .map((value) => readTrimmed(value).toLowerCase())
    .filter(Boolean);
}

export function identityBelongsToAccount(account: string, data: Record<string, unknown>): boolean {
  const wanted = account.trim().toLowerCase();
  if (!wanted) return false;
  const ids = accountIdentifiers(data);
  if (ids.includes(wanted)) return true;
  const wantedDigits = canonicalizePuStudentId(wanted);
  if (!wantedDigits) return false;
  return ids.some((id) => canonicalizePuStudentId(id) === wantedDigits);
}

function authenticatedJson(page: SentPage): Record<string, unknown> | null {
  if (page.status === 401 || page.status === 403 || page.status === 302) return null;
  if (page.status !== 200 || looksLikeHtml(page.html) || !page.json || typeof page.json !== 'object') {
    return null;
  }
  return asRecord(page.json);
}

export function isTransientCampusError(error: unknown): boolean {
  if (error instanceof PuCampusError) {
    return error.kind === 'timeout' || error.kind === 'unavailable';
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  const code = readErrorCode(error);
  return Boolean(code && TRANSIENT_NETWORK_CODES.has(code));
}

export function classifyCampusFailure(error: unknown, details: CampusErrorDetails = {}): PuCampusError {
  if (error instanceof CampusHostBlockedError) {
    return new PuCampusError('unavailable', '學校系統無回應', {
      ...details,
      code: CAMPUS_HOST_BLOCKED_CODE,
    });
  }
  if (error instanceof PuCampusError) {
    return new PuCampusError(error.kind, error.message, {
      route: error.route || details.route,
      stage: error.stage || details.stage,
      code: error.code || details.code || readErrorCode(error),
    });
  }
  const name = error instanceof Error ? error.name : '';
  const code = details.code || readErrorCode(error);
  if (name === 'TimeoutError' || name === 'AbortError' || (code != null && TIMEOUT_CODES.has(code))) {
    return new PuCampusError('timeout', '學校系統無回應', { ...details, code: code || name });
  }
  return new PuCampusError('unavailable', '學校系統無回應', { ...details, code });
}

export { createPuRelayFetch, readPuEdgeRelayConfig } from './puEdgeRelay';

export function createPuCampusGateway(
  options: {
    fetch?: FetchLike;
    timeoutMs?: number;
    portalOrigin?: string;
    lmsOrigin?: string;
    identityOrigin?: string;
  } = {},
): PuCampusGateway {
  const request = options.fetch ?? createPuRelayFetch();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const portalOrigin = options.portalOrigin || ALCAT_ORIGIN;
  const lmsOrigin = options.lmsOrigin || TRONCLASS_ORIGIN;
  const identityOrigin = options.identityOrigin || IDENTITY_ORIGIN;
  const lmsAllowedOrigins = [lmsOrigin, identityOrigin];

  async function send(
    url: string,
    init: RequestInit & {
      cookies?: CookieJar;
      timeoutMs?: number;
      context?: CampusErrorDetails;
      confineOrigin?: string;
      confineOrigins?: readonly string[];
    } = {},
  ): Promise<SentPage> {
    const waitMs = init.timeoutMs ?? timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    const context = init.context || {};
    try {
      assertCampusHostAllowed(url);
      const headers = new Headers(init.headers);
      headers.set('User-Agent', USER_AGENT);
      headers.set('Accept-Language', 'zh-TW,zh;q=0.9');
      if (init.cookies && Object.keys(init.cookies).length > 0) {
        headers.set('Cookie', cookieHeader(init.cookies));
      }
      const response = await request(url, {
        method: init.method,
        headers,
        body: init.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      const html = await response.text();
      noteCampusResponse(url, response.status, html);
      const locationHeader = response.headers.get('location');
      const allowedOrigins = init.confineOrigins || (init.confineOrigin ? [init.confineOrigin] : null);
      const location = allowedOrigins
        ? rewriteAllowedCampusLocation(locationHeader, url, allowedOrigins)
        : locationHeader
          ? normalizeRelayTarget(new URL(locationHeader, url).toString()) ||
            new URL(locationHeader, url).toString()
          : null;
      return {
        status: response.status,
        html,
        cookies: mergeCookies(init.cookies || {}, response.headers),
        location,
        url,
        json: (() => {
          try {
            return JSON.parse(html) as unknown;
          } catch {
            return null;
          }
        })(),
      };
    } catch (error) {
      throw classifyCampusFailure(error, context);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getFollow(
    url: string,
    cookies: CookieJar,
    hops = 3,
    context: CampusErrorDetails = {},
  ): Promise<SentPage> {
    let current = url;
    let jar = cookies;
    let page = await send(current, { cookies: jar, context, confineOrigin: portalOrigin });
    let remainingHops = hops;
    while ((page.status === 301 || page.status === 302) && page.location && remainingHops > 0) {
      current = page.location;
      jar = page.cookies;
      page = await send(current, { cookies: jar, context, confineOrigin: portalOrigin });
      remainingHops -= 1;
    }
    return page;
  }

  async function followLms(
    url: string,
    init: {
      cookies?: CookieJar;
      method?: string;
      body?: string;
      headers?: HeadersInit;
      hops?: number;
      timeoutMs?: number;
      context?: CampusErrorDetails;
    } = {},
  ): Promise<SentPage> {
    let current = url;
    let jar = init.cookies || {};
    let method = init.method;
    let body = init.body;
    let hops = init.hops ?? 8;
    let page = await send(current, {
      method,
      body,
      headers: init.headers,
      cookies: jar,
      timeoutMs: init.timeoutMs,
      context: init.context,
      confineOrigins: lmsAllowedOrigins,
    });
    while ([301, 302, 303, 307, 308].includes(page.status) && page.location && hops > 0) {
      current = page.location;
      jar = page.cookies;
      if (page.status !== 307 && page.status !== 308) {
        method = 'GET';
        body = undefined;
      }
      page = await send(current, {
        method,
        body,
        headers: init.headers,
        cookies: jar,
        timeoutMs: init.timeoutMs,
        context: init.context,
        confineOrigins: lmsAllowedOrigins,
      });
      hops -= 1;
    }
    return page;
  }

  async function postCasCredentials(
    action: string,
    init: {
      cookies?: CookieJar;
      body: string;
      headers?: HeadersInit;
      hops?: number;
      timeoutMs?: number;
      context?: CampusErrorDetails;
    },
  ): Promise<SentPage> {
    if (!isCasPasswordPostUrl(action)) {
      logCasPasswordPostRejected({
        reason: 'untrusted_action',
        host: hostnameOf(action),
      });
      throw new PuCampusError('unavailable', '學校系統無回應', {
        ...(init.context || {}),
        code: 'CAS_UNTRUSTED_ACTION',
      });
    }
    let current = action;
    let jar = init.cookies || {};
    let hops = init.hops ?? 8;
    let carryingPassword = true;
    let page = await send(current, {
      method: 'POST',
      body: init.body,
      headers: init.headers,
      cookies: jar,
      timeoutMs: init.timeoutMs,
      context: init.context,
      confineOrigins: lmsAllowedOrigins,
    });
    while ([301, 302, 303, 307, 308].includes(page.status) && hops > 0) {
      const preservesBody = page.status === 307 || page.status === 308;
      if (carryingPassword && preservesBody) {
        if (!page.location || !isCasPasswordPostUrl(page.location)) {
          logCasPasswordPostRejected({
            reason: 'redirect_preserves_body',
            host: hostnameOf(page.location),
            status: page.status,
          });
          throw new PuCampusError('unavailable', '學校系統無回應', {
            ...(init.context || {}),
            code: 'CAS_POST_REDIRECT',
          });
        }
        current = page.location;
        jar = page.cookies;
        page = await send(current, {
          method: 'POST',
          body: init.body,
          headers: init.headers,
          cookies: jar,
          timeoutMs: init.timeoutMs,
          context: init.context,
          confineOrigins: lmsAllowedOrigins,
        });
        hops -= 1;
        continue;
      }
      if (!page.location) break;
      carryingPassword = false;
      current = page.location;
      jar = page.cookies;
      page = await send(current, {
        method: 'GET',
        headers: init.headers,
        cookies: jar,
        timeoutMs: init.timeoutMs,
        context: init.context,
        confineOrigins: lmsAllowedOrigins,
      });
      hops -= 1;
    }
    return page;
  }

  async function readTronClassProfile(
    cookies: CookieJar,
    account: string,
    loginData: Record<string, unknown>,
    route: CampusLoginRoute,
    timeoutMsRemaining: number,
    unauthorized: 'credentials' | 'missing' = 'missing',
  ): Promise<TronClassSession | null> {
    const profilePage = await send(`${lmsOrigin}/api/profile`, {
      cookies,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${lmsOrigin}/user/index`,
      },
      timeoutMs: timeoutMsRemaining,
      context: { route, stage: 'verify' },
    });
    if (profilePage.status === 401 || profilePage.status === 403 || profilePage.status === 302) {
      if (unauthorized === 'credentials') {
        throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
      }
      return null;
    }
    const profileData = authenticatedJson(profilePage);
    if (profileData && identityBelongsToAccount(account, profileData)) {
      return {
        cookies,
        userId: userIdFrom(profileData) ?? userIdFrom(loginData),
        userName: displayNameFrom(profileData, account),
        role: roleFrom(profileData),
        profile: profileData,
      };
    }
    if (profileData) {
      throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
    }
    return null;
  }

  return {
    async loginStudent(studentId, password, options = {}) {
      const student = { route: 'student' as const };
      const started = Date.now();
      const budget = options.timeoutMs ?? STUDENT_LOGIN_TOTAL_TIMEOUT_MS;
      const hopCap = options.hopTimeoutMs ?? timeoutMs;
      const leftover = () => budget - (Date.now() - started);
      const deadlineError = (stage: CampusLoginStage) =>
        new PuCampusError('timeout', '學校系統無回應', {
          ...student,
          stage,
          code: 'DEADLINE',
        });

      async function sendWithinBudget(
        url: string,
        init: RequestInit & {
          cookies?: CookieJar;
          confineOrigin?: string;
        },
        stage: CampusLoginStage,
        retry: boolean,
      ): Promise<SentPage> {
        const attempts = retry ? MAX_TRANSIENT_HOP_RETRIES + 1 : 1;
        let lastError: unknown;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const leftoverMs = leftover();
          if (leftoverMs <= 0) throw deadlineError(stage);
          try {
            return await send(url, {
              ...init,
              timeoutMs: studentLoginHopTimeoutMs(hopCap, leftoverMs),
              context: { ...student, stage },
              confineOrigin: init.confineOrigin,
            });
          } catch (error) {
            lastError = error;
            if (!retry || !isTransientCampusError(error) || attempt === attempts - 1) {
              throw error;
            }
          }
        }
        throw lastError;
      }

      async function followWithinBudget(
        url: string,
        cookies: CookieJar,
        hops: number,
        stage: CampusLoginStage,
      ): Promise<SentPage> {
        let current = url;
        let jar = cookies;
        let page = await sendWithinBudget(
          current,
          { cookies: jar, confineOrigin: portalOrigin },
          stage,
          true,
        );
        let remainingHops = hops;
        while ((page.status === 301 || page.status === 302) && page.location && remainingHops > 0) {
          current = page.location;
          jar = page.cookies;
          page = await sendWithinBudget(
            current,
            { cookies: jar, confineOrigin: portalOrigin },
            stage,
            true,
          );
          remainingHops -= 1;
        }
        return page;
      }

      try {
        const warmup = await sendWithinBudget(
          `${portalOrigin}/`,
          { confineOrigin: portalOrigin },
          'home',
          true,
        );
        if (isClosedPage(warmup.html)) {
          throw new PuCampusError('closed', '尚未開放', { ...student, stage: 'home' });
        }
        const body = `uid=${encodeURIComponent(studentId)}&upassword=${encodeURIComponent(password)}&en_flag=zh`;
        const posted = await sendWithinBudget(
          `${portalOrigin}/index_check.php`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            cookies: warmup.cookies,
            confineOrigin: portalOrigin,
          },
          'submit',
          false,
        );
        if (isClosedPage(posted.html)) {
          throw new PuCampusError('closed', '尚未開放', { ...student, stage: 'submit' });
        }
        if (isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { ...student, stage: 'submit' });
        }
        if (posted.status !== 200 && posted.status !== 302) {
          throw new PuCampusError('unavailable', '學校系統無回應', { ...student, stage: 'submit' });
        }
        const sessionCookies =
          posted.status === 302 && posted.location
            ? (await followWithinBudget(posted.location, posted.cookies, 3, 'redirect')).cookies
            : posted.cookies;
        const verify = await followWithinBudget(
          `${portalOrigin}/stu_query/query_course.html`,
          sessionCookies,
          3,
          'verify',
        );
        if (isClosedPage(verify.html)) {
          throw new PuCampusError('closed', '尚未開放', { ...student, stage: 'verify' });
        }
        if (verify.status !== 200 || !hasStudentContext(verify.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { ...student, stage: 'verify' });
        }
        const nameMatch =
          verify.html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/) ||
          verify.html.match(/([^\s<]+)同學您好/);
        return {
          cookies: verify.cookies,
          studentName: nameMatch?.[1],
          studentClass: verify.html.match(/班級\(Class\)[：:]\s*([^\s<]+)/)?.[1],
        };
      } catch (error) {
        throw classifyCampusFailure(error, student);
      }
    },

    async fetchStudentInfo(cookies) {
      try {
        const page = await getFollow(`${portalOrigin}/stu_query/query_course.html`, cookies, 3, {
          route: 'student',
          stage: 'verify',
        });
        if (isClosedPage(page.html)) {
          throw new PuCampusError('closed', '尚未開放', { route: 'student', stage: 'verify' });
        }
        if (!hasStudentContext(page.html)) {
          return {};
        }
        return {
          studentId: page.html.match(/學號\(Student No\.\)[：:]\s*(\d+)/)?.[1] ?? null,
          name: page.html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/)?.[1] ?? null,
          class: page.html.match(/班級\(Class\)[：:]\s*([^\s<]+)/)?.[1] ?? null,
        };
      } catch (error) {
        throw classifyCampusFailure(error);
      }
    },

    async loginTronClass(account, password, options = {}) {
      const started = Date.now();
      const budget = options.timeoutMs;
      const hopCap = options.hopTimeoutMs ?? timeoutMs;
      const leftover = () => (budget == null ? hopCap : budget - (Date.now() - started));
      const remaining = () => Math.max(1, Math.min(hopCap, leftover()));
      const route = options.route || 'teacher';
      try {
        const posted = await send(`${lmsOrigin}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ user_name: account, password }),
          timeoutMs: remaining(),
          context: { route, stage: 'submit' },
        });
        if (posted.status === 200 && isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        // 學生路線：/api/login 已明確回帳密錯誤時不再改走 CAS，減少同一組密碼送出次數。
        if (route === 'student' && posted.status >= 400 && posted.status < 500 && isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        if (posted.status === 200 && sessionCookieValue(posted.cookies)) {
          const loginData = asRecord(posted.json);
          const session = await readTronClassProfile(
            posted.cookies,
            account,
            loginData,
            route,
            remaining(),
            'credentials',
          );
          if (session) return session;
          throw new PuCampusError(
            'unverified',
            route === 'student' ? '暫時無法驗證學生身分' : '暫時無法驗證老師身分',
            { route, stage: 'verify' },
          );
        }
        const nativeFallback = new PuCampusError('unavailable', '學校系統無回應', {
          route,
          stage: 'submit',
          code: `HTTP_${posted.status}`,
        });

        if (leftover() < CAS_MIN_REMAINING_MS) {
          throw nativeFallback;
        }

        const loginPage = await followLms(`${lmsOrigin}/login?next=/user/index`, {
          headers: { Accept: 'text/html' },
          hops: 5,
          timeoutMs: remaining(),
          context: { route, stage: 'redirect' },
        });
        if (loginPage.status !== 200) {
          throw nativeFallback || new PuCampusError('unavailable', '學校系統無回應', {
            route,
            stage: 'redirect',
            code: `HTTP_${loginPage.status}`,
          });
        }
        const form = extractCasLoginForm(loginPage.html, loginPage.url);
        if (!form) {
          throw nativeFallback || new PuCampusError('unavailable', '學校系統無回應', {
            route,
            stage: 'redirect',
          });
        }
        const formData = new URLSearchParams({
          ...form.hiddenFields,
          username: account,
          password,
          login: '',
        }).toString();
        const postedCas = await postCasCredentials(form.action, {
          body: formData,
          cookies: loginPage.cookies,
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${identityOrigin}/`,
          },
          hops: 8,
          timeoutMs: remaining(),
          context: { route, stage: 'submit' },
        });
        if (isCredentialPage(postedCas.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        const indexPage =
          postedCas.status === 200 && isTronClassUserIndexUrl(postedCas.url)
            ? postedCas
            : await followLms(`${lmsOrigin}/user/index`, {
                cookies: postedCas.cookies,
                headers: { Accept: 'text/html' },
                hops: 3,
                timeoutMs: remaining(),
                context: { route, stage: 'verify' },
              });
        if (isCredentialPage(indexPage.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
        }
        if (isCasLoginBounce(indexPage.html)) {
          throw new PuCampusError('unavailable', '學校系統無回應', { route, stage: 'verify' });
        }
        const casSession =
          sessionCookieValue(indexPage.cookies) || isTronClassUserIndexUrl(indexPage.url)
            ? {
                cookies: indexPage.cookies,
                userId: parseTronClassUserIdFromHtml(indexPage.html),
                userName: parseTronClassUserNameFromHtml(indexPage.html, account),
                role: '',
              }
            : null;
        const profileWait = leftover();
        if (profileWait >= LMS_PROFILE_MIN_REMAINING_MS) {
          try {
            const verified = await readTronClassProfile(
              indexPage.cookies,
              account,
              {},
              route,
              Math.min(LMS_PROFILE_TIMEOUT_MS, profileWait),
            );
            if (verified) return verified;
          } catch (error) {
            const timedOut = error instanceof PuCampusError && error.kind === 'timeout';
            if (!timedOut || !casSession || route === 'student') throw error;
          }
        }
        if (route === 'student') {
          throw new PuCampusError('unverified', '暫時無法驗證學生身分', { route, stage: 'verify' });
        }
        if (casSession) return casSession;
        throw new PuCampusError('unverified', '暫時無法驗證老師身分', { route, stage: 'verify' });
      } catch (error) {
        throw classifyCampusFailure(error, { route });
      }
    },

    async fetchTronClassCourses(session) {
      try {
        const posted = await send(`${lmsOrigin}/api/my-courses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ conditions: { status: ['ongoing'] }, page: 1, page_size: 50 }),
          cookies: session.cookies,
        });
        if (posted.status !== 200) return [];
        const data =
          posted.json && typeof posted.json === 'object'
            ? (posted.json as { courses?: unknown })
            : {};
        const courses = Array.isArray(data.courses) ? data.courses : [];
        return courses.map((item) => {
          const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
          const people = Array.isArray(row.teachers)
            ? row.teachers
            : Array.isArray(row.instructors)
              ? row.instructors
              : [];
          return {
            name: String(row.name || '').trim(),
            role: String(row.role ?? row.enroll_role ?? 'student').toLowerCase(),
            teachers: people.map((person) => {
              const teacher =
                person && typeof person === 'object' ? (person as Record<string, unknown>) : {};
              return { name: typeof teacher.name === 'string' ? teacher.name : undefined };
            }),
          };
        });
      } catch (error) {
        throw classifyCampusFailure(error);
      }
    },
  };
}
