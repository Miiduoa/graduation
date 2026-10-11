import type { NuniQuiz, NuniWorkspace } from '@campus/shared/src/nuni';

export {
  courseRoleLabels,
  matchesAssignmentFilter,
  assignmentStatus,
  type AssignmentFilter,
} from '@campus/shared/src/nuniCourseTasks';

export type QuizFilter = 'all' | 'pending' | 'answered' | 'feedback' | 'received' | 'open';

export function matchesQuizFilter(quiz: NuniQuiz, workspace: NuniWorkspace, filter: QuizFilter) {
  switch (filter) {
    case 'pending':
      return workspace.state === 'active' && quiz.state === 'open' && !quiz.myResponse;
    case 'answered':
      return !!quiz.myResponse;
    case 'feedback':
      return !!quiz.myResponse?.teacherFeedback;
    case 'received':
      return quiz.responseCount > 0;
    case 'open':
      return workspace.state === 'active' && quiz.state === 'open';
    default:
      return true;
  }
}

export function quizStatus(quiz: NuniQuiz, workspace: NuniWorkspace) {
  if (workspace.memberRole !== 'student') return `${quiz.responseCount} 份作答`;
  if (quiz.myResponse?.teacherFeedback) return '老師已回饋';
  if (quiz.myResponse) return '已作答';
  if (workspace.state !== 'active') return '課程已封存';
  return quiz.state === 'open' ? '待作答' : '已結束 · 未作答';
}
