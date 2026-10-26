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

  const timestamp = record.submittedAt as string | number | Date | { toDate?: () => Date } | undefined;
  const parsed = timestamp && typeof timestamp === 'object' && 'toDate' in timestamp
    ? timestamp.toDate?.() : timestamp;

  const submittedAt = parsed === undefined || parsed === null
    ? null : parseTaipeiInstant(parsed as string | number | Date);
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
