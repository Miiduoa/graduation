// Exercise the enabled parsing/ownership contract independently of the release pause.
jest.mock('@campus/shared/src/puEcampusDataPolicy', () => ({
  ...jest.requireActual('@campus/shared/src/puEcampusDataPolicy'),
  isPuEcampusDataFetchEnabled: () => true,
  assertPuEcampusDataFetchEnabled: () => {},
}));

import Constants from 'expo-constants';
import {
  loadOwnedSchoolCourses,
  loadOwnedSchoolGrades,
} from '../../services/ownedSchoolAcademicRecords';

const mockRequester = { uid: 'student-a', getIdToken: jest.fn(async () => 'firebase-token') };
let mockCurrentUser: typeof mockRequester | null = mockRequester;
let mockPrimaryUrl = 'https://functions.test/getMyAcademicRecords';
const mockFetch = jest.fn();
jest.mock('../../firebase', () => ({ getAuthInstance: () => ({ currentUser: mockCurrentUser }) }));
jest.mock('../../services/cloudFunctions', () => ({
  ...jest.requireActual('../../services/cloudFunctions'),
  getCloudFunctionUrl: () => mockPrimaryUrl,
}));
const response = (status: number, patch: Record<string, unknown> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({
    result: {
      success: true,
      ownerUid: 'student-a',
      schoolId: 'pu',
      source: 'pu-campus',
      dataType: 'grades',
      result: {
        success: true,
        grades: [{ courseName: '資料庫', credits: 3, score: 88 }],
        allSemesters: ['1151'],
        summary: {},
      },
      ...patch,
    },
  }),
});
const originalFetch = globalThis.fetch;
beforeEach(() => {
  Object.assign(Constants.expoConfig!, {
    extra: { appEnv: 'production', firebase: { projectId: 'campus-one-tw' } },
  });
  mockCurrentUser = mockRequester;
  mockPrimaryUrl = 'https://functions.test/getMyAcademicRecords';
  mockFetch.mockReset();
  mockRequester.getIdToken.mockReset().mockResolvedValue('firebase-token');
  globalThis.fetch = mockFetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test('restored Firebase login reads owner-selected grades without sending school credentials', async () => {
  mockFetch.mockResolvedValue(response(200));
  expect((await loadOwnedSchoolGrades('student-a')).grades).toHaveLength(1);
  const [, options] = mockFetch.mock.calls[0];
  expect(JSON.parse(options.body)).toEqual({ data: { dataType: 'grades' } });
  expect(options.headers.Authorization).toBe('Bearer firebase-token');
});

test('owner-selected courses preserve their school source and normalize the profile class alias', async () => {
  mockFetch.mockResolvedValue(
    response(200, {
      dataType: 'courses',
      result: {
        success: true,
        courses: [{ code: 'CS101', name: '資料庫', credits: 1.5 }],
        studentInfo: { class: '資工一' },
        semester: '1151',
        totalCredits: 1.5,
      },
    }),
  );
  const result = await loadOwnedSchoolCourses('student-a');
  expect(result.courses).toHaveLength(1);
  expect(result.studentInfo.className).toBe('資工一');
  expect(result.totalCredits).toBe(1.5);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ data: { dataType: 'courses' } });
});

test('a course request cannot accept grades or a mismatched owner as its response', async () => {
  mockFetch.mockResolvedValue(response(200));
  await expect(loadOwnedSchoolCourses('student-a')).rejects.toThrow('無法讀取課表');
  mockFetch.mockResolvedValue(
    response(200, {
      dataType: 'courses',
      ownerUid: 'other',
      result: { success: true, courses: [] },
    }),
  );
  await expect(loadOwnedSchoolCourses('student-a')).rejects.toThrow('無法讀取課表');
});

test('missing school credit totals do not become an invented zero', async () => {
  mockFetch.mockResolvedValue(
    response(200, { dataType: 'courses', result: { success: true, courses: [] } }),
  );
  await expect(loadOwnedSchoolCourses('student-a')).rejects.toThrow('缺少學分資訊');
});

test.each([
  { ownerUid: 'other' },
  { schoolId: 'nchu' },
  { source: 'unknown' },
  { dataType: 'courses' },
  { result: { success: false, grades: [] } },
])('rejects a mismatched or unsuccessful receipt: %j', async (patch) => {
  mockFetch.mockResolvedValue(response(200, patch));
  await expect(loadOwnedSchoolGrades('student-a')).rejects.toThrow('校務連線');
});

test('only an undeployed HTTPS callable falls back to the canonical gateway', async () => {
  mockFetch.mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(200));
  await loadOwnedSchoolGrades('student-a');
  expect(mockFetch).toHaveBeenNthCalledWith(
    2,
    'https://nuni.tw/api/fn/getMyAcademicRecords',
    expect.any(Object),
  );
});

test.each([401, 403, 503])('HTTP %i cannot trigger another credential request', async (status) => {
  mockFetch.mockResolvedValue(response(status));
  await expect(loadOwnedSchoolGrades('student-a')).rejects.toThrow();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('emulator 404 remains in the emulator', async () => {
  mockPrimaryUrl = 'http://127.0.0.1:5001/test/getMyAcademicRecords';
  mockFetch.mockResolvedValue(response(404));
  await expect(loadOwnedSchoolGrades('student-a')).rejects.toThrow();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('discards late responses after changing users or re-signing into the same user', async () => {
  mockFetch.mockImplementation(async () => {
    mockCurrentUser = { ...mockRequester };
    return response(200);
  });
  await expect(loadOwnedSchoolGrades('student-a')).rejects.toThrow('帳號已變更');
});

test('a different requested UID never starts a request', async () => {
  await expect(loadOwnedSchoolGrades('student-b')).rejects.toThrow('重新連線');
  expect(mockFetch).not.toHaveBeenCalled();
});

test('a direct network failure stays a failure without using another endpoint', async () => {
  mockFetch.mockRejectedValue(new Error('network unavailable'));
  await expect(loadOwnedSchoolGrades('student-a')).rejects.toThrow('network unavailable');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('an unresponsive identity token has a deadline and cannot launch a late school request', async () => {
  jest.useFakeTimers();
  let finish!: (token: string) => void;
  mockRequester.getIdToken.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  try {
    const pending = loadOwnedSchoolGrades('student-a');
    const checked = expect(pending).rejects.toThrow('逾時');
    jest.advanceTimersByTime(45_000);
    await checked;
    finish('late-token');
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
