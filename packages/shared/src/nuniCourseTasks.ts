import type { NuniAssignment, NuniWorkspace } from './nuni';

export const courseRoleLabels: Record<NuniWorkspace['memberRole'], string> = {
  'owner-teacher': '課程負責老師',
  'co-teacher': '共同授課老師',
  student: '修課學生',
};
export type AssignmentFilter = 'all' | 'pending' | 'submitted' | 'feedback' | 'received' | 'open';
export function matchesAssignmentFilter(
  assignment: NuniAssignment,
  workspace: NuniWorkspace,
  filter: AssignmentFilter,
) {
  switch (filter) {
    case 'pending':
      return (
        workspace.state === 'active' && assignment.state === 'open' && !assignment.mySubmission
      );
    case 'submitted':
      return !!assignment.mySubmission;
    case 'feedback':
      return !!assignment.mySubmission?.teacherFeedback;
    case 'received':
      return assignment.submissionCount > 0;
    case 'open':
      return workspace.state === 'active' && assignment.state === 'open';
    default:
      return true;
  }
}
export function assignmentStatus(assignment: NuniAssignment, workspace: NuniWorkspace) {
  if (workspace.memberRole !== 'student') return `${assignment.submissionCount} 份繳交`;
  if (assignment.mySubmission?.teacherFeedback) return '老師已回饋';
  if (assignment.mySubmission) return '已繳交';
  if (workspace.state !== 'active') return '課程已封存';
  return assignment.state === 'open' ? '待繳交' : '已停止收件 · 未繳交';
}
