import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { GRADE_COPY } from './lmsStudentGrades';
import { loadNuniStudentGrades } from './nuniStudentGrades';

const accountId = 'pa_00000000-0000-0000-0000-000000000001';
const studentId = 'cw_00000000-0000-0000-0000-000000000001';
const otherId = 'cw_00000000-0000-0000-0000-000000000002';
const teacherId = 'cw_00000000-0000-0000-0000-000000000003';
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
  transport.mockReset();
});

it('loads every student course even when one course or one activity type fails', async () => {
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: studentId, title: '資料庫', state: 'active', memberRole: 'student' },
          { id: otherId, title: '線性代數', state: 'active', memberRole: 'student' },
          { id: teacherId, title: '我教的課', state: 'active', memberRole: 'owner-teacher' },
        ],
      };
    }
    if (path === `class-workspaces/${studentId}/assignments`) {
      return {
        assignments: [
          assignment('1', {
            workspaceId: studentId,
            mySubmission: {
              assignmentId: 'cwa_00000000-0000-0000-0000-000000000001',
              platformAccountId: accountId,
              displayName: '學生',
              body: '已完成',
              state: 'submitted',
              submittedAt: '2026-10-08T00:00:00Z',
              teacherFeedback: '請補充',
              reviewedAt: '2026-10-09T04:00:00Z',
            },
          }),
        ],
      };
    }
    if (path === `class-workspaces/${studentId}/quizzes`) {
      throw new NuniError(503, 'UPSTREAM_UNAVAILABLE');
    }
    if (path === `class-workspaces/${otherId}/assignments`) {
      throw new NuniError(403, 'ACCESS_DENIED');
    }
    if (path === `class-workspaces/${otherId}/quizzes`) {
      throw new NuniError(403, 'ACCESS_DENIED');
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const result = await loadNuniStudentGrades(transport, accountId);
  expect(result.listError).toBeNull();
  expect(result.teachingCount).toBe(1);
  expect(result.courses).toHaveLength(2);
  const database = result.courses.find((course) => course.courseId === studentId)!;
  expect(database.status).toBe('ready');
  expect(database.quizError).toBe(GRADE_COPY.quizzesFailed);
  expect(database.items).toHaveLength(1);
  expect(database.items[0]).toMatchObject({
    status: 'graded',
    score: null,
    href: `/classroom/course/${studentId}#assignment-cwa_00000000-0000-0000-0000-000000000001`,
  });
  const algebra = result.courses.find((course) => course.courseId === otherId)!;
  expect(algebra.status).toBe('denied');
  expect(algebra.items).toEqual([]);
  expect(algebra.error).toBe(GRADE_COPY.denied);
  expect(transport.mock.calls.some(([path]) => String(path).includes(teacherId))).toBe(false);
});

it('does not invent courses when the membership list cannot be read', async () => {
  transport.mockRejectedValueOnce(new NuniError(403, 'ACCESS_DENIED'));
  const result = await loadNuniStudentGrades(transport, accountId);
  expect(result.courses).toEqual([]);
  expect(result.listError).toBe(GRADE_COPY.denied);
});

it('keeps an empty student account empty instead of filling sample grades', async () => {
  transport.mockResolvedValueOnce({ workspaces: [] });
  expect(await loadNuniStudentGrades(transport, accountId)).toEqual({
    teachingCount: 0,
    courses: [],
    listError: null,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
