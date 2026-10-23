import { httpsCallable } from 'firebase/functions';
import { getDocFromServer } from 'firebase/firestore';
import { getAuthInstance, isFirebaseMockMode } from '../firebase';
import { getCourseSpace } from '../data/courseSpaceSource';
import { queryCatalog } from '../services/courseCatalogClient';
import type { CatalogCourse, CatalogQueryResult } from '../services/courseCatalogClient';
import {
  askCourseAdvisor,
  loadAdvisorCatalog,
  loadAdvisorCourse,
  currentAdvisorSemester,
  officialSyllabusUrl,
} from '../features/courseAdvisor';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDocFromServer: jest.fn() }));
jest.mock('../firebase', () => ({
  getAuthInstance: jest.fn(),
  getDb: jest.fn(),
  getFunctionsInstance: jest.fn(),
  isFirebaseMockMode: jest.fn(() => false),
}));
jest.mock('../data/courseSpaceSource', () => ({ getCourseSpace: jest.fn() }));
jest.mock('../services/courseCatalogClient', () => ({ queryCatalog: jest.fn() }));
const scope = { userId: 'student-a', schoolId: 'pu' };
const course = {
  code: 'CS101',
  name: '資料結構',
  teacher: '陳老師',
  credits: 3,
  semester: '1151',
  raw: { credit: '3' },
  timePlaceRaw: '週一 3,4',
  syllabusUrl: 'https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/info',
} as CatalogCourse;
const catalog: CatalogQueryResult = {
  courses: [course],
  filter: { semester: '1151' },
  source: 'live',
  fetchedAt: 1780000000000,
  showRemain: false,
  totalCount: 1,
};
const call = jest.fn();
const ask = (overrides = {}) =>
  askCourseAdvisor({
    scope,
    history: [],
    question: '這門课適合什麼背景？',
    course,
    catalog,
    isCurrent: () => true,
    ...overrides,
  });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: scope.userId } } as never);
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest
    .mocked(getDocFromServer)
    .mockResolvedValue({ exists: () => true, data: () => ({ schoolId: 'pu' }) } as never);
  jest.mocked(queryCatalog).mockResolvedValue(catalog);
  jest.mocked(httpsCallable).mockReturnValue(call);
  call.mockResolvedValue({
    data: { content: '請先確認課綱的先修要求。', run: { status: 'completed' } },
  });
});
test.each([
  [2026, 0, '1141'],
  [2026, 1, '1142'],
  [2026, 7, '1151'],
])(
  'computes semester at month boundaries without frozen catalog defaults',
  (year, month, expected) => {
    expect(currentAdvisorSemester(new Date(Number(year), Number(month), 5))).toBe(expected);
  },
);
test('loads genuine catalog records and preserves source/time', async () => {
  const signal = new AbortController().signal;
  await expect(loadAdvisorCatalog('pu', '1151', ' 資料 ', signal)).resolves.toEqual(catalog);
  expect(queryCatalog).toHaveBeenCalledWith(
    { semester: '1151', keyword: '資料' },
    { signal, limit: 200 },
  );
});
test.each([
  { source: 'sample' },
  { error: 'offline' },
  { source: 'cache', error: 'offline' },
  { filter: { semester: '1142' } },
  { courses: [{ ...course, semester: '1142' }] },
])('rejects unusable catalog result %p without fixed recommendations', async (change) => {
  jest.mocked(queryCatalog).mockResolvedValue({ ...catalog, ...change } as CatalogQueryResult);
  await expect(
    loadAdvisorCatalog('pu', '1151', '', new AbortController().signal),
  ).rejects.toThrow();
});
test('another school never queries PU data', async () => {
  await expect(
    loadAdvisorCatalog('other', '1151', '', new AbortController().signal),
  ).rejects.toThrow();
  expect(queryCatalog).not.toHaveBeenCalled();
});
test('an empty live catalog stays empty', async () => {
  jest.mocked(queryCatalog).mockResolvedValue({ ...catalog, courses: [], totalCount: 0 });
  expect(
    (await loadAdvisorCatalog('pu', '1151', '', new AbortController().signal)).courses,
  ).toEqual([]);
});
test('sends real selected course evidence to the managed callable without fabricated student background', async () => {
  await expect(ask()).resolves.toBe('請先確認課綱的先修要求。');
  expect(httpsCallable).toHaveBeenCalledWith(undefined, 'askCampusAssistant');
  const input = call.mock.calls[0][0];
  expect(input.context).toMatchObject({ schoolId: 'pu', screen: 'course-advisor' });
  expect(input.messages[0].content).toContain('資料結構');
  expect(input.messages[0].content).not.toMatch(/GPA|18學分|林教授|高評價/);
});
test('cloud failure rejects without a local answer', async () => {
  call.mockRejectedValueOnce(new Error('unavailable'));
  await expect(ask()).rejects.toThrow('unavailable');
});
test.each([
  { content: '' },
  { content: '假的結果', error: 'offline' },
  { content: '假的結果', run: { status: 'failed' } },
])('rejects unsuccessful callable response %p', async (data) => {
  call.mockResolvedValueOnce({ data });
  await expect(ask()).rejects.toThrow();
});
test('a school mismatch rejects before callable dispatch', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValue({ exists: () => true, data: () => ({ schoolId: 'other' }) } as never);
  await expect(ask()).rejects.toThrow('學校');
  expect(call).not.toHaveBeenCalled();
});
test('account switch during profile read prevents callable dispatch', async () => {
  jest.mocked(getDocFromServer).mockImplementation(async () => {
    jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: 'student-b' } } as never);
    return { exists: () => true, data: () => ({ schoolId: 'pu' }) } as never;
  });
  await expect(ask()).rejects.toThrow('登入狀態');
  expect(call).not.toHaveBeenCalled();
});
test('scope invalidation while callable is in flight rejects the old reply', async () => {
  let current = true;
  call.mockImplementationOnce(async () => {
    current = false;
    return { data: { content: 'old reply', run: { status: 'completed' } } };
  });
  await expect(ask({ isCurrent: () => current })).rejects.toThrow('登入狀態');
});
test('focused courses require real current membership, not route labels or demo identifiers', async () => {
  jest.mocked(getCourseSpace).mockResolvedValue(null);
  await expect(loadAdvisorCourse({ ...scope, groupId: 'demo-1' }, () => true)).rejects.toThrow(
    '無法存取',
  );
});
test('a selected catalog course does not inherit a different classroom context', async () => {
  await ask({ scope: { ...scope, groupId: 'other-classroom' } });
  expect(call.mock.calls[0][0].context.groupId).toBeUndefined();
  expect(getCourseSpace).not.toHaveBeenCalled();
});
test('syllabus links require the official HTTPS host', () => {
  expect(officialSyllabusUrl(course)).toBe(course.syllabusUrl);
  for (const syllabusUrl of [
    'javascript:alert(1)',
    'https://mypu.pu.edu.tw.evil.test/',
    'https://x@mypu.pu.edu.tw/',
  ]) {
    expect(officialSyllabusUrl({ ...course, syllabusUrl })).toBeNull();
  }
});

test('missing upstream credits stay unknown and fractional credits are retained', async () => {
  jest.mocked(queryCatalog).mockResolvedValueOnce({
    ...catalog,
    courses: [
      { ...course, raw: {}, credits: 0 },
      { ...course, raw: { credit: '1.5' }, credits: 1 },
    ],
  });
  const result = await loadAdvisorCatalog('pu', '1151', '', new AbortController().signal);
  expect(Number.isNaN(result.courses[0].credits)).toBe(true);
  expect(result.courses[1].credits).toBe(1.5);
});
