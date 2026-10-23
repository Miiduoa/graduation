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

function quoteCsv(value: unknown): string {
  let text = String(value ?? '');
  // A quoted CSV cell may still be evaluated as a formula by spreadsheet applications.
  // Prefix a text marker even when whitespace or invisible characters precede the formula.
  if (typeof value === 'string' && /^[\s\u200B-\u200D\uFEFF]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}

/** UTF-8 BOM and CRLF preserve Chinese characters when opening the file in Excel. */
export function serializePersonalImportsCsv(rows: readonly PersonalImportRow[]): string {
  return '\uFEFF' + [
    PERSONAL_IMPORT_CSV_FIELDS.join(','),
    ...rows.map((row) => PERSONAL_IMPORT_CSV_FIELDS.map((field) => quoteCsv(row[field])).join(',')),
  ].join('\r\n');
}
