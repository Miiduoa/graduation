import { listCreatorPosts, readCreatorIdentity, CREATOR_PAGE_SIZE } from '../../services/creatorProfile';
import { getDocs, getDocFromServer } from 'firebase/firestore';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_: unknown, ...parts: string[]) => parts.join('/'),
  getDocs: jest.fn(),
  getDocFromServer: jest.fn(),
  query: (base: string, ...constraints: unknown[]) => ({ base, constraints }),
  where: (...args: unknown[]) => ({ op: 'where', args }),
  orderBy: (...args: unknown[]) => ({ op: 'orderBy', args }),
  startAfter: (cursor: unknown) => ({ op: 'startAfter', cursor }),
  limit: (size: number) => ({ op: 'limit', size }),
}));

const row = (id: string, extras: Record<string, unknown> = {}) => ({
  id,
  data: () => ({
    schoolId: 'pu', authorUid: 'alice', anonymous: false,
    title: '貼文', content: '內容', ...extras,
  }),
});

beforeEach(() => jest.clearAllMocks());

test('paginates one member without scanning another school', async () => {
  const many = Array.from({ length: CREATOR_PAGE_SIZE + 1 }, (_, i) => row(String(i)));
  jest.mocked(getDocs).mockResolvedValueOnce({ docs: many } as never);
  const page = await listCreatorPosts('pu', 'alice');
  expect(page.posts).toHaveLength(CREATOR_PAGE_SIZE);
  expect(page.cursor).toEqual(many[CREATOR_PAGE_SIZE - 1]);
  expect(page.hasMore).toBe(true);
  expect(getDocs).toHaveBeenCalledWith(expect.objectContaining({
    base: 'schools/pu/campusPosts',
    constraints: [
      { op: 'where', args: ['authorUid', '==', 'alice'] },
      { op: 'orderBy', args: ['createdAt', 'desc'] },
      { op: 'limit', size: CREATOR_PAGE_SIZE + 1 },
    ],
  }));
});

test('hides legacy anonymous, cross-school and mismatched-author posts', async () => {
  jest.mocked(getDocs).mockResolvedValueOnce({
    docs: [row('one'), row('anon', { anonymous: true }), row('other', { schoolId: 'other' }), row('wrong', { authorUid: 'bob' })],
  } as never);
  const page = await listCreatorPosts('pu', 'alice');
  expect(page.posts.map((post) => post.id)).toEqual(['one']);
});

test('uses directory only, never school ID, phone or email from a private profile', async () => {
  jest.mocked(getDocFromServer).mockResolvedValueOnce({
    exists: () => true,
    data: () => ({ displayName: ' Alice ', avatarUrl: 'https://example.test/a.png', studentId: 'private', email: 'private' }),
  } as never);
  expect(await readCreatorIdentity('pu', 'alice')).toEqual({
    displayName: 'Alice', avatarUrl: 'https://example.test/a.png',
  });
  expect(getDocFromServer).toHaveBeenCalledWith('schools/pu/directory/alice');
});

test('missing directory is distinct from denied access', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockRejectedValueOnce(new Error('permission-denied'));
  expect(await readCreatorIdentity('pu', 'alice')).toBeNull();
  await expect(readCreatorIdentity('pu', 'alice')).rejects.toThrow('permission-denied');
});

test('rejects malformed paths before any Firestore reads', async () => {
  await expect(listCreatorPosts('bad/school', 'alice')).rejects.toThrow();
  await expect(readCreatorIdentity('pu', 'bad/uid')).rejects.toThrow();
  expect(getDocs).not.toHaveBeenCalled();
  expect(getDocFromServer).not.toHaveBeenCalled();
});
