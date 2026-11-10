import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPlatformLostFoundDeviceState,
  discardPlatformLostFoundDraft,
  finishPlatformLostFoundPending,
  platformLostFoundStorageKey,
  PlatformLostFoundScopeChanged,
  PlatformLostFoundStorageError,
  readPlatformLostFoundDeviceState,
  savePlatformLostFoundDraft,
  savePlatformLostFoundPending,
  type PlatformLostFoundDraft,
  type PlatformLostFoundPending,
} from '../../data/platformLostFoundDrafts';

const accountA = 'pa_11111111-1111-4111-8111-111111111111';
const accountB = 'pa_22222222-2222-4222-8222-222222222222';
const id = 'plf_11111111-1111-4111-8111-111111111111';
const otherId = 'plf_22222222-2222-4222-8222-222222222222';
const scope = { accountId: accountA, schoolId: 'pu' };
const current = () => true;
const draft: PlatformLostFoundDraft = {
  mode: 'create',
  id,
  fields: {
    type: 'lost',
    title: '黑色皮夾',
    description: '有一個藍色扣環',
    category: 'wallet',
    location: '圖書館',
    date: '2026-11-07',
    contactInfo: 'contact@example.test',
  },
};
const pending: PlatformLostFoundPending = {
  action: 'create',
  input: { schoolId: 'pu', id, mutationId: 'operation-0001', fields: draft.fields },
};

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('keeps platform drafts separate from other Google accounts, campuses, and legacy Firebase data', async () => {
  const legacyKey = `campus-one:mobile-lost-found-draft:v1:${accountA}:pu:create:${id}`;
  await AsyncStorage.setItem(legacyKey, 'legacy contact must remain separate');
  await savePlatformLostFoundDraft(scope, draft, current);
  expect(await readPlatformLostFoundDeviceState(scope, current)).toEqual({ draft, pending: null });
  expect(
    await readPlatformLostFoundDeviceState({ ...scope, accountId: accountB }, current),
  ).toEqual({ draft: null, pending: null });
  expect(await readPlatformLostFoundDeviceState({ ...scope, schoolId: 'nthu' }, current)).toEqual({
    draft: null,
    pending: null,
  });
  expect(await AsyncStorage.getItem(legacyKey)).toBe('legacy contact must remain separate');
});

test.each(['firebase-user', '', 'pa_../other', `${accountA}:nthu`])(
  'rejects a non-platform account key %s',
  async (accountId) => {
    await expect(
      readPlatformLostFoundDeviceState({ ...scope, accountId }, current),
    ).rejects.toBeInstanceOf(PlatformLostFoundStorageError);
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  },
);

test.each(['personal', 'all', 'unavailable-campus', 'PU', '../pu', 'pu:other', ''])(
  'rejects invalid campus scope %s',
  async (schoolId) => {
    await expect(
      readPlatformLostFoundDeviceState({ ...scope, schoolId }, current),
    ).rejects.toBeInstanceOf(PlatformLostFoundStorageError);
  },
);

test('persists incomplete drafts without treating them as submitted records', async () => {
  const incomplete = {
    ...draft,
    fields: { ...draft.fields, title: '', date: '2026-', description: '' },
  };
  await savePlatformLostFoundDraft(scope, incomplete, current);
  expect((await readPlatformLostFoundDeviceState(scope, current)).draft).toEqual(incomplete);
});

test('resumes the exact pending mutation after remount and prevents another write from replacing it', async () => {
  await savePlatformLostFoundDraft(scope, draft, current);
  await savePlatformLostFoundPending(scope, pending, current);
  await expect(savePlatformLostFoundPending(scope, pending, current)).resolves.toEqual({
    draft,
    pending,
  });
  const loaded = await readPlatformLostFoundDeviceState(scope, current);
  expect(loaded.pending).toEqual(pending);
  await expect(
    savePlatformLostFoundPending(
      scope,
      { ...pending, input: { ...pending.input, mutationId: 'operation-0002' } },
      current,
    ),
  ).rejects.toBeInstanceOf(PlatformLostFoundStorageError);
  await expect(
    savePlatformLostFoundDraft(
      scope,
      { ...draft, fields: { ...draft.fields, title: '另一本筆記' } },
      current,
    ),
  ).rejects.toBeInstanceOf(PlatformLostFoundStorageError);
  await expect(discardPlatformLostFoundDraft(scope, id, current)).rejects.toBeInstanceOf(
    PlatformLostFoundStorageError,
  );
  expect((await readPlatformLostFoundDeviceState(scope, current)).pending).toEqual(pending);
});

test('does not replace a different unsent draft', async () => {
  await savePlatformLostFoundDraft(scope, draft, current);
  await expect(
    savePlatformLostFoundDraft(scope, { ...draft, id: otherId }, current),
  ).rejects.toThrow('另一份本機草稿');
  expect((await readPlatformLostFoundDeviceState(scope, current)).draft?.id).toBe(id);
});

test('a confirmed receipt removes matching draft contact and pending fields', async () => {
  await savePlatformLostFoundDraft(scope, draft, current);
  await savePlatformLostFoundPending(scope, pending, current);
  await finishPlatformLostFoundPending(scope, pending, current);
  const raw = await AsyncStorage.getItem(platformLostFoundStorageKey(scope));
  expect(raw).not.toContain(draft.fields.contactInfo);
  expect(await readPlatformLostFoundDeviceState(scope, current)).toEqual({
    draft: null,
    pending: null,
  });
});

test('a definitive rejection releases pending state while keeping the editable draft', async () => {
  await savePlatformLostFoundDraft(scope, draft, current);
  await savePlatformLostFoundPending(scope, pending, current);
  await finishPlatformLostFoundPending(scope, pending, current, true);
  expect(await readPlatformLostFoundDeviceState(scope, current)).toEqual({ draft, pending: null });
});

test('an old completion cannot erase another pending operation or a newer unsent draft', async () => {
  await savePlatformLostFoundPending(scope, pending, current);
  const other: PlatformLostFoundPending = {
    action: 'remove',
    input: { schoolId: 'pu', id: otherId, expectedVersion: 1, mutationId: 'operation-0002' },
  };
  await expect(finishPlatformLostFoundPending(scope, other, current)).rejects.toThrow(
    '待確認操作已變更',
  );
  await finishPlatformLostFoundPending(scope, pending, current);
  await savePlatformLostFoundDraft(scope, draft, current);
  await finishPlatformLostFoundPending(scope, pending, current);
  expect((await readPlatformLostFoundDeviceState(scope, current)).draft).toEqual(draft);
});

test('finishing an unrelated item keeps the other local draft', async () => {
  await savePlatformLostFoundDraft(scope, draft, current);
  const removal: PlatformLostFoundPending = {
    action: 'remove',
    input: { schoolId: 'pu', id: otherId, expectedVersion: 2, mutationId: 'operation-remove' },
  };
  await savePlatformLostFoundPending(scope, removal, current);
  await finishPlatformLostFoundPending(scope, removal, current);
  expect((await readPlatformLostFoundDeviceState(scope, current)).draft).toEqual(draft);
});

test.each([
  '{',
  JSON.stringify({ version: 1, accountId: accountB, schoolId: 'pu', draft, pending: null }),
  JSON.stringify({ version: 1, ...scope, draft: { ...draft, id: '../legacy' }, pending: null }),
  JSON.stringify({
    version: 1,
    ...scope,
    draft: null,
    pending: { ...pending, input: { ...pending.input, schoolId: 'nthu' } },
  }),
  'x'.repeat(32_001),
])('preserves unreadable storage until an explicit scoped clear', async (raw) => {
  const key = platformLostFoundStorageKey(scope);
  await AsyncStorage.setItem(key, raw);
  await expect(readPlatformLostFoundDeviceState(scope, current)).rejects.toBeInstanceOf(
    PlatformLostFoundStorageError,
  );
  await expect(savePlatformLostFoundDraft(scope, draft, current)).rejects.toBeInstanceOf(
    PlatformLostFoundStorageError,
  );
  expect(await AsyncStorage.getItem(key)).toBe(raw);
  const otherScope = { ...scope, accountId: accountB };
  await savePlatformLostFoundDraft(otherScope, draft, current);
  await clearPlatformLostFoundDeviceState(scope, current);
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect((await readPlatformLostFoundDeviceState(otherScope, current)).draft).toEqual(draft);
});

test('an invalidated screen cannot read, write, or clear a scope', async () => {
  const stale = () => false;
  await expect(readPlatformLostFoundDeviceState(scope, stale)).rejects.toBeInstanceOf(
    PlatformLostFoundScopeChanged,
  );
  await expect(savePlatformLostFoundDraft(scope, draft, stale)).rejects.toBeInstanceOf(
    PlatformLostFoundScopeChanged,
  );
  await expect(clearPlatformLostFoundDeviceState(scope, stale)).rejects.toBeInstanceOf(
    PlatformLostFoundScopeChanged,
  );
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
});

test('a session change during pending storage never acknowledges a completed save', async () => {
  let active = true;
  const realSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
    await realSet(key, value);
    active = false;
  });
  await expect(savePlatformLostFoundPending(scope, pending, () => active)).rejects.toBeInstanceOf(
    PlatformLostFoundScopeChanged,
  );
  // The exact intent can be recovered in a later verified session; it is never rerouted to another account.
  expect((await readPlatformLostFoundDeviceState(scope, current)).pending).toEqual(pending);
});

test('storage write failures and missing readback do not imply a saved intent', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(savePlatformLostFoundPending(scope, pending, current)).rejects.toBeInstanceOf(
    PlatformLostFoundStorageError,
  );
  jest.spyOn(AsyncStorage, 'setItem').mockResolvedValueOnce();
  await expect(savePlatformLostFoundPending(scope, pending, current)).rejects.toBeInstanceOf(
    PlatformLostFoundStorageError,
  );
});

test('queued draft changes preserve the newest fields before the mutation is saved', async () => {
  const first = savePlatformLostFoundDraft(scope, draft, current);
  const latest = { ...draft, fields: { ...draft.fields, title: '加了辨識資訊的皮夾' } };
  const second = savePlatformLostFoundDraft(scope, latest, current);
  const intent = { ...pending, input: { ...pending.input, fields: latest.fields } };
  const third = savePlatformLostFoundPending(scope, intent, current);
  await Promise.all([first, second, third]);
  expect(await readPlatformLostFoundDeviceState(scope, current)).toEqual({
    draft: latest,
    pending: intent,
  });
});
