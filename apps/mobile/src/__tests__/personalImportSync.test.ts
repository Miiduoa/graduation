import AsyncStorage from '@react-native-async-storage/async-storage';
import { type PersonalImportRow, type PersonalImportRecord } from '@campus/shared';
import {
  appendPersonalImports,
  deletePersonalImport,
  editPersonalImport,
  loadPersonalImports,
  subscribePersonalImports,
} from '../services/personalImports';
import {
  cancelPersonalImportSync,
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
beforeEach(async () => {
  await AsyncStorage.clear();
  cancelPersonalImportSync(scope);
  remote = { schoolId: 'pu', revision: 0, records: [], updatedAt: null };
  transport = jest.fn(
    async (
      path: string,
      input: { records?: PersonalImportRecord[]; expectedRevision?: number },
    ) => {
      if (path === 'personal-imports/read') return remote;
      expect(path).toBe('personal-imports/write');
      expect(input.expectedRevision).toBe(remote.revision);
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
  expect(sources).toEqual(['local', 'sync']);
});
