import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import {
  campusPageHasLoginForm,
  campusPageLooksClosed,
  createPuCampusGateway,
  isCasPasswordPostUrl,
  PuCampusError,
  rewriteAllowedCampusLocation,
  rewriteCampusPortalLocation,
} from './puCampusClient';

const fixture = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8');
const ALCAT_LOGIN_HTML = fixture('alcat-login.html');
const ALCAT_MAINTENANCE_HTML = fixture('alcat-maintenance.html');
const TRONCLASS_CAS_LOGIN_HTML = fixture('tronclass-cas-login.html');
const TRONCLASS_CAS_TRONCLASS_ACTION_HTML = fixture('tronclass-cas-login-tronclass-action.html');
const MYPU_NOT_LOGGED_IN_HTML = fixture('mypu-not-logged-in.html');

const STUDENT = '1110700321';
const SECRET = 'super-secret-pass';

function htmlResponse(status: number, html: string, headers?: Record<string, string>) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html', ...headers } });
}

it('classifies credential errors without echoing the password', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (String(url).endsWith('/')) return htmlResponse(200, '<html>ok</html>');
    return htmlResponse(200, '帳號或密碼錯誤 login_fail');
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'credentials',
    message: '學號或密碼錯誤',
  });
  const bodies = fetchMock.mock.calls.map(([, init]) => String(init?.body || ''));
  expect(bodies.some((body) => body.includes(SECRET))).toBe(true);
  try {
    await gateway.loginStudent(STUDENT, SECRET);
    throw new Error('should not succeed');
  } catch (error) {
    expect(error).toBeInstanceOf(PuCampusError);
    expect(String(error)).not.toContain(SECRET);
  }
});

it('classifies a closed portal as 尚未開放', async () => {
  const gateway = createPuCampusGateway({
    fetch: async () => htmlResponse(200, '系統維護中，尚未開放'),
  });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({ kind: 'closed' });
});

it('does not treat the live alcat login page as maintenance', async () => {
  expect(ALCAT_LOGIN_HTML).toContain('<!-- 系統維護公告 -->');
  expect(ALCAT_LOGIN_HTML).toContain('name="uid"');
  expect(ALCAT_LOGIN_HTML).toContain('placeholder="帳號"');
  expect(ALCAT_LOGIN_HTML).not.toMatch(/name="uid"[^>]*maxlength=/i);
  expect(ALCAT_LOGIN_HTML).not.toMatch(/name="uid"[^>]*pattern=/i);
  expect(ALCAT_LOGIN_HTML).toContain('name="upassword"');
  expect(ALCAT_LOGIN_HTML).not.toMatch(/upassword=[^"'\s>]+/);
  expect(campusPageHasLoginForm(ALCAT_LOGIN_HTML)).toBe(true);
  expect(campusPageLooksClosed(ALCAT_LOGIN_HTML)).toBe(false);

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) === 'https://alcat.pu.edu.tw/' || !init?.method) {
      return htmlResponse(200, ALCAT_LOGIN_HTML);
    }
    return htmlResponse(200, '帳號或密碼錯誤 login_fail');
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'credentials',
  });
  const posted = fetchMock.mock.calls.find(([url, init]) =>
    String(url).endsWith('/index_check.php') && String(init?.method || '').toUpperCase() === 'POST',
  );
  expect(posted).toBeTruthy();
  expect(String(posted?.[1]?.body || '')).toContain(`upassword=${encodeURIComponent(SECRET)}`);
});

it('treats a visible maintenance page without a login form as closed', async () => {
  expect(campusPageHasLoginForm(ALCAT_MAINTENANCE_HTML)).toBe(false);
  expect(campusPageLooksClosed(ALCAT_MAINTENANCE_HTML)).toBe(true);
  const fetchMock = vi.fn(async (_url: string) => htmlResponse(200, ALCAT_MAINTENANCE_HTML));
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'closed',
    message: '尚未開放',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/index_check.php'))).toBe(false);
});

it('ignores maintenance wording inside comments or scripts when the login form is present', () => {
  const html = `
    <!-- 系統維護公告 尚未開放 暫停服務 暫時關閉 -->
    <script>document.write('系統維護中，尚未開放');</script>
    <style>.note::after { content: '暫停服務'; }</style>
    <form action="index_check.php" method="POST">
      <input name="uid"><input name="upassword">
    </form>
  `;
  expect(campusPageLooksClosed(html)).toBe(false);
  expect(campusPageHasLoginForm(html)).toBe(true);
});

it('ignores maintenance wording inside script and style tags with messy closing tags', () => {
  const html = `
    <script>document.write('系統維護中，尚未開放')</script >
    <script type="text/javascript">alert('暫停服務')</script
 foo>
    <SCRIPT>尚未開放</SCRIPT>
    <style type="text/css">.x{content:'暫時關閉'}</style >
    <form action="index_check.php" method="POST">
      <input name="uid"><input name="upassword">
    </form>
  `;
  expect(campusPageLooksClosed(html)).toBe(false);
  expect(campusPageHasLoginForm(html)).toBe(true);
});

it('still treats a visible maintenance page as closed when leftover script closers are messy', () => {
  const html = `
    <script>console.log('ok')</script >
    <p>系統維護中，尚未開放</p>
  `;
  expect(campusPageHasLoginForm(html)).toBe(false);
  expect(campusPageLooksClosed(html)).toBe(true);
});

it('does not filter script or style tags with a regular expression', () => {
  const source = readFileSync(fileURLToPath(import.meta.url).replace(/\.test\.ts$/, '.ts'), 'utf8');
  expect(source).toContain('parseFragment');
  expect(source).not.toContain('<script\\b');
  expect(source.toLowerCase()).not.toContain('</script>');
  expect(source.toLowerCase()).not.toContain('</style>');
});

it('does not classify a bounced login page as maintenance after submit', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const href = String(url);
    if (href.includes('/stu_query/query_course.html')) {
      return htmlResponse(
        200,
        '<html><body>您尚未登入系統或已逾時，請重新登入。</body></html>',
      );
    }
    return htmlResponse(200, ALCAT_LOGIN_HTML);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'credentials',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/index_check.php'))).toBe(true);
});

it('accepts a student portal page that still has the maintenance HTML comment', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === 'https://alcat.pu.edu.tw/' && !init?.method) {
      return htmlResponse(200, ALCAT_LOGIN_HTML, { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    if (href.endsWith('/index_check.php')) {
      return htmlResponse(200, '<html>ok</html>', { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    return htmlResponse(
      200,
      `<!-- 系統維護公告 -->
       <html><body>學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 query_course</body></html>`,
    );
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).resolves.toMatchObject({
    studentName: '陳同學',
    cookies: { PHPSESSID: 'abc' },
  });
});

it('still treats a post-login visible maintenance page without a form as closed', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === 'https://alcat.pu.edu.tw/' && !init?.method) {
      return htmlResponse(200, ALCAT_LOGIN_HTML);
    }
    if (href.endsWith('/index_check.php')) {
      return htmlResponse(200, '<html>ok</html>');
    }
    return htmlResponse(200, ALCAT_MAINTENANCE_HTML);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({ kind: 'closed' });
});

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

it('rejects TronClass HTTP 200 that has user JSON but no session cookie after CAS also fails', async () => {
  const gateway = createPuCampusGateway({
    fetch: async () =>
      jsonResponse(200, { id: 44, name: '王老師', role: 'teacher', user_name: 'changyi' }),
  });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'unavailable',
    code: 'HTTP_200',
  });
});

it('rejects TronClass HTTP 200 with a session cookie when the profile is not this account', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/login')) {
      return jsonResponse(
        200,
        { id: 44, name: '王老師', role: 'teacher', user_name: 'changyi' },
        { 'set-cookie': 'session=tc-cookie; Path=/' },
      );
    }
    return jsonResponse(200, { id: 99, name: '別人', login_name: 'other' });
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'credentials',
  });
});

it('rejects TronClass HTTP 200 when the session cannot call an authenticated API', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/login')) {
      return jsonResponse(
        200,
        { id: 44, name: '王老師', role: 'teacher' },
        { 'set-cookie': 'session=dead; Path=/' },
      );
    }
    if (String(url).endsWith('/api/profile')) {
      return jsonResponse(401, { message: '' });
    }
    return htmlResponse(200, '<html><form>login</form></html>');
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'credentials',
  });
});

it('does not treat login JSON echoing the requested user_name as identity when profile is missing', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/login')) {
      return jsonResponse(
        200,
        { id: 44, name: '王老師', role: 'teacher', user_name: 'changyi' },
        { 'set-cookie': 'session=tc-cookie; Path=/' },
      );
    }
    if (String(url).endsWith('/api/profile')) {
      return jsonResponse(404, { message: 'not found' });
    }
    if (String(url).endsWith('/api/my-courses')) {
      return jsonResponse(200, { courses: [{ name: '資料庫', role: 'teacher' }] });
    }
    throw new Error(`unexpected ${url}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'unverified',
    message: '暫時無法驗證老師身分',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/my-courses'))).toBe(false);
});

it('returns unverified when profile exists but is not JSON', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/login')) {
      return jsonResponse(
        200,
        { id: 44, name: '王老師', role: 'teacher', user_name: 'changyi' },
        { 'set-cookie': 'session=tc-cookie; Path=/' },
      );
    }
    return htmlResponse(200, '<html>profile</html>');
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'unverified',
    message: '暫時無法驗證老師身分',
  });
});

it('accepts TronClass login only after profile returns this account', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/login')) {
      return jsonResponse(
        200,
        { id: 44, name: '王老師', role: 'teacher' },
        { 'set-cookie': 'session=tc-cookie; Path=/' },
      );
    }
    if (String(url).endsWith('/api/profile')) {
      return jsonResponse(200, {
        id: 44,
        name: '王老師',
        login_name: 'changyi',
        role: 'teacher',
      });
    }
    throw new Error(`unexpected ${url}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).resolves.toMatchObject({
    userId: 44,
    userName: '王老師',
    role: 'teacher',
    cookies: { session: 'tc-cookie' },
  });
});

it('reads student info even if the portal HTML still has a maintenance comment', async () => {
  const gateway = createPuCampusGateway({
    fetch: async () =>
      htmlResponse(
        200,
        `<!-- 系統維護公告 -->學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 班級(Class): 資管三A query_course`,
      ),
  });
  await expect(gateway.fetchStudentInfo({ PHPSESSID: 'abc' })).resolves.toMatchObject({
    studentId: STUDENT,
    name: '陳同學',
    class: '資管三A',
  });
});

it('does not treat an expired session notice as maintenance', async () => {
  expect(campusPageLooksClosed(MYPU_NOT_LOGGED_IN_HTML)).toBe(false);
  const gateway = createPuCampusGateway({
    fetch: async () => htmlResponse(200, MYPU_NOT_LOGGED_IN_HTML),
  });
  await expect(gateway.fetchStudentInfo({ PHPSESSID: 'dead' })).resolves.toEqual({});
});

it('maps an aborted external request to timeout', async () => {
  const gateway = createPuCampusGateway({
    timeoutMs: 20,
    fetch: (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'timeout',
    message: '學校系統無回應',
    route: 'student',
    stage: 'home',
    code: 'AbortError',
  });
});

it('does not treat TronClass HTTP 400 as a credential error', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/login')) return jsonResponse(400, { message: 'bad request' });
    return htmlResponse(200, '<html>no form</html>');
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET, { route: 'student' })).rejects.toMatchObject({
    kind: 'unavailable',
    code: 'HTTP_400',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/login?next='))).toBe(true);
});

it('falls back to identity CAS when native TronClass login returns 400', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    if (href.endsWith('/api/login') && method === 'POST') {
      return jsonResponse(400, { error: 'native login disabled' });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
      return new Response('', {
        status: 302,
        headers: {
          Location:
            'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login?service=https://tronclass.pu.edu.tw/login',
        },
      });
    }
    if (href.startsWith('https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login')) {
      return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    }
    if (href.includes('/login-actions/authenticate') && method === 'POST') {
      expect(href).toContain('session_code=fixtureSessionCode');
      expect(String(init?.body || '')).toContain(`username=${encodeURIComponent('changyi')}`);
      expect(String(init?.body || '')).toContain(`password=${encodeURIComponent(SECRET)}`);
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture',
          'set-cookie': 'KEYCLOAK_IDENTITY=kc; Path=/',
        },
      });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/user/index')) {
      return htmlResponse(200, '<html><body>ok</body></html>', {
        'set-cookie': 'session=tc-cas; Path=/',
      });
    }
    if (href.endsWith('/api/profile')) {
      return jsonResponse(200, {
        id: 44,
        name: '王老師',
        login_name: 'changyi',
        role: 'teacher',
      });
    }
    throw new Error(`unexpected ${href}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).resolves.toMatchObject({
    userId: 44,
    userName: '王老師',
    role: 'teacher',
    cookies: expect.objectContaining({ session: 'tc-cas' }),
  });
  expect(
    fetchMock.mock.calls.filter(([url]) => {
      try {
        return new URL(String(url)).pathname === '/user/index';
      } catch {
        return false;
      }
    }),
  ).toHaveLength(1);
  const profile = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/profile'));
  expect(new Headers(profile?.[1]?.headers).get('X-Requested-With')).toBe('XMLHttpRequest');
  expect(new Headers(profile?.[1]?.headers).get('Referer')).toBe('https://tronclass.pu.edu.tw/user/index');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('evil'))).toBe(false);
});

it('keeps a CAS student session when /api/profile aborts after /user/index', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    if (href.endsWith('/api/login') && method === 'POST') {
      return jsonResponse(400, { error: 'native login disabled' });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login',
        },
      });
    }
    if (href.startsWith('https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login')) {
      return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    }
    if (href.includes('/login-actions/authenticate') && method === 'POST') {
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture',
        },
      });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/user/index')) {
      return htmlResponse(
        200,
        '<html><body><input id="userId" value="57"><span class="user-name">陳同學</span></body></html>',
        { 'set-cookie': 'session=tc-cas; Path=/' },
      );
    }
    if (href.endsWith('/api/profile')) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
    throw new Error(`unexpected ${method} ${href}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET, { route: 'student' })).resolves.toMatchObject({
    userId: 57,
    userName: '陳同學',
    role: 'student',
    cookies: expect.objectContaining({ session: 'tc-cas' }),
  });
  expect(
    fetchMock.mock.calls.filter(([url]) => {
      try {
        return new URL(String(url)).pathname === '/user/index';
      } catch {
        return false;
      }
    }),
  ).toHaveLength(1);
  expect(casFormPasswordPosts(fetchMock).every(([url]) => String(url).includes('identity.pu.edu.tw'))).toBe(
    true,
  );
});

it('maps Keycloak credential errors after CAS fallback, not the native 400', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    if (href.endsWith('/api/login')) return jsonResponse(400, { message: 'bad request' });
    if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
      return new Response('', {
        status: 302,
        headers: { Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login' },
      });
    }
    if (method === 'GET' && href.includes('identity.pu.edu.tw')) {
      return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    }
    if (method === 'POST' && href.includes('identity.pu.edu.tw')) {
      return htmlResponse(200, '<span id="error-message">無效的使用者名稱或密碼</span>');
    }
    throw new Error(`unexpected ${href}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'credentials',
    message: '學號或密碼錯誤',
  });
});

it('allows CAS password POST only to https identity.pu.edu.tw', () => {
  expect(isCasPasswordPostUrl('https://identity.pu.edu.tw/auth/realms/pu/login-actions/authenticate')).toBe(
    true,
  );
  expect(isCasPasswordPostUrl('https://identity.pu.edu.tw:443/login')).toBe(true);
  expect(isCasPasswordPostUrl('https://Identity.PU.edu.tw/login')).toBe(true);
  expect(isCasPasswordPostUrl('http://identity.pu.edu.tw/login')).toBe(false);
  expect(isCasPasswordPostUrl('https://identity.pu.edu.tw:8443/login')).toBe(false);
  expect(isCasPasswordPostUrl('https://tronclass.pu.edu.tw/login')).toBe(false);
  expect(isCasPasswordPostUrl('https://identity.pu.edu.tw.evil.test/login')).toBe(false);
  expect(isCasPasswordPostUrl('https://user:pass@identity.pu.edu.tw/login')).toBe(false);
});

function casFormPasswordPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => {
    const method = String(init?.method || 'GET').toUpperCase();
    const body = String(init?.body || '');
    const contentType = new Headers(init?.headers).get('content-type') || '';
    return (
      method === 'POST' &&
      body.includes(SECRET) &&
      contentType.includes('application/x-www-form-urlencoded')
    );
  });
}

it('does not POST CAS credentials when the form action is tronclass', async () => {
  const logs: string[] = [];
  const info = vi.spyOn(console, 'info').mockImplementation((msg) => {
    logs.push(String(msg));
  });
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    if (href.endsWith('/api/login') && method === 'POST') {
      return jsonResponse(400, { error: 'native login disabled' });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login',
        },
      });
    }
    if (href.startsWith('https://identity.pu.edu.tw/')) {
      return htmlResponse(200, TRONCLASS_CAS_TRONCLASS_ACTION_HTML);
    }
    throw new Error(`unexpected ${href}`);
  });
  try {
    const gateway = createPuCampusGateway({ fetch: fetchMock });
    await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'CAS_UNTRUSTED_ACTION',
    });
    expect(casFormPasswordPosts(fetchMock)).toEqual([]);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('tronclass.pu.edu.tw') &&
          String(init?.method || '').toUpperCase() === 'POST' &&
          String(init?.body || '').includes(SECRET) &&
          !String(url).endsWith('/api/login'),
      ),
    ).toBe(false);
    const rejected = logs
      .map((line) => {
        try {
          return JSON.parse(line) as { msg?: string; reason?: string; host?: string };
        } catch {
          return null;
        }
      })
      .find((row) => row?.msg === 'pu_tronclass_cas_post_rejected');
    expect(rejected).toMatchObject({
      reason: 'untrusted_action',
      host: 'tronclass.pu.edu.tw',
    });
    expect(logs.join('\n')).not.toContain(SECRET);
  } finally {
    info.mockRestore();
  }
});

for (const status of [307, 308] as const) {
  it(`does not resend CAS credentials on ${status} to another host`, async () => {
    const logs: string[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation((msg) => {
      logs.push(String(msg));
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      const method = String(init?.method || 'GET').toUpperCase();
      if (href.endsWith('/api/login') && method === 'POST') {
        return jsonResponse(400, { error: 'native login disabled' });
      }
      if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
        return new Response('', {
          status: 302,
          headers: {
            Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login',
          },
        });
      }
      if (href.startsWith('https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login')) {
        return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
      }
      if (href.includes('/login-actions/authenticate') && method === 'POST') {
        expect(href).toContain('identity.pu.edu.tw');
        return new Response('', {
          status,
          headers: {
            Location: 'https://tronclass.pu.edu.tw/login-actions/authenticate?next=stolen',
          },
        });
      }
      throw new Error(`unexpected ${method} ${href}`);
    });
    try {
      const gateway = createPuCampusGateway({ fetch: fetchMock });
      await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).rejects.toMatchObject({
        kind: 'unavailable',
        code: 'CAS_POST_REDIRECT',
      });
      const passwordPosts = casFormPasswordPosts(fetchMock);
      expect(passwordPosts).toHaveLength(1);
      expect(new URL(String(passwordPosts[0]?.[0])).hostname).toBe('identity.pu.edu.tw');
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('tronclass.pu.edu.tw') &&
            !String(url).endsWith('/api/login') &&
            String(init?.method || '').toUpperCase() === 'POST' &&
            String(init?.body || '').includes(SECRET),
        ),
      ).toBe(false);
      const rejected = logs
        .map((line) => {
          try {
            return JSON.parse(line) as {
              msg?: string;
              reason?: string;
              host?: string;
              status?: number;
            };
          } catch {
            return null;
          }
        })
        .find((row) => row?.msg === 'pu_tronclass_cas_post_rejected');
      expect(rejected).toMatchObject({
        reason: 'redirect_preserves_body',
        host: 'tronclass.pu.edu.tw',
        status,
      });
      expect(logs.join('\n')).not.toContain(SECRET);
    } finally {
      info.mockRestore();
    }
  });
}

it('may resend CAS credentials on 307 only when the target stays on identity', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    if (href.endsWith('/api/login') && method === 'POST') {
      return jsonResponse(400, { error: 'native login disabled' });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login',
        },
      });
    }
    if (href.startsWith('https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login')) {
      return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    }
    if (href.includes('/login-actions/authenticate') && method === 'POST') {
      if (href.includes('session_code=fixtureSessionCode')) {
        return new Response('', {
          status: 307,
          headers: {
            Location:
              'https://identity.pu.edu.tw/auth/realms/pu/login-actions/authenticate?session_code=nextHop',
          },
        });
      }
      expect(String(init?.body || '')).toContain(`password=${encodeURIComponent(SECRET)}`);
      return new Response('', {
        status: 302,
        headers: {
          Location: 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture',
          'set-cookie': 'KEYCLOAK_IDENTITY=kc; Path=/',
        },
      });
    }
    if (href.startsWith('https://tronclass.pu.edu.tw/user/index')) {
      expect(String(init?.method || 'GET').toUpperCase()).toBe('GET');
      expect(String(init?.body || '')).not.toContain(SECRET);
      return htmlResponse(200, '<html><body>ok</body></html>', {
        'set-cookie': 'session=tc-cas; Path=/',
      });
    }
    if (href.endsWith('/api/profile')) {
      return jsonResponse(200, {
        id: 44,
        name: '王老師',
        login_name: 'changyi',
        role: 'teacher',
      });
    }
    throw new Error(`unexpected ${method} ${href}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).resolves.toMatchObject({
    userId: 44,
    cookies: expect.objectContaining({ session: 'tc-cas' }),
  });
  const passwordPosts = casFormPasswordPosts(fetchMock);
  expect(passwordPosts).toHaveLength(2);
  expect(
    passwordPosts.every(([url]) => new URL(String(url)).hostname === 'identity.pu.edu.tw'),
  ).toBe(true);
});

it('does not follow a CAS redirect off identity or TronClass', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const href = String(url);
    expect(href).not.toContain('evil.test');
    if (href.endsWith('/api/login')) return jsonResponse(400, { message: 'bad request' });
    if (href.startsWith('https://tronclass.pu.edu.tw/login')) {
      return new Response('', { status: 302, headers: { Location: 'https://evil.test/steal' } });
    }
    throw new Error(`unexpected ${href}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'unavailable',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('evil.test'))).toBe(false);
});

it('rewrites alcat http redirects to https and rejects other hosts', () => {
  const portal = 'https://alcat.pu.edu.tw';
  const posted = 'https://alcat.pu.edu.tw/index_check.php';
  expect(rewriteCampusPortalLocation('http://alcat.pu.edu.tw/stu_query/x', posted, portal)).toBe(
    'https://alcat.pu.edu.tw/stu_query/x',
  );
  expect(
    rewriteAllowedCampusLocation(
      'https://identity.pu.edu.tw/auth/realms/pu/login',
      'https://tronclass.pu.edu.tw/login',
      ['https://tronclass.pu.edu.tw', 'https://identity.pu.edu.tw'],
    ),
  ).toBe('https://identity.pu.edu.tw/auth/realms/pu/login');
  expect(
    rewriteAllowedCampusLocation('https://evil.test/steal', 'https://tronclass.pu.edu.tw/login', [
      'https://tronclass.pu.edu.tw',
      'https://identity.pu.edu.tw',
    ]),
  ).toBeNull();
  expect(rewriteCampusPortalLocation('/stu_query/query_course.html', posted, portal)).toBe(
    'https://alcat.pu.edu.tw/stu_query/query_course.html',
  );
  expect(rewriteCampusPortalLocation('https://alcat.pu.edu.tw/ok', posted, portal)).toBe(
    'https://alcat.pu.edu.tw/ok',
  );
  expect(rewriteCampusPortalLocation('https://evil.test/steal', posted, portal)).toBeNull();
  expect(rewriteCampusPortalLocation('https://tronclass.pu.edu.tw/api', posted, portal)).toBeNull();
  expect(rewriteCampusPortalLocation('https://alcat.pu.edu.tw.evil.test/', posted, portal)).toBeNull();
  expect(rewriteCampusPortalLocation('https://alcat.pu.edu.tw:8443/steal', posted, portal)).toBeNull();
});

it('follows rewritten alcat redirects and never requests an external host', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    expect(new URL(href).origin).toBe('https://alcat.pu.edu.tw');
    expect(href).not.toContain('evil.test');
    if (href === 'https://alcat.pu.edu.tw/') {
      return htmlResponse(200, ALCAT_LOGIN_HTML);
    }
    if (href.endsWith('/index_check.php') && String(init?.method || '').toUpperCase() === 'POST') {
      return new Response('<html>ok</html>', {
        status: 302,
        headers: {
          Location: 'http://alcat.pu.edu.tw/stu_query/query_course.html',
          'set-cookie': 'PHPSESSID=abc; Path=/',
        },
      });
    }
    return htmlResponse(
      200,
      `學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 query_course`,
    );
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).resolves.toMatchObject({
    studentName: '陳同學',
    cookies: { PHPSESSID: 'abc' },
  });
  expect(fetchMock.mock.calls.every(([url]) => new URL(String(url)).protocol === 'https:')).toBe(
    true,
  );
  expect(
    fetchMock.mock.calls.some(([url]) => String(url) === 'https://alcat.pu.edu.tw/stu_query/query_course.html'),
  ).toBe(true);
});

it('does not follow a post-login redirect off alcat', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    expect(href).not.toContain('evil.test');
    if (href === 'https://alcat.pu.edu.tw/') {
      return htmlResponse(200, ALCAT_LOGIN_HTML);
    }
    if (href.endsWith('/index_check.php') && String(init?.method || '').toUpperCase() === 'POST') {
      return new Response('<html>ok</html>', {
        status: 302,
        headers: { Location: 'https://evil.test/steal?cookie=1' },
      });
    }
    return htmlResponse(
      200,
      `學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 query_course`,
    );
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).resolves.toMatchObject({
    studentName: '陳同學',
  });
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('evil.test'))).toBe(false);
});

it('aborts a student TronClass sidecar within the supplied timeout', async () => {
  const started = Date.now();
  const gateway = createPuCampusGateway({
    timeoutMs: 8_000,
    fetch: (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  await expect(
    gateway.loginTronClass('changyi', SECRET, { timeoutMs: 40, route: 'student' }),
  ).rejects.toMatchObject({
    kind: 'timeout',
    route: 'student',
    stage: 'submit',
    code: 'AbortError',
  });
  expect(Date.now() - started).toBeLessThan(1000);
});

it('keeps DNS, TCP and TLS codes on teacher LMS failures', async () => {
  const cases = [
    ['ENOTFOUND', 'unavailable'],
    ['ECONNREFUSED', 'unavailable'],
    ['CERT_HAS_EXPIRED', 'unavailable'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
  ] as const;
  for (const [code, kind] of cases) {
    const gateway = createPuCampusGateway({
      fetch: async () => {
        const error = new Error('connect');
        (error as Error & { code?: string }).code = code;
        throw error;
      },
    });
    await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).rejects.toMatchObject({
      kind,
      route: 'teacher',
      stage: 'submit',
      code,
    });
  }
});

it('reads a nested DNS code from the fetch cause chain', async () => {
  const gateway = createPuCampusGateway({
    fetch: async () => {
      const error = new Error('fetch failed');
      (error as Error & { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo'), {
        code: 'ENOTFOUND',
      });
      throw error;
    },
  });
  await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).rejects.toMatchObject({
    kind: 'unavailable',
    code: 'ENOTFOUND',
  });
});

it('keeps ETIMEDOUT on teacher LMS failures', async () => {
  const gateway = createPuCampusGateway({
    fetch: async () => {
      const error = new Error('connect');
      (error as Error & { code?: string }).code = 'ETIMEDOUT';
      throw error;
    },
  });
  await expect(gateway.loginTronClass('changyi', SECRET, { route: 'teacher' })).rejects.toMatchObject({
    kind: 'timeout',
    route: 'teacher',
    stage: 'submit',
    code: 'ETIMEDOUT',
  });
});
