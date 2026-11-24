import { getDocs, getDocsFromServer } from 'firebase/firestore';
import { isSubscribedToBoard } from '../../services/boards';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  collection: jest.fn((...args: unknown[]) => args),
  deleteDoc: jest.fn(),
  doc: jest.fn(),
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

test('reads subscription status from the server so a cache miss cannot look unsubscribed', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValue({ empty: false } as never);
  await expect(isSubscribedToBoard('alice', 'pu', 'board')).resolves.toBe(true);
  expect(getDocsFromServer).toHaveBeenCalled();
  expect(getDocs).not.toHaveBeenCalled();
});

test('propagates a server-read failure so the caller can keep the rollback', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValue(
    Object.assign(new Error('offline'), { code: 'unavailable' }),
  );
  await expect(isSubscribedToBoard('alice', 'pu', 'board')).rejects.toThrow('offline');
  expect(getDocs).not.toHaveBeenCalled();
});
