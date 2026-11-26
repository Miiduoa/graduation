/** @jest-environment node */
import { getDoc, getDocs } from 'firebase/firestore';
import { listInboxTasks } from '../data/courseSpaceSource';
import { loadStudentHome } from '../data/studentHome';
import { listCourseMemberships } from '../services/courseWorkspace';

jest.mock('../firebase', () => ({ getDb: () => ({}), isFirebaseMockMode: () => false }));
jest.mock('../services/courseWorkspace', () => ({
  listCourseMemberships: jest.fn(),
  toDate: (value: unknown) => (value ? new Date(String(value)) : null),
}));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (ref: unknown) => ref,
  where: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
}));
const fresh = { fromCache: false, hasPendingWrites: false, isEqual: jest.fn() };
const row = (id: string, value: Record<string, unknown>) => ({ id, data: () => value });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listCourseMemberships).mockImplementation(async (_db, _uid, _school, onSnapshot) => {
    onSnapshot?.(fresh);
    return [{ id: 'course', groupId: 'course', name: 'Course', role: 'member' }];
  });
});
test('submitted and unpublished assignments do not remain in the student inbox', async () => {
  jest
    .mocked(getDocs)
    .mockImplementation(
      async (path) =>
        ({
          empty: true,
          docs: String(path).endsWith('/assignments')
            ? [
                row('submitted', {
                  title: 'Done',
                  dueAt: new Date(Date.now() + 60000).toISOString(),
                }),
                row('draft', { published: false }),
                row('pending', {
                  title: 'Pending',
                  dueAt: new Date(Date.now() + 60000).toISOString(),
                }),
              ]
            : [],
        }) as never,
    );
  jest
    .mocked(getDoc)
    .mockImplementation(
      async (path) =>
        ({
          exists: () => String(path).includes('/submitted/'),
          data: () => ({ submittedAt: new Date() }),
        }) as never,
    );
  const tasks = await listInboxTasks('alice');
  expect(tasks.map((task) => task.title)).toEqual(['Pending']);
  expect(getDoc).toHaveBeenCalledWith('groups/course/assignments/pending/submissions/alice');
});
test('a permission failure is surfaced instead of reporting no pending work', async () => {
  jest.mocked(getDocs).mockRejectedValue(new Error('permission-denied'));
  await expect(listInboxTasks('alice')).rejects.toThrow('permission-denied');
});

test('includes recently overdue work only when the teacher explicitly permits late submission', async () => {
  const hour = 60 * 60 * 1000;
  jest.mocked(getDocs).mockImplementation(
    async (path) => ({
      empty: true,
      docs: String(path).endsWith('/assignments')
        ? [
            row('late-open', {
              title: 'Late submission still available',
              dueAt: new Date(Date.now() - hour).toISOString(),
              allowLateSubmission: true,
              status: 'published',
            }),
            row('late-locked', {
              title: 'Locked after deadline',
              dueAt: new Date(Date.now() - hour).toISOString(),
              allowLateSubmission: false,
              status: 'published',
            }),
            row('late-closed', {
              title: 'Closed by instructor',
              dueAt: new Date(Date.now() - hour).toISOString(),
              allowLateSubmission: true,
              status: 'closed',
            }),
            row('too-old', {
              title: 'Old overdue',
              dueAt: new Date(Date.now() - 9 * 24 * hour).toISOString(),
              allowLateSubmission: true,
              status: 'published',
            }),
          ]
        : [],
    }) as never,
  );
  jest.mocked(getDoc).mockResolvedValue({
    exists: () => false,
    data: () => ({}),
  } as never);
  const tasks = await listInboxTasks('alice');
  expect(tasks.map((task) => task.title)).toEqual(['Late submission still available']);
  expect(tasks[0]?.subtitle).toContain('教師允許補交');
});

test('learning mode shows all enrolled published work while the mixed inbox keeps its 14-item limit', async () => {
  const day = 86400000;
  const near = Array.from({ length: 18 }, (_, index) =>
    row('near-' + index, {
      title: 'Homework ' + index,
      type: 'assignment',
      dueAt: new Date(Date.now() + 2 * day).toISOString(),
    }),
  );
  jest.mocked(getDocs).mockImplementation(async (path) => ({
    empty: true,
    docs: String(path).endsWith('/assignments')
      ? [
          ...near,
          row('future', { title: 'Final presentation', dueAt: new Date(Date.now() + 45 * day).toISOString() }),
          row('undated', { title: 'Reading journal' }),
          row('invalid', { title: 'Invalid date', dueAt: 'invalid' }),
          row('late-allowed', {
            title: 'Late after seven days',
            dueAt: new Date(Date.now() - 10 * day).toISOString(),
            allowLateSubmission: true,
          }),
          row('closed', { title: 'Closed assessment', dueAt: new Date(Date.now() + day).toISOString(), status: 'closed' }),
        ]
      : [],
  }) as never);
  jest.mocked(getDoc).mockResolvedValue({ exists: () => false, data: () => ({}) } as never);

  const compact = await listInboxTasks('alice');
  const complete = await listInboxTasks('alice', undefined, 'learning');

  expect(compact).toHaveLength(14);
  expect(complete).toHaveLength(22);
  expect(complete.some((item) => item.title === 'Final presentation')).toBe(true);
  expect(complete.find((item) => item.title === 'Reading journal')?.dueAt).toBeNull();
  expect(complete.find((item) => item.title === 'Invalid date')?.dueAt).toBeNull();
  expect(complete.find((item) => item.title === 'Late after seven days')?.lateSubmissionAllowed).toBe(true);
  expect(complete.some((item) => item.title === 'Closed assessment')).toBe(false);
  expect(complete.every((item) => item.kind !== 'assistant_queue')).toBe(true);
});

test.each([0, 14])('Today keeps an imminent quiz ahead of later assignments with %i open late tasks', async (lateCount) => {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const due = (hours: number) => new Date(now + hours * hour).toISOString();
  const later = Array.from({ length: 14 }, (_, i) => row(`later-${i}`, { dueAt: due(48 + i) }));
  const late = Array.from({ length: lateCount }, (_, i) =>
    row(`late-${i}`, { dueAt: due(-48 + i), allowLateSubmission: true }),
  );
  jest.mocked(getDocs).mockImplementation(async (path) => ({
    metadata: fresh, empty: true,
    docs: String(path).endsWith('/assignments') ? [
      ...later, ...late, row('quiz', { type: 'quiz', dueAt: due(1) }),
      row('submitted', { dueAt: due(0.2) }), row('locked', { dueAt: due(-1) }),
      row('closed', { dueAt: due(0.5), status: 'closed' }),
      row('too-old', { dueAt: due(-192), allowLateSubmission: true }),
      row('undated', {}), row('far', { dueAt: due(192) }),
    ] : [],
  }) as never);
  jest.mocked(getDoc).mockImplementation(async (path) => ({
    metadata: fresh, exists: () => String(path).includes('/submitted/'), data: () => ({ submittedAt: new Date(now) }),
  }) as never);

  const today = await listInboxTasks('alice', 'school-a', 'today');
  expect(today).toHaveLength(14);
  expect(today[0]).toMatchObject({ kind: 'quiz', assignmentId: 'quiz', groupId: 'course' });
  expect(today[1]?.assignmentId).toBe(lateCount ? 'late-0' : 'later-0');
  expect(today[13]?.assignmentId).toBe(lateCount ? 'late-12' : 'later-12');
  const home = await loadStudentHome('alice', 'school-a', 'today');
  expect(home.tasks).toEqual(today);
  expect(home.tasksComplete).toBe(false);
  const submissionPaths = jest.mocked(getDoc).mock.calls.map(([path]) => String(path));
  expect(submissionPaths.filter((path) => /\/(?:locked|closed|too-old|undated|far)\//.test(path))).toEqual([]);
  expect(listCourseMemberships).toHaveBeenCalledWith(expect.anything(), 'alice', 'school-a');
});

test('Today reads only student coursework, even when the same user manages another course', async () => {
  jest.mocked(listCourseMemberships).mockImplementation(async (_db, _uid, _school, onSnapshot) => {
    onSnapshot?.(fresh);
    return [
      { id: 'study', groupId: 'study', name: '修習課程', role: 'member', unreadCount: 3 },
      { id: 'teach', groupId: 'teach', name: '助教課程', role: 'moderator', unreadCount: 1 },
    ];
  });
  jest.mocked(getDocs).mockImplementation(async (path) => {
    expect(path).toBe('groups/study/assignments');
    return { metadata: fresh,
      docs: [row('task', { dueAt: new Date(Date.now() + 60000).toISOString() })] } as never;
  });
  jest.mocked(getDoc).mockResolvedValue({ metadata: fresh, exists: () => false } as never);

  const { tasks, tasksComplete } = await loadStudentHome('alice', 'school-a', 'today');
  expect(tasksComplete).toBe(true);
  expect(tasks.map((task) => task.id)).toEqual(['assignment-study-task']);
  expect(getDocs).toHaveBeenCalledTimes(1);
  expect(getDoc).toHaveBeenCalledTimes(1);
  expect(listCourseMemberships).toHaveBeenCalledTimes(1);
});

test('Today has no coursework reads before a school is selected or without a student membership', async () => {
  for (const schoolId of [undefined, '', '   ']) {
    await expect(loadStudentHome('alice', schoolId, 'today')).rejects.toThrow('請先選擇學校');
  }
  expect(listCourseMemberships).not.toHaveBeenCalled();
  const nonStudentRoles = ['owner', 'instructor', 'moderator', 'admin', undefined];
  jest.mocked(listCourseMemberships).mockResolvedValue(nonStudentRoles.map((role, index) => ({
    id: String(index), groupId: String(index), name: '課程', role,
  })));
  await expect(listInboxTasks('alice', 'school-a', 'today')).resolves.toEqual([]);
  expect(getDocs).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
});

describe('server-confirmed coverage for the Today reminder', () => {
  const cases = (['membership', 'assignment', 'submission'] as const).flatMap(source =>
    (['cached', 'pending', 'missing', 'fresh'] as const).map(state => [source, state] as const));
  test.each(cases)('%s is %s', async (affected, state) => {
    const metadata = (source: typeof affected) => {
      if (source === affected && state === 'missing') return undefined;
      return { fromCache: source === affected && state === 'cached', hasPendingWrites: source === affected && state === 'pending' };
    };
    // Read all three snapshots through the production membership and inbox readers.
    const workspace = jest.requireActual<typeof import('../services/courseWorkspace')>('../services/courseWorkspace');
    jest.mocked(listCourseMemberships).mockImplementation(workspace.listCourseMemberships);
    jest.mocked(getDocs).mockImplementation(async path => {
      if (String(path) === 'users/alice/groups') return { metadata: metadata('membership'),
        docs: [row('course', { name: '修習課程', schoolId: 'school-a', type: 'course', role: 'member', status: 'active' })] } as never;
      expect(path).toBe('groups/course/assignments');
      return { metadata: metadata('assignment'),
        docs: [row('task', { title: '素描', dueAt: new Date(Date.now() + 60000).toISOString() })] } as never;
    });
    jest.mocked(getDoc).mockResolvedValue({ metadata: metadata('submission'), exists: () => false } as never);
    const home = await loadStudentHome('alice', 'school-a', 'today');
    expect(home.tasks.map(task => task.title)).toEqual(['素描']);
    expect(home.tasksComplete).toBe(state === 'fresh');
    expect(getDocs).toHaveBeenCalledTimes(2);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc).toHaveBeenCalledWith('groups/course/assignments/task/submissions/alice');
  });
});
