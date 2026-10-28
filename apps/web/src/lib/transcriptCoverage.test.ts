// @vitest-environment node
import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { AcademicGrade, AcademicGradeResponse } from './academicRecords';
import { formatSemester } from './academicRecords';
import { transcriptSemesterCoverage } from './transcriptCoverage';

const row = (semester: string, score: number | string = 80): AcademicGrade => ({
  id: `${semester}:${score}`, semester, score, credits: 3, courseName: '資料庫', courseNameEn: '', class: '', courseType: '',
});
const fixture = (overrides: Partial<AcademicGradeResponse> = {}): AcademicGradeResponse => ({
  grades: [], semesters: [], allSemesters: [], summary: {}, ...overrides,
});

it('lists only source-mentioned semesters without inventing missing enrollment years', () => {
  const result = transcriptSemesterCoverage(fixture({ allSemesters: ['1121', '1151'], grades: [row('1151')] }));
  assert.deepEqual(result.map(entry => entry.semester), ['1151', '1121']);
  assert.equal(result[1].rowCount, 0);
});

it('includes summary-only and row-only semesters even if the source list omits them', () => {
  const result = transcriptSemesterCoverage(fixture({
    semesters: ['1142'], allSemesters: ['1142'], grades: [row('1151')], summary: { '1141': { semesterAverage: 80 } },
  }));
  assert.deepEqual(result.map(entry => [entry.semester, entry.rowCount]), [['1151', 1], ['1142', 0], ['1141', 0]]);
});

it('deduplicates source semester labels but does not silently remove grade records', () => {
  const result = transcriptSemesterCoverage(fixture({ semesters: ['1142', '1142'], allSemesters: ['1142'], grades: [row('1142'), row('1142')] }));
  assert.equal(result.length, 1);
  assert.equal(result[0].rowCount, 2);
});

it('counts blank scores separately from zero and text results', () => {
  const result = transcriptSemesterCoverage(fixture({ grades: [row('1142', 0), row('1142', ''), row('1142', '  '), row('1142', 'Pass'), row('1142', 'SAT')] }));
  assert.equal(result[0].rowCount, 5);
  assert.equal(result[0].missingScoreCount, 2);
});

it('does not count a school semester average as a course record', () => {
  const result = transcriptSemesterCoverage(fixture({ summary: { '1141': { semesterAverage: 90 } } }));
  assert.deepEqual(result, [{ semester: '1141', rowCount: 0, missingScoreCount: 0 }]);
});

it('sorts numeric semester identifiers rather than lexicographic years', () => {
  const result = transcriptSemesterCoverage(fixture({ allSemesters: ['991', '1001', '1143', '1142'] }));
  assert.deepEqual(result.map(entry => entry.semester), ['1143', '1142', '1001', '991']);
});

it('never mutates the source semester list or grade rows', () => {
  const records = fixture({ allSemesters: ['1141', '1151'], grades: [row('1151')] });
  const before = JSON.stringify(records);
  transcriptSemesterCoverage(records);
  assert.equal(JSON.stringify(records), before);
});

it('handles a source with no semester or grade records', () => {
  assert.deepEqual(transcriptSemesterCoverage(fixture()), []);
});

it('does not emit a blank semester label', () => {
  assert.deepEqual(transcriptSemesterCoverage(fixture({ allSemesters: ['', ' '] })), []);
});

it('formats a third semester without guessing that it is summer school', () => {
  assert.equal(formatSemester('1143'), '114 學年度第 3 學期');
  assert.equal(formatSemester('1141'), '114 學年度第 1 學期');
  assert.equal(formatSemester('unknown'), 'unknown');
});
