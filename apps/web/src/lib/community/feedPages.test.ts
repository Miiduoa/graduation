import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ server: vi.fn(), cache: vi.fn(), db: {} }));
vi.mock('@/lib/firebase', () => ({ getDb: () => mocks.db }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, path: string) => ({ path }),
  documentId: () => '__name__',
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  startAfter: (document: unknown) => ({ startAfter: document }),
  limit: (count: number) => ({ limit: count }),
  getDocsFromServer: mocks.server,
  getDocs: mocks.cache,
}));

import { CAMPUS_FEED_PAGE_SIZE, fetchCampusPostPage } from './feedPages';

function document(id: string, schoolId = 'pu', fields: Record<string, unknown> = {}) {
  return {
    id,
    ref: { parent: { path: `schools/${schoolId}/campusPosts` } },
    data: () => ({ schoolId, title: id, ...fields }),
  };
}
function snapshot(count: number) {
  return {
    docs: Array.from({ length: count }, (_, index) => document(`post-${index}`)),
    metadata: { fromCache: false, hasPendingWrites: false },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.server.mockResolvedValue(snapshot(60));
});

describe('fixed-size campus feed pages', () => {
  it('orders ties by document ID and requests at most 60 records', async () => {
    const page = await fetchCampusPostPage('pu');
    expect(page.posts).toHaveLength(CAMPUS_FEED_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor?.document.id).toBe('post-59');
    expect(mocks.server).toHaveBeenCalledExactlyOnceWith({
      source: { path: 'schools/pu/campusPosts' },
      constraints: [
        { orderBy: ['createdAt', 'desc'] },
        { orderBy: ['__name__', 'desc'] },
        { limit: 60 },
      ],
    });
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it('starts after the saved server snapshot without expanding the read limit', async () => {
    const first = await fetchCampusPostPage('pu');
    await fetchCampusPostPage('pu', first.nextCursor);
    expect(mocks.server).toHaveBeenLastCalledWith({
      source: { path: 'schools/pu/campusPosts' },
      constraints: [
        { orderBy: ['createdAt', 'desc'] },
        { orderBy: ['__name__', 'desc'] },
        { startAfter: first.nextCursor!.document },
        { limit: 60 },
      ],
    });
  });

  it.each([0, 1, 59])('marks a %i-record page as exhausted', async (size) => {
    mocks.server.mockResolvedValueOnce(snapshot(size));
    const page = await fetchCampusPostPage('pu');
    expect(page.hasMore).toBe(false);
    expect(page.posts).toHaveLength(size);
    expect(page.nextCursor === null).toBe(size === 0);
  });

  it('rejects a different school cursor before issuing a query', async () => {
    const first = await fetchCampusPostPage('pu');
    mocks.server.mockClear();
    await expect(fetchCampusPostPage('other', first.nextCursor)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it('rejects a cursor whose claimed school differs from its collection', async () => {
    const first = await fetchCampusPostPage('pu');
    mocks.server.mockClear();
    await expect(fetchCampusPostPage('other', { ...first.nextCursor!, schoolId: 'other' }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it.each(['', 'pu/campusPosts'])('rejects invalid scope %s before a read', async (scope) => {
    await expect(fetchCampusPostPage(scope)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mocks.server).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'permission-denied', 'unauthenticated', 'failed-precondition'])
    ('propagates %s instead of returning a cache or partial fallback', async (code) => {
      const error = Object.assign(new Error(code), { code });
      mocks.server.mockRejectedValueOnce(error);
      await expect(fetchCampusPostPage('pu')).rejects.toBe(error);
      expect(mocks.server).toHaveBeenCalledTimes(1);
      expect(mocks.cache).not.toHaveBeenCalled();
    });

  it.each(['fromCache', 'hasPendingWrites'] as const)('does not advance a cursor from %s data', async (flag) => {
    const result = snapshot(60);
    result.metadata[flag] = true;
    mocks.server.mockResolvedValueOnce(result);
    await expect(fetchCampusPostPage('pu')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps the raw cursor when malformed school rows are hidden and uses the real document ID', async () => {
    const result = snapshot(60);
    result.docs[0] = document('real-id', 'pu', { id: 'stored-id' });
    result.docs[59] = document('boundary', 'pu', { schoolId: 'other' });
    mocks.server.mockResolvedValueOnce(result);
    const page = await fetchCampusPostPage('pu');
    expect(page.posts).toHaveLength(59);
    expect(page.posts[0].id).toBe('real-id');
    expect(page.posts.every((post) => post.schoolId === 'pu')).toBe(true);
    expect(page.nextCursor?.document.id).toBe('boundary');
    expect(page.hasMore).toBe(true);
  });
});
