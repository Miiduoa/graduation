/**
 * Review markers are stored per source passage, never inferred from model replies.
 * Locations must be ordered as they appear in the authorized study source.
 */
export type StudyReviewLocation = { sectionNumber: number; partNumber: number };

export function adjacentStudyReview(
  locations: readonly StudyReviewLocation[],
  current: StudyReviewLocation,
  direction: 'previous' | 'next',
): StudyReviewLocation | null {
  if (!locations.length) return null;
  const currentIndex = locations.findIndex((item) =>
    item.sectionNumber === current.sectionNumber && item.partNumber === current.partNumber);
  if (currentIndex >= 0) {
    const offset = direction === 'next' ? 1 : -1;
    return locations[(currentIndex + offset + locations.length) % locations.length];
  }
  // If the current paragraph is unmarked, continue from its position in the
  // source rather than jumping to the nearest marker in arbitrary render order.
  const firstLater = locations.findIndex((item) =>
    item.sectionNumber > current.sectionNumber ||
    (item.sectionNumber === current.sectionNumber && item.partNumber > current.partNumber));
  if (direction === 'next') return locations[firstLater < 0 ? 0 : firstLater];
  return locations[firstLater <= 0 ? locations.length - 1 : firstLater - 1];
}
