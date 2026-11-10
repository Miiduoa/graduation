import { getDocFromServer, setDoc } from 'firebase/firestore';
import { readCreatorPin, saveCreatorPin } from '../../services/creatorPin';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: () => 'SERVER_TIME',
}));
const snap = (id: string, value: Record<string, unknown>) =>
  ({ exists: () => true, id, data: () => value });
const missing = { exists: () => false };
const post = (change = {}) =>
  ({ schoolId: 'pu', authorUid: 'alice', anonymous: false, title: '讀書分享', ...change });
const profile = (id: string) => ({ schoolId: 'pu', ownerUid: 'alice', pinnedPostId: id });
beforeEach(() => jest.clearAllMocks());

test('loads the canonical pinned post, and hides any anonymous legacy author', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap('alice', profile('post1')) as never)
    .mockResolvedValueOnce(snap('post1', post()) as never);
  expect(await readCreatorPin('pu', 'alice')).toEqual({
    postId: 'post1', post: { id: 'post1', ...post() },
  });
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap('alice', profile('post1')) as never)
    .mockResolvedValueOnce(snap('post1', post({ anonymous: true })) as never);
  expect(await readCreatorPin('pu', 'alice')).toEqual({ postId: null, post: null });
});

test('sets a single pinned post without losing an existing biography', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap('post1', post()) as never)
    .mockResolvedValueOnce(snap('alice', { ...profile(''), bio: 'keep' }) as never)
    .mockResolvedValueOnce(snap('alice', profile('post1')) as never)
    .mockResolvedValueOnce(snap('post1', post()) as never);
  jest.mocked(setDoc).mockResolvedValue(undefined);
  expect((await saveCreatorPin('pu', 'alice', 'post1')).postId).toBe('post1');
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    pinnedPostId: 'post1', updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

test('unpins with a confirmed server read and without writing biography fields', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap('alice', profile('post1')) as never)
    .mockResolvedValueOnce(snap('alice', profile('')) as never);
  jest.mocked(setDoc).mockResolvedValue(undefined);
  expect(await saveCreatorPin('pu', 'alice', '')).toEqual({ postId: null, post: null });
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    pinnedPostId: '', updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

test('blocks different author and failed confirmation', async () => {
  jest.mocked(getDocFromServer).mockResolvedValueOnce(snap('post1', post({ authorUid: 'bob' })) as never);
  await expect(saveCreatorPin('pu', 'alice', 'post1')).rejects.toThrow('Only your nonanonymous posts');
  expect(setDoc).not.toHaveBeenCalled();
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap('post1', post()) as never)
    .mockResolvedValueOnce(missing as never)
    .mockResolvedValueOnce(snap('alice', profile('')) as never);
  jest.mocked(setDoc).mockResolvedValue(undefined);
  await expect(saveCreatorPin('pu', 'alice', 'post1')).rejects.toThrow('not confirmed');
});
