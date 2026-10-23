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
beforeEach(() => {
  transport.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    if (path.endsWith('/materials')) return { materials: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});
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
  expect(result.recentFeedback).toEqual([]);
  expect(result.materials).toEqual([]);
  expect(transport.mock.calls.map(([path]) => path)).toEqual([
    'class-workspaces',
    `class-workspaces/${studentId}/assignments`,
    `class-workspaces/${studentId}/quizzes`,
    `class-workspaces/${studentId}/materials`,
  ]);
});
it('lists recent teacher feedback with deep links even after the todo disappears', async () => {
  const reviewed = assignment('5');
  transport
    .mockResolvedValueOnce({
      workspaces: [{ id: studentId, title: '修習課程', state: 'active', memberRole: 'student' }],
    })
    .mockResolvedValueOnce({
      assignments: [
        {
          ...reviewed,
          mySubmission: {
            assignmentId: reviewed.id,
            platformAccountId: accountId,
            displayName: '學生',
            body: '已完成',
            state: 'submitted',
            submittedAt: '2026-10-08T00:00:00Z',
            teacherFeedback: '請補充資料來源',
            reviewedAt: '2026-10-09T04:00:00Z',
          },
        },
      ],
    });
  const result = await loadNuniHomeData(transport, accountId);
  expect(result.tasks).toEqual([]);
  expect(result.recentFeedback).toEqual([
    {
      kind: 'assignment',
      id: reviewed.id,
      courseId: studentId,
      courseName: '修習課程',
      title: reviewed.title,
      feedback: '請補充資料來源',
      score: null,
      reviewedAt: '2026-10-09T04:00:00Z',
      submittedAt: '2026-10-08T00:00:00Z',
      href: `/classroom/course/${studentId}#assignment-${reviewed.id}`,
    },
  ]);
});
it('sorts recent feedback by instant across accepted Taipei wall and UTC timestamps', async () => {
  const rows = [
    { suffix: '1', reviewedAt: '2026-10-11T10:00:00' },
    { suffix: '2', reviewedAt: '2026-10-11T03:00:00Z' },
    { suffix: '3', reviewedAt: '2026-10-11T12:00:00+08:00' },
  ].map(({ suffix, reviewedAt }) => {
    const item = assignment(suffix);
    return {
      ...item,
      mySubmission: {
        assignmentId: item.id,
        platformAccountId: accountId,
        displayName: '學生',
        body: '已完成',
        state: 'submitted',
        submittedAt: '2026-10-11T01:00:00Z',
        teacherFeedback: '請補充資料來源',
        reviewedAt,
      },
    };
  });
  transport
    .mockResolvedValueOnce({
      workspaces: [{ id: studentId, title: '修習課程', state: 'active', memberRole: 'student' }],
    })
    .mockResolvedValueOnce({ assignments: rows });
  const result = await loadNuniHomeData(transport, accountId);
  expect(result.recentFeedback?.map((entry) => entry.title)).toEqual(['作業 3', '作業 2', '作業 1']);
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
    materials: [],
    recentFeedback: [],
    unreadCount: 0,
    archivedCount: 0,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});

function quiz(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    id: `cwq_00000000-0000-0000-0000-00000000000${suffix}`,
    workspaceId: studentId,
    title: `測驗 ${suffix}`,
    prompt: '請回答',
    state: 'open',
    createdAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    dueAt: null,
    unitId: null,
    unitTitle: null,
    responseCount: 0,
    myResponse: null,
    ...extra,
  };
}
it('includes pending quizzes among assignments in deadline order and opens their actual panel', async () => {
  const answered = quiz('3');
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces')
      return {
        workspaces: [{ id: studentId, title: '課程', state: 'active', memberRole: 'student' }],
      };
    if (path.endsWith('/assignments'))
      return { assignments: [assignment('1', { dueAt: '2026-10-10T00:00:00Z' })] };
    if (path.endsWith('/materials')) return { materials: [] };
    return {
      quizzes: [
        quiz('1', { dueAt: '2026-10-09T00:00:00Z' }),
        quiz('2', { state: 'closed', closedAt: '2026-10-08T00:00:00Z' }),
        {
          ...answered,
          myResponse: {
            quizId: answered.id,
            platformAccountId: accountId,
            displayName: '學生',
            answer: '完成',
            state: 'submitted',
            submittedAt: '2026-10-08T00:00:00Z',
            teacherFeedback: null,
            reviewedAt: null,
          },
        },
        quiz('4'),
      ],
    };
  });
  const result = await loadNuniHomeData(transport, accountId);
  expect(result.tasks.map((task) => [task.kind, task.title])).toEqual([
    ['quiz', '測驗 1'],
    ['assignment', '作業 1'],
    ['quiz', '測驗 4'],
  ]);
  expect(result.tasks[0].href).toBe(
    `/classroom/course/${studentId}#quiz-cwq_00000000-0000-0000-0000-000000000001`,
  );
});
it('does not present completed work when the quiz request fails', async () => {
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces')
      return {
        workspaces: [{ id: studentId, title: '課程', state: 'active', memberRole: 'student' }],
      };
    if (path.endsWith('/assignments')) return { assignments: [] };
    if (path.endsWith('/materials')) return { materials: [] };
    throw new NuniError(503, 'UNAVAILABLE');
  });
  await expect(loadNuniHomeData(transport, accountId)).rejects.toMatchObject({ status: 503 });
});
it('rejects quiz completion receipts belonging to another account', async () => {
  const item = quiz('1');
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces')
      return {
        workspaces: [{ id: studentId, title: '課程', state: 'active', memberRole: 'student' }],
      };
    if (path.endsWith('/assignments')) return { assignments: [] };
    if (path.endsWith('/materials')) return { materials: [] };
    return {
      quizzes: [
        {
          ...item,
          myResponse: {
            quizId: item.id,
            platformAccountId: 'pa_00000000-0000-0000-0000-000000000099',
            displayName: '其他人',
            answer: '私密',
            state: 'submitted',
            submittedAt: '2026-10-08T00:00:00Z',
            teacherFeedback: null,
            reviewedAt: null,
          },
        },
      ],
    };
  });
  await expect(loadNuniHomeData(transport, accountId)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
it('lists recent course materials with a one-click cabinet hash and ignores older files', async () => {
  const recent = {
    id: 'cwm_00000000-0000-4000-8000-000000000001',
    workspaceId: studentId,
    title: '本週講義',
    body: 'https://example.test/week.pdf',
    unitId: 'cwu_00000000-0000-4000-8000-000000000001',
    unitTitle: '第 03 週',
    createdByPlatformAccountId: accountId,
    createdAt: new Date().toISOString(),
  };
  const stale = {
    ...recent,
    id: 'cwm_00000000-0000-4000-8000-000000000002',
    title: '去年講義',
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces')
      return {
        workspaces: [{ id: studentId, title: '資料庫', state: 'active', memberRole: 'student' }],
      };
    if (path.endsWith('/assignments')) return { assignments: [] };
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    return { materials: [recent, stale] };
  });
  const result = await loadNuniHomeData(transport, accountId);
  expect(result.materials).toEqual([
    {
      id: recent.id,
      courseId: studentId,
      courseName: '資料庫',
      title: '本週講義',
      unitTitle: '第 03 週',
      createdAt: recent.createdAt,
      href: `/classroom/course/${studentId}#material-${recent.id}`,
    },
  ]);
});
