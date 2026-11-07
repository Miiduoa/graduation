// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adjacentStudyReview, type StudyReviewLocation } from './courseStudyReview';

const marked: StudyReviewLocation[] = [
  { sectionNumber: 0, partNumber: 1 },
  { sectionNumber: 2, partNumber: 0 },
  { sectionNumber: 2, partNumber: 3 },
];

describe('ordered study review navigation', () => {
  it('wraps around the first and last marked passage without changing the list', () => {
    const snapshot = JSON.stringify(marked);
    expect(adjacentStudyReview(marked, marked[0], 'previous')).toEqual(marked[2]);
    expect(adjacentStudyReview(marked, marked[2], 'next')).toEqual(marked[0]);
    expect(adjacentStudyReview(marked, marked[1], 'next')).toEqual(marked[2]);
    expect(adjacentStudyReview(marked, marked[1], 'previous')).toEqual(marked[0]);
    expect(JSON.stringify(marked)).toBe(snapshot);
  });

  it('finds the next or previous marked passage from an unmarked source position', () => {
    const current = { sectionNumber: 1, partNumber: 4 };
    expect(adjacentStudyReview(marked, current, 'next')).toEqual(marked[1]);
    expect(adjacentStudyReview(marked, current, 'previous')).toEqual(marked[0]);
    expect(adjacentStudyReview(marked, { sectionNumber: 0, partNumber: 0 }, 'previous')).toEqual(marked[2]);
    expect(adjacentStudyReview(marked, { sectionNumber: 9, partNumber: 1 }, 'next')).toEqual(marked[0]);
    expect(adjacentStudyReview(marked, { sectionNumber: 2, partNumber: 2 }, 'previous')).toEqual(marked[1]);
  });

  it('never fabricates a review target for an empty list and handles one marked passage', () => {
    expect(adjacentStudyReview([], { sectionNumber: 0, partNumber: 0 }, 'next')).toBeNull();
    expect(adjacentStudyReview([marked[0]], marked[0], 'previous')).toEqual(marked[0]);
  });
});
