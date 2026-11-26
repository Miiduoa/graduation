import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import {
  isPuEcampusDataFetchEnabled,
  isPuEcampusDataHost,
  PU_ECAMPUS_DATA_PAUSED_CODE,
  PU_ECAMPUS_DATA_PAUSED_MESSAGE,
} from '@campus/shared/src/puEcampusDataPolicy';
import {
  MAX_TRANSIENT_HOP_RETRIES,
  STUDENT_LOGIN_TOTAL_TIMEOUT_MS,
  studentLoginHopTimeoutMs,
} from '../schoolLoginTimeouts';
import { createPuRelayFetch, normalizeRelayHostname, normalizeRelayTarget } from './puEdgeRelay';
import { parseTronClassStudentIdentityEvidence, type TronClassProfileEvidence } from './tronClassIdentityEvidence';
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

export type CampusErrorKind = 'credentials' | 'timeout' | 'closed' | 'unavailable' | 'unverified' | 'paused';
export type CampusLoginRoute = 'student' | 'teacher';
export type CampusLoginStage = 'home' | 'submit' | 'redirect' | 'verify';

export type CampusErrorDetails = {
  route?: CampusLoginRoute;
  stage?: CampusLoginStage;
  code?: string;
  loginNotDelivered?: boolean;
};

export class PuCampusError extends Error {
  readonly kind: CampusErrorKind;
  readonly route?: CampusLoginRoute;
  readonly stage?: CampusLoginStage;
  readonly code?: string;
  readonly loginNotDelivered: boolean;

  constructor(kind: CampusErrorKind, message: string, details: CampusErrorDetails = {}) {
    super(message);
    this.name = 'PuCampusError';
    this.kind = kind;
    this.route = details.route;
    this.stage = details.stage;
    this.code = details.code;
    this.loginNotDelivered = details.loginNotDelivered === true;
  }
}

export type CookieJar = Record<string, string>;

export type StudentCampusLogin = {
  cookies: CookieJar;
  studentId?: string;
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
  /** Server-only profile evidence, not permission to mint a platform session. */
  identityEvidence?: TronClassProfileEvidence;
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
  /** Candidate native-login path: no HTML/login-body fallback, no implicit student role. */
  requireStudentIdentityEvidence?: boolean;
  /** Stop every native/CAS/profile hop when the originating login is abandoned. */
  signal?: AbortSignal;
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
  contentType: string | null;
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

type StrictTronClassCookies = Map<string, { value: string; path: string; expiresAt: number | null }>;
const TRONCLASS_PROFILE_URL = TRONCLASS_ORIGIN + '/api/profile';
const COOKIE_NAME = /^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/u;
const COOKIE_VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/u;

function cookiePathMatches(path: string, pathname: string): boolean {
  return pathname === path || pathname.startsWith(path.endsWith('/') ? path : path + '/');
}

function strictCookieValues(jar: StrictTronClassCookies, url: string): CookieJar {
  const target = new URL(url);
  if (target.origin !== TRONCLASS_ORIGIN) return {};
  const now = Date.now();
  return Object.fromEntries([...jar].filter(([name, cookie]) => {
    if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
      jar.delete(name);
      return false;
    }
    return cookiePathMatches(cookie.path, target.pathname);
  }).map(([name, cookie]) => [name, cookie.value]));
}

/** Native evidence uses its own origin/path/expiry-aware jar; legacy CAS stays unchanged. */
function mergeStrictTronClassCookies(
  jar: StrictTronClassCookies, headers: Headers, requestUrl: string, receivedAt: number,
  context: CampusErrorDetails,
): void {
  const reject = () => {
    throw new PuCampusError('unverified', '目前無法驗證校園帳號', {
      ...context, code: 'IDENTITY_EVIDENCE_UNAVAILABLE',
    });
  };
  const listed = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const fallback = headers.get('set-cookie');
  const lines = listed.length ? listed : fallback ? [fallback] : [];
  const origin = new URL(requestUrl);
  let sessionUpdates = 0;
  for (const line of lines) {
    // A folded header can hide a session update behind an unrelated first cookie.
    // Normal Expires date commas have no following cookie-pair and remain valid.
    if (/,\s*[^;,=\s]+=/.test(line)) reject();
    const [pair, ...attributes] = line.split(';').map(part => part.trim());
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const session = name.toLowerCase() === 'session';
    if (session && (name !== 'session' || ++sessionUpdates > 1)) reject();
    const invalid = () => { if (session) reject(); };
    if (separator <= 0 || !COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) { invalid(); continue; }
    const scoped = new Map<string, string>();
    let malformed = false;
    for (const attribute of attributes) {
      const index = attribute.indexOf('=');
      const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
      if (!['domain', 'path', 'expires', 'max-age'].includes(key)) continue;
      if (index < 0 || scoped.has(key)) malformed = true;
      scoped.set(key, index < 0 ? '' : attribute.slice(index + 1).trim());
    }
    // A strict identity cookie cannot acquire authority from another host or ambiguous scope.
    const domain = scoped.get('domain')?.replace(/^\./, '').toLowerCase();
    const path = scoped.get('path') ?? (origin.pathname.slice(0, origin.pathname.lastIndexOf('/')) || '/');
    if (malformed || (domain !== undefined && domain !== origin.hostname) || !path.startsWith('/')) {
      invalid(); continue;
    }
    let expiresAt: number | null = null;
    const maxAge = scoped.get('max-age');
    if (maxAge !== undefined) {
      const seconds = Number(maxAge);
      if (!/^-?\d+$/.test(maxAge) || !Number.isSafeInteger(seconds) ||
          !Number.isSafeInteger(receivedAt + seconds * 1000)) { invalid(); continue; }
      expiresAt = seconds <= 0 ? 0 : receivedAt + seconds * 1000;
    } else if (scoped.has('expires')) {
      expiresAt = Date.parse(scoped.get('expires')!);
      if (!Number.isFinite(expiresAt)) { invalid(); continue; }
    }
    if (session) {
      if (!cookiePathMatches(path, '/api/profile')) reject();
      const previous = jar.get(name);
      if (previous && (previous.expiresAt === null || previous.expiresAt > Date.now()) && previous.path !== path) {
        // Two live cookies with the same name and different paths would be ambiguous on the wire.
        reject();
      }
    }
    if (!value || (expiresAt !== null && expiresAt <= Date.now())) jar.delete(name);
    else jar.set(name, { value, path, expiresAt });
  }
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

// These failures occur before a connection can carry the request.
const PRE_CONNECTION_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
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

function collectHtmlText(node: HtmlNode, omit?: (node: HtmlNode) => boolean): string {
  if (omit?.(node)) return '';
  if (node.nodeName === '#text' && 'value' in node) {
    return String(node.value || '');
  }
  if (!isHtmlParent(node)) return '';
  return node.childNodes.map((child) => collectHtmlText(child, omit)).join(' ');
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

const PROFILE_NON_TEXT = new Set([
  ...IGNORED_HTML_NODES, 'template', 'noscript', 'input', 'textarea', 'select', 'button',
]);

function skipProfileNode(node: HtmlNode): boolean {
  return (
    PROFILE_NON_TEXT.has(node.nodeName) ||
    ('attrs' in node && node.attrs.some(({ name, value }) =>
      name === 'hidden' ||
      (name === 'aria-hidden' && value.toLowerCase() === 'true') ||
      (name === 'style' && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(value)),
    ))
  );
}

function studentNumberOnPage(page: SentPage, portalOrigin: string): string | undefined {
  const source = new URL(page.url);
  if (
    page.status !== 200 ||
    source.origin !== portalOrigin ||
    source.pathname !== '/stu_query/query_course.html'
  )
    return undefined;
  const text = collectHtmlText(parseFragment(page.html), skipProfileNode);
  const fields = [...text.matchAll(/學號\(Student No\.\)\s*[：:]\s*(\S*)/g)];
  const number = fields.length === 1 ? fields[0]?.[1] : undefined;
  return number && /^\d{7,10}$/.test(number) ? number : undefined;
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

function identityBelongsToAccount(account: string, data: Record<string, unknown>): boolean {
  const wanted = account.trim().toLowerCase();
  if (!wanted) return false;
  return accountIdentifiers(data).includes(wanted);
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
  if (error instanceof PuCampusError) {
    return new PuCampusError(error.kind, error.message, {
      route: error.route || details.route,
      stage: error.stage || details.stage,
      code: error.code || details.code || readErrorCode(error),
      loginNotDelivered: error.loginNotDelivered || details.loginNotDelivered,
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
      deadline?: number;
      context?: CampusErrorDetails;
      confineOrigin?: string;
      confineOrigins?: readonly string[];
      strictCookies?: StrictTronClassCookies;
      cookiesByOrigin?: Map<string, CookieJar>;
      initialTronClassLogin?: boolean;
    } = {},
  ): Promise<SentPage> {
    const target = new URL(url);
    const hostname = normalizeRelayHostname(target.hostname);
    const portalHostname = normalizeRelayHostname(new URL(portalOrigin).hostname);
    if (!isPuEcampusDataFetchEnabled() &&
      (hostname === portalHostname || isPuEcampusDataHost(hostname))) {
      throw new PuCampusError('paused', PU_ECAMPUS_DATA_PAUSED_MESSAGE, {
        ...init.context,
        code: PU_ECAMPUS_DATA_PAUSED_CODE,
      });
    }
    const context = init.context || {};
    const cancelled = () => new PuCampusError('unavailable', '學校登入已取消', { ...context, code: 'CANCELLED' });
    const deadlineError = () => new PuCampusError('timeout', '學校系統無回應', {
      ...context, code: 'DEADLINE',
    });
    const waitMs = Math.min(init.timeoutMs ?? timeoutMs,
      init.deadline === undefined ? Infinity : init.deadline - Date.now());
    const hopDeadline = Date.now() + waitMs;
    const controller = new AbortController();
    const assertDeadline = () => {
      if (init.signal?.aborted) throw cancelled();
      if ((init.deadline !== undefined && Date.now() >= init.deadline) ||
          (init.strictCookies && (controller.signal.aborted || Date.now() >= hopDeadline))) {
        throw deadlineError();
      }
    };
    assertDeadline();
    let rejectDeadline: ((error: PuCampusError) => void) | undefined;
    const expired = init.strictCookies ? new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    }) : null;
    const timer = setTimeout(() => {
      // Strict identity evidence must settle even when the transport/body ignores abort.
      rejectDeadline?.(deadlineError());
      controller.abort();
    }, waitMs);
    let rejectCancellation: ((reason: PuCampusError) => void) | undefined;
    const cancellation = init.signal ? new Promise<never>((_, reject) => { rejectCancellation = reject; }) : null;
    // Keep cancellation effective even if a relay or response body ignores its
    // transport signal. Neither a late reply nor a fallback may revive login.
    const cancel = () => { controller.abort(); rejectCancellation?.(cancelled()); };
    const wait = <T>(promise: Promise<T>): Promise<T> => Promise.race([
      promise, ...(expired ? [expired] : []), ...(cancellation ? [cancellation] : []),
    ]);
    init.signal?.addEventListener('abort', cancel, { once: true });
    let receivedResponse = false;
    try {
      assertDeadline();
      const headers = new Headers(init.headers);
      headers.set('User-Agent', USER_AGENT);
      headers.set('Accept-Language', 'zh-TW,zh;q=0.9');
      const jar = init.strictCookies ? strictCookieValues(init.strictCookies, url)
        : (init.cookiesByOrigin ? init.cookiesByOrigin.get(target.origin) : init.cookies) ?? {};
      if (Object.keys(jar).length > 0) headers.set('Cookie', cookieHeader(jar));
      const read = async () => {
        assertDeadline();
        const response = await request(url, {
          method: init.method,
          headers,
          body: init.body,
          redirect: 'manual',
          signal: controller.signal,
        });
        receivedResponse = true;
        const receivedAt = Date.now();
        try { assertDeadline(); } catch (error) {
          void response.body?.cancel().catch(() => {});
          throw error;
        }
        const html = await response.text();
        assertDeadline();
        return { response, html, receivedAt };
      };
      const { response, html, receivedAt } = await wait(read());
      assertDeadline();
      const locationHeader = response.headers.get('location');
      const allowedOrigins = init.confineOrigins || (init.confineOrigin ? [init.confineOrigin] : null);
      const location = allowedOrigins
        ? rewriteAllowedCampusLocation(locationHeader, url, allowedOrigins)
        : locationHeader
          ? normalizeRelayTarget(new URL(locationHeader, url).toString()) ||
            new URL(locationHeader, url).toString()
          : null;
      if (init.strictCookies) mergeStrictTronClassCookies(init.strictCookies, response.headers, url, receivedAt, context);
      const cookies = init.strictCookies
        ? strictCookieValues(init.strictCookies, TRONCLASS_PROFILE_URL)
        : mergeCookies(jar, response.headers);
      init.cookiesByOrigin?.set(target.origin, cookies);
      let json: unknown = null;
      try { json = JSON.parse(html) as unknown; } catch { /* HTML responses remain valid in compatibility mode. */ }
      assertDeadline();
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        html,
        cookies,
        location,
        url,
        json,
      };
    } catch (error) {
      if (init.signal?.aborted) throw cancelled();
      const code = readErrorCode(error);
      throw classifyCampusFailure(error, {
        ...context,
        loginNotDelivered: init.initialTronClassLogin && !receivedResponse && !!code && PRE_CONNECTION_CODES.has(code),
      });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', cancel);
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
      cookiesByOrigin: Map<string, CookieJar>;
      method?: string;
      body?: string;
      headers?: HeadersInit;
      hops?: number;
      timeoutMs?: number;
      deadline?: number;
      context?: CampusErrorDetails;
      signal?: AbortSignal;
    },
  ): Promise<SentPage> {
    let current = url;
    let method = init.method;
    let body = init.body;
    let hops = init.hops ?? 8;
    let page = await send(current, {
      method,
      body,
      headers: init.headers,
      cookiesByOrigin: init.cookiesByOrigin,
      timeoutMs: init.timeoutMs,
      deadline: init.deadline,
      signal: init.signal,
      context: init.context,
      confineOrigins: lmsAllowedOrigins,
    });
    while ([301, 302, 303, 307, 308].includes(page.status) && page.location && hops > 0) {
      current = page.location;
      if (page.status !== 307 && page.status !== 308) {
        method = 'GET';
        body = undefined;
      }
      page = await send(current, {
        method,
        body,
        headers: init.headers,
        cookiesByOrigin: init.cookiesByOrigin,
        timeoutMs: init.timeoutMs,
        deadline: init.deadline,
        signal: init.signal,
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
      cookiesByOrigin: Map<string, CookieJar>;
      body: string;
      headers?: HeadersInit;
      hops?: number;
      timeoutMs?: number;
      deadline?: number;
      context?: CampusErrorDetails;
      signal?: AbortSignal;
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
    let hops = init.hops ?? 8;
    let carryingPassword = true;
    let page = await send(current, {
      method: 'POST',
      body: init.body,
      headers: init.headers,
      cookiesByOrigin: init.cookiesByOrigin,
      timeoutMs: init.timeoutMs,
      deadline: init.deadline,
      signal: init.signal,
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
        page = await send(current, {
          method: 'POST',
          body: init.body,
          headers: init.headers,
          cookiesByOrigin: init.cookiesByOrigin,
          timeoutMs: init.timeoutMs,
          deadline: init.deadline,
          signal: init.signal,
          context: init.context,
          confineOrigins: lmsAllowedOrigins,
        });
        hops -= 1;
        continue;
      }
      if (!page.location) break;
      carryingPassword = false;
      current = page.location;
      page = await send(current, {
        method: 'GET',
        headers: init.headers,
        cookiesByOrigin: init.cookiesByOrigin,
        timeoutMs: init.timeoutMs,
        deadline: init.deadline,
        signal: init.signal,
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
    deadline?: number,
    signal?: AbortSignal,
    requireStudentIdentityEvidence = false,
    strictCookies?: StrictTronClassCookies,
  ): Promise<TronClassSession | null> {
    const profilePage = await send(`${lmsOrigin}/api/profile`, {
      cookies,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${lmsOrigin}/user/index`,
      },
      timeoutMs: timeoutMsRemaining,
      deadline,
      signal,
      context: { route, stage: 'verify' },
      strictCookies,
    });
    if (profilePage.status === 401 || profilePage.status === 403 || profilePage.status === 302) {
      if (unauthorized === 'credentials') {
        throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
      }
      return null;
    }
    const profileData = authenticatedJson(profilePage);
    if (requireStudentIdentityEvidence) {
      // The general compatibility parser may recover IDs from the login response or HTML.
      // That is not sufficient evidence for a new account identity.
      const evidence = profilePage.status === 200 &&
        profilePage.url === TRONCLASS_ORIGIN + '/api/profile' &&
        /^application\/json(?:\s*;|$)/i.test(profilePage.contentType ?? '') &&
        Object.keys(profilePage.cookies).filter(key => key.toLowerCase() === 'session').length === 1 &&
        typeof profilePage.cookies.session === 'string' && /^[\x21-\x3a\x3c-\x7e]+$/u.test(profilePage.cookies.session)
        ? parseTronClassStudentIdentityEvidence(profileData, account) : null;
      if (!evidence) return null;
      return {
        cookies: profilePage.cookies,
        userId: Number(evidence.subject),
        userName: displayNameFrom(profileData!, account),
        role: '', // LMS profile evidence does not establish school membership or any role.
        identityEvidence: evidence,
      };
    }
    if (profileData && identityBelongsToAccount(account, profileData)) {
      return {
        // The authenticated profile response may rotate the session or issue
        // the XSRF token needed by later LMS requests. Keep that latest jar.
        cookies: profilePage.cookies,
        userId: userIdFrom(profileData) ?? userIdFrom(loginData),
        userName: displayNameFrom(profileData, account),
        role: roleFrom(profileData),
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
          studentId: studentNumberOnPage(verify, portalOrigin),
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
          studentId: studentNumberOnPage(page, portalOrigin) ?? null,
          name: page.html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/)?.[1] ?? null,
          class: page.html.match(/班級\(Class\)[：:]\s*([^\s<]+)/)?.[1] ?? null,
        };
      } catch (error) {
        throw classifyCampusFailure(error);
      }
    },

    async loginTronClass(account, password, options = {}) {
      const started = Date.now();
      const strict = options.requireStudentIdentityEvidence === true;
      const strictCookies: StrictTronClassCookies | undefined = strict ? new Map() : undefined;
      const budget = strict ? options.timeoutMs ?? DEFAULT_TIMEOUT_MS : options.timeoutMs;
      const deadline = budget === undefined ? undefined : started + budget;
      const hopCap = options.hopTimeoutMs ?? timeoutMs;
      const leftover = () => (budget == null ? hopCap : budget - (Date.now() - started));
      const route = options.route || 'teacher';
      const remaining = (stage: CampusLoginStage) => {
        if (options.signal?.aborted) {
          throw new PuCampusError('unavailable', '學校登入已取消', { route, stage, code: 'CANCELLED' });
        }
        const available = leftover();
        if (available <= 0) {
          throw new PuCampusError('timeout', '學校系統無回應', { route, stage, code: 'DEADLINE' });
        }
        return Math.min(hopCap, available);
      };
      try {
        if (strict && (lmsOrigin !== TRONCLASS_ORIGIN || identityOrigin !== IDENTITY_ORIGIN ||
            route !== 'student' || typeof account !== 'string' || account.length > 128 ||
            !canonicalizePuStudentId(account) || typeof password !== 'string' || !password ||
            password.length > 1024 || typeof budget !== 'number' || !Number.isSafeInteger(budget) ||
            budget <= 0 || budget > 60_000 || !Number.isSafeInteger(hopCap) || hopCap <= 0)) {
          throw new PuCampusError('unverified', '目前無法驗證校園帳號', { route, stage: 'verify', code: 'IDENTITY_EVIDENCE_UNAVAILABLE' });
        }
        const posted = await send(`${lmsOrigin}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ user_name: account, password }),
          timeoutMs: remaining('submit'),
          deadline,
          signal: options.signal,
          context: { route, stage: 'submit' },
          strictCookies,
          initialTronClassLogin: true,
        });
        if (posted.status === 200 && isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        if (posted.status === 200 && sessionCookieValue(posted.cookies)) {
          if (strict && leftover() <= 0) throw new PuCampusError('timeout', '學校系統無回應', {
            route, stage: 'verify', code: 'DEADLINE',
          });
          const loginData = asRecord(posted.json);
          const session = await readTronClassProfile(
            posted.cookies,
            account,
            loginData,
            route,
            remaining('verify'),
            'credentials',
            deadline,
            options.signal,
            strict,
            strictCookies,
          );
          if (session) { remaining('verify'); return session; }
          throw new PuCampusError('unverified', strict ? '目前無法驗證校園帳號' : '暫時無法驗證老師身分', {
            route, stage: 'verify', ...(strict ? { code: 'IDENTITY_EVIDENCE_UNAVAILABLE' } : {}),
          });
        }
        // Origin-isolated CAS compatibility is still not identity evidence for
        // the explicit student candidate mode, which only accepts a native profile.
        if (strict) throw new PuCampusError('unverified', '目前無法驗證校園帳號', {
          route, stage: 'verify', code: 'IDENTITY_EVIDENCE_UNAVAILABLE',
        });
        const nativeFallback = new PuCampusError('unavailable', '學校系統無回應', {
          route,
          stage: 'submit',
          code: `HTTP_${posted.status}`,
        });

        if (leftover() < CAS_MIN_REMAINING_MS) {
          throw nativeFallback;
        }

        const cookiesByOrigin = new Map<string, CookieJar>();
        const loginPage = await followLms(`${lmsOrigin}/login?next=/user/index`, {
          cookiesByOrigin,
          headers: { Accept: 'text/html' },
          hops: 5,
          timeoutMs: remaining('redirect'),
          deadline,
          signal: options.signal,
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
          cookiesByOrigin,
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${identityOrigin}/`,
          },
          hops: 8,
          timeoutMs: remaining('submit'),
          deadline,
          signal: options.signal,
          context: { route, stage: 'submit' },
        });
        if (isCredentialPage(postedCas.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        const indexPage =
          postedCas.status === 200 && isTronClassUserIndexUrl(postedCas.url)
            ? postedCas
            : await followLms(`${lmsOrigin}/user/index`, {
                cookiesByOrigin,
                headers: { Accept: 'text/html' },
                hops: 3,
                timeoutMs: remaining('verify'),
                deadline,
                signal: options.signal,
                context: { route, stage: 'verify' },
              });
        if (isCredentialPage(indexPage.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
        }
        if (isCasLoginBounce(indexPage.html)) {
          throw new PuCampusError('unavailable', '學校系統無回應', { route, stage: 'verify' });
        }
        const lmsCookies = cookiesByOrigin.get(new URL(lmsOrigin).origin) ?? {};
        const casSession =
          isTronClassUserIndexUrl(indexPage.url) && Object.keys(lmsCookies).length > 0
            ? {
                cookies: lmsCookies,
                userId: parseTronClassUserIdFromHtml(indexPage.html),
                userName: parseTronClassUserNameFromHtml(indexPage.html, account),
                role: route === 'student' ? 'student' : '',
              }
            : null;
        const profileWait = leftover();
        if (profileWait >= LMS_PROFILE_MIN_REMAINING_MS) {
          try {
            const verified = await readTronClassProfile(
              lmsCookies,
              account,
              {},
              route,
              Math.min(LMS_PROFILE_TIMEOUT_MS, profileWait),
              'missing',
              deadline,
              options.signal,
            );
            if (verified) { remaining('verify'); return verified; }
          } catch (error) {
            const timedOut = error instanceof PuCampusError && error.kind === 'timeout';
            if (!timedOut || !casSession) throw error;
          }
        }
        if (casSession) {
          remaining('verify');
          return casSession;
        }
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
