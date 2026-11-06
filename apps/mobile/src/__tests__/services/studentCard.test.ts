import type { User } from 'firebase/auth';
import { requestStudentCardCode } from '../../services/studentCard';

const user = { getIdToken: jest.fn() } as unknown as User;
const signal = new AbortController().signal;
const previous = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn();
  jest.mocked(user.getIdToken).mockResolvedValue('signed-token');
});
afterEach(() => {
  global.fetch = previous;
});

test('posts only the selected school and never places the Firebase token in a URL', async () => {
  const issued = { token: 'a'.repeat(32), expiresAt: Date.now() + 30_000, studentId: 'S12345' };
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => issued } as Response);
  await expect(requestStudentCardCode(user, 'pu', signal)).resolves.toEqual(issued);
  expect(fetch).toHaveBeenCalledWith(
    'https://nuni.tw/api/student-card/present',
    expect.objectContaining({
      body: JSON.stringify({ schoolId: 'pu' }),
      signal,
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: 'Bearer signed-token', 'Content-Type': 'application/json' },
    }),
  );
});

test('does not send simulated login tokens', async () => {
  jest.mocked(user.getIdToken).mockResolvedValue('mock-token');
  await expect(requestStudentCardCode(user, 'pu', signal)).rejects.toThrow('學校帳號');
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { token: 'not-a-code', expiresAt: Date.now() + 30_000, studentId: 'S12345' },
  { token: 'a'.repeat(32), expiresAt: 1, studentId: 'S12345' },
])('rejects malformed or expired codes', async (value) => {
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => value } as Response);
  await expect(requestStudentCardCode(user, 'pu', signal)).rejects.toThrow('重新取得');
});
