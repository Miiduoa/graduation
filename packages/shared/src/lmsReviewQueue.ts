/** Shared filters for teacher grading / feedback queues (Firebase + Nuni). */

import { parseTaipeiInstant } from './taipeiTime';

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
    return (
      (b.submittedAt ? parseTaipeiInstant(b.submittedAt) ?? 0 : 0) -
      (a.submittedAt ? parseTaipeiInstant(a.submittedAt) ?? 0 : 0)
    );
  });
}

/** True when a published review timestamp is older than the latest submission. */
export function feedbackPredatesSubmission(
  reviewedAt: string | null | undefined,
  submittedAt: string | null | undefined,
): boolean {
  if (!reviewedAt || !submittedAt) return false;
  const reviewed = parseTaipeiInstant(reviewedAt);
  const submitted = parseTaipeiInstant(submittedAt);
  return reviewed !== null && submitted !== null && reviewed < submitted;
}

/**
 * Pending review when there is no usable feedback yet, or the saved review
 * predates the student's current submission (resubmit after feedback).
 */
export function needsFeedbackReview(entry: FeedbackQueueEntry): boolean {
  const feedback = typeof entry.teacherFeedback === 'string' ? entry.teacherFeedback.trim() : '';
  if (!feedback) return true;
  if (!entry.reviewedAt) return true;
  const reviewed = parseTaipeiInstant(entry.reviewedAt);
  const submitted = parseTaipeiInstant(entry.submittedAt);
  if (reviewed === null || submitted === null) return true;
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
    return (parseTaipeiInstant(b.submittedAt) ?? 0) - (parseTaipeiInstant(a.submittedAt) ?? 0);
  });
}

/**
 * Next receipt still awaiting review in queue order, after the given account.
 * Uses the latest sorted snapshot (e.g. after a successful save refreshed the row).
 */
export function nextAwaitingFeedbackReview<
  T extends FeedbackQueueEntry & { platformAccountId: string },
>(rows: readonly T[], afterPlatformAccountId: string): T | null {
  const ordered = sortFeedbackQueue(rows);
  const awaiting = ordered.filter((entry) => needsFeedbackReview(entry));
  if (awaiting.length === 0) return null;
  const index = awaiting.findIndex(
    (entry) => entry.platformAccountId === afterPlatformAccountId,
  );
  if (index === -1) return awaiting[0] ?? null;
  return awaiting[index + 1] ?? null;
}

/** 1-based position within the awaiting-review queue, or null when not awaiting. */
export function awaitingFeedbackPosition<
  T extends FeedbackQueueEntry & { platformAccountId: string },
>(rows: readonly T[], platformAccountId: string): { index: number; total: number } | null {
  const awaiting = sortFeedbackQueue(rows).filter((entry) => needsFeedbackReview(entry));
  const index = awaiting.findIndex((entry) => entry.platformAccountId === platformAccountId);
  if (index === -1) return null;
  return { index: index + 1, total: awaiting.length };
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
