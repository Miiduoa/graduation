import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteDoc,
  getDocFromServer,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { getCampusPostById } from './firestore';
import {
  BOOKMARK_UNAVAILABLE_COPY,
  isCampusPostBookmarked,
  listCampusPostBookmarkIds,
  loadCampusPostBookmarks,
  removeCampusPostBookmark,
  saveCampusPostBookmark,
} from './bookmarks';

vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  doc: vi.fn((ref: { path: string }, id: string) => ({ path: `${ref.path}/${id}` })),
  orderBy: vi.fn((value: string) => value),
  limit: vi.fn((value: number) => value),
  query: vi.fn((ref: unknown) => ref),
  getDocFromServer: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
}));
vi.mock('./firestore', () => ({ getCampusPostById: vi.fn() }));

const listing = (...rows: { id: string; schoolId: string; postId: string }[]) => ({
  docs: rows.map((row) => ({
    id: row.id,
    data: () => ({ schoolId: row.schoolId, postId: row.postId }),
  })),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getDocs).mockResolvedValue(listing() as never);
  vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => false } as never);
  vi.mocked(setDoc).mockResolvedValue(undefined);
  vi.mocked(deleteDoc).mockResolvedValue(undefined);
});

describe('school-scoped bookmarked campus posts', () => {
  it('exports a stable unavailable copy for permission-denied UI', () => {
    expect(BOOKMARK_UNAVAILABLE_COPY).toBe('收藏功能暫時無法使用');
  });

  it('ignores malformed or cross-campus list entries', async () => {
    vi.mocked(getDocs).mockResolvedValue(listing(
      { id: 'one', schoolId: 'pu', postId: 'one' },
      { id: 'other', schoolId: 'ncku', postId: 'other' },
      { id: 'mismatch', schoolId: 'pu', postId: 'different' },
    ) as never);
    expect(await listCampusPostBookmarkIds('alice', 'pu')).toEqual(['one']);
  });

  it('does not overwrite a saved post already written by another device', async () => {
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => true } as never);
    await saveCampusPostBookmark('alice', 'pu', 'post');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('treats a concurrent save from a second device as successful when the record now exists', async () => {
    vi.mocked(getDocFromServer)
      .mockResolvedValueOnce({ exists: () => false } as never)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ schoolId: 'pu', postId: 'post' }),
      } as never);
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('create race'));
    await expect(saveCampusPostBookmark('alice', 'pu', 'post')).resolves.toBeUndefined();
    expect(getDocFromServer).toHaveBeenCalledTimes(2);
  });

  it('does not hide a genuine denied bookmark write after rechecking', async () => {
    vi.mocked(getDocFromServer).mockResolvedValue({ exists: () => false } as never);
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(saveCampusPostBookmark('alice', 'pu', 'post')).rejects.toThrow('permission-denied');
  });

  it('writes only the scoped ID and its server timestamp', async () => {
    await saveCampusPostBookmark('alice', 'pu', 'post');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'users/alice/campusPostBookmarks/pu/posts/post' },
      { schoolId: 'pu', postId: 'post', createdAt: 'SERVER_TIME' },
    );
    await removeCampusPostBookmark('alice', 'pu', 'post');
    expect(deleteDoc).toHaveBeenCalledWith({
      path: 'users/alice/campusPostBookmarks/pu/posts/post',
    });
  });

  it('recovers saved older posts without exposing a post from another school', async () => {
    vi.mocked(getDocs).mockResolvedValue(listing(
      { id: 'older', schoolId: 'pu', postId: 'older' },
      { id: 'orphan', schoolId: 'pu', postId: 'orphan' },
      { id: 'foreign', schoolId: 'pu', postId: 'foreign' },
    ) as never);
    vi.mocked(getCampusPostById).mockImplementation(async (_school, id) => {
      if (id === 'older') return { id, schoolId: 'pu', title: '舊貼文' } as never;
      if (id === 'foreign') return { id, schoolId: 'ncku', title: '跨校資料' } as never;
      return null;
    });
    const data = await loadCampusPostBookmarks('alice', 'pu');
    expect(data.ids).toEqual(['older', 'orphan', 'foreign']);
    expect(data.posts.map((post) => post.id)).toEqual(['older']);
  });

  it('requires confirmation before a detail page claims the post was saved', async () => {
    vi.mocked(getDocFromServer).mockResolvedValue({
      exists: () => true,
      data: () => ({ schoolId: 'pu', postId: 'post' }),
    } as never);
    expect(await isCampusPostBookmarked('alice', 'pu', 'post')).toBe(true);
    vi.mocked(getDocFromServer).mockResolvedValue({
      exists: () => true,
      data: () => ({ schoolId: 'other', postId: 'post' }),
    } as never);
    expect(await isCampusPostBookmarked('alice', 'pu', 'post')).toBe(false);
  });
});

for (const code of ['permission-denied', 'unavailable']) {
  it(`reports ${code} while resolving saved posts instead of returning a false empty list`, async () => {
    vi.mocked(getDocs).mockResolvedValue(listing(
      { id: 'older', schoolId: 'pu', postId: 'older' },
    ) as never);
    vi.mocked(getCampusPostById).mockRejectedValue(Object.assign(new Error(code), { code }));
    await expect(loadCampusPostBookmarks('alice', 'pu')).rejects.toThrow(code);
  });
}

it('does not report a cached bookmark as confirmed when the server read fails', async () => {
  vi.mocked(getDocFromServer).mockRejectedValue(new Error('unavailable'));
  await expect(saveCampusPostBookmark('alice', 'pu', 'post')).rejects.toThrow('unavailable');
  expect(setDoc).not.toHaveBeenCalled();
});

it('prioritizes revoked access over an earlier network failure in a saved-post batch', async () => {
  vi.mocked(getDocs).mockResolvedValue(listing(
    { id: 'offline', schoolId: 'pu', postId: 'offline' },
    { id: 'revoked', schoolId: 'pu', postId: 'revoked' },
  ) as never);
  const denied = Object.assign(new Error('revoked'), { code: 'permission-denied' });
  vi.mocked(getCampusPostById)
    .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
    .mockRejectedValueOnce(denied);
  await expect(loadCampusPostBookmarks('alice', 'pu')).rejects.toBe(denied);
});
