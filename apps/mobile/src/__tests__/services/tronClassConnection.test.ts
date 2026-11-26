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
    .mockResolvedValueOnce(response(200, { id: 42, name: '測試同學', login_name: 's412345678@pu.edu.tw' }));
  await expect(tcLogin('412345678', 'password')).resolves.toMatchObject({
    success: true,
    session: { userId: 42 },
  });
  const post = mockFetch.mock.calls[2];
  expect(post[0]).toBe('https://identity.pu.edu.tw/auth/login');
  expect(post[1].credentials).toBe('include');
  expect(post[1].redirect).toBe('follow');
  expect(post[1].body).toContain('execution=e1');
});

test.each([
  { id: 72, login_name: 's411111111', user_no: '412345678' },
  { id: 42, name: '412345678' },
  { id: 42, login_name: 's412345678@another.example' },
  { id: 0, login_name: 's412345678' },
  { departments: [] },
])('requires the official account on the native session to match the login attempt', async (profile) => {
  mockFetch
    .mockResolvedValueOnce(response(503, {}))
    .mockResolvedValueOnce(response(200, '<form action="/login"></form>', 'https://identity.pu.edu.tw/login'))
    .mockResolvedValueOnce(response(200, '<html>home</html>'))
    .mockResolvedValueOnce(response(200, profile));
  await expect(tcLogin('412345678', 'password')).resolves.toMatchObject({ success: false, session: null });
  expect(mockFetch).toHaveBeenCalledTimes(4);
});

test.each([401, 403, 429])('an explicit proxy rejection (%i) never resubmits the password', async (status) => {
  mockFetch.mockResolvedValueOnce(response(status, { success: false }));
  await expect(tcLogin('412345678', 'password')).resolves.toMatchObject({ success: false, session: null });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test.each([302, 401, 403, 429, 503])('a final CAS login-page status %i stops before posting credentials', async (status) => {
  mockFetch
    .mockResolvedValueOnce(response(503, {}))
    .mockResolvedValueOnce(response(status, '<form action="/login"></form>', 'https://identity.pu.edu.tw/login'));
  await expect(tcLogin('412345678', 'password')).resolves.toMatchObject({
    success: false, session: null, error: expect.stringContaining(`HTTP ${status}`),
  });
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test.each([302, 401, 403, 429, 503])('a final CAS credential status %i stops before reading any cached profile', async (status) => {
  mockFetch
    .mockResolvedValueOnce(response(503, {}))
    .mockResolvedValueOnce(response(200, '<form action="/login"></form>', 'https://identity.pu.edu.tw/login'))
    .mockResolvedValueOnce(response(status, '<html>Unavailable</html>'))
    .mockResolvedValueOnce(response(200, { id: 42, login_name: 's412345678' }));
  await expect(tcLogin('412345678', 'password')).resolves.toMatchObject({
    success: false, session: null, error: expect.stringContaining(`HTTP ${status}`),
  });
  expect(mockFetch).toHaveBeenCalledTimes(3);
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

test.each([
  { courses: [], paging: { pages: 2 } },
  { courses: [{ id: 1, name: '資料庫' }], paging: { pages: 2 } },
  { courses: [{ id: 2, name: '' }], paging: { pages: 2 } },
  { courses: [{ id: 2, name: '演算法' }], paging: { pages: 1 } },
])('an inconsistent second page never produces a successful course receipt', async (second) => {
  mockFetch
    .mockResolvedValueOnce(response(200, { courses: [{ id: 1, name: '資料庫' }], pages: 2 }))
    .mockResolvedValueOnce(response(200, second));
  await expect(tcFetchCourses()).rejects.toThrow();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('continues after a full page without totals and accepts a verified empty final page', async () => {
  const courses = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: '課程 ' + i }));
  mockFetch
    .mockResolvedValueOnce(response(200, { courses }))
    .mockResolvedValueOnce(response(200, { courses: [] }));
  await expect(tcFetchCourses()).resolves.toHaveLength(50);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('disconnecting during a native course read discards the late page', async () => {
  mockFetch.mockImplementationOnce(async () => {
    await clearTCSession();
    return response(200, { courses: [{ id: 80, name: '先前帳號的課程' }] });
  });
  await expect(tcFetchCourses()).rejects.toThrow('課程連線已變更');
});
