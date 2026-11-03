import { describe, expect, it } from 'vitest';
import {
  documentImportColumnLabel,
  reviewDocumentImportSelection,
  suggestDocumentImportHeader,
} from '@campus/shared/src/imports/documentReview';
import type { PersonalImportDocument, PersonalImportDocumentSection } from '@campus/shared/src/imports/documents';
import type { PersonalImportOptions } from '@campus/shared/src/imports/types';

const options: PersonalImportOptions = { kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1' };
const section = (rows: string[][], id = 'one'): PersonalImportDocumentSection => ({
  id, label: id, warnings: [], needsOcr: false,
  rows: rows.map((cells, index) => ({ line: index * 2 + 1, cells })),
});
const document = (...sections: PersonalImportDocumentSection[]): PersonalImportDocument => ({
  name: '成績.xlsx', format: 'xlsx', warnings: [], sections,
});
const grades = () => section([['成績單'], ['課程名稱', '學分', '成績'], ['資料庫', '3', '85']]);
const inspect = (doc: PersonalImportDocument, selected = ['one'], headers: Record<string, number> = { one: 3 }) =>
  reviewDocumentImportSelection(doc, { selected, headers }, options);

describe('document header recommendations', () => {
  it('finds a unique type-specific header behind a cover row without mutating input', () => {
    const input = grades(); const before = JSON.stringify(input);
    expect(suggestDocumentImportHeader(input, 'grades')).toEqual({ status: 'suggested', line: 3, candidates: [3] });
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    ['timetable', ['課程名稱', '星期', '開始節次', '結束節次']],
    ['timetable', ['課程名稱', '星期', '上課時間']],
    ['events', ['活動名稱', '日期', '全天']],
    ['events', ['活動名稱', '日期', '開始時間', '結束時間']],
  ] as const)('recognizes complete %s columns', (kind, cells) => {
    expect(suggestDocumentImportHeader(section([[...cells], ['資料']]), kind).line).toBe(1);
  });
  it('does not use grades as a timetable header or incomplete aliases as a complete header', () => {
    expect(suggestDocumentImportHeader(grades(), 'timetable').status).toBe('missing');
    expect(suggestDocumentImportHeader(section([['課程名稱', '教師'], ['資料庫', '王老師']]), 'grades').status).toBe('missing');
  });
  it('does not silently choose among repeated headers or duplicate mapped columns', () => {
    const repeated = section([['課程名稱', '學分', '成績'], ['甲', '3', '85'], ['課名', '學分', '成績'], ['乙', '2', '90']]);
    expect(suggestDocumentImportHeader(repeated, 'grades')).toEqual({ status: 'ambiguous', candidates: [1, 5] });
    expect(suggestDocumentImportHeader(section([['課名', '學分', '學分數', '成績'], ['甲', '2', '3', '85']]), 'grades').status).toBe('missing');
  });
  it('requires content after the header and respects unreadable pages', () => {
    expect(suggestDocumentImportHeader(section([['課名', '學分', '成績']]), 'grades').status).toBe('missing');
    expect(suggestDocumentImportHeader({ ...grades(), needsOcr: true, rows: [] }, 'grades').status).toBe('unreadable');
  });
  it('shares normalized aliases with the parser and does not claim unknown columns are mapped', () => {
    expect(documentImportColumnLabel('Course Name')).toBe('名稱');
    expect(documentImportColumnLabel('學分數')).toBe('學分');
    expect(documentImportColumnLabel('班排名')).toBeNull();
  });
});

describe('real parsed document preview', () => {
  it('previews the same original values, campus and line numbers used for the draft', () => {
    const doc = document(grades()); const before = JSON.stringify(doc);
    const result = inspect(doc);
    expect(result.blockingMessage).toBeNull();
    expect(result.rows[0]).toMatchObject({ title: '資料庫', credits: 3, grade: '85', schoolId: 'pu', source: { line: 5 } });
    expect(result.correctionCount).toBe(0);
    expect(result.issues.some((issue) => issue.code === 'document-review')).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('preserves document order instead of checkbox click order', () => {
    const second = section([['課程名稱', '學分', '成績'], ['英文', '2', '90']], 'two');
    const result = inspect(document(grades(), second), ['two', 'one'], { one: 3, two: 1 });
    expect(result.rows.map((row) => row.title)).toEqual(['資料庫', '英文']);
  });
  it('previews invalid fields as editable records and counts each affected record only once', () => {
    const result = inspect(document(section([['說明'], ['課名', '學分', '成績'], ['資料庫', '錯誤學分', '']])));
    expect(result.blockingMessage).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].credits).toBeUndefined();
    expect(result.correctionCount).toBe(1);
    expect(result.issues.filter((issue) => issue.severity === 'error').length).toBeGreaterThan(1);
  });
  it('does not partially confirm when another selected sheet fails', () => {
    const bad = section([['不明標題'], ['無法配對']], 'two');
    const result = inspect(document(grades(), bad), ['one', 'two'], { one: 3, two: 1 });
    expect(result.blockingMessage).toContain('不會只讀入');
    expect(result.sections[1].error).toBeTruthy();
    expect(result.rows).toHaveLength(1);
  });
  it('blocks a selected header-only sheet even when other sheets contain records', () => {
    const empty = section([['課名', '學分', '成績']], 'two');
    const result = inspect(document(grades(), empty), ['one', 'two'], { one: 3, two: 1 });
    expect(result.blockingMessage).toBeTruthy();
    expect(result.sections[1].error).toContain('沒有資料');
  });
  it.each([[], ['missing'], ['one', 'one']].map((selected) => [selected]))('blocks invalid selections (%j)', (selected) => {
    const result = inspect(document(grades()), selected);
    expect(result.blockingMessage).toBeTruthy();
    expect(result.rows).toEqual([]);
  });
  it.each([NaN, 2, 0])('keeps an invalid manually supplied header blocked (%s)', (header) => {
    expect(inspect(document(grades()), ['one'], { one: header }).blockingMessage).toBeTruthy();
  });
  it('checks the 500-record budget across all selected sheets', () => {
    const rows = [['課名', '學分', '成績'], ...Array.from({ length: 251 }, (_, index) => [`課程${index}`, '3', '85'])];
    const result = inspect(document(section(rows), section(rows, 'two')), ['one', 'two'], { one: 1, two: 1 });
    expect(result.rows).toHaveLength(502);
    expect(result.blockingMessage).toContain('500');
  });
  it('retains cross-campus and duplicate warnings instead of relabelling the data as safe', () => {
    const doc = document(section([['說明'], ['課名', '學分', '成績', '學校代碼'], ['甲', '3', '85', 'other'], ['甲', '3', '85', 'other']]));
    const result = inspect(doc);
    expect(result.correctionCount).toBe(2);
    expect(result.issues.some((issue) => issue.code === 'school-mismatch')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'duplicate-row')).toBe(true);
  });
  it('rejects an invalid worker document rather than guessing a preview', () => {
    const doc = document(grades()); doc.sections[0].rows[1].line = 1;
    expect(inspect(doc).blockingMessage).toContain('無法驗證');
  });
});
