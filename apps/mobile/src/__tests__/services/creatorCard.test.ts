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
  metadata: { hasPendingWrites: false },
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

test('editing selected fields leaves concurrent server changes untouched', async () => {
  const latest = { ...card, headline: '新的標題', bio: '其他裝置更新的簡介', linkUrl: 'https://example.net/' };
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue(snap(latest) as never);

  await expect(saveCreatorCard('pu', 'alice', {
    headline: ' 新的標題 ', bio: card.bio, linkUrl: card.linkUrl,
  }, ['headline'])).resolves.toEqual({
    headline: latest.headline, bio: latest.bio, linkUrl: latest.linkUrl,
  });
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    schoolId: 'pu', ownerUid: 'alice', headline: latest.headline, updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

test.each([
  ['headline', '  '],
  ['bio', '  '],
  ['linkUrl', 'https://localhost'],
] as const)('clearing %s requires a committed raw empty string', async (field, hidden) => {
  const draft = { headline: card.headline, bio: card.bio, linkUrl: card.linkUrl, [field]: '' };
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap({ ...card, [field]: hidden }) as never)
    .mockResolvedValueOnce(snap({ ...card, [field]: '' }) as never);

  await expect(saveCreatorCard('pu', 'alice', draft, [field])).rejects.toThrow('not confirmed');
  await expect(saveCreatorCard('pu', 'alice', draft, [field])).resolves.toEqual(draft);
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    schoolId: 'pu', ownerUid: 'alice', [field]: '', updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

test.each([
  [
    'uncommitted local server snapshot',
    { ...snap({ ...card, linkUrl: '' }), metadata: { hasPendingWrites: true } },
    'pending writes',
  ],
  [
    'wrong-school server snapshot',
    snap({ ...card, schoolId: 'other-school', linkUrl: '' }),
    'scope mismatch',
  ],
] as const)('clearing a legacy link never confirms from an %s', async (_scenario, snapshot, message) => {
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue(snapshot as never);

  await expect(saveCreatorCard('pu', 'alice', { ...card, linkUrl: '' }, ['linkUrl']))
    .rejects.toThrow(message);

  // The service must not retry an ambiguous write internally. Its caller
  // decides when to re-read the committed server state before another save.
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    schoolId: 'pu', ownerUid: 'alice', linkUrl: '', updatedAt: 'SERVER_TIME',
  }, { merge: true });
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(getDocFromServer).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice');
});
