import Constants from 'expo-constants';
import {
  clearTCSavedCredentials,
  clearTCSession,
  setTCBackendSession,
  setTCSavedCredentials,
  tcFetchCourses,
} from '../../services/tronClassClient';

const mockRequester = { uid: 'pu-412345678', getIdToken: jest.fn(async () => 'firebase-token') };
let mockCurrentUser: typeof mockRequester | null = mockRequester;
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockCurrentUser }),
  hasUsableFirebaseConfig: () => true,
}));
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: async () => null,
  secureSetItem: async () => undefined,
  secureDeleteItem: async () => undefined,
  secureDeleteMany: async () => undefined,
}));

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn();
const primaryUrl = 'https://functions.test/puFetchTronClassData';
const hostedUrl = 'https://nuni.tw/api/fn/getMyTronClassCourses';
const course = {
  id: 72,
  name: '資料庫',
  code: 'CS101',
  teachers: ['王老師'],
  semester: '115-1',
  status: 'ongoing',
};
const reply = (status: number, payload: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});
const hosted = (patch: Record<string, unknown> = {}) =>
  reply(200, {
    result: {
      success: true,
      ownerUid: mockRequester.uid,
      schoolId: 'pu',
      source: 'pu-tronclass',
      fetchedAt: '2026-10-27T00:00:00Z',
      status: 'ongoing',
      courses: [course],
      ...patch,
    },
  });

beforeEach(async () => {
  await clearTCSession();
  await clearTCSavedCredentials();
  await setTCBackendSession('legacy-lms-session', 42);
  mockCurrentUser = mockRequester;
  mockRequester.getIdToken.mockReset().mockResolvedValue('firebase-token');
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      cloudFunctionBaseUrl: 'https://functions.test',
      tronClassDataEnabled: true,
    },
  });
  mockFetch.mockReset();
  globalThis.fetch = mockFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('real tcFetchCourses falls back on an undeployed cloud proxy and keeps unknown LMS metadata unknown', async () => {
  mockFetch.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(hosted());
  const courses = await tcFetchCourses();
  expect(mockFetch).toHaveBeenNthCalledWith(
    1,
    primaryUrl,
    expect.objectContaining({
      body: JSON.stringify({
        sessionId: 'legacy-lms-session',
        dataType: 'courses',
        status: 'ongoing',
      }),
    }),
  );
  expect(mockFetch).toHaveBeenNthCalledWith(
    2,
    hostedUrl,
    expect.objectContaining({
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-token' },
      body: JSON.stringify({ data: { status: 'ongoing' } }),
    }),
  );
  expect(courses).toHaveLength(1);
  expect(courses[0]).toMatchObject({
    id: 72,
    name: '資料庫',
    course_code: 'CS101',
    credit: null,
    instructors: [{ name: '王老師' }],
    semester: { name: '115-1' },
    role: '',
    classroom_schedule: null,
  });
  expect(courses[0].student_count).toBeUndefined();
  expect(courses[0].instructors[0].id).toBeUndefined();
  expect(courses[0].semester?.id).toBeUndefined();
  expect(courses[0].semester?.code).toBeUndefined();
  const hostedOptions = mockFetch.mock.calls[1][1];
  expect(hostedOptions.credentials).toBeUndefined();
  expect(hostedOptions.body).not.toMatch(/session|password|studentId/);
});

test('ended courses preserve the legacy status and use completed only for the hosted endpoint', async () => {
  mockFetch.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(
    hosted({
      status: 'completed',
      courses: [{ ...course, status: 'completed' }],
    }),
  );
  const courses = await tcFetchCourses('ended');
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).status).toBe('ended');
  expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ data: { status: 'completed' } });
  expect(courses[0].status).toBe('ended');
});

test('a valid legacy proxy response remains available without a hosted request', async () => {
  mockFetch.mockResolvedValue(
    reply(200, {
      success: true,
      result: [{ id: 5, name: '原課程', credit: 0, status: 'ongoing' }],
    }),
  );
  await expect(tcFetchCourses()).resolves.toEqual([
    { id: 5, name: '原課程', credit: 0, status: 'ongoing' },
  ]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('a successful hosted empty list remains an empty success', async () => {
  mockFetch.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(hosted({ courses: [] }));
  await expect(tcFetchCourses()).resolves.toEqual([]);
});

test.each([401, 403, 429, 503])(
  'HTTP %i never triggers a hosted request, saved-password refresh or native request',
  async (status) => {
    await setTCSavedCredentials('412345678', 'test-password');
    mockFetch.mockResolvedValue(reply(status, { error: '尚未開放' }));
    await expect(tcFetchCourses()).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(primaryUrl);
  },
);

test.each([
  { ownerUid: 'other-user' },
  { schoolId: 'other-school' },
  { source: 'school-timetable' },
  { status: 'completed' },
  { fetchedAt: 'invalid' },
  { success: false },
  { courses: [course, course] },
  { courses: [{ ...course, teachers: [42] }] },
])('hosted receipts must match the owner and source: %j', async (patch) => {
  mockFetch.mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(hosted(patch));
  await expect(tcFetchCourses()).rejects.toThrow('資料不完整');
});

test.each([
  { useCloudFunctionEmulator: true },
  { cloudFunctionBaseUrl: 'http://127.0.0.1:5001/test' },
  { appEnv: 'development', allowLocalMockAuth: true },
])(
  'emulator and explicitly local mock configurations cannot reach the hosted fallback: %j',
  async (extra) => {
    Object.assign(Constants.expoConfig!.extra!, extra);
    mockFetch.mockResolvedValue(reply(404));
    await expect(tcFetchCourses()).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).not.toBe(hostedUrl);
  },
);

test('disabled LMS reads do not make either network request', async () => {
  Object.assign(Constants.expoConfig!.extra!, { tronClassDataEnabled: false });
  await expect(tcFetchCourses()).resolves.toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});

test('a primary network failure remains a failure', async () => {
  mockFetch.mockRejectedValue(new Error('network unavailable'));
  await expect(tcFetchCourses()).rejects.toThrow('network unavailable');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('a changed Firebase identity cannot receive the late course list', async () => {
  mockFetch.mockResolvedValueOnce(reply(404)).mockImplementationOnce(async () => {
    mockCurrentUser = { ...mockRequester };
    return hosted();
  });
  await expect(tcFetchCourses()).rejects.toThrow('帳號已變更');
});

test('clearing the LMS connection invalidates its late course response', async () => {
  mockFetch.mockResolvedValueOnce(reply(404)).mockImplementationOnce(async () => {
    await clearTCSession();
    return hosted();
  });
  await expect(tcFetchCourses()).rejects.toThrow('課程連線已變更');
});

test('an identity-token deadline cannot launch a late course request', async () => {
  jest.useFakeTimers();
  let finish!: (token: string) => void;
  mockRequester.getIdToken.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  try {
    const pending = tcFetchCourses();
    const checked = expect(pending).rejects.toThrow('逾時');
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(45_000);
    await checked;
    finish('late-token');
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
