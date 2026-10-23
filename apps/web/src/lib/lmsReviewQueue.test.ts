import { describe, expect, it } from 'vitest';
import {
  feedbackQueueLabel,
  gradeQueueLabel,
  matchesFeedbackQueueFilter,
  matchesGradeQueueFilter,
  needsFeedbackReview,
  sortFeedbackQueue,
  sortGradeQueue,
} from '@campus/shared/src/lmsReviewQueue';

describe('lmsReviewQueue', () => {
  it('filters grade queue by published score presence', () => {
    expect(matchesGradeQueueFilter({ score: null }, 'needs_grade')).toBe(true);
    expect(matchesGradeQueueFilter({ score: 80 }, 'needs_grade')).toBe(false);
    expect(matchesGradeQueueFilter({ score: 80 }, 'graded')).toBe(true);
    expect(matchesGradeQueueFilter({ score: null }, 'all')).toBe(true);
  });

  it('puts ungraded submissions first while keeping newer times ahead within a band', () => {
    const sorted = sortGradeQueue([
      { score: 90, submittedAt: '2026-10-10T10:00:00Z' },
      { score: null, submittedAt: '2026-10-09T10:00:00Z' },
      { score: null, submittedAt: '2026-10-11T10:00:00Z' },
    ]);
    expect(sorted.map((row) => row.submittedAt)).toEqual([
      '2026-10-11T10:00:00Z',
      '2026-10-09T10:00:00Z',
      '2026-10-10T10:00:00Z',
    ]);
  });

  it('treats missing or blank feedback as pending review', () => {
    expect(needsFeedbackReview({ teacherFeedback: null, submittedAt: '2026-10-10T00:00:00Z' })).toBe(
      true,
    );
    expect(needsFeedbackReview({ teacherFeedback: '', submittedAt: '2026-10-10T00:00:00Z' })).toBe(
      true,
    );
    expect(
      needsFeedbackReview({ teacherFeedback: '   ', submittedAt: '2026-10-10T00:00:00Z' }),
    ).toBe(true);
  });

  it('keeps resubmitted work pending when review predates the latest submission', () => {
    const stale = {
      teacherFeedback: '針對舊稿',
      submittedAt: '2026-10-11T00:00:00Z',
      reviewedAt: '2026-10-10T00:00:00Z',
    };
    expect(needsFeedbackReview(stale)).toBe(true);
    expect(matchesFeedbackQueueFilter(stale, 'needs_feedback')).toBe(true);
    expect(matchesFeedbackQueueFilter(stale, 'reviewed')).toBe(false);
  });

  it('treats feedback reviewed at or after the current submission as current', () => {
    const current = {
      teacherFeedback: '已看過新稿',
      submittedAt: '2026-10-11T00:00:00Z',
      reviewedAt: '2026-10-11T01:00:00Z',
    };
    expect(needsFeedbackReview(current)).toBe(false);
    expect(matchesFeedbackQueueFilter(current, 'reviewed')).toBe(true);
    expect(matchesFeedbackQueueFilter(current, 'needs_feedback')).toBe(false);
  });

  it('prioritizes stale and missing feedback ahead of current reviews', () => {
    const sorted = sortFeedbackQueue([
      {
        teacherFeedback: '已回',
        submittedAt: '2026-10-12T00:00:00Z',
        reviewedAt: '2026-10-12T01:00:00Z',
      },
      {
        teacherFeedback: '舊回饋',
        submittedAt: '2026-10-11T00:00:00Z',
        reviewedAt: '2026-10-10T00:00:00Z',
      },
      { teacherFeedback: null, submittedAt: '2026-10-10T00:00:00Z' },
    ]);
    expect(sorted.map((row) => row.submittedAt)).toEqual([
      '2026-10-11T00:00:00Z',
      '2026-10-10T00:00:00Z',
      '2026-10-12T00:00:00Z',
    ]);
  });

  it('exposes Traditional Chinese labels for queue filters', () => {
    expect(gradeQueueLabel('needs_grade')).toBe('尚未評分');
    expect(feedbackQueueLabel('needs_feedback')).toBe('尚未回饋');
  });

  it('classifies mixed Taipei wall times and UTC feedback by the actual instant', () => {
    const current = {
      teacherFeedback: '已看過新稿',
      submittedAt: '2026-10-11T10:00:00',
      reviewedAt: '2026-10-11T03:00:00Z',
    };
    const stale = {
      teacherFeedback: '針對舊稿',
      submittedAt: '2026-10-11T03:00:00Z',
      reviewedAt: '2026-10-11T10:00:00',
    };
    expect(needsFeedbackReview(current)).toBe(false);
    expect(matchesFeedbackQueueFilter(current, 'reviewed')).toBe(true);
    expect(needsFeedbackReview(stale)).toBe(true);
    expect(matchesFeedbackQueueFilter(stale, 'needs_feedback')).toBe(true);
  });

  it('orders both review queues by instants when timestamp offsets differ', () => {
    const rows = [
      { id: 'older', score: null, teacherFeedback: null, submittedAt: '2026-10-11T10:00:00' },
      { id: 'newer', score: null, teacherFeedback: null, submittedAt: '2026-10-11T03:00:00Z' },
      { id: 'latest', score: null, teacherFeedback: null, submittedAt: '2026-10-11T12:00:00+08:00' },
    ];
    expect(sortGradeQueue(rows).map((row) => row.id)).toEqual(['latest', 'newer', 'older']);
    expect(sortFeedbackQueue(rows).map((row) => row.id)).toEqual(['latest', 'newer', 'older']);
  });
});
