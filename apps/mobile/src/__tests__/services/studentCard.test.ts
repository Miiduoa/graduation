import type { User } from 'firebase/auth';
import {
  requestStudentCardCode,
  StudentCardUnavailable,
  verifyStudentCardCode,
} from '../../services/studentCard';

const user = { getIdToken: jest.fn() } as unknown as User;
const previousFetch = global.fetch;
const now = 1_793_923_200_000;

function response(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  global.fetch = jest.fn();
  jest.mocked(user.getIdToken).mockReset().mockResolvedValue('signed-token');
});

afterEach(() => {
  global.fetch = previousFetch;
  jest.useRealTimers();
});

describe('student card presentation', () => {
  const issued = { token: 'a'.repeat(32), expiresAt: now + 30_000, studentId: 'S12345' };

  test('posts only the selected school with a bearer header to the fixed endpoint', async () => {
    const signal = new AbortController().signal;
    jest.mocked(fetch).mockResolvedValue(response(issued));
    await expect(requestStudentCardCode(user, 'pu', signal)).resolves.toEqual(issued);
    expect(fetch).toHaveBeenCalledWith('https://nuni.tw/api/student-card/present', {
      method: 'POST',
      body: JSON.stringify({ schoolId: 'pu' }),
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: 'Bearer signed-token', 'Content-Type': 'application/json' },
    });
  });

  test.each(['mock-token', ''])(
    'does not send simulated or missing login tokens',
    async (bearer) => {
      jest.mocked(user.getIdToken).mockResolvedValue(bearer);
      await expect(
        requestStudentCardCode(user, 'pu', new AbortController().signal),
      ).rejects.toThrow('學校帳號');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each([
    { token: 'not-a-code' },
    { token: 'a'.repeat(33) },
    { token: 'a'.repeat(32) + '\n' },
    { expiresAt: 1 },
    { expiresAt: now },
    { expiresAt: now + 65_001 },
    { expiresAt: now + 30_000.5 },
    { studentId: 'S1' },
    { studentId: 'S'.repeat(33) },
    { studentId: 'S12345\n' },
  ])('rejects malformed or expired presentation data %p', async (patch) => {
    jest.mocked(fetch).mockResolvedValue(response({ ...issued, ...patch }));
    await expect(requestStudentCardCode(user, 'pu', new AbortController().signal)).rejects.toThrow(
      '重新取得',
    );
  });

  test('does not start an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(requestStudentCardCode(user, 'pu', controller.signal)).rejects.toThrow('已取消');
    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('ignores an identity token that arrives after cancellation', async () => {
    const identity = deferred<string>();
    jest.mocked(user.getIdToken).mockReturnValue(identity.promise);
    const controller = new AbortController();
    const pending = requestStudentCardCode(user, 'pu', controller.signal);
    const cancelled = expect(pending).rejects.toThrow('已取消');
    controller.abort();
    await cancelled;
    identity.resolve('signed-late-token');
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    [401, '登入已失效'],
    [403, '校方證件'],
    [429, '過於頻繁'],
    [503, '稍後再試'],
  ] as const)('handles HTTP %s with a safe message', async (status, message) => {
    jest.mocked(fetch).mockResolvedValue(response({ error: 'private-token' }, status));
    await expect(requestStudentCardCode(user, 'pu', new AbortController().signal)).rejects.toThrow(
      message,
    );
  });
});

describe('student card verification', () => {
  const token = 'b'.repeat(32);
  const receipt = { schoolName: '靜宜大學', maskedId: '•••• 2345', verifiedAt: now };

  test('verifies only the token without auth or cookies, and returns only public fields', async () => {
    const signal = new AbortController().signal;
    jest.mocked(fetch).mockResolvedValue(response({ ...receipt, studentId: 'S12345' }));
    await expect(verifyStudentCardCode(token, signal)).resolves.toEqual(receipt);
    expect(fetch).toHaveBeenCalledWith('https://nuni.tw/api/student-card/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  test.each([
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    token + '\n',
    ' ' + token,
    'https://nuni.tw/' + token,
  ])('rejects an invalid token before making a request', async (value) => {
    await expect(verifyStudentCardCode(value, new AbortController().signal)).rejects.toBeInstanceOf(
      StudentCardUnavailable,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    { schoolName: null },
    { schoolName: '   ' },
    { schoolName: '校'.repeat(161) },
    { maskedId: 'S12345' },
    { maskedId: '••••' },
    { maskedId: '•••• 12345' },
    { maskedId: '•••• 2345\n' },
    { verifiedAt: '123' },
    { verifiedAt: 0 },
    { verifiedAt: now + 0.5 },
    { verifiedAt: now + 5_001 },
    { verifiedAt: now - 60_001 },
  ])('rejects malformed verification fields %p', async (patch) => {
    jest.mocked(fetch).mockResolvedValue(response({ ...receipt, ...patch }));
    await expect(verifyStudentCardCode(token, new AbortController().signal)).rejects.toThrow(
      '資料無法確認',
    );
  });

  test.each([null, [], 'receipt'])('rejects a non-object verification response', async (value) => {
    jest.mocked(fetch).mockResolvedValue(response(value));
    await expect(verifyStudentCardCode(token, new AbortController().signal)).rejects.toThrow(
      '資料無法確認',
    );
  });

  test.each(['{broken', ' '.repeat(2_049)])('bounds and validates the JSON body', async (body) => {
    jest.mocked(fetch).mockResolvedValue({ ok: true, text: async () => body } as Response);
    await expect(verifyStudentCardCode(token, new AbortController().signal)).rejects.toThrow(
      '資料無法確認',
    );
  });

  test.each([
    [400, '重新出示'],
    [410, '重新出示'],
    [429, '過於頻繁'],
    [503, '稍後再試'],
  ] as const)('handles HTTP %s without exposing the server body', async (status, message) => {
    jest.mocked(fetch).mockResolvedValue(response({ error: 'private-token' }, status));
    await expect(verifyStudentCardCode(token, new AbortController().signal)).rejects.toThrow(
      message,
    );
  });

  test('sanitizes network errors', async () => {
    jest.mocked(fetch).mockRejectedValue(new Error('private-token and native details'));
    await expect(verifyStudentCardCode(token, new AbortController().signal)).rejects.toMatchObject({
      message: '暫時無法連線核對，請稍後再試。',
    });
  });

  test('does not start verification with an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(verifyStudentCardCode(token, controller.signal)).rejects.toThrow('已取消');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('ignores a response that arrives after cancellation', async () => {
    const network = deferred<Response>();
    jest.mocked(fetch).mockReturnValue(network.promise);
    const controller = new AbortController();
    const pending = verifyStudentCardCode(token, controller.signal);
    const cancelled = expect(pending).rejects.toThrow('已取消');
    controller.abort();
    await cancelled;
    network.resolve(response(receipt));
    await Promise.resolve();
  });

  test('ignores a body that arrives after cancellation', async () => {
    const body = deferred<string>();
    const readBody = jest.fn(() => body.promise);
    jest.mocked(fetch).mockResolvedValue({ ok: true, text: readBody } as unknown as Response);
    const controller = new AbortController();
    const pending = verifyStudentCardCode(token, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(readBody).toHaveBeenCalled();
    const cancelled = expect(pending).rejects.toThrow('已取消');
    controller.abort();
    await cancelled;
    body.resolve(JSON.stringify(receipt));
    await Promise.resolve();
  });
});
