import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { getAuthInstance, isFirebaseMockMode } from '../../firebase';
import { loadCourseHub, courseResourceUrl, type CourseHubScope } from '../../features/courseHub';
import { tcFetchCourseDetail } from '../../services/tronClassClient';
import { isTronClassDataFetchEnabled } from '../../services/tronClassDataEnabled';
import { resolveCourseHubTarget } from '../../utils/courseHubRoute';

jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  getAuthInstance: jest.fn(),
  isFirebaseMockMode: jest.fn(() => false),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((...args) => args.slice(1).join('/')),
  collection: jest.fn((...args) => args.slice(1).join('/')),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
}));
jest.mock('../../services/tronClassClient', () => ({ tcFetchCourseDetail: jest.fn() }));
jest.mock('../../services/tronClassDataEnabled', () => ({
  isTronClassDataFetchEnabled: jest.fn(() => true),
}));
const scope: CourseHubScope = {
  uid: 'alice',
  schoolId: 'pu',
  target: { source: 'group', groupId: 'course-a' },
};
let records: Record<string, Record<string, unknown>>;
const document = (data?: Record<string, unknown>) =>
  ({ exists: () => Boolean(data), data: () => data }) as Awaited<
    ReturnType<typeof getDocFromServer>
  >;
const collectionResult = (rows: Record<string, unknown>[]) =>
  ({ docs: rows.map((data, i) => ({ id: String(i), data: () => data })) }) as Awaited<
    ReturnType<typeof getDocsFromServer>
  >;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(isTronClassDataFetchEnabled).mockReturnValue(true);
  jest
    .mocked(getAuthInstance)
    .mockReturnValue({ currentUser: { uid: 'alice' } } as ReturnType<typeof getAuthInstance>);
  records = {
    'schools/pu/members/alice': { status: 'active' },
    'groups/course-a': {
      name: '資訊倫理',
      type: 'course',
      schoolId: 'pu',
      description: '閱讀與討論',
    },
    'groups/course-a/members/alice': { status: 'active', role: 'member' },
  };
  jest.mocked(getDocFromServer).mockImplementation(async (ref) => document(records[String(ref)]));
  jest.mocked(getDocsFromServer).mockResolvedValue(collectionResult([]));
});
test('course identifiers have explicit provenance and no default course or inferred group', () => {
  expect(resolveCourseHubTarget({ groupId: 'course-a', courseName: 'wrong label' })).toEqual(
    scope.target,
  );
  expect(resolveCourseHubTarget({ courseSpaceId: 'course-a' })).toEqual(scope.target);
  expect(resolveCourseHubTarget({ source: 'tronclass', courseId: 123 })).toEqual({
    source: 'tronclass',
    courseId: 123,
  });
  for (const params of [
    {},
    { courseId: 'CS302' },
    { groupId: '../course' },
    { source: 'tronclass', courseId: '123/4' },
    { source: 'tronclass', courseId: -1 },
  ])
    expect(resolveCourseHubTarget(params)).toBeNull();
});
test('loads authoritative same-course content, hides drafts and rejects unsafe material links', async () => {
  jest.mocked(getDocsFromServer).mockImplementation(async (ref) =>
    String(ref).endsWith('/modules')
      ? collectionResult([
          {
            title: '第二單元',
            published: true,
            resourceUrl: 'https://school.test/reading',
            order: 2,
          },
          { title: '第一單元', published: true, resourceUrl: 'javascript:alert(1)', order: 1 },
          { title: '草稿教材', published: false },
        ])
      : collectionResult([
          {
            title: '閱讀心得',
            type: 'assignment',
            published: true,
            status: 'published',
            dueAt: '2026-10-10T10:00:00Z',
          },
          { title: '草稿作業', status: 'draft' },
        ]),
  );
  const result = await loadCourseHub(scope);
  expect(result.name).toBe('資訊倫理');
  expect(result.materials.items.map((item) => item.url)).toEqual([
    null,
    'https://school.test/reading',
  ]);
  expect(result.assignments.items).toHaveLength(1);
  expect(result.assignments.items[0].dueAt).toBe('2026-10-10T10:00:00.000Z');
  expect(getDocsFromServer).toHaveBeenCalledWith('groups/course-a/assignments');
  expect(getDocsFromServer).toHaveBeenCalledWith('groups/course-a/modules');
  expect(getDocFromServer).toHaveBeenCalledTimes(6);
  expect(JSON.stringify(result)).not.toMatch(/13\/15|6\/7|88|A-/);
});
test('confirmed empty and rejected sections stay distinct', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('unavailable'));
  const result = await loadCourseHub(scope);
  expect(result.assignments).toEqual({ status: 'error', items: [] });
  expect(result.materials).toEqual({ status: 'ready', items: [] });
});
test.each(['school', 'group', 'member', 'type'])(
  'rejects invalid %s boundary before reading coursework',
  async (kind) => {
    if (kind === 'school') records['schools/pu/members/alice'].status = 'suspended';
    if (kind === 'group') records['groups/course-a'].schoolId = 'other';
    if (kind === 'member') records['groups/course-a/members/alice'].status = 'left';
    if (kind === 'type') records['groups/course-a'].type = 'club';
    await expect(loadCourseHub(scope)).rejects.toThrow();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  },
);
test('revocation during reads cannot expose the loaded content', async () => {
  jest.mocked(getDocsFromServer).mockImplementation(async () => {
    records['groups/course-a/members/alice'].status = 'left';
    return collectionResult([{ title: '私人教材' }]);
  });
  await expect(loadCourseHub(scope)).rejects.toThrow('無法存取');
});
test('a server permission error cannot fall back to names provided by a caller', async () => {
  jest.mocked(getDocFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadCourseHub(scope)).rejects.toThrow('permission-denied');
});
test('account switches, obsolete requests and mock runtime do not return course data', async () => {
  await expect(loadCourseHub(scope, () => false)).rejects.toThrow();
  jest
    .mocked(getAuthInstance)
    .mockReturnValue({ currentUser: { uid: 'bob' } } as ReturnType<typeof getAuthInstance>);
  await expect(loadCourseHub(scope)).rejects.toThrow();
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await expect(loadCourseHub(scope)).rejects.toThrow();
  expect(getDocFromServer).not.toHaveBeenCalled();
});
test('TronClass IDs only reach the detail API and preserve source metadata', async () => {
  jest.mocked(tcFetchCourseDetail).mockResolvedValue({
    id: 321,
    name: '真實校方課程',
    course_code: 'ETH1',
    credit: null,
    instructors: [{ name: '授課教師' }],
  } as Awaited<ReturnType<typeof tcFetchCourseDetail>>);
  const result = await loadCourseHub({ ...scope, target: { source: 'tronclass', courseId: 321 } });
  expect(tcFetchCourseDetail).toHaveBeenCalledWith(321);
  expect(result.name).toBe('真實校方課程');
  expect(result.details).toEqual(['ETH1', '授課教師']);
  expect(getDocsFromServer).not.toHaveBeenCalled();
  expect(getDocFromServer).not.toHaveBeenCalledWith(expect.stringContaining('groups/'));
});
test.each([null, { id: 123, name: '另一門課' }])(
  'null or mismatching TronClass details fail visibly',
  async (result) => {
    jest
      .mocked(tcFetchCourseDetail)
      .mockResolvedValue(result as Awaited<ReturnType<typeof tcFetchCourseDetail>>);
    await expect(
      loadCourseHub({ ...scope, target: { source: 'tronclass', courseId: 321 } }),
    ).rejects.toThrow('無法確認');
  },
);
test('disabled TronClass never reports an empty course', async () => {
  jest.mocked(isTronClassDataFetchEnabled).mockReturnValue(false);
  await expect(
    loadCourseHub({ ...scope, target: { source: 'tronclass', courseId: 321 } }),
  ).rejects.toThrow();
  expect(tcFetchCourseDetail).not.toHaveBeenCalled();
});
test('attachment URLs exclude executable schemes and embedded credentials', () => {
  expect(courseResourceUrl('https://teacher:password@school.test/a')).toBeNull();
  expect(courseResourceUrl('file:///secret')).toBeNull();
});

test('only explicitly published text assignments appear; quizzes, withdrawn and foreign data do not', async () => {
  const assignment = {
    title: '正式作業',
    type: 'assignment',
    published: true,
    status: 'published',
  };
  const rows = [
    assignment,
    { ...assignment, title: '已關閉作業', status: 'closed' },
    { ...assignment, type: 'quiz' },
    { ...assignment, type: 'exam' },
    { ...assignment, published: undefined },
    { ...assignment, status: 'draft' },
    { ...assignment, status: 'retracted' },
    { ...assignment, source: 'demo' },
    { ...assignment, isDemo: true },
    { ...assignment, schoolId: 'other' },
    { ...assignment, groupId: 'other' },
  ];
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(collectionResult(rows));
  const result = await loadCourseHub(scope);
  expect(result.assignments.items.map((item) => [item.title, item.closed])).toEqual([
    ['正式作業', false],
    ['已關閉作業', true],
  ]);
});
test('unpublished, withdrawn, sample and wrong-school modules never surface as released materials', async () => {
  const module = { title: '已發布單元', published: true, resourceUrl: 'https://school.test/read' };
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(collectionResult([]))
    .mockResolvedValueOnce(
      collectionResult([
        module,
        { ...module, published: undefined },
        { ...module, status: 'draft' },
        { ...module, status: 'retracted' },
        { ...module, source: 'demo' },
        { ...module, isDemo: true },
        { ...module, schoolId: 'other' },
        { ...module, groupId: 'other' },
      ]),
    );
  const result = await loadCourseHub(scope);
  expect(result.materials.items).toHaveLength(1);
});
