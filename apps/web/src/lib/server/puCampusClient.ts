import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

const ALCAT_ORIGIN = 'https://alcat.pu.edu.tw';
const TRONCLASS_ORIGIN = 'https://tronclass.pu.edu.tw';
const DEFAULT_TIMEOUT_MS = 10_000;
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
};

export type TronClassCourse = {
  name: string;
  role: string;
  teachers: Array<{ name?: string }>;
};

export type TronClassLoginOptions = {
  timeoutMs?: number;
  route?: CampusLoginRoute;
};

export type PuCampusGateway = {
  loginStudent: (studentId: string, password: string) => Promise<StudentCampusLogin>;
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

export function rewriteCampusPortalLocation(
  location: string | null | undefined,
  requestUrl: string,
  portalOrigin: string,
): string | null {
  if (!location) return null;
  try {
    const target = new URL(location, requestUrl);
    const portal = new URL(portalOrigin);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (target.username || target.password) return null;
    if (target.hostname.toLowerCase() !== portal.hostname.toLowerCase() || target.port !== portal.port) {
      return null;
    }
    target.protocol = 'https:';
    target.hash = '';
    return target.toString();
  } catch {
    return null;
  }
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { code?: unknown; cause?: unknown; name?: unknown };
  if (typeof record.code === 'string' && record.code.trim()) return record.code;
  const cause = record.cause;
  if (cause && typeof cause === 'object') {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string' && nested.trim()) return nested;
  }
  if (record.name === 'AbortError' || record.name === 'TimeoutError') return String(record.name);
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
  return /帳號或密碼錯誤|login_fail|Login Failed|密碼錯誤|_INVALID_PASSWORD_/.test(
    stripIgnoredHtml(html),
  );
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

export function classifyCampusFailure(error: unknown, details: CampusErrorDetails = {}): PuCampusError {
  if (error instanceof PuCampusError) {
    return new PuCampusError(error.kind, error.message, {
      route: error.route || details.route,
      stage: error.stage || details.stage,
      code: error.code || details.code || readErrorCode(error),
    });
  }
  const name = error instanceof Error ? error.name : '';
  const code = details.code || readErrorCode(error);
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new PuCampusError('timeout', '學校系統無回應', { ...details, code: code || name });
  }
  return new PuCampusError('unavailable', '學校系統無回應', { ...details, code });
}

export function createPuCampusGateway(
  options: { fetch?: FetchLike; timeoutMs?: number; portalOrigin?: string; lmsOrigin?: string } = {},
): PuCampusGateway {
  const request = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const portalOrigin = options.portalOrigin || ALCAT_ORIGIN;
  const lmsOrigin = options.lmsOrigin || TRONCLASS_ORIGIN;

  async function send(
    url: string,
    init: RequestInit & {
      cookies?: CookieJar;
      timeoutMs?: number;
      context?: CampusErrorDetails;
      confineOrigin?: string;
    } = {},
  ): Promise<SentPage> {
    const waitMs = init.timeoutMs ?? timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    const context = init.context || {};
    try {
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
      const locationHeader = response.headers.get('location');
      const location = init.confineOrigin
        ? rewriteCampusPortalLocation(locationHeader, url, init.confineOrigin)
        : locationHeader
          ? new URL(locationHeader, url).toString()
          : null;
      return {
        status: response.status,
        html,
        cookies: mergeCookies(init.cookies || {}, response.headers),
        location,
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
    let remaining = hops;
    while ((page.status === 301 || page.status === 302) && page.location && remaining > 0) {
      current = page.location;
      jar = page.cookies;
      page = await send(current, { cookies: jar, context, confineOrigin: portalOrigin });
      remaining -= 1;
    }
    return page;
  }

  return {
    async loginStudent(studentId, password) {
      const student = { route: 'student' as const };
      try {
        const warmup = await send(`${portalOrigin}/`, {
          context: { ...student, stage: 'home' },
          confineOrigin: portalOrigin,
        });
        if (isClosedPage(warmup.html)) {
          throw new PuCampusError('closed', '尚未開放', { ...student, stage: 'home' });
        }
        const body = `uid=${encodeURIComponent(studentId)}&upassword=${encodeURIComponent(password)}&en_flag=zh`;
        const posted = await send(`${portalOrigin}/index_check.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          cookies: warmup.cookies,
          context: { ...student, stage: 'submit' },
          confineOrigin: portalOrigin,
        });
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
            ? (await getFollow(posted.location, posted.cookies, 3, { ...student, stage: 'redirect' }))
                .cookies
            : posted.cookies;
        const verify = await getFollow(
          `${portalOrigin}/stu_query/query_course.html`,
          sessionCookies,
          3,
          { ...student, stage: 'verify' },
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
      const remaining = () =>
        budget == null ? timeoutMs : Math.max(1, budget - (Date.now() - started));
      const route = options.route || 'teacher';
      try {
        const posted = await send(`${lmsOrigin}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ user_name: account, password }),
          timeoutMs: remaining(),
          context: { route, stage: 'submit' },
        });
        if (posted.status === 400 || isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        if (posted.status !== 200) {
          throw new PuCampusError('unavailable', '學校系統無回應', { route, stage: 'submit' });
        }
        // HTTP 200 不夠：原生 API 可能回 200 JSON 卻沒有 session cookie。
        if (!sessionCookieValue(posted.cookies)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'submit' });
        }
        const loginData = asRecord(posted.json);
        const profilePage = await send(`${lmsOrigin}/api/profile`, {
          cookies: posted.cookies,
          headers: { Accept: 'application/json' },
          timeoutMs: remaining(),
          context: { route, stage: 'verify' },
        });
        if (profilePage.status === 401 || profilePage.status === 403 || profilePage.status === 302) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
        }
        const profileData = authenticatedJson(profilePage);
        if (profileData && identityBelongsToAccount(account, profileData)) {
          return {
            cookies: posted.cookies,
            userId: userIdFrom(profileData) ?? userIdFrom(loginData),
            userName: displayNameFrom(profileData, account),
            role: roleFrom(profileData),
          };
        }
        if (profileData) {
          throw new PuCampusError('credentials', '學號或密碼錯誤', { route, stage: 'verify' });
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
