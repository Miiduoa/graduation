import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseSchoolTableBatch } from '@campus/shared/src/imports/schoolTableBatch';
import type { SchoolPageTable } from '@campus/shared';
import { appendPersonalImports, loadPersonalImports, undoLastPersonalImport } from '../services/personalImports';
import { previewPortalReimport, commitPortalReimport, undoPortalReimport } from '../services/portalReimport';

const scope = { owner: 'nuni:batch-owner', schoolId: 'pu' };
const source = { type: 'paste' as const, name: '校務成績表' };
function table(id: string, title = '統計學', grade = '80', extra = ''): SchoolPageTable {
  return { id, label: id, layout: 'list', rowCount: 1,
    text: `課程名稱,學分,成績,課號,班級${extra ? ',學校代碼' : ''}\n${title},3,${grade},STAT01,三B${extra ? ',' + extra : ''}` };
}
function batch(firstYear = '114', firstSemester = '2', secondYear = '115', secondSemester = '1', second = table('b', '統計學', '90')) {
  return parseSchoolTableBatch([table('a'), second], [
    { tableId: 'a', academicYear: firstYear, semester: firstSemester },
    { tableId: 'b', academicYear: secondYear, semester: secondSemester },
  ], { kind: 'grades', schoolId: scope.schoolId, source });
}
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

// The native storage adapter is mocked by the ordinary Jest setup; the parser,
// ledger lock, planner, reimport service and rollback implementation are real.
test('persists same-name records from two academic terms in one durable batch', async () => {
  const prepared = batch();
  expect(prepared.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  const result = await appendPersonalImports(scope, prepared.rows);
  const stored = await loadPersonalImports(scope);
  expect(result).toMatchObject({ added: 2, duplicates: 0 });
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  expect(stored.batches).toHaveLength(1);
  expect(stored.records.map((row) => [row.academicYear, row.semester, row.grade])).toEqual([
    ['114', '2', '80'], ['115', '1', '90'],
  ]);
  expect(new Set(stored.records.map((row) => row.id)).size).toBe(2);
  expect(stored.records[1].source).toMatchObject({ name: '校務成績表 · 表格 2', line: 2 });
});

test('a repeat capture with new draft IDs does not duplicate existing records or write again', async () => {
  await appendPersonalImports(scope, batch().rows);
  const before = await loadPersonalImports(scope);
  jest.mocked(AsyncStorage.setItem).mockClear();
  const repeated = batch();
  repeated.rows.forEach((row) => { row.id += ':new-capture'; });
  const result = await appendPersonalImports(scope, repeated.rows);
  expect(result).toMatchObject({ added: 0, duplicates: 2 });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await loadPersonalImports(scope)).toEqual(before);
});

test('identical source tables in one semester are deduplicated only by the actual ledger', async () => {
  const prepared = batch('115', '1', '115', '1', table('b'));
  expect(prepared.rows).toHaveLength(2);
  const result = await appendPersonalImports(scope, prepared.rows);
  expect(result).toMatchObject({ added: 1, duplicates: 1 });
  const stored = await loadPersonalImports(scope);
  expect(stored.records).toHaveLength(1);
  expect(stored.records[0].source.name).toBe('校務成績表 · 表格 1');
});

test('invalid data in the second table prevents a partial write of the first', async () => {
  const prepared = batch('114', '2', '115', '1', table('b', '統計學', '101'));
  await expect(appendPersonalImports(scope, prepared.rows)).rejects.toThrow();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('conflicting scores for one same-term course cannot silently overwrite or partially insert', async () => {
  await expect(appendPersonalImports(scope, batch('115', '1', '115', '1').rows)).rejects.toThrow();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('a cross-school second row prevents every write in the combined operation', async () => {
  const prepared = batch('114', '2', '115', '1', table('b', '英文', '90', 'nthu'));
  await expect(appendPersonalImports(scope, prepared.rows)).rejects.toThrow(/學校/);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('inactive owner scope cannot commit an otherwise valid batch', async () => {
  await expect(appendPersonalImports(scope, batch().rows, () => false)).rejects.toThrow(/帳號|學校/);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a failed storage operation leaves no half-batch and can be deliberately retried', async () => {
  const prepared = batch();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(appendPersonalImports(scope, prepared.rows)).rejects.toThrow('disk full');
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  expect((await appendPersonalImports(scope, prepared.rows)).added).toBe(2);
  expect((await loadPersonalImports(scope)).records).toHaveLength(2);
});

test('undo removes both terms from only the new batch and preserves earlier imported history', async () => {
  const previous = batch('113', '1', '113', '2');
  await appendPersonalImports(scope, previous.rows);
  const before = await loadPersonalImports(scope);
  const result = await appendPersonalImports(scope, batch().rows);
  const batchId = result.ledger.batches[result.ledger.batches.length - 1].id;
  expect((await undoLastPersonalImport(scope, batchId)).removed).toBe(2);
  expect((await loadPersonalImports(scope)).records).toEqual(before.records);
});

test('the real reimport service handles a mixed-term update and addition as one reversible transaction', async () => {
  await appendPersonalImports(scope, batch().rows.slice(0, 1));
  const before = await loadPersonalImports(scope);
  const incoming = batch();
  incoming.rows[0].grade = '88';
  const preview = await previewPortalReimport(scope, incoming.rows);
  jest.mocked(AsyncStorage.setItem).mockClear();
  const receipt = await commitPortalReimport(scope, preview, { [incoming.rows[0].id]: 'replace' });
  expect(receipt).toMatchObject({ added: 1, updated: 1 });
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  const stored = await loadPersonalImports(scope);
  expect(stored.records.find((row) => row.id === before.records[0].id)?.grade).toBe('88');
  expect(stored.records.find((row) => row.academicYear === '115')?.grade).toBe('90');
  expect(await undoPortalReimport(scope, receipt)).toEqual({ removed: 1, restored: 1 });
  expect((await loadPersonalImports(scope)).records).toEqual(before.records);
});
