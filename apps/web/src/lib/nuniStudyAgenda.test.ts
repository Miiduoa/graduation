import { describe, expect, it, vi } from 'vitest';
import {
  createNuniClasses,
  NuniError,
  type NuniAssignment,
  type NuniQuiz,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import {
  loadNuniStudyAgenda,
  sortStudyTasks,
  studyTaskStatus,
  studyTaskTiming,
  type NuniStudyTask,
} from '@campus/shared/src/nuniStudyAgenda';

const accountId = 'pa_00000000-0000-0000-0000-000000000001';
const now = '2026-10-25T12:00:00+08:00';
const uuid = (prefix: string, suffix: number) =>
  `${prefix}_00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;

function workspace(index: number, extra: Partial<NuniWorkspace> = {}): NuniWorkspace {
  return {
    id: uuid('cw', index),
    title: `課程 ${index}`,
    state: 'active',
    memberRole: 'student',
    ...extra,
  };
}

function assignment(index: number, extra: Partial<NuniAssignment> = {}): NuniAssignment {
  return {
    id: uuid('cwa', index),
    workspaceId: workspace(1).id,
    title: `作業 ${index}`,
    instructions: '請附上實作結果',
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

function quiz(index: number, extra: Partial<NuniQuiz> = {}): NuniQuiz {
  return {
    id: uuid('cwq', index),
    workspaceId: workspace(1).id,
    title: `測驗 ${index}`,
    prompt: '說明原因',
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

function task(index: number, extra: Partial<NuniStudyTask> = {}): NuniStudyTask {
  return {
    id: uuid('cwa', index),
    kind: 'assignment',
    courseId: workspace(1).id,
    courseTitle: '資料庫管理',
    title: `作業 ${index}`,
    dueAt: null,
    state: 'open',
    submittedAt: null,
    feedback: null,
    reviewedAt: null,
    ...extra,
  };
}

function classesFor(workspaces: NuniWorkspace[] = [workspace(1)]) {
  return {
    list: vi.fn(async () => workspaces),
    assignments: vi.fn(async (_id: string): Promise<NuniAssignment[]> => []),
    quizzes: vi.fn(async (_id: string): Promise<NuniQuiz[]> => []),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('loadNuniStudyAgenda', () => {
  it('collects both task kinds from active student courses without changing the supplied memberships', async () => {
    const workspaces = [
      workspace(1),
      workspace(2, { memberRole: 'owner-teacher' }),
      workspace(3, { state: 'archived' }),
      workspace(4),
      workspace(5, { memberRole: 'co-teacher' }),
    ];
    const before = structuredClone(workspaces);
    workspaces.forEach(Object.freeze);
    const classes = classesFor();
    classes.assignments.mockImplementation(async (id) => [assignment(1, { workspaceId: id })]);
    classes.quizzes.mockImplementation(async (id) => [quiz(1, { workspaceId: id })]);

    const result = await loadNuniStudyAgenda(classes, workspaces);
    expect(result).toMatchObject({
      studiedCourseCount: 2,
      failedCourseIds: [],
      limitedCourseIds: [],
      workspaces,
    });
    if (result === 'cancelled') throw new Error('unexpected cancellation');
    expect(result.tasks.map(({ courseId, kind }) => [courseId, kind])).toEqual([
      [workspace(1).id, 'assignment'],
      [workspace(1).id, 'quiz'],
      [workspace(4).id, 'assignment'],
      [workspace(4).id, 'quiz'],
    ]);
    expect(classes.list).not.toHaveBeenCalled();
    expect(classes.assignments.mock.calls.map(([id]) => id)).toEqual([
      workspace(1).id,
      workspace(4).id,
    ]);
    expect(result.workspaces).not.toBe(workspaces);
    expect(result.workspaces[0]).not.toBe(workspaces[0]);
    expect(workspaces).toEqual(before);
  });

  it('lists courses once only when no membership snapshot is supplied', async () => {
    const classes = classesFor([]);
    expect(await loadNuniStudyAgenda(classes)).toEqual({
      tasks: [],
      workspaces: [],
      studiedCourseCount: 0,
      failedCourseIds: [],
      limitedCourseIds: [],
    });
    expect(classes.list).toHaveBeenCalledTimes(1);
    expect(classes.assignments).not.toHaveBeenCalled();
    await loadNuniStudyAgenda(classes, []);
    expect(classes.list).toHaveBeenCalledTimes(1);
  });

  it.each(['assignments', 'quizzes'] as const)(
    'preserves the successful endpoint when %s is temporarily unavailable',
    async (endpoint) => {
      const classes = classesFor();
      classes.assignments.mockResolvedValue([assignment(1)]);
      classes.quizzes.mockResolvedValue([quiz(1)]);
      classes[endpoint].mockRejectedValue(new NuniError(503, 'UNAVAILABLE'));
      const result = await loadNuniStudyAgenda(classes);
      expect(result).toMatchObject({ failedCourseIds: [workspace(1).id] });
      if (result === 'cancelled') throw new Error('unexpected cancellation');
      expect(result.tasks.map(({ kind }) => kind)).toEqual([
        endpoint === 'assignments' ? 'quiz' : 'assignment',
      ]);
    },
  );

  it.each([403, 404])('removes both endpoint results after a course returns %i', async (status) => {
    const classes = classesFor([workspace(1), workspace(2)]);
    classes.assignments.mockImplementation(async (id) => [assignment(1, { workspaceId: id })]);
    classes.quizzes.mockImplementation(async (id) => {
      if (id === workspace(1).id) throw new NuniError(status, 'COURSE_UNAVAILABLE');
      return [quiz(2, { workspaceId: id })];
    });
    const result = await loadNuniStudyAgenda(classes);
    expect(result).toMatchObject({ failedCourseIds: [workspace(1).id] });
    if (result === 'cancelled') throw new Error('unexpected cancellation');
    expect(result.tasks.every(({ courseId }) => courseId === workspace(2).id)).toBe(true);
    expect(result.tasks).toHaveLength(2);
  });

  it.each([new NuniError(401, 'SESSION_EXPIRED'), new NuniError(409, 'SESSION_CHANGED')])(
    'rejects immediately on $code without queuing more courses',
    async (error) => {
      const workspaces = Array.from({ length: 6 }, (_, index) => workspace(index + 1));
      const classes = classesFor(workspaces);
      const slowQuizzes = deferred<NuniQuiz[]>();
      classes.assignments.mockRejectedValue(error);
      classes.quizzes.mockImplementation(() => slowQuizzes.promise);
      const reading = loadNuniStudyAgenda(classes, workspaces);
      await expect(reading).rejects.toBe(error);
      expect(classes.assignments).toHaveBeenCalledTimes(3);
      slowQuizzes.resolve([]);
      await Promise.resolve();
      expect(classes.assignments).toHaveBeenCalledTimes(3);
    },
  );

  it('limits concurrent courses to three while reading both endpoints in parallel', async () => {
    const workspaces = Array.from({ length: 7 }, (_, index) => workspace(index + 1));
    const assignments = workspaces.map(() => deferred<NuniAssignment[]>());
    const quizzes = workspaces.map(() => deferred<NuniQuiz[]>());
    const classes = classesFor(workspaces);
    const indexOf = (id: string) => workspaces.findIndex((course) => course.id === id);
    classes.assignments.mockImplementation((id) => assignments[indexOf(id)].promise);
    classes.quizzes.mockImplementation((id) => quizzes[indexOf(id)].promise);
    const reading = loadNuniStudyAgenda(classes, workspaces);
    expect(classes.assignments).toHaveBeenCalledTimes(3);
    expect(classes.quizzes).toHaveBeenCalledTimes(3);

    assignments[1].resolve([]);
    await Promise.resolve();
    expect(classes.assignments).toHaveBeenCalledTimes(3);
    quizzes[1].resolve([]);
    await vi.waitFor(() => expect(classes.assignments).toHaveBeenCalledTimes(4));
    expect(classes.assignments.mock.calls[3][0]).toBe(workspace(4).id);
    assignments.forEach((gate) => gate.resolve([]));
    quizzes.forEach((gate) => gate.resolve([]));
    expect(await reading).toMatchObject({ studiedCourseCount: 7, tasks: [] });
    expect(classes.assignments).toHaveBeenCalledTimes(7);
    expect(classes.quizzes).toHaveBeenCalledTimes(7);
  });

  it('does not issue requests after cancellation before loading or during the membership read', async () => {
    const classes = classesFor();
    expect(await loadNuniStudyAgenda(classes, undefined, { cancelled: () => true })).toBe(
      'cancelled',
    );
    expect(classes.list).not.toHaveBeenCalled();
    let cancelled = false;
    const listing = deferred<NuniWorkspace[]>();
    classes.list.mockImplementation(() => listing.promise);
    const reading = loadNuniStudyAgenda(classes, undefined, { cancelled: () => cancelled });
    cancelled = true;
    listing.resolve([workspace(1)]);
    expect(await reading).toBe('cancelled');
    expect(classes.assignments).not.toHaveBeenCalled();
  });

  it('discards in-flight results and stops queued courses after cancellation', async () => {
    const workspaces = Array.from({ length: 5 }, (_, index) => workspace(index + 1));
    const classes = classesFor(workspaces);
    const gate = deferred<NuniAssignment[]>();
    let cancelled = false;
    classes.assignments.mockImplementation(() => gate.promise);
    const reading = loadNuniStudyAgenda(classes, workspaces, { cancelled: () => cancelled });
    cancelled = true;
    gate.resolve([assignment(1)]);
    expect(await reading).toBe('cancelled');
    expect(classes.assignments).toHaveBeenCalledTimes(3);
  });

  it('marks a source-limited course at or above 100 items in either endpoint', async () => {
    const workspaces = [workspace(1), workspace(2), workspace(3)];
    const classes = classesFor(workspaces);
    classes.assignments.mockImplementation(async (id) =>
      Array.from({ length: id === workspace(1).id ? 100 : 99 }, (_, index) =>
        assignment(index + 1, { workspaceId: id }),
      ),
    );
    classes.quizzes.mockImplementation(async (id) =>
      Array.from({ length: id === workspace(2).id ? 101 : 0 }, (_, index) =>
        quiz(index + 1, { workspaceId: id }),
      ),
    );
    expect(await loadNuniStudyAgenda(classes, workspaces)).toMatchObject({
      failedCourseIds: [],
      limitedCourseIds: [workspace(1).id, workspace(2).id],
    });
  });

  it('maps only the authenticated student receipts, including feedback and closed assignments', async () => {
    const item = assignment(1, { state: 'closed', closedAt: '2026-10-26T00:00:00Z' });
    item.mySubmission = {
      assignmentId: item.id,
      platformAccountId: accountId,
      displayName: '學生',
      body: '完成報告',
      state: 'submitted',
      submittedAt: '2026-10-24T08:00:00Z',
      teacherFeedback: '資料來源完整',
      reviewedAt: '2026-10-25T03:00:00Z',
    };
    const classes = classesFor();
    classes.assignments.mockResolvedValue([item]);
    const result = await loadNuniStudyAgenda(classes);
    if (result === 'cancelled') throw new Error('unexpected cancellation');
    expect(result.tasks[0]).toMatchObject({
      state: 'closed',
      submittedAt: item.mySubmission.submittedAt,
      feedback: item.mySubmission.teacherFeedback,
      reviewedAt: item.mySubmission.reviewedAt,
    });
    expect(studyTaskStatus(result.tasks[0])).toBe('feedback');
  });

  it('never uses another account receipt returned by the source as a completed task', async () => {
    const item = assignment(1);
    const transport = vi.fn(async (path: string) => {
      if (path === 'class-workspaces') return { workspaces: [workspace(1)] };
      if (path.endsWith('/quizzes')) return { quizzes: [] };
      return {
        assignments: [
          {
            ...item,
            mySubmission: {
              assignmentId: item.id,
              platformAccountId: uuid('pa', 2),
              displayName: '另一位學生',
              body: '其他帳號的作業',
              state: 'submitted',
              submittedAt: '2026-10-24T08:00:00Z',
              teacherFeedback: null,
              reviewedAt: null,
            },
          },
        ],
      };
    });
    expect(await loadNuniStudyAgenda(createNuniClasses(transport, accountId))).toMatchObject({
      tasks: [],
      failedCourseIds: [workspace(1).id],
    });
  });
});

describe('study task status, time and ordering', () => {
  it('treats feedback older than a resubmission as awaiting review and sorts by the new receipt', () => {
    const resubmitted = task(1, {
      submittedAt: '2026-10-25T12:00:00',
      feedback: '請補上第三節',
      reviewedAt: '2026-10-25T03:00:00Z',
    });
    const reviewed = task(2, {
      submittedAt: '2026-10-24T12:00:00',
      feedback: '已確認',
      reviewedAt: '2026-10-25T11:30:00',
    });
    expect(studyTaskStatus(resubmitted)).toBe('submitted');
    expect(studyTaskStatus(reviewed)).toBe('feedback');
    expect(sortStudyTasks([reviewed, resubmitted], now).map(({ id }) => id)).toEqual([
      resubmitted.id,
      reviewed.id,
    ]);
    expect(studyTaskStatus({ ...resubmitted, reviewedAt: resubmitted.submittedAt })).toBe(
      'feedback',
    );
  });

  it('keeps closure distinct from deadlines and uses a real receipt before showing completion', () => {
    expect(studyTaskStatus(task(1, { dueAt: '2026-10-01T00:00:00Z' }))).toBe('pending');
    expect(studyTaskStatus(task(1, { state: 'closed' }))).toBe('closed');
    expect(studyTaskStatus(task(1, { submittedAt: 'invalid' }))).toBe('pending');
    expect(studyTaskStatus(task(1, { feedback: '不是提交證明', reviewedAt: now }))).toBe('pending');
    expect(studyTaskStatus(task(1, { state: 'closed', submittedAt: now }))).toBe('submitted');
    expect(
      studyTaskStatus(task(1, { submittedAt: now, feedback: '已回饋', reviewedAt: now })),
    ).toBe('feedback');
  });

  it('interprets naive deadlines as Taipei time and handles midnight independently of host time', () => {
    const midnight = '2026-10-24T16:00:00Z';
    expect(studyTaskTiming(task(1, { dueAt: '2026-10-25T00:00:00' }), midnight)).toBe('today');
    expect(studyTaskTiming(task(1, { dueAt: '2026-10-24T23:59:59' }), midnight)).toBe('overdue');
    expect(studyTaskTiming(task(1, { dueAt: '2026-10-25T23:59:59' }), midnight)).toBe('today');
    expect(studyTaskTiming(task(1, { dueAt: '2026-10-26T00:00:00' }), midnight)).toBe('week');
    expect(studyTaskTiming(task(1, { dueAt: '2026-10-25T01:00:00+09:00' }), midnight)).toBe(
      'today',
    );
  });

  it('counts the next seven Taipei calendar days, including the final evening', () => {
    expect(studyTaskTiming(task(1, { dueAt: '2026-11-01T23:59:59+08:00' }), now)).toBe('week');
    expect(studyTaskTiming(task(1, { dueAt: '2026-11-02T00:00:00+08:00' }), now)).toBe('later');
    expect(
      studyTaskTiming(task(1, { dueAt: '2027-01-02T23:59:59+08:00' }), '2026-12-26T20:00:00+08:00'),
    ).toBe('week');
    expect(studyTaskTiming(task(1, { dueAt: null }), now)).toBe('undated');
    expect(studyTaskTiming(task(1, { dueAt: 'not a date' }), now)).toBe('undated');
    expect(studyTaskTiming(task(1, { dueAt: now }), new Date(NaN))).toBe('undated');
  });

  it('prioritizes open work, then closed work, then latest receipts without mutating any inputs', () => {
    const rows = [
      task(1, { dueAt: '2026-10-26T12:00:00' }),
      task(2, { dueAt: null }),
      task(3, { dueAt: '2026-10-25T19:00:00' }),
      task(4, { dueAt: '2026-10-24T12:00:00' }),
      task(5, { state: 'closed', dueAt: '2026-10-01T12:00:00' }),
      task(6, { submittedAt: '2026-10-24T12:00:00', dueAt: '2026-10-01T12:00:00' }),
      task(7, {
        state: 'closed',
        submittedAt: '2026-10-22T12:00:00',
        feedback: '完成',
        reviewedAt: '2026-10-25T13:00:00',
      }),
      task(8, { dueAt: '2026-11-10T12:00:00' }),
    ];
    const original = structuredClone(rows);
    rows.forEach(Object.freeze);
    Object.freeze(rows);
    const sorted = sortStudyTasks(rows, now);
    expect(sorted.map(({ id }) => id)).toEqual(
      [4, 3, 1, 8, 2, 5, 7, 6].map((id) => uuid('cwa', id)),
    );
    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(original);
  });
});
