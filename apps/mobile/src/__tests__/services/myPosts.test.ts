import { getDocs, query } from 'firebase/firestore';
import { loadOwnCampusPosts } from '../../services/myPosts';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, ...parts: string[]) => parts.join('/')),
  query: jest.fn((...parts: unknown[]) => parts),
  where: jest.fn((...parts: unknown[]) => ({ where: parts })),
  orderBy: jest.fn((...parts: unknown[]) => ({ orderBy: parts })),
  startAfter: jest.fn((cursor: unknown) => ({ after: cursor })),
  limit: jest.fn((count: number) => ({ limit: count })),
  getDocs: jest.fn(),
}));

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      schoolId: 'pu',
      authorUid: 'alice',
      anonymous: false,
      title: '一篇文章',
      content: '今天的內容',
      boardId: 'board',
      ...extra,
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

test('loads only owned signed posts from the current campus in the correct order', async () => {
  jest.mocked(getDocs).mockResolvedValue({
    docs: [
      item('mine'),
      item('anonymous', { anonymous: true }),
      item('other', { authorUid: 'bob' }),
      item('cross-school', { schoolId: 'nthu' }),
    ],
  } as never);
  const page = await loadOwnCampusPosts('pu', 'alice');
  expect(page.items.map((post) => post.id)).toEqual(['mine']);
  expect(page.hasMore).toBe(false);
  expect(query).toHaveBeenCalledWith(
    'schools/pu/campusPosts',
    { where: ['authorUid', '==', 'alice'] },
    { orderBy: ['createdAt', 'desc'] },
    { limit: 13 },
  );
});

test('advances the correct document cursor without repeating the last post', async () => {
  const docs = [item('one'), item('two'), item('three')];
  jest.mocked(getDocs).mockResolvedValueOnce({ docs } as never);
  const first = await loadOwnCampusPosts('pu', 'alice', null, 2);
  expect(first.items.map((post) => post.id)).toEqual(['one', 'two']);
  expect(first.hasMore).toBe(true);
  expect(first.cursor).toBe(docs[1]);
  jest.mocked(getDocs).mockResolvedValueOnce({ docs: [item('three')] } as never);
  const second = await loadOwnCampusPosts('pu', 'alice', first.cursor, 2);
  expect(second.items.map((post) => post.id)).toEqual(['three']);
  expect(query).toHaveBeenLastCalledWith(
    'schools/pu/campusPosts',
    { where: ['authorUid', '==', 'alice'] },
    { orderBy: ['createdAt', 'desc'] },
    { after: docs[1] },
    { limit: 3 },
  );
});

test('missing scope and access-denied reads do not masquerade as an empty creator page', async () => {
  await expect(loadOwnCampusPosts('pu', '')).rejects.toThrow('MISSING_SOCIAL_SCOPE');
  expect(getDocs).not.toHaveBeenCalled();
  const denied = new Error('permission-denied');
  jest.mocked(getDocs).mockRejectedValueOnce(denied);
  await expect(loadOwnCampusPosts('pu', 'alice')).rejects.toBe(denied);
});
