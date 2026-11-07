import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {},
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ getDb: () => mocks.db }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    query: (collection: unknown, ...constraints: unknown[]) => ({ collection, constraints }),
    orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
    where: (field: string, operator: string, value: unknown) => ({ where: [field, operator, value] }),
    limit: (value: number) => ({ limit: value }),
    getDocs: mocks.getDocs,
    getDocsFromServer: mocks.getDocsFromServer,
  };
});

import { fetchRecentCampusPosts } from './firestore';

const snapshot = (id: string, extra: Record<string, unknown> = {}) => ({
  docs: [{ id, data: () => ({ schoolId: 'pu', boardId: 'public', title: '校園貼文', ...extra }) }],
  metadata: { fromCache: false, hasPendingWrites: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  // Deliberately successful stale fallback: an error must not become a partial page.
  mocks.getDocs.mockResolvedValue(snapshot('stale-cache'));
  mocks.getDocsFromServer.mockResolvedValue(snapshot('server-post'));
});

describe('campus feed server-read contract', () => {
  it.each([30, 60, 120, 180, 240])('preserves the requested ordered window of %i posts', async (size) => {
    await expect(fetchRecentCampusPosts('pu', undefined, size)).resolves.toMatchObject([
      { id: 'server-post', schoolId: 'pu' },
    ]);
    expect(mocks.getDocsFromServer).toHaveBeenCalledExactlyOnceWith({
      collection: { path: 'schools/pu/campusPosts' },
      constraints: [{ orderBy: ['createdAt', 'desc'] }, { limit: size }],
    });
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('retains the board constraint and default limit', async () => {
    await fetchRecentCampusPosts('pu', 'project');
    expect(mocks.getDocsFromServer).toHaveBeenCalledExactlyOnceWith({
      collection: { path: 'schools/pu/campusPosts' },
      constraints: [
        { where: ['boardId', '==', 'project'] },
        { orderBy: ['createdAt', 'desc'] },
        { limit: 30 },
      ],
    });
  });

  it.each(['permission-denied', 'unauthenticated', 'unavailable', 'failed-precondition'])
    ('propagates %s without an unordered or cached fallback', async (code) => {
      const cause = Object.assign(new Error(code), { code });
      mocks.getDocsFromServer.mockRejectedValueOnce(cause);
      await expect(fetchRecentCampusPosts('pu', undefined, 120)).rejects.toBe(cause);
      expect(mocks.getDocsFromServer).toHaveBeenCalledTimes(1);
      expect(mocks.getDocs).not.toHaveBeenCalled();
    });

  it('uses the authoritative document ID rather than a stored id field', async () => {
    mocks.getDocsFromServer.mockResolvedValueOnce(snapshot('actual-id', { id: 'forged-id' }));
    await expect(fetchRecentCampusPosts('pu')).resolves.toMatchObject([{ id: 'actual-id' }]);
  });

  it('returns a genuinely empty server result as an empty page', async () => {
    mocks.getDocsFromServer.mockResolvedValueOnce({ docs: [] });
    await expect(fetchRecentCampusPosts('pu')).resolves.toEqual([]);
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});
