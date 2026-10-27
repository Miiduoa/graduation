/**
 * @jest-environment node
 */
import { publishedAssignmentGrade } from '../../data/assignmentGrade';

test('only published gradeScore and gradeFeedback are visible', () => {
  expect(
    publishedAssignmentGrade({
      gradePublished: true,
      gradeScore: 0,
      gradeFeedback: '請修正',
      gradePublishedAt: '2026-10-08T02:00:00.000Z',
      gradeRevisionCount: 1,
    }),
  ).toEqual({
    score: 0,
    feedback: '請修正',
    publishedAt: '2026-10-08T02:00:00.000Z',
    revisionCount: 1,
  });
});

test('ignores unpublished drafts and legacy grade fields', () => {
  expect(
    publishedAssignmentGrade({
      grade: 100,
      feedback: '不該顯示',
      gradeScore: 88,
      gradeFeedback: '草稿',
    }),
  ).toBeNull();
  expect(
    publishedAssignmentGrade({
      gradePublished: false,
      gradeScore: 88,
      gradeFeedback: '草稿',
    }),
  ).toBeNull();
});


test('normalizes Firestore publication timestamps without exposing invalid dates', () => {
  expect(publishedAssignmentGrade({
    gradePublished: true, gradeScore: 90,
    gradePublishedAt: { toDate: () => new Date('2026-10-26T09:00:00Z') },
  })?.publishedAt).toBe('2026-10-26T09:00:00.000Z');
  for (const gradePublishedAt of ['invalid', { toDate: () => { throw new Error('invalid'); } }]) {
    expect(publishedAssignmentGrade({ gradePublished: true, gradeScore: 90, gradePublishedAt })?.publishedAt).toBeNull();
  }
});
