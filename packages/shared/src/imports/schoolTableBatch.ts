import { parsePersonalImport } from './parser';
import type { SchoolPageTable } from './schoolPageTables';
import {
  PERSONAL_IMPORT_MAX_ROWS, PERSONAL_IMPORT_MAX_TEXT_LENGTH,
  type PersonalImportOptions, type PersonalImportRow, type ImportIssue,
} from './types';

export type SchoolTableChoice = { tableId: string; academicYear: string; semester: string };
export type SchoolTableBatchOptions = Pick<PersonalImportOptions, 'schoolId' | 'periodProfile' | 'source'> & {
  kind: 'timetable' | 'grades';
};
export type SchoolTableBatch = {
  rows: PersonalImportRow[];
  issues: ImportIssue[];
  tables: { id: string; label: string; rowCount: number }[];
};
export const SCHOOL_TABLE_BATCH_LIMIT = 12;

/** No persistence or network access. Every table retains its own headers, term and source lines. */
export function parseSchoolTableBatch(
  tables: readonly SchoolPageTable[],
  choices: readonly SchoolTableChoice[],
  options: SchoolTableBatchOptions,
): SchoolTableBatch {
  if (!choices.length || choices.length > SCHOOL_TABLE_BATCH_LIMIT)
    throw new Error('請選擇 1 至 12 張要核對的表格。');
  if (!options.schoolId.trim() || !['grades', 'timetable'].includes(options.kind))
    throw new Error('請先確認這次匯入的學校與資料類型。');
  const requested = new Set<string>();
  let textLength = 0;
  const sources = choices.map((choice) => {
    if (requested.has(choice.tableId)) throw new Error('同一張表格不能重複選取，請重新選擇。');
    requested.add(choice.tableId);
    const matches = tables.filter((table) => table.id === choice.tableId);
    if (matches.length !== 1) throw new Error('表格清單已變更，請重新選擇後再核對。');
    if (typeof choice.academicYear !== 'string' || typeof choice.semester !== 'string' ||
      choice.academicYear.length > 4 || choice.semester.length > 30)
      throw new Error('學年度或學期格式過長，請重新確認。');
    const table = matches[0];
    textLength += table.text.length;
    if (textLength > PERSONAL_IMPORT_MAX_TEXT_LENGTH)
      throw new Error('選取的表格合計超過文字上限，請減少表格後分批處理；這次未帶入部分資料。');
    return { table, choice };
  });
  // Preserve the displayed source order, not the order in which checkboxes were tapped.
  sources.sort((a, b) => tables.indexOf(a.table) - tables.indexOf(b.table));
  const rows: PersonalImportRow[] = [];
  const issues: ImportIssue[] = [];
  const summaries: SchoolTableBatch['tables'] = [];
  for (const { table, choice } of sources) {
    const index = tables.indexOf(table) + 1;
    const label = `表格 ${index}`;
    const parsed = parsePersonalImport(table.text, {
      ...options,
      academicYear: choice.academicYear.trim(), semester: choice.semester.trim(),
      source: { type: options.source?.type ?? 'paste', name: `${options.source?.name ?? '校務網頁'} · ${label}` },
    });
    if (!parsed.rows.length)
      throw new Error(`${label}沒有可核對的資料，請改選表格；這次未帶入其他表格的部分結果。`);
    if (rows.length + parsed.rows.length > PERSONAL_IMPORT_MAX_ROWS)
      throw new Error('多張表格合計超過 500 筆，請分批核對；這次未截斷或帶入部分資料。');
    const ids = new Map<string, string>();
    parsed.rows.forEach((row, rowIndex) => {
      if (ids.has(row.id)) throw new Error(`${label}的資料識別碼重複，請重新讀取。`);
      ids.set(row.id, `table-${index}-row-${rowIndex + 1}:${row.id}`);
    });
    for (const row of parsed.rows) {
      rows.push({ ...row, id: ids.get(row.id)!, source: { ...row.source } });
    }
    for (const issue of parsed.issues) {
      if (issue.rowId && !ids.has(issue.rowId))
        throw new Error(`${label}的錯誤無法對應資料列，請重新讀取。`);
      issues.push({ ...issue, ...(issue.rowId ? { rowId: ids.get(issue.rowId)! } : {}),
        message: `${label}：${issue.message}` });
    }
    summaries.push({ id: table.id, label: table.label, rowCount: parsed.rows.length });
  }
  // Missing terms and cross-school rows remain errors for the ordinary review/confirmation gate.
  // Duplicate source rows are retained; the existing ledger, not this reader, decides de-duplication.
  return { rows, issues, tables: summaries };
}
