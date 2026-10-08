import { beforeEach, expect, it, vi } from 'vitest';
import { fetchRecentCampusPosts, listActiveStoriesForSchool, listSubscribedBoardIds, peersAtPoi } from './firestore';

const mocks = vi.hoisted(() => ({ getDocs: vi.fn(), query: vi.fn((...parts: unknown[]) => parts), where: vi.fn((...parts: unknown[]) => parts) }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getDocs: mocks.getDocs,
  query: mocks.query,
  where: mocks.where,
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.getDocs.mockReset(); });

it.each([
  ['subscriptions', () => listSubscribedBoardIds('student', 'pu')],
  ['presence', () => peersAtPoi('pu', 'library')],
  ['stories', () => listActiveStoriesForSchool('pu')],
])('propagates unavailable %s reads instead of inventing an empty result', async (_name, read) => {
  const failure = new Error('permission denied');
  mocks.getDocs.mockRejectedValue(failure);
  await expect(read()).rejects.toBe(failure);
});

it('retains the selected board when retrying a query without its sort index', async () => {
  mocks.getDocs.mockRejectedValueOnce(new Error('missing index')).mockResolvedValue({ docs: [] });
  await expect(fetchRecentCampusPosts('pu', 'science')).resolves.toEqual([]);
  expect(mocks.query.mock.calls[1]).toContainEqual(['boardId', '==', 'science']);
});
