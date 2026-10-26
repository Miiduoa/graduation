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
