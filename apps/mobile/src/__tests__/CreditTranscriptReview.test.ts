import {
  reviewTranscript, suggestedTranscriptSelection, reviewedCreditTotals,
  applyTranscriptReview, transcriptPlanOverlaps, type TranscriptInput,
} from '@campus/shared/src/creditTranscriptReview';
import { emptyCreditPlan } from '@campus/shared/src/creditPlanner';

const course = (patch: Partial<TranscriptInput> = {}): TranscriptInput => ({
  id: 'row', courseName: '資料庫', courseCode: 'IM101', semester: '1141',
  courseType: '必修', credits: 3, score: 80, source: 'school', ...patch,
});

test.each([null, 0, 101, NaN, 60.5])('requires an explicit valid pass mark: %s', (mark) => {
  expect(() => reviewTranscript([], mark as number)).toThrow(/及格分數/);
});

test('a score of zero is failed, blanks and unknown letter grades are not assumed passed', () => {
  const review = reviewTranscript([
    course({ score: 0 }), course({ score: '' }), course({ score: null, letterGrade: 'A+' }),
    course({ score: 'W' }), course({ score: 'I' }), course({ score: 'NaN' }),
  ], 60);
  expect(review.rows.every((row) => !row.eligible)).toBe(true);
  expect(review.rows[0].scoreLabel).toBe('0');
  expect(suggestedTranscriptSelection(review)).toEqual([]);
});

test('60 and 70 policies differ without assuming a school degree requirement', () => {
  expect(reviewTranscript([course({ score: 65 })], 60).rows[0].eligible).toBe(true);
  expect(reviewTranscript([course({ score: 65 })], 70).rows[0].eligible).toBe(false);
  expect(reviewTranscript([course({ score: '70.00' })], 70).rows[0].eligible).toBe(true);
});

test('honours explicit pass symbols but refuses contradictory numeric/pass evidence', () => {
  expect(reviewTranscript([course({ score: null, letterGrade: 'P' })], 70).rows[0].eligible).toBe(true);
  expect(reviewTranscript([course({ score: '通過' })], 70).rows[0].eligible).toBe(true);
  expect(reviewTranscript([course({ score: 30, letterGrade: 'P' })], 60).rows[0].eligible).toBe(false);
  expect(reviewTranscript([course({ score: 90, letterGrade: 'F' })], 60).rows[0].reason).toContain('不一致');
});

test.each([0, -1, 30.01, 1.234, Infinity, '3', null])('does not count invalid or zero credits: %s', (credits) => {
  expect(reviewTranscript([course({ credits })], 60).rows[0].eligible).toBe(false);
});

test('groups same name or course code conservatively, including transitive matches', () => {
  const review = reviewTranscript([
    course({ id: 'a', courseName: '資料庫', courseCode: 'a' }),
    course({ id: 'b', courseName: ' 資料庫 ', courseCode: 'b' }),
    course({ id: 'c', courseName: 'Database', courseCode: 'b' }),
    course({ id: 'd', courseName: '統計學', courseCode: 'c' }),
  ], 60);
  expect(review.rows.slice(0, 3).map((row) => row.duplicateCount)).toEqual([3, 3, 3]);
  expect(new Set(review.rows.slice(0, 3).map((row) => row.group)).size).toBe(1);
  expect(suggestedTranscriptSelection(review)).toEqual([{ key: 'row-3', category: 'required' }]);
  expect(() => reviewedCreditTotals(review, [
    { key: 'row-0', category: 'required' }, { key: 'row-2', category: 'elective' },
  ])).toThrow(/只能選取一筆/);
});

test('numbered courses remain distinct and generic category guessing stays conservative', () => {
  const review = reviewTranscript([
    course({ courseName: '英文（一）', courseCode: 'en1', courseType: '校共同必修' }),
    course({ courseName: '英文（二）', courseCode: 'en2', courseType: '系必修' }),
    course({ courseName: '通識', courseCode: 'ge1', courseType: '通識選修' }),
  ], 60);
  expect(review.rows.map((row) => row.duplicateCount)).toEqual([1, 1, 1]);
  expect(review.rows.map((row) => row.category)).toEqual(['other', 'required', 'general']);
});

test('bulk suggestions leave workspace scores for manual selection and label offline provenance', () => {
  const review = reviewTranscript([
    course({ courseName: 'A', courseCode: 'a', source: 'course' }),
    course({ courseName: 'B', courseCode: 'b', source: 'school-cache' }),
  ], 60);
  expect(suggestedTranscriptSelection(review).map((row) => row.key)).toEqual(['row-1']);
  expect(review.rows[1].source).toBe('school-cache');
});

test('rejects empty, duplicate, stale and forged selections instead of clearing a plan', () => {
  const review = reviewTranscript([course()], 60);
  expect(() => reviewedCreditTotals(review, [])).toThrow(/清零/);
  expect(() => reviewedCreditTotals(review, [{ key: 'missing', category: 'required' }])).toThrow(/失效/);
  expect(() => reviewedCreditTotals(review, [{ key: 'row-0', category: 'forged' as 'required' }])).toThrow(/失效/);
  expect(() => reviewedCreditTotals(review, [
    { key: 'row-0', category: 'required' }, { key: 'row-0', category: 'required' },
  ])).toThrow();
});

test('calculates decimal credit totals exactly and accepts user reviewed category adjustments', () => {
  const review = reviewTranscript([
    course({ courseName: 'A', courseCode: 'a', credits: 0.1 }),
    course({ courseName: 'B', courseCode: 'b', credits: 0.2 }),
    course({ courseName: 'C', courseCode: 'c', credits: 2.55 }),
  ], 60);
  const totals = reviewedCreditTotals(review, [
    { key: 'row-0', category: 'required' }, { key: 'row-1', category: 'required' },
    { key: 'row-2', category: 'general' },
  ]);
  expect(totals.credits).toBe(2.85);
  expect(totals.byCategory.required).toBe(0.3);
  expect(totals.byCategory.general).toBe(2.55);
});

test('replaces, never increments, confirmed totals and preserves targets and unrelated courses', () => {
  const plan = { ...emptyCreditPlan(), recognized: '60', target: '128', extra: '10', courses: [
    { id: 'future', name: '專題', credits: 3, term: 2, category: 'required' as const, status: 'considering' as const },
  ], milestones: [{ id: 'eng', label: '英檢', done: true }] };
  plan.categoryGoals.required = { recognized: '30', target: '50' };
  const original = JSON.stringify(plan);
  const review = reviewTranscript([course()], 60);
  const change = applyTranscriptReview(plan, review, suggestedTranscriptSelection(review), {});
  expect(change.next.recognized).toBe('3');
  expect(change.next.categoryGoals.required).toEqual({ recognized: '3', target: '50' });
  expect(change.next.categoryGoals.general.recognized).toBe('0');
  expect(change.next.target).toBe('128');
  expect(change.next.extra).toBe('10');
  expect(change.next.courses).toEqual(plan.courses);
  expect(change.next.milestones).toEqual(plan.milestones);
  expect(JSON.stringify(plan)).toBe(original);
});

test('requires an explicit choice for a same-name future course and removes only reviewed IDs', () => {
  const plan = { ...emptyCreditPlan(), courses: [
    { id: 'done', name: '資料庫', credits: 3, term: 1, category: 'required' as const, status: 'considering' as const },
    { id: 'other', name: '專題', credits: 3, term: 1, category: 'required' as const, status: 'considering' as const },
  ] };
  const review = reviewTranscript([course()], 60);
  const selected = suggestedTranscriptSelection(review);
  expect(transcriptPlanOverlaps(plan, reviewedCreditTotals(review, selected)).map((row) => row.id)).toEqual(['done']);
  expect(() => applyTranscriptReview(plan, review, selected, {})).toThrow(/同一門/);
  const removed = applyTranscriptReview(plan, review, selected, { done: 'remove', other: 'remove' });
  expect(removed.next.courses.map((row) => row.id)).toEqual(['other']);
  expect(removed.removedCourseIds).toEqual(['done']);
  expect(applyTranscriptReview(plan, review, selected, { done: 'keep' }).next.courses).toHaveLength(2);
});

test('caps both input size and total credits rather than silently truncating', () => {
  expect(() => reviewTranscript(Array.from({ length: 2001 }, () => course()), 60)).toThrow(/筆數/);
  const review = reviewTranscript(Array.from({ length: 40 }, (_, i) => course({
    courseName: `課程${i}`, courseCode: String(i), credits: 30,
  })), 60);
  expect(() => reviewedCreditTotals(review, suggestedTranscriptSelection(review))).toThrow(/1000/);
});
