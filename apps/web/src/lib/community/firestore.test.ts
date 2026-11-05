import { beforeEach, expect, it, vi } from 'vitest';
import { fetchRecentCampusPosts, listActiveStoriesForSchool, listSubscribedBoardIds, markStoryViewed, peersAtPoi } from './firestore';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn((...parts: unknown[]) => parts), where: vi.fn((...parts: unknown[]) => parts) }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getDocs: mocks.getDocs,
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
