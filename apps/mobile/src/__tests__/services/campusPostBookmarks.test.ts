import { deleteDoc, getDocFromServer, getDocs, setDoc } from 'firebase/firestore';
import { getCampusPostById } from '../../services/feed';
import {
  isCampusPostBookmarked,
  listCampusPostBookmarkIds,
  loadCampusPostBookmarks,
  removeCampusPostBookmark,
  saveCampusPostBookmark,
} from '../../services/campusPostBookmarks';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('../../services/feed', () => ({ getCampusPostById: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  doc: jest.fn((ref: { path: string }, id: string) => ({ path: `${ref.path}/${id}` })),
  orderBy: jest.fn((field: string, direction: string) => ({ field, direction })),
  limit: jest.fn((value: number) => value),
  query: jest.fn((ref: unknown) => ref),
  getDocFromServer: jest.fn(),
  getDocs: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'SERVER_TIME'),
}));

const listing = (...rows: { id: string; schoolId: string; postId: string }[]) => ({
  docs: rows.map(({ id, schoolId, postId }) => ({ id, data: () => ({ schoolId, postId }) })),
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCampusPostById).mockReset().mockResolvedValue(null);
  jest.mocked(getDocs).mockReset().mockResolvedValue(listing() as never);
  jest.mocked(getDocFromServer).mockReset().mockResolvedValue({ exists: () => false } as never);
  jest.mocked(setDoc).mockReset().mockResolvedValue(undefined);
  jest.mocked(deleteDoc).mockReset().mockResolvedValue(undefined);
});

test('lists only correctly scoped bookmark IDs', async () => {
  jest.mocked(getDocs).mockResolvedValue(listing(
    { id: 'one', schoolId: 'pu', postId: 'one' },
    { id: 'other', schoolId: 'ncku', postId: 'other' },
    { id: 'wrong-id', schoolId: 'pu', postId: 'another' },
  ) as never);
  await expect(listCampusPostBookmarkIds('alice', 'pu')).resolves.toEqual(['one']);
  expect(getDocs).toHaveBeenCalledWith({ path: 'users/alice/campusPostBookmarks/pu/posts' });
});

test('omits confirmed missing and foreign-school posts without discarding the saved ID order', async () => {
  jest.mocked(getDocs).mockResolvedValue(listing(
    { id: 'older', schoolId: 'pu', postId: 'older' },
    { id: 'missing', schoolId: 'pu', postId: 'missing' },
    { id: 'foreign', schoolId: 'pu', postId: 'foreign' },
  ) as never);
  const older = { id: 'older', schoolId: 'pu', title: '舊筆記' };
  jest.mocked(getCampusPostById).mockImplementation(async (_schoolId, postId) => {
    if (postId === 'older') return older as never;
    if (postId === 'foreign') return { id: 'foreign', schoolId: 'ncku' } as never;
    return null;
  });
  await expect(loadCampusPostBookmarks('alice', 'pu')).resolves.toEqual({
    ids: ['older', 'missing', 'foreign'], posts: [older],
  });
});

test.each(['permission-denied', 'unavailable'])(
  'preserves %s from a saved post lookup instead of claiming an empty or complete list',
  async (code) => {
    const cause = Object.assign(new Error(code), { code });
    jest.mocked(getDocs).mockResolvedValue(listing(
      { id: 'visible', schoolId: 'pu', postId: 'visible' },
      { id: 'failed', schoolId: 'pu', postId: 'failed' },
    ) as never);
    jest.mocked(getCampusPostById).mockImplementation(async (_schoolId, postId) => {
      if (postId === 'failed') throw cause;
      return { id: 'visible', schoolId: 'pu' } as never;
    });
    await expect(loadCampusPostBookmarks('alice', 'pu')).rejects.toBe(cause);
  },
);

test('preserves a denied bookmark-list read', async () => {
  const denied = new Error('permission-denied');
  jest.mocked(getDocs).mockRejectedValueOnce(denied);
  await expect(loadCampusPostBookmarks('alice', 'pu')).rejects.toBe(denied);
  expect(getCampusPostById).not.toHaveBeenCalled();
});

test.each(['permission-denied', 'firestore/unauthenticated'])(
  'prioritizes %s over an earlier unavailable result so callers clear retained private content',
  async (code) => {
    const denied = Object.assign(new Error(code), { code });
    jest.mocked(getDocs).mockResolvedValue(listing(
      { id: 'offline', schoolId: 'pu', postId: 'offline' },
      { id: 'revoked', schoolId: 'pu', postId: 'revoked' },
    ) as never);
    jest.mocked(getCampusPostById).mockImplementation(async (_schoolId, postId) => {
      if (postId === 'revoked') throw denied;
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    });
    await expect(loadCampusPostBookmarks('alice', 'pu')).rejects.toBe(denied);
  },
);

test('saves only the IDs and server timestamp and removes only the requested bookmark', async () => {
  await saveCampusPostBookmark('alice', 'pu', 'post');
  expect(setDoc).toHaveBeenCalledWith(
    { path: 'users/alice/campusPostBookmarks/pu/posts/post' },
    { schoolId: 'pu', postId: 'post', createdAt: 'SERVER_TIME' },
  );
  await removeCampusPostBookmark('alice', 'pu', 'post');
  expect(deleteDoc).toHaveBeenCalledWith({ path: 'users/alice/campusPostBookmarks/pu/posts/post' });
});

test('does not overwrite an existing bookmark confirmed by the server', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue({
    exists: () => true, data: () => ({ schoolId: 'pu', postId: 'post' }),
  } as never);
  await saveCampusPostBookmark('alice', 'pu', 'post');
  expect(getDocFromServer).toHaveBeenCalledWith({ path: 'users/alice/campusPostBookmarks/pu/posts/post' });
  expect(setDoc).not.toHaveBeenCalled();
});

test('confirms an exact concurrent save after an update is rejected', async () => {
  jest.mocked(setDoc).mockRejectedValueOnce(new Error('update denied'));
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockResolvedValueOnce({
      exists: () => true, data: () => ({ schoolId: 'pu', postId: 'post' }),
    } as never);
  await expect(saveCampusPostBookmark('alice', 'pu', 'post')).resolves.toBeUndefined();
  expect(getDocFromServer).toHaveBeenCalledTimes(2);
});

test.each([
  { exists: () => false },
  { exists: () => true, data: () => ({ schoolId: 'other', postId: 'post' }) },
  { exists: () => true, data: () => ({ schoolId: 'pu', postId: 'other' }) },
])('does not claim a rejected save succeeded without matching server confirmation (%#)', async (result) => {
  const denied = new Error('permission-denied');
  jest.mocked(setDoc).mockRejectedValueOnce(denied);
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockResolvedValueOnce(result as never);
  await expect(saveCampusPostBookmark('alice', 'pu', 'post')).rejects.toBe(denied);
});

test('cannot claim saved state when the authoritative read is unavailable', async () => {
  jest.mocked(getDocFromServer).mockRejectedValue(new Error('unavailable'));
  await expect(saveCampusPostBookmark('alice', 'pu', 'post')).rejects.toThrow('unavailable');
  await expect(isCampusPostBookmarked('alice', 'pu', 'post')).rejects.toThrow('unavailable');
  expect(setDoc).not.toHaveBeenCalled();
});

test('does not hide a rejected save when its server recheck also fails', async () => {
  const denied = new Error('permission-denied');
  jest.mocked(setDoc).mockRejectedValueOnce(denied);
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockRejectedValueOnce(new Error('unavailable'));
  await expect(saveCampusPostBookmark('alice', 'pu', 'post')).rejects.toBe(denied);
});

test('detail status requires matching school and post IDs from the server', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue({
    exists: () => true, data: () => ({ schoolId: 'pu', postId: 'post' }),
  } as never);
  await expect(isCampusPostBookmarked('alice', 'pu', 'post')).resolves.toBe(true);
  jest.mocked(getDocFromServer).mockResolvedValue({
    exists: () => true, data: () => ({ schoolId: 'other', postId: 'post' }),
  } as never);
  await expect(isCampusPostBookmarked('alice', 'pu', 'post')).resolves.toBe(false);
});
