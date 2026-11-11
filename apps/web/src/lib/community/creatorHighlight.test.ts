import { beforeEach, expect, it, vi } from 'vitest';
import { featureCreatorPost, readCreatorHighlight, removeCreatorHighlight } from './creatorHighlight';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: mocks.read,
  setDoc: mocks.set,
  deleteDoc: mocks.remove,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

const found = (value: Record<string, unknown>) => ({
  exists: () => true,
  data: () => value,
});
const absent = () => ({ exists: () => false });
const signed = {
  schoolId: 'pu', authorUid: 'alice', anonymous: false,
  boardId: 'life', title: '我的專題作品', content: '在校園展示', mediaUrls: [],
};
const pointer = { schoolId: 'pu', ownerUid: 'alice', postId: 'post-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.set.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

it('never invents a featured work for an empty creator card', async () => {
  mocks.read.mockResolvedValueOnce(absent());
  await expect(readCreatorHighlight('pu', 'alice')).resolves.toBeNull();
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith('schools/pu/creatorHighlights/alice');
});

it('follows the source post and refuses to display anonymous, deleted or foreign works', async () => {
  mocks.read.mockResolvedValueOnce(found(pointer)).mockResolvedValueOnce(found(signed));
  const result = await readCreatorHighlight('pu', 'alice');
  expect(result?.post).toMatchObject({ id: 'post-1', ...signed });
  expect(mocks.read).toHaveBeenNthCalledWith(2, 'schools/pu/campusPosts/post-1');

  for (const post of [
    { ...signed, anonymous: true },
    { ...signed, schoolId: 'other' },
    { ...signed, authorUid: 'bob' },
  ]) {
    mocks.read.mockResolvedValueOnce(found(pointer)).mockResolvedValueOnce(found(post));
    expect((await readCreatorHighlight('pu', 'alice'))?.post).toBeNull();
  }
  mocks.read.mockResolvedValueOnce(found(pointer)).mockResolvedValueOnce(absent());
  expect((await readCreatorHighlight('pu', 'alice'))?.post).toBeNull();
});

it('rejects malformed scopes, mismatched pointers and unavailable network reads', async () => {
  await expect(readCreatorHighlight('pu/foreign', 'alice')).rejects.toThrow();
  await expect(readCreatorHighlight('pu', 'alice/other')).rejects.toThrow();
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.read.mockResolvedValueOnce(found({ ...pointer, ownerUid: 'bob' }));
  await expect(readCreatorHighlight('pu', 'alice')).rejects.toThrow('INVALID_CREATOR_HIGHLIGHT');
  const offline = new Error('permission-denied');
  mocks.read.mockRejectedValueOnce(offline);
  await expect(readCreatorHighlight('pu', 'alice')).rejects.toBe(offline);
});

it('verifies ownership before changing state and only reports success after server readback', async () => {
  mocks.read.mockResolvedValueOnce(found({ ...signed, anonymous: true }));
  await expect(featureCreatorPost('pu', 'alice', 'post-1')).rejects.toThrow('FEATURED_POST_NOT_OWNED');
  expect(mocks.set).not.toHaveBeenCalled();

  mocks.read.mockResolvedValueOnce(found(signed))
    .mockResolvedValueOnce(found(pointer))
    .mockResolvedValueOnce(found(signed));
  const confirmed = await featureCreatorPost('pu', 'alice', 'post-1');
  expect(confirmed.post?.id).toBe('post-1');
  expect(mocks.set).toHaveBeenCalledWith(
    'schools/pu/creatorHighlights/alice',
    { ...pointer, updatedAt: 'SERVER_TIMESTAMP' },
  );
});

it('does not claim an unconfirmed save or delete succeeded', async () => {
  mocks.read.mockResolvedValueOnce(found(signed))
    .mockResolvedValueOnce(found({ ...pointer, postId: 'different' }))
    .mockResolvedValueOnce(found(signed));
  await expect(featureCreatorPost('pu', 'alice', 'post-1')).rejects.toThrow('FEATURED_POST_NOT_CONFIRMED');

  mocks.read.mockResolvedValueOnce(found(pointer));
  await expect(removeCreatorHighlight('pu', 'alice')).rejects.toThrow('FEATURED_REMOVAL_NOT_CONFIRMED');
  expect(mocks.remove).toHaveBeenCalledWith('schools/pu/creatorHighlights/alice');

  mocks.read.mockResolvedValueOnce(absent());
  await expect(removeCreatorHighlight('pu', 'alice')).resolves.toBeUndefined();
});
