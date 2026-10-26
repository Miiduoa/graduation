import { expect, it, vi } from 'vitest';
import { createPuCampusGateway, PuCampusError } from './puCampusClient';

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

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

it('rejects TronClass HTTP 200 that has user JSON but no session cookie', async () => {
  const gateway = createPuCampusGateway({
    fetch: async () =>
      jsonResponse(200, { id: 44, name: '王老師', role: 'teacher', user_name: 'changyi' }),
  });
  await expect(gateway.loginTronClass('changyi', SECRET)).rejects.toMatchObject({
    kind: 'credentials',
    message: '學號或密碼錯誤',
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
  });
});
