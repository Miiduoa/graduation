import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  meetupWindows,
  emptyPersonalEventDraft,
  personalEventRowFromDraft,
  periodProfileForSchool,
  periodTimes,
  planPersonalImport,
  serializePersonalImportBackup,
  parsePersonalImportBackup,
  type PersonalImportRow,
} from '@campus/shared';
import {
  appendPersonalImports,
  deletePersonalImport,
  snapshotPersonalImports,
  editPersonalImport,
  loadPersonalImports,
  personalImportCourses,
  personalImportStorageKey,
  selectPersonalTimetableCourses,
  undoLastPersonalImport,
} from '../services/personalImports';

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

test('Web leaves the primary ledger intact when the recovery copy cannot be stored', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  const originalPlatform = Platform.OS;
  Platform.OS = 'web';
  const storeBackup = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  });
  const setItem = jest.mocked(AsyncStorage.setItem);
  setItem.mockClear();
  try {
    await expect(editPersonalImport(scope, ledger.records[0], row('original', '統計'), {
      canContinue: () => true,
    })).rejects.toThrow('Quota exceeded');
    expect(storeBackup).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    await expect(loadPersonalImports(scope)).resolves.toEqual(ledger);
  } finally {
    storeBackup.mockRestore();
    Platform.OS = originalPlatform;
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
    expect(await AsyncStorage.getItem(checkpoint)).toBeNull();
  } finally {
    multiGet.mockImplementation(nativeMultiGet);
    getItem.mockImplementation(nativeGetItem);
  }
});

test('reads the primary ledger when the checkpoint cannot be parsed', async () => {
  const { ledger } = await appendPersonalImports(scope, [row('original')]);
  await AsyncStorage.setItem(personalImportStorageKey(scope) + ':checkpoint', '{"version":1,');
  expect(await loadPersonalImports(scope)).toEqual(ledger);
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
  let verified = true;

  // Isolate the deleting process so the next instance starts with fresh service state.
  let deleteBeforeRestart!: typeof deletePersonalImport;
  jest.isolateModules(() => {
    deleteBeforeRestart = require('../services/personalImports').deletePersonalImport;
  });
  setItem.mockImplementationOnce(async (storageKey, value) => {
    await nativeSetItem(storageKey, value);
    verified = false;
    if (checkpointWriteFails) {
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
  if (checkpointWriteFails) {
    expect(rejectCheckpointWrite).toHaveBeenCalledWith([[checkpoint, originalRaw]]);
  }
  expect(await AsyncStorage.getItem(checkpoint)).toBe(checkpointWriteFails ? null : originalRaw);
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

test('Web recovers a revoked write after restart and can retry without Expo files', async () => {
  const originalPlatform = Platform.OS;
  const document = Object.getOwnPropertyDescriptor(Paths, 'document')!;
  Platform.OS = 'web';
  Object.defineProperty(Paths, 'document', {
    get: () => { throw new TypeError('Expo 網頁預覽沒有文件目錄'); },
  });
  try {
    const { ledger } = await failedDeletionRollback(true);
    let restarted!: typeof import('../services/personalImports');
    jest.isolateModules(() => {
      restarted = require('../services/personalImports');
    });
    await expect(restarted.loadPersonalImports(scope)).resolves.toEqual(ledger);
    await restarted.deletePersonalImport(scope, ledger.records[0], { canContinue: () => true });
    await expect(restarted.loadPersonalImports(scope)).resolves.toMatchObject({ records: [] });
    expect(window.localStorage.length).toBe(0);
  } finally {
    window.localStorage.clear();
    Platform.OS = originalPlatform;
    Object.defineProperty(Paths, 'document', document);
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
    const multiRemove = jest.mocked(AsyncStorage.multiRemove);
    const nativeMultiRemove = multiRemove.getMockImplementation()!;
    multiRemove.mockImplementationOnce(async (keys) => {
      await nativeMultiRemove(keys);
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

test.each(['batch', 'single key'])('a temporary checkpoint read failure (%s) after restart blocks reads and guarded writes until recovery', async (phase) => {
  const { key, checkpoint, ledger, originalRaw, deletedRaw } = await failedDeletionRollback();
  const failure = new Error('disk I/O error');
  const multiGet = jest.mocked(AsyncStorage.multiGet);
  if (phase === 'batch') {
    multiGet.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
  } else {
    multiGet.mockRejectedValueOnce(androidRowLimitError()).mockRejectedValueOnce(androidRowLimitError());
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
  }
  const guard = { canContinue: () => true };
  await expect(loadPersonalImports(scope)).rejects.toBe(failure);
  await expect(appendPersonalImports(scope, [row('new', '統計')], guard)).rejects.toBe(failure);
  expect(await AsyncStorage.getItem(key)).toBe(deletedRaw);
  expect(await AsyncStorage.getItem(checkpoint)).toBe(originalRaw);

  expect(await loadPersonalImports(scope)).toEqual(ledger);
  await appendPersonalImports(scope, [row('new', '統計')], guard);
  expect((await loadPersonalImports(scope)).records.map(({ title }) => title)).toEqual(['微積分', '統計']);
  expect(await AsyncStorage.getItem(checkpoint)).toBeNull();
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
    expect(getItem).not.toHaveBeenCalledWith(key);
    expect(await AsyncStorage.getItem(key)).toBe(deletedRaw);
    expect(await AsyncStorage.getItem(checkpoint)).toBe(originalRaw);

    getItem.mockClear();
    const write = appendPersonalImports(scope, [row('new', '統計')], { canContinue: () => true });
    const concurrentRead = expect(AsyncStorage.multiGet([otherKey])).rejects.toBe(failure);
    await write;
    await concurrentRead;
    expect(failedBatch).toHaveBeenLastCalledWith([otherKey, checkpoint]);
    expect(getItem).not.toHaveBeenCalledWith(key);
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
