import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  fetchRecentCampusPosts,
  listActiveStoriesForSchool,
  listSubscribedBoardIds,
  peersAtPoi,
} from './firestore';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  query: vi.fn((...parts: unknown[]) => parts),
  where: vi.fn((...parts: unknown[]) => parts),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getDocs: mocks.getDocs,
  query: mocks.query,
  where: mocks.where,
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocs.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

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

it('lists stories with a school and unexpired bound that rules can prove', async () => {
  const now = 1_700_000_000_000;
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.getDocs.mockResolvedValue({
    docs: [
      { id: 'live', data: () => ({ schoolId: 'pu', expiresAt: now + 3_600_000 }) },
      { id: 'expired', data: () => ({ schoolId: 'pu', expiresAt: now - 1 }) },
      { id: 'missing', data: () => ({ schoolId: 'pu' }) },
    ],
  });
  await expect(listActiveStoriesForSchool('pu', 40)).resolves.toEqual([
    { id: 'live', schoolId: 'pu', expiresAt: now + 3_600_000 },
  ]);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query).toHaveBeenCalledWith(
    'campusStories',
    ['schoolId', '==', 'pu'],
    ['expiresAt', '>', now + 120_000],
    { orderBy: 'expiresAt', direction: 'desc' },
    { limit: 40 },
  );
});

it('retries without the expiry sort while still constraining expiresAt', async () => {
  const now = 1_700_000_000_000;
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.getDocs.mockRejectedValueOnce(new Error('missing index')).mockResolvedValue({ docs: [] });
  await expect(listActiveStoriesForSchool('pu')).resolves.toEqual([]);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.calls[1]).toEqual([
    'campusStories',
    ['schoolId', '==', 'pu'],
    ['expiresAt', '>', now + 120_000],
    { limit: 80 },
  ]);
});
