import { getDocFromServer, setDoc } from 'firebase/firestore';
import { readCreatorCardFields } from '@campus/shared/src/creatorCard';
import { isCreatorCardAccessDenied, readCreatorCard, saveCreatorCard } from '../../services/creatorCard';

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

test.each([
  [{ code: 'permission-denied' }, true],
  [{ code: 'firestore/unauthenticated' }, true],
  [new Error('Missing or insufficient permissions.'), true],
  [{ code: 'unavailable' }, false],
  [new Error('offline'), false],
])('classifies card read error %p', (error, denied) => {
  expect(isCreatorCardAccessDenied(error)).toBe(denied);
});

test('reads only a school-scoped published card', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(snap({ ...card, phone: 'private' }) as never);
  expect(await readCreatorCard('pu', 'alice')).toEqual({
    headline: '讀書和攝影', bio: '校園生活', linkUrl: 'https://example.org/me',
  });
  expect(getDocFromServer).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice');
});

describe.each(['headline', 'bio', 'linkUrl', 'pinnedPostId', 'extra'] as const)(
  'merge-base read behavior for %s', (field) => {
    test.each([
      ['surrounding spaces', '  https://example.net  '],
      ['newlines', '\nhttps://example.net\n'],
      ['indentation', '\t  https://example.net'],
      ['invalid URL', 'http://example.net/'],
      ['empty string', ''],
      ['null', null],
      ['missing', undefined],
    ])('%s with valid and invalid portfolio links', async (_scenario, value) => {
      for (const linkUrl of [card.linkUrl, 'http://example.org/']) {
        const raw: Record<string, unknown> = {
          ...card, headline: '  舊標題  ', bio: '\n\t舊簡介\n', linkUrl, [field]: value,
        };
        if (value === undefined) delete raw[field];
        jest.mocked(getDocFromServer).mockResolvedValueOnce(snap(raw) as never);
        // The merge-base service returns this shared reader directly.
        expect(await readCreatorCard('pu', 'alice')).toStrictEqual(readCreatorCardFields(raw));
      }
      expect(setDoc).not.toHaveBeenCalled();
    });
  },
);

test('an unpublished profile is different from a permission-denied read', async () => {
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false, metadata: { hasPendingWrites: false } } as never)
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

test.each([
  ['headline', '  '],
  ['bio', '  '],
  ['linkUrl', 'https://localhost'],
] as const)('clearing %s confirms an equivalent normalized empty value', async (field, hidden) => {
  const draft = { headline: card.headline, bio: card.bio, linkUrl: card.linkUrl, [field]: '' };
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap({ ...card, [field]: hidden }) as never)
    .mockResolvedValueOnce(snap({ ...card, [field]: '' }) as never);

  await expect(saveCreatorCard('pu', 'alice', draft)).resolves.toEqual(draft);
  await expect(saveCreatorCard('pu', 'alice', draft)).resolves.toEqual(draft);
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    ...card, ...draft, updatedAt: 'SERVER_TIME',
  }, { merge: true });
});

test('a wrong-school snapshot cannot confirm a write', async () => {
  const snapshot = snap({ ...card, schoolId: 'other-school', linkUrl: '' });
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer).mockResolvedValue(snapshot as never);

  await expect(saveCreatorCard('pu', 'alice', { ...card, linkUrl: '' }))
    .rejects.toThrow('scope mismatch');

  // The service must not retry an ambiguous write internally. Its caller
  // decides when to re-read the committed server state before another save.
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(setDoc).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice', {
    ...card, linkUrl: '', updatedAt: 'SERVER_TIME',
  }, { merge: true });
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(getDocFromServer).toHaveBeenCalledWith('schools/pu/creatorProfiles/alice');
});

test('a missing content field confirms when its displayed value matches', async () => {
  const legacy = { schoolId: 'pu', ownerUid: 'alice' };
  const draft = { headline: '新標題', bio: '新簡介', linkUrl: '' };
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snap(legacy) as never)
    .mockResolvedValueOnce(snap({ ...legacy, headline: draft.headline, bio: draft.bio }) as never)
    .mockResolvedValueOnce(snap({ ...legacy, ...draft }) as never);
  expect(await readCreatorCard('pu', 'alice')).toEqual({ headline: '', bio: '', linkUrl: '' });
  await expect(saveCreatorCard('pu', 'alice', draft)).resolves.toEqual(draft);
  await expect(saveCreatorCard('pu', 'alice', draft)).resolves.toEqual(draft);
  expect(setDoc).toHaveBeenLastCalledWith('schools/pu/creatorProfiles/alice', {
    ...legacy, ...draft, updatedAt: 'SERVER_TIME',
  }, { merge: true });
});


test('an unresolved portfolio clear cannot be confirmed from a pending local overlay', async () => {
  const draft = { headline: card.headline, bio: card.bio, linkUrl: '' };
  // A rejected/uncertain write may still appear locally, even after requesting
  // the server. A matching display value is not proof of a committed clear.
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
  await expect(readCreatorCard('pu', 'alice')).resolves.toEqual(draft);
  await expect(readCreatorCard('pu', 'alice', { requireCommitted: true }))
    .rejects.toThrow('pending writes');
  // Once a genuinely committed snapshot arrives, manual re-check may succeed;
  // neither read retries an ambiguous write.
  await expect(readCreatorCard('pu', 'alice', { requireCommitted: true }))
    .resolves.toEqual(draft);
  expect(setDoc).toHaveBeenCalledTimes(1);
  expect(getDocFromServer).toHaveBeenCalledTimes(3);
});

test.each([true, false])('display reads return null for a missing card with pending metadata %s', async (hasPendingWrites) => {
  jest.mocked(getDocFromServer).mockResolvedValueOnce({
    exists: () => false, metadata: { hasPendingWrites },
  } as never);
  await expect(readCreatorCard('pu', 'alice')).resolves.toBeNull();
});
