import { deleteDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import {
  featureCreatorPost, readCreatorHighlight, removeCreatorHighlight,
} from '../../services/creatorHighlight';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...parts: string[]) => parts.join('/')),
  getDocFromServer: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
}));

const found = (value: Record<string, unknown>) => ({
  exists: () => true,
  data: () => value,
});
const absent = () => ({ exists: () => false });
const post = {
  schoolId: 'pu', authorUid: 'alice', anonymous: false,
  boardId: 'board', title: '校園作品', content: '真實內容',
};
const pinned = { schoolId: 'pu', ownerUid: 'alice', postId: 'post1' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(deleteDoc).mockResolvedValue(undefined);
});

test('reads the actual signed post, but never exposes anonymous or stale content', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(found(pinned) as never)
    .mockResolvedValueOnce(found(post) as never);
  expect((await readCreatorHighlight('pu', 'alice'))?.post?.title).toBe('校園作品');
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(found(pinned) as never)
    .mockResolvedValueOnce(found({ ...post, anonymous: true }) as never);
  expect((await readCreatorHighlight('pu', 'alice'))?.post).toBeNull();
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(found(pinned) as never)
    .mockResolvedValueOnce(absent() as never);
  expect((await readCreatorHighlight('pu', 'alice'))?.post).toBeNull();
});

test('refuses to pin another creator or an invalid campus scope', async () => {
  await expect(featureCreatorPost('other/pu', 'alice', 'post1')).rejects.toThrow();
  jest.mocked(getDocFromServer).mockResolvedValueOnce(found({ ...post, authorUid: 'bob' }) as never);
  await expect(featureCreatorPost('pu', 'alice', 'post1')).rejects.toThrow('FEATURED_POST_NOT_OWNED');
  expect(setDoc).not.toHaveBeenCalled();
});

test('confirms the pointer and its original post after a write', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(found(post) as never)
    .mockResolvedValueOnce(found(pinned) as never)
    .mockResolvedValueOnce(found(post) as never);
  const result = await featureCreatorPost('pu', 'alice', 'post1');
  expect(result.post?.id).toBe('post1');
  expect(setDoc).toHaveBeenCalledWith(
    'schools/pu/creatorHighlights/alice',
    { ...pinned, updatedAt: 'SERVER_TIMESTAMP' },
  );
});

test('removal must be confirmed from server, never merely assumed', async () => {
  jest.mocked(getDocFromServer).mockResolvedValueOnce(found(pinned) as never);
  await expect(removeCreatorHighlight('pu', 'alice')).rejects.toThrow('FEATURED_REMOVAL_NOT_CONFIRMED');
  jest.mocked(getDocFromServer).mockResolvedValueOnce(absent() as never);
  await expect(removeCreatorHighlight('pu', 'alice')).resolves.toBeUndefined();
});
