/** Shared filters for teacher grading / feedback queues (Firebase + Nuni). */

export type GradeQueueFilter = 'all' | 'needs_grade' | 'graded';
export type FeedbackQueueFilter = 'all' | 'needs_feedback' | 'reviewed';

export type FeedbackQueueEntry = {
  teacherFeedback: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
};

export function matchesGradeQueueFilter(
  submission: { score: number | null },
  filter: GradeQueueFilter,
): boolean {
  switch (filter) {
    case 'needs_grade':
      return submission.score === null;
    case 'graded':
      return submission.score !== null;
    default:
      return true;
  }
}

/** Pending grades first, then newest submission. */
export function sortGradeQueue<T extends { score: number | null; submittedAt: string | null }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const pending = Number(a.score !== null) - Number(b.score !== null);
    if (pending !== 0) return pending;
    return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
  });
}

/**
 * Pending review when there is no usable feedback yet, or the saved review
 * predates the student's current submission (resubmit after feedback).
 */
export function needsFeedbackReview(entry: FeedbackQueueEntry): boolean {
  const feedback = typeof entry.teacherFeedback === 'string' ? entry.teacherFeedback.trim() : '';
  if (!feedback) return true;
  if (!entry.reviewedAt) return true;
  const reviewed = Date.parse(entry.reviewedAt);
  const submitted = Date.parse(entry.submittedAt);
  if (!Number.isFinite(reviewed) || !Number.isFinite(submitted)) return true;
  return reviewed < submitted;
}

export function matchesFeedbackQueueFilter(
  entry: FeedbackQueueEntry,
  filter: FeedbackQueueFilter,
): boolean {
  const pending = needsFeedbackReview(entry);
  switch (filter) {
    case 'needs_feedback':
      return pending;
    case 'reviewed':
      return !pending;
    default:
      return true;
  }
}

/** Pending review first, then newest submission. */
export function sortFeedbackQueue<T extends FeedbackQueueEntry>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const pending = Number(!needsFeedbackReview(a)) - Number(!needsFeedbackReview(b));
    if (pending !== 0) return pending;
    return b.submittedAt.localeCompare(a.submittedAt);
  });
}

export function gradeQueueLabel(filter: GradeQueueFilter): string {
  switch (filter) {
    case 'needs_grade':
      return '尚未評分';
    case 'graded':
      return '已評分';
    default:
      return '全部';
  }
}

export function feedbackQueueLabel(filter: FeedbackQueueFilter): string {
  switch (filter) {
    case 'needs_feedback':
      return '尚未回饋';
    case 'reviewed':
      return '已回饋';
    default:
      return '全部';
  }
}
