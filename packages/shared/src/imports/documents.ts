import { parsePersonalImport, personalImportHeaderField } from './parser';
import {
  PERSONAL_IMPORT_MAX_ROWS,
  PERSONAL_IMPORT_MAX_TEXT_LENGTH,
  type ImportIssue,
  type PersonalImportOptions,
  type PersonalImportRow,
} from './types';

export const PERSONAL_IMPORT_DOCUMENT_LIMITS = {
  bytes: 8 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  zipEntries: 256,
  sheets: 12,
  pages: 20,
  rowsPerSection: 1_000,
  columns: 64,
  cells: 50_000,
  textCharacters: PERSONAL_IMPORT_MAX_TEXT_LENGTH,
  timeoutMs: 60_000,
} as const;

export type PersonalImportDocumentLine = { line: number; cells: string[] };
export type PersonalImportDocumentSection = {
  id: string;
  label: string;
  rows: PersonalImportDocumentLine[];
  needsOcr: boolean;
  warnings: string[];
};
export type PersonalImportDocument = {
  format: 'xlsx' | 'pdf';
  name: string;
  sections: PersonalImportDocumentSection[];
  warnings: string[];
};
/** Auto uses PDF text when present; OCR explicitly re-reads every page, including hybrid scans. */
export type PersonalImportDocumentReadOptions = {
  pdfMode?: 'auto' | 'ocr';
};

export class PersonalImportDocumentError extends Error {
  constructor(
    message: string,
    readonly code = 'unreadable',
  ) {
    super(message);
  }
}

export function personalImportDocumentFormat(name: string): 'xlsx' | 'pdf' | null {
  if (/\.xlsx$/i.test(name)) return 'xlsx';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return null;
}

export function validatePersonalImportDocumentFile(name: string, size: number): 'xlsx' | 'pdf' {
  const format = personalImportDocumentFormat(name);
  if (!format)
    throw new PersonalImportDocumentError(
      '請選擇 PDF 或 XLSX 檔案；舊版 XLS 請先另存為 XLSX。',
      'format',
    );
  if (!Number.isFinite(size) || size <= 0)
    throw new PersonalImportDocumentError('這個檔案沒有內容，請重新選擇。', 'empty');
  if (size > PERSONAL_IMPORT_DOCUMENT_LIMITS.bytes)
    throw new PersonalImportDocumentError('PDF／Excel 上限 8 MiB，請拆成較小的檔案。', 'limit');
  return format;
}

/** Validate messages crossing a worker/WebView boundary before storing them in a draft. */
export function validatePersonalImportDocument(value: unknown): PersonalImportDocument {
  const object = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item);
  const invalid = (): never => {
    throw new PersonalImportDocumentError('檔案讀取結果不完整，請重新選擇。', 'invalid-result');
  };
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) &&
    items.length <= 100 &&
    items.every((item) => typeof item === 'string' && item.length <= 1_000);
  if (
    !object(value) ||
    !['xlsx', 'pdf'].includes(String(value.format)) ||
    typeof value.name !== 'string' ||
    value.name.length > 1_000 ||
    !strings(value.warnings) ||
    !Array.isArray(value.sections)
  )
    invalid();
  const doc = value as unknown as PersonalImportDocument;
  if (
    !doc.sections.length ||
    doc.sections.length >
      (doc.format === 'pdf'
        ? PERSONAL_IMPORT_DOCUMENT_LIMITS.pages
        : PERSONAL_IMPORT_DOCUMENT_LIMITS.sheets)
  )
    invalid();
  let characters = 0;
  let cells = 0;
  const ids = new Set<string>();
  for (const section of doc.sections) {
    if (
      !object(section) ||
      typeof section.id !== 'string' ||
      section.id.length > 100 ||
      ids.has(section.id) ||
      typeof section.label !== 'string' ||
      section.label.length > 300 ||
      typeof section.needsOcr !== 'boolean' ||
      !strings(section.warnings) ||
      !Array.isArray(section.rows) ||
      section.rows.length > PERSONAL_IMPORT_DOCUMENT_LIMITS.rowsPerSection
    )
      invalid();
    ids.add(section.id);
    let previous = 0;
    for (const row of section.rows) {
      if (
        !object(row) ||
        !Number.isSafeInteger(row.line) ||
        row.line <= previous ||
        !Array.isArray(row.cells) ||
        row.cells.length > PERSONAL_IMPORT_DOCUMENT_LIMITS.columns ||
        !row.cells.every((cell) => typeof cell === 'string')
      )
        invalid();
      previous = row.line;
      cells += row.cells.length;
      characters += row.cells.reduce((count, cell) => count + cell.length, 0);
    }
    if (section.needsOcr && section.rows.length) invalid();
  }
  if (
    characters > PERSONAL_IMPORT_DOCUMENT_LIMITS.textCharacters ||
    cells > PERSONAL_IMPORT_DOCUMENT_LIMITS.cells
  )
    invalid();
  return doc;
}

/** The selected header is an original worksheet row or page-local text line, never a guessed schema. */
export function parsePersonalImportDocument(
  document: PersonalImportDocument,
  sectionId: string,
  headerLine: number,
  options: PersonalImportOptions,
): { rows: PersonalImportRow[]; issues: ImportIssue[] } {
  const doc = validatePersonalImportDocument(document);
  const section = doc.sections.find((item) => item.id === sectionId);
  if (!section)
    throw new PersonalImportDocumentError('請選擇要讀取的工作表或 PDF 頁面。', 'selection');
  if (section.needsOcr)
    throw new PersonalImportDocumentError(
      '這一頁沒有可讀取的文字。請將該頁截圖，再使用「選擇截圖」辨識。',
      'needs-ocr',
    );
  const start = section.rows.findIndex((item) => item.line === headerLine);
  if (start < 0) throw new PersonalImportDocumentError('請選擇欄位標題所在的列。', 'selection');
  const selected = section.rows.slice(start);
  if (selected.length > PERSONAL_IMPORT_MAX_ROWS + 1)
    throw new PersonalImportDocumentError('這張表超過 500 筆，請先拆分後再匯入。', 'limit');
  const lineMap: number[] = [];
  const text = selected
    .map((row) => {
      const csv = row.cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');
      for (let index = 0; index < csv.split('\n').length; index += 1) lineMap.push(row.line);
      return csv;
    })
    .join('\n');
  const result = parsePersonalImport(text, {
    ...options,
    source: { type: 'file', name: `${doc.name} · ${section.label}`.slice(0, 1_000) },
  });
  if (
    selected[0].cells.filter((cell) => personalImportHeaderField(cell)).length < 2 ||
    result.rows.some((row) => row.source.line === 1)
  )
    throw new PersonalImportDocumentError(
      '這一列沒有可辨識的欄位名稱，請選擇包含課程名稱、學分、成績或日期的標題列。',
      'header',
    );
  for (const row of result.rows) row.source.line = lineMap[row.source.line - 1] ?? row.source.line;
  const warnings = [...doc.warnings, ...section.warnings];
  if (start) warnings.push(`已略過標題列之前的 ${start} 列，請確認沒有遺漏資料。`);
  result.issues.unshift(
    ...warnings.map(
      (message): ImportIssue => ({ code: 'document-review', severity: 'warning', message }),
    ),
  );
  return result;
}

/** PDF text items preserve positions. Split only explicit gaps; do not infer a weekly grid or missing cells. */
export function normalizePersonalImportPdfText(
  items: readonly { str: string; x: number; y: number; width: number; height: number }[],
): PersonalImportDocumentLine[] {
  const lines: Array<{ y: number; height: number; items: (typeof items)[number][] }> = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!item.str.trim()) continue;
    if (![item.x, item.y, item.width, item.height].every(Number.isFinite))
      throw new PersonalImportDocumentError('PDF 的文字位置資料不完整，請改用截圖。', 'layout');
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <=
        Math.max(2, Math.min(candidate.height, item.height) * 0.25),
    );
    if (line) line.items.push(item);
    else lines.push({ y: item.y, height: Math.abs(item.height) || 10, items: [item] });
  }
  return lines.map((line, index) => {
    const cells: string[] = [];
    let right = -Infinity;
    for (const item of line.items.sort((a, b) => a.x - b.x)) {
      const gap = item.x - right;
      if (!cells.length || gap > Math.max(8, Math.abs(item.height) * 0.7)) cells.push(item.str);
      else cells[cells.length - 1] += (gap > 1 ? ' ' : '') + item.str;
      right = Math.max(right, item.x + item.width);
    }
    return { line: index + 1, cells: cells.map((cell) => cell.trim()) };
  });
}
