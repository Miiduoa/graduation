import { clearTCSession, tcFetchCourses, tcLogin } from '../../services/tronClassClient';

jest.mock('../../services/cloudFunctions', () => ({
  getCloudFunctionUrl: (name: string) => `https://functions.test/${name}`,
  getFirebaseAuthHeaders: async () => ({}),
}));
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: async () => null,
  secureSetItem: async () => undefined,
  secureDeleteItem: async () => undefined,
  secureDeleteMany: async () => undefined,
}));
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;
function response(status: number, body: unknown, url = 'https://tronclass.pu.edu.tw/user/index') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
beforeEach(async () => {
  await clearTCSession();
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('native CAS completes the fetch flow and verifies profile instead of referencing an absent XHR', async () => {
  mockFetch
    .mockResolvedValueOnce(response(503, { error: 'unavailable' }))
    .mockResolvedValueOnce(
      response(
        200,
        '<form action="/auth/login"><input type="hidden" name="execution" value="e1"></form>',
        'https://identity.pu.edu.tw/auth/login',
      ),
    )
    .mockResolvedValueOnce(response(200, '<html>home</html>'))
    .mockResolvedValueOnce(response(200, { id: 42, name: '測試同學' }));
  await expect(tcLogin('student', 'password')).resolves.toMatchObject({
    success: true,
    session: { userId: 42 },
  });
  const post = mockFetch.mock.calls[2];
  expect(post[0]).toBe('https://identity.pu.edu.tw/auth/login');
  expect(post[1].credentials).toBe('include');
  expect(post[1].body).toContain('execution=e1');
});

test('an external form target never receives school credentials', async () => {
  mockFetch
    .mockResolvedValueOnce(response(503, {}))
    .mockResolvedValueOnce(
      response(
        200,
        '<form action="https://external.test/login"></form>',
        'https://identity.pu.edu.tw/auth/login',
      ),
    );
  await expect(tcLogin('student', 'password')).resolves.toMatchObject({ success: false });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test.each([response(401, {}), response(200, '<html>login</html>'), response(200, {})])(
  'course connection failures cannot be cached as a successful empty course list',
  async (bad) => {
    mockFetch.mockResolvedValue(bad);
    await expect(tcFetchCourses()).rejects.toThrow();
  },
);

test('a real empty course list remains a successful empty response', async () => {
  mockFetch.mockResolvedValue(response(200, { courses: [], paging: { pages: 1 } }));
  await expect(tcFetchCourses()).resolves.toEqual([]);
});

test('a later page failure rejects the partial list', async () => {
  mockFetch
    .mockResolvedValueOnce(
      response(200, { courses: [{ id: 1, name: '資料庫' }], paging: { pages: 2 } }),
    )
    .mockResolvedValueOnce(response(503, {}));
  await expect(tcFetchCourses()).rejects.toThrow('HTTP 503');
});
