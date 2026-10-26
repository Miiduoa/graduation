import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDoc, getDocFromServer, getDocs, setDoc } from 'firebase/firestore';
import { followId, followUser, listFollowingIds, unfollowUser } from './follows';

vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  where: vi.fn((field: string, op: string, value: string) => ({ field, op, value })),
  limit: vi.fn((value: number) => value),
  query: vi.fn((collection: unknown, ...args: unknown[]) => ({ collection, args })),
  getDocFromServer: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => false } as never);
  vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
  vi.mocked(setDoc).mockResolvedValue(undefined);
  vi.mocked(deleteDoc).mockResolvedValue(undefined);
});

describe('school-scoped following relationships', () => {
  it('lists only well-formed relationships owned by this account', async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        { id: followId('pu', 'alice', 'bob'), data: () => ({ schoolId: 'pu', followerUid: 'alice', targetUid: 'bob' }) },
        { id: followId('other', 'alice', 'charlie'), data: () => ({ schoolId: 'other', followerUid: 'alice', targetUid: 'charlie' }) },
        { id: followId('pu', 'mallory', 'dave'), data: () => ({ schoolId: 'pu', followerUid: 'mallory', targetUid: 'dave' }) },
        { id: 'random', data: () => ({ schoolId: 'pu', followerUid: 'alice', targetUid: 'eve' }) },
      ],
    } as never);
    expect(await listFollowingIds('pu', 'alice')).toEqual(['bob']);
  });
  it('does not create duplicates on an already followed author', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('update denied'));
    vi.mocked(getDocFromServer).mockResolvedValue({
      exists: () => true, data: () => ({ schoolId: 'pu', followerUid: 'alice', targetUid: 'bob' }),
    } as never);
    await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(getDocFromServer).toHaveBeenCalledTimes(1);
  });
  it('confirms a concurrent follow instead of reporting failure', async () => {
    vi.mocked(getDocFromServer)
      .mockResolvedValueOnce({
        exists: () => true, data: () => ({ schoolId: 'pu', followerUid: 'alice', targetUid: 'bob' }),
      } as never);
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('create race'));
    await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
  });
  it('does not treat a rejected follow as successful', async () => {
    vi.mocked(setDoc).mockRejectedValue(new Error('permission-denied'));
    await expect(followUser('pu', 'alice', 'bob')).rejects.toThrow('permission-denied');
  });
  it('creates a first follow without trying to read a protected missing relation', async () => {
    vi.mocked(getDocFromServer).mockRejectedValue(new Error('permission-denied'));
    await expect(followUser('pu', 'alice', 'bob')).resolves.toBeUndefined();
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(getDocFromServer).not.toHaveBeenCalled();
  });
  it('does not acknowledge a follow when the server cannot confirm it', async () => {
    vi.mocked(setDoc).mockRejectedValue(new Error('permission-denied'));
    vi.mocked(getDocFromServer).mockRejectedValue(new Error('unavailable'));
    await expect(followUser('pu', 'alice', 'bob')).rejects.toThrow('permission-denied');
  });
  it('sends only required keys and supports unfollowing', async () => {
    await followUser('pu', 'alice', 'bob');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'follows/fol_pu_alice_bob' },
      { schoolId: 'pu', followerUid: 'alice', targetUid: 'bob', createdAt: 'SERVER_TIME' },
    );
    await unfollowUser('pu', 'alice', 'bob');
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'follows/fol_pu_alice_bob' });
  });
  it('cannot follow yourself', async () => {
    await expect(followUser('pu', 'alice', 'alice')).rejects.toThrow('INVALID_FOLLOW_TARGET');
    expect(setDoc).not.toHaveBeenCalled();
  });
});
