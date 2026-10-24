import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LostFoundStorageError,
  clearLostFoundDraft,
  clearLostFoundDraftIfMatches,
  clearLostFoundPending,
  clearLostFoundPendingIfMatches,
  enqueueLostFoundDraftSave,
  forgetCreateDocumentId,
  forgetCreateDocumentIdIfMatches,
  loadCreateDocumentId,
  loadLostFoundDraft,
  loadLostFoundPending,
  lostFoundDraftStorageKey,
  rememberCreateDocumentId,
  saveLostFoundDraft,
  saveLostFoundPending,
} from '../../data/lostFoundDrafts';

const scope = {
  uid: 'alice',
  schoolId: 'pu',
  mode: 'create' as const,
  itemKey: 'draft-1',
};

const fields = {
  type: 'lost' as const,
  title: '雨傘',
  description: '黑色長柄傘',
  category: 'other',
  location: '圖書館',
  date: '2026-10-08',
  contactInfo: 'a@test',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('draft keys are scoped by uid+school+mode+item and do not leak across accounts', async () => {
  await saveLostFoundDraft(scope, { version: 1, documentId: 'draft-1', ...fields });
  expect(await loadLostFoundDraft(scope)).toMatchObject({ title: '雨傘', documentId: 'draft-1' });
  expect(
    await loadLostFoundDraft({ ...scope, uid: 'bob' }),
  ).toBeNull();
  expect(await AsyncStorage.getItem(lostFoundDraftStorageKey({ ...scope, uid: 'bob' }))).toBeNull();
});

test('pending intents freeze and refuse replacement by a different payload', async () => {
  await saveLostFoundPending(scope, {
    version: 1,
    action: 'create',
    documentId: 'draft-1',
    fields,
  });
  await expect(
    saveLostFoundPending(scope, {
      version: 1,
      action: 'create',
      documentId: 'draft-1',
      fields: { ...fields, title: '另一把' },
    }),
  ).rejects.toThrow(LostFoundStorageError);
  expect(await loadLostFoundPending(scope)).toMatchObject({ fields: { title: '雨傘' } });
  await clearLostFoundPending(scope);
  expect(await loadLostFoundPending(scope)).toBeNull();
});

test('create document index is per uid+school and clears independently', async () => {
  await rememberCreateDocumentId('alice', 'pu', 'draft-1');
  expect(await loadCreateDocumentId('alice', 'pu')).toBe('draft-1');
  expect(await loadCreateDocumentId('bob', 'pu')).toBeNull();
  await forgetCreateDocumentId('alice', 'pu');
  expect(await loadCreateDocumentId('alice', 'pu')).toBeNull();
});

test('corrupt draft storage surfaces a storage error without inventing fields', async () => {
  await AsyncStorage.setItem(lostFoundDraftStorageKey(scope), '{not-json');
  await expect(loadLostFoundDraft(scope)).rejects.toThrow(LostFoundStorageError);
  await clearLostFoundDraft(scope);
});

test('revision markers round-trip without collapsing to lossy ISO', async () => {
  await saveLostFoundDraft(
    { ...scope, mode: 'edit', itemKey: 'item-1' },
    {
      version: 1,
      documentId: 'item-1',
      ...fields,
      expectedRevision: { seconds: 1700000100, nanoseconds: 42 },
    },
  );
  const draft = await loadLostFoundDraft({ ...scope, mode: 'edit', itemKey: 'item-1' });
  expect(draft?.expectedRevision).toEqual({ seconds: 1700000100, nanoseconds: 42 });
});

test('serialized draft enqueue keeps the latest payload without false storage failures', async () => {
  const writes = Array.from({ length: 12 }, (_, index) =>
    enqueueLostFoundDraftSave(scope, {
      version: 1,
      documentId: 'draft-1',
      ...fields,
      title: `標題-${index}`,
    }),
  );
  await Promise.all(writes);
  expect(await loadLostFoundDraft(scope)).toMatchObject({ title: '標題-11' });
});

test('identity-gated clears never remove another intent or create index pointer', async () => {
  await saveLostFoundPending(scope, {
    version: 1,
    action: 'create',
    documentId: 'draft-1',
    fields,
  });
  await clearLostFoundPendingIfMatches(scope, { action: 'create', documentId: 'other-id' });
  expect(await loadLostFoundPending(scope)).toMatchObject({ documentId: 'draft-1' });
  await clearLostFoundPendingIfMatches(scope, { action: 'create', documentId: 'draft-1' });
  expect(await loadLostFoundPending(scope)).toBeNull();

  await saveLostFoundDraft(scope, { version: 1, documentId: 'draft-1', ...fields });
  await clearLostFoundDraftIfMatches(scope, 'other-id');
  expect(await loadLostFoundDraft(scope)).toMatchObject({ documentId: 'draft-1' });
  await clearLostFoundDraftIfMatches(scope, 'draft-1');
  expect(await loadLostFoundDraft(scope)).toBeNull();

  await rememberCreateDocumentId('alice', 'pu', 'draft-1');
  await forgetCreateDocumentIdIfMatches('alice', 'pu', 'other-id');
  expect(await loadCreateDocumentId('alice', 'pu')).toBe('draft-1');
  await forgetCreateDocumentIdIfMatches('alice', 'pu', 'draft-1');
  expect(await loadCreateDocumentId('alice', 'pu')).toBeNull();
});
