import type { PersonalImportRow } from './types';

/** Column names are shared by Web and App exports; source screenshots are never exported. */
export const PERSONAL_IMPORT_CSV_FIELDS = [
  'kind',
  'title',
  'schoolId',
  'academicYear',
  'semester',
  'courseCode',
  'teacher',
  'className',
  'location',
  'dayOfWeek',
  'startPeriod',
  'endPeriod',
  'startTime',
  'endTime',
  'credits',
  'grade',
  'date',
  'endDate',
  'allDay',
  'periodLabel',
] as const satisfies readonly (keyof PersonalImportRow)[];

/**
 * 個人匯入解析器只接受十進位數字；JS 會把極小或極大的數字轉成指數記法（如 1e-7），
 * 匯出後再匯入會遺失該欄。這裡依 String() 的最短表示做精確位移，不經浮點運算。
 */
function decimalNumberText(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = '', exponentText] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText);
  const expanded = point <= 0
    ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length
      ? digits + '0'.repeat(point - digits.length)
      : digits.slice(0, point) + '.' + digits.slice(point);
  return sign + expanded;
}

function quoteCsv(value: unknown): string {
  let text = typeof value === 'number' && Number.isFinite(value)
    ? decimalNumberText(value)
    : String(value ?? '');
  // A quoted CSV cell may still be evaluated as a formula by spreadsheet applications.
  // Prefix a text marker even when whitespace or invisible characters precede the formula.
  if (typeof value === 'string' && /^[\s\u200B-\u200D\uFEFF]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

/** UTF-8 BOM and CRLF preserve Chinese characters when opening the file in Excel. */
export function serializePersonalImportsCsv(
  rows: readonly PersonalImportRow[],
  fields: readonly (typeof PERSONAL_IMPORT_CSV_FIELDS)[number][] = PERSONAL_IMPORT_CSV_FIELDS,
): string {
  return '\uFEFF' + [
    fields.join(','),
    ...rows.map((row) => fields.map((field) => quoteCsv(row[field])).join(',')),
  ].join('\r\n');
}
