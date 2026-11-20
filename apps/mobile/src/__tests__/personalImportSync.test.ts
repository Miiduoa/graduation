import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PERSONAL_IMPORT_SYNCED,
  PERSONAL_IMPORT_SYNCING,
  PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
  type PersonalImportRow,
  type PersonalImportRecord,
} from '@campus/shared';
import {
  appendPersonalImports,
  deletePersonalImport,
  editPersonalImport,
  loadPersonalImports,
  personalImportStorageKey,
  subscribePersonalImports,
} from '../services/personalImports';
import {
  cancelPersonalImportSync,
  personalImportSyncStatus,
  setPersonalImportSyncEnabled,
  syncPersonalImports,
} from '../services/personalImportSync';
import type { PersonalImportSnapshot } from '@campus/shared/src/imports/sync';
const scope = { owner: 'nuni:pa_11111111-1111-4111-8111-111111111111', schoolId: 'pu' };
const row = (id: string, title = '英文'): PersonalImportRow => ({
  id,
  title,
  kind: 'grades',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  credits: 3,
  grade: '85',
  source: { type: 'paste', line: 1, rawText: title },
});
let remote: PersonalImportSnapshot;
let transport: jest.Mock;
let accepted: Map<string, unknown>;
beforeEach(async () => {
  await AsyncStorage.clear();
  cancelPersonalImportSync(scope);
  remote = { schoolId: 'pu', revision: 0, records: [], updatedAt: null };
  accepted = new Map();
  transport = jest.fn(
    async (
      path: string,
      input: { records?: PersonalImportRecord[]; expectedRevision?: number; mutationId?: string },
    ) => {
      if (path === 'personal-imports/read') return remote;
      expect(path).toBe('personal-imports/write');
      if (accepted.has(input.mutationId!)) {
        expect(accepted.get(input.mutationId!)).toEqual(input);
        return remote;
      }
      if (input.expectedRevision !== remote.revision)
        throw Object.assign(new Error('revision conflict'), {
          code: 'PERSONAL_IMPORT_REVISION_CONFLICT',
        });
      accepted.set(input.mutationId!, JSON.parse(JSON.stringify(input)));
      remote = {
        ...remote,
        revision: remote.revision + 1,
        records: input.records!,
        updatedAt: new Date().toISOString(),
      };
      return remote;
    },
  );
});
const sync = () => syncPersonalImports(scope, transport, () => true);
async function initialize() {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  await sync();
}
test('local-only data never contacts the server before opt-in; legacy/guest scopes cannot sync', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await sync();
  expect(transport).not.toHaveBeenCalled();
  await expect(
    syncPersonalImports({ ...scope, owner: 'guest:device' }, transport, () => true),
  ).rejects.toThrow();
});
test('sync status starts with the syncing sentence and then follows the outcome', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  let resolve!: (value: unknown) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const running = sync();
  while (!resolve) await Promise.resolve();
  expect(personalImportSyncStatus(scope)).toMatchObject({
    running: true,
    message: PERSONAL_IMPORT_SYNCING,
  });
  resolve(remote);
  await running;
  expect(personalImportSyncStatus(scope)).toMatchObject({
    running: false,
    message: PERSONAL_IMPORT_SYNCED,
  });
  transport.mockRejectedValueOnce(new Error('network unavailable'));
  await expect(sync()).rejects.toThrow('network unavailable');
  expect(personalImportSyncStatus(scope)).toMatchObject({
    running: false,
    message: PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
  });
});

test('stores acknowledged base atomically and ordinary local imports preserve sync metadata', async () => {
  await initialize();
  const first = await loadPersonalImports(scope);
  expect(first.sync?.base?.revision).toBe(1);
  expect(first.records).toEqual(remote.records);
  await appendPersonalImports(scope, [row('two', '統計')]);
  const next = await loadPersonalImports(scope);
  expect(next.sync).toEqual(first.sync);
  expect(next.records).toHaveLength(2);
});
test('synchronized record deletion does not reappear from an unchanged remote snapshot', async () => {
  await initialize();
  const first = await loadPersonalImports(scope);
  await deletePersonalImport(scope, first.records[0]);
  await sync();
  await sync();
  expect((await loadPersonalImports(scope)).records).toEqual([]);
  expect(remote.records).toEqual([]);
  expect(remote.revision).toBe(2);
});
test('a local edit queued behind an in-flight synchronization is applied to its latest ledger', async () => {
  await initialize();
  let resolve!: (value: unknown) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const running = sync();
  while (!resolve) await Promise.resolve();
  const append = appendPersonalImports(scope, [row('two', '統計')]);
  resolve(remote);
  await running;
  await append;
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records.map((item) => item.title)).toEqual(['英文', '統計']);
  expect(ledger.sync?.base?.records).toHaveLength(1);
});
test('account switch while reading prevents upload and preserves the original local envelope', async () => {
  await initialize();
  const before = await loadPersonalImports(scope);
  let active = true,
    resolve!: (value: unknown) => void;
  transport.mockClear();
  transport.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const running = syncPersonalImports(scope, transport, () => active);
  const rejected = expect(running).rejects.toThrow('切換');
  while (!resolve) await Promise.resolve();
  active = false;
  resolve(remote);
  await rejected;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await loadPersonalImports(scope)).toEqual(before);
});
test('pause fences an in-flight read before it can write to the account', async () => {
  await initialize();
  let resolve!: (value: unknown) => void;
  transport.mockClear();
  transport.mockImplementationOnce(
    () =>
      new Promise((finish) => {
        resolve = finish;
      }),
  );
  const running = sync();
  const rejected = expect(running).rejects.toThrow('切換');
  while (!resolve) await Promise.resolve();
  const paused = setPersonalImportSyncEnabled(scope, false, () => true);
  resolve(remote);
  await rejected;
  await paused;
  expect((await loadPersonalImports(scope)).sync?.enabled).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
});
test('conflicts preserve local data until explicit choices; stale choices are rejected', async () => {
  await initialize();
  const first = await loadPersonalImports(scope);
  await editPersonalImport(scope, first.records[0], { ...first.records[0], grade: '90' });
  remote = { ...remote, revision: 2, records: [{ ...remote.records[0], grade: '95' }] };
  const result = await sync();
  expect(result.conflicts).toHaveLength(1);
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('90');
  remote = { ...remote, revision: 3 };
  await expect(
    syncPersonalImports(scope, transport, () => true, {
      ...result.review!,
      choices: { [result.conflicts[0].key]: 'remote' },
    }),
  ).rejects.toThrow('又有變更');
  const fresh = await sync();
  await syncPersonalImports(scope, transport, () => true, {
    ...fresh.review!,
    choices: { [fresh.conflicts[0].key]: 'remote' },
  });
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('95');
});
test('network failure preserves records and base, while notifications distinguish local writes from synchronization', async () => {
  await initialize();
  const before = await loadPersonalImports(scope);
  transport.mockRejectedValueOnce(new Error('offline'));
  await expect(sync()).rejects.toThrow('offline');
  expect(await loadPersonalImports(scope)).toEqual(before);
  const sources: string[] = [];
  const stop = subscribePersonalImports((event) => sources.push(event.source));
  await appendPersonalImports(scope, [row('two', '統計')]);
  await sync();
  stop();
  expect(sources[0]).toBe('local');
  expect(sources.slice(1)).toEqual(['sync', 'sync']);
});

test('reload and pause retain the exact pending request and do not resurrect a newer remote deletion', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  const send = transport.getMockImplementation()!;
  transport.mockImplementation(async (path, input) => {
    const result = await send(path, input);
    if (path.endsWith('/write')) throw new Error('ack lost');
    return result;
  });
  await expect(sync()).rejects.toThrow('ack lost');
  const stored = (await AsyncStorage.getItem(personalImportStorageKey(scope)))!;
  const originalPending = JSON.parse(stored).sync.pending;
  expect(originalPending).toBeDefined();
  remote = { ...remote, revision: 2, records: [] };
  cancelPersonalImportSync(scope);
  await AsyncStorage.clear();
  await AsyncStorage.setItem(personalImportStorageKey(scope), stored);
  await setPersonalImportSyncEnabled(scope, false, () => true);
  expect((await loadPersonalImports(scope)).sync?.pending).toEqual(originalPending);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  transport.mockImplementation(send).mockClear();
  await sync();
  expect(transport.mock.calls[0]).toEqual([
    'personal-imports/write',
    { schoolId: 'pu', ...originalPending },
  ]);
  expect((await loadPersonalImports(scope)).records).toEqual([]);
  expect((await loadPersonalImports(scope)).sync?.pending).toBeUndefined();
  expect(remote.revision).toBe(2);
});

test('local changes after an unacknowledged write survive replay and conflict with remote deletion', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  const send = transport.getMockImplementation()!;
  transport.mockImplementation(async (path, input) => {
    const result = await send(path, input);
    if (path.endsWith('/write')) throw new Error('ack lost');
    return result;
  });
  await expect(sync()).rejects.toThrow('ack lost');
  const original = (await loadPersonalImports(scope)).records[0];
  await editPersonalImport(scope, original, { ...original, grade: '99' });
  remote = { ...remote, revision: 2, records: [] };
  transport.mockImplementation(send);
  const result = await sync();
  expect(result.conflicts).toHaveLength(1);
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('99');
  expect((await loadPersonalImports(scope)).sync?.base?.records[0].grade).toBe('85');
  expect(remote.records).toEqual([]);
});

test('a failed pre-send checkpoint prevents upload, while failed ACK persistence recovers from durable pending', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  const write = AsyncStorage.setItem as jest.Mock;
  const original = write.getMockImplementation()!;
  write.mockRejectedValueOnce(new Error('quota'));
  await expect(sync()).rejects.toThrow('quota');
  expect(transport.mock.calls.filter(([path]) => path.endsWith('/write'))).toHaveLength(0);
  expect((await loadPersonalImports(scope)).sync?.pending).toBeUndefined();
  write.mockImplementation(async (key: string, value: string) => {
    const syncState = JSON.parse(value).sync;
    if (syncState?.base && !syncState.pending) throw new Error('quota after ACK');
    return original(key, value);
  });
  try {
    await expect(sync()).rejects.toThrow('quota after ACK');
    expect(remote.revision).toBe(1);
    expect((await loadPersonalImports(scope)).sync?.pending).toBeDefined();
  } finally {
    write.mockImplementation(original);
  }
  remote = { ...remote, revision: 2, records: [] };
  await sync();
  expect((await loadPersonalImports(scope)).records).toEqual([]);
  expect(remote.revision).toBe(2);
});

test('account switch after sending leaves pending durable for a later safe replay', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  let active = true;
  const send = transport.getMockImplementation()!;
  transport.mockImplementation(async (path, input) => {
    const result = await send(path, input);
    if (path.endsWith('/write')) active = false;
    return result;
  });
  await expect(syncPersonalImports(scope, transport, () => active)).rejects.toThrow('切換');
  expect((await loadPersonalImports(scope)).sync?.pending).toBeDefined();
  remote = { ...remote, revision: 2, records: [] };
  transport.mockImplementation(send);
  await sync();
  expect((await loadPersonalImports(scope)).records).toEqual([]);
  expect(remote.revision).toBe(2);
});

test('a pruned or never-accepted pending mutation requires review before adopting account data', async () => {
  await appendPersonalImports(scope, [row('one')]);
  await setPersonalImportSyncEnabled(scope, true, () => true);
  const send = transport.getMockImplementation()!;
  transport.mockImplementation(async (path, input) => {
    const result = await send(path, input);
    if (path.endsWith('/write')) throw new Error('ack lost');
    return result;
  });
  await expect(sync()).rejects.toThrow('ack lost');
  accepted.clear();
  remote = { ...remote, revision: 2, records: [] };
  transport.mockImplementation(send);
  const conflict = await sync();
  expect(conflict.conflicts[0].reason).toBe('unconfirmed');
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  expect((await loadPersonalImports(scope)).sync?.pending).toBeDefined();
  await syncPersonalImports(scope, transport, () => true, {
    ...conflict.review!,
    choices: { [conflict.conflicts[0].key]: 'remote' },
  });
  expect((await loadPersonalImports(scope)).records).toEqual([]);
  expect((await loadPersonalImports(scope)).sync?.pending).toBeUndefined();
  expect(remote.revision).toBe(2);
});
