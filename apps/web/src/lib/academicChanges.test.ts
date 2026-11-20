import { strict as assert } from 'node:assert';
import { it } from 'vitest';
import { compareAcademicSnapshots, type AcademicChangeSnapshot } from './academicChanges';
import type { AcademicCourse, AcademicGrade } from './academicRecords';

const time = (minute: number) => new Date(Date.UTC(2026, 9, 27, 0, minute)).toISOString();
function grade(overrides: Partial<AcademicGrade> = {}): AcademicGrade {
  return { id: 'value-derived-id', semester: '1151', courseName: '統計學', courseNameEn: '',
    class: '三B', courseType: '必修', credits: 3, score: '尚未公布', ...overrides };
}
function course(overrides: Partial<AcademicCourse> = {}): AcademicCourse {
  return { id: 'value-derived-id', semester: '1151', code: 'CS1', name: '資料庫', nameEn: '',
    classOffered: '三B', courseType: '必修', credits: 3, dayOfWeek: 1, periods: [3, 4],
    startTime: '10:10', endTime: '12:00', location: '主顧303', timePlaceRaw: '',
    teacherName: '王老師', teacherEmail: '', scheduleWarning: null, ...overrides };
}
function grades(rows: AcademicGrade[], minute = 0, ownerUid = 'one'): AcademicChangeSnapshot {
  return { ownerUid, schoolId: 'pu', fetchedAt: time(minute), records: {
    grades: rows, semesters: ['1151'], allSemesters: ['1151'], summary: {},
  } };
}
function courses(rows: AcademicCourse[], minute = 0, semester = '1151'): AcademicChangeSnapshot {
  return { ownerUid: 'one', schoolId: 'pu', fetchedAt: time(minute), records: {
    courses: rows, semester, totalCredits: 3, sourceTotalCredits: null,
    studentInfo: { class: null, studentId: null, name: null },
  } };
}
const compare = (before: AcademicChangeSnapshot | null, after: AcademicChangeSnapshot) =>
  compareAcademicSnapshots('grades', before, after);

it('establishes a baseline without calling every existing grade new', () => {
  assert.equal(compare(null, grades([grade()])).status, 'baseline');
  assert.deepEqual(compare(null, grades([grade()])).changes, []);
});
it('detects an unpublished score becoming a real zero even when the ID changes', () => {
  const report = compare(grades([grade()]), grades([grade({ id: 'new-id', score: 0 })], 5));
  assert.equal(report.changes[0].type, 'changed');
  assert.deepEqual(report.changes[0].fields, [{ label: '成績', before: '尚未公布', after: '0' }]);
});
it('treats numeric formatting changes as the same score', () => {
  assert.deepEqual(compare(grades([grade({ score: 90 })]), grades([grade({ score: '090.00' })], 5)).changes, []);
});
it('preserves letter grades rather than inventing a numeric conversion', () => {
  const report = compare(grades([grade({ score: 'B+' })]), grades([grade({ score: 'A-' })], 5));
  assert.deepEqual(report.changes[0].fields, [{ label: '成績', before: 'B+', after: 'A-' }]);
});
it('ignores reordered rows and value-derived IDs', () => {
  const a = grade(), b = grade({ courseName: '英文', score: 85 });
  assert.deepEqual(compare(grades([a, b]), grades([{ ...b, id: 'b2' }, { ...a, id: 'a2' }], 5)).changes, []);
});
it('uses class and semester to avoid mixing same-name courses', () => {
  const before = grades([grade(), grade({ class: '三A', score: 80 }), grade({ semester: '1142', score: 50 })]);
  const after = grades([grade({ score: 87 }), grade({ class: '三A', score: 80 }), grade({ semester: '1142', score: 50 })], 5);
  assert.equal(compare(before, after).changes.length, 1);
  assert.equal(compare(before, after).changes[0].semester, '1151');
});
it('does not guess which duplicate same-name grade was changed', () => {
  const report = compare(grades([grade({ score: 70 }), grade({ score: 80 })]), grades([grade({ score: 75 }), grade({ score: 80 })], 5));
  assert.equal(report.changes[0].type, 'review');
  assert.deepEqual(report.changes[0].fields, []);
});
it('does not warn about an unchanged ambiguous group', () => {
  const a = grade({ score: 70 }), b = grade({ score: 80 });
  assert.deepEqual(compare(grades([a, b]), grades([b, a], 5)).changes, []);
});
it('distinguishes added data from a row not returned by the latest source', () => {
  const report = compare(grades([grade(), grade({ courseName: '英文' })]), grades([grade(), grade({ courseName: '經濟' })], 5));
  assert.equal(report.changes.find((item) => item.title === '英文')?.type, 'not-returned');
  assert.equal(report.changes.find((item) => item.title === '經濟')?.type, 'added');
});
it('does not label a whole empty reply as mass deletion', () => {
  const report = compare(grades([grade()]), grades([], 5));
  assert.equal(report.status, 'empty');
  assert.deepEqual(report.changes, []);
});
it('starts a baseline when previously no records were available', () => {
  assert.equal(compare(grades([]), grades([grade()], 5)).status, 'baseline');
});
it('never compares records across accounts', () => {
  assert.equal(compare(grades([grade()]), grades([grade({ score: 95 })], 5, 'two')).status, 'scope-reset');
});
it('never compares records across schools', () => {
  assert.equal(compare(grades([grade()]), { ...grades([grade()], 5), schoolId: 'nthu' }).status, 'scope-reset');
});
it('rejects an older or identical source timestamp', () => {
  for (const next of [0, 5]) assert.equal(compare(grades([grade()], 5), grades([grade({ score: 95 })], next)).status, 'stale');
});
it('rejects malformed source timestamps', () => {
  assert.equal(compare(grades([grade()]), { ...grades([grade()], 5), fetchedAt: 'invalid' }).status, 'stale');
});
it('tracks credit corrections without splitting course identity', () => {
  assert.deepEqual(compare(grades([grade()]), grades([grade({ credits: 2 })], 5)).changes[0].fields,
    [{ label: '學分', before: '3', after: '2' }]);
});
it('detects classroom and weekday changes independently of IDs', () => {
  const report = compareAcademicSnapshots('courses', courses([course()]), courses([course({ id: 'changed', dayOfWeek: 2, location: '主顧305' })], 5));
  assert.equal(report.changes[0].type, 'changed');
  assert.deepEqual(report.changes[0].fields.map((item) => item.label), ['上課時間', '教室']);
});
it('normalizes the ordering of period lists', () => {
  assert.deepEqual(compareAcademicSnapshots('courses', courses([course()]), courses([course({ periods: [4, 3, 3] })], 5)).changes, []);
});
it('does not interpret switching a semester as dropping all previous courses', () => {
  assert.equal(compareAcademicSnapshots('courses', courses([course()]), courses([course({ semester: '1152' })], 5, '1152')).status, 'semester-reset');
});
it('requires review when several meetings share one course identity', () => {
  const report = compareAcademicSnapshots('courses', courses([course(), course({ dayOfWeek: 3 })]), courses([course(), course({ dayOfWeek: 4 })], 5));
  assert.equal(report.changes[0].type, 'review');
});
it('cannot mix the course and grade response shapes', () => {
  assert.equal(compareAcademicSnapshots('courses', grades([grade()]), courses([course()], 5)).status, 'scope-reset');
});
it('bounds comparison work without truncating a huge response into false missing rows', () => {
  assert.equal(compare(grades([grade()]), grades(Array.from({ length: 5001 }, () => grade()), 5)).status, 'limit');
});
it('does not mutate arrays or original fields', () => {
  const before = courses([course({ periods: [4, 3] })]);
  const after = courses([course()], 5);
  const original = JSON.stringify([before, after]);
  compareAcademicSnapshots('courses', before, after);
  assert.equal(JSON.stringify([before, after]), original);
});

it('does not pair two different courses just because both lack a course code', () => {
  const report = compareAcademicSnapshots('courses',
    courses([course({ code: '', name: '資料庫' })]),
    courses([course({ code: '', name: '演算法' })], 5));
  assert.equal(report.changes.find((item) => item.title === '資料庫')?.type, 'not-returned');
  assert.equal(report.changes.find((item) => item.title === '演算法')?.type, 'added');
  assert.equal(report.changes.filter((item) => item.type === 'changed').length, 0);
});
it('clears source provenance before applying the size limit to a different account', () => {
  const report = compare(grades([grade()]), grades(Array.from({ length: 5001 }, () => grade()), 5, 'two'));
  assert.equal(report.status, 'scope-reset');
  assert.equal(report.from, null);
  assert.deepEqual(report.changes, []);
});
