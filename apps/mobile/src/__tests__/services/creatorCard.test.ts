import { getDocFromServer, setDoc } from 'firebase/firestore';
import { readCreatorCard, saveCreatorCard } from '../../services/creatorCard';

jest.mock('../../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: () => 'SERVER_TIME',
}));
const card = {
  schoolId: 'pu', ownerUid: 'alice',
  headline: '讀書和攝影', bio: '校園生活',
  linkUrl: 'https://example.org/me',
};
const snap = (value: Record<string, unknown>) => ({
  exists: () => true,
  data: () => value,
});
beforeEach(() => jest.clearAllMocks());

test('reads only a school-scoped published card', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(snap({ ...card, phone: 'private' }) as never);
  expect(await readCreatorCard('pu', 'alice')).toEqual({
    headline: '讀書和攝影', bio: '校園生活', linkUrl: 'https://example.org/me',
  });
  expect(getDocFromServer).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice');
});

test('an unpublished profile is different from a permission-denied read', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockRejectedValueOnce(new Error('permission-denied'));
  expect(await readCreatorCard('pu', 'alice')).toBeNull();
  await expect(readCreatorCard('pu', 'alice')).rejects.toThrow('permission-denied');
});

test('write is confirmed with a fresh server read and cannot smuggle private fields', async () => {
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue(snap(card) as never);
  await expect(saveCreatorCard('pu', 'alice', {
    headline: ' 讀書和攝影 ', bio: '校園生活', linkUrl: 'https://example.org/me',
  })).resolves.toEqual({ headline: '讀書和攝影', bio: '校園生活', linkUrl: 'https://example.org/me' });
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    ...card, updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

test('a stale read or unsafe URL never reports success', async () => {
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue(snap({ ...card, headline: '舊資料' }) as never);
  await expect(saveCreatorCard('pu', 'alice', {
    headline: card.headline, bio: card.bio, linkUrl: card.linkUrl,
  })).rejects.toThrow('not confirmed');
  jest.mocked(setDoc).mockClear();
  await expect(saveCreatorCard('pu', 'alice', { ...card, linkUrl: 'javascript:alert(1)' })).rejects.toThrow();
  expect(setDoc).not.toHaveBeenCalled();
});

test('a wrong-school snapshot cannot confirm a write', async () => {
  const snapshot = snap({ ...card, schoolId: 'other-school', linkUrl: '' });
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue(snapshot as never);

  await expect(saveCreatorCard('pu', 'alice', { ...card, linkUrl: '' }))
    .rejects.toThrow('scope mismatch');

  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    ...card, linkUrl: '', updatedAt: 'SERVER_TIME',
  }, { merge: true });
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(getDocFromServer).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice');
});

test('an unresolved portfolio clear cannot be confirmed from a pending local overlay', async () => {
  const draft = { headline: card.headline, bio: card.bio, linkUrl: '' };
  const pendingSnapshot = {
    ...snap({ ...card, linkUrl: '' }),
    metadata: { fromCache: false, hasPendingWrites: true },
  };
  jest.mocked(setDoc).mockRejectedValueOnce(new Error('unavailable'));
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(pendingSnapshot as never)
    .mockResolvedValueOnce(pendingSnapshot as never)
    .mockResolvedValueOnce(snap({ ...card, linkUrl: '' }) as never);

  await expect(saveCreatorCard('pu', 'alice', draft)).rejects.toThrow('unavailable');
  // Display reads still show the snapshot; only confirmation rejects pending writes.
  await expect(readCreatorCard('pu', 'alice')).resolves.toEqual(draft);
  await expect(readCreatorCard('pu', 'alice', { requireCommitted: true }))
    .rejects.toThrow('pending writes');
  await expect(readCreatorCard('pu', 'alice', { requireCommitted: true }))
    .resolves.toEqual(draft);
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(getDocFromServer).toHaveBeenCalledTimes(3);
});

test('save confirmation rejects a pending overlay even after setDoc returns', async () => {
  const draft = { headline: card.headline, bio: card.bio, linkUrl: '' };
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue({
    ...snap({ ...card, linkUrl: '' }),
    metadata: { fromCache: false, hasPendingWrites: true },
  } as never);
  await expect(saveCreatorCard('pu', 'alice', draft)).rejects.toThrow('pending writes');
});

test.each([true, false])('display reads return null for a missing card with pending metadata %s', async (hasPendingWrites) => {
  jest.mocked(getDocFromServer).mockResolvedValueOnce({
    exists: () => false, metadata: { hasPendingWrites },
  } as never);
  await expect(readCreatorCard('pu', 'alice')).resolves.toBeNull();
});
