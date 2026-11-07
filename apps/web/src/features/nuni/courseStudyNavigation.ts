import type { StudyReviewLocation } from './courseStudyReview';

/**
 * Move through readable source passages in order, including PDF page changes.
 * Unlike the explicitly cyclic review list, ordinary reading stops at both ends.
 * Empty/unreadable sections are skipped, never given fabricated passages.
 */
export function adjacentStudyPassage(
  sections: readonly (readonly unknown[])[],
  current: StudyReviewLocation,
  direction: 'previous' | 'next',
): StudyReviewLocation | null {
  const { sectionNumber, partNumber } = current;
  if (!Number.isSafeInteger(sectionNumber) || !Number.isSafeInteger(partNumber) ||
    sectionNumber < 0 || partNumber < 0 ||
    sectionNumber >= sections.length || partNumber >= sections[sectionNumber].length) return null;

  const step = direction === 'next' ? 1 : -1;
  const nearby = partNumber + step;
  if (nearby >= 0 && nearby < sections[sectionNumber].length) {
    return { sectionNumber, partNumber: nearby };
  }

  for (let next = sectionNumber + step; next >= 0 && next < sections.length; next += step) {
    if (sections[next].length) {
      return { sectionNumber: next, partNumber: step > 0 ? 0 : sections[next].length - 1 };
    }
  }
  return null;
}
