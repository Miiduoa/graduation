import {
  parsePersonalImportDocument,
  validatePersonalImportDocument,
  type PersonalImportDocument,
  type PersonalImportDocumentSection,
} from './documents';
import { personalImportHeaderField } from './parser';
import {
  PERSONAL_IMPORT_MAX_ROWS,
  type ImportIssue,
  type PersonalImportKind,
  type PersonalImportOptions,
  type PersonalImportRow,
} from './types';

export type DocumentImportSelection = { selected: string[]; headers: Record<string, number> };
export type DocumentHeaderSuggestion = {
  status: 'suggested' | 'ambiguous' | 'missing' | 'unreadable';
  line?: number;
  candidates: number[];
};

const fieldLabels: Record<string, string> = {
  title: '名稱', schoolId: '學校代碼（仍須核對校園）', academicYear: '學年度', semester: '學期',
  courseCode: '課號', teacher: '教師', className: '班級', location: '地點', dayOfWeek: '星期',
  startPeriod: '開始節次', endPeriod: '結束節次', periodLabel: '原始節次', periods: '節次',
  startTime: '開始時間', endTime: '結束時間', times: '時間', credits: '學分', grade: '成績',
  date: '日期', endDate: '結束日期', allDay: '全天',
};

/** Labels come from the same alias map used by the real parser, not a second guesser. */
export function documentImportColumnLabel(cell: string): string | null {
  const field = personalImportHeaderField(cell);
  return field ? fieldLabels[field] ?? field : null;
}

/** Recommend only a unique, complete header for this data type. Never change source cells. */
export function suggestDocumentImportHeader(
  section: PersonalImportDocumentSection,
  kind: PersonalImportKind,
): DocumentHeaderSuggestion {
  if (section.needsOcr) return { status: 'unreadable', candidates: [] };
  const candidates: number[] = [];
  for (let index = 0; index < section.rows.length; index++) {
    const row = section.rows[index];
    const fields = row.cells.map(personalImportHeaderField).filter((field): field is string => !!field);
    const known = new Set(fields);
    if (!known.has('title') || known.size !== fields.length) continue;
    const hasTime = known.has('times') || (known.has('startTime') && known.has('endTime'));
    const hasPeriod = known.has('periods') || (known.has('startPeriod') && known.has('endPeriod'));
    const matches = kind === 'grades'
      ? known.has('credits') && known.has('grade')
      : kind === 'timetable'
        ? known.has('dayOfWeek') && (hasTime || hasPeriod)
        : known.has('date') && (hasTime || known.has('allDay'));
    if (!matches) continue;
    candidates.push(row.line);
  }
  if (candidates.length === 1) {
    const index = section.rows.findIndex((row) => row.line === candidates[0]);
    if (!section.rows.slice(index + 1).some((row) => row.cells.some((cell) => cell.trim()))) {
      return { status: 'missing', candidates: [] };
    }
  }
  return candidates.length === 1
    ? { status: 'suggested', line: candidates[0], candidates }
    : { status: candidates.length ? 'ambiguous' : 'missing', candidates };
}

export type DocumentSectionReview = {
  id: string;
  rows: PersonalImportRow[];
  issues: ImportIssue[];
  error: string | null;
};
export type DocumentImportReview = {
  sections: DocumentSectionReview[];
  rows: PersonalImportRow[];
  issues: ImportIssue[];
  correctionCount: number;
  blockingMessage: string | null;
};

/** Local preview uses the real parser. No AI, network, storage or partial confirmation. */
export function reviewDocumentImportSelection(
  document: PersonalImportDocument,
  selection: DocumentImportSelection,
  options: PersonalImportOptions,
): DocumentImportReview {
  const result: DocumentImportReview = {
    sections: [], rows: [], issues: [], correctionCount: 0, blockingMessage: null,
  };
  try {
    validatePersonalImportDocument(document);
    if (!selection.selected.length) {
      result.blockingMessage = '請先選擇至少一個工作表或頁面。';
      return result;
    }
    if (new Set(selection.selected).size !== selection.selected.length ||
      selection.selected.some((id) => !document.sections.some((section) => section.id === id))) {
      result.blockingMessage = '選取內容已變更，請重新選擇工作表或頁面。';
      return result;
    }
    // Follow document order even when the user selects the last sheet first.
    for (const section of document.sections.filter((entry) => selection.selected.includes(entry.id))) {
      try {
        const header = selection.headers[section.id];
        if (!Number.isSafeInteger(header)) throw new Error('請先指定有效的標題列。');
        const parsed = parsePersonalImportDocument(document, section.id, header, options);
        if (!parsed.rows.length) throw new Error('這個範圍沒有資料，請確認標題列或取消勾選。');
        result.sections.push({ id: section.id, ...parsed, error: null });
        result.rows.push(...parsed.rows);
        result.issues.push(...parsed.issues);
      } catch (error) {
        result.sections.push({
          id: section.id, rows: [], issues: [],
          error: error instanceof Error ? error.message : '無法整理，請重新確認標題列。',
        });
      }
    }
    if (result.sections.some((section) => section.error)) {
      result.blockingMessage = '有選取範圍還不能整理，請調整標題列或取消勾選；不會只讀入其餘部分。';
    } else if (result.rows.length > PERSONAL_IMPORT_MAX_ROWS) {
      result.blockingMessage = '選取的內容超過 500 筆，請減少工作表或頁面，分次匯入。';
    }
    // Field errors remain editable in the next review step; they do not discard good records.
    result.correctionCount = new Set(result.issues.filter((issue) =>
      issue.severity === 'error' && issue.rowId,
    ).map((issue) => issue.rowId)).size;
  } catch {
    result.blockingMessage = '文件內容無法驗證，請重新選擇原始檔案。';
  }
  return result;
}
