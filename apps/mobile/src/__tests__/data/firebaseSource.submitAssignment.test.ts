import { getDoc, runTransaction } from 'firebase/firestore';
import { getAuthInstance } from '../../firebase';
import { firebaseSource } from '../../data/firebaseSource';

jest.mock('../../firebase', () => ({
  getDb: () => 'db',
  getAuthInstance: jest.fn(),
  getFunctionsInstance: jest.fn(),
}));
jest.mock('../../data/firestorePath', () => ({
  docFromSegments: (_db: unknown, segments: string[]) => ({ path: segments.join('/') }),
  collectionFromSegments: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((...args: unknown[]) => ({ path: args.slice(1).join('/') })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: () => 'server-timestamp',
  Timestamp: class Timestamp {},
  writeBatch: jest.fn(),
  runTransaction: jest.fn(),
  increment: jest.fn(),
  arrayUnion: jest.fn(),
  arrayRemove: jest.fn(),
}));
jest.mock('../../data/lostFoundSource', () => ({ lostFoundSource: {} }));
jest.mock('../../data/orderSource', () => ({ createOrderThroughServer: jest.fn() }));

const transaction = { get: jest.fn(), set: jest.fn() };
const document = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: 'alice' } } as never);
  jest.mocked(runTransaction).mockImplementation(async (_db, body) => body(transaction as never));
  transaction.get.mockResolvedValueOnce(document({ title: 'Work' })).mockResolvedValueOnce(document(null));
  jest.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    id: 'alice',
    data: () => ({
      userId: 'alice',
      groupId: 'course',
      assignmentId: 'work',
      content: 'Answer',
      status: 'submitted',
    }),
  } as never);
});

test('writes canonical text and server timestamps only after reading both documents', async () => {
  await firebaseSource.submitAssignment({
    assignmentId: 'work',
    userId: 'alice',
    groupId: 'course',
    content: '  Answer  ',
  });
  expect(transaction.get.mock.calls.map(([ref]) => ref.path)).toEqual([
    'groups/course/assignments/work',
    'groups/course/assignments/work/submissions/alice',
  ]);
  expect(transaction.set).toHaveBeenCalledWith(
    { path: 'groups/course/assignments/work/submissions/alice' },
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

test.each([
  { published: false },
  { status: 'closed' },
  { status: 'draft' },
  { type: 'quiz' },
  { dueAt: '2000-01-01T00:00:00Z' },
])('rejects unavailable work %j without writing', async (assignment) => {
  transaction.get.mockReset().mockResolvedValue(document(assignment));
  await expect(
    firebaseSource.submitAssignment({
      assignmentId: 'work',
      userId: 'alice',
      groupId: 'course',
      content: 'Answer',
    }),
  ).rejects.toThrow();
  expect(transaction.set).not.toHaveBeenCalled();
});

test('does not overwrite a confirmed answer', async () => {
  transaction.get
    .mockReset()
    .mockResolvedValueOnce(document({}))
    .mockResolvedValueOnce(document({ submittedAt: '2026-10-07' }));
  await expect(
    firebaseSource.submitAssignment({
      assignmentId: 'work',
      userId: 'alice',
      groupId: 'course',
      content: 'Replacement',
    }),
  ).rejects.toThrow('繳交紀錄');
  expect(transaction.set).not.toHaveBeenCalled();
});

test('rejects empty and oversized content before starting a transaction', async () => {
  await expect(
    firebaseSource.submitAssignment({
      assignmentId: 'work',
      userId: 'alice',
      groupId: 'course',
      content: '   ',
    }),
  ).rejects.toThrow();
  await expect(
    firebaseSource.submitAssignment({
      assignmentId: 'work',
      userId: 'alice',
      groupId: 'course',
      content: 'x'.repeat(20001),
    }),
  ).rejects.toThrow();
  expect(runTransaction).not.toHaveBeenCalled();
});

test('accepts an overdue submission only when the teacher allowed late work', async () => {
  transaction.get
    .mockReset()
    .mockResolvedValueOnce(document({ dueAt: '2000-01-01T00:00:00Z', allowLateSubmission: true }))
    .mockResolvedValueOnce(document(null));
  await firebaseSource.submitAssignment({
    assignmentId: 'work',
    userId: 'alice',
    groupId: 'course',
    content: 'Late answer',
  });
  expect(transaction.set).toHaveBeenCalled();
});

test('refuses to submit for a different signed-in account', async () => {
  jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: 'bob' } } as never);
  await expect(
    firebaseSource.submitAssignment({
      assignmentId: 'work',
      userId: 'alice',
      groupId: 'course',
      content: 'Answer',
    }),
  ).rejects.toThrow('登入身分已變更');
  expect(runTransaction).not.toHaveBeenCalled();
});
