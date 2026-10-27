import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { getAdapter } from '../../data/apiAdapters';
import { PUAdapter } from '../../data/apiAdapters/PUAdapter';
import { clearPUSession, signInWithStudentId } from '../../services/studentIdAuth';
import {
  clearMockAuthSession,
  loadMockAuthSession,
  saveMockAuthSession,
} from '../../services/mockAuth';
import {
  clearPUCache,
  getAnyCachedCourses,
  getAnyCachedGrades,
  seedCachedGrades,
} from '../../services/puDataCache';
import { puLogin, puFetchCourses, puFetchGrades } from '../../services/puDirectScraper';
import {
  clearTCSession,
  setTCBackendSession,
  setTCSavedCredentials,
  tcFetchProfile,
  tcLogin,
} from '../../services/tronClassClient';
import { syncPostLoginContextFromCaches } from '../../services/postLoginContextFromCaches';

const serverUid = 'pu-canonical-owner';
const mockSchoolUser = { uid: serverUid, getIdToken: jest.fn(async () => 'owner-id-token') };
const mockAuth = { currentUser: null as typeof mockSchoolUser | null };
let mockFirebaseConfigured = true;

jest.mock('../../firebase', () => ({
  getAuthInstance: () => mockAuth,
  hasUsableFirebaseConfig: () => mockFirebaseConfigured,
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn(), signOut: jest.fn() }));
jest.mock('../../data/apiAdapters', () => ({ getAdapter: jest.fn() }));
jest.mock('../../services/testSeedData', () => ({ seedTestData: jest.fn() }));
jest.mock('../../services/postLoginContextFromCaches', () => ({
  syncPostLoginContextFromCaches: jest.fn(async () => undefined),
}));
jest.mock('../../services/postLoginDataRouter', () => ({
  routePostLoginData: jest.fn(async () => ({ roleInference: { inferredRole: 'student' } })),
  routePostLoginDataWithContext: jest.fn(async () => undefined),
}));
jest.mock('../../services/secureStorage', () => ({
  secureGetItem: async () => null,
  secureSetItem: async () => undefined,
  secureDeleteItem: async () => undefined,
  secureDeleteMany: async () => undefined,
}));
jest.mock('../../services/mockAuth', () => {
  const actual = jest.requireActual('../../services/mockAuth');
  return {
    ...actual,
    clearMockAuthSession: jest.fn(actual.clearMockAuthSession),
    saveMockAuthSession: jest.fn(actual.saveMockAuthSession),
  };
});
jest.mock('../../services/puDirectScraper', () => {
  const actual = jest.requireActual('../../services/puDirectScraper');
  return {
    ...actual,
    puLogin: jest.fn(async () => ({ success: false, error: 'native unavailable' })),
    puFetchCourses: jest.fn(),
    puFetchGrades: jest.fn(),
  };
});
jest.mock('../../services/tronClassClient', () => {
  const actual = jest.requireActual('../../services/tronClassClient');
  return {
    ...actual,
    setTCSavedCredentials: jest.fn(actual.setTCSavedCredentials),
    setTCBackendSession: jest.fn(actual.setTCBackendSession),
    clearTCSession: jest.fn(actual.clearTCSession),
    tcLogin: jest.fn(async () => ({ success: false })),
    tcFetchProfile: jest.fn(async () => {
      throw new Error('unexpected profile preflight');
    }),
  };
});

const primary = 'https://legacy.functions.test';
const hosted = 'https://nuni.tw/api/fn';
const params = { studentId: 'B11234567', password: 'school-password', schoolId: 'pu' };
const course = {
  code: 'CS101',
  classOffered: '資工一',
  name: '資料庫',
  nameEn: 'Database',
  courseType: '必修',
  credits: 1.5,
  dayOfWeek: 1,
  periods: [1, 2],
  startTime: '08:10',
  endTime: '10:00',
  location: '資101',
  timePlaceRaw: '一(Mon)1,2:資101',
  teacherEmail: 'teacher@example.test',
};
const grades = [
  {
    semester: '1151',
    courseName: '資料庫',
    courseNameEn: '',
    className: '資工一',
    courseType: '必修',
    credits: 1.5,
    score: 88,
  },
];
const priorGrades = { grades: [], allSemesters: ['previous-account'], summary: {} };
const priorMock = {
  uid: 'previous-user',
  email: 'previous@example.test',
  schoolId: 'pu',
  displayName: '前一位同學',
  role: 'student' as const,
};
const loginPayload = {
  success: true,
  customToken: 'school-custom-token',
  uid: serverUid,
  studentId: '412345678',
  displayName: '測試同學',
  department: '資訊系',
  puSessionId: 'portal-session',
  tronClassSessionId: 'lms-session',
  tronClassUserId: 42,
  studentInfo: { studentId: '412345678', name: '測試同學', class: '資工一' },
  courses: null,
  grades: null,
  announcements: null,
};
const response = (status: number, payload: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
  json: async () => payload,
});
const mockFetch = jest.fn();
const originalFetch = globalThis.fetch;
let adapter: PUAdapter;

function route(url: string, options: RequestInit) {
  if (!url.startsWith(hosted)) return response(404);
  if (url.endsWith('/signInPuStudentId')) return response(200, loginPayload);
  const data = JSON.parse(String(options.body)).data;
  if (url.endsWith('/getMyAcademicRecords')) {
    return response(200, {
      result: {
        success: true,
        ownerUid: serverUid,
        schoolId: 'pu',
        source: 'pu-campus',
        dataType: data.dataType,
        result:
          data.dataType === 'courses'
            ? {
                success: true,
                courses: [course],
                studentInfo: { class: '資工一' },
                semester: '1151',
                totalCredits: 1.5,
              }
            : { success: true, grades, allSemesters: ['1151'], summary: {} },
      },
    });
  }
  if (url.endsWith('/getMyTronClassCourses')) {
    return response(200, {
      result: {
        success: true,
        ownerUid: serverUid,
        schoolId: 'pu',
        source: 'pu-tronclass',
        fetchedAt: '2026-10-27T00:00:00Z',
        status: data.status,
        courses: [
          {
            id: 72,
            name: '資料庫課程平台',
            code: 'CS101',
            teachers: ['王老師'],
            semester: '115-1',
            status: 'ongoing',
          },
        ],
      },
    });
  }
  throw new Error(`Unexpected hosted endpoint: ${url}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'development',
      allowLocalMockAuth: false,
      firebase: { projectId: 'campus-one-tw' },
      cloudFunctionBaseUrl: primary,
      tronClassDataEnabled: true,
      release: { releasedSchoolIds: ['pu'], features: { enabled: true, sso: true } },
    },
  });
  mockFirebaseConfigured = true;
  mockAuth.currentUser = null;
  clearPUSession();
  await clearTCSession();
  await clearPUCache();
  await AsyncStorage.clear();
  await saveMockAuthSession(priorMock);
  await seedCachedGrades(priorGrades);
  jest.clearAllMocks();
  adapter = new PUAdapter();
  jest.mocked(getAdapter).mockReset().mockResolvedValue(adapter);
  jest
    .mocked(signInWithCustomToken)
    .mockReset()
    .mockImplementation(async () => {
      mockAuth.currentUser = mockSchoolUser;
      return { user: mockSchoolUser } as Awaited<ReturnType<typeof signInWithCustomToken>>;
    });
  jest
    .mocked(signOut)
    .mockReset()
    .mockImplementation(async () => {
      mockAuth.currentUser = null;
    });
  mockFetch
    .mockReset()
    .mockImplementation(async (url: string, options: RequestInit) => route(url, options));
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  jest.useRealTimers();
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('real school login exchanges the hosted token, uses its actual UID and immediately reads owned course/grade/LMS data', async () => {
  const result = await signInWithStudentId(params);
  expect(mockFetch).toHaveBeenNthCalledWith(
    1,
    `${primary}/signInPuStudentId`,
    expect.objectContaining({ body: JSON.stringify(params) }),
  );
  expect(mockFetch).toHaveBeenNthCalledWith(
    2,
    `${hosted}/signInPuStudentId`,
    expect.objectContaining({ body: JSON.stringify(params) }),
  );
  expect(signInWithCustomToken).toHaveBeenCalledWith(mockAuth, 'school-custom-token');
  expect(result.uid).toBe(serverUid);
  expect(await loadMockAuthSession()).toBeNull();
  expect(saveMockAuthSession).not.toHaveBeenCalled();
  expect(result.syncSummary?.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'timetable',
        state: 'received',
        detail: '已讀取 1 筆上課紀錄',
      }),
      expect.objectContaining({ key: 'grades', state: 'received', detail: '已讀取 1 筆成績' }),
      expect.objectContaining({ key: 'learning', state: 'received', detail: '已讀取 1 門課程' }),
    ]),
  );
  expect((await getAnyCachedCourses())?.courses[0].credits).toBe(1.5);
  expect((await getAnyCachedGrades())?.grades).toEqual(grades);
  expect(syncPostLoginContextFromCaches).toHaveBeenCalledWith(
    expect.objectContaining({ uid: serverUid }),
  );
  expect(puLogin).not.toHaveBeenCalled();
  expect(puFetchCourses).not.toHaveBeenCalled();
  expect(puFetchGrades).not.toHaveBeenCalled();
  expect(tcLogin).not.toHaveBeenCalled();
  expect(tcFetchProfile).not.toHaveBeenCalled();
  expect(mockFetch.mock.calls.some(([url]) => String(url).includes('puFetchCampusData'))).toBe(
    false,
  );
  for (const [url, options] of mockFetch.mock.calls.filter(([url]) =>
    String(url).includes('getMyAcademicRecords'),
  )) {
    expect(options.headers.Authorization).toBe('Bearer owner-id-token');
    expect(JSON.parse(options.body)).toEqual({
      data: { dataType: expect.stringMatching(/^(courses|grades)$/) },
    });
    expect(options.body).not.toMatch(/portal-session|password|studentId/);
    expect(url).toMatch(/getMyAcademicRecords$/);
  }
  mockFetch.mockClear();
  expect(await adapter.listCourses(serverUid)).toHaveLength(1);
  expect(await adapter.listGrades(serverUid)).toEqual([
    expect.objectContaining({ userId: serverUid, gradeSource: 'school-official', credits: 1.5 }),
  ]);
  expect(mockFetch.mock.calls.every(([url]) => String(url).endsWith('/getMyAcademicRecords'))).toBe(
    true,
  );
});

test.each([400, 401, 403, 429, 503])(
  'hosted HTTP %i is terminal and preserves the previous local session',
  async (status) => {
    mockFetch.mockImplementation(async (url: string) =>
      response(url.startsWith(hosted) ? status : 404, { error: '尚未開放' }),
    );
    await expect(signInWithStudentId(params)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(puLogin).not.toHaveBeenCalled();
    expect(tcLogin).not.toHaveBeenCalled();
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
    expect(clearTCSession).not.toHaveBeenCalled();
    expect(await loadMockAuthSession()).toEqual(expect.objectContaining({ uid: 'previous-user' }));
    expect(await getAnyCachedGrades()).toEqual(priorGrades);
  },
);

test.each([401, 403, 429, 503])(
  'primary HTTP %i cannot send credentials to another login route',
  async (status) => {
    mockFetch.mockResolvedValue(response(status, { error: '服務暫時無法使用' }));
    await expect(signInWithStudentId(params)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
    expect(puLogin).not.toHaveBeenCalled();
  },
);

test.each([undefined, ''])(
  'a successful response without a real token (%s) cannot bootstrap or become mock login',
  async (customToken) => {
    mockFetch.mockImplementation(async (url: string) =>
      response(url.startsWith(hosted) ? 200 : 404, { ...loginPayload, customToken }),
    );
    await expect(signInWithStudentId(params)).rejects.toThrow('身分驗證');
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(clearMockAuthSession).not.toHaveBeenCalled();
    expect(saveMockAuthSession).not.toHaveBeenCalled();
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
    expect(clearTCSession).not.toHaveBeenCalled();
    expect(await getAnyCachedGrades()).toEqual(priorGrades);
  },
);

test.each([
  { firebase: { projectId: 'different-project' } },
  { firebase: { projectId: 'demo-campus' } },
  { useCloudFunctionEmulator: true },
  { allowLocalMockAuth: true },
])(
  'incompatible or local configuration cannot fall back to hosted school credentials: %j',
  async (extra) => {
    Object.assign(Constants.expoConfig!.extra!, extra);
    mockFetch.mockResolvedValue(response(404));
    await expect(signInWithStudentId(params)).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).not.toBe(`${hosted}/signInPuStudentId`);
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
  },
);

test('token exchange failure preserves previous data and cannot trigger native login', async () => {
  jest.mocked(signInWithCustomToken).mockRejectedValue(new Error('auth/custom-token-mismatch'));
  await expect(signInWithStudentId(params)).rejects.toThrow('custom-token-mismatch');
  expect(clearMockAuthSession).not.toHaveBeenCalled();
  expect(setTCBackendSession).not.toHaveBeenCalled();
  expect(setTCSavedCredentials).not.toHaveBeenCalled();
  expect(clearTCSession).not.toHaveBeenCalled();
  expect(puLogin).not.toHaveBeenCalled();
  expect(await getAnyCachedGrades()).toEqual(priorGrades);
});

test('an aborted backend wait cannot store credentials or send a late hosted request', async () => {
  jest.useFakeTimers();
  const reached = deferred<void>();
  const reply = deferred<ReturnType<typeof response>>();
  mockFetch.mockImplementation(async () => {
    reached.resolve();
    return reply.promise;
  });
  try {
    const pending = signInWithStudentId(params);
    const checked = expect(pending).rejects.toThrow();
    await reached.promise;
    jest.advanceTimersByTime(45_000);
    await checked;
    reply.resolve(response(404));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
    expect(clearTCSession).not.toHaveBeenCalled();
    expect(await getAnyCachedGrades()).toEqual(priorGrades);
  } finally {
    jest.useRealTimers();
  }
});

test.each([false, true])(
  'UID mismatch clears only the mismatched current login (newer user: %s)',
  async (newerUser) => {
    const wrong = { ...mockSchoolUser, uid: 'wrong-owner' };
    const newer = { ...mockSchoolUser, uid: 'newer-owner' };
    jest.mocked(signInWithCustomToken).mockImplementation(async () => {
      mockAuth.currentUser = newerUser ? newer : wrong;
      return { user: wrong } as Awaited<ReturnType<typeof signInWithCustomToken>>;
    });
    await expect(signInWithStudentId(params)).rejects.toThrow('身分不一致');
    expect(signOut).toHaveBeenCalledTimes(newerUser ? 0 : 1);
    expect(mockAuth.currentUser).toBe(newerUser ? newer : null);
    expect(clearMockAuthSession).not.toHaveBeenCalled();
    expect(setTCBackendSession).not.toHaveBeenCalled();
    expect(setTCSavedCredentials).not.toHaveBeenCalled();
    expect(clearTCSession).not.toHaveBeenCalled();
    expect(await getAnyCachedGrades()).toEqual(priorGrades);
  },
);

test('a newer Firebase user while hosted login is pending blocks the late token exchange', async () => {
  const reached = deferred<void>();
  const reply = deferred<ReturnType<typeof response>>();
  mockFetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (url === `${hosted}/signInPuStudentId`) {
      reached.resolve();
      return reply.promise;
    }
    return route(url, options);
  });
  const pending = signInWithStudentId(params);
  const checked = expect(pending).rejects.toThrow('帳號已變更');
  await reached.promise;
  mockAuth.currentUser = { ...mockSchoolUser, uid: 'newer-owner' };
  reply.resolve(response(200, loginPayload));
  await checked;
  expect(signInWithCustomToken).not.toHaveBeenCalled();
  expect(clearMockAuthSession).not.toHaveBeenCalled();
  expect(setTCSavedCredentials).not.toHaveBeenCalled();
  expect(clearTCSession).not.toHaveBeenCalled();
  expect(await getAnyCachedGrades()).toEqual(priorGrades);
});

test('logout during token exchange cannot be undone by a late credential', async () => {
  const reached = deferred<void>();
  const token = deferred<void>();
  jest.mocked(signInWithCustomToken).mockImplementation(async () => {
    reached.resolve();
    await token.promise;
    mockAuth.currentUser = mockSchoolUser;
    return { user: mockSchoolUser } as Awaited<ReturnType<typeof signInWithCustomToken>>;
  });
  const pending = signInWithStudentId(params);
  const checked = expect(pending).rejects.toThrow('登入已取消');
  await reached.promise;
  clearPUSession();
  token.resolve();
  await checked;
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(mockAuth.currentUser).toBeNull();
  expect(clearMockAuthSession).not.toHaveBeenCalled();
  expect(setTCSavedCredentials).not.toHaveBeenCalled();
  expect(await getAnyCachedGrades()).toEqual(priorGrades);
});

test('an account switch while adapter loading is pending cannot seed or publish the old bootstrap', async () => {
  const reached = deferred<void>();
  const ready = deferred<PUAdapter>();
  jest.mocked(getAdapter).mockImplementation(async () => {
    reached.resolve();
    return ready.promise;
  });
  const pending = signInWithStudentId(params);
  const checked = expect(pending).rejects.toThrow('帳號已變更');
  await reached.promise;
  mockAuth.currentUser = { ...mockSchoolUser, uid: 'newer-owner' };
  ready.resolve(adapter);
  await checked;
  expect(setTCBackendSession).not.toHaveBeenCalled();
  expect(setTCSavedCredentials).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(syncPostLoginContextFromCaches).not.toHaveBeenCalled();
  expect(await getAnyCachedGrades()).toEqual(priorGrades);
});

test('hosted login without an LMS session completes only school data and does not resend the password', async () => {
  mockFetch.mockImplementation(async (url: string, options: RequestInit) =>
    url === `${hosted}/signInPuStudentId`
      ? response(200, { ...loginPayload, tronClassSessionId: null })
      : route(url, options),
  );
  const result = await signInWithStudentId(params);
  expect(result.syncSummary?.items.find((item) => item.key === 'learning')?.state).toBe(
    'unavailable',
  );
  expect(result.syncSummary?.items.find((item) => item.key === 'grades')?.state).toBe('received');
  expect(tcLogin).not.toHaveBeenCalled();
  expect(tcFetchProfile).not.toHaveBeenCalled();
  expect(mockFetch.mock.calls.some(([url]) => /TronClass/.test(String(url)))).toBe(false);
});

test('an owned-source failure stays unavailable while the other school source remains usable', async () => {
  mockFetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (
      url === `${hosted}/getMyAcademicRecords` &&
      JSON.parse(String(options.body)).data.dataType === 'grades'
    )
      return response(403);
    if (url === `${hosted}/getMyTronClassCourses`) return response(403);
    return route(url, options);
  });
  const result = await signInWithStudentId(params);
  expect(result.syncSummary?.items.find((item) => item.key === 'timetable')?.state).toBe(
    'received',
  );
  expect(result.syncSummary?.items.find((item) => item.key === 'grades')?.state).toBe(
    'unavailable',
  );
  expect(result.syncSummary?.items.find((item) => item.key === 'learning')?.state).toBe(
    'unavailable',
  );
  expect(await getAnyCachedGrades()).toBeNull();
  await expect(adapter.listCourseSpaces(serverUid)).rejects.toThrow();
  expect(tcLogin).not.toHaveBeenCalled();
});

test('disabled LMS bootstrap never requests a course platform endpoint', async () => {
  Object.assign(Constants.expoConfig!.extra!, { tronClassDataEnabled: false });
  const result = await signInWithStudentId(params);
  expect(result.syncSummary?.items.find((item) => item.key === 'learning')?.state).toBe('disabled');
  expect(mockFetch.mock.calls.some(([url]) => /TronClass/.test(String(url)))).toBe(false);
  expect(setTCSavedCredentials).not.toHaveBeenCalled();
});
