import { askCampusAssistant } from '../../features/campusAssistant';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';

let mockUid: string | null = 'student-a';
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  getFunctionsInstance: () => ({}),
  isFirebaseMockMode: () => false,
}));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: {
    getRuntimeAvailability: jest.fn(() => ({ available: false })),
    getSavedModelId: jest.fn(async () => null),
    isModelDownloaded: jest.fn(async () => false),
    getDownloadedModels: jest.fn(async () => []),
    generate: jest.fn(), loadModel: jest.fn(),
  },
  getDefaultLocalLlmModelId: () => 'qwen2.5-0.5b',
}));
jest.mock('../../services/onDeviceSchoolContext', () => ({
  collectOnDeviceSchoolContext: jest.fn(async ({ schoolId }: { schoolId: string }) => ({
    checkedAt: '2026-11-07T06:00:00.000Z', schoolId, schoolName: schoolId,
    timetable: { source: 'not-available', updatedAt: null, courses: [] },
  })),
  formatOnDeviceSchoolPrompt: jest.fn(),
}));
const { localLLM } = require('../../services/localLLMInference');
const { collectOnDeviceSchoolContext } = require('../../services/onDeviceSchoolContext');
const originalFetch = globalThis.fetch;
const fetchSource = jest.fn();
const course = {
  code: '11510CS 542000', section: '00', title: '資料庫系統', department: '資工系', teacher: '王老師',
  time: 'M3M4', room: '資電館 101', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '資電館 101' }],
};
function response(schoolId: 'ncnu' | 'nthu' = 'nthu', changes: Record<string, unknown> = {}) {
  const operation = resolvePublicCourseOperation(schoolId)!;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({
    schoolId, sourceUrl: operation.sourceUrl, courses: [course], truncated: false,
    fetchedAt: '2026-11-07T06:00:00.000Z',
    operation: { id: operation.id, version: 1, responseSchemaVersion: 1, access: 'anonymous-public' },
    ...changes,
  }) };
}
function input(question = '幫我查清大的資料庫課程') {
  return { scope: { uid: mockUid ?? '', schoolId: 'pu' }, messages: [{ role: 'user' as const, content: question }],
    mode: 'device' as const, isCurrent: () => true };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  fetchSource.mockReset().mockResolvedValue(response());
  globalThis.fetch = fetchSource;
  mockUid = 'student-a';
});
afterEach(() => { globalThis.fetch = originalFetch; });

test.each(['student-a', null])('the real anonymous operation answers a PU user without a model or private reads: %s', async (uid) => {
  mockUid = uid;
  const reply = await askCampusAssistant(input());
  expect(reply).toMatchObject({ source: 'device', tool: 'public-course-catalog', hasActions: false,
    publicCourseRead: { schoolId: 'nthu', query: '資料庫', status: 'ready', courses: [course], matchCount: 1 } });
  const [url, options] = fetchSource.mock.calls[0];
  expect(new URL(url).origin + new URL(url).pathname).toBe('https://nuni.tw/api/public-course-catalog');
  expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ schoolId: 'nthu', q: '資料庫' });
  expect(options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } });
  expect(options).not.toHaveProperty('cache');
  expect(fetchSource).toHaveBeenCalledTimes(1);
  expect(collectOnDeviceSchoolContext).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
  expect(localLLM.loadModel).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('NCNU is selected explicitly and an empty successful source remains different from a failed read', async () => {
  fetchSource.mockResolvedValue(response('ncnu', { courses: [] }));
  const reply = await askCampusAssistant(input('幫我查暨大的資料庫課程'));
  expect(reply.publicCourseRead).toMatchObject({ schoolId: 'ncnu', query: '資料庫', status: 'ready', matchCount: 0, courses: [] });
  expect(new URL(fetchSource.mock.calls[0][0]).searchParams.get('schoolId')).toBe('ncnu');
});

test.each([
  { schoolId: 'ncnu' },
  { sourceUrl: 'https://example.test/unverified' },
  { operation: { id: 'nthu.courses.search', version: 9, responseSchemaVersion: 1, access: 'anonymous-public' } },
])('a mismatched source is unavailable, never a zero-result success or generated answer: %j', async (changes) => {
  fetchSource.mockResolvedValue(response('nthu', changes));
  const reply = await askCampusAssistant(input());
  expect(reply.publicCourseRead).toMatchObject({ schoolId: 'nthu', query: '資料庫', status: 'unavailable' });
  expect(reply.publicCourseRead).not.toHaveProperty('courses');
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('ambiguous or unsupported schools are clarified without fetching another campus', async () => {
  for (const question of ['幫我查清大和暨大的資料庫課程', '幫我查台大的資料庫課程']) {
    const reply = await askCampusAssistant(input(question));
    expect(reply.tool).toBe('public-course-catalog');
    expect(reply.publicCourseRead).toBeUndefined();
  }
  expect(fetchSource).not.toHaveBeenCalled();
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test('cancel settles while fetch is pending and a late reply cannot become a result', async () => {
  const delayed = deferred<ReturnType<typeof response>>();
  fetchSource.mockReturnValue(delayed.promise);
  const controller = new AbortController();
  const request = askCampusAssistant({ ...input(), signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ code: 'cancelled' });
  controller.abort();
  await rejected;
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  delayed.resolve(response());
  await Promise.resolve();
  expect(localLLM.generate).not.toHaveBeenCalled();
});

test.each(['school', 'account'])('a late public answer is discarded after the initiating %s changes', async (change) => {
  const delayed = deferred<ReturnType<typeof response>>();
  fetchSource.mockReturnValue(delayed.promise);
  let current = true;
  const request = askCampusAssistant({ ...input(), isCurrent: () => current });
  if (change === 'school') current = false;
  else mockUid = 'student-b';
  delayed.resolve(response());
  await expect(request).rejects.toMatchObject({ code: 'session-changed' });
});

test('pre-cancelled requests never start the public transport', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(askCampusAssistant({ ...input(), signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetchSource).not.toHaveBeenCalled();
});

test('personal class questions and the platform-specific assistant keep their existing paths', async () => {
  const personal = await askCampusAssistant(input('我現在有課嗎？'));
  expect(personal.tool).toBe('saved-timetable');
  const platform = await askCampusAssistant({ ...input(), scope: { uid: '', schoolId: 'pu' },
    platformTimetable: { accountId: 'platform-a', isCurrent: () => true } });
  expect(platform.tool).toBe('saved-timetable');
  expect(fetchSource).not.toHaveBeenCalled();
});
