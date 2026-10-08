import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { loadCourseQuizNotices } from '../../features/courseQuizzes';

jest.mock('../../firebase', () => ({ getDb: () => 'db', isFirebaseMockMode: () => false }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_: unknown, ...parts: string[]) => parts.join('/'),
  query: (path: string) => path,
  limit: jest.fn(),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
}));
const document = (data: Record<string, unknown>) =>
  ({ exists: () => true, data: () => data }) as never;
const rows = (values: Array<Record<string, unknown>>) =>
  ({
    size: values.length,
    docs: values.map(({ id, ...data }, index) => ({
      id: id ?? `notice-${index}`,
      data: () => data,
    })),
  }) as never;
const access = jest.mocked(getDocFromServer);
const content = jest.mocked(getDocsFromServer);
const notice = {
  id: 'exam-one',
  title: '授課教師的測驗通知',
  type: 'exam',
  schoolId: 'pu',
  status: 'scheduled',
};
beforeEach(() => {
  jest.resetAllMocks();
  access.mockImplementation(async (path) =>
    document(
      String(path) === 'groups/course'
        ? { type: 'course', schoolId: 'pu', name: '正式課程' }
        : { status: 'active' },
    ),
  );
  content.mockResolvedValue(rows([]));
});

test('reads course announcements from the server, not personal scores or generated questions', async () => {
  content
    .mockResolvedValueOnce(
      rows([
        {
          ...notice,
          description: '請攜帶計算機',
          dueAt: { toMillis: () => 1791403200000 },
          points: 100,
          score: 88,
          questions: [{ correctAnswer: 'A' }],
        },
      ]),
    )
    .mockResolvedValueOnce(rows([{ ...notice, published: true }]));
  const result = await loadCourseQuizNotices('alice', 'pu', 'course');
  expect(result).toEqual({
    groupId: 'course',
    groupName: '正式課程',
    hasMore: false,
    notices: [
      {
        id: 'exam-one',
        title: notice.title,
        description: '請攜帶計算機',
        dueAt: new Date(1791403200000).toISOString(),
        type: 'exam',
      },
    ],
  });
  expect(content.mock.calls.map(([path]) => path)).toEqual([
    'groups/course/quizzes',
    'groups/course/assignments',
  ]);
  expect(access).toHaveBeenCalledTimes(6);
});

test.each(['../course', '', 'course/another', 'bad course'])(
  'does not query malformed course identifiers: %s',
  async (id) => {
    await expect(loadCourseQuizNotices('alice', 'pu', id)).rejects.toThrow();
    expect(content).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  },
);

test.each([
  ['groups/course', { type: 'course', schoolId: 'other' }],
  ['groups/course', { type: 'club', schoolId: 'pu' }],
  ['groups/course', { type: 'course', schoolId: 'pu', isDemo: true }],
  ['groups/course/members/alice', { status: 'revoked' }],
  ['schools/pu/members/alice', { status: 'revoked' }],
] as const)(
  'does not load content without current same-school course access: %s %j',
  async (deniedPath, data) => {
    access.mockImplementation(async (path) =>
      document(
        String(path) === deniedPath
          ? data
          : String(path) === 'groups/course'
            ? { type: 'course', schoolId: 'pu' }
            : { status: 'active' },
      ),
    );
    await expect(loadCourseQuizNotices('alice', 'pu', 'course')).rejects.toThrow(/成員資格/);
    expect(content).not.toHaveBeenCalled();
  },
);

test('rejects a membership revoked while the announcements were loading', async () => {
  let membershipReads = 0;
  access.mockImplementation(async (path) => {
    if (String(path) === 'groups/course/members/alice')
      return document({ status: ++membershipReads === 1 ? 'active' : 'revoked' });
    return document(
      String(path) === 'groups/course' ? { type: 'course', schoolId: 'pu' } : { status: 'active' },
    );
  });
  content.mockResolvedValueOnce(rows([notice]));
  await expect(loadCourseQuizNotices('alice', 'pu', 'course')).rejects.toThrow(/成員資格/);
});

test('omits unpublished, foreign-school, demo and unsupported records', async () => {
  content.mockResolvedValueOnce(
    rows([
      { ...notice, id: 'draft', status: 'draft' },
      { ...notice, id: 'unpublished', published: false },
      { ...notice, id: 'foreign', schoolId: 'other' },
      { ...notice, id: 'demo-one' },
      { ...notice, id: 'flagged', isDemo: true },
      { ...notice, id: 'assignment', type: 'assignment' },
      { ...notice, id: 'untitled', title: ' ' },
      { ...notice, id: 'ready', published: true, dueAt: 'not a date' },
    ]),
  );
  const result = await loadCourseQuizNotices('alice', 'pu', 'course');
  expect(result.notices).toEqual([
    { id: 'ready', title: notice.title, description: '', dueAt: null, type: 'exam' },
  ]);
});

test('keeps server failures distinct from confirmed empty results', async () => {
  content.mockRejectedValueOnce(new Error('offline'));
  await expect(loadCourseQuizNotices('alice', 'pu', 'course')).rejects.toThrow('offline');
  expect((await loadCourseQuizNotices('alice', 'pu', 'course')).notices).toEqual([]);
});

test('does not treat a bounded result as the entire course history', async () => {
  content.mockResolvedValueOnce(
    rows(Array.from({ length: 201 }, (_, index) => ({ ...notice, id: `exam-${index}` }))),
  );
  const result = await loadCourseQuizNotices('alice', 'pu', 'course');
  expect(result.hasMore).toBe(true);
  expect(result.notices).toHaveLength(200);
});
