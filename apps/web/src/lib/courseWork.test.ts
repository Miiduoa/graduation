import { beforeEach, expect, it, vi } from 'vitest';
import { loadCourseWork, submitCourseText } from './courseWork';
import { getDoc, getDocs, runTransaction } from 'firebase/firestore';

vi.mock('./firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: () => true }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'server-timestamp',
}));
const transaction = { get: vi.fn(), set: vi.fn() };
const document = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runTransaction).mockImplementation(async (_db, body) => body(transaction as never));
  transaction.get
    .mockResolvedValueOnce(document({ title: 'Work' }))
    .mockResolvedValueOnce(document(null));
});
it('writes canonical text and server timestamps only after reading both documents', async () => {
  await submitCourseText('course', 'work', 'alice', '  Answer  ');
  expect(transaction.get.mock.calls.map(([path]) => path)).toEqual([
    'groups/course/assignments/work',
    'groups/course/assignments/work/submissions/alice',
  ]);
  expect(transaction.set).toHaveBeenCalledWith(
    'groups/course/assignments/work/submissions/alice',
    {
      groupId: 'course',
      assignmentId: 'work',
      userId: 'alice',
      content: 'Answer',
      status: 'submitted',
      submittedAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    },
    { merge: true },
  );
});
it.each([
  { published: false },
  { status: 'closed' },
  { status: 'draft' },
  { type: 'quiz' },
  { dueAt: '2000-01-01T00:00:00Z' },
])('rejects unavailable work %j without writing', async (assignment) => {
  transaction.get.mockReset().mockResolvedValue(document(assignment));
  await expect(submitCourseText('course', 'work', 'alice', 'Answer')).rejects.toThrow();
  expect(transaction.set).not.toHaveBeenCalled();
});
it('does not overwrite a confirmed answer', async () => {
  transaction.get
    .mockReset()
    .mockResolvedValueOnce(document({}))
    .mockResolvedValueOnce(document({ submittedAt: '2026-10-07' }));
  await expect(submitCourseText('course', 'work', 'alice', 'Replacement')).rejects.toThrow(
    '繳交紀錄',
  );
  expect(transaction.set).not.toHaveBeenCalled();
});
it('rejects empty and oversized content before starting a transaction', async () => {
  await expect(submitCourseText('course', 'work', 'alice', '   ')).rejects.toThrow();
  await expect(submitCourseText('course', 'work', 'alice', 'x'.repeat(20001))).rejects.toThrow();
  expect(runTransaction).not.toHaveBeenCalled();
});
it('propagates persistence failures to the form', async () => {
  vi.mocked(runTransaction).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(submitCourseText('course', 'work', 'alice', 'Answer')).rejects.toThrow(
    'permission-denied',
  );
});

it('loads published modules, rejects unsafe links, and keeps the current student submission', async () => {
  vi.mocked(getDoc)
    .mockResolvedValueOnce(document({ name: 'Course' }) as never)
    .mockResolvedValueOnce(document({ role: 'member', status: 'active' }) as never)
    .mockResolvedValueOnce(
      document({ content: 'Saved answer', submittedAt: '2026-10-07T00:00:00Z', gradePublished: true, gradeScore: 0, gradeFeedback: '請修正', gradePublishedAt: '2026-10-08T02:00:00Z' }) as never,
    );
  const entry = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('work', { title: 'Work' }), entry('hidden', { published: false })],
    } as never)
    .mockResolvedValueOnce({
      docs: [
        entry('one', { title: 'Chapter one', resourceUrl: 'https://school.test/notes' }),
        entry('two', { title: 'Unsafe', resourceUrl: 'javascript:alert(1)' }),
        entry('draft', { published: false }),
      ],
    } as never);
  const result = await loadCourseWork('course', 'alice');
  expect(result.modules.map((module) => module.resourceUrl)).toEqual([
    'https://school.test/notes',
    null,
  ]);
  expect(result.assignments).toHaveLength(1);
  expect(result.assignments[0].submittedText).toBe('Saved answer');
  expect(result.assignments[0].grade).toMatchObject({ score: 0, feedback: '請修正' });
  expect(getDoc).toHaveBeenLastCalledWith('groups/course/assignments/work/submissions/alice');
});

it('rejects a revoked course membership before reading course collections', async () => {
  vi.mocked(getDoc)
    .mockResolvedValueOnce(document({ name: 'Course' }) as never)
    .mockResolvedValueOnce(document({ role: 'member', status: 'removed' }) as never);
  await expect(loadCourseWork('course', 'alice')).rejects.toThrow();
  expect(getDocs).not.toHaveBeenCalled();
});
