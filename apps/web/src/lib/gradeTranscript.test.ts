import { describe, expect, it } from 'vitest';
import type { AcademicGrade } from './academicRecords';
import { buildTranscriptCsv, selectTranscriptRows, transcriptScoreKind, type TranscriptFilters } from './gradeTranscript';

const row = (id: string, overrides: Partial<AcademicGrade> = {}): AcademicGrade => ({
  id, semester: '1151', courseName: '資料庫', courseNameEn: 'DATABASE SYSTEMS',
  class: '資管三B', courseType: '必修', credits: 3, score: 86, ...overrides,
});
const defaults: TranscriptFilters = { semester: '', search: '', courseType: '', scoreKind: 'all', sort: 'semester' };
const fetchedAt = '2026-10-28T00:00:00.000Z';

describe('transcript filters', () => {
  it.each([
    ['database', ['one']], ['ＤＡＴＡＢＡＳＥ　資管', ['one']], ['1151 選修', ['two']], ['不存在', []],
  ])('finds original English names, fullwidth input, classes and terms: %s', (search, ids) => {
    const rows = [row('one'), row('two', { courseName: '服務學習', courseNameEn: 'SERVICE LEARNING', courseType: '選修' })];
    expect(selectTranscriptRows(rows, { ...defaults, search }).map(item => item.id)).toEqual(ids);
  });
  it('combines term, category and score kind without mutating the input', () => {
    const rows = [row('one'), row('two', { score: 'Pass', courseType: '選修' }), row('three', { semester: '1142', score: 'Pass', courseType: '選修' })];
    const before = JSON.stringify(rows);
    expect(selectTranscriptRows(rows, { ...defaults, semester: '1151', courseType: '選修', scoreKind: 'text' }).map(item => item.id)).toEqual(['two']);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it.each([[0, 'numeric'], [59.5, 'numeric'], ['Pass', 'text'], ['未完成', 'text'], ['', 'missing'], ['  ', 'missing']] as const)(
    'does not confuse %s with a missing or numeric score', (score, kind) => {
      expect(transcriptScoreKind(row('one', { score }))).toBe(kind);
    },
  );
  it('sorts numeric zero before text and keeps source values unchanged', () => {
    const rows = [row('pass', { score: 'Pass' }), row('zero', { score: 0 }), row('high', { score: 99 }), row('missing', { score: '' })];
    expect(selectTranscriptRows(rows, { ...defaults, sort: 'score' }).map(item => item.id)).toEqual(['high', 'zero', 'missing', 'pass']);
    expect(rows[0].score).toBe('Pass');
  });
  it('uses stable identities when names and semesters match', () => {
    expect(selectTranscriptRows([row('b'), row('a')], { ...defaults, sort: 'name' }).map(item => item.id)).toEqual(['a', 'b']);
  });
  it('sorts ROC semesters numerically instead of lexically', () => {
    expect(selectTranscriptRows([row('old', { semester: '991' }), row('new', { semester: '1001' })], defaults).map(item => item.id)).toEqual(['new', 'old']);
  });
});

describe('explicit transcript CSV', () => {
  it('retains zero, fractional credits, blank and text scores with read provenance', () => {
    const csv = buildTranscriptCsv({ rows: [row('zero', { score: 0, credits: 0.5 }), row('pass', { score: 'Pass' }), row('blank', { score: '' })], fetchedAt });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"0.5","0"');
    expect(csv).toContain('"Pass"');
    expect(csv).toContain('"3","","靜宜 e 校園"');
    expect(csv).toContain(fetchedAt);
    expect(csv).toContain('未確認歷年完整性');
    expect(csv).not.toContain('"zero"');
  });
  it('labels partial data without inventing a graduation audit', () => {
    const csv = buildTranscriptCsv({ rows: [row('one')], fetchedAt, coverage: { status: 'partial', skippedRows: 2 } });
    expect(csv).toContain('部分讀取；2 筆來源資料未能辨識');
    expect(csv).toContain('非正式成績單或畢業審核');
  });
  it.each(['=1+1', '+SUM(1)', '-1+2', '@SUM(1)', '  =1', '\t=1', '\r\n=1', '\uFEFF=1', '\u200b=1', '＝1+1'])(
    'escapes potentially executable spreadsheet text: %s', (name) => {
      const csv = buildTranscriptCsv({ rows: [row('one', { courseName: name })], fetchedAt });
      expect(csv).toContain(`"'${name}"`);
    },
  );
  it('quotes embedded commas, quotes and line breaks without creating new columns', () => {
    const csv = buildTranscriptCsv({ rows: [row('one', { courseName: '資料庫, "進階"\n實作' })], fetchedAt });
    expect(csv).toContain('"資料庫, ""進階""\n實作"');
  });
  it('exports every selected row rather than only the first screenful', () => {
    const rows = Array.from({ length: 85 }, (_, index) => row(String(index), { courseName: `課程${index}` }));
    const csv = buildTranscriptCsv({ rows, fetchedAt });
    expect(csv.trimEnd().split('\r\n')).toHaveLength(86);
    expect(csv).toContain('"課程84"');
  });
  it('does not include excluded records', () => {
    const rows = selectTranscriptRows([row('one'), row('two', { semester: '1142', courseName: '排除這門' })], { ...defaults, semester: '1151' });
    expect(buildTranscriptCsv({ rows, fetchedAt })).not.toContain('排除這門');
  });
  it('rejects an unavailable read time', () => {
    expect(() => buildTranscriptCsv({ rows: [row('one')], fetchedAt: 'unknown' })).toThrow();
  });
  it('does not create a header-only successful export', () => {
    expect(() => buildTranscriptCsv({ rows: [], fetchedAt })).toThrow();
  });
});
