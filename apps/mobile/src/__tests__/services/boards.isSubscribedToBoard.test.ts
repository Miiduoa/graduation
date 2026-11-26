import { deleteDoc, getDocs, getDocsFromServer, setDoc } from 'firebase/firestore';
import { isSubscribedToBoard, subscribeToBoard, unsubscribeFromBoard } from '../../services/boards';

beforeEach(() => {
  jest.mocked(getDocs).mockReset();
  jest.mocked(getDocsFromServer).mockReset();
});

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn((...args: unknown[]) => args),
  deleteDoc: jest.fn(),
  doc: jest.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  getDocsFromServer: jest.fn(),
  limit: jest.fn((value: unknown) => value),
  query: jest.fn((...args: unknown[]) => args),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  where: jest.fn((...args: unknown[]) => args),
}));

function serverSnapshot(empty: boolean, hasPendingWrites = false) {
  return { empty, metadata: { fromCache: false, hasPendingWrites } } as Awaited<
    ReturnType<typeof getDocsFromServer>
  >;
}

test('ordinary reads may use the cache so an offline board detail can still open', async () => {
  jest.mocked(getDocs).mockResolvedValue({ empty: true } as never);
  await expect(isSubscribedToBoard('alice', 'pu', 'board')).resolves.toBe(false);
  expect(getDocs).toHaveBeenCalled();
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

test('failed-write reconciliation reads from the server so a cache miss cannot look unsubscribed', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValue(serverSnapshot(false));
  await expect(isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true })).resolves.toBe(true);
  expect(getDocsFromServer).toHaveBeenCalled();
  expect(getDocs).not.toHaveBeenCalled();
});

test('a server query cannot confirm a local subscription that is still pending and then fails', async () => {
  let rejectWrite!: (error: Error) => void;
  jest.mocked(setDoc).mockReturnValueOnce(new Promise<void>((_resolve, reject) => {
    rejectWrite = reject;
  }));
  const write = subscribeToBoard('alice', 'pu', 'board');
  const writeFailure = expect(write).rejects.toThrow('write failed');
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(serverSnapshot(false, true));

  await expect(isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true })).rejects.toThrow();

  rejectWrite(new Error('write failed'));
  await writeFailure;
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(serverSnapshot(true));
  await expect(isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true })).resolves.toBe(false);
});

test('an empty server query cannot confirm a pending local deletion for the same board', async () => {
  let resolveWrite!: () => void;
  jest.mocked(deleteDoc).mockReturnValueOnce(new Promise<void>((resolve) => {
    resolveWrite = resolve;
  }));
  const write = unsubscribeFromBoard('alice', 'pu', 'board');
  jest.mocked(getDocsFromServer).mockResolvedValue(serverSnapshot(true));

  await expect(isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true })).rejects.toThrow();
  await expect(isSubscribedToBoard('alice', 'pu', 'other', { fromServer: true })).resolves.toBe(false);

  resolveWrite();
  await write;
  await expect(isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true })).resolves.toBe(false);
});

test('an empty snapshot overlapping a deletion cannot confirm it after the write fails', async () => {
  let resolveQuery!: (snapshot: ReturnType<typeof serverSnapshot>) => void;
  jest.mocked(getDocsFromServer).mockReturnValueOnce(new Promise((resolve) => {
    resolveQuery = resolve;
  }));
  const confirmation = isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true });
  jest.mocked(deleteDoc).mockRejectedValueOnce(new Error('write failed'));
  await expect(unsubscribeFromBoard('alice', 'pu', 'board')).rejects.toThrow('write failed');

  resolveQuery(serverSnapshot(true));
  await expect(confirmation).rejects.toThrow();
});

test('propagates a server-read failure so the caller can keep the rollback', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValue(
    Object.assign(new Error('offline'), { code: 'unavailable' }),
  );
  await expect(isSubscribedToBoard('alice', 'pu', 'board', { fromServer: true })).rejects.toThrow('offline');
  expect(getDocs).not.toHaveBeenCalled();
});
