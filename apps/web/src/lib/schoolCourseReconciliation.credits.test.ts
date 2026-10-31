import { describe, expect, it } from 'vitest';
import { reconcileSchoolCourses, type AcademicComparisonSnapshot, type LmsComparisonSnapshot } from './schoolCourseReconciliation';
const scope = { uid: 'fixture', schoolId: 'pu' };
function academic(credits = 3): AcademicComparisonSnapshot {
  return { ownerUid: 'fixture', schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z', records: {
    semester: '1151', sourceTotalCredits: 12,
    courses: [{ code: '0012', name: '資料庫', semester: '1151', classOffered: '測試班',
      courseType: '必修', credits, teacherName: '', timePlaceRaw: '', location: '', scheduleWarning: null }],
  } };
}
function lms(credit?: number | null): LmsComparisonSnapshot {
  return { ownerUid: 'fixture', schoolId: 'pu', source: 'pu-tronclass', fetchedAt: '2026-10-28T00:00:00Z',
    status: 'ongoing', courses: [{ id: 10, name: '資料庫', code: '0012', semester: '115-1', credit }],
  };
}
describe('school course credit differences', () => {
  it.each([[3, 2], [3, 0], [0, 3], [0.5, 1]])('flags academic %s versus LMS %s without changing the school total', (school, course) => {
    const source = academic(school); const list = lms(course);
    const before = JSON.stringify([source, list]);
    const result = reconcileSchoolCourses(source, list, scope);
    expect(result.rows[0]).toMatchObject({ match: 'matched', credits: school,
      creditDifference: { academic: school, lms: course }, lms: { id: 10 },
    });
    expect(result).toMatchObject({ sourceTotalCredits: 12, matchedCount: 1, needsReviewCount: 1, unmatchedLms: [] });
    expect(JSON.stringify([source, list])).toBe(before);
  });
  it.each([0, 0.5, 3])('does not flag equal source values: %s', (credit) => {
    const result = reconcileSchoolCourses(academic(credit), lms(credit), scope);
    expect(result.rows[0].creditDifference).toBeUndefined();
    expect(result.needsReviewCount).toBe(0);
  });
  it.each([undefined, null, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not invent a difference for unavailable LMS credit: %s', (credit) => {
    const result = reconcileSchoolCourses(academic(), lms(credit), scope);
    expect(result.rows[0].creditDifference).toBeUndefined();
    expect(result.rows[0].credits).toBe(3);
  });
  it('does not compare a matching title from a different semester', () => {
    const list = lms(0); list.courses = [{ ...list.courses[0], semester: '1142' }];
    const result = reconcileSchoolCourses(academic(), list, scope);
    expect(result.rows[0]).toMatchObject({ match: 'not-in-list', lms: null });
    expect(result.rows[0].creditDifference).toBeUndefined();
  });
  it('requires a unique course identity before comparing credits', () => {
    const list = lms(0); list.courses = [...list.courses, { ...list.courses[0], id: 11, credit: 1 }];
    const result = reconcileSchoolCourses(academic(), list, scope);
    expect(result.rows[0]).toMatchObject({ match: 'ambiguous', lms: null });
    expect(result.rows[0].creditDifference).toBeUndefined();
  });
  it('does not hide conflicting academic rows by selecting an LMS value', () => {
    const source = academic();
    source.records.courses = [...source.records.courses, { ...source.records.courses[0], credits: 2 }];
    const result = reconcileSchoolCourses(source, lms(2), scope);
    expect(result.rows[0]).toMatchObject({ match: 'credit-conflict', credits: null, lms: null });
    expect(result.rows[0].creditDifference).toBeUndefined();
  });
});
