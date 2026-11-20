import { describe, expect, it } from 'vitest';
import {
  parsePersonalImportAiResponse,
  PERSONAL_IMPORT_AI_REVIEW_CODE,
} from '@campus/shared/src/imports/aiRecognition';
import { hasCreditEvidence, hasPeriodEvidence } from '@campus/shared/src/imports/numericEvidence';
import type { PersonalImportOptions } from '@campus/shared/src/imports/types';

const invalidCredits = [
  'CS3', 'CS-3', 'CS_3', '教室3', '3D', '-3', '- 3', '+3', '+ 3',
  '3%', '3 %', '3/4', '3 / 4', '2026-03-04', '2026 / 3 / 4',
  '115年3月4日', '3月4日', '03:30', '3 : 30', '3.5', '第3至4節',
  '星期3', '- 3學分', '-3學分', '學分 3 %', '學分3.5', '學分3 / 4', 'CS３', '資料庫π3',
] as const;
const validCredits = [
  ['3學分', 3],
  ['學分：3', 3],
  ['３．０ 學分', 3],
  ['學分=2.5', 2.5],
  ['資料庫\t3\t85', 3],
  ['資料庫,2.5,85', 2.5],
  ['0 學分', 0],
  ['資料庫 | 0.0 | 通過', 0],
  ['credits: 3', 3],
  ['3 credits', 3],
] as const;
const invalidPeriods = [
  'CS3', 'CS-3', 'CS_3', '教室3', '3D', '-3', '- 3', '3%', '3 / 4',
  '2026-03-04', '115年3月4日', '03:30', '3 : 30', '3.5', '3.0',
  '3學分', '學分3', '星期3', '資料庫π3', 'CS３', '節次3.0', '第3.0節',
] as const;
const validPeriods = [
  ['資料庫 星期三 第3至4節', 3],
  ['資料庫 星期三 第3至4節', 4],
  ['資料庫 星期三 3-4', 3],
  ['資料庫 星期三 3-4 節', 4],
  ['資料庫 星期三 N-5 節', 'N'],
  ['資料庫 星期三 N-5 節', 5],
  ['資料庫週三Ｎ－５', 'N'],
  ['資料庫週三Ｎ－５', 5],
  ['節次：A-B', 'A'],
  ['節次：A-B', 'B'],
  ['資料庫\t三\t3\t4', 3],
  ['資料庫\t三\t3\t4', 4],
  ['第３至４節', 3],
  ['第３至４節', 4],
] as const;

describe('numeric import evidence boundaries', () => {
  it.each(invalidCredits)('does not borrow credits from %s', (evidence) => {
    expect(hasCreditEvidence(evidence, 3)).toBe(false);
  });
  it.each(validCredits)('keeps written credits in %s', (evidence, value) => {
    expect(hasCreditEvidence(evidence, value)).toBe(true);
  });
  it.each(invalidPeriods)('does not borrow a period from %s', (evidence) => {
    expect(hasPeriodEvidence(evidence, 3)).toBe(false);
  });
  it.each(validPeriods)('keeps a written period in %s', (evidence, value) => {
    expect(hasPeriodEvidence(evidence, value)).toBe(true);
  });
  it.each([NaN, Infinity, -Infinity, -3])('rejects invalid credit values (%s)', (value) => {
    expect(hasCreditEvidence('資料庫 3 學分', value)).toBe(false);
  });
  it('does not match a single-letter period inside an identifier', () => {
    for (const token of ['CSN', 'N301', 'N-301', '主顧N', 'NA']) {
      expect(hasPeriodEvidence(token, 'N')).toBe(false);
    }
  });
  it.each([
    ['CS', ''], ['CS-', ''], ['Room_', ''], ['', 'D'], ['-', ''], ['', '%'],
  ])('keeps numeric identifiers intact (%s, %s)', (prefix, suffix) => {
    for (let value = 1; value <= 40; value++) {
      const text = `${prefix}${value}${suffix}`;
      expect(hasCreditEvidence(text, value)).toBe(false);
      expect(hasPeriodEvidence(text, value)).toBe(false);
    }
  });
});

const options: PersonalImportOptions = {
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  periodProfile: 'pu',
};
const output = (row: Record<string, unknown>) => JSON.stringify({ complete: true, rows: [row] });

describe('AI import keeps unsupported fields editable', () => {
  it.each(['CS3', '03:30', '115年3月4日', '- 3'])(
    'leaves unsupported credits blank: %s',
    (token) => {
      const text = `資料庫 ${token} 成績 85`;
      const result = parsePersonalImportAiResponse(
        output({ title: '資料庫', credits: 3, grade: '85', evidence: text }),
        text,
        { ...options, kind: 'grades' },
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].credits).toBeUndefined();
      expect(result.rows[0].grade).toBe('85');
      expect(result.rows[0].source.rawText).toBe(text);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'ai-uncertain-field', field: 'credits', rowId: result.rows[0].id,
        }),
      );
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'invalid-credits', field: 'credits', severity: 'error',
        }),
      );
    },
  );
  it('uses original token boundaries even when the model inserts spaces', () => {
    const text = '資料庫 CS3 AB85';
    const result = parsePersonalImportAiResponse(
      output({ title: '資料庫', credits: 3, grade: '85', evidence: '資料庫 CS 3 AB 85' }),
      text,
      { ...options, kind: 'grades' },
    );
    expect(result.rows[0].credits).toBeUndefined();
    expect(result.rows[0].grade).toBeUndefined();
    expect(result.rows[0].source.rawText).toBe(text);
  });
  it('does not fill periods from clocks, dates or course identifiers', () => {
    const text = '資料庫 星期三 CS3 04:30 2026-03-04';
    const result = parsePersonalImportAiResponse(
      output({ title: '資料庫', dayOfWeek: 3, startPeriod: '3', endPeriod: '4', evidence: text }),
      text,
      options,
    );
    expect(result.rows[0].dayOfWeek).toBe(3);
    expect(result.rows[0].startPeriod).toBeUndefined();
    expect(result.rows[0].endPeriod).toBeUndefined();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-period', severity: 'error' }),
    );
  });
  it('still maps full-width NCKU labels to the configured school slots', () => {
    const text = '資料庫 星期三 Ｎ－５ 節';
    const result = parsePersonalImportAiResponse(
      output({ title: '資料庫', dayOfWeek: 3, startPeriod: 'N', endPeriod: '5', evidence: text }),
      text,
      { ...options, schoolId: 'ncku', periodProfile: 'ncku' },
    );
    expect(result.rows[0]).toMatchObject({ startPeriod: 6, endPeriod: 7 });
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: PERSONAL_IMPORT_AI_REVIEW_CODE, rowId: result.rows[0].id }),
    );
  });
  it('preserves zero and decimal credits without inventing a default', () => {
    for (const credits of [0, 2.5, 3]) {
      const text = `資料庫 ${credits.toFixed(1)} 學分 成績 85`;
      const result = parsePersonalImportAiResponse(
        output({ title: '資料庫', credits, grade: '85', evidence: text }),
        text,
        { ...options, kind: 'grades' },
      );
      expect(result.rows[0].credits).toBe(credits);
      expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });
  it('continues to label image transcription as unverified, not source-grounded text', () => {
    const result = parsePersonalImportAiResponse(
      output({ title: '資料庫', credits: 3, grade: '85', evidence: '資料庫 CS3' }),
      '',
      { ...options, kind: 'grades' },
      'image',
    );
    expect(result.rows[0].source.type).toBe('screenshot');
    expect(result.rows[0].source.rawText).toContain('請與原圖核對');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: PERSONAL_IMPORT_AI_REVIEW_CODE }),
    );
  });
});

describe('numeric weekdays in a labelled timetable', () => {
  const header = '開始節次,課程名稱,星期,結束節次';
  const row = '4,資料庫,3,5';
  const course = { title: '資料庫', dayOfWeek: 3, evidence: row };
  it.each([',', '\t'])('accepts the weekday cell even when columns and model rows are reordered (%j)', (delimiter) => {
    const records = [row, '2,資料庫,4,3'].map((line) => line.replaceAll(',', delimiter));
    const source = [header.replaceAll(',', delimiter), ...records].join('\n');
    const result = parsePersonalImportAiResponse(JSON.stringify({ complete: true, rows: [
      { ...course, dayOfWeek: 4, evidence: records[1] }, { ...course, evidence: records[0] },
    ] }), source, options);
    expect(result.rows.map((item) => [item.dayOfWeek, item.source.line])).toEqual([[4, 3], [3, 2]]);
    expect(result.issues.some((issue) => issue.field === 'dayOfWeek')).toBe(false);
  });
  it.each([
    [header, row, { ...course, dayOfWeek: 4 }], // start period
    ['', row, course],
    ['開始節次,課程名稱,教室,結束節次', row, course],
    ['星期,課程名稱,星期,結束節次', row, course],
    [header, row, { ...course, evidence: '資料庫,3' }],
    [header, row, { ...course, title: '資料' }],
    [header, row, { ...course, uncertainFields: ['dayOfWeek'] }],
    [header, '4,資料庫,三或3,5', { ...course, evidence: '4,資料庫,三或3,5' }],
  ] as const)('keeps unverified weekdays blank for %s / %s / %o', (heading, line, candidate) => {
    const result = parsePersonalImportAiResponse(output(candidate), [heading, line].filter(Boolean).join('\n'), options);
    expect(result.rows[0].dayOfWeek).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai-uncertain-field', field: 'dayOfWeek' }));
  });
});

describe('aligned screenshot evidence boundaries', () => {
  const header = '課程名稱    星期    開始節次    結束節次';
  const evidence = '資料庫    3    4    5';
  it.each([
    ['paste', header + '\n' + evidence],
    ['screenshot', evidence],
    ['screenshot', header.replace('星期', '教室') + '\n' + evidence],
    ['screenshot', header.replace('開始節次', '星期') + '\n' + evidence],
    ['screenshot', header + '\n' + evidence + '\n異常    2    3'],
    ['screenshot', header + '\n' + evidence + '\n"程式,設計"    2    3    4'],
  ] as const)('does not infer a weekday from ambiguous %s input (%s)', (type, source) => {
    const result = parsePersonalImportAiResponse(output({ title: '資料庫', dayOfWeek: 3, evidence }), source, {
      ...options, source: { type },
    });
    expect(result.rows[0].dayOfWeek).toBeUndefined();
  });
});
