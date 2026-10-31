import { expect, it } from 'vitest';
import { parseSchoolTableBatch, type SchoolTableChoice } from '@campus/shared/src/imports/schoolTableBatch';
import type { SchoolPageTable } from '@campus/shared';

const options = { kind: 'grades' as const, schoolId: 'pu', source: { type: 'paste' as const, name: '本人校務頁面' } };
function table(id: string, text = '課程名稱,學分,成績\n統計學,3,80'): SchoolPageTable {
  return { id, label: id, text, rowCount: 1, layout: 'list' };
}
const choice = (tableId: string, academicYear = '115', semester = '1'): SchoolTableChoice => ({ tableId, academicYear, semester });
const parse = (tables: SchoolPageTable[], choices: SchoolTableChoice[]) => parseSchoolTableBatch(tables, choices, options);

it('keeps same-name courses from two semesters as two independently scoped rows', () => {
  const result = parse([table('a'), table('b')], [choice('a', '114', '2'), choice('b')]);
  expect(result.rows).toHaveLength(2);
  expect(result.rows.map((row) => [row.title, row.academicYear, row.semester])).toEqual([['統計學', '114', '2'], ['統計學', '115', '1']]);
  expect(new Set(result.rows.map((row) => row.id)).size).toBe(2);
});
it('uses each table header independently instead of concatenating dissimilar CSV headers', () => {
  const result = parse([table('a'), table('b', '成績,課程名稱,學分\n90,英文,2')], [choice('a'), choice('b')]);
  expect(result.rows[1]).toMatchObject({ title: '英文', grade: '90', credits: 2 });
});
it('uses source order rather than the order in which tables were selected', () => {
  const result = parse([table('a'), table('b', '課程名稱,學分,成績\n英文,2,91')], [choice('b'), choice('a')]);
  expect(result.rows.map((row) => row.title)).toEqual(['統計學', '英文']);
});
it('does not include unselected tables', () => {
  expect(parse([table('a'), table('b')], [choice('b')]).rows).toHaveLength(1);
});
it('preserves source text and table-local source lines', () => {
  const result = parse([table('a'), table('b')], [choice('a'), choice('b')]);
  expect(result.rows[0].source).toMatchObject({ name: '本人校務頁面 · 表格 1', line: 2, rawText: '統計學,3,80' });
  expect(result.rows[1].source).toMatchObject({ name: '本人校務頁面 · 表格 2', line: 2, rawText: '統計學,3,80' });
});
it('retains original row-level terms instead of overriding them with a table fallback', () => {
  const result = parse([table('a', '課程名稱,學分,成績,學年度,學期\n統計學,3,80,113,2')], [choice('a')]);
  expect(result.rows[0]).toMatchObject({ academicYear: '113', semester: '2' });
});
it('keeps missing terms as repairable errors, not guesses from another table', () => {
  const result = parse([table('a'), table('b')], [choice('a'), choice('b', '', '')]);
  expect(result.rows[1]).toMatchObject({ academicYear: '', semester: '' });
  expect(result.issues.some((issue) => issue.rowId === result.rows[1].id && issue.code === 'invalid-year')).toBe(true);
  expect(result.issues.some((issue) => issue.rowId === result.rows[1].id && issue.code === 'invalid-semester')).toBe(true);
});
it('preserves zero scores, fractional credits, and literal letter grades', () => {
  const result = parse([table('a', '課程名稱,學分,成績\n體育,0.5,0\n英文,2,A+')], [choice('a')]);
  expect(result.rows[0]).toMatchObject({ credits: 0.5, grade: '0' });
  expect(result.rows[1].grade).toBe('A+');
});
it('remaps field errors to only the affected source table row', () => {
  const result = parse([table('a'), table('b', '課程名稱,學分,成績\n英文,3O,90')], [choice('a'), choice('b')]);
  const invalid = result.issues.filter((issue) => issue.severity === 'error');
  expect(invalid.length).toBeGreaterThan(0);
  expect(invalid.every((issue) => issue.rowId === result.rows[1].id)).toBe(true);
  expect(invalid.every((issue) => issue.message.startsWith('表格 2：'))).toBe(true);
});
it('retains structural errors as global blockers, not repairable row warnings', () => {
  const result = parse([table('a'), table('b', '課程名稱,學分,成績,成績\n英文,2,80,90')], [choice('a'), choice('b')]);
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'duplicate-header', severity: 'error' }));
  expect(result.issues.find((issue) => issue.code === 'duplicate-header')?.rowId).toBeUndefined();
});
it('does not relabel a row that belongs to a different school', () => {
  const result = parse([table('a', '課程名稱,學分,成績,學校代碼\n英文,2,80,nthu')], [choice('a')]);
  expect(result.rows[0].schoolId).toBe('nthu');
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'school-mismatch', severity: 'error', rowId: result.rows[0].id }));
});
it('retains duplicate records for ordinary review and ledger deduplication', () => {
  const result = parse([table('a'), table('b')], [choice('a'), choice('b')]);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].source.name).not.toBe(result.rows[1].source.name);
});
it('supports a quoted multiline title without losing source-local line numbers', () => {
  const result = parse([table('a', '課程名稱,學分,成績\n"專題\n研究",3,85\n英文,2,80')], [choice('a')]);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0].source.rawText).toContain('\n');
  expect(result.rows[1].source.line).toBe(4);
});
it('refuses empty selections', () => { expect(() => parse([table('a')], [])).toThrow(/選擇/); });
it('refuses nonexistent source IDs', () => { expect(() => parse([table('a')], [choice('missing')])).toThrow(/清單已變更/); });
it('refuses duplicate selected IDs', () => { expect(() => parse([table('a')], [choice('a'), choice('a')])).toThrow(/重複選取/); });
it('refuses ambiguous candidate IDs', () => { expect(() => parse([table('a'), table('a')], [choice('a')])).toThrow(/清單已變更/); });
it('bounds the number of selected tables', () => {
  const tables = Array.from({ length: 13 }, (_, i) => table(String(i)));
  expect(() => parse(tables, tables.map((item) => choice(item.id)))).toThrow(/12/);
});
it('bounds the total input length before returning any rows', () => {
  const tables = [table('a', 'x'.repeat(100001)), table('b', 'x'.repeat(100001))];
  expect(() => parse(tables, [choice('a'), choice('b')])).toThrow(/文字上限/);
});
it('refuses an empty second table instead of returning a successful first-table partial result', () => {
  expect(() => parse([table('a'), table('b', '課程名稱,學分,成績')], [choice('a'), choice('b')])).toThrow(/表格 2沒有/);
});
it('bounds actual combined rows even when table metadata underreports the count', () => {
  const rows = (n: number) => '課程名稱,學分,成績\n' + Array.from({ length: n }, (_, i) => `科目${i},1,80`).join('\n');
  expect(() => parse([table('a', rows(250)), table('b', rows(251))], [choice('a'), choice('b')])).toThrow(/500/);
});
it('accepts exactly 500 rows without truncation', () => {
  const data = '課程名稱,學分,成績\n' + Array.from({ length: 250 }, (_, i) => `科目${i},1,80`).join('\n');
  expect(parse([table('a', data), table('b', data)], [choice('a'), choice('b')]).rows).toHaveLength(500);
});
it('does not mutate captured tables, choices, or options', () => {
  const tables = [table('a'), table('b')], choices = [choice('b'), choice('a')];
  const before = JSON.stringify({ tables, choices, options });
  parse(tables, choices);
  expect(JSON.stringify({ tables, choices, options })).toBe(before);
});
it('rejects a missing school and oversized fallback fields', () => {
  expect(() => parseSchoolTableBatch([table('a')], [choice('a')], { ...options, schoolId: '' })).toThrow(/學校/);
  expect(() => parse([table('a')], [choice('a', '12345')])).toThrow(/過長/);
});
it('retains distinct timetable meetings and their school-specific period mappings', () => {
  const a = table('a', '課程名稱,星期,開始節次,結束節次\n程式設計,一,3,4');
  const b = table('b', '課程名稱,星期,開始節次,結束節次\n程式設計,三,5,6');
  const result = parseSchoolTableBatch([a, b], [choice('a'), choice('b')], { ...options, kind: 'timetable', periodProfile: 'pu' });
  expect(result.rows.map((row) => row.dayOfWeek)).toEqual([1, 3]);
  expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
});
