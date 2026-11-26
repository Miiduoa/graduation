import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
// Exercise the existing transport/parser contracts with synthetic responses after resumption.
// The pause suite separately verifies the real default policy never calls fetch.
vi.mock('@campus/shared/src/puEcampusDataPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('@campus/shared/src/puEcampusDataPolicy')>(),
  isPuEcampusDataFetchEnabled: () => true,
}));
import {
  campusPageHasLoginForm,
  campusPageLooksClosed,
  createPuCampusGateway,
  DEFAULT_TIMEOUT_MS,
  isCasPasswordPostUrl,
  isTransientCampusError,
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

afterEach(() => {
  vi.useRealTimers();
});

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
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(
    async () => htmlResponse(200, ALCAT_MAINTENANCE_HTML),
  );
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
      `<!-- 系統維護公告 學號(Student No.): 123456789 -->
       <html><body>學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 query_course</body></html>`,
    );
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).resolves.toMatchObject({
    studentId: STUDENT,
    studentName: '陳同學',
    cookies: { PHPSESSID: 'abc' },
  });
});

function connectionReset(): Error {
  return Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
}

function studentPage() {
  return htmlResponse(
    200,
    `學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 query_course`,
  );
}

it('retries a transient home hop without sending a second password POST', async () => {
  let homes = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === 'https://alcat.pu.edu.tw/' && !init?.method) {
      homes += 1;
      if (homes === 1) throw connectionReset();
      return htmlResponse(200, ALCAT_LOGIN_HTML, { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    if (href.endsWith('/index_check.php') && String(init?.method || '').toUpperCase() === 'POST') {
      return htmlResponse(200, '<html>ok</html>', { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    return studentPage();
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).resolves.toMatchObject({
    studentName: '陳同學',
  });
  expect(homes).toBe(2);
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/index_check.php') &&
        String(init?.method || '').toUpperCase() === 'POST',
    ),
  ).toHaveLength(1);
});

it('does not retry the password POST on ECONNRESET', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === 'https://alcat.pu.edu.tw/' && !init?.method) {
      return htmlResponse(200, ALCAT_LOGIN_HTML, { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    if (href.endsWith('/index_check.php')) throw connectionReset();
    return studentPage();
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'unavailable',
    code: 'ECONNRESET',
  });
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/index_check.php') &&
        String(init?.method || '').toUpperCase() === 'POST',
    ),
  ).toHaveLength(1);
});

it('aborts student login within the total budget instead of stacking hop timeouts', async () => {
  vi.useFakeTimers();
  const gateway = createPuCampusGateway({
    timeoutMs: 15_000,
    fetch: (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  const pending = expect(
    gateway.loginStudent(STUDENT, SECRET, { timeoutMs: 80, hopTimeoutMs: 50 }),
  ).rejects.toMatchObject({ kind: 'timeout' });
  await vi.advanceTimersByTimeAsync(80);
  await pending;
});

it('classifies ECONNRESET as a transient campus error', () => {
  expect(isTransientCampusError(connectionReset())).toBe(true);
  expect(isTransientCampusError(new PuCampusError('credentials', '學號或密碼錯誤'))).toBe(false);
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

it('collects strict native profile evidence only in the explicit student candidate mode', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/login')) return jsonResponse(200, { id: 999 }, { 'set-cookie': 'session=old; Path=/' });
    if (url.endsWith('/api/profile')) return jsonResponse(200, {
      id: 44, login_name: 's1234567', role: 'teacher',
    }, { 'set-cookie': 'session=rotated; Path=/' });
    throw new Error('unexpected URL');
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const result = await gateway.loginTronClass('s1234567', SECRET, { route: 'student', requireStudentIdentityEvidence: true });
  expect(result).toMatchObject({
    userId: 44, role: '', cookies: { session: 'rotated' },
    identityEvidence: { schoolId: 'pu', issuer: 'https://tronclass.pu.edu.tw', source: 'authenticated-profile', subject: '44' },
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await gateway.loginTronClass('s1234567', SECRET, { route: 'student' })).not.toHaveProperty('identityEvidence');
});

it.each([
  { id: undefined, login_name: 's1234567' },
  { id: '44', login_name: 's1234567' },
  { id: 44, login_name: 's1234568' },
  { id: 44, email: 's1234567@pu.edu.tw' },
])('does not substitute login JSON or email for strict profile evidence (%o)', async (profile) => {
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
    ? jsonResponse(200, { id: 44 }, { 'set-cookie': 'session=old; Path=/' })
    : jsonResponse(200, profile));
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true,
  })).rejects.toMatchObject({ kind: 'unverified' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('rejects non-JSON profile content and a revoked profile cookie in strict mode', async () => {
  for (const profile of [
    htmlResponse(200, JSON.stringify({ id: 44, login_name: 's1234567' })),
    jsonResponse(200, { id: 44, login_name: 's1234567' }, { 'set-cookie': 'session=; Max-Age=0; Path=/' }),
    jsonResponse(200, { id: 44, login_name: 's1234567' }, { 'set-cookie': 'SESSION=ambiguous; Path=/' }),
  ]) {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
      ? jsonResponse(200, { id: 44 }, { 'set-cookie': 'session=old; Path=/' }) : profile);
    await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
      route: 'student', requireStudentIdentityEvidence: true,
    })).rejects.toMatchObject({ kind: 'unverified' });
  }
});

it.each([
  'session=nonempty; Max-Age=0; Path=/',
  'session=nonempty; Max-Age=-1; Path=/',
  'session=nonempty; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
  'session=nonempty; Domain=other.example; Path=/',
  'session=nonempty; Domain=pu.edu.tw; Path=/',
  'session=nonempty; Path=/api/private',
  'session=nonempty; Path=/api/profi',
  'session=nonempty; Path=relative',
  'session=nonempty; Max-Age=bad; Path=/',
  'session=nonempty; Expires=invalid; Path=/',
  'session=nonempty; Path=/; Path=/api',
  'session="ambiguous"; Path=/',
])('rejects deleted, invalid or incorrectly scoped strict session cookies (%s)', async (setCookie) => {
  for (const phase of ['login', 'profile']) {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
      ? jsonResponse(200, {}, { 'set-cookie': phase === 'login' ? setCookie : 'session=old; Path=/' })
      : jsonResponse(200, { id: 44, login_name: 's1234567' }, { 'set-cookie': setCookie }));
    await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
      route: 'student', requireStudentIdentityEvidence: true,
    })).rejects.toMatchObject({ kind: 'unverified', code: 'IDENTITY_EVIDENCE_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(phase === 'login' ? 1 : 2);
  }
});

it('rejects multiple strict session updates instead of silently selecting one', async () => {
  const profile = jsonResponse(200, { id: 44, login_name: 's1234567' });
  profile.headers.append('set-cookie', 'session=one; Path=/');
  profile.headers.append('set-cookie', 'session=two; Path=/api');
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
    ? jsonResponse(200, {}, { 'set-cookie': 'session=old; Path=/' }) : profile);
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true,
  })).rejects.toMatchObject({ kind: 'unverified' });
});

it.each([
  'misc=value, session=deleted; Max-Age=0; Path=/',
  'misc=value; Path=/, session=; Max-Age=0; Path=/',
  'misc=value; Expires=Thu, 01 Jan 1970 00:00:00 GMT, session=deleted; Max-Age=0; Path=/',
  'misc=value, session=rotated; Path=/',
])('rejects a folded profile cookie update after an unrelated first cookie (%s)', async (setCookie) => {
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
    ? jsonResponse(200, {}, { 'set-cookie': 'session=old; Path=/' })
    : jsonResponse(200, { id: 44, login_name: 's1234567' }, { 'set-cookie': setCookie }));
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true,
  })).rejects.toMatchObject({ kind: 'unverified', stage: 'verify', code: 'IDENTITY_EVIDENCE_UNAVAILABLE' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('accepts normal Expires date commas during strict session rotation', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
    ? jsonResponse(200, {}, { 'set-cookie': 'session=old; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Path=/' })
    : jsonResponse(200, { id: 44, login_name: 's1234567' }, {
      'set-cookie': 'session=rotated; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Path=/',
    }));
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true,
  })).resolves.toMatchObject({ cookies: { session: 'rotated' }, identityEvidence: { subject: '44' } });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('rejects a second live session scope introduced by the profile response', async () => {
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
    ? jsonResponse(200, {}, { 'set-cookie': 'session=old; Path=/' })
    : jsonResponse(200, { id: 44, login_name: 's1234567' }, { 'set-cookie': 'session=new; Path=/api' }));
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true,
  })).rejects.toMatchObject({ kind: 'unverified' });
});

it('honors strict cookie scope and Max-Age precedence while keeping valid session rotation', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/login')) {
      const response = jsonResponse(200, {});
      response.headers.append('set-cookie', 'session=old; Domain=.TronClass.PU.edu.tw; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      response.headers.append('set-cookie', 'foreign=secret; Domain=other.example; Path=/');
      response.headers.append('set-cookie', 'private=secret; Path=/api/private');
      return response;
    }
    expect(new Headers(init?.headers).get('Cookie')).toBe('session=old');
    return jsonResponse(200, { id: 44, login_name: 's1234567' }, { 'set-cookie': 'session=rotated; Path=/api; Max-Age=60' });
  });
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true,
  })).resolves.toMatchObject({ cookies: { session: 'rotated' }, identityEvidence: { subject: '44' } });
});

it('does not return strict evidence if the session expires while reading the profile body', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/login')) return jsonResponse(200, {}, { 'set-cookie': 'session=short; Max-Age=1; Path=/' });
    const response = jsonResponse(200, {});
    response.text = async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return JSON.stringify({ id: 44, login_name: 's1234567' });
    };
    return response;
  });
  const checked = expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true, timeoutMs: 5000,
  })).rejects.toMatchObject({ kind: 'unverified' });
  await vi.advanceTimersByTimeAsync(1500);
  await checked;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('starts Max-Age at receipt of headers so a delayed login body cannot extend the session', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () => {
    const response = jsonResponse(200, {}, { 'set-cookie': 'session=short; Max-Age=1; Path=/' });
    response.text = async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return '{}';
    };
    return response;
  });
  const checked = expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true, timeoutMs: 5000,
  })).rejects.toMatchObject({ kind: 'unverified' });
  await vi.advanceTimersByTimeAsync(1500);
  await checked;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  ['login', 'fetch', 'submit'], ['profile', 'fetch', 'verify'],
  ['login', 'body', 'submit'], ['profile', 'body', 'verify'],
] as const)('settles the strict %s %s deadline even when transport ignores abort', async (phase, operation, stage) => {
  vi.useFakeTimers();
  let release: (() => void) | undefined;
  let stalledSignal: AbortSignal | null | undefined;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const isLogin = url.endsWith('/api/login');
    const response = isLogin
      ? jsonResponse(200, {}, { 'set-cookie': 'session=valid; Path=/' })
      : jsonResponse(200, { id: 44, login_name: 's1234567' });
    if ((isLogin ? 'login' : 'profile') === phase) {
      stalledSignal = init?.signal;
      const stalled = new Promise<void>(resolve => { release = resolve; });
      if (operation === 'fetch') await stalled;
      else {
        const text = response.text.bind(response);
        response.text = async () => { await stalled; return text(); };
      }
    }
    return response;
  });
  const checked = expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true, timeoutMs: 1000, hopTimeoutMs: 50,
  })).rejects.toMatchObject({ kind: 'timeout', route: 'student', stage, code: 'DEADLINE' });
  await vi.advanceTimersByTimeAsync(50);
  await checked;
  expect(stalledSignal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(phase === 'login' ? 1 : 2);
  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(phase === 'login' ? 1 : 2);
  expect(vi.getTimerCount()).toBe(0);
});

it('shares the strict total deadline across login and profile hops', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (url: string) => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return url.endsWith('/api/login')
      ? jsonResponse(200, {}, { 'set-cookie': 'session=valid; Path=/' })
      : jsonResponse(200, { id: 44, login_name: 's1234567' });
  });
  const checked = expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true, timeoutMs: 150, hopTimeoutMs: 100,
  })).rejects.toMatchObject({ kind: 'timeout', route: 'student', stage: 'verify', code: 'DEADLINE' });
  await vi.advanceTimersByTimeAsync(150);
  await checked;
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not enter the legacy CAS fallback or send credentials to a substituted origin for identity evidence', async () => {
  const fetchMock = vi.fn(async () => jsonResponse(400, { error: 'native not available' }));
  const options = { route: 'student' as const, requireStudentIdentityEvidence: true };
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, options))
    .rejects.toMatchObject({ kind: 'unverified', code: 'IDENTITY_EVIDENCE_UNAVAILABLE' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockClear();
  await expect(createPuCampusGateway({ fetch: fetchMock, lmsOrigin: 'https://other.example' }).loginTronClass('s1234567', SECRET, options))
    .rejects.toMatchObject({ kind: 'unverified' });
  expect(fetchMock).not.toHaveBeenCalled();
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('teacher', SECRET, options))
    .rejects.toMatchObject({ kind: 'unverified' });
  await expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', '', options))
    .rejects.toMatchObject({ kind: 'unverified' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps profile-rotated session and XSRF cookies for the next course request', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/login')) {
      const response = jsonResponse(200, { id: 44 }, {
        'set-cookie': 'session=login-session; Path=/; HttpOnly',
      });
      response.headers.append('set-cookie', 'XSRF-TOKEN=login-xsrf; Path=/');
      response.headers.append('set-cookie', 'route=school-node; Path=/');
      return response;
    }
    if (url.endsWith('/api/profile')) {
      expect(new Headers(init?.headers).get('Cookie')).toContain('session=login-session');
      const response = jsonResponse(200, {
        id: 44, login_name: 'changyi', name: '王老師', role: 'teacher',
      }, { 'set-cookie': 'session=profile-session; Path=/; HttpOnly' });
      response.headers.append('set-cookie', 'XSRF-TOKEN=profile-xsrf; Path=/');
      return response;
    }
    if (url.endsWith('/api/my-courses')) {
      const cookie = new Headers(init?.headers).get('Cookie') ?? '';
      if (!cookie.includes('session=profile-session') || !cookie.includes('XSRF-TOKEN=profile-xsrf')) {
        return jsonResponse(401, { error: 'expired session' });
      }
      expect(cookie).toContain('route=school-node');
      expect(cookie).not.toContain('login-session');
      expect(cookie).not.toContain('login-xsrf');
      return jsonResponse(200, { courses: [{ name: '資料庫', role: 'teacher' }] });
    }
    throw new Error(`unexpected ${url}`);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const session = await gateway.loginTronClass('changyi', SECRET);
  expect(session.cookies).toEqual({
    session: 'profile-session', 'XSRF-TOKEN': 'profile-xsrf', route: 'school-node',
  });
  await expect(gateway.fetchTronClassCourses(session)).resolves.toEqual([
    { name: '資料庫', role: 'teacher', teachers: [] },
  ]);
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/login'))).toHaveLength(1);
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

it('gives e-campus submit at least 15 seconds', () => {
  expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
});

it('still accepts an 11-second e-campus submit within the 15-second budget', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === 'https://alcat.pu.edu.tw/' && !init?.method) {
      return htmlResponse(200, ALCAT_LOGIN_HTML, { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    if (href.endsWith('/index_check.php')) {
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      return htmlResponse(200, '<html>ok</html>', { 'set-cookie': 'PHPSESSID=abc; Path=/' });
    }
    return htmlResponse(
      200,
      `<!-- 系統維護公告 -->學號(Student No.): ${STUDENT} 姓名(Student Name): 陳同學 query_course`,
    );
  });
  const gateway = createPuCampusGateway({ timeoutMs: 15_000, fetch: fetchMock });
  const pending = gateway.loginStudent(STUDENT, SECRET);
  await vi.advanceTimersByTimeAsync(11_000);
  await expect(pending).resolves.toMatchObject({
    studentName: '陳同學',
    cookies: { PHPSESSID: 'abc' },
  });
  vi.useRealTimers();
});

it('retries a hung home hop within the 15-second hop budget then fails that stage', async () => {
  vi.useFakeTimers();
  const gateway = createPuCampusGateway({
    timeoutMs: 15_000,
    fetch: (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  const pending = expect(gateway.loginStudent(STUDENT, SECRET)).rejects.toMatchObject({
    kind: 'timeout',
    route: 'student',
    stage: 'home',
    code: 'AbortError',
  });
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.advanceTimersByTimeAsync(30_000);
  await pending;
  vi.useRealTimers();
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

it.each([
  ['ENOTFOUND', true],
  ['UND_ERR_CONNECT_TIMEOUT', true],
  ['UND_ERR_HEADERS_TIMEOUT', false],
  ['ECONNRESET', false],
])('distinguishes pre-connection failures from uncertain login delivery (%s)', async (code, loginNotDelivered) => {
  const fetch = vi.fn(async () => {
    throw new TypeError('request failed', { cause: { code } });
  });
  const gateway = createPuCampusGateway({ fetch });
  await expect(gateway.loginTronClass('changyi', 'fixture')).rejects.toMatchObject({ code, loginNotDelivered });
  expect(fetch).toHaveBeenCalledOnce();
});

it('keeps delivery charged if a connection fails after native login has already reached the LMS', async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/api/login')) return jsonResponse(403, { error: 'native login rejected' });
    throw new TypeError('request failed', { cause: { code: 'ENOTFOUND' } });
  });
  const gateway = createPuCampusGateway({ fetch });
  await expect(gateway.loginTronClass('changyi', 'fixture')).rejects.toMatchObject({
    code: 'ENOTFOUND', loginNotDelivered: false,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
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
          'set-cookie': 'route=lms-node; Path=/',
        },
      });
    }
    if (href.startsWith('https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login')) {
      expect(new Headers(init?.headers).get('Cookie')).toBeNull();
      return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML, { 'set-cookie': 'route=identity-node; Path=/' });
    }
    if (href.includes('/login-actions/authenticate') && method === 'POST') {
      expect(new Headers(init?.headers).get('Cookie')).toBe('route=identity-node');
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
      expect(new Headers(init?.headers).get('Cookie')).toBe('route=lms-node');
      return htmlResponse(200, '<html><body>ok</body></html>', {
        'set-cookie': 'session=tc-cas; Path=/',
      });
    }
    if (href.endsWith('/api/profile')) {
      expect(new Headers(init?.headers).get('Cookie')).not.toContain('KEYCLOAK');
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
    cookies: { route: 'lms-node', session: 'tc-cas' },
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

it('treats identity trailing-dot FQDN as the same password host', () => {
  expect(isCasPasswordPostUrl('https://identity.pu.edu.tw./auth/realms/pu/login-actions/authenticate')).toBe(true);
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
  expect(rewriteCampusPortalLocation('https://alcat.pu.edu.tw./stu_query/x', posted, portal)).toBe(
    'https://alcat.pu.edu.tw/stu_query/x',
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

it('caps each TronClass hop below the total SSO budget', async () => {
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
    gateway.loginTronClass('changyi', SECRET, {
      timeoutMs: 5_000,
      hopTimeoutMs: 40,
      route: 'student',
    }),
  ).rejects.toMatchObject({
    kind: 'timeout',
    route: 'student',
    stage: 'submit',
    code: 'AbortError',
  });
  expect(Date.now() - started).toBeLessThan(1000);
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

function delayedCampusResponse(response: Response, delay: number, signal?: AbortSignal | null) {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve(response);
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

it('does not send school credentials when the TronClass caller is already canceled', async () => {
  const controller = new AbortController();
  controller.abort(new Error(SECRET));
  const fetchMock = vi.fn();
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass(STUDENT, SECRET, { route: 'student', signal: controller.signal }))
    .rejects.toMatchObject({ kind: 'unavailable', code: 'CANCELLED', message: '學校登入已取消' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  [1, 'submit'], [2, 'redirect'], [3, 'redirect'], [4, 'submit'],
  [5, 'submit'], [6, 'submit'], [7, 'verify'],
])('cancels TronClass hop %s and ignores a late relay result without continuing the CAS flow', async (hop, stage) => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const responses = [
    jsonResponse(400, { error: 'native login disabled' }),
    new Response('', { status: 302, headers: { Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login' } }),
    htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML),
    new Response('', { status: 307, headers: { Location: 'https://identity.pu.edu.tw/auth/realms/pu/login-actions/authenticate?step=2' } }),
    new Response('', { status: 302, headers: { Location: 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture' } }),
    htmlResponse(200, '<html><body><input id="userId" value="57"></body></html>', { 'set-cookie': 'session=fixture; Path=/' }),
    jsonResponse(200, { id: 57, login_name: STUDENT, role: 'student' }),
  ];
  let finish!: () => void;
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
    void _url;
    void _init;
    const current = fetchMock.mock.calls.length;
    const response = responses[current - 1]!;
    if (current !== hop) return response;
    // Deliberately ignore RequestInit.signal to exercise the boundary rather
    // than assuming every school relay respects fetch cancellation.
    return new Promise(resolve => { finish = () => resolve(response); });
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = gateway.loginTronClass(STUDENT, SECRET, {
    timeoutMs: 25_000, hopTimeoutMs: 10_000, route: 'student', signal: controller.signal,
  });
  const rejected = expect(pending).rejects.toMatchObject({ kind: 'unavailable', code: 'CANCELLED', route: 'student', stage });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.abort(new Error(SECRET));
  await rejected;
  expect(fetchMock.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  finish();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(Number(hop));
  expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(add.mock.calls.length);
});

it('cancels an authenticated profile body that ignores abort and cannot accept its late session', async () => {
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const profile = jsonResponse(200, {});
  const read = vi.spyOn(profile, 'text').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/login')
    ? jsonResponse(200, { id: 57 }, { 'set-cookie': 'session=fixture; Path=/' }) : profile);
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = gateway.loginTronClass(STUDENT, SECRET, { route: 'student', signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED', stage: 'verify' });
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  controller.abort();
  await rejected;
  finish(JSON.stringify({ id: 57, login_name: STUDENT }));
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('cleans up caller cancellation after a successful TronClass profile verification', async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    void _init;
    return url.endsWith('/api/login')
      ? jsonResponse(200, { id: 57 }, { 'set-cookie': 'session=fixture; Path=/' })
      : jsonResponse(200, { id: 57, login_name: STUDENT }, { 'set-cookie': 'session=rotated-fixture; Path=/' });
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  await expect(gateway.loginTronClass(STUDENT, SECRET, { route: 'student', signal: controller.signal }))
    .resolves.toMatchObject({ userId: 57, cookies: { session: 'rotated-fixture' } });
  expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(add.mock.calls.length);
  controller.abort();
  expect(fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted === false)).toBe(true);
});

it('shares the TronClass deadline across slow CAS login redirects before sending credentials', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/login')) return jsonResponse(400, { error: 'native login disabled' });
    return delayedCampusResponse(new Response('', { status: 302, headers: {
      Location: `https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login?hop=${fetchMock.mock.calls.length}`,
    } }), 400, init?.signal);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = expect(gateway.loginTronClass(STUDENT, SECRET, {
    timeoutMs: 1_000, hopTimeoutMs: 1_000, route: 'student',
  })).rejects.toMatchObject({ kind: 'timeout', route: 'student', stage: 'redirect' });
  await vi.advanceTimersByTimeAsync(1_000);
  await pending;
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls.slice(1).every(([, init]) => !init?.body)).toBe(true);
  expect(fetchMock.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('bounds credential-preserving CAS redirects and the ticket read by the same deadline', async () => {
  vi.useFakeTimers();
  let passwordPosts = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/login')) return jsonResponse(400, { error: 'native login disabled' });
    if (url.startsWith('https://tronclass.pu.edu.tw/login')) return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    if (String(init?.method).toUpperCase() === 'POST') {
      passwordPosts++;
      return delayedCampusResponse(new Response('', { status: passwordPosts === 1 ? 307 : 302, headers: {
        Location: passwordPosts === 1
          ? `${url}&step=2`
          : 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture',
      } }), 500, init?.signal);
    }
    return delayedCampusResponse(htmlResponse(200,
      '<html><body><input id="userId" value="57"><span class="user-name">陳同學</span></body></html>',
      { 'set-cookie': 'session=fixture; Path=/' }), 500, init?.signal);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = expect(gateway.loginTronClass(STUDENT, SECRET, {
    timeoutMs: 1_200, hopTimeoutMs: 1_000, route: 'student',
  })).rejects.toMatchObject({ kind: 'timeout', route: 'student', stage: 'submit' });
  await vi.advanceTimersByTimeAsync(1_200);
  await pending;
  expect(passwordPosts).toBe(2);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/user/index?ticket=');
  expect(fetchMock.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/api/profile'))).toBe(false);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it('keeps a successful multi-hop TronClass session and rotated cookies within its total budget', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    let response: Response;
    if (url.endsWith('/api/login')) response = jsonResponse(400, { error: 'native login disabled' });
    else if (url.startsWith('https://tronclass.pu.edu.tw/login')) response = new Response('', { status: 302, headers: {
      Location: 'https://identity.pu.edu.tw/auth/realms/pu/protocol/cas/login',
    } });
    else if (url.includes('/protocol/cas/login')) response = htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    else if (url.includes('/login-actions/authenticate')) response = new Response('', { status: 302, headers: {
      Location: 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture',
    } });
    else if (url.endsWith('/api/profile')) response = jsonResponse(200, {
      id: 57, name: '陳同學', login_name: STUDENT, role: 'student',
    }, { 'set-cookie': 'session=rotated-fixture; Path=/' });
    else response = htmlResponse(200, '<html><body><input id="userId" value="57"></body></html>',
      { 'set-cookie': 'session=initial-fixture; Path=/' });
    return delayedCampusResponse(response, 100, init?.signal);
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = gateway.loginTronClass(STUDENT, SECRET, {
    timeoutMs: 2_000, hopTimeoutMs: 1_000, route: 'student',
  });
  await vi.advanceTimersByTimeAsync(600);
  await expect(pending).resolves.toMatchObject({
    userId: 57, userName: '陳同學', role: 'student', cookies: { session: 'rotated-fixture' },
  });
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted === false)).toBe(true);
});

it('rejects a late native-login response without following redirects after its abort', async () => {
  vi.useFakeTimers();
  // Some relay transports may resolve despite cancellation; never accept that
  // result or start the CAS fallback after the user's login budget expires.
  const fetchMock = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    return jsonResponse(400, { error: 'native login disabled' });
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = expect(gateway.loginTronClass(STUDENT, SECRET, {
    timeoutMs: 1_000, route: 'student',
  })).rejects.toMatchObject({ kind: 'timeout', route: 'student', stage: 'submit', code: 'DEADLINE' });
  await vi.advanceTimersByTimeAsync(1_100);
  await pending;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not recover a CAS session when optional profile reading exhausts the total login budget', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/login')) return jsonResponse(400, { error: 'native login disabled' });
    if (url.startsWith('https://tronclass.pu.edu.tw/login')) return htmlResponse(200, TRONCLASS_CAS_LOGIN_HTML);
    if (url.includes('/login-actions/authenticate')) return new Response('', { status: 302, headers: {
      Location: 'https://tronclass.pu.edu.tw/user/index?ticket=ST-fixture',
    } });
    if (url.endsWith('/api/profile')) return delayedCampusResponse(jsonResponse(200, {
      id: 57, login_name: STUDENT,
    }), 1_500, init?.signal);
    return htmlResponse(200, '<html><body><input id="userId" value="57"></body></html>',
      { 'set-cookie': 'session=fixture; Path=/' });
  });
  const gateway = createPuCampusGateway({ fetch: fetchMock });
  const pending = expect(gateway.loginTronClass(STUDENT, SECRET, {
    timeoutMs: 1_000, hopTimeoutMs: 2_000, route: 'student',
  })).rejects.toMatchObject({ kind: 'timeout', route: 'student', stage: 'verify', code: 'DEADLINE' });
  await vi.advanceTimersByTimeAsync(1_000);
  await pending;
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/api/profile');
  expect(fetchMock.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
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

it.each([
  ['visible number', `<span hidden>學號(Student No.)：777777777</span><textarea>學號(Student No.)：888888888</textarea>
    <p title="學號(Student No.)：999999999">學號(Student No.)：<b>${STUDENT}</b></p>`, STUDENT],
  ['hidden number', `<div aria-hidden="true">學號(Student No.)：${STUDENT}</div>`, null],
  ['malformed number', `學號(Student No.)：${STUDENT}A`, null],
  ['two different numbers', `學號(Student No.)：${STUDENT} 學號(Student No.)：123456789`, null],
] as const)('binds the card to the visible, unambiguous profile field (%s)', async (_label, html, expected) => {
  const gateway = createPuCampusGateway({ fetch: async () => htmlResponse(200, `<p>姓名(Student Name)：林同學</p>${html}`) });
  await expect(gateway.fetchStudentInfo({ PHPSESSID: 'fixture' })).resolves.toMatchObject({ studentId: expected });
});

it('withholds a student number on another portal page reached by redirect', async () => {
  const gateway = createPuCampusGateway({
    fetch: async url => String(url).endsWith('/query_course.html')
      ? htmlResponse(302, '', { location: '/announcements' })
      : htmlResponse(200, `<p>學號(Student No.)：${STUDENT}</p>`),
  });
  await expect(gateway.fetchStudentInfo({ PHPSESSID: 'fixture' })).resolves.toMatchObject({ studentId: null });
});


it.each([
  ['login', 'fetch', 'submit'], ['profile', 'fetch', 'verify'],
  ['login', 'body', 'submit'], ['profile', 'body', 'verify'],
] as const)('cancels strict identity evidence during %s %s without reviving a late result', async (phase, operation, stage) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  let release: (() => void) | undefined;
  let stalledSignal: AbortSignal | null | undefined;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const isLogin = url.endsWith('/api/login');
    const response = isLogin
      ? jsonResponse(200, {}, { 'set-cookie': 'session=valid; Path=/' })
      : jsonResponse(200, { id: 44, login_name: 's1234567' });
    if ((isLogin ? 'login' : 'profile') === phase) {
      stalledSignal = init?.signal;
      const stalled = new Promise<void>(resolve => { release = resolve; });
      if (operation === 'fetch') await stalled;
      else {
        const text = response.text.bind(response);
        response.text = async () => { await stalled; return text(); };
      }
    }
    return response;
  });
  const checked = expect(createPuCampusGateway({ fetch: fetchMock }).loginTronClass('s1234567', SECRET, {
    route: 'student', requireStudentIdentityEvidence: true, timeoutMs: 1000, signal: controller.signal,
  })).rejects.toMatchObject({ kind: 'unavailable', route: 'student', stage, code: 'CANCELLED' });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await checked;
  expect(stalledSignal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(phase === 'login' ? 1 : 2);
  release?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(phase === 'login' ? 1 : 2);
  expect(vi.getTimerCount()).toBe(0);
});
