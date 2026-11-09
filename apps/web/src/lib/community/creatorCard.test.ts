import { beforeEach, expect, it, vi } from 'vitest';
import { readCreatorCard, saveCreatorCard } from './creatorCard';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  getDocFromServer: mocks.read,
  setDoc: mocks.write,
  serverTimestamp: () => 'SERVER_TIME',
}));

const snapshot = (data: Record<string, unknown>) => ({
  exists: () => true,
  data: () => data,
});
const valid = {
  schoolId: 'pu', ownerUid: 'alice', headline: '校園攝影',
  bio: '分享校園日常', linkUrl: 'https://example.org/portfolio',
};

beforeEach(() => vi.clearAllMocks());

it('reads only the opted-in creator fields, not school account data', async () => {
  mocks.read.mockResolvedValue(snapshot({
    ...valid, phone: 'private', studentId: 'private', email: 'private',
  }));
  expect(await readCreatorCard('pu', 'alice')).toEqual({
    headline: '校園攝影', bio: '分享校園日常', linkUrl: 'https://example.org/portfolio',
  });
  expect(mocks.read).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice');
});

it('distinguishes an unpublished card from a denied read', async () => {
  mocks.read.mockResolvedValueOnce({ exists: () => false });
  expect(await readCreatorCard('pu', 'alice')).toBeNull();
  mocks.read.mockRejectedValueOnce(new Error('permission-denied'));
  await expect(readCreatorCard('pu', 'alice')).rejects.toThrow('permission-denied');
});

it('saves a normalized card and only returns success after server readback', async () => {
  mocks.write.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue(snapshot({ ...valid }));
  const saved = await saveCreatorCard('pu', 'alice', {
    headline: ' 校園攝影 ', bio: '分享校園日常',
    linkUrl: 'https://example.org/portfolio',
  });
  expect(saved.headline).toBe('校園攝影');
  expect(mocks.write).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    ...valid, updatedAt: 'SERVER_TIME',
  });
  expect(mocks.read).toHaveBeenCalledTimes(1);
});

it('does not falsely confirm a stale server response or an unsafe link', async () => {
  mocks.write.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue(snapshot({ ...valid, bio: '舊資料' }));
  await expect(saveCreatorCard('pu', 'alice', valid)).rejects.toThrow('not confirmed');
  mocks.write.mockClear();
  await expect(saveCreatorCard('pu', 'alice', { ...valid, linkUrl: 'http://unsafe.org' })).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled();
});

it('refuses malformed school and account scopes before database calls', async () => {
  await expect(readCreatorCard('bad/campus', 'alice')).rejects.toThrow();
  await expect(saveCreatorCard('pu', 'x/y', valid)).rejects.toThrow();
  expect(mocks.write).not.toHaveBeenCalled();
});
