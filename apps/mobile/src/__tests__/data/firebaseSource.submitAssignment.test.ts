import { prepareAssignmentReminderSubmission } from '../../services/campusAssignmentReminders';
import { reconcileSubmittedAssignmentReceipt } from '../../services/submittedAssignmentReminders';
import { getDoc, getDocFromServer, getDocs, runTransaction } from 'firebase/firestore';
import { getAuthInstance } from '../../firebase';
import { firebaseSource } from '../../data/firebaseSource';

jest.mock('../../services/submittedAssignmentReminders', () => ({
  reconcileSubmittedAssignmentReceipt: jest.fn(async () => undefined),
}));
jest.mock('../../services/campusAssignmentReminders', () => ({
  prepareAssignmentReminderSubmission: jest.fn(async (): Promise<string | undefined> => undefined),
}));
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
  getDocFromServer: jest.fn(),
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
  jest.mocked(getDocFromServer).mockResolvedValue({
    exists: () => true,
    id: 'alice',
    data: () => ({
      userId: 'alice',
      groupId: 'course',
      assignmentId: 'work',
      content: 'Answer',
      status: 'submitted',
      submittedAt: '2026-10-26T09:00:00Z',
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
  expect(jest.mocked(prepareAssignmentReminderSubmission).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(runTransaction).mock.invocationCallOrder[0]);
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
  { dueAt: 'invalid', allowLateSubmission: true },
  { dueAt: '' },
  { dueAt: {} },
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
    content: 'Answer',
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


test('only returns a verified server receipt and never relies on the offline document cache', async () => {
  const receipt = await firebaseSource.submitAssignment({
    assignmentId: 'work', userId: 'alice', groupId: 'course', content: 'Answer',
  });
  expect(receipt.submittedAt).toBe('2026-10-26T09:00:00Z');
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'groups/course/assignments/work/submissions/alice' });
  expect(getDoc).not.toHaveBeenCalled();
});

test.each([
  null,
  { submittedAt: 'invalid' },
  { groupId: 'other-course' },
  { assignmentId: 'other-work' },
  { userId: 'bob' },
  { content: 'different answer' },
])('rejects a missing or inconsistent post-write receipt %j', async (patch) => {
  jest.mocked(getDocFromServer).mockResolvedValue({
    ...document(patch === null ? null : {
      userId: 'alice', groupId: 'course', assignmentId: 'work', content: 'Answer',
      status: 'submitted', submittedAt: '2026-10-26T09:00:00Z', ...patch,
    }), id: 'alice',
  } as never);
  await expect(firebaseSource.submitAssignment({
    assignmentId: 'work', userId: 'alice', groupId: 'course', content: 'Answer',
  })).rejects.toThrow('尚未確認');
  expect(transaction.set).toHaveBeenCalledTimes(1);
});

test('canonical missing records never fall back to unrelated legacy collections', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(document(null) as never);
  expect(await firebaseSource.getSubmission('work', 'alice', 'course')).toBeNull();
  expect(await firebaseSource.getAssignment('work', 'course')).toBeNull();
  expect(getDocs).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled();
});

test('read failure is not treated as a missing canonical submission', async () => {
  jest.mocked(getDocFromServer).mockRejectedValue(new Error('unavailable'));
  await expect(firebaseSource.getSubmission('work', 'alice', 'course')).rejects.toThrow('unavailable');
  expect(getDocs).not.toHaveBeenCalled();
});

test('a switched account cannot receive the previous post-write receipt', async () => {
  jest.mocked(getDocFromServer).mockImplementation(async () => {
    jest.mocked(getAuthInstance).mockReturnValue({ currentUser: { uid: 'bob' } } as never);
    return { ...document({ userId: 'alice', groupId: 'course', assignmentId: 'work',
      content: 'Answer', status: 'submitted', submittedAt: '2026-10-26T09:00:00Z' }), id: 'alice' } as never;
  });
  await expect(firebaseSource.submitAssignment({
    assignmentId: 'work', userId: 'alice', groupId: 'course', content: 'Answer',
  })).rejects.toThrow('登入身分已變更');
});


test('只有伺服器收據核對完成才核對本機提醒，離線或送出中不取消', async () => {
  let finish!: (value: unknown) => void;
  const receipt = { id: 'alice', exists: () => true, metadata: { fromCache: false, hasPendingWrites: false },
    data: () => ({ userId: 'alice', groupId: 'course', assignmentId: 'work', content: 'Answer',
      status: 'submitted', submittedAt: '2026-10-26T09:00:00Z' }) };
  jest.mocked(getDocFromServer).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
  const sending = firebaseSource.submitAssignment({ userId: 'alice', groupId: 'course', assignmentId: 'work', content: 'Answer' });
  while (!finish) await Promise.resolve();
  expect(reconcileSubmittedAssignmentReceipt).not.toHaveBeenCalled();
  finish(receipt);
  await sending;
  expect(reconcileSubmittedAssignmentReceipt).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'alice', groupId: 'course', assignmentId: 'work', status: 'submitted',
  }));
});

test.each([{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }])(
  '快取或尚未同步的寫入不當作伺服器確認：%j', async (metadata) => {
    jest.mocked(getDocFromServer).mockResolvedValueOnce({
      id: 'alice', exists: () => true, metadata,
      data: () => ({ userId: 'alice', groupId: 'course', assignmentId: 'work', content: 'Answer',
        status: 'submitted', submittedAt: '2026-10-26T09:00:00Z' }),
    } as never);
    await expect(firebaseSource.submitAssignment({ userId: 'alice', groupId: 'course', assignmentId: 'work', content: 'Answer' })).rejects.toThrow();
    expect(reconcileSubmittedAssignmentReceipt).not.toHaveBeenCalled();
  },
);

test.each(['通知清單失敗', '儲存讀取失敗', '儲存寫入失敗', '摘要服務失敗'])(
  '提醒維護故障不阻止繳交並回傳稍後重試警告：%s', async (message) => {
    jest.mocked(prepareAssignmentReminderSubmission).mockRejectedValueOnce(new Error(message));
    const receipt = await firebaseSource.submitAssignment({ assignmentId: 'work', userId: 'alice', groupId: 'course', content: 'Answer' });
    expect(transaction.set).toHaveBeenCalled();
    expect(receipt.status).toBe('submitted');
    expect(receipt.reminderWarning).toContain('重試');
    expect(reconcileSubmittedAssignmentReceipt).toHaveBeenCalled();
  },
);

test('無關未知提醒只回傳警告，仍可取得本作業收據', async () => {
  jest.mocked(prepareAssignmentReminderSubmission).mockResolvedValueOnce('未知舊提醒仍可能響鈴');
  const receipt = await firebaseSource.submitAssignment({ assignmentId: 'work', userId: 'alice', groupId: 'course', content: 'Answer' });
  expect(receipt.reminderWarning).toContain('仍可能響鈴');
  expect(transaction.set).toHaveBeenCalled();
});
