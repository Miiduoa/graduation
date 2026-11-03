import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { HomeTask } from './homeOverview';
import {
  CALENDAR_DEADLINE_SOURCE_LMS,
  CALENDAR_DEADLINE_SOURCE_NUNI,
  calendarCourseDeadlinesInMonth,
  calendarCourseDeadlinesOnDate,
  calendarDeadlinesFromLmsTasks,
  classroomAssignmentHref,
  loadNuniCalendarDeadlines,
  mergeCalendarCourseDeadlines,
  type CalendarCourseDeadline,
} from './calendarCourseDeadlines';

const accountId = 'pa_00000000-0000-0000-0000-000000000001';
const studentCourse = 'cw_00000000-0000-0000-0000-000000000001';
const teacherCourse = 'cw_00000000-0000-0000-0000-000000000002';
const archivedCourse = 'cw_00000000-0000-0000-0000-000000000003';

function assignment(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    id: `cwa_00000000-0000-0000-0000-00000000000${suffix}`,
    workspaceId: studentCourse,
    title: `作業 ${suffix}`,
    instructions: '請完成',
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

function quiz(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    id: `cwq_00000000-0000-0000-0000-00000000000${suffix}`,
    workspaceId: studentCourse,
    title: `測驗 ${suffix}`,
    prompt: '請作答',
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

function task(partial: Partial<HomeTask> & Pick<HomeTask, 'id'>): HomeTask {
  return {
    kind: 'assignment',
    courseId: 'cs101',
    courseName: '資料庫',
    title: '期末報告',
    dueAt: '2026-10-22T10:00:00.000Z',
    href: '/course/cs101#assignment-a',
    ...partial,
  };
}

function deadline(
  partial: Partial<CalendarCourseDeadline> & Pick<CalendarCourseDeadline, 'id' | 'source'>,
): CalendarCourseDeadline {
  return {
    title: '作業',
    courseName: '課程',
    courseId: 'cw_1',
    dueDate: '2026-10-22',
    href: '/classroom/course/cw_1?view=assignments#assignment-a',
    sourceLabel:
      partial.source === 'nuni' ? CALENDAR_DEADLINE_SOURCE_NUNI : CALENDAR_DEADLINE_SOURCE_LMS,
    ...partial,
  };
}

const transport = vi.fn();

beforeEach(() => {
  transport.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});

it('builds classroom assignment links with view and hash id', () => {
  expect(classroomAssignmentHref(studentCourse, 'assignment', 'cwa_1')).toBe(
    `/classroom/course/${studentCourse}?view=assignments#assignment-cwa_1`,
  );
  expect(classroomAssignmentHref(studentCourse, 'quiz', 'cwq_1')).toBe(
    `/classroom/course/${studentCourse}?view=quizzes#quiz-cwq_1`,
  );
});

it('skips undated or invalid LMS tasks and sorts by due date', () => {
  const rows = calendarDeadlinesFromLmsTasks([
    task({ id: 'later', dueAt: '2026-10-28T02:00:00.000Z', title: '後交' }),
    task({ id: 'open', dueAt: null }),
    task({ id: 'bad', dueAt: 'not-a-date' }),
    task({ id: 'soon', dueAt: '2026-10-22T10:00:00.000Z', title: '先交' }),
  ]);
  expect(rows.map((row) => row.id)).toEqual(['cs101:soon', 'cs101:later']);
  expect(rows.every((row) => row.source === 'lms')).toBe(true);
  expect(rows[0].sourceLabel).toBe(CALENDAR_DEADLINE_SOURCE_LMS);
  expect(rows[0].dueDate <= rows[1].dueDate).toBe(true);
});

it('merges nuni over LMS duplicates by id or soft key, then sorts', () => {
  const nuni = [
    deadline({
      id: 'cw_1:a',
      source: 'nuni',
      title: '同一份',
      courseName: '資料庫',
      dueDate: '2026-10-22',
      href: '/classroom/course/cw_1?view=assignments#assignment-a',
    }),
    deadline({
      id: 'cw_2:b',
      source: 'nuni',
      title: '只在 nuni',
      courseName: '程式',
      courseId: 'cw_2',
      dueDate: '2026-10-25',
      href: '/classroom/course/cw_2?view=assignments#assignment-b',
    }),
  ];
  const lms = [
    deadline({
      id: 'cw_1:a',
      source: 'lms',
      title: '同一份（LMS）',
      courseName: '資料庫',
      dueDate: '2026-10-22',
      href: '/course/cw_1#assignment-a',
    }),
    deadline({
      id: 'other:soft',
      source: 'lms',
      title: '同一份',
      courseName: '資料庫',
      courseId: 'other',
      dueDate: '2026-10-22',
      href: '/course/other#assignment-soft',
    }),
    deadline({
      id: 'lms:only',
      source: 'lms',
      title: '只在 LMS',
      courseName: '國文',
      courseId: 'zh',
      dueDate: '2026-10-20',
      href: '/course/zh#assignment-only',
    }),
  ];
  const merged = mergeCalendarCourseDeadlines(nuni, lms);
  expect(merged.map((row) => [row.id, row.source])).toEqual([
    ['lms:only', 'lms'],
    ['cw_1:a', 'nuni'],
    ['cw_2:b', 'nuni'],
  ]);
});

it('filters deadlines by day and month', () => {
  const rows = [
    deadline({ id: 'a', source: 'nuni', dueDate: '2026-10-22' }),
    deadline({ id: 'b', source: 'lms', dueDate: '2026-10-28' }),
    deadline({ id: 'c', source: 'nuni', dueDate: '2026-11-01' }),
  ];
  expect(calendarCourseDeadlinesOnDate(rows, '2026-10-22').map((row) => row.id)).toEqual(['a']);
  expect(calendarCourseDeadlinesInMonth(rows, '2026-10').map((row) => row.id)).toEqual(['a', 'b']);
  expect(calendarCourseDeadlinesInMonth(rows, 'bad')).toEqual([]);
});

it('loads dated nuni assignments for studying and teaching courses, skips undated', async () => {
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: studentCourse, title: '修習課', state: 'active', memberRole: 'student' },
          { id: teacherCourse, title: '授課', state: 'active', memberRole: 'owner-teacher' },
          { id: archivedCourse, title: '封存', state: 'archived', memberRole: 'student' },
        ],
      };
    }
    if (path === `class-workspaces/${studentCourse}/assignments`) {
      return {
        assignments: [
          assignment('1', { dueAt: '2026-10-28T02:00:00Z', title: '後交' }),
          assignment('2', { dueAt: null, title: '無截止' }),
          assignment('4', {
            dueAt: '2026-10-22T10:00:00Z',
            title: '先交',
            mySubmission: {
              assignmentId: 'cwa_00000000-0000-0000-0000-000000000004',
              platformAccountId: accountId,
              displayName: '學生',
              body: '已交',
              state: 'submitted',
              submittedAt: '2026-10-20T00:00:00Z',
              teacherFeedback: null,
              reviewedAt: null,
            },
          }),
        ],
      };
    }
    if (path === `class-workspaces/${studentCourse}/quizzes`) {
      return { quizzes: [quiz('1', { dueAt: '2026-10-23T04:00:00Z', title: '小考' })] };
    }
    if (path === `class-workspaces/${teacherCourse}/assignments`) {
      return {
        assignments: [
          assignment('9', {
            workspaceId: teacherCourse,
            dueAt: '2026-10-21T15:00:00Z',
            title: '老師發的',
          }),
        ],
      };
    }
    if (path.endsWith('/quizzes')) return { quizzes: [] };
    throw new Error(`Unexpected request: ${path}`);
  });

  const result = await loadNuniCalendarDeadlines(transport, accountId);
  expect(result).not.toBe('cancelled');
  if (result === 'cancelled') return;
  expect(result.map((row) => row.title)).toEqual(['老師發的', '先交', '小考', '後交']);
  expect(result[0]).toMatchObject({
    source: 'nuni',
    sourceLabel: CALENDAR_DEADLINE_SOURCE_NUNI,
    courseId: teacherCourse,
    href: `/classroom/course/${teacherCourse}?view=assignments#assignment-cwa_00000000-0000-0000-0000-000000000009`,
  });
  expect(result.find((row) => row.title === '小考')?.href).toBe(
    `/classroom/course/${studentCourse}?view=quizzes#quiz-cwq_00000000-0000-0000-0000-000000000001`,
  );
  expect(transport.mock.calls.map(([path]) => path).sort()).toEqual(
    [
      'class-workspaces',
      `class-workspaces/${studentCourse}/assignments`,
      `class-workspaces/${studentCourse}/quizzes`,
      `class-workspaces/${teacherCourse}/assignments`,
      `class-workspaces/${teacherCourse}/quizzes`,
    ].sort(),
  );
});

it('returns empty list when there are no active courses', async () => {
  transport.mockResolvedValueOnce({ workspaces: [] });
  expect(await loadNuniCalendarDeadlines(transport, accountId)).toEqual([]);
});

it('stops when cancelled before or during load', async () => {
  expect(
    await loadNuniCalendarDeadlines(transport, accountId, { cancelled: () => true }),
  ).toBe('cancelled');
  expect(transport).not.toHaveBeenCalled();

  let cancelled = false;
  const gate = {
    promise: null as Promise<unknown> | null,
    resolve: (() => {}) as (value?: unknown) => void,
  };
  gate.promise = new Promise((resolve) => {
    gate.resolve = resolve;
  });
  transport.mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') {
      return {
        workspaces: [
          { id: studentCourse, title: '修習課', state: 'active', memberRole: 'student' },
        ],
      };
    }
    await gate.promise;
    return path.endsWith('/quizzes') ? { quizzes: [] } : { assignments: [] };
  });
  const reading = loadNuniCalendarDeadlines(transport, accountId, {
    cancelled: () => cancelled,
  });
  await vi.waitFor(() => expect(transport).toHaveBeenCalled());
  cancelled = true;
  gate.resolve(undefined);
  expect(await reading).toBe('cancelled');
});

it('propagates session failures and treats missing courses as empty', async () => {
  transport
    .mockResolvedValueOnce({
      workspaces: [
        { id: studentCourse, title: '修習課', state: 'active', memberRole: 'student' },
      ],
    })
    .mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'))
    .mockRejectedValueOnce(new NuniError(404, 'NOT_FOUND'));
  expect(await loadNuniCalendarDeadlines(transport, accountId)).toEqual([]);

  transport.mockReset().mockRejectedValueOnce(new NuniError(401, 'SESSION_CHANGED'));
  await expect(loadNuniCalendarDeadlines(transport, accountId)).rejects.toMatchObject({
    status: 401,
  });
});
