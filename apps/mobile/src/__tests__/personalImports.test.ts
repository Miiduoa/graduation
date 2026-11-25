import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { sha256 } from 'js-sha256';
import {
  PERSONAL_IMPORT_CHANGE,
  readPersonalImports as readWebCalendarImports,
  savePersonalImportBatch as saveWebCalendarBatch,
  withPersonalImportSyncLock as withWebCalendarSyncLock,
} from '../../../web/src/lib/personalImports';
import {
  meetupWindows,
  emptyPersonalEventDraft,
  personalEventRowFromDraft,
  periodProfileForSchool,
  periodTimes,
  planPersonalImport,
  serializePersonalImportBackup,
  parsePersonalImportBackup,
  type PersonalImportRecord,
  type PersonalImportRow,
} from '@campus/shared';
import {
  appendPersonalImports,
  deletePersonalImport,
  snapshotPersonalImports,
  editPersonalImport,
  loadPersonalImports,
  mutatePersonalImportLedger,
  personalImportCourses,
  personalImportStorageKey,
  selectPersonalTimetableCourses,
  subscribePersonalImports,
  undoLastPersonalImport,
} from '../services/personalImports';
import { setPersonalImportSyncEnabled, syncPersonalImports } from '../services/personalImportSync';
import {
  hasWebPersonalImportCommit,
  preparePersonalImportRollback,
  readPersonalImportRollback,
} from '../services/personalImportRollbackJournal';

const scope = { owner: 'nuni:account-a', schoolId: 'pu' };
const row = (id: string, title = '微積分'): PersonalImportRow => ({
  id,
  kind: 'timetable',
  title,
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  dayOfWeek: 1,
  startPeriod: 1,
  endPeriod: 2,
  source: { type: 'paste', line: 1, rawText: '' },
});
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

function useWebStorage() {
  const previousPlatform = Platform.OS;
  Platform.OS = 'web';
  window.localStorage.clear();
  window.sessionStorage.clear();
  // Expo Web's AsyncStorage uses the same localStorage entries as direct reads.
  const getItem = jest.mocked(AsyncStorage.getItem);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const multiGet = jest.mocked(AsyncStorage.multiGet);
  const nativeMultiGet = multiGet.getMockImplementation()!;
  const nativeGet = getItem.getMockImplementation()!;
  const nativeSet = setItem.getMockImplementation()!;
  getItem.mockImplementation(async (key) => window.localStorage.getItem(key));
  setItem.mockImplementation(async (key, value) => window.localStorage.setItem(key, value));
  multiGet.mockImplementation(async (keys) =>
    keys.map((key) => [key, window.localStorage.getItem(key)]));
  return () => {
    multiGet.mockImplementation(nativeMultiGet);
    getItem.mockImplementation(nativeGet);
    setItem.mockImplementation(nativeSet);
    window.localStorage.clear();
    window.sessionStorage.clear();
    Platform.OS = previousPlatform;
  };
}

test('append is durable, duplicate-safe, and isolated by account and school', async () => {
  const first = await appendPersonalImports(scope, [row('a')]);
  expect(first.added).toBe(1);
  const again = await appendPersonalImports(scope, [row('b')]);
  expect(again.added).toBe(0);
  expect(again.duplicates).toBe(1);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  expect((await loadPersonalImports({ ...scope, owner: 'nuni:account-b' })).records).toHaveLength(
    0,
  );
  expect((await loadPersonalImports({ ...scope, schoolId: 'ntu' })).records).toHaveLength(0);
});

test.each(['older ledger', 'null'] as const)('native primary wins over an unbound checkpoint (%s)', async (copy) => {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  await appendPersonalImports(scope, [row('a', '行程 A')]);
  const older = (await AsyncStorage.getItem(key))!;
  const { ledger } = await appendPersonalImports(scope, [row('b', '行程 B')]);
  await AsyncStorage.setItem(checkpoint, copy === 'null' ? 'null' : older);

  await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
  await appendPersonalImports(scope, [row('c', '行程 C')]);
  expect(JSON.parse((await AsyncStorage.getItem(key))!).records.map(({ title }: PersonalImportRecord) => title))
    .toEqual(['行程 A', '行程 B', '行程 C']);
});

test.each(['native', 'web', 'web compact commit'] as const)(
  '%s preserves readable primary records and recovery copies when sync is damaged',
  async (format) => {
    const restoreStorage = format === 'native' ? undefined : useWebStorage();
    try {
      const key = personalImportStorageKey(scope);
      const checkpoint = key + ':checkpoint';
      const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
      await appendPersonalImports(scope, [row('a', '行程 A')]);
      const older = (await AsyncStorage.getItem(key))!;
      const { ledger: { version, ...body } } = await appendPersonalImports(scope, [row('b', '行程 B')]);
      const primary = JSON.stringify({
        ...(format === 'web compact commit' ? { $commit: version } : { version }),
        ...body,
        sync: { enabled: 'invalid', base: null },
      });
      await AsyncStorage.setItem(key, primary);
      await AsyncStorage.setItem(checkpoint, older);
      const staleJournal = JSON.stringify({
        id: 'stale',
        before: sha256(older),
        attempted: sha256(JSON.stringify({ version, ...body })),
        original: older,
      });
      if (format === 'web compact commit') window.localStorage.setItem(journal, staleJournal);

      await expect(loadPersonalImports(scope)).rejects.toThrow('同步紀錄無法讀取');
      await expect(appendPersonalImports(scope, [row('c', '行程 C')])).rejects.toThrow('同步紀錄無法讀取');
      expect(await AsyncStorage.getItem(key)).toBe(primary);
      expect(await AsyncStorage.getItem(checkpoint)).toBe(older);
      if (format === 'web compact commit') expect(window.localStorage.getItem(journal)).toBe(staleJournal);
    } finally {
      restoreStorage?.();
    }
  },
);

test.each([false, true])('protected native save preserves an unadopted checkpoint (revoked: %s)', async (revoked) => {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  await appendPersonalImports(scope, [row('a', '行程 A')]);
  const original = (await AsyncStorage.getItem(key))!;
  await appendPersonalImports(scope, [row('d', '行程 D')]);
  const backup = (await AsyncStorage.getItem(key))!;
  await AsyncStorage.setItem(checkpoint, backup);
  await AsyncStorage.setItem(key, original);
  const { ledger } = await appendPersonalImports(scope, [row('b', '行程 B')]);
  let verified = true;

  if (revoked) {
    const setItem = jest.mocked(AsyncStorage.setItem);
    const nativeSetItem = setItem.getMockImplementation()!;
    setItem.mockImplementationOnce(async (entry, value) => {
      await nativeSetItem(entry, value);
      verified = false;
    });
  }

  const write = appendPersonalImports(scope, [row('c', '行程 C')], {
    canContinue: () => true,
    canCommitFirstWrite: () => verified,
  });
  if (revoked) {
    await expect(write).rejects.toThrow('目前無法確認行事曆可寫入');
    expect(await loadPersonalImports(scope)).toEqual(ledger);
  } else {
    await write;
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
      .toEqual(['行程 A', '行程 B', '行程 C']);
  }
  expect(await AsyncStorage.getItem(checkpoint)).toBe(backup);
});

test.each([false, true])('native keeps an adopted checkpoint after an unreadable commit (rollback read fails: %s)', async (rollbackReadFails) => {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const { ledger } = await appendPersonalImports(scope, [row('a', '行程 A')]);
  const original = (await AsyncStorage.getItem(key))!;
  await AsyncStorage.setItem(checkpoint, original);
  await AsyncStorage.removeItem(key);

  const getItem = jest.mocked(AsyncStorage.getItem);
  const nativeGet = getItem.getMockImplementation()!;
  const rowLimitError = new Error('Row too big to fit into CursorWindow');
  let readbackFailed = false;
  getItem.mockImplementation(async (entry) => {
    const raw = await nativeGet(entry);
    if (entry === key && raw && (raw.length > original.length || (readbackFailed && rollbackReadFails))) {
      readbackFailed = true;
      throw rowLimitError;
    }
    return raw;
  });
  try {
    await expect(appendPersonalImports(scope, [row('c', '行程 C')])).rejects.toBe(rowLimitError);
    expect(await AsyncStorage.getItem(checkpoint)).toBe(original);
    expect(readPersonalImportRollback(key)).toBe(rollbackReadFails ? original : undefined);
    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
  } finally {
    getItem.mockImplementation(nativeGet);
  }

  await appendPersonalImports(scope, [row('c', '行程 C')]);
  expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
    .toEqual(['行程 A', '行程 C']);
});

test.each([false, true])('native checkpoint cleanup keeps restart recovery until authority is confirmed (revoked: %s)', async (revoked) => {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  await appendPersonalImports(scope, [row('a', '行程 A')]);
  const original = (await AsyncStorage.getItem(key))!;
  await AsyncStorage.setItem(checkpoint, original);
  await AsyncStorage.removeItem(key);

  const remove = jest.mocked(AsyncStorage.multiRemove);
  const nativeRemove = remove.getMockImplementation()!;
  const get = jest.mocked(AsyncStorage.getItem);
  const nativeGet = get.getMockImplementation()!;
  const rollbackReadError = new Error('Row too big to fit into CursorWindow');
  const rebuildCheckpoint = jest.fn().mockRejectedValue(new Error('無法重建檢查點'));
  const multiSet = jest.mocked(AsyncStorage.multiSet);
  const nativeMultiSet = multiSet.getMockImplementation()!;
  let active = true;
  let restartedLedger: Awaited<ReturnType<typeof loadPersonalImports>> | undefined;
  let journalDuringCleanup: string | undefined;
  get.mockImplementation(async (entry) => {
    const raw = await nativeGet(entry);
    if (entry === key && !active && raw === original) throw rollbackReadError;
    return raw;
  });
  multiSet.mockImplementation((entries, callback) => {
    if (entries.some(([entry]) => entry === checkpoint)) return rebuildCheckpoint(entries);
    return nativeMultiSet(entries, callback);
  });
  remove.mockImplementationOnce(async (entries) => {
    await nativeRemove(entries);
    if (revoked) active = false;
    journalDuringCleanup = readPersonalImportRollback(key);
    // Reload the service without the original process's locks or pending rollback state.
    await jest.isolateModulesAsync(async () => {
      const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
      restartedLedger = await restarted.loadPersonalImports(scope);
    });
  });
  try {
    const write = appendPersonalImports(scope, [row('c', '行程 C')], { canContinue: () => active });
    if (revoked) {
      await expect(write).rejects.toBe(rollbackReadError);
      expect(rebuildCheckpoint).toHaveBeenCalled();
      expect(readPersonalImportRollback(key)).toBe(original);
    } else {
      await expect(write).resolves.toMatchObject({ added: 1 });
      expect(rebuildCheckpoint).not.toHaveBeenCalled();
      expect(readPersonalImportRollback(key)).toBeUndefined();
    }
    expect(remove).toHaveBeenCalledWith([checkpoint]);
    expect(journalDuringCleanup).toBe(original);
    expect(restartedLedger?.records.map(({ title }) => title)).toEqual(['行程 A']);
    expect(await AsyncStorage.getItem(checkpoint)).toBeNull();
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
      .toEqual(revoked ? ['行程 A'] : ['行程 A', '行程 C']);
  } finally {
    get.mockImplementation(nativeGet);
    multiSet.mockImplementation(nativeMultiSet);
  }
});

test.each(['read', 'remove'] as const)('native preserves and publishes a verified commit when checkpoint cleanup fails during %s', async (failure) => {
  const scope = { owner: `nuni:checkpoint-cleanup-${failure}`, schoolId: 'pu' };
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  await appendPersonalImports(scope, [row('a', '原有行程')]);
  const original = (await AsyncStorage.getItem(key))!;
  await AsyncStorage.setItem(checkpoint, original);
  await AsyncStorage.removeItem(key);

  const ioError = new Error('檢查點 I/O 失敗');
  const get = jest.mocked(AsyncStorage.getItem);
  const nativeGet = get.getMockImplementation()!;
  let checkpointReads = 0;
  if (failure === 'read') {
    get.mockImplementation(async (entry) => {
      if (entry === checkpoint && ++checkpointReads === 2) throw ioError;
      return nativeGet(entry);
    });
  } else {
    jest.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(ioError);
  }
  const listener = jest.fn();
  const unsubscribe = subscribePersonalImports(listener);
  const append = () => appendPersonalImports(scope, [row('b', '新增行程')], { canContinue: () => true });
  try {
    const { ledger } = await append();
    expect(ledger.records.map(({ title }) => title)).toEqual(['原有行程', '新增行程']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(ledger));
    expect(await AsyncStorage.getItem(checkpoint)).toBe(original);
    expect(readPersonalImportRollback(key)).toBeUndefined();
    expect(new File(Paths.document, `personal-imports-${sha256(key)}.rollback.pending`).info().exists).toBe(true);
    await jest.isolateModulesAsync(async () => {
      const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
      await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
    });
  } finally {
    get.mockImplementation(nativeGet);
    unsubscribe();
  }
});

test.each([false, true])('native marker deletion I/O preserves the correct ledger after restart (revoked: %s)', async (revoked) => {
  const scope = { owner: `nuni:marker-cleanup-${revoked}`, schoolId: 'pu' };
  const key = personalImportStorageKey(scope);
  const { ledger: previous } = await appendPersonalImports(scope, [row('original')]);
  const original = (await AsyncStorage.getItem(key))!;
  const deleteFile = File.prototype.delete;
  let active = true;
  const remove = jest.spyOn(File.prototype, 'delete').mockImplementation(function (this: File) {
    if (this.uri.endsWith('.rollback.pending')) {
      if (revoked) active = false;
      throw new Error('還原標記刪除 I/O 失敗');
    }
    deleteFile.call(this);
  });
  const reread = jest.fn(() => loadPersonalImports(scope));
  const unsubscribe = subscribePersonalImports(reread);
  try {
    const guard = { canContinue: () => active };
    const append = appendPersonalImports(scope, [row('new', '統計')], guard);
    let expected = previous;
    if (revoked) {
      await expect(append).rejects.toThrow('帳號或學校已切換');
      expect(reread).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(key)).toBe(original);
      expect(readPersonalImportRollback(key)).toBe(original);
      await AsyncStorage.removeItem(key);
    } else {
      const { ledger } = await append;
      expected = ledger;
      expect(ledger.records.map(({ title }) => title)).toEqual(['微積分', '統計']);
      expect(reread).toHaveBeenCalledTimes(1);
      await expect(reread.mock.results[0].value).resolves.toEqual(ledger);
      expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(ledger));
    }
    expect(remove).toHaveBeenCalledTimes(1);
    const prefix = `personal-imports-${sha256(key)}`;
    expect(new File(Paths.document, prefix + '.rollback.pending').info().exists).toBe(true);
    expect(new File(Paths.document, prefix + '.rollback.json').textSync()).toBe(original);
    await jest.isolateModulesAsync(async () => {
      const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
      await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(expected);
      if (!revoked) {
        const { ledger } = await restarted.appendPersonalImports(scope, [row('later', '物理')], guard);
        expect(ledger.records.map(({ title }) => title)).toEqual(['微積分', '統計', '物理']);
        await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
      }
    });
  } finally {
    unsubscribe();
    remove.mockRestore();
  }
});

test.each([
  ['write', false], ['readback', false], ['write', true], ['readback', true],
  ['all', false], ['all', true], ['publish', true],
  ['all with primary write error', false], ['all with primary readback error', false],
  ['readback without retirement file', false],
] as const)('native marker retirement %s I/O keeps the correct primary and notification (revoked: %s)', async (phase, revoked) => {
  const scope = { owner: `nuni:retirement-${phase}-${revoked}`, schoolId: 'pu' };
  const key = personalImportStorageKey(scope);
  const { ledger: previous } = await appendPersonalImports(scope, [row('original')]);
  const markerUri = new File(Paths.document, `personal-imports-${sha256(key)}.rollback.pending`).uri;
  const { create: createFile, delete: deleteFile, write: writeFile, textSync } = File.prototype;
  let active = true;
  let retirementAttempts = 0;
  const set = jest.mocked(AsyncStorage.setItem);
  const get = jest.mocked(AsyncStorage.getItem);
  const nativeSet = set.getMockImplementation()!;
  const nativeGet = get.getMockImplementation()!;
  const markerReadFails = phase === 'readback' || phase === 'readback without retirement file';
  const noRetirementFile = phase !== 'write' && phase !== 'readback';
  const primaryFault = jest.fn(() => { throw new Error('提交編碼主鍵 I/O 失敗'); });
  let encodedWrite = false;
  const restoreError = new Error('主鍵無法還原');
  if (phase === 'publish' || phase.startsWith('all with primary')) {
    set.mockImplementation(async (entry, value) => {
      if (entry !== key) return nativeSet(entry, value);
      if (!active) throw restoreError;
      encodedWrite = value.startsWith('{"batches":');
      if (encodedWrite && phase === 'all with primary write error') primaryFault();
      await nativeSet(entry, value);
      if (encodedWrite && phase === 'publish') active = false;
    });
  }
  if (phase === 'all with primary readback error') {
    get.mockImplementation(async (entry) => {
      if (entry === key && encodedWrite && primaryFault.mock.calls.length === 0) primaryFault();
      return nativeGet(entry);
    });
  }
  const create = jest.spyOn(File.prototype, 'create').mockImplementation(function (this: File, options) {
    if (noRetirementFile && this.uri.endsWith('.rollback.committed')) {
      if (phase === 'all' && revoked) active = false;
      throw new Error('備用退役檔無法建立');
    }
    createFile.call(this, options);
  });
  const remove = jest.spyOn(File.prototype, 'delete').mockImplementation(function (this: File) {
    if (this.uri === markerUri) throw new Error('標記無法刪除');
    deleteFile.call(this);
  });
  const write = jest.spyOn(File.prototype, 'write').mockImplementation(function (this: File, value, options) {
    if (!markerReadFails && this.uri === markerUri && value === 'committed') {
      retirementAttempts++;
      if (phase === 'write' && revoked) active = false;
      throw new Error('標記無法更新');
    }
    writeFile.call(this, value, options);
  });
  const read = jest.spyOn(File.prototype, 'textSync').mockImplementation(function (this: File) {
    const value = textSync.call(this);
    if (markerReadFails && this.uri === markerUri && value === 'committed') {
      retirementAttempts++;
      if (revoked) active = false;
      throw new Error('更新後的標記無法讀回');
    }
    return value;
  });
  const reread = jest.fn(() => loadPersonalImports(scope));
  const unsubscribe = subscribePersonalImports(reread);
  try {
    const append = appendPersonalImports(scope, [row('new', '統計')], { canContinue: () => active });
    let expected = previous;
    if (revoked) {
      await expect(append).rejects.toThrow(phase === 'publish' ? restoreError : '帳號或學校已切換');
      expect(reread).not.toHaveBeenCalled();
      expect(readPersonalImportRollback(key)).toBe(JSON.stringify(previous));
      if (phase === 'publish') {
        expect(JSON.parse((await AsyncStorage.getItem(key))!).records.map(({ title }: PersonalImportRecord) => title))
          .toEqual(['微積分', '統計']);
      } else {
        expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(previous));
        await AsyncStorage.removeItem(key);
      }
    } else {
      expected = (await append).ledger;
      expect(expected.records.map(({ title }) => title)).toEqual(['微積分', '統計']);
      const primary = (await AsyncStorage.getItem(key))!;
      if (noRetirementFile) {
        expect(JSON.parse(primary)).toEqual(expected);
        expect(Buffer.byteLength(primary)).toBe(Buffer.byteLength(JSON.stringify(expected)));
        expect(create.mock.contexts.map((file: File) => file.uri)).toContain(
          new File(Paths.document, `personal-imports-${sha256(key)}.rollback.committed`).uri,
        );
        if (!markerReadFails) expect(readPersonalImportRollback(key)).toBe(JSON.stringify(previous));
      } else {
        expect(primary).toBe(JSON.stringify(expected));
      }
      expect(reread).toHaveBeenCalledTimes(1);
      await expect(reread.mock.results[0].value).resolves.toEqual(expected);
    }
    if (phase === 'readback without retirement file') {
      expect(retirementAttempts).toBeGreaterThan(1);
    } else {
      expect(retirementAttempts).toBe(1);
    }
    if (phase.startsWith('all with primary')) expect(primaryFault).toHaveBeenCalledTimes(1);
    await jest.isolateModulesAsync(async () => {
      const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
      await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(expected);
      if ((phase === 'all' || phase === 'all with primary write error') && !revoked) {
        set.mockImplementation(nativeSet);
        const { ledger } = await restarted.appendPersonalImports(scope, [row('later', '物理')]);
        await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
        expected = ledger;
      }
    });
    if ((phase === 'all' || phase === 'all with primary write error') && !revoked) {
      await jest.isolateModulesAsync(async () => {
        const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
        await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(expected);
      });
    }
  } finally {
    unsubscribe();
    read.mockRestore();
    write.mockRestore();
    remove.mockRestore();
    create.mockRestore();
    set.mockImplementation(nativeSet);
    get.mockImplementation(nativeGet);
  }
});

test.each([true, false])('native restart reads a valid journal despite persistent checkpoint I/O (restored primary: %s)', async (restored) => {
  const scope = { owner: 'nuni:checkpoint-io-restart', schoolId: 'pu' };
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const original = (await AsyncStorage.getItem(key))!;
  await AsyncStorage.setItem(checkpoint, original);
  const { retire: clearJournal } = preparePersonalImportRollback(key, original);
  if (!restored) await AsyncStorage.removeItem(key);
  const multiGet = jest.mocked(AsyncStorage.multiGet);
  const nativeMultiGet = multiGet.getMockImplementation()!;
  multiGet.mockImplementation(async (keys) => {
    if (keys.includes(checkpoint)) throw new Error('檢查點 I/O 失敗');
    return nativeMultiGet(keys);
  });
  try {
    await jest.isolateModulesAsync(async () => {
      const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
      await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
      await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
    });
    expect(await AsyncStorage.getItem(key)).toBe(restored ? original : null);
    expect(readPersonalImportRollback(key)).toBe(original);
  } finally {
    multiGet.mockImplementation(nativeMultiGet);
    clearJournal();
  }
});

test.each([
  ['Web', 'read'],
  ['Web', 'remove'],
  ['Expo Web', 'read'],
  ['Expo Web', 'remove'],
] as const)('%s publishes and notifies when recovery cleanup cannot %s', async (client, failure) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const listener = jest.fn();
  const unsubscribe = subscribePersonalImports(listener);
  window.addEventListener(PERSONAL_IMPORT_CHANGE, listener);
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    listener.mockClear();
    const original = JSON.stringify(ledger);
    storage.setItem(checkpoint, original);
    storage.removeItem(key);
    const getItem = Storage.prototype.getItem;
    const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, entry) {
      if (failure === 'read' && this === storage && entry === checkpoint && getItem.call(this, key) !== null) {
        throw new Error('無法讀取檢查點');
      }
      return getItem.call(this, entry);
    });
    const removeItem = Storage.prototype.removeItem;
    const remove = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, entry) {
      if (failure === 'remove' && this === storage && entry === checkpoint) throw new Error('無法刪除檢查點');
      return removeItem.call(this, entry);
    });
    try {
      const append = client === 'Web' ? saveWebCalendarBatch : appendPersonalImports;
      await expect(append(scope, [row('new', '統計')])).resolves.toMatchObject({ added: 1 });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
      remove.mockRestore();
    }
    expect(storage.getItem(checkpoint)).toBe(original);
    expect(readWebCalendarImports(scope).map(({ title }) => title)).toEqual(['微積分', '統計']);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['微積分', '統計']);
  } finally {
    unsubscribe();
    window.removeEventListener(PERSONAL_IMPORT_CHANGE, listener);
    restoreLocks();
    cleanup();
  }
});

test.each([
  ['Web', 'checkpoint'],
  ['Web', 'journal'],
  ['Expo Web', 'checkpoint'],
  ['Expo Web', 'journal'],
] as const)('%s rereads and saves again while the %s is still unreadable', async (client, source) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const recoveryKey = source === 'checkpoint'
    ? key + ':checkpoint'
    : `campus.personal-imports.rollback.v1:${sha256(key)}`;
  const getItem = Storage.prototype.getItem;
  let published = false;
  const reread = jest.fn(() => client === 'Web'
    ? Promise.resolve().then(() => readWebCalendarImports(scope))
    : loadPersonalImports(scope).then(({ records }) => records));
  let unsubscribe: (() => void) | undefined;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const original = JSON.stringify(ledger);
    if (source === 'checkpoint') storage.removeItem(key);
    const recoveryCopy = source === 'checkpoint' ? original : JSON.stringify({
      id: 'interrupted',
      original,
      before: sha256(original),
      attempted: sha256('null'),
    });
    if (source === 'journal') storage.setItem(key, original);
    storage.setItem(recoveryKey, recoveryCopy);
    if (client === 'Web') window.addEventListener(PERSONAL_IMPORT_CHANGE, reread);
    else unsubscribe = subscribePersonalImports(reread);
    const setItem = Storage.prototype.setItem;
    const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, entry, value) {
      setItem.call(this, entry, value);
      if (this === storage && entry === key) published = true;
    });
    const read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, entry) {
      if (published && this === storage && entry === recoveryKey) throw new Error('復原副本持續無法讀取');
      return getItem.call(this, entry);
    });
    try {
      const append = client === 'Web' ? saveWebCalendarBatch : appendPersonalImports;
      await expect(append(scope, [row('new', '統計')])).resolves.toMatchObject({ added: 1 });
      expect(reread).toHaveBeenCalledTimes(1);
      const records = await reread.mock.results[0].value;
      expect(records.map(({ title }) => title)).toEqual(['微積分', '統計']);
      await expect(append(scope, [row('later', '物理')])).resolves.toMatchObject({ added: 1 });
      expect(reread).toHaveBeenCalledTimes(2);
      const updated = await reread.mock.results[1].value;
      expect(updated.map(({ title }) => title)).toEqual(['微積分', '統計', '物理']);
      expect(getItem.call(storage, recoveryKey)).toBe(recoveryCopy);
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  } finally {
    unsubscribe?.();
    window.removeEventListener(PERSONAL_IMPORT_CHANGE, reread);
    restoreLocks();
    cleanup();
  }
});

test.each(['Web', 'Expo Web'] as const)('%s keeps a commit readable when it would match a retained journal fingerprint', async (client) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const original = JSON.stringify(ledger);
    const sync = { enabled: true, base: null };
    const batches = client === 'Web' ? ledger.batches : [];
    const attempted = JSON.stringify({ records: [], sync, batches, version: 1 });
    const copy = JSON.stringify({ id: 'legacy', original, before: sha256(original), attempted: sha256(attempted) });
    storage.setItem(key, attempted);
    storage.setItem(journal, copy);
    const setItem = Storage.prototype.setItem;
    const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, entry, value) {
      if (entry === key && JSON.parse(value).webCommit) throw new DOMException('quota', 'QuotaExceededError');
      return setItem.call(this, entry, value);
    });
    const removeItem = Storage.prototype.removeItem;
    const remove = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, entry) {
      if (this === storage && entry === journal) throw new Error('無法刪除日誌');
      return removeItem.call(this, entry);
    });
    try {
      if (client === 'Web') {
        await withWebCalendarSyncLock(scope, async (state) => {
          expect(state.records).toEqual(ledger.records);
          return { state: { records: [], sync }, result: undefined };
        });
      } else {
        await mutatePersonalImportLedger(scope, { canContinue: () => true }, (current) => {
          expect(current.records).toEqual(ledger.records);
          return { ledger: { version: 1, records: [], sync, batches: [] }, result: undefined };
        });
      }
    } finally {
      write.mockRestore();
      remove.mockRestore();
    }
    expect(storage.getItem(journal)).toBe(copy);
    expect(storage.getItem(key)).not.toBe(attempted);
    expect(storage.getItem(key)).toHaveLength(attempted.length);
    expect(readWebCalendarImports(scope)).toEqual([]);
    expect((await loadPersonalImports(scope)).records).toEqual([]);
  } finally {
    restoreLocks();
    cleanup();
  }
});

test.each([true, false])('Expo Web only replays pending sync from a current recovery snapshot (replaced: %s)', async (replaced) => {
  const syncScope = { ...scope, owner: 'nuni:pa_11111111-1111-4111-8111-111111111111' };
  const key = personalImportStorageKey(syncScope);
  const checkpoint = key + ':checkpoint';
  const cleanup = useWebStorage();
  const storage = window.localStorage;
  const getItem = Storage.prototype.getItem;
  let getSpy: jest.SpyInstance | undefined;
  try {
    const { ledger } = await appendPersonalImports(syncScope, [row('a')]);
    storage.removeItem(key);
    const pending = { mutationId: 'recovered-pending', expectedRevision: 0, records: ledger.records };
    const recovery = JSON.stringify({ ...ledger, sync: { enabled: true, base: null, pending } });
    const replacement = JSON.stringify({ version: 1, records: [], batches: [] });
    storage.setItem(checkpoint, recovery);
    if (replaced) {
      getSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, storageKey) {
        const raw = getItem.call(this, storageKey);
        if (this === storage && storageKey === checkpoint && raw === recovery) {
          storage.setItem(checkpoint, replacement);
        }
        return raw;
      });
    }
    const transport = jest.fn(async () => ({
      schoolId: syncScope.schoolId, revision: 1, records: ledger.records, updatedAt: '2026-11-25T00:00:00.000Z',
    }));
    const run = syncPersonalImports(syncScope, transport, () => true);
    if (replaced) {
      await expect(run).rejects.toThrow('匯入資料已在另一個分頁更新');
      expect(transport).not.toHaveBeenCalled();
      expect(storage.getItem(key)).toBeNull();
      expect(storage.getItem(checkpoint)).toBe(replacement);
    } else {
      await run;
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledWith('personal-imports/write', { schoolId: syncScope.schoolId, ...pending });
      expect(JSON.parse(storage.getItem(key)!).batches).toEqual(ledger.batches);
      expect(storage.getItem(checkpoint)).toBeNull();
    }
  } finally {
    getSpy?.mockRestore();
    cleanup();
  }
});

test('Web reads an existing ledger without touching the unsupported Expo document directory', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const originalPlatform = Platform.OS;
  const document = Object.getOwnPropertyDescriptor(Paths, 'document')!;
  Platform.OS = 'web';
  Object.defineProperty(Paths, 'document', {
    get: () => { throw new TypeError('this.validatePath is not a function'); },
  });
  try {
    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
    await expect(snapshotPersonalImports(scope)).resolves.toEqual(ledger);
  } finally {
    Platform.OS = originalPlatform;
    Object.defineProperty(Paths, 'document', document);
  }
});

describe.each(['Web Locks', 'IndexedDB'])('Expo Web with %s at sessionStorage quota', (lock) => {
  test.each(['first append', 'growing edit', 'growing edit beyond local quota'])(
    '%s tries the primary write',
    async (scenario) => {
      const cleanup = useWebStorage();
      const restoreLocks = withoutWebWriteLocks();
      const request = jest.fn(async (_key: string, write: () => unknown) => write());
      const database = lock === 'IndexedDB' ? useIndexedDBLocks() : undefined;
      if (!database) {
        Object.defineProperty(navigator, 'locks', {
          configurable: true,
          value: { request },
        });
      }
      const storage = window.localStorage;
      const key = personalImportStorageKey(scope);
      const guard = { canContinue: () => true };
      const longerTitle = '延長後的課程名稱'.repeat(24);
      try {
        const initial = scenario === 'first append'
          ? undefined
          : (await appendPersonalImports(scope, [row('original')])).ledger;
        const before = storage.getItem(key);
        const setItem = Storage.prototype.setItem;
        const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
        const stageWrite = jest.fn();
        const primaryWrite = jest.fn();
        const quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
          this: Storage, entry, value,
        ) {
          if (this === window.sessionStorage) {
            stageWrite();
            throw new DOMException('Session quota exceeded', 'QuotaExceededError');
          }
          if (this === storage && entry === key) {
            primaryWrite(value);
            if (scenario === 'growing edit beyond local quota' && value.length > before!.length) {
              throw quotaError;
            }
          }
          setItem.call(this, entry, value);
        });
        try {
          const write = initial
            ? editPersonalImport(scope, initial.records[0], row('original', longerTitle), guard)
            : appendPersonalImports(scope, [row('first')], guard).then(({ ledger }) => ledger);
          if (scenario === 'growing edit beyond local quota') {
            await expect(write).rejects.toBe(quotaError);
            expect(storage.getItem(key)).toBe(before);
            await expect(loadPersonalImports(scope)).resolves.toEqual(initial);
          } else {
            const ledger = await write;
            const published = storage.getItem(key)!;
            expect(published.length).toBeGreaterThan(before?.length ?? 0);
            expect(JSON.parse(published).version).toBe(1);
            expect(ledger.records.map(({ title }) => title)).toEqual([
              initial ? longerTitle : '微積分',
            ]);
            await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
          }
          expect(stageWrite).toHaveBeenCalledTimes(1);
          expect(primaryWrite).toHaveBeenCalled();
          expect(Object.keys(window.sessionStorage)).toEqual([]);
          expect(Object.keys(storage)).toEqual([key]);
          if (database) expect(database.open).toHaveBeenCalled();
          else expect(request).toHaveBeenCalledWith(key, expect.any(Function));
        } finally {
          quota.mockRestore();
        }
      } finally {
        database?.restore();
        restoreLocks();
        cleanup();
      }
    },
  );
});

function useIndexedDBLocks() {
  const transactions = new Map<string, { abort: () => void }>();
  const queues = new Map<string, Promise<void>>();
  // Model IndexedDB's readwrite scheduling at database/object-store scope.
  const open = jest.fn((name: string) => {
    const request = {
      onsuccess: () => {},
      result: {
        close: jest.fn(),
        transaction: (storeName: string) => {
          const queueKey = JSON.stringify([name, storeName]);
          const previous = queues.get(queueKey) ?? Promise.resolve();
          let release!: () => void;
          const own = new Promise<void>((resolve) => { release = resolve; });
          queues.set(queueKey, previous.then(() => own));
          let pending = 0;
          let aborted = false;
          const transaction = {
            error: new DOMException('交易中止', 'AbortError'),
            oncomplete: () => {},
            onabort: () => {},
            abort: () => {
              if (aborted) return;
              aborted = true;
              release();
              transaction.onabort();
            },
            objectStore: () => ({
              get: () => {
                const read = { onsuccess: () => {} };
                pending += 1;
                void previous.then(() => setTimeout(() => {
                  if (aborted) return;
                  pending -= 1;
                  read.onsuccess();
                  if (pending === 0) {
                    release();
                    transaction.oncomplete();
                  }
                }, 0));
                return read;
              },
            }),
          };
          transactions.set(name, transaction);
          return transaction;
        },
      },
    };
    void Promise.resolve().then(() => request.onsuccess());
    return request;
  });
  const indexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open } });
  return {
    open,
    abort: (key: string) => transactions.get(`campus.personal-imports.locks:${sha256(key)}`)!.abort(),
    restore: () => {
      if (indexedDB) Object.defineProperty(globalThis, 'indexedDB', indexedDB);
      else Reflect.deleteProperty(globalThis, 'indexedDB');
    },
  };
}

test('Web IndexedDB locks isolate account and school ledgers while a mutation waits', async () => {
  const cleanup = useWebStorage();
  const { open, restore } = useIndexedDBLocks();
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const slow = mutatePersonalImportLedger(scope, () => true, async (ledger) => {
    signalStarted();
    await paused;
    return { ledger, result: undefined };
  });
  let writes: Promise<unknown>[] = [];
  let sameLedgerWrite: Promise<unknown> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await started;
    const guard = { canContinue: () => true };
    let otherTab!: typeof import('../services/personalImports');
    jest.isolateModules(() => {
      otherTab = require('../services/personalImports');
    });
    const enterSameLedger = jest.fn(() => true);
    sameLedgerWrite = otherTab.appendPersonalImports(scope, [row('same-ledger')], {
      canContinue: enterSameLedger,
    });
    writes = [
      { ...scope, owner: 'nuni:account-b' },
      { ...scope, schoolId: 'ntu' },
    ].map(async (otherScope) => {
      const { ledger } = await appendPersonalImports(otherScope, [
        { ...row('new'), schoolId: otherScope.schoolId },
      ], guard);
      const [original] = ledger.records;
      const edited = await editPersonalImport(otherScope, original, { ...original, title: '統計' }, guard);
      expect(edited.records[0].title).toBe('統計');
    });
    await Promise.race([
      Promise.all(writes),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('其他帳本的儲存被阻塞')), 1000);
      }),
    ]);
    expect(new Set(open.mock.calls.map(([name]) => name)).size).toBe(3);
    expect(enterSameLedger).not.toHaveBeenCalled();
    resume();
    await expect(sameLedgerWrite).resolves.toMatchObject({ added: 1 });
  } finally {
    clearTimeout(timeout);
    resume();
    await Promise.allSettled([slow, sameLedgerWrite, ...writes]);
    restore();
    cleanup();
  }
});

test('IndexedDB reclaims an old full stage from another ledger while keeping its active writer’s stage', async () => {
  const cleanup = useWebStorage();
  const { restore } = useIndexedDBLocks();
  const storage = window.localStorage;
  const stage = (owner: string) => {
    const key = personalImportStorageKey({ ...scope, owner });
    return `campus.personal-imports.rollback.v1:${sha256(key)}:stage:${Date.now()}:test`;
  };
  const orphan = stage('nuni:closed-tab');
  const active = stage(scope.owner);
  const guard = { canContinue: () => true };
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const writer = mutatePersonalImportLedger(scope, guard, async (ledger) => {
    storage.setItem(active, JSON.stringify(ledger));
    signalStarted();
    await paused;
    expect(storage.getItem(active)).not.toBeNull();
    storage.removeItem(active);
    return { ledger, result: undefined };
  });
  try {
    await started;
    const { ledger } = await appendPersonalImports({ ...scope, owner: 'nuni:other' }, [row('original')]);
    storage.setItem(orphan, JSON.stringify({ original: JSON.stringify(ledger) }));
    const write = Storage.prototype.setItem;
    const quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, key, value,
    ) {
      if (storage.getItem(orphan)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      write.call(this, key, value);
    });
    try {
      await expect(editPersonalImport({ ...scope, owner: 'nuni:other' }, ledger.records[0], row('original', '重試成功'), guard))
        .resolves.toMatchObject({ records: [{ title: '重試成功' }] });
      expect(storage.getItem(orphan)).toBeNull();
      expect(storage.getItem(active)).not.toBeNull();
    } finally {
      quota.mockRestore();
    }
  } finally {
    resume();
    try {
      await writer;
    } finally {
      restore();
      cleanup();
    }
  }
});

function withoutWebWriteLocks() {
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const database = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
  return () => {
    if (locks) Object.defineProperty(navigator, 'locks', locks);
    else Reflect.deleteProperty(navigator, 'locks');
    if (database) Object.defineProperty(globalThis, 'indexedDB', database);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  };
}

const webLeasePrefix = (key: string) => `campus.personal-imports.write.v1:${sha256(key)}:`;
const legacyWebStage = (key: string, id: string) =>
  `campus.personal-imports.rollback.v1:${sha256(key)}:stage:${Date.now()}:${id}`;

test.each(['Web Locks', 'IndexedDB', 'lease'] as const)(
  'Expo Web adds, edits, and syncs with persistently unreadable legacy stages (%s)',
  async (lock) => {
    const cleanup = useWebStorage();
    const restoreLocks = withoutWebWriteLocks();
    const database = lock === 'IndexedDB' ? useIndexedDBLocks() : undefined;
    if (lock === 'Web Locks') {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: async (_key: string, write: () => unknown) => write() },
      });
    }
    const syncScope = { ...scope, owner: 'nuni:pa_00000000-0000-4000-a000-000000000001' };
    const key = personalImportStorageKey(syncScope);
    const storage = window.localStorage;
    const stages = [
      legacyWebStage(key, 'same-ledger'),
      legacyWebStage(personalImportStorageKey({ owner: 'nuni:other', schoolId: 'ntu' }), 'other-ledger'),
    ];
    const getItem = Storage.prototype.getItem;
    let read: jest.SpyInstance | undefined;
    const reread = jest.fn(() => loadPersonalImports(syncScope));
    let unsubscribe: (() => void) | undefined;
    try {
      await appendPersonalImports(syncScope, [row('original')]);
      await setPersonalImportSyncEnabled(syncScope, true, () => true);
      for (const stage of stages) storage.setItem(stage, 'null');
      read = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, entry) {
        if (this === storage && stages.includes(entry)) throw new Error('舊暫存鍵持續無法讀取');
        return getItem.call(this, entry);
      });
      unsubscribe = subscribePersonalImports(reread);
      const guard = { canContinue: () => true };
      const { ledger } = await appendPersonalImports(syncScope, [row('new', '統計')], guard);
      await expect(reread.mock.results[0].value).resolves.toEqual(ledger);
      const edited = await editPersonalImport(syncScope, ledger.records[1], row('new', '物理'), guard);
      await expect(reread.mock.results[1].value).resolves.toEqual(edited);
      const snapshot = {
        schoolId: syncScope.schoolId, revision: 1, records: edited.records,
        updatedAt: '2026-11-25T00:00:00.000Z',
      };
      const transport = jest.fn(async () => snapshot);
      await syncPersonalImports(syncScope, transport, guard.canContinue);
      expect(transport).toHaveBeenCalledWith('personal-imports/read', { schoolId: syncScope.schoolId });
      const persisted = await loadPersonalImports(syncScope);
      expect(persisted.records.map(({ title }) => title)).toEqual(['微積分', '物理']);
      expect(persisted.sync?.base).toEqual(snapshot);
      for (const stage of stages) {
        expect(read.mock.calls.filter(([entry]) => entry === stage).length).toBeGreaterThanOrEqual(3);
        expect(getItem.call(storage, stage)).toBe('null');
      }
    } finally {
      unsubscribe?.();
      read?.mockRestore();
      database?.restore();
      restoreLocks();
      cleanup();
    }
  },
);

test.each(['session access', 'session remove', 'session write', 'session read', 'lease write', 'lease read'] as const)(
  'Expo Web keeps adding, editing and syncing during persistent %s failure',
  async (failure) => {
    const cleanup = useWebStorage();
    const restoreLocks = withoutWebWriteLocks();
    if (failure === 'lease write' || failure === 'lease read') {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: { open: () => { throw new DOMException('IndexedDB unavailable', 'SecurityError'); } },
      });
    } else {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: async (_key: string, write: () => unknown) => write() },
      });
    }
    const stages = window.sessionStorage;
    const orphan = 'campus.personal-imports.stage.v2:orphan';
    const syncScope = { ...scope, owner: 'nuni:pa_00000000-0000-4000-a000-000000000001' };
    const key = personalImportStorageKey(syncScope);
    const guard = { canContinue: () => true };
    const { removeItem, setItem, getItem } = Storage.prototype;
    const ioError = new DOMException('Auxiliary storage unavailable', 'SecurityError');
    const unavailable = jest.fn(() => { throw ioError; });
    let fault: jest.SpyInstance | undefined;
    const reread = jest.fn(() => loadPersonalImports(syncScope));
    const unsubscribe = subscribePersonalImports(reread);
    try {
      if (failure === 'session access') {
        fault = jest.spyOn(window, 'sessionStorage', 'get').mockImplementation(unavailable);
      } else if (failure === 'session remove') {
        stages.setItem(orphan, 'null');
        fault = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, entry) {
          if (this === stages && entry === orphan) unavailable();
          removeItem.call(this, entry);
        });
      } else if (failure === 'session write') {
        fault = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, entry, value) {
          if (this === stages) unavailable();
          setItem.call(this, entry, value);
        });
      } else if (failure === 'lease write') {
        const storage = window.localStorage;
        fault = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, entry, value) {
          if (this === storage && entry.startsWith(webLeasePrefix(key))) unavailable();
          setItem.call(this, entry, value);
        });
      } else {
        const storage = window.localStorage;
        fault = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, entry) {
          if (failure === 'lease read'
            ? this === storage && entry.startsWith(webLeasePrefix(key))
            : this === stages) unavailable();
          return getItem.call(this, entry);
        });
      }
      const { ledger } = await appendPersonalImports(syncScope, [row('original')], guard);
      await expect(reread.mock.results[0].value).resolves.toEqual(ledger);
      const edited = await editPersonalImport(syncScope, ledger.records[0], row('original', '物理'), guard);
      await expect(reread.mock.results[1].value).resolves.toEqual(edited);
      await setPersonalImportSyncEnabled(syncScope, true, guard.canContinue);
      const snapshot = {
        schoolId: syncScope.schoolId, revision: 1, records: edited.records,
        updatedAt: '2026-11-25T00:00:00.000Z',
      };
      await syncPersonalImports(syncScope, async () => snapshot, guard.canContinue);
      const { ledger: latest } = await appendPersonalImports(syncScope, [
        { ...row('later', '統計'), dayOfWeek: 2 },
      ], guard);
      expect(latest.records.map(({ title }) => title)).toEqual(['物理', '統計']);
      expect(latest.sync?.base).toEqual(snapshot);
      await expect(reread.mock.results.at(-1)!.value).resolves.toEqual(latest);
      expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject(latest);
      expect(unavailable.mock.calls.length).toBeGreaterThanOrEqual(3);
      if (failure === 'session remove') expect(stages.getItem(orphan)).toBe('null');
      if (failure === 'lease read') {
        expect(Object.keys(window.localStorage).filter((entry) => entry.startsWith(webLeasePrefix(key))))
          .toEqual([]);
      }
    } finally {
      fault?.mockRestore();
      unsubscribe();
      restoreLocks();
      cleanup();
    }
  },
);

test.each([
  ['no locks or extra space', 'edit'],
  ['no locks or extra space', 'delete'],
  ['room for a verbatim stage', 'edit'],
  ['no session space', 'delete'],
] as const)('Web at quota with %s can complete a shrinking %s', async (capacity, operation) => {
  const cleanup = useWebStorage();
  const restoreLocks = capacity === 'no locks or extra space'
    ? withoutWebWriteLocks()
    : useIndexedDBLocks().restore;
  const storage = window.localStorage;
  const stages = window.sessionStorage;
  const key = personalImportStorageKey(scope);
  const setItem = Storage.prototype.setItem;
  let quota: jest.SpyInstance | undefined;
  try {
    const title = String.raw`含"引號"和\反斜線`.repeat(20);
    const { ledger: imported } = await appendPersonalImports(scope, [row('original')]);
    const ledger = await editPersonalImport(scope, imported.records[0], row('original', title));
    // Also cover old ledgers that have no space for a new generation field.
    const original = JSON.stringify(ledger);
    storage.setItem(key, original);
    const sessionCapacity = capacity === 'room for a verbatim stage'
      ? original.length + 'campus.personal-imports.stage.v2:'.length + 36
      : 0;
    quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, entry, value,
    ) {
      const existing = Object.keys(this).filter((storedKey) => storedKey !== entry);
      const used = existing.reduce((size, storedKey) =>
        size + storedKey.length + this.getItem(storedKey)!.length, 0);
      const limit = this === storage ? key.length + original.length : sessionCapacity;
      if (used + entry.length + value.length > limit) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      setItem.call(this, entry, value);
    });
    const guard = { canContinue: () => true };
    const target = title.slice(0, -1);
    const result = operation === 'edit'
      ? await editPersonalImport(scope, ledger.records[0], row('original', target), guard)
      : await deletePersonalImport(scope, ledger.records[0], guard);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
      .toEqual(operation === 'edit' ? [target] : []);
    expect(storage.getItem(key)!.length).toBeLessThan(original.length);
    if (operation === 'edit') expect(storage.getItem(key)).toBe(JSON.stringify(result));
    expect(Object.keys(storage)).toEqual([key]);
    expect(Object.keys(stages)).toEqual([]);
    expect(result.records).toHaveLength(operation === 'edit' ? 1 : 0);
    const stageWrites = quota.mock.calls.filter(([entry]) =>
      entry.startsWith('campus.personal-imports.stage.v2:'));
    expect(stageWrites.map(([, value]) => value))
      .toEqual(capacity === 'no locks or extra space' ? [] : [original]);
  } finally {
    quota?.mockRestore();
    restoreLocks();
    cleanup();
  }
});

test.each([
  ['journal', '中斷寫入', '原本標'],
  ['checkpoint', '中斷寫入', '原本標'],
  ['both', '中斷寫入', '原本標'],
  ['journal', '中斷寫', '原本標'],
  ['checkpoint', '中斷寫', '原本標'],
  ['none', '原本標題', '更新標題'],
] as const)(
  'Web at quota publishes with %s recovery, primary title %s, and edited title %s',
  async (recovery, primaryTitle, editedTitle) => {
    const cleanup = useWebStorage();
    const restoreLocks = withoutWebWriteLocks();
    const storage = window.localStorage;
    const key = personalImportStorageKey(scope);
    const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
    const checkpoint = key + ':checkpoint';
    const setItem = Storage.prototype.setItem;
    let quota: jest.SpyInstance | undefined;
    try {
      const { ledger } = await appendPersonalImports(scope, [row('original', '原本標題')]);
      const original = JSON.stringify(ledger);
      const primaryWithTitle = original.replace('原本標題', primaryTitle);
      const primary = recovery === 'checkpoint'
        ? primaryWithTitle.replace('"version":1', '"version":0')
        : primaryWithTitle;
      const hasJournal = recovery === 'journal' || recovery === 'both';
      const hasCheckpoint = recovery === 'checkpoint' || recovery === 'both';
      storage.setItem(key, primary);
      const journalRaw = JSON.stringify({
        id: 'legacy', original, before: sha256(original), attempted: sha256(primary),
      });
      if (hasJournal) storage.setItem(journal, journalRaw);
      if (hasCheckpoint) storage.setItem(checkpoint, original);
      await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);

      let primaryCapacity = primary.length - 2;
      quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage, entry, value,
      ) {
        if (this === storage && (entry !== key || value.length > primaryCapacity)) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        setItem.call(this, entry, value);
        if (this === storage && entry === key && (hasJournal || hasCheckpoint)) {
          expect(hasWebPersonalImportCommit(this.getItem(key))).toBe(true);
          expect(this.getItem(journal)).toBe(hasJournal ? journalRaw : null);
          expect(this.getItem(checkpoint)).toBe(hasCheckpoint ? original : null);
        }
      });
      const guard = { canContinue: () => true };
      const edit = () => mutatePersonalImportLedger(scope, guard, (current) => {
        // Keep revision metadata fixed to exercise exactly one character of headroom.
        const edited = { ...current, records: [{ ...current.records[0], title: editedTitle }] };
        return { ledger: edited, result: edited };
      });
      await expect(edit()).rejects.toMatchObject({ name: 'QuotaExceededError' });
      expect(storage.getItem(key)).toBe(primary);
      expect(storage.getItem(journal)).toBe(hasJournal ? journalRaw : null);
      expect(storage.getItem(checkpoint)).toBe(hasCheckpoint ? original : null);
      await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);

      primaryCapacity = primary.length;
      const edited = await edit();
      expect(edited.records[0].title).toBe(editedTitle);
      const stored = storage.getItem(key)!;
      expect(stored).toHaveLength(JSON.stringify(edited).length);
      // The merge-base Expo reader parses the primary directly as a v1 ledger.
      expect(JSON.parse(stored)).toEqual(edited);
      expect(readWebCalendarImports(scope)).toEqual(edited.records);
      await expect(loadPersonalImports(scope)).resolves.toEqual(edited);
      expect(storage.getItem(journal)).toBeNull();
      expect(storage.getItem(checkpoint)).toBe(recovery === 'both' ? original : null);
      expect(quota.mock.calls.some(([entry]) =>
        entry.startsWith('campus.personal-imports.stage.v2:'))).toBe(false);
      expect(Object.keys(window.sessionStorage)).toEqual([]);
    } finally {
      quota?.mockRestore();
      restoreLocks();
      cleanup();
    }
  },
);

test.each([false, true])('Expo Web rejects a changed checkpoint with no primary (replacing: %s)', async (replacing) => {
  const cleanup = useWebStorage();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  try {
    const { ledger: original } = await appendPersonalImports(scope, [row('original', '原有行程')]);
    const { ledger: newer } = await appendPersonalImports(scope, [
      { ...row('other-tab', '另一分頁的行程'), dayOfWeek: 2 },
    ]);
    storage.removeItem(key);
    if (replacing) storage.setItem(checkpoint, JSON.stringify(JSON.stringify(original)));
    const newerRaw = JSON.stringify(newer);
    await expect(mutatePersonalImportLedger(scope, { canContinue: () => true }, (current) => {
      expect(current.records).toEqual(replacing ? original.records : []);
      storage.setItem(checkpoint, newerRaw);
      const records = [{ ...original.records[0], title: '目前分頁的變更' }];
      return { ledger: { ...current, records, batches: original.batches }, result: undefined };
    })).rejects.toThrow('已在另一個分頁更新');
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(checkpoint)).toBe(newerRaw);

    await appendPersonalImports(scope, [{ ...row('retry', '重試新增'), dayOfWeek: 3 }]);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
      .toEqual(['原有行程', '另一分頁的行程', '重試新增']);
    expect(storage.getItem(checkpoint)).toBeNull();
  } finally {
    cleanup();
  }
});

test('Expo Web cleanup leaves a checkpoint that appeared after reading a valid primary', async () => {
  const cleanup = useWebStorage();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original', '原有行程')]);
    const primary = storage.getItem(key)!;
    const { ledger: otherTab } = await appendPersonalImports(scope, [
      { ...row('other-tab', '另一分頁的行程'), dayOfWeek: 2 },
    ]);
    storage.setItem(key, primary);
    const otherTabRaw = JSON.stringify(otherTab);
    await mutatePersonalImportLedger(scope, () => true, (current) => {
      expect(current).toEqual(ledger);
      storage.setItem(checkpoint, otherTabRaw);
      const records = [{ ...current.records[0], title: '目前分頁的變更' }];
      return { ledger: { ...current, records }, result: undefined };
    });
    expect(readWebCalendarImports(scope).map(({ title }) => title)).toEqual(['目前分頁的變更']);
    expect(storage.getItem(checkpoint)).toBe(otherTabRaw);
  } finally {
    cleanup();
  }
});

test('Expo and Web calendar saves preserve a standalone checkpoint with an extra event', async () => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  try {
    const { ledger } = await appendPersonalImports(scope, [row('a', '活動 A')]);
    const withExtraEvent = await appendPersonalImports(scope, [
      { ...row('b', '活動 B'), dayOfWeek: 2 },
    ]);
    const backup = JSON.stringify(withExtraEvent.ledger);
    storage.setItem(key, JSON.stringify(ledger));
    storage.setItem(checkpoint, backup);

    await appendPersonalImports(scope, [{ ...row('c', '活動 C'), dayOfWeek: 3 }], {
      canContinue: () => true,
    });
    expect(JSON.parse(storage.getItem(key)!).records.map(({ title }: PersonalImportRecord) => title))
      .toEqual(['活動 A', '活動 C']);
    expect(storage.getItem(checkpoint)).toBe(backup);

    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (_key: string, write: () => unknown) => write() },
    });
    await saveWebCalendarBatch(scope, [{ ...row('d', '活動 D'), dayOfWeek: 4 }]);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
      .toEqual(['活動 A', '活動 C', '活動 D']);
    expect(storage.getItem(checkpoint)).toBe(backup);
  } finally {
    restoreLocks();
    cleanup();
  }
});

test.each(['save', 'sync'] as const)('Web %s preserves Expo undo history recovered from a checkpoint', async (operation) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  try {
    const { ledger } = await appendPersonalImports(scope, [row('old', 'Expo 匯入')]);
    storage.setItem(checkpoint, JSON.stringify(storage.getItem(key)));
    storage.removeItem(key);

    if (operation === 'save') {
      await saveWebCalendarBatch(scope, [{ ...row('new', 'Web 匯入'), dayOfWeek: 2 }]);
    } else {
      await withWebCalendarSyncLock(scope, async (state) => {
        expect(state.records).toEqual(ledger.records);
        return { state: { ...state, sync: { enabled: true, base: null } }, result: undefined };
      });
    }
    expect(storage.getItem(checkpoint)).toBeNull();
    expect((await loadPersonalImports(scope)).batches).toEqual(ledger.batches);
    await saveWebCalendarBatch(scope, [{ ...row('later', '後續 Web 匯入'), dayOfWeek: 3 }]);
    const { removed, ledger: afterUndo } = await undoLastPersonalImport(scope, ledger.batches[0].id);
    expect(removed).toBe(1);
    expect(afterUndo.records.map(({ title }) => title)).toEqual(
      operation === 'save' ? ['Web 匯入', '後續 Web 匯入'] : ['後續 Web 匯入'],
    );
  } finally {
    restoreLocks();
    cleanup();
  }
});

test.each([{}, [{ id: 'incomplete', count: 1 }]])(
  'Web save and sync leave an incomplete Expo checkpoint untouched (%j)',
  async (batches) => {
    const cleanup = useWebStorage();
    const restoreLocks = withoutWebWriteLocks();
    const storage = window.localStorage;
    const key = personalImportStorageKey(scope);
    const checkpoint = key + ':checkpoint';
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (_key: string, write: () => unknown) => write() },
    });
    try {
      const { ledger } = await appendPersonalImports(scope, [row('old', 'Expo 匯入')]);
      const damaged = JSON.stringify({
        ...ledger,
        sync: { enabled: false, base: null },
        batches,
      });
      storage.setItem(checkpoint, damaged);
      storage.removeItem(key);
      expect(readWebCalendarImports(scope)).toEqual([]);
      await saveWebCalendarBatch(scope, [row('new', 'Web 匯入')]);
      expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['Web 匯入']);
      expect(storage.getItem(checkpoint)).toBe(damaged);

      storage.removeItem(key);
      await withWebCalendarSyncLock(scope, async (state) => {
        expect(state.records).toEqual([]);
        return { state: { ...state, sync: { enabled: true, base: null } }, result: undefined };
      });
      expect(await loadPersonalImports(scope)).toMatchObject({ version: 1, records: [], batches: [] });
      expect(storage.getItem(checkpoint)).toBe(damaged);
    } finally {
      restoreLocks();
      cleanup();
    }
  },
);

test.each(['save', 'sync', 'sync snapshot', 'sync commit'] as const)(
  'Web uses and verifies the sole Expo journal during %s',
  async (operation) => {
    const cleanup = useWebStorage();
    const restoreLocks = withoutWebWriteLocks();
    const storage = window.localStorage;
    const key = personalImportStorageKey(scope);
    const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (_key: string, write: () => unknown) => write() },
    });
    try {
      const { ledger } = await appendPersonalImports(scope, [row('a', '行程 A')]);
      const original = storage.getItem(key)!;
      storage.removeItem(key);
      storage.setItem(journal, original);
      expect(await loadPersonalImports(scope)).toEqual(ledger);
      expect(readWebCalendarImports(scope)).toEqual(ledger.records);

      if (operation === 'save' || operation === 'sync') {
        if (operation === 'save') {
          await saveWebCalendarBatch(scope, [row('c', '行程 C')]);
        } else {
          await withWebCalendarSyncLock(scope, async (state, persist, assertSnapshot) => {
            expect(state.records).toEqual(ledger.records);
            assertSnapshot();
            const next = { ...state, sync: { enabled: true, base: null } };
            await persist(next);
            assertSnapshot();
            return { state: next, result: undefined };
          });
        }
        const committed = await loadPersonalImports(scope);
        expect(committed.records.map(({ title }) => title)).toEqual(
          operation === 'save' ? ['行程 A', '行程 C'] : ['行程 A'],
        );
        expect(committed.batches).toEqual(ledger.batches);
        expect(storage.getItem(journal)).toBeNull();
      } else {
        const replacement = JSON.stringify(original);
        const upload = jest.fn();
        await expect(withWebCalendarSyncLock(scope, async (state, _persist, assertSnapshot) => {
          expect(state.records).toEqual(ledger.records);
          storage.setItem(journal, replacement);
          if (operation === 'sync snapshot') {
            assertSnapshot();
            upload();
          }
          const sync = { enabled: true, base: null };
          return { state: { ...state, sync }, result: undefined };
        })).rejects.toThrow();
        expect(upload).not.toHaveBeenCalled();
        expect(storage.getItem(key)).toBeNull();
        expect(storage.getItem(journal)).toBe(replacement);
      }
    } finally {
      restoreLocks();
      cleanup();
    }
  },
);

test('Expo and Web preserve an unbound journal with an event skipped by the primary ledger', async () => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  try {
    await appendPersonalImports(scope, [row('a', '主帳本行程')]);
    const primary = storage.getItem(key)!;
    await appendPersonalImports(scope, [row('b', '僅在副本的行程')]);
    const copy = storage.getItem(key)!;
    storage.setItem(key, primary);
    storage.setItem(journal, copy);
    // Older primary ledgers did not carry a commit marker.
    const legacyPrimary = JSON.parse(primary);
    delete legacyPrimary.webCommit;
    storage.setItem(key, JSON.stringify(legacyPrimary));

    expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['主帳本行程']);
    await appendPersonalImports(scope, [row('c', 'Expo 新增')], { canContinue: () => true });
    expect(readWebCalendarImports(scope).map(({ title }) => title)).toEqual(['主帳本行程', 'Expo 新增']);
    expect(storage.getItem(journal)).toBe(copy);

    await saveWebCalendarBatch(scope, [{ ...row('d', 'Web 新增'), dayOfWeek: 2 }]);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual([
      '主帳本行程', 'Expo 新增', 'Web 新增',
    ]);
    expect(storage.getItem(journal)).toBe(copy);
  } finally {
    restoreLocks();
    cleanup();
  }
});

test.each([
  ['Web', 'webCommit'],
  ['Expo Web', '$commit'],
] as const)('%s saves from a bound journal when a %s primary has invalid sync', async (client, marker) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const key = personalImportStorageKey(scope);
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  const storage = window.localStorage;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original', '原有行程')]);
    const original = storage.getItem(key)!;
    const { version, ...body } = ledger;
    const attempted = JSON.stringify({
      ...(marker === '$commit' ? { $commit: version } : { version, webCommit: 'interrupted' }),
      ...body,
      records: [{ ...ledger.records[0], title: '中斷寫入的行程' }],
      sync: { enabled: 'invalid' },
    });
    storage.setItem(key, attempted);
    storage.setItem(journal, JSON.stringify({
      id: 'interrupted', before: sha256(original), attempted: sha256(attempted), original,
    }));

    expect(readWebCalendarImports(scope)).toEqual(ledger.records);
    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
    const added = { ...row('new', '新增行程'), dayOfWeek: 2 };
    if (client === 'Web') await saveWebCalendarBatch(scope, [added]);
    else await appendPersonalImports(scope, [added], { canContinue: () => true });
    expect(storage.getItem(journal)).toBeNull();
    expect(readWebCalendarImports(scope).map(({ title }) => title)).toEqual(['原有行程', '新增行程']);
    await expect(loadPersonalImports(scope)).resolves.toMatchObject({ records: readWebCalendarImports(scope) });
  } finally {
    restoreLocks();
    cleanup();
  }
});

test('a Web calendar save after an Expo commit cannot revive stale recovery data', async () => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const original = JSON.stringify(ledger);
    storage.setItem(key, original);
    storage.setItem(checkpoint, original);
    storage.setItem(journal, original);
    const edited = await editPersonalImport(scope, ledger.records[0], row('original', 'Expo 更新'), {
      canContinue: () => true,
    });
    expect(JSON.parse(storage.getItem(key)!).webCommit).toEqual(expect.any(String));

    // Copies may remain if the previous page stopped before cleanup.
    storage.setItem(checkpoint, original);
    storage.setItem(journal, original);
    await saveWebCalendarBatch(scope, [{ ...row('web', 'Web 新增'), dayOfWeek: 2 }]);
    expect(JSON.parse(storage.getItem(key)!)).not.toHaveProperty('webCommit');
    expect(hasWebPersonalImportCommit(storage.getItem(key))).toBe(true);
    const webRecords = readWebCalendarImports(scope);
    expect(webRecords).toEqual(expect.arrayContaining(edited.records));
    expect(webRecords.map(({ title }) => title)).toEqual(['Expo 更新', 'Web 新增']);
    expect((await loadPersonalImports(scope)).records).toEqual(webRecords);
    expect(storage.getItem(checkpoint)).toBe(original);
    expect(storage.getItem(journal)).toBe(original);
  } finally {
    restoreLocks();
    cleanup();
  }
});

test.each([
  ['interleaved old Web save with a wrapped checkpoint', true, 'absent'],
  ['closed Expo page with a standalone checkpoint', false, 'absent'],
  ['closed Expo page with a raw ledger journal', false, 'raw'],
  ['closed Expo page with a null journal', false, 'null'],
  ['closed Expo page with a wrapped ledger journal', false, 'wrapped'],
] as const)('Expo ignores stale recovery after %s', async (_scenario, interleaved, journalFormat) => {
  const cleanup = useWebStorage();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  const getItem = Storage.prototype.getItem;
  const setItem = Storage.prototype.setItem;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const journalRaw = {
      absent: null,
      raw: JSON.stringify(ledger),
      null: 'null',
      wrapped: JSON.stringify(JSON.stringify(ledger)),
    }[journalFormat];
    if (journalRaw !== null) storage.setItem(journal, journalRaw);
    storage.setItem(checkpoint, interleaved ? JSON.stringify(JSON.stringify(ledger)) : JSON.stringify(ledger));
    const stale = storage.getItem(checkpoint);
    const writeWithOldWebCalendar = () => {
      const { records } = JSON.parse(getItem.call(storage, key)!);
      setItem.call(storage, key, JSON.stringify({
        version: 1,
        records: [
          ...records,
          { ...records[0], id: 'web', dayOfWeek: 2, title: 'Web 新增' },
        ],
        sync: { enabled: false, base: null },
      }));
    };

    let primaryReadsAfterSet = 0;
    const reads = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage, entry,
    ) {
      const value = getItem.call(this, entry);
      // An older Web tab can publish immediately after Expo reads back its write.
      if (interleaved && this === storage && entry === key && primaryReadsAfterSet === 1) {
        primaryReadsAfterSet++;
        writeWithOldWebCalendar();
      }
      return value;
    });
    const writes = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, entry, value,
    ) {
      setItem.call(this, entry, value);
      if (this === storage && entry === key) primaryReadsAfterSet = 1;
    });
    try {
      await editPersonalImport(scope, ledger.records[0], row('original', 'Expo 更新'), {
        canContinue: () => true,
      });
    } finally {
      writes.mockRestore();
      reads.mockRestore();
    }
    expect(storage.getItem(checkpoint)).toBe(stale);
    expect(storage.getItem(journal)).toBe(journalRaw);
    if (!interleaved) writeWithOldWebCalendar();
    expect(hasWebPersonalImportCommit(storage.getItem(key))).toBe(false);

    const records = readWebCalendarImports(scope);
    expect(records.map(({ title }) => title)).toEqual(['Expo 更新', 'Web 新增']);
    let reopened!: typeof import('../services/personalImports');
    jest.isolateModules(() => { reopened = require('../services/personalImports'); });
    await expect(reopened.loadPersonalImports(scope)).resolves.toMatchObject({ records });
    const edited = await reopened.editPersonalImport(scope, records[1], {
      ...records[1], title: '重新開啟後更新',
    }, { canContinue: () => true });
    expect(edited.records.map(({ title }) => title)).toEqual(['Expo 更新', '重新開啟後更新']);
    expect(readWebCalendarImports(scope)).toEqual(edited.records);
    expect(storage.getItem(journal)).toBe(journalRaw);
    expect(storage.getItem(checkpoint)).toBe(stale);
  } finally {
    cleanup();
  }
});

test.each([
  [false, false],
  [true, false],
  [true, true],
] as const)('a growing Expo edit uses the entire primary budget (lease fits: %s, session full: %s)', async (leaseFits, sessionFull) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const setItem = Storage.prototype.setItem;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const original = JSON.stringify(ledger);
    storage.setItem(key, original);
    // The lease consumes more than two characters. In the second case the
    // primary can grow by exactly the size of that lease, before reservation.
    let growth = 2;
    let capacity = key.length + original.length + growth;
    let leasesWritten = 0;
    let stageAttempts = 0;
    const quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, entry, value,
    ) {
      if (this === window.sessionStorage) {
        stageAttempts++;
        if (sessionFull) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      const isLease = this === storage && entry.startsWith(webLeasePrefix(key));
      if (isLease && leaseFits) {
        growth = entry.length + value.length;
        capacity = key.length + original.length + growth;
      }
      const used = Object.keys(this).filter((stored) => stored !== entry)
        .reduce((size, stored) => size + stored.length + this.getItem(stored)!.length, 0);
      if (this === storage && used + entry.length + value.length > capacity) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      setItem.call(this, entry, value);
      if (isLease) leasesWritten++;
    });
    try {
      const edit = (extra: number) => mutatePersonalImportLedger(scope, { canContinue: () => true }, (current) => {
        const records = [{ ...current.records[0], title: current.records[0].title + '字'.repeat(growth + extra) }];
        const edited = { ...current, records };
        return { ledger: edited, result: edited };
      });
      await expect(edit(1)).rejects.toMatchObject({ name: 'QuotaExceededError' });
      expect(storage.getItem(key)).toBe(original);
      expect(Object.keys(storage)).toEqual([key]);
      const edited = await edit(0);
      expect(leasesWritten).toBe(leaseFits ? 2 : 0);
      expect(stageAttempts).toBe(leaseFits ? 2 : 0);
      expect(storage.getItem(key)).toHaveLength(original.length + growth);
      expect(JSON.parse(storage.getItem(key)!)).toEqual(edited);
      await expect(loadPersonalImports(scope)).resolves.toEqual(edited);
      expect(Object.keys(storage)).toEqual([key]);
      expect(Object.keys(window.sessionStorage)).toEqual([]);
    } finally {
      quota.mockRestore();
    }
  } finally {
    restoreLocks();
    cleanup();
  }
});

test.each([false, true])('Web without locks reclaims legacy localStorage stages at quota (other ledger: %s)', async (foreign) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const setItem = Storage.prototype.setItem;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const oldKey = personalImportStorageKey(foreign ? { ...scope, owner: 'nuni:closed-tab' } : scope);
    const unmarked = legacyWebStage(oldKey, 'unmarked');
    const expired = legacyWebStage(oldKey, 'expired');
    const expiredLease = webLeasePrefix(oldKey) + 'expired';
    storage.setItem(unmarked, JSON.stringify({ original: JSON.stringify(ledger) }));
    storage.setItem(expired, JSON.stringify({ original: JSON.stringify(ledger) }));
    storage.setItem(expiredLease, String(Date.now() - 1));
    const quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, entry, value,
    ) {
      if (this === storage && (storage.getItem(unmarked) || storage.getItem(expired))) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      setItem.call(this, entry, value);
    });
    try {
      let reopened!: typeof import('../services/personalImports');
      jest.isolateModules(() => { reopened = require('../services/personalImports'); });
      await expect(reopened.editPersonalImport(scope, ledger.records[0], row('original', '重試成功'), {
        canContinue: () => true,
      })).resolves.toMatchObject({ records: [{ title: '重試成功' }] });
      expect(storage.getItem(unmarked)).toBeNull();
      expect(storage.getItem(expired)).toBeNull();
      expect(storage.getItem(expiredLease)).toBeNull();
      expect(Object.keys(storage).filter((entry) => entry.startsWith(webLeasePrefix(personalImportStorageKey(scope)))))
        .toEqual([]);
    } finally {
      quota.mockRestore();
    }
  } finally {
    restoreLocks();
    cleanup();
  }
});

test('Web without locks preserves another tab’s legacy stage while its write lease is renewed', async () => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  jest.useFakeTimers();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const stage = legacyWebStage(key, 'active');
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let lease: string | undefined;
  let firstExpiration: string | null = null;
  const writer = mutatePersonalImportLedger(scope, { canContinue: () => true }, async (ledger) => {
    lease = Object.keys(storage).find((entry) => entry.startsWith(webLeasePrefix(key)));
    firstExpiration = lease ? storage.getItem(lease) : null;
    // Model a legacy-format copy in use by the write attempt.
    storage.setItem(stage, JSON.stringify({ original: JSON.stringify(ledger) }));
    signalStarted();
    await paused;
    return { ledger, result: undefined };
  });
  try {
    await Promise.race([started, writer]);
    expect(lease).toBeDefined();
    expect(Number(firstExpiration)).toBeGreaterThan(Date.now());
    jest.advanceTimersByTime(31_000);
    expect(Number(firstExpiration)).toBeLessThan(Date.now());
    expect(Number(storage.getItem(lease!))).toBeGreaterThan(Date.now());

    let otherTab!: typeof import('../services/personalImports');
    jest.isolateModules(() => { otherTab = require('../services/personalImports'); });
    const guard = { canContinue: () => true };
    await otherTab.mutatePersonalImportLedger(scope, guard, (ledger) => ({ ledger, result: undefined }));
    expect(storage.getItem(stage)).not.toBeNull();

    resume();
    await writer;
    expect(storage.getItem(lease!)).toBeNull();
    await otherTab.appendPersonalImports(scope, [row('after')], guard);
    expect(storage.getItem(stage)).toBeNull();
  } finally {
    resume();
    try {
      await writer;
    } finally {
      jest.useRealTimers();
      restoreLocks();
      cleanup();
    }
  }
});

test.each([false, true])('Web without locks cannot publish after pagehide at quota: %s', async (atQuota) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  let quota: jest.SpyInstance | undefined;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const before = storage.getItem(key);
    if (atQuota) {
      const setItem = Storage.prototype.setItem;
      quota = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage, entry, value,
      ) {
        if (this === storage && entry.startsWith(webLeasePrefix(key))) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        setItem.call(this, entry, value);
      });
    }
    await expect(mutatePersonalImportLedger(scope, { canContinue: () => true }, (current) => {
      expect(Object.keys(storage).some((entry) => entry.startsWith(webLeasePrefix(key)))).toBe(!atQuota);
      window.dispatchEvent(new Event('pagehide'));
      expect(Object.keys(storage).some((entry) => entry.startsWith(webLeasePrefix(key)))).toBe(false);
      return {
        ledger: { ...current, records: [], batches: [] },
        result: undefined,
      };
    })).rejects.toThrow('寫入標記已失效');
    expect(storage.getItem(key)).toBe(before);
    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
  } finally {
    quota?.mockRestore();
    restoreLocks();
    cleanup();
  }
});

test('an aborted IndexedDB write cannot publish after its failure is reported', async () => {
  const cleanup = useWebStorage();
  const { abort, restore } = useIndexedDBLocks();
  const key = personalImportStorageKey(scope);
  const guard = { canContinue: () => true };
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let checkpointAfterAbort: Promise<void> | undefined;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')], guard);
    const before = window.localStorage.getItem(key);
    const write = mutatePersonalImportLedger(scope, guard, async (current, checkpoint) => {
      signalStarted();
      await paused;
      const changed = { ...current, records: [{ ...current.records[0], title: '已中止的寫入' }] };
      checkpointAfterAbort = checkpoint(changed);
      await checkpointAfterAbort;
      return { ledger: changed, result: undefined };
    });
    const failed = expect(write).rejects.toThrow('交易中止');
    await started;
    abort(key);
    await failed;

    // The queue has advanced, but no subsequent write has changed the primary.
    await expect(mutatePersonalImportLedger(scope, guard, (current) => ({
      ledger: current, result: current,
    }))).resolves.toEqual(ledger);
    resume();
    await paused;
    expect(checkpointAfterAbort).toBeDefined();
    await expect(checkpointAfterAbort).rejects.toThrow('交易中止');
    expect(window.localStorage.getItem(key)).toBe(before);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
    await expect(editPersonalImport(scope, ledger.records[0], row('original', '重試成功'), guard))
      .resolves.toMatchObject({ records: [{ title: '重試成功' }] });
  } finally {
    resume();
    restore();
    cleanup();
  }
});

test.each(['account switched', 'legacy primary changed', 'during cleanup', 'before publication'])(
  'Web preserves the other tab’s primary and stage without locks when %s',
  async (timing) => {
    const cleanup = useWebStorage();
    expect(navigator.locks).toBeUndefined();
    expect(globalThis.indexedDB).toBeUndefined();
    const storage = window.localStorage;
    const stages = window.sessionStorage;
    const key = personalImportStorageKey(scope);
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const newer = { ...ledger, records: [{ ...ledger.records[0], title: '分頁 B' }] };
    const newerRaw = JSON.stringify(timing === 'legacy primary changed' ? newer : { ...newer, webCommit: 'tab-b' });
    let stageKey: string | undefined;
    let verified = true;
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    const writeSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, entry, value,
    ) {
      setItem.call(this, entry, value);
      if (this !== stages) return;
      stageKey = entry;
      if (timing === 'account switched' || timing === 'during cleanup') verified = false;
      if (timing !== 'during cleanup') setItem.call(storage, key, newerRaw);
    });
    const cleanupSpy = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage, entry,
    ) {
      if (this === stages && entry === stageKey) {
        if (timing === 'during cleanup') setItem.call(storage, key, newerRaw);
        // Another tab has its own storage area. Its stage is outside this cleanup.
        setItem.call(storage, `${entry}-other-tab`, '分頁 B 的副本');
      }
      removeItem.call(this, entry);
    });
    try {
      await expect(editPersonalImport(scope, ledger.records[0], row('original', '分頁 A'), {
        canContinue: () => verified,
      })).rejects.toThrow(verified && (timing === 'legacy primary changed' || timing === 'before publication')
        ? '已在另一個分頁更新' : '帳號或學校已切換');
      expect(stageKey).toBeDefined();
      expect(stages.getItem(stageKey!)).toBeNull();
      expect(storage.getItem(`${stageKey}-other-tab`)).toBe('分頁 B 的副本');
      expect(storage.getItem(key)).toBe(newerRaw);
      await expect(loadPersonalImports(scope)).resolves.toEqual(newer);
    } finally {
      cleanupSpy.mockRestore();
      writeSpy.mockRestore();
      cleanup();
    }
  },
);

test.each([false, true])('Web reclaims an abandoned session stage before a near-quota retry (other ledger: %s)', async (foreign) => {
  const cleanup = useWebStorage();
  const stages = window.sessionStorage;
  const stagePrefix = 'campus.personal-imports.stage.v2:';
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const oldScope = foreign ? { ...scope, owner: 'nuni:account-b' } : scope;
  const { ledger: other } = foreign ? await appendPersonalImports(oldScope, [row('other')]) : { ledger };
  const setItem = Storage.prototype.setItem;
  let abandoned: string | undefined;
  let verified = true;
  const writeSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage, entry, value,
  ) {
    if (this === stages && Object.keys(this).some((key) => key.startsWith(stagePrefix))) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    setItem.call(this, entry, value);
    if (this === stages) {
      abandoned = entry;
      verified = false;
    }
  });
  const removeItem = Storage.prototype.removeItem;
  const lostCleanup = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage, entry,
  ) {
    if (this !== stages) removeItem.call(this, entry);
  });
  try {
    // Model a terminated page by leaving its full stage in the restored session.
    await expect(editPersonalImport(oldScope, other.records[0], { ...other.records[0], title: '前次寫入' }, {
      canContinue: () => verified,
    })).rejects.toThrow('帳號或學校已切換');
    await expect(loadPersonalImports(oldScope)).resolves.toEqual(other);
    const orphan = abandoned!;
    expect(JSON.parse(stages.getItem(orphan)!).records).toEqual(other.records);
    lostCleanup.mockRestore();
    let reopened!: typeof import('../services/personalImports');
    jest.isolateModules(() => { reopened = require('../services/personalImports'); });
    const { records: [original] } = await reopened.loadPersonalImports(scope);
    const retried = await reopened.editPersonalImport(scope, original, { ...original, title: '重試成功' }, {
      canContinue: () => true,
    });
    expect(retried.records[0].title).toBe('重試成功');
    expect(stages.getItem(orphan)).toBeNull();
    expect(Object.keys(stages)).toEqual([]);
  } finally {
    lostCleanup.mockRestore();
    writeSpy.mockRestore();
    cleanup();
  }
});

test.each(['a', '校'])('guarded calendar writes support maximum-length account and school IDs (%s)', async (character) => {
  const longScope = { owner: `nuni:${'u'.repeat(128)}`, schoolId: character.repeat(120) };
  const event = personalEventRowFromDraft({
    ...emptyPersonalEventDraft(),
    title: '校園活動',
    date: '2026-11-25',
    allDay: true,
  }, longScope.schoolId);
  const info = File.prototype.info;
  const fileInfo = jest.spyOn(File.prototype, 'info').mockImplementation(function (this: File) {
    const name = this.uri.split('/').pop()!;
    if (Buffer.byteLength(name) > 255) throw new Error('ENAMETOOLONG');
    return info.call(this);
  });
  const guard = { canContinue: () => true, canCommitFirstWrite: () => true };
  try {
    const { ledger: { records: [added] } } = await appendPersonalImports(longScope, [event], guard);
    const { records: [edited] } = await editPersonalImport(longScope, added, { ...added, title: '更新後的活動' }, guard);
    expect((await loadPersonalImports(longScope)).records).toEqual([edited]);
    await deletePersonalImport(longScope, edited, guard);
    expect((await loadPersonalImports(longScope)).records).toEqual([]);
    expect(fileInfo).toHaveBeenCalled();
  } finally {
    fileInfo.mockRestore();
  }
});

test('a marked journal from an older build remains authoritative until a guarded retry commits', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const key = personalImportStorageKey(scope);
  const legacyName = key.replaceAll(':', '~3a').replaceAll('%', '~25');
  const payload = new File(Paths.document, `${legacyName}.rollback.json`);
  const marker = new File(Paths.document, `${legacyName}.rollback.pending`);
  payload.write(JSON.stringify(ledger));
  marker.create();
  await AsyncStorage.removeItem(key);

  await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
  await deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
  expect(marker.info().exists).toBe(false);
  expect((await loadPersonalImports(scope)).records).toEqual([]);
});

test.each(['append', 'edit', 'delete'] as const)(
  'guarded %s succeeds when only the primary ledger fits in storage',
  async (operation) => {
    const key = personalImportStorageKey(scope);
    const initial = row('original');
    initial.source.rawText = '原始紀錄'.repeat(1_024);
    const { ledger: { records: [original] } } = await appendPersonalImports(scope, [initial]);
    const before = (await AsyncStorage.getItem(key))!;
    const capacity = before.length + 1_024;
    expect(JSON.stringify(before).length + before.length).toBeGreaterThan(capacity);

    const multiSet = jest.mocked(AsyncStorage.multiSet);
    const nativeMultiSet = multiSet.getMockImplementation()!;
    multiSet.mockClear();
    multiSet.mockImplementation(async (entries, callback) => {
      const values = new Map(await AsyncStorage.multiGet([key, key + ':checkpoint']));
      for (const [storageKey, value] of entries) values.set(storageKey, value);
      const used = [...values.values()].reduce((size, value) => size + (value?.length ?? 0), 0);
      if (used > capacity) throw new Error('SQLiteFullException');
      await nativeMultiSet(entries, callback);
    });
    const guard = { canContinue: () => true, canCommitFirstWrite: () => true };
    try {
      if (operation === 'append') await appendPersonalImports(scope, [row('new', '統計')], guard);
      if (operation === 'edit') await editPersonalImport(scope, original, { ...original, title: '統計' }, guard);
      if (operation === 'delete') await deletePersonalImport(scope, original, guard);
      const expected = { append: ['微積分', '統計'], edit: ['統計'], delete: [] };
      expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(expected[operation]);
      expect(multiSet.mock.calls.map(([entries]) => entries.map(([storageKey]) => storageKey))).toEqual([[key]]);
    } finally {
      multiSet.mockImplementation(nativeMultiSet);
    }
  },
);

test.each([
  'SQLiteBlobTooBigException',
  'Row too big to fit into CursorWindow requiredPos=0, totalRows=1',
])('reads the primary ledger when a legacy checkpoint exceeds the Android row limit (%s)', async (message) => {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const limit = 2 * 1024 * 1024;
  const original = row('original');
  original.source.rawText = String.fromCharCode(92).repeat(600_000);
  const { ledger } = await appendPersonalImports(scope, [original]);
  const primary = (await AsyncStorage.getItem(key))!;
  const encoded = JSON.stringify(primary);
  const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');
  expect(byteLength(primary)).toBeLessThan(limit);
  expect(byteLength(encoded)).toBeGreaterThan(limit);
  await AsyncStorage.setItem(checkpoint, encoded);

  const nativeMultiGet = jest.mocked(AsyncStorage.multiGet).getMockImplementation()!;
  const multiGet = jest.mocked(AsyncStorage.multiGet).mockImplementation(async (keys) => {
    const entries = await nativeMultiGet(keys);
    if (entries.some(([, value]) => value !== null && byteLength(value) > limit)) {
      throw new Error(message);
    }
    return entries;
  });
  const getItem = jest.mocked(AsyncStorage.getItem);
  const nativeGetItem = getItem.getMockImplementation()!;
  getItem.mockImplementation(async (storageKey) => {
    const value = await nativeGetItem(storageKey);
    if (value !== null && byteLength(value) > limit) throw new Error(message);
    return value;
  });
  try {
    expect(await loadPersonalImports(scope)).toEqual(ledger);
    await deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
    expect((await loadPersonalImports(scope)).records).toEqual([]);
  } finally {
    multiGet.mockImplementation(nativeMultiGet);
    getItem.mockImplementation(nativeGetItem);
  }
  expect(await AsyncStorage.getItem(checkpoint)).toBe(encoded);
});

test('reads the primary ledger when the checkpoint cannot be parsed', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  await AsyncStorage.setItem(personalImportStorageKey(scope) + ':checkpoint', '{"version":1,');
  expect(await loadPersonalImports(scope)).toEqual(ledger);
});

test('native rollback keeps the rebuilt checkpoint and restart journal after write authority is revoked', async () => {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const original = await AsyncStorage.getItem(key);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const nativeSet = setItem.getMockImplementation()!;
  const remove = jest.mocked(AsyncStorage.multiRemove);
  remove.mockClear();
  let active = true;
  setItem.mockImplementationOnce(async (entry, value) => {
    await nativeSet(entry, value);
    active = false;
  });

  await jest.isolateModulesAsync(async () => {
    const beforeRestart = require('../services/personalImports') as typeof import('../services/personalImports');
    const notify = jest.fn();
    const unsubscribe = beforeRestart.subscribePersonalImports(notify);
    try {
      await expect(beforeRestart.deletePersonalImport(scope, ledger.records[0], {
        canContinue: () => active,
      })).rejects.toThrow('帳號或學校已切換');
      expect(notify).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
  expect(await AsyncStorage.getItem(key)).toBe(original);
  expect(await AsyncStorage.getItem(checkpoint)).toBe(original);
  expect(remove).not.toHaveBeenCalled();
  expect(readPersonalImportRollback(key)).toBe(original);

  await jest.isolateModulesAsync(async () => {
    const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
    await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
    await restarted.deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
  });
  expect(await AsyncStorage.getItem(checkpoint)).toBeNull();
  expect(readPersonalImportRollback(key)).toBeUndefined();
});

async function failedDeletionRollback(checkpointWriteFails = false) {
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const originalRaw = await AsyncStorage.getItem(key);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const nativeSetItem = setItem.getMockImplementation()!;
  const checkpointWriteError = new Error('檢查點寫入失敗');
  const rejectCheckpointWrite = jest.fn().mockRejectedValue(checkpointWriteError);
  const web = Platform.OS === 'web';
  let verified = true;

  // Isolate the deleting process so the next instance starts with fresh service state.
  let deleteBeforeRestart!: typeof deletePersonalImport;
  jest.isolateModules(() => {
    deleteBeforeRestart = require('../services/personalImports').deletePersonalImport;
  });
  setItem.mockImplementationOnce(async (storageKey, value) => {
    await nativeSetItem(storageKey, value);
    verified = false;
    if (checkpointWriteFails && !web) {
      jest.mocked(AsyncStorage.multiSet).mockImplementationOnce(rejectCheckpointWrite);
    }
  });
  setItem.mockRejectedValueOnce(new Error('還原寫入失敗'));
  await expect(deleteBeforeRestart(scope, ledger.records[0], {
    canContinue: () => true,
    canCommitFirstWrite: () => verified,
  })).rejects.toThrow('還原寫入失敗');

  const deletedRaw = (await AsyncStorage.getItem(key))!;
  expect(JSON.parse(deletedRaw).records).toEqual([]);
  if (checkpointWriteFails && !web) {
    expect(rejectCheckpointWrite).toHaveBeenCalledWith([[checkpoint, originalRaw]]);
  }
  expect(await AsyncStorage.getItem(checkpoint)).toBe(checkpointWriteFails || web ? null : originalRaw);
  return { key, checkpoint, ledger, originalRaw, deletedRaw };
}

test('a restart recovers a revoked deletion after both AsyncStorage rollback writes fail', async () => {
  const { key, ledger } = await failedDeletionRollback(true);
  // The imported service here starts with fresh state and the same on-disk data.
  expect(await loadPersonalImports(scope)).toEqual(ledger);
  await appendPersonalImports(scope, [row('new', '統計')], { canContinue: () => true });
  expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['微積分', '統計']);
  expect(JSON.parse((await AsyncStorage.getItem(key))!).records[0]).toEqual(ledger.records[0]);
  await deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
  expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['統計']);
});

test('Web preserves the ledger after revocation and can retry after restart without Expo files', async () => {
  const cleanup = useWebStorage();
  const document = Object.getOwnPropertyDescriptor(Paths, 'document')!;
  Object.defineProperty(Paths, 'document', {
    get: () => { throw new TypeError('Expo 網頁預覽沒有文件目錄'); },
  });
  let stageWrite: jest.SpyInstance | undefined;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const key = personalImportStorageKey(scope);
    const before = window.localStorage.getItem(key);
    let verified = true;
    const write = Storage.prototype.setItem;
    stageWrite = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage, storageKey, value,
    ) {
      write.call(this, storageKey, value);
      if (this === window.sessionStorage) verified = false;
    });
    await expect(deletePersonalImport(scope, ledger.records[0], {
      canContinue: () => true,
      canCommitFirstWrite: () => verified,
    })).rejects.toThrow('目前無法確認行事曆可寫入');
    expect(window.localStorage.getItem(key)).toBe(before);

    stageWrite.mockRestore();
    let restarted!: typeof import('../services/personalImports');
    jest.isolateModules(() => {
      restarted = require('../services/personalImports');
    });
    await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
    await restarted.deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
    await expect(restarted.loadPersonalImports(scope)).resolves.toMatchObject({ records: [] });
    expect(Object.keys(window.localStorage)).toEqual([key]);
  } finally {
    stageWrite?.mockRestore();
    cleanup();
    Object.defineProperty(Paths, 'document', document);
  }
});

test.each([
  '{"version":1,',
  '{"version":1,"records":[]}',
  '{"id":"legacy","original":null}',
])('Web can read and edit a valid primary with a corrupt journal (%s)', async (corrupt) => {
  const cleanup = useWebStorage();
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const storage = window.localStorage;
    const key = personalImportStorageKey(scope);
    const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
    storage.setItem(key, JSON.stringify(ledger));
    storage.setItem(journal, corrupt);

    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
    storage.removeItem(key);
    await expect(loadPersonalImports(scope)).resolves.toMatchObject({ records: [] });
    expect(storage.getItem(journal)).toBe(corrupt);
    storage.setItem(key, JSON.stringify(ledger));

    const edited = await editPersonalImport(scope, ledger.records[0], row('original', '已更新'), {
      canContinue: () => true,
    });
    expect(edited.records[0].title).toBe('已更新');
    await expect(loadPersonalImports(scope)).resolves.toEqual(edited);
  } finally {
    cleanup();
  }
});

test.each(['append', 'sync'] as const)('Expo Web can %s with only a truncated journal', async (operation) => {
  const cleanup = useWebStorage();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  const corrupted = '{"version":1,';
  try {
    storage.setItem(journal, corrupted);
    await expect(loadPersonalImports(scope)).resolves.toMatchObject({ records: [] });
    if (operation === 'append') {
      await appendPersonalImports(scope, [row('new')], { canContinue: () => true });
      expect((await loadPersonalImports(scope)).records).toHaveLength(1);
    } else {
      await mutatePersonalImportLedger(scope, { canContinue: () => true }, async (ledger, checkpoint) => {
        expect(ledger.records).toEqual([]);
        const changed = { ...ledger, sync: { enabled: true, base: null } };
        await checkpoint(changed);
        return { ledger: changed, result: undefined };
      }, 'sync');
      expect((await loadPersonalImports(scope)).sync).toEqual({ enabled: true, base: null });
    }
    expect(JSON.parse(storage.getItem(key)!).version).toBe(1);
    expect(storage.getItem(journal)).toBe(corrupted);
  } finally {
    cleanup();
  }
});

test.each(['before', 'attempted'] as const)(
  'Web keeps the verified primary when a contradictory journal matches %s',
  async (matched) => {
    const cleanup = useWebStorage();
    try {
      const { ledger } = await appendPersonalImports(scope, [row('original')]);
      const storage = window.localStorage;
      const key = personalImportStorageKey(scope);
      const original = JSON.stringify(ledger);
      const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
      storage.setItem(key, original);
      const contradictory = JSON.stringify({
        id: 'legacy',
        original: null,
        before: sha256(matched === 'before' ? original : 'another ledger'),
        attempted: sha256(matched === 'attempted' ? original : 'interrupted write'),
      });
      storage.setItem(journal, contradictory);

      await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
      const saved = await appendPersonalImports(scope, [row('new', '新課程')], { canContinue: () => true });
      expect(saved.ledger.records).toHaveLength(2);
      expect(saved.ledger.records).toContainEqual(ledger.records[0]);
      await expect(loadPersonalImports(scope)).resolves.toEqual(saved.ledger);
      expect(storage.getItem(journal)).toBe(contradictory);
    } finally {
      cleanup();
    }
  },
);

test.each([null, '{"version":1,'])(
  'Expo Web rejects contradictory journal contents with primary %s',
  async (primary) => {
    const cleanup = useWebStorage();
    const storage = window.localStorage;
    const key = personalImportStorageKey(scope);
    const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
    try {
      const { ledger } = await appendPersonalImports(scope, [row('original', '錯誤日誌的行程')]);
      if (primary === null) storage.removeItem(key);
      else storage.setItem(key, primary);
      const contradictory = JSON.stringify({
        id: 'legacy',
        original: JSON.stringify(ledger),
        before: sha256('another ledger'),
        attempted: sha256(primary ?? 'null'),
      });
      storage.setItem(journal, contradictory);

      const append = () => appendPersonalImports(scope, [row('new', '新行程')], {
        canContinue: () => true,
      });
      if (primary === null) {
        await expect(loadPersonalImports(scope)).resolves.toMatchObject({ records: [] });
        const saved = await append();
        expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ records: saved.ledger.records });
        expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['新行程']);
      } else {
        await expect(loadPersonalImports(scope)).rejects.toThrow();
        await expect(append()).rejects.toThrow();
        expect(storage.getItem(key)).toBe(primary);
        expect(storage.getItem(journal)).toBe(contradictory);
      }
    } finally {
      cleanup();
    }
  },
);

test('Expo Web refuses to publish from a journal replaced after recovery', async () => {
  const cleanup = useWebStorage();
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const original = JSON.stringify(ledger);
    const primary = JSON.stringify({ ...ledger, records: [], batches: [] });
    const bound = {
      id: 'legacy', original, before: sha256(original), attempted: sha256(primary),
    };
    storage.setItem(key, primary);
    storage.setItem(journal, JSON.stringify(bound));
    const replacement = JSON.stringify({ ...bound, id: 'another-attempt' });
    await expect(mutatePersonalImportLedger(scope, { canContinue: () => true }, (current) => {
      expect(current).toEqual(ledger);
      storage.setItem(journal, replacement);
      const records = current.records.map((record) => ({ ...record, title: '更新' }));
      return { ledger: { ...current, records }, result: undefined };
    })).rejects.toThrow('已在另一個分頁更新');
    expect(storage.getItem(key)).toBe(primary);
    expect(storage.getItem(journal)).toBe(replacement);
  } finally {
    cleanup();
  }
});

test.each(['Web', 'Expo Web'] as const)('%s recovers a bound journal before an older checkpoint when the primary is missing', async (client) => {
  const cleanup = useWebStorage();
  const restoreLocks = withoutWebWriteLocks();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_key: string, write: () => unknown) => write() },
  });
  const storage = window.localStorage;
  const key = personalImportStorageKey(scope);
  const checkpoint = key + ':checkpoint';
  const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
  try {
    await appendPersonalImports(scope, [row('a', '行程 A')]);
    const older = storage.getItem(key)!;
    await appendPersonalImports(scope, [row('b', '行程 B')]);
    const original = storage.getItem(key)!;
    storage.removeItem(key);
    storage.setItem(checkpoint, older);
    storage.setItem(journal, JSON.stringify({
      id: 'interrupted',
      original,
      before: sha256(original),
      attempted: sha256('null'),
    }));

    if (client === 'Web') {
      await saveWebCalendarBatch(scope, [row('c', '行程 C')]);
    } else {
      await appendPersonalImports(scope, [row('c', '行程 C')]);
    }
    expect(readWebCalendarImports(scope).map(({ title }) => title)).toEqual(['行程 A', '行程 B', '行程 C']);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
      .toEqual(['行程 A', '行程 B', '行程 C']);
    expect(storage.getItem(checkpoint)).toBe(older);
    expect(storage.getItem(journal)).toBeNull();
  } finally {
    restoreLocks();
    cleanup();
  }
});

describe.each(['Web', 'Expo Web'] as const)('%s interrupted browser write', (client) => {
  test.each(['webCommit', 'version suffix', 'legacy tab', 'legacy compact'] as const)(
    'recovers the bound original before saving over an attempted ledger with %s',
    async (marker) => {
      const cleanup = useWebStorage();
      const restoreLocks = withoutWebWriteLocks();
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: async (_key: string, write: () => unknown) => write() },
      });
      try {
        const { ledger } = await appendPersonalImports(scope, [row('original', '原有行程')]);
        const storage = window.localStorage;
        const key = personalImportStorageKey(scope);
        const checkpoint = key + ':checkpoint';
        const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
        const original = storage.getItem(key)!;
        const empty = { records: [], batches: [] };
        const attempted = {
          webCommit: JSON.stringify({ version: 1, ...empty, webCommit: 'interrupted' }),
          'version suffix': JSON.stringify({ ...empty, version: 1 }),
          'legacy tab': JSON.stringify({ version: 1, ...empty }) + '\t',
          'legacy compact': JSON.stringify({ $commit: 1, ...empty }),
        }[marker];
        const older = JSON.stringify({ version: 1, ...empty });
        storage.setItem(key, attempted);
        storage.setItem(checkpoint, older);
        storage.setItem(journal, JSON.stringify({
          id: 'interrupted',
          original,
          before: sha256(original),
          attempted: sha256(attempted),
        }));

        if (client === 'Web') {
          expect(readWebCalendarImports(scope)).toEqual(ledger.records);
          await saveWebCalendarBatch(scope, [row('new', '新行程')]);
        } else {
          await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
          await appendPersonalImports(scope, [row('new', '新行程')]);
        }
        expect(readWebCalendarImports(scope).map(({ title }) => title)).toEqual(['原有行程', '新行程']);
        expect((await loadPersonalImports(scope)).records.map(({ title }) => title))
          .toEqual(['原有行程', '新行程']);
        expect(storage.getItem(checkpoint)).toBe(older);
        expect(storage.getItem(journal)).toBeNull();
      } finally {
        restoreLocks();
        cleanup();
      }
    },
  );
});

test('Web retries from a legacy marked copy and retires it when the new ledger commits', async () => {
  const cleanup = useWebStorage();
  try {
    const { ledger } = await appendPersonalImports(scope, [row('original')]);
    const storage = window.localStorage;
    const key = personalImportStorageKey(scope);
    const original = JSON.stringify(ledger);
    const attempted = JSON.stringify({ ...ledger, records: [], batches: [] });
    const journal = `campus.personal-imports.rollback.v1:${sha256(key)}`;
    storage.setItem(key, attempted);
    storage.setItem(journal, JSON.stringify({
      id: 'legacy',
      original,
      before: sha256(original),
      attempted: sha256(attempted),
    }));

    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
    await deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
    expect(storage.getItem(journal)).toBeNull();
    await expect(loadPersonalImports(scope)).resolves.toEqual({ version: 1, records: [], batches: [] });
  } finally {
    cleanup();
  }
});

test('a recovered deletion can retry when storage only fits the smaller result', async () => {
  const { key, ledger, originalRaw, deletedRaw } = await failedDeletionRollback(true);
  const capacity = Buffer.byteLength(deletedRaw);
  expect(Buffer.byteLength(originalRaw!)).toBeGreaterThan(capacity);
  const multiSet = jest.mocked(AsyncStorage.multiSet);
  const nativeMultiSet = multiSet.getMockImplementation()!;
  const writes = jest.fn(async (entries: Parameters<typeof nativeMultiSet>[0]) => {
    const values = new Map(await AsyncStorage.multiGet([key, key + ':checkpoint']));
    for (const [storageKey, value] of entries) values.set(storageKey, value);
    const used = [...values.values()].reduce((size, value) => size + Buffer.byteLength(value ?? ''), 0);
    if (used > capacity) throw new Error('SQLiteFullException');
    await nativeMultiSet(entries);
  });
  multiSet.mockImplementation(writes);

  try {
    let restarted!: typeof import('../services/personalImports');
    jest.isolateModules(() => {
      restarted = require('../services/personalImports');
    });
    await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);

    let verified = true;
    const setItem = jest.mocked(AsyncStorage.setItem);
    const nativeSetItem = setItem.getMockImplementation()!;
    setItem.mockImplementationOnce(async (entry, value) => {
      await nativeSetItem(entry, value);
      verified = false;
    });
    await expect(restarted.deletePersonalImport(scope, ledger.records[0], {
      canContinue: () => true,
      canCommitFirstWrite: () => verified,
    })).rejects.toThrow('SQLiteFullException');
    expect(await restarted.loadPersonalImports(scope)).toEqual(ledger);

    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
    writes.mockClear();
    await deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith([[key, deletedRaw]], undefined);

    let loadAfterRestart!: typeof loadPersonalImports;
    jest.isolateModules(() => {
      loadAfterRestart = require('../services/personalImports').loadPersonalImports;
    });
    await expect(loadAfterRestart(scope)).resolves.toEqual(JSON.parse(deletedRaw));
  } finally {
    multiSet.mockImplementation(nativeMultiSet);
  }
});

test('a temporary rollback journal read failure blocks reads and writes after restart', async () => {
  const { key, ledger, deletedRaw } = await failedDeletionRollback(true);
  const failure = new Error('disk I/O error');
  const readJournal = jest.spyOn(File.prototype, 'textSync').mockImplementation(() => {
    throw failure;
  });
  try {
    await expect(loadPersonalImports(scope)).rejects.toBe(failure);
    await expect(appendPersonalImports(scope, [row('new', '統計')], {
      canContinue: () => true,
    })).rejects.toBe(failure);
    expect(await AsyncStorage.getItem(key)).toBe(deletedRaw);
  } finally {
    readJournal.mockRestore();
  }
  expect(await loadPersonalImports(scope)).toEqual(ledger);
});

test('a failed journal preparation leaves the verified ledger intact', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const failure = new Error('disk I/O error');
  const publish = jest.spyOn(File.prototype, 'create').mockImplementationOnce(() => {
    throw failure;
  });
  try {
    await expect(deletePersonalImport(scope, ledger.records[0], {
      canContinue: () => true,
    })).rejects.toBe(failure);
    expect(JSON.parse((await AsyncStorage.getItem(personalImportStorageKey(scope)))!)).toEqual(ledger);
    expect(await loadPersonalImports(scope)).toEqual(ledger);
    await deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
    expect((await loadPersonalImports(scope)).records).toEqual([]);
  } finally {
    publish.mockRestore();
  }
});

test('a native create that returns without creating the marker blocks deletion before any AsyncStorage write', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const multiSet = jest.mocked(AsyncStorage.multiSet);
  setItem.mockClear();
  multiSet.mockClear();
  const publish = jest.spyOn(File.prototype, 'create').mockImplementationOnce(() => undefined);
  try {
    await expect(deletePersonalImport(scope, ledger.records[0], {
      canContinue: () => true,
    })).rejects.toThrow('無法建立匯入資料的還原標記。');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(multiSet).not.toHaveBeenCalled();

    let loadAfterRestart!: typeof loadPersonalImports;
    jest.isolateModules(() => {
      loadAfterRestart = require('../services/personalImports').loadPersonalImports;
    });
    await expect(loadAfterRestart(scope)).resolves.toEqual(ledger);
  } finally {
    publish.mockRestore();
  }
});

const androidRowLimitError = () => new Error('Row too big to fit into CursorWindow');

test.each(['batch', 'single key'])('a temporary checkpoint read failure (%s) after restart allows journal recovery and guarded writes', async (phase) => {
  const { key, checkpoint, ledger, originalRaw, deletedRaw } = await failedDeletionRollback();
  expect(readPersonalImportRollback(key)).toBe(originalRaw);
  const failure = new Error('disk I/O error');
  const multiGet = jest.mocked(AsyncStorage.multiGet);
  const getItem = jest.mocked(AsyncStorage.getItem);
  const nativeMultiGet = multiGet.getMockImplementation()!;
  const nativeGetItem = getItem.getMockImplementation()!;
  const failCheckpointRead = jest.fn().mockRejectedValue(failure);

  multiGet.mockImplementation(async (keys) => {
    if (keys.includes(checkpoint)) {
      if (phase === 'batch') return failCheckpointRead(checkpoint);
      throw androidRowLimitError();
    }
    return nativeMultiGet(keys);
  });
  if (phase === 'single key') {
    getItem.mockImplementation(async (storageKey) =>
      storageKey === checkpoint ? failCheckpointRead(storageKey) : nativeGetItem(storageKey));
  }

  try {
    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
    expect(failCheckpointRead).toHaveBeenCalledWith(checkpoint);
    expect(await AsyncStorage.getItem(key)).toBe(deletedRaw);

    failCheckpointRead.mockClear();
    const guard = { canContinue: () => true, canCommitFirstWrite: () => true };
    const result = await appendPersonalImports(scope, [row('new', '統計')], guard);
    expect(failCheckpointRead).toHaveBeenCalledWith(checkpoint);
    expect(result.ledger.records[0]).toEqual(ledger.records[0]);
    expect(result.ledger.records.map(({ title }) => title)).toEqual(['微積分', '統計']);
    expect(JSON.parse((await AsyncStorage.getItem(key))!)).toEqual(result.ledger);
    expect(readPersonalImportRollback(key)).toBeUndefined();

    await jest.isolateModulesAsync(async () => {
      const restarted = require('../services/personalImports') as typeof import('../services/personalImports');
      failCheckpointRead.mockClear();
      await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(result.ledger);
      expect(failCheckpointRead).not.toHaveBeenCalled();
    });
  } finally {
    multiGet.mockImplementation(nativeMultiGet);
    getItem.mockImplementation(nativeGetItem);
  }
});

test('a coalesced Android read failure from another key preserves a readable checkpoint after restart', async () => {
  const { key, checkpoint, ledger, originalRaw, deletedRaw } = await failedDeletionRollback();
  const otherKey = personalImportStorageKey({ ...scope, owner: 'nuni:account-b' });
  const multiGet = jest.mocked(AsyncStorage.multiGet);
  const nativeMultiGet = multiGet.getMockImplementation()!;
  const getItem = jest.mocked(AsyncStorage.getItem);
  const failure = androidRowLimitError();
  const failedBatch = jest.fn();
  let batch: { keys: Set<string>; done: Promise<void> } | undefined;
  multiGet.mockImplementation(async (keys) => {
    if (!batch) {
      const batchKeys = new Set<string>();
      const done = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          batch = undefined;
          if (batchKeys.has(otherKey)) {
            failedBatch([...batchKeys]);
            reject(failure);
          } else {
            resolve();
          }
        }, 0);
      });
      batch = { keys: batchKeys, done };
    }
    const { keys: batchKeys, done } = batch;
    for (const storageKey of keys) batchKeys.add(storageKey);
    await done;
    return nativeMultiGet(keys);
  });

  try {
    getItem.mockClear();
    const read = loadPersonalImports(scope);
    const otherRead = expect(AsyncStorage.multiGet([otherKey])).rejects.toBe(failure);
    await expect(read).resolves.toEqual(ledger);
    await otherRead;
    expect(failedBatch).toHaveBeenCalledWith([checkpoint, otherKey]);
    expect(getItem).toHaveBeenCalledWith(key);
    expect(await AsyncStorage.getItem(key)).toBe(deletedRaw);
    expect(await AsyncStorage.getItem(checkpoint)).toBe(originalRaw);

    getItem.mockClear();
    const write = appendPersonalImports(scope, [row('new', '統計')], { canContinue: () => true });
    const concurrentRead = expect(AsyncStorage.multiGet([otherKey])).rejects.toBe(failure);
    await write;
    await concurrentRead;
    expect(failedBatch).toHaveBeenLastCalledWith([otherKey, checkpoint]);
    const primaryReads = getItem.mock.invocationCallOrder.filter(
      (_, index) => getItem.mock.calls[index][0] === key,
    );
    // Read the primary for a durable commit before choosing recovery, then verify the new write.
    const primaryWrite = jest.mocked(AsyncStorage.setItem).mock.invocationCallOrder.at(-1)!;
    expect(primaryReads).toHaveLength(2);
    expect(primaryReads[0]).toBeLessThan(primaryWrite);
    expect(primaryReads[1]).toBeGreaterThan(primaryWrite);
    expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['微積分', '統計']);
    expect(await AsyncStorage.getItem(checkpoint)).toBeNull();
  } finally {
    multiGet.mockImplementation(nativeMultiGet);
  }
});

const creditStates = [
  { label: 'missing', fields: {} },
  { label: 'undefined', fields: { credits: undefined } },
  { label: 'null', fields: { credits: null } },
  { label: 'empty', fields: { credits: '' } },
  { label: 'zero', fields: { credits: 0 } },
  { label: 'same', fields: { credits: 3 } },
  { label: 'different', fields: { credits: 2 } },
];
const creditMatrix = creditStates.flatMap((saved) =>
  [undefined, 3].flatMap((incoming) =>
    [false, true].map((complete) => ({
      saved: saved.label, fields: saved.fields, incoming, complete,
    })),
  ),
);

test.each(creditMatrix)(
  'catalog append matches merge-base with saved credits $saved, incoming $incoming, extra slot $complete',
  async ({ fields, incoming, complete }) => {
    const periodProfile = periodProfileForSchool(scope.schoolId);
    const [[startTime], [, endTime]] = periodTimes(periodProfile);
    const firstSlot = { ...row('duplicate'), courseCode: 'MATH101', startTime, endTime };
    const duplicate = { ...firstSlot, credits: incoming };
    const missing = { ...duplicate, id: 'missing', dayOfWeek: 2 };
    const rows = complete ? [duplicate, missing] : [duplicate];
    const saved = { ...firstSlot, id: 'saved', ...fields } as PersonalImportRow;
    const original = (await appendPersonalImports(scope, [saved])).ledger;
    const result = await appendPersonalImports(scope, rows, () => true, {
      protectCatalogTimetableSlots: true,
    });

    // For these identical slots the merge-base catalog guard allows the write.
    // Its shared planner is unchanged and supplies the expected records.
    const batch = result.ledger.batches[result.ledger.batches.length - 1];
    const expected = planPersonalImport(original.records, rows, {
      batchId: complete ? batch.id : 'preview',
      importedAt: batch.createdAt,
      periodProfile,
    });
    expect(result.added).toBe(complete ? 1 : 0);
    expect(result.duplicates).toBe(1);
    expect(result.ledger.records).toEqual(expected.records);
    expect(result.ledger.records[0]).toEqual(original.records[0]);
    expect((await loadPersonalImports(scope)).records).toEqual(expected.records);
  },
);

test('NCKU and NTPU accounts do not see each other’s timetable imports', async () => {
  const ncku = { owner: 'nuni:chengda', schoolId: 'ncku' };
  const ntpu = { owner: 'nuni:beida', schoolId: 'ntpu' };
  await appendPersonalImports(ncku, [
    { ...row('ncku-1', '微積分'), schoolId: 'ncku', startPeriod: 1, endPeriod: 1 },
  ]);
  await appendPersonalImports(ntpu, [
    { ...row('ntpu-1', '進階會計'), schoolId: 'ntpu', startPeriod: 10, endPeriod: 13 },
  ]);
  expect((await loadPersonalImports(ncku)).records.map((item) => item.title)).toEqual(['微積分']);
  expect((await loadPersonalImports(ntpu)).records.map((item) => item.title)).toEqual(['進階會計']);
  expect((await loadPersonalImports({ owner: ncku.owner, schoolId: 'ntpu' })).records).toHaveLength(
    0,
  );
  expect((await loadPersonalImports({ owner: ntpu.owner, schoolId: 'ncku' })).records).toHaveLength(
    0,
  );
});

test('simultaneous saves serialize and do not lose either record', async () => {
  await Promise.all([
    appendPersonalImports(scope, [row('a')]),
    appendPersonalImports(scope, [row('b', '英文')]),
  ]);
  expect((await loadPersonalImports(scope)).records.map((item) => item.title).sort()).toEqual([
    '微積分',
    '英文',
  ]);
});

test('undo leaves subsequent edits intact and rejects a stale batch', async () => {
  const first = await appendPersonalImports(scope, [row('a'), row('b', '英文')]);
  const before = first.ledger.records[0];
  await editPersonalImport(scope, before, { ...before, title: '微積分（一）' });
  const undo = await undoLastPersonalImport(scope, first.ledger.batches[0].id);
  expect(undo.removed).toBe(1);
  expect(undo.ledger.records[0].title).toBe('微積分（一）');
  await expect(undoLastPersonalImport(scope, first.ledger.batches[0].id)).rejects.toThrow('已更新');
});

test('invalid rows, stale edits, and cancelled scopes never overwrite durable data', async () => {
  const first = await appendPersonalImports(scope, [row('a')]);
  await expect(appendPersonalImports(scope, [{ ...row('b'), endPeriod: 0 }])).rejects.toThrow();
  await expect(appendPersonalImports(scope, [row('b', '英文')], () => false)).rejects.toThrow(
    '切換',
  );
  const before = first.ledger.records[0];
  await editPersonalImport(scope, before, { ...before, title: '微積分（一）' });
  await expect(editPersonalImport(scope, before, { ...before, title: '過期編輯' })).rejects.toThrow(
    '已變更',
  );
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('corrupted storage is reported and preserved', async () => {
  const key = personalImportStorageKey(scope);
  await AsyncStorage.setItem(key, '{invalid');
  await expect(appendPersonalImports(scope, [row('a')])).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe('{invalid');
});

test('projection accepts only explicit supported PU periods without changing saved records', async () => {
  const saved = await appendPersonalImports(scope, [row('a')]);
  const records = saved.ledger.records;
  expect(personalImportCourses(records, 'pu')[0]).toMatchObject({
    id: 'import:a',
    day: 1,
    start: 1,
    end: 2,
  });
  expect(personalImportCourses(records, 'ntu')).toEqual([]);
  expect(
    personalImportCourses(
      [{ ...records[0], schoolId: 'ncku', startPeriod: 12, endPeriod: 15 }],
      'ncku',
    )[0],
  ).toMatchObject({ start: 12, end: 15 });
  expect(
    personalImportCourses(
      [{ ...records[0], schoolId: 'ntpu', startPeriod: 10, endPeriod: 13 }],
      'ntpu',
    )[0],
  ).toMatchObject({ start: 10, end: 13 });
  for (const dayOfWeek of [6, 7]) {
    expect(personalImportCourses([{ ...records[0], dayOfWeek }], 'pu'))
      .toEqual([expect.objectContaining({ day: dayOfWeek, start: 1, end: 2 })]);
  }
  expect(personalImportCourses([{ ...records[0], dayOfWeek: 8 }], 'pu')).toEqual([]);
  expect(personalImportCourses([{ ...records[0], startPeriod: undefined }], 'pu')).toEqual([]);
  expect(records[0].id).toBe('a');
});

test('all-day events and letter grades survive reload without invented credit conclusions', async () => {
  const result = await appendPersonalImports(scope, [
    { ...row('grade'), kind: 'grades', grade: 'A-', credits: 3 },
    {
      ...row('event'),
      kind: 'events',
      title: '校慶',
      academicYear: '',
      semester: '',
      date: '2026-10-20',
      allDay: true,
    },
  ]);
  expect(result.added).toBe(2);
  expect((await loadPersonalImports(scope)).records).toEqual(result.ledger.records);
});

test('changed room or linked class is a conflict, never a silently discarded duplicate', async () => {
  await appendPersonalImports(scope, [{ ...row('a'), location: '主顧303' }]);
  await expect(
    appendPersonalImports(scope, [{ ...row('b'), location: '主顧501' }]),
  ).rejects.toThrow('地點');
  expect((await loadPersonalImports(scope)).records[0].location).toBe('主顧303');
});

test('local imports occupy time for meetup planning without publishing courses', async () => {
  const result = await appendPersonalImports(scope, [
    { ...row('a'), dayOfWeek: 1, startPeriod: 1, endPeriod: 13 },
  ]);
  const occupied = personalImportCourses(result.ledger.records, 'pu');
  expect(meetupWindows([], []).some((window) => window.day === 1)).toBe(true);
  expect(meetupWindows(occupied, []).some((window) => window.day === 1)).toBe(false);
});

test('JSON-valid malformed ledger is rejected without replacing recoverable storage', async () => {
  const saved = await appendPersonalImports(scope, [row('a')]);
  const key = personalImportStorageKey(scope);
  const raw = JSON.stringify({
    ...saved.ledger,
    records: [{ ...saved.ledger.records[0], title: { bad: true } }],
  });
  await AsyncStorage.setItem(key, raw);
  await expect(loadPersonalImports(scope)).rejects.toThrow('無法讀取');
  await expect(appendPersonalImports(scope, [row('b')])).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe(raw);
});

test('selected historical term does not mix current or unknown-term original courses', async () => {
  const saved = await appendPersonalImports(scope, [
    { ...row('old'), academicYear: '114', semester: '2' },
  ]);
  const base = {
    meta: { year: '115', semester: '1' },
    courses: [
      {
        id: 'current',
        name: '英文',
        day: 2,
        start: 3,
        end: 4,
        teacher: '',
        room: '',
        color: 'blue' as const,
      },
    ],
  };
  expect(
    selectPersonalTimetableCourses(base, saved.ledger.records, 'pu', '114／2').map(
      (course) => course.id,
    ),
  ).toEqual(['import:old']);
  expect(
    selectPersonalTimetableCourses(base, saved.ledger.records, 'pu', 'legacy').map(
      (course) => course.id,
    ),
  ).toEqual(['current']);
  expect(
    selectPersonalTimetableCourses(
      { ...base, meta: { year: '', semester: '' } },
      saved.ledger.records,
      'pu',
      '114／2',
    ).map((course) => course.id),
  ).toEqual(['import:old']);
  expect(
    selectPersonalTimetableCourses(
      { ...base, meta: { year: '114', semester: '2' } },
      saved.ledger.records,
      'pu',
      '114／2',
    ),
  ).toHaveLength(2);
});

test('deleting one saved record is durable and does not remove its batch siblings', async () => {
  const saved = await appendPersonalImports(scope, [row('a'), row('b', '英文')]);
  const original = saved.ledger.records[0];
  const updated = await deletePersonalImport(scope, original);
  expect(updated.records.map((item) => item.title)).toEqual(['英文']);
  expect(updated.batches).toHaveLength(1);
  await expect(deletePersonalImport(scope, original)).rejects.toThrow('已變更');
  expect((await loadPersonalImports(scope)).records).toEqual(updated.records);
});

test('same-name courses with different teachers or rooms are not hidden by manual-import deduplication', () => {
  const manual = {
    id: 'manual', name: '微積分', day: 1, start: 1, end: 2,
    teacher: '王老師', room: 'A101', color: 'blue' as const,
  };
  const base = { courses: [manual], meta: { year: '115', semester: '1' } };
  const imported = {
    ...row('imported'), batchId: 'batch', importedAt: '2026-10-20T00:00:00Z',
    teacher: manual.teacher, location: manual.room,
  };
  expect(selectPersonalTimetableCourses(base, [imported], 'pu', '115／1')).toHaveLength(1);
  expect(selectPersonalTimetableCourses(base, [{ ...imported, teacher: '林老師' }], 'pu', '115／1')).toHaveLength(2);
  expect(selectPersonalTimetableCourses(base, [{ ...imported, location: 'A102' }], 'pu', '115／1')).toHaveLength(2);
});

test('a stale deletion, an account change and damaged storage never erase a newer revision', async () => {
  const saved = await appendPersonalImports(scope, [row('a')]);
  const original = saved.ledger.records[0];
  const edited = await editPersonalImport(scope, original, { ...original, title: '高等微積分' });
  expect(edited.batches).toHaveLength(0);
  await expect(deletePersonalImport(scope, original)).rejects.toThrow('已變更');
  await expect(deletePersonalImport(scope, edited.records[0], () => false)).rejects.toThrow('切換');
  expect((await loadPersonalImports(scope)).records[0].title).toBe('高等微積分');

  const key = personalImportStorageKey(scope);
  await AsyncStorage.setItem(key, '{corrupt');
  await expect(deletePersonalImport(scope, edited.records[0])).rejects.toThrow();
  expect(await AsyncStorage.getItem(key)).toBe('{corrupt');
});

test('removing the last record prunes an empty undo batch', async () => {
  const saved = await appendPersonalImports(scope, [row('a')]);
  const ledger = await deletePersonalImport(scope, saved.ledger.records[0]);
  expect(ledger).toMatchObject({ records: [], batches: [] });
  await expect(undoLastPersonalImport(scope, saved.ledger.batches[0].id)).rejects.toThrow('已更新');
});

test('backup snapshot waits for pending writes and checks identity before returning', async () => {
  const pending = appendPersonalImports(scope, [row('a')]);
  const result = snapshotPersonalImports(scope);
  await pending;
  expect((await result).records).toHaveLength(1);
  await expect(snapshotPersonalImports(scope, () => false)).rejects.toThrow('切換');
});

test('backup reimport preserves an existing class reference without granting a new one', async () => {
  const initial = await appendPersonalImports(scope, [
    { ...row('a'), linkedCourseId: 'cw_existing' },
  ]);
  const backup = serializePersonalImportBackup(initial.ledger.records, { schoolId: 'pu' });
  const parsed = parsePersonalImportBackup(backup);
  expect(parsed.rows[0].linkedCourseId).toBeUndefined();
  const duplicate = await appendPersonalImports(scope, parsed.rows, () => true, {
    restoreBackup: true,
  });
  expect(duplicate.added).toBe(0);
  expect(duplicate.duplicates).toBe(1);
  expect(duplicate.ledger.records[0].linkedCourseId).toBe('cw_existing');
  const differentOwner = { ...scope, owner: 'nuni:account-b' };
  const restored = await appendPersonalImports(differentOwner, parsed.rows, () => true, {
    restoreBackup: true,
  });
  expect(restored.ledger.records[0].linkedCourseId).toBeUndefined();
});

test('backup mode still blocks changed course metadata and never overwrites', async () => {
  const initial = await appendPersonalImports(scope, [
    { ...row('a'), location: '101', linkedCourseId: 'cw_existing' },
  ]);
  const parsed = parsePersonalImportBackup(
    serializePersonalImportBackup([{ ...initial.ledger.records[0], location: '202' }], {
      schoolId: 'pu',
    }),
  );
  await expect(
    appendPersonalImports(scope, parsed.rows, () => true, { restoreBackup: true }),
  ).rejects.toThrow('沒有儲存');
  expect((await loadPersonalImports(scope)).records[0].location).toBe('101');
});
