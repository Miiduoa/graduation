import { beforeEach, expect, it, vi } from 'vitest';
import { fetchRecentCampusPosts, listActiveStoriesForSchool, listSubscribedBoardIds, markStoryViewed, peersAtPoi } from './firestore';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn(), serverRead: vi.fn(), getDocs: vi.fn(), query: vi.fn((...parts: unknown[]) => parts), where: vi.fn((...parts: unknown[]) => parts) }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getDocs: mocks.getDocs,
  getDocsFromServer: mocks.serverRead,
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
  serverTimestamp: () => 'server-time',
  query: mocks.query,
  where: mocks.where,
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }),
}));
beforeEach(() => { vi.clearAllMocks(); mocks.getDocs.mockReset(); mocks.serverRead.mockReset(); });

it.each([
  ['subscriptions', () => listSubscribedBoardIds('student', 'pu')],
  ['presence', () => peersAtPoi('pu', 'library')],
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


it('records each reader once in the story, school and author scope', async () => {
  const story = { id: 'story', schoolId: 'pu', authorUid: 'author' };
  const path = 'campusStories/story/schools/pu/authors/author/views/reader';
  mocks.getDoc.mockResolvedValueOnce({ exists: () => false }).mockResolvedValueOnce({ exists: () => true });
  await markStoryViewed(story, 'author');
  await markStoryViewed(story, 'reader');
  await markStoryViewed(story, 'reader');
  expect(mocks.getDoc.mock.calls).toEqual([[path], [path]]);
  expect(mocks.setDoc).toHaveBeenCalledExactlyOnceWith(path, { viewerUid: 'reader', viewedAt: 'server-time' });
});

it.each(['permission-denied', 'unavailable', 'unauthenticated', 'failed-precondition'])(
  'does not use cached stories or an unordered fallback after %s', async (code) => {
    const failure = Object.assign(new Error('cannot verify school access'), { code });
    mocks.serverRead.mockRejectedValueOnce(failure);
    await expect(listActiveStoriesForSchool('pu')).rejects.toBe(failure);
    expect(mocks.serverRead).toHaveBeenCalledTimes(1);
    expect(mocks.getDocs).not.toHaveBeenCalled();
  },
);

it.each([false, true])('reads only active server stories, including a missing index (%s)', async (missingIndex) => {
  if (missingIndex) mocks.serverRead.mockRejectedValueOnce(
    Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' }),
  );
  const live = { id: 'live', data: () => ({ schoolId: 'pu', expiresAt: Date.now() + 10_000 }) };
  mocks.serverRead.mockResolvedValueOnce({ docs: [live, { id: 'expired', data: () => ({ expiresAt: 1 }) }] });
  const result = await listActiveStoriesForSchool('pu', 12);
  expect(result.map((s) => s.id)).toEqual(['live']);
  expect(mocks.query.mock.calls).toHaveLength(missingIndex ? 2 : 1);
  for (const parts of mocks.query.mock.calls) expect(parts).toContainEqual(['schoolId', '==', 'pu']);
  expect(mocks.query.mock.calls[0]).toContainEqual({ orderBy: 'createdAt', direction: 'desc' });
  if (missingIndex) expect(mocks.query.mock.calls[1]).toEqual(['campusStories', ['schoolId', '==', 'pu'], { limit: 12 }]);
  expect(mocks.getDocs).not.toHaveBeenCalled();
});
