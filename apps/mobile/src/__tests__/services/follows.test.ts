import { deleteDoc, getDoc, getDocFromServer, getDocs, setDoc } from 'firebase/firestore';
import { followId, followUser, listFollowingIds, unfollowUser } from '../../services/follows';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  doc: jest.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  where: jest.fn((field: string, op: string, value: string) => ({ field, op, value })),
  limit: jest.fn((value: number) => value),
  query: jest.fn((collection: unknown, ...args: unknown[]) => ({ collection, args })),
  getDoc: jest.fn(),
  getDocFromServer: jest.fn(),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'SERVER_TIME'),
}));

const relation = { schoolId: 'pu', followerUid: 'alice', targetUid: 'bob' };
const savedRelation = { exists: () => true, data: () => relation };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getDoc).mockReset();
  jest.mocked(getDocs).mockReset();
  jest.mocked(setDoc).mockReset().mockResolvedValue(undefined);
  jest.mocked(deleteDoc).mockReset().mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockReset().mockResolvedValue({ exists: () => false } as never);
});

test('creates a first follow without reading a missing relation that rules cannot authorize', async () => {
  jest.mocked(getDoc).mockRejectedValue(new Error('permission-denied'));
  await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(setDoc).toHaveBeenCalledWith(
    { path: 'follows/fol_pu_alice_bob' },
    { ...relation, createdAt: 'SERVER_TIME' },
  );
  expect(getDoc).not.toHaveBeenCalled();
  expect(getDocFromServer).not.toHaveBeenCalled();
});

test('confirms an existing or concurrently created exact relation from the server', async () => {
  jest.mocked(setDoc).mockRejectedValueOnce(new Error('update-denied'));
  jest.mocked(getDocFromServer).mockResolvedValueOnce(savedRelation as never);
  await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(getDoc).not.toHaveBeenCalled();
});

test('a cached relation cannot turn a denied write and failed server confirmation into success', async () => {
  const denied = new Error('permission-denied');
  jest.mocked(setDoc).mockRejectedValueOnce(denied);
  jest.mocked(getDoc).mockResolvedValueOnce(savedRelation as never);
  jest.mocked(getDocFromServer).mockRejectedValueOnce(new Error('offline'));
  await expect(followUser('pu', 'alice', 'bob')).rejects.toBe(denied);
  expect(getDoc).not.toHaveBeenCalled();
});

test.each([
  { exists: () => false },
  { exists: () => true, data: () => ({ ...relation, schoolId: 'other' }) },
  { exists: () => true, data: () => ({ ...relation, followerUid: 'mallory' }) },
  { exists: () => true, data: () => ({ ...relation, targetUid: 'carol' }) },
])('rejects writes unless server confirmation matches all identity fields (%#)', async (snapshot) => {
  const denied = new Error('permission-denied');
  jest.mocked(setDoc).mockRejectedValueOnce(denied);
  jest.mocked(getDocFromServer).mockResolvedValueOnce(snapshot as never);
  await expect(followUser('pu', 'alice', 'bob')).rejects.toBe(denied);
});

test('filters malformed, cross-school and other-account following records', async () => {
  jest.mocked(getDocs).mockResolvedValue({ docs: [
    { id: followId('pu', 'alice', 'bob'), data: () => relation },
    { id: followId('other', 'alice', 'bob'), data: () => ({ ...relation, schoolId: 'other' }) },
    { id: followId('pu', 'mallory', 'bob'), data: () => ({ ...relation, followerUid: 'mallory' }) },
    { id: 'unexpected-id', data: () => relation },
  ] } as never);
  await expect(listFollowingIds('pu', 'alice', 200, { throwOnError: true })).resolves.toEqual(['bob']);
});

test('propagates list denial to callers that require an accurate result', async () => {
  const denied = new Error('permission-denied');
  jest.mocked(getDocs).mockRejectedValueOnce(denied);
  await expect(listFollowingIds('pu', 'alice', 200, { throwOnError: true })).rejects.toBe(denied);
});

test('does not write invalid targets', async () => {
  await expect(followUser('pu', 'alice', 'alice')).rejects.toThrow();
  await expect(followUser('', 'alice', 'bob')).rejects.toThrow('INVALID_FOLLOW_TARGET');
  await expect(unfollowUser('pu', '', 'bob')).rejects.toThrow('INVALID_FOLLOW_TARGET');
  expect(setDoc).not.toHaveBeenCalled();
  expect(deleteDoc).not.toHaveBeenCalled();
});
