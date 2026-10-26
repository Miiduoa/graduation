import { publishedAssignmentGrade, type PublishedAssignmentGrade } from '../data/assignmentGrade';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';

export type CourseSubmissionState =
  | { kind: 'not_submitted' }
  | { kind: 'draft' }
  | { kind: 'submitted'; submittedAt: string; grade: PublishedAssignmentGrade | null }
  | { kind: 'unconfirmed' }
  | { kind: 'unavailable' }
  | { kind: 'instructor' };

export function courseSubmissionState(
  record: Record<string, unknown> | null,
): CourseSubmissionState {
  if (!record) return { kind: 'not_submitted' };

  let submittedAt: number | null = null;
  try {
    let source: unknown = record.submittedAt;
    if (source && typeof source === 'object' && 'toDate' in source) {
      const toDate = (source as { toDate?: unknown }).toDate;
      source = typeof toDate === 'function' ? toDate.call(source) : null;
    }
    if (typeof source === 'string' || typeof source === 'number' || source instanceof Date) {
      submittedAt = parseTaipeiInstant(source);
    }
  } catch {
    submittedAt = null;
  }
  if (submittedAt !== null) {
    return {
      kind: 'submitted',
      submittedAt: new Date(submittedAt).toISOString(),
      grade: publishedAssignmentGrade(record),
    };
  }
  return record.status === 'draft' ? { kind: 'draft' } : { kind: 'unconfirmed' };
}

export function submissionStatusText(state: CourseSubmissionState | undefined): string {
  if (!state) return '繳交狀態尚未確認';
  switch (state.kind) {
    case 'not_submitted':
      return '尚未繳交';
    case 'draft':
      return '草稿未送出';
    case 'submitted':
      return state.grade
        ? `已繳交 · 已發布評分 ${state.grade.score} 分`
        : `已繳交 · ${formatTaipeiDateTime(state.submittedAt, { seconds: false })}`;
    case 'instructor':
      return '教師檢視 · 學生繳交請至批改頁查看';
    case 'unconfirmed':
      return '尚未確認正式繳交，請進入作業核對';
    case 'unavailable':
      return '繳交狀態暫時讀不到，請重新整理';
  }
}

export function canListAsPendingWork(state: CourseSubmissionState | undefined): boolean {
  return state?.kind === 'not_submitted' || state?.kind === 'draft';
}

export type CourseReceiptSummary = {
  submitted: number;
  graded: number;
  unsubmitted: number;
  needsVerification: number;
};

export function summarizeCourseReceipts(
  items: readonly { submission?: CourseSubmissionState }[],
): CourseReceiptSummary {
  return items.reduce<CourseReceiptSummary>((summary, item) => {
    const state = item.submission;
    if (state?.kind === 'submitted') {
      summary.submitted += 1;
      if (state.grade) summary.graded += 1;
    } else if (canListAsPendingWork(state)) {
      summary.unsubmitted += 1;
    } else if (!state || state.kind === 'unconfirmed' || state.kind === 'unavailable') {
      summary.needsVerification += 1;
    }
    return summary;
  }, { submitted: 0, graded: 0, unsubmitted: 0, needsVerification: 0 });
}

export function canSubmitCourseWork(
  item: {
    closed: boolean;
    dueAt: string | null;
    allowLateSubmission?: boolean;
    submission?: CourseSubmissionState;
  },
  now = new Date(),
): boolean {
  if (item.closed || !canListAsPendingWork(item.submission)) return false;
  if (!item.dueAt) return true;
  const due = parseTaipeiInstant(item.dueAt);
  if (due === null) return false;
  return due >= now.getTime() || item.allowLateSubmission === true;
}
