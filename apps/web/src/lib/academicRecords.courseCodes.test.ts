import { describe, expect, it } from 'vitest';
import { normalizeGradeRecords } from './academicRecords';
import { reviewTranscript, suggestedTranscriptSelection, reviewedCreditTotals } from '@campus/shared/src/creditTranscriptReview';

const course = { semester: '1151', courseName: '專題實作', credits: 3, score: 80, courseType: '必修' };
const normalize = (grades: unknown[]) => normalizeGradeRecords({ success: true, grades, allSemesters: ['1151'], summary: {} });

describe('source course code continuity', () => {
  it('keeps otherwise identical records with different source course codes', () => {
    const source = [{ ...course, courseCode: '001' }, { ...course, courseCode: '002' }];
    const before = JSON.stringify(source);
    const { grades } = normalize(source);
    expect(grades).toHaveLength(2);
    expect(grades.map(row => row.courseCode)).toEqual(['001', '002']);
    expect(new Set(grades.map(row => row.id)).size).toBe(2);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('retains leading zeros and only trims surrounding whitespace', () => {
    expect(normalize([{ ...course, courseCode: '  0012Ａ  ' }]).grades[0].courseCode).toBe('0012Ａ');
  });
  it('still removes exact duplicate rows when the source code also matches', () => {
    const row = { ...course, courseCode: '001' };
    expect(normalize([row, { ...row }]).grades).toHaveLength(1);
  });
  it.each([undefined, null, '', '   '])('does not fabricate a code for missing source %s', (courseCode) => {
    const row = normalize([{ ...course, courseCode }]).grades[0];
    expect(row).not.toHaveProperty('courseCode');
    expect(row.id).toBe(normalize([course]).grades[0].id);
  });
  it.each([{ value: 123 }, { value: false }, { value: [] }, { value: ['001'] }, { value: { code: '001' } }])('rejects malformed source identifiers instead of coercing $value', ({ value: courseCode }) => {
    expect(() => normalize([{ ...course, courseCode }])).toThrow('課號格式不正確');
  });
  it('preserves code-bearing rows without invalidating a matching source summary', () => {
    const result = normalizeGradeRecords({ success: true, allSemesters: ['1151'], summary: {},
      grades: [{ ...course, courseCode: '001' }, { ...course, courseCode: '002' }],
      creditSummary: { source: 'derived-from-grade-rows', officialAudit: false, totalRequired: null, totalEarned: 6, totalCourses: 2 },
    });
    expect(result.creditSummary?.totalCourses).toBe(2);
    expect(result.creditSummaryUnavailable).toBeUndefined();
  });
  it('retains fractional credits, real zero and text grades alongside codes', () => {
    const rows = normalize([{ ...course, courseCode: '001', credits: 0.5, score: 0 },
      { ...course, courseCode: '002', score: 'Pass' }]).grades;
    expect(rows.map(row => [row.courseCode, row.credits, row.score])).toEqual([['001', 0.5, 0], ['002', 3, 'Pass']]);
  });
  it('flags same-code different-name records for review after normalization', () => {
    const rows = normalize([{ ...course, courseCode: 'IM101', courseName: '資料庫' },
      { ...course, courseCode: 'ＩＭ１０１', courseName: '資料庫系統', semester: '1142' }]).grades;
    const review = reviewTranscript(rows.map(row => ({ ...row, source: 'school' as const })), 60);
    expect(review.rows.map(row => row.duplicateCount)).toEqual([2, 2]);
    expect(suggestedTranscriptSelection(review)).toEqual([]);
    expect(() => reviewedCreditTotals(review, review.rows.map(row => ({ key: row.key, category: row.category })))).toThrow('只能選取一筆');
  });
  it('does not treat absent course codes as a shared duplicate identifier', () => {
    const rows = normalize([{ ...course, courseName: '資料庫' }, { ...course, courseName: '統計學' }]).grades;
    const review = reviewTranscript(rows.map(row => ({ ...row, source: 'school' as const })), 60);
    expect(suggestedTranscriptSelection(review)).toHaveLength(2);
  });
});
