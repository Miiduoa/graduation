import { beforeEach, expect, it, vi } from 'vitest';
import { readCreatorPin, saveCreatorPin } from './creatorPin';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: mocks.read,
  setDoc: mocks.write,
  serverTimestamp: () => 'SERVER_TIME',
}));

const profile = (pinnedPostId = '') => ({ schoolId: 'pu', ownerUid: 'alice', pinnedPostId });
const authored = (extra: Record<string, unknown> = {}) =>
  ({ schoolId: 'pu', authorUid: 'alice', anonymous: false, title: '校園攝影', ...extra });
const snap = (id: string, value: Record<string, unknown>) => ({
  exists: () => true, id, data: () => value,
});
const missing = { exists: () => false };

beforeEach(() => vi.clearAllMocks());

it('reads one verified pinned post even if it is not in the recent feed window', async () => {
  mocks.read
    .mockResolvedValueOnce(snap('alice', profile('post-older')))
    .mockResolvedValueOnce(snap('post-older', authored()));
  const result = await readCreatorPin('pu', 'alice');
  expect(result).toEqual({
    postId: 'post-older',
    post: { id: 'post-older', ...authored() },
  });
  expect(mocks.read).toHaveBeenNthCalledWith(2, 'schools/pu/campusPosts/post-older');
});

it('never displays deleted, anonymous or misattributed pinned content', async () => {
  for (const record of [missing, snap('post-older', authored({ anonymous: true })), snap('post-older', authored({ authorUid: 'bob' })), snap('post-older', authored({ schoolId: 'other' }))]) {
    mocks.read
      .mockResolvedValueOnce(snap('alice', profile('post-older')))
      .mockResolvedValueOnce(record);
    expect(await readCreatorPin('pu', 'alice')).toEqual({ postId: null, post: null });
  }
  mocks.read.mockResolvedValueOnce(snap('alice', { ...profile(), pinnedPostId: '../private' }));
  await expect(readCreatorPin('pu', 'alice')).rejects.toThrow('Invalid creator pin record');
});

it('publishes the first pin without requiring a biography and confirms the server result', async () => {
  mocks.read
    .mockResolvedValueOnce(snap('post-1', authored()))
    .mockResolvedValueOnce(missing)
    .mockResolvedValueOnce(snap('alice', profile('post-1')))
    .mockResolvedValueOnce(snap('post-1', authored()));
  mocks.write.mockResolvedValue(undefined);
  expect((await saveCreatorPin('pu', 'alice', 'post-1')).postId).toBe('post-1');
  expect(mocks.write).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    schoolId: 'pu', ownerUid: 'alice', headline: '', bio: '', linkUrl: '',
    pinnedPostId: 'post-1', updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

it('unpins without erasing the author biography', async () => {
  mocks.read
    .mockResolvedValueOnce(snap('alice', profile('post-1')))
    .mockResolvedValueOnce(snap('alice', profile('')));
  mocks.write.mockResolvedValue(undefined);
  expect(await saveCreatorPin('pu', 'alice', '')).toEqual({ postId: null, post: null });
  expect(mocks.write).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    pinnedPostId: '', updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

it('rejects someone else’s post and does not write, even for a signed in member', async () => {
  mocks.read.mockResolvedValue(snap('post-1', authored({ authorUid: 'bob' })));
  await expect(saveCreatorPin('pu', 'alice', 'post-1')).rejects.toThrow('Only your nonanonymous posts');
  expect(mocks.write).not.toHaveBeenCalled();
  await expect(saveCreatorPin('other/campus', 'alice', '')).rejects.toThrow();
  await expect(saveCreatorPin('pu', 'alice', 'bad/path')).rejects.toThrow();
});

it('does not report a successful pin when readback is missing', async () => {
  mocks.read
    .mockResolvedValueOnce(snap('post-1', authored()))
    .mockResolvedValueOnce(missing)
    .mockResolvedValueOnce(snap('alice', profile('')));
  mocks.write.mockResolvedValue(undefined);
  await expect(saveCreatorPin('pu', 'alice', 'post-1')).rejects.toThrow('not confirmed');
});
