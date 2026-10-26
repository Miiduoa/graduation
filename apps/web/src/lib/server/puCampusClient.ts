const ALCAT_ORIGIN = 'https://alcat.pu.edu.tw';
const TRONCLASS_ORIGIN = 'https://tronclass.pu.edu.tw';
const DEFAULT_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type CampusErrorKind = 'credentials' | 'timeout' | 'closed' | 'unavailable';

export class PuCampusError extends Error {
  readonly kind: CampusErrorKind;

  constructor(kind: CampusErrorKind, message: string) {
    super(message);
    this.name = 'PuCampusError';
    this.kind = kind;
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

export type PuCampusGateway = {
  loginStudent: (studentId: string, password: string) => Promise<StudentCampusLogin>;
  fetchStudentInfo: (cookies: CookieJar) => Promise<StudentCampusInfo>;
  loginTronClass: (account: string, password: string) => Promise<TronClassSession>;
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

function looksLikeLoginPage(html: string): boolean {
  const normalized = html.toLowerCase();
  return (
    normalized.includes('action="index_check.php"') ||
    normalized.includes("action='index_check.php'") ||
    (normalized.includes('name="uid"') && normalized.includes('name="upassword"'))
  );
}

function hasStudentContext(html: string): boolean {
  return (
    html.includes('學號(Student No.)') ||
    html.includes('姓名(Student Name)') ||
    html.includes('query_course')
  );
}

function isClosedPage(html: string): boolean {
  return /尚未開放|系統維護|暫停服務|暫時關閉/.test(html);
}

function isCredentialPage(html: string): boolean {
  return /帳號或密碼錯誤|login_fail|Login Failed|密碼錯誤|_INVALID_PASSWORD_/.test(html);
}

export function classifyCampusFailure(error: unknown): PuCampusError {
  if (error instanceof PuCampusError) return error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new PuCampusError('timeout', '學校系統無回應');
  }
  return new PuCampusError('unavailable', '學校系統無回應');
}

export function createPuCampusGateway(
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): PuCampusGateway {
  const request = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(url: string, init: RequestInit & { cookies?: CookieJar } = {}): Promise<SentPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set('User-Agent', USER_AGENT);
      headers.set('Accept-Language', 'zh-TW,zh;q=0.9');
      if (init.cookies && Object.keys(init.cookies).length > 0) {
        headers.set('Cookie', cookieHeader(init.cookies));
      }
      const response = await request(url, {
        ...init,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      const html = await response.text();
      const locationHeader = response.headers.get('location');
      return {
        status: response.status,
        html,
        cookies: mergeCookies(init.cookies || {}, response.headers),
        location: locationHeader ? new URL(locationHeader, url).toString() : null,
        json: (() => {
          try {
            return JSON.parse(html) as unknown;
          } catch {
            return null;
          }
        })(),
      };
    } catch (error) {
      throw classifyCampusFailure(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getFollow(url: string, cookies: CookieJar, hops = 3): Promise<SentPage> {
    let current = url;
    let jar = cookies;
    let page = await send(current, { cookies: jar });
    let remaining = hops;
    while ((page.status === 301 || page.status === 302) && page.location && remaining > 0) {
      current = page.location;
      jar = page.cookies;
      page = await send(current, { cookies: jar });
      remaining -= 1;
    }
    return page;
  }

  return {
    async loginStudent(studentId, password) {
      try {
        const warmup = await send(`${ALCAT_ORIGIN}/`);
        if (isClosedPage(warmup.html)) {
          throw new PuCampusError('closed', '尚未開放');
        }
        const body = `uid=${encodeURIComponent(studentId)}&upassword=${encodeURIComponent(password)}&en_flag=zh`;
        const posted = await send(`${ALCAT_ORIGIN}/index_check.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          cookies: warmup.cookies,
        });
        if (isClosedPage(posted.html)) {
          throw new PuCampusError('closed', '尚未開放');
        }
        if (isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤');
        }
        if (posted.status !== 200 && posted.status !== 302) {
          throw new PuCampusError('unavailable', '學校系統無回應');
        }
        const sessionCookies =
          posted.status === 302 && posted.location
            ? (await getFollow(posted.location, posted.cookies)).cookies
            : posted.cookies;
        const verify = await getFollow(`${ALCAT_ORIGIN}/stu_query/query_course.html`, sessionCookies);
        if (isClosedPage(verify.html)) {
          throw new PuCampusError('closed', '尚未開放');
        }
        if (
          verify.status !== 200 ||
          looksLikeLoginPage(verify.html) ||
          !hasStudentContext(verify.html)
        ) {
          throw new PuCampusError('credentials', '學號或密碼錯誤');
        }
        const nameMatch =
          verify.html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/) ||
          verify.html.match(/([^\s<]+)同學您好/);
        return {
          cookies: verify.cookies,
          studentName: nameMatch?.[1],
        };
      } catch (error) {
        throw classifyCampusFailure(error);
      }
    },

    async fetchStudentInfo(cookies) {
      try {
        const page = await getFollow(`${ALCAT_ORIGIN}/stu_query/query_course.html`, cookies);
        if (isClosedPage(page.html)) {
          throw new PuCampusError('closed', '尚未開放');
        }
        if (looksLikeLoginPage(page.html) || !hasStudentContext(page.html)) {
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

    async loginTronClass(account, password) {
      try {
        const posted = await send(`${TRONCLASS_ORIGIN}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ user_name: account, password }),
        });
        if (posted.status === 400 || isCredentialPage(posted.html)) {
          throw new PuCampusError('credentials', '學號或密碼錯誤');
        }
        if (posted.status !== 200) {
          throw new PuCampusError('unavailable', '學校系統無回應');
        }
        const data =
          posted.json && typeof posted.json === 'object'
            ? (posted.json as Record<string, unknown>)
            : {};
        const nested =
          data.user && typeof data.user === 'object' ? (data.user as Record<string, unknown>) : {};
        const userIdRaw = data.user_id ?? data.id ?? data.userId ?? nested.id ?? nested.user_id;
        const userName = String(
          data.name ?? data.user_name ?? data.display_name ?? nested.name ?? account,
        ).trim();
        const role = String(data.role ?? nested.role ?? '').toLowerCase();
        return {
          cookies: posted.cookies,
          userId: typeof userIdRaw === 'number' ? userIdRaw : Number(userIdRaw) || null,
          userName,
          role,
        };
      } catch (error) {
        throw classifyCampusFailure(error);
      }
    },

    async fetchTronClassCourses(session) {
      try {
        const posted = await send(`${TRONCLASS_ORIGIN}/api/my-courses`, {
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
