import { beforeEach, expect, it, vi } from 'vitest';
import { parsePersonalImport, type PersonalImportRow } from '@campus/shared';
import {
  savePersonalImportBatch,
  readPersonalImports,
  undoPersonalImports,
  changePersonalImport,
  personalImportsStorageKey,
} from './personalImports';
const scope = { owner: 'platform:one', schoolId: 'pu' };
const rows = (text = '課程名稱,學分,成績\n資料庫,3,85') =>
  parsePersonalImport(text, { kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' })
    .rows;
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  let lock = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, fn: () => unknown) => {
        const task = lock.then(fn);
        lock = task.then(
          () => undefined,
          () => undefined,
        );
        return task;
      },
    },
  });
});
it('appends concurrently without lost data and skips repeated imports', async () => {
  await Promise.all([
    savePersonalImportBatch(scope, rows()),
    savePersonalImportBatch(scope, rows('課程名稱,學分,成績\n英文,2,90')),
  ]);
  expect(readPersonalImports(scope).map((row) => row.title)).toEqual(['資料庫', '英文']);
  expect(await savePersonalImportBatch(scope, rows())).toMatchObject({ added: 0, duplicates: 1 });
  expect(readPersonalImports(scope)).toHaveLength(2);
});
it('separates accounts, guests and schools, and rejects cross-school input', async () => {
  await savePersonalImportBatch(scope, rows());
  expect(readPersonalImports({ ...scope, owner: 'guest' })).toEqual([]);
  expect(readPersonalImports({ ...scope, owner: 'platform:two' })).toEqual([]);
  expect(readPersonalImports({ ...scope, schoolId: 'ntu' })).toEqual([]);
  await expect(savePersonalImportBatch({ ...scope, schoolId: 'ntu' }, rows())).rejects.toThrow(
    '校園',
  );
});
it('does not lose old data on failed persistence or conflicting grades', async () => {
  await savePersonalImportBatch(scope, rows());
  const original = localStorage.getItem(personalImportsStorageKey(scope));
  await expect(
    savePersonalImportBatch(scope, rows('課程名稱,學分,成績\n資料庫,3,60')),
  ).rejects.toThrow('成績或學分不同');
  // The test setup may supply an own-method storage shim on newer Node versions.
  const storageMethods = Object.hasOwn(localStorage, 'setItem')
    ? localStorage
    : Object.getPrototypeOf(localStorage);
  vi.spyOn(storageMethods, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  await expect(
    savePersonalImportBatch(scope, rows('課程名稱,學分,成績\n英文,2,90')),
  ).rejects.toThrow('沒有存成');
  expect(localStorage.getItem(personalImportsStorageKey(scope))).toBe(original);
});
it('undo preserves records imported later and records edited after the batch', async () => {
  const first = await savePersonalImportBatch(scope, rows());
  const original = readPersonalImports(scope)[0];
  await changePersonalImport(scope, original, { ...original, grade: '88' });
  await savePersonalImportBatch(scope, rows('課程名稱,學分,成績\n英文,2,90'));
  expect(await undoPersonalImports(scope, first.batchId)).toBe(0);
  expect(readPersonalImports(scope).map((row) => row.grade)).toEqual(['88', '90']);
  await expect(changePersonalImport(scope, original, null)).rejects.toThrow('另一個頁面');
});
it('blocks stale queued operations after an account switch', async () => {
  let active = true;
  const save = savePersonalImportBatch(scope, rows(), () => active);
  active = false;
  await expect(save).rejects.toThrow('帳號或校園已切換');
  expect(readPersonalImports(scope)).toEqual([]);
});
it('does not overwrite a damaged ledger and rejects invalid complete batches', async () => {
  const key = personalImportsStorageKey(scope);
  localStorage.setItem(key, '{damaged');
  await expect(savePersonalImportBatch(scope, rows())).rejects.toThrow('原始資料仍保留');
  expect(localStorage.getItem(key)).toBe('{damaged');
  localStorage.clear();
  const invalid = { ...rows()[0], id: 'bad', credits: undefined } as PersonalImportRow;
  await expect(savePersonalImportBatch(scope, [...rows(), invalid])).rejects.toThrow('學分數');
  expect(readPersonalImports(scope)).toEqual([]);
});
it('keeps an incoming changed classroom for review instead of silently discarding it', async () => {
  const course = (room: string) =>
    parsePersonalImport(`課程名稱,星期,開始節次,結束節次,教室\n資料庫,一,3,4,${room}`, {
      kind: 'timetable',
      schoolId: 'pu',
      academicYear: '115',
      semester: '1',
      periodProfile: 'pu',
    }).rows;
  await savePersonalImportBatch(scope, course('303'));
  await expect(savePersonalImportBatch(scope, course('505'))).rejects.toThrow();
  expect(readPersonalImports(scope)[0].location).toBe('303');
});

it('restores against the latest locked ledger, preserving existing links without masking grade conflicts', async () => {
  const linked = { ...rows()[0], linkedCourseId: 'currently-linked-class' };
  await savePersonalImportBatch(scope, [linked]);
  const original = readPersonalImports(scope);
  expect(
    await savePersonalImportBatch(scope, rows(), () => true, { restoreBackup: true }),
  ).toMatchObject({ added: 0, duplicates: 1 });
  expect(readPersonalImports(scope)).toEqual(original);
  await expect(
    savePersonalImportBatch(scope, rows('課程名稱,學分,成績\n資料庫,3,95'), () => true, {
      restoreBackup: true,
    }),
  ).rejects.toThrow('成績或學分不同');
  expect(readPersonalImports(scope)).toEqual(original);
});
