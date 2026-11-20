import { describe, expect, it } from 'vitest';
import type { NuniAssignment, NuniWorkspace } from '@campus/shared/src/nuni';
import { assignmentReferenceTiming } from './courseAssignmentDiscovery';

const workspace: NuniWorkspace = {
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title: '資料庫設計',
  state: 'active',
  memberRole: 'student',
};
const assignment: NuniAssignment = {
  id: 'cwa_11111111-1111-4111-8111-111111111111',
  workspaceId: workspace.id,
  title: '期中報告',
  instructions: '完成報告',
  state: 'open',
  createdAt: '2026-10-01T00:00:00Z',
  dueAt: '2026-10-25T12:00:00+08:00',
  closedAt: null,
  unitId: null,
  unitTitle: null,
  submissionCount: 0,
  mySubmission: null,
};

describe('assignment reference deadline', () => {
  const now = Date.parse('2026-10-26T16:00:00+08:00');

  it('marks a past reference date as actionable while collection remains open', () => {
    expect(assignmentReferenceTiming(assignment, workspace, now)).toBe('overdue');
    expect(assignmentReferenceTiming({ ...assignment, state: 'closed' }, workspace, now)).toBe('none');
    expect(assignmentReferenceTiming({ ...assignment, mySubmission: {
      assignmentId: assignment.id,
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
      displayName: '學生',
      body: '已送出的報告',
      state: 'submitted',
      submittedAt: '2026-10-25T10:00:00+08:00',
      teacherFeedback: null,
      reviewedAt: null,
    } }, workspace, now)).toBe('none');
  });

  it('places future work in a seven-day focus window without using invalid times', () => {
    expect(assignmentReferenceTiming({ ...assignment, dueAt: '2026-11-01T16:00:00+08:00' }, workspace, now)).toBe('soon');
    expect(assignmentReferenceTiming({ ...assignment, dueAt: '2026-11-05T16:00:00+08:00' }, workspace, now)).toBe('later');
    expect(assignmentReferenceTiming({ ...assignment, dueAt: null }, workspace, now)).toBe('none');
    expect(assignmentReferenceTiming({ ...assignment, dueAt: 'invalid' }, workspace, now)).toBe('none');
    expect(assignmentReferenceTiming(assignment, workspace, null)).toBe('none');
  });

  it('does not mistake another role or an archived course for student pending work', () => {
    expect(assignmentReferenceTiming(assignment, { ...workspace, memberRole: 'co-teacher' }, now)).toBe('none');
    expect(assignmentReferenceTiming(assignment, { ...workspace, state: 'archived' }, now)).toBe('none');
  });
});
