import { beforeEach, expect, it, vi } from 'vitest';
import {
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
} from 'firebase/firestore';
import {
  loadTeacherSubmissions,
  publishSubmissionGrade,
  publishTeacherAssignment,
} from './teacherAssignments';

const auth = vi.hoisted(() => ({ uid: 'teacher' }));
vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => ({ currentUser: { uid: auth.uid } }),
}));
vi.mock('./teacherCourse', () => ({
  authorizeTeacherCourse: vi.fn(async () => ({ id: 'course' })),
  TeacherCourseError: class TeacherCourseError extends Error {},
}));
vi.mock('firebase/firestore', () => ({
  collection: (root: unknown, ...parts: string[]) =>
    (typeof root === 'string' ? root + '/' : '') + parts.join('/'),
  doc: (root: unknown, ...parts: string[]) =>
    (typeof root === 'string' ? root + '/' : '') + (parts.length ? parts.join('/') : 'generated'),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'server-time',
}));

const scope = { uid: 'teacher', schoolId: 'pu', courseId: 'course' };
const document = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});
const records: Record<string, Record<string, unknown> | null> = {};
const transaction = {
  get: vi.fn(async (path: string) => document(records[path] ?? null)),
  set: vi.fn(),
  update: vi.fn(),
};
const draft = {
  title: '  練習一  ',
  description: '  樹狀結構  ',
  points: 100,
  dueAt: '',
  allowLateSubmission: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.uid = 'teacher';
  for (const key of Object.keys(records)) delete records[key];
  Object.assign(records, {
    'schools/pu/members/teacher': { status: 'active' },
    'groups/course/members/teacher': { status: 'active', role: 'instructor' },
    'groups/course': { type: 'course', schoolId: 'pu' },
    'groups/course/assignments/work': null,
    'groups/course/assignments/work/submissions/student': {
      userId: 'student',
      content: '已繳交',
      submittedAt: '2026-10-08T01:00:00Z',
    },
  });
  transaction.get.mockImplementation(async (path: string) => document(records[path] ?? null));
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) =>
    callback(transaction as never));
  vi.mocked(getDocFromServer).mockImplementation(async (path) =>
    document(records[String(path)] ?? null) as never);
  vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
});

it('publishes a real assignment only after verifying both memberships and the course', async () => {
  records['groups/course/assignments/work'] = {
    title: '練習一', description: '樹狀結構',
    createdBy: 'teacher', points: 100, dueAt: null, allowLateSubmission: false,
  };
  await publishTeacherAssignment(scope, 'work', draft);
  expect(transaction.get.mock.calls.slice(0, 3).map(([path]) => path)).toEqual([
    'schools/pu/members/teacher',
    'groups/course/members/teacher',
    'groups/course',
  ]);
  expect(transaction.set).not.toHaveBeenCalled(); // Safe replay acknowledges the same published assignment without rewriting it.
});

it('persists the published payload and limits drafts to textual assignment types', async () => {
  vi.mocked(getDocFromServer).mockResolvedValueOnce(document({ createdBy: 'teacher' }) as never);
  await publishTeacherAssignment(scope, 'work', draft);
  expect(transaction.set).toHaveBeenCalledWith(
    'groups/course/assignments/work',
    expect.objectContaining({
      title: '練習一',
      description: '樹狀結構',
      type: 'assignment',
      points: 100,
      dueAt: null,
      published: true,
      status: 'published',
      createdBy: 'teacher',
      createdAt: 'server-time',
    }),
  );
});

it.each([
  ['no school membership', 'schools/pu/members/teacher', null],
  ['revoked course membership', 'groups/course/members/teacher', { status: 'removed', role: 'instructor' }],
  ['student role', 'groups/course/members/teacher', { status: 'active', role: 'member' }],
  ['wrong school', 'groups/course', { type: 'course', schoolId: 'wrong' }],
])('blocks assignment writes on %s', async (_label, path, value) => {
  records[path as string] = value as Record<string, unknown> | null;
  await expect(publishTeacherAssignment(scope, 'work', draft)).rejects.toThrow();
  expect(transaction.set).not.toHaveBeenCalled();
});

it('rejects invalid fields without starting any write', async () => {
  await expect(publishTeacherAssignment(scope, 'work', { ...draft, points: 0 })).rejects.toThrow();
  await expect(publishTeacherAssignment(scope, 'work', { ...draft, dueAt: '2001-01-01T00:00' })).rejects.toThrow();
  await expect(publishTeacherAssignment(scope, 'work', { ...draft, title: ' ' })).rejects.toThrow();
  expect(runTransaction).not.toHaveBeenCalled();
});

it('blocks retry with changed content rather than overwriting an existing assignment', async () => {
  records['groups/course/assignments/work'] = {
    title: '不同作業', createdBy: 'teacher', points: 100,
  };
  await expect(publishTeacherAssignment(scope, 'work', draft)).rejects.toThrow('可能已建立');
  expect(transaction.set).not.toHaveBeenCalled();
});

it('publishes a zero score without modifying the student answer', async () => {
  records['groups/course/assignments/work'] = { title: '練習一', type: 'assignment', points: 100 };
  vi.mocked(getDocFromServer).mockResolvedValueOnce(document({
    gradePublished: true, gradeScore: 0, gradePublishedBy: 'teacher',
  }) as never);
  await publishSubmissionGrade(scope, 'work', 'student', 0, '  需要補充內容  ');
  expect(transaction.update).toHaveBeenCalledWith(
    'groups/course/assignments/work/submissions/student',
    {
      gradeScore: 0,
      gradeFeedback: '需要補充內容',
      gradePublished: true,
      gradePublishedBy: 'teacher',
      gradePublishedAt: 'server-time',
    },
  );
});

it('refuses scores over the maximum, missing submissions and already published grades', async () => {
  records['groups/course/assignments/work'] = { type: 'assignment', points: 60 };
  await expect(publishSubmissionGrade(scope, 'work', 'student', 61, '')).rejects.toThrow('配分');
  records['groups/course/assignments/work/submissions/student'] = null;
  await expect(publishSubmissionGrade(scope, 'work', 'student', 15, '')).rejects.toThrow('尚未繳交');
  records['groups/course/assignments/work/submissions/student'] = {
    userId: 'student', submittedAt: '2026-10-08', gradePublished: true,
    gradePublishedBy: 'other', gradeScore: 15, gradeFeedback: '',
  };
  await expect(publishSubmissionGrade(scope, 'work', 'student', 15, '')).rejects.toThrow('已發布');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('discards results when account changes during a transaction', async () => {
  transaction.get.mockImplementation(async (path: string) => {
    if (path === 'groups/course') auth.uid = 'someone-else';
    return document(records[path] ?? null);
  });
  await expect(publishTeacherAssignment(scope, 'work', draft)).rejects.toThrow('登入身分');
  expect(transaction.set).not.toHaveBeenCalled();
});

it('loads only confirmed submissions and does not show unpublished grades', async () => {
  records['groups/course/assignments/work'] = { title: '練習一', points: 100 };
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({
    docs: [
      { id: 'student', data: () => ({
        userId: 'student', content: '答案', submittedAt: '2026-10-08',
        gradeScore: 95, gradePublished: false,
      }) },
      { id: 'other', data: () => ({ userId: 'someone-else', submittedAt: '2026-10-08' }) },
    ],
  } as never);
  const result = await loadTeacherSubmissions(scope, 'work');
  expect(result.submissions).toHaveLength(1);
  expect(result.submissions[0].score).toBeNull();
  expect(result.submissions[0].content).toBe('答案');
});
