import { isPeriodProfileId, slotIndexForLabel, type PeriodProfileId } from '../timetable/schoolPeriods';
import { readImportDelimitedRecords, type ImportDelimitedRecord } from './aiDelimitedText';
import type { ImportIssue, PersonalImportKind, PersonalImportRow } from './types';

/** Coverage is not accuracy: absent/uncertain values still need the existing editor. */
export type PersonalImportAiTableAudit =
  | { status: 'unavailable' }
  | {
      status: 'matched' | 'mismatch';
      expectedRecords: number;
      matchedRecords: number;
      missingLines: number[];
      unexpectedRowIds: string[];
      sourceLines: Record<string, number>;
    };

type Field = 'title' | 'courseCode' | 'credits' | 'grade' | 'dayOfWeek' |
  'startTime' | 'endTime' | 'date' | 'startPeriod' | 'endPeriod';
type Header = { columns: number; fields: Map<Field, number> };
type SourceRecord = {
  cells: string[]; evidence: string; title: string; line: number;
  firstExcerpt?: string; prefixLength: number;
};
const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const compact = (value: string) => normalized(value).replace(/\s+/gu, '');
const aliases: Record<Field, readonly string[]> = {
  title: ['課程名稱', '科目名稱', '活動名稱', '名稱', 'title', 'course', 'course name', 'event name'],
  courseCode: ['課號', '科目代碼', '課程代碼', 'course code'],
  credits: ['學分', '學分數', 'credits', 'credit'],
  grade: ['成績', '分數', 'grade', 'score'],
  dayOfWeek: ['星期', '星期幾', 'weekday', 'day'],
  startTime: ['開始時間', 'start time'],
  endTime: ['結束時間', 'end time'],
  date: ['日期', '活動日期', 'date'],
  startPeriod: ['開始節次', 'start period'],
  endPeriod: ['結束節次', 'end period'],
};
const relevant: Record<PersonalImportKind, readonly Field[]> = {
  timetable: ['title', 'courseCode', 'dayOfWeek', 'startTime', 'endTime', 'startPeriod', 'endPeriod'],
  grades: ['title', 'courseCode', 'credits', 'grade'],
  events: ['title', 'date', 'startTime', 'endTime'],
};
const discriminators: Record<PersonalImportKind, readonly Field[]> = {
  timetable: ['dayOfWeek', 'startTime', 'endTime', 'startPeriod', 'endPeriod'],
  grades: ['credits', 'grade'],
  events: ['date', 'startTime', 'endTime'],
};

function headerOf(cells: string[], kind: PersonalImportKind): Header | null {
  const fields = new Map<Field, number>();
  for (let index = 0; index < cells.length; index++) {
    const name = normalized(cells[index]);
    const field = relevant[kind].find((key) => aliases[key].includes(name));
    if (!field) continue;
    if (fields.has(field)) return null; // Never guess which repeated column owns a value.
    fields.set(field, index);
  }
  return fields.has('title') && discriminators[kind].some((key) => fields.has(key))
    ? { columns: cells.length, fields } : null;
}

function contentRecords(text: string, delimiter: ',' | '\t'): ImportDelimitedRecord[] | null {
  const records = readImportDelimitedRecords(text, delimiter)?.filter((record) =>
    text.slice(record.start, record.contentEnd).trim(),
  );
  if (!records) return null;
  if (records[0]?.cells.length === 1 && /^【[^\r\n【】]+】$/u.test(records[0].cells[0].trim()))
    records.shift();
  return records;
}

function sourceTable(text: string, kind: PersonalImportKind, context: string) {
  const tables: Array<{ header: Header; records: SourceRecord[] }> = [];
  for (const delimiter of ['\t', ','] as const) {
    const records = contentRecords(text, delimiter);
    if (!records?.length) continue;
    let header = headerOf(records[0].cells, kind);
    if (header) records.shift();
    else if (context) {
      const reference = contentRecords(context, delimiter);
      if (reference?.length === 1) header = headerOf(reference[0].cells, kind);
    }
    if (!header || !records.length) continue;
    const titleColumn = header.fields.get('title')!;
    if (records.some((record) => record.cells.length !== header.columns ||
      !record.cells[titleColumn].trim() || headerOf(record.cells, kind))) continue;
    // Totals, legends and sectioned documents need a different contract. Do not
    // label a partial scan as complete coverage or count a summary as a course.
    if (records.some((record) => /^(?:合計|總計|小計|總學分|總學分數|學期平均|total|subtotal)$/iu
      .test(record.cells[titleColumn].trim()))) continue;
    tables.push({ header, records: records.map((record, index) => ({
      cells: record.cells,
      // The first data row may quote its source header too; never another data row.
      firstExcerpt: index === 0 ? compact(text.slice(0, record.contentEnd)) : undefined,
      prefixLength: compact(text.slice(0, record.start)).length,
      evidence: compact(text.slice(record.start, record.contentEnd)),
      title: compact(record.cells[titleColumn]),
      line: text.slice(0, record.start).split('\n').length,
    })) });
  }
  return tables.length === 1 ? tables[0] : null;
}

function dayValue(text: string): number | null {
  const value = normalized(text).replace(/^(?:星期|禮拜|週|周)\s*/u, '');
  if (/^[1-7]$/u.test(value)) return Number(value);
  const chinese = ['一', '二', '三', '四', '五', '六', '日'];
  if (value === '天') return 7;
  const chineseIndex = chinese.indexOf(value);
  if (chineseIndex >= 0) return chineseIndex + 1;
  const english = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const index = english.findIndex((day) => value === day || value === day.slice(0, 3));
  return index >= 0 ? index + 1 : null;
}

function cellSupports(field: Field, cell: string, value: unknown, profile?: PeriodProfileId): boolean {
  // Blanks deliberately stay editable. An audit must not defeat uncertainFields.
  if (value === undefined || value === null || value === '') return true;
  if (!cell.trim()) return false;
  const text = normalized(cell);
  if (field === 'startPeriod' || field === 'endPeriod') {
    const label = /^(?:第\s*)?(\d{1,2}|[a-z])(?:\s*節)?$/iu.exec(text)?.[1];
    if (!label) return true;
    const slot = isPeriodProfileId(profile) ? slotIndexForLabel(label.toUpperCase(), profile)
      : /^\d+$/u.test(label) ? Number(label) : undefined;
    return slot === undefined || slot === value;
  }
  if (field === 'credits') {
    const number = /^(\d+(?:\.\d+)?)\s*(?:學分)?$/u.exec(text);
    return !number || Number(number[1]) === value;
  }
  if (field === 'dayOfWeek') {
    const day = dayValue(text);
    return day === null || day === value; // A multi-day cell is not a scalar weekday.
  }
  if (field === 'startTime' || field === 'endTime') {
    const clock = /^(\d{1,2}):(\d{2})$/u.exec(text);
    return !clock || `${clock[1].padStart(2, '0')}:${clock[2]}` === value;
  }
  if (field === 'date') {
    const date = /^(\d{3,4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/u.exec(text);
    if (!date) return true;
    const year = Number(date[1]) + (date[1].length === 3 ? 1911 : 0);
    return `${year}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` === value;
  }
  return compact(cell) === compact(String(value));
}

/**
 * Compare already-validated AI rows with one unambiguous, labelled CSV/TSV table.
 * Header context supplies column roles only; evidence must belong to this source.
 * Matching is by logical record, not unique course name or the model's row count.
 */
export function auditPersonalImportAiTable(
  text: string,
  rows: readonly PersonalImportRow[],
  kind: PersonalImportKind,
  columnContext = '',
  periodProfile?: PeriodProfileId,
): PersonalImportAiTableAudit {
  if (text.length > 8_000 || columnContext.length > 8_000 || rows.length > 80 || !relevant[kind])
    return { status: 'unavailable' };
  const table = sourceTable(text, kind, columnContext);
  if (!table) return { status: 'unavailable' };
  const { header, records } = table;
  const candidates = rows.map((row) => {
    const evidence = compact(row.source.rawText);
    if (!evidence || row.kind !== kind) return [];
    return records.flatMap((record, index) =>
      (record.evidence.includes(evidence) || (record.firstExcerpt?.indexOf(evidence,
        Math.max(0, record.prefixLength - evidence.length + 1)) ?? -1) >= 0) &&
      evidence.replace(/""/gu, '"').includes(record.title) &&
      [...header.fields].every(([field, column]) => cellSupports(field, record.cells[column], row[field], periodProfile))
        ? [index] : [],
    );
  });
  // Maximum matching preserves multiplicity for identical source records. A
  // duplicated answer for course A cannot cover a missing course B.
  const owners = Array<number>(records.length).fill(-1);
  const assign = (row: number, seen: Set<number>): boolean => {
    const free = candidates[row].find((record) => !seen.has(record) && owners[record] < 0);
    if (free !== undefined) {
      owners[free] = row;
      return true;
    }
    for (const record of candidates[row]) {
      if (seen.has(record)) continue;
      seen.add(record);
      if (owners[record] < 0 || assign(owners[record], seen)) {
        owners[record] = row;
        return true;
      }
    }
    return false;
  };
  for (let row = 0; row < rows.length; row++) assign(row, new Set());
  const assigned = new Map<number, number>();
  owners.forEach((row, record) => { if (row >= 0) assigned.set(row, record); });
  const missingLines = records.filter((_, index) => owners[index] < 0).map((record) => record.line);
  const unexpectedRowIds = rows.filter((_, index) => !candidates[index].length ||
    (kind === 'grades' && !assigned.has(index)),
  ).map((row) => row.id);
  const sourceLines: Record<string, number> = Object.create(null);
  rows.forEach((row, index) => {
    const record = assigned.get(index) ?? candidates[index][0];
    if (record !== undefined) sourceLines[row.id] = records[record].line;
  });
  return {
    status: missingLines.length || unexpectedRowIds.length ? 'mismatch' : 'matched',
    expectedRecords: records.length,
    matchedRecords: records.length - missingLines.length,
    missingLines,
    unexpectedRowIds,
    sourceLines,
  };
}

/** Do not include names, grades or model output in an error message. */
export function personalImportAiTableAuditMessage(
  audit: PersonalImportAiTableAudit,
  startLine = 1,
): string {
  if (audit.status !== 'mismatch') return '';
  const lines = audit.missingLines.slice(0, 5).map((line) => line + startLine - 1).join('、');
  return lines
    ? `原始文字第 ${lines}${audit.missingLines.length > 5 ? ' 等' : ''} 行尚未正確對應到整理結果。請縮小範圍或改用表格匯入；這次不會保留部分結果。`
    : '整理結果有重複資料或欄位與原始資料列不符。請縮小範圍或改用表格匯入；這次不會保留部分結果。';
}

export function personalImportAiTableCoverageNotice(records: number, partial = false): ImportIssue {
  return {
    code: 'ai-table-coverage',
    severity: 'warning',
    message: `已逐列對照${partial ? '其中 ' : ' '}${records} 筆表格資料；來源都有對應草稿，但欄位內容與同列多個時段仍需核對。`,
  };
}
