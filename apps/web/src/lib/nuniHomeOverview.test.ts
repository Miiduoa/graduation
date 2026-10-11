import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { loadNuniHomeData } from './nuniHomeOverview';

const accountId = 'pa_00000000-0000-0000-0000-000000000001';
const studentId = 'cw_00000000-0000-0000-0000-000000000001';
const teacherId = 'cw_00000000-0000-0000-0000-000000000002';
const archivedId = 'cw_00000000-0000-0000-0000-000000000003';
const transport = vi.fn();
function assignment(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    id: `cwa_00000000-0000-0000-0000-00000000000${suffix}`,
    workspaceId: studentId,
    title: `作業 ${suffix}`,
    instructions: '請完成作業',
    state: 'open',
    createdAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    dueAt: null,
    unitId: null,
    unitTitle: null,
    submissionCount: 0,
    mySubmission: null,
    ...extra,
  };
}
beforeEach(() => vi.clearAllMocks());
it('uses each course membership role and only includes open, unsubmitted work from active student courses', async () => {
  const submitted = assignment('3');
  transport
    .mockResolvedValueOnce({
      workspaces: [
        { id: studentId, title: '修習課程', state: 'active', memberRole: 'student' },
        { id: teacherId, title: '授課課程', state: 'active', memberRole: 'co-teacher' },
        { id: archivedId, title: '過往課程', state: 'archived', memberRole: 'student' },
      ],
    })
    .mockResolvedValueOnce({
      assignments: [
        assignment('1'),
        assignment('2', { dueAt: '2026-10-09T12:00:00Z' }),
        {
          ...submitted,
          mySubmission: {
            assignmentId: submitted.id,
            platformAccountId: accountId,
            displayName: '學生',
            body: '已完成',
            state: 'submitted',
            submittedAt: '2026-10-08T00:00:00Z',
            teacherFeedback: null,
            reviewedAt: null,
          },
        },
        assignment('4', { state: 'closed', closedAt: '2026-10-08T00:00:00Z' }),
      ],
    });
  const result = await loadNuniHomeData(transport, accountId);
  expect(result.courses.map((course) => course.role)).toEqual(['student', 'co-teacher']);
  expect(result.archivedCount).toBe(1);
  expect(result.tasks.map((task) => task.title)).toEqual(['作業 2', '作業 1']);
  expect(result.tasks[0]).toMatchObject({
    acceptsLate: true,
    href: `/classroom/course/${studentId}#assignment-cwa_00000000-0000-0000-0000-000000000002`,
  });
  expect(transport.mock.calls.map(([path]) => path)).toEqual([
    'class-workspaces',
    `class-workspaces/${studentId}/assignments`,
  ]);
});
it('rejects an incomplete overview when any course is no longer accessible', async () => {
  transport
    .mockResolvedValueOnce({
      workspaces: [{ id: studentId, title: '課程', state: 'active', memberRole: 'student' }],
    })
    .mockRejectedValueOnce(new NuniError(403, 'ACCESS_DENIED'));
  await expect(loadNuniHomeData(transport, accountId)).rejects.toMatchObject({ status: 403 });
});
it('does not accept another account submission as proof that this student completed work', async () => {
  const item = assignment('1');
  transport
    .mockResolvedValueOnce({
      workspaces: [{ id: studentId, title: '課程', state: 'active', memberRole: 'student' }],
    })
    .mockResolvedValueOnce({
      assignments: [
        {
          ...item,
          mySubmission: {
            assignmentId: item.id,
            platformAccountId: 'pa_00000000-0000-0000-0000-000000000099',
            displayName: '其他人',
            body: '私密內容',
            state: 'submitted',
            submittedAt: '2026-10-08T00:00:00Z',
            teacherFeedback: null,
            reviewedAt: null,
          },
        },
      ],
    });
  await expect(loadNuniHomeData(transport, accountId)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
it('returns a verified empty account without requesting assignments or inventing sample data', async () => {
  transport.mockResolvedValueOnce({ workspaces: [] });
  expect(await loadNuniHomeData(transport, accountId)).toEqual({
    courses: [],
    tasks: [],
    unreadCount: 0,
    archivedCount: 0,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
