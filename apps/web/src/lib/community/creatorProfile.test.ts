import { beforeEach, expect, it, vi } from 'vitest';
import { CREATOR_PAGE_SIZE, listCreatorPosts, readCreatorIdentity } from './creatorProfile';

const mocks = vi.hoisted(() => ({ getDocs: vi.fn(), getDocFromServer: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocs: mocks.getDocs,
  getDocFromServer: mocks.getDocFromServer,
  query: (base: string, ...constraints: unknown[]) => ({ base, constraints }),
  where: (...args: unknown[]) => ({ op: 'where', args }),
  orderBy: (...args: unknown[]) => ({ op: 'orderBy', args }),
  startAfter: (cursor: unknown) => ({ op: 'startAfter', cursor }),
  limit: (size: number) => ({ op: 'limit', size }),
}));

const row = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => ({
    schoolId: 'pu',
    authorUid: 'alice',
    anonymous: false,
    title: id,
    content: '貼文內容',
    ...data,
  }),
});

beforeEach(() => vi.clearAllMocks());

it('queries the requested author in one school and paginates without an all-campus scan', async () => {
  const entries = Array.from({ length: CREATOR_PAGE_SIZE + 1 }, (_, i) =>
    row(`post-${i}`, {}),
  );
  mocks.getDocs.mockResolvedValueOnce({ docs: entries }).mockResolvedValueOnce({
    docs: [row('older', {})],
  });
  const first = await listCreatorPosts('pu', 'alice');
  expect(first.posts).toHaveLength(CREATOR_PAGE_SIZE);
  expect(first.hasMore).toBe(true);
  expect(first.cursor).toBe(entries[CREATOR_PAGE_SIZE - 1]);
  expect(mocks.getDocs.mock.calls[0][0]).toEqual({
    base: 'schools/pu/campusPosts',
    constraints: [
      { op: 'where', args: ['authorUid', '==', 'alice'] },
      { op: 'orderBy', args: ['createdAt', 'desc'] },
      { op: 'limit', size: CREATOR_PAGE_SIZE + 1 },
    ],
  });
  const second = await listCreatorPosts('pu', 'alice', first.cursor);
  expect(second.posts.map((post) => post.id)).toEqual(['older']);
  expect(second.hasMore).toBe(false);
  expect(mocks.getDocs.mock.calls[1][0].constraints).toContainEqual({
    op: 'startAfter',
    cursor: first.cursor,
  });
});

it('never publishes anonymous, cross-school or mismatched-author rows', async () => {
  mocks.getDocs.mockResolvedValue({
    docs: [
      row('safe', {}),
      row('anonymous-legacy', { anonymous: true }),
      row('wrong-school', { schoolId: 'other' }),
      row('wrong-author', { authorUid: 'bob' }),
    ],
  });
  const result = await listCreatorPosts('pu', 'alice');
  expect(result.posts.map((post) => post.id)).toEqual(['safe']);
  expect(result.hasMore).toBe(false);
});

it('reads only the school directory and does not expose private profile fields', async () => {
  mocks.getDocFromServer.mockResolvedValue({
    exists: () => true,
    data: () => ({
      displayName: ' Alice ',
      avatarUrl: 'https://example.test/avatar.png',
      phone: 'private phone',
      studentId: 'private student id',
      bio: 'private bio',
    }),
  });
  expect(await readCreatorIdentity('pu', 'alice')).toEqual({
    displayName: 'Alice',
    avatarUrl: 'https://example.test/avatar.png',
  });
  expect(mocks.getDocFromServer).toHaveBeenCalledWith('schools/pu/directory/alice');
});

it('treats a missing directory document differently from a failed read', async () => {
  mocks.getDocFromServer.mockResolvedValueOnce({ exists: () => false });
  expect(await readCreatorIdentity('pu', 'alice')).toBeNull();
  mocks.getDocFromServer.mockRejectedValueOnce(new Error('permission-denied'));
  await expect(readCreatorIdentity('pu', 'alice')).rejects.toThrow('permission-denied');
});

it('rejects malformed scopes before issuing Firestore reads', async () => {
  await expect(listCreatorPosts('other/campus', 'alice')).rejects.toThrow();
  await expect(readCreatorIdentity('pu', 'alice/admin')).rejects.toThrow();
  expect(mocks.getDocs).not.toHaveBeenCalled();
  expect(mocks.getDocFromServer).not.toHaveBeenCalled();
});
