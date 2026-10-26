import {
  NuniError,
  type createNuniClasses,
  type NuniAssignment,
  type NuniQuiz,
  type NuniWorkspace,
} from './nuni';
import { parseTaipeiInstant, taipeiParts } from './taipeiTime';
import { needsFeedbackReview } from './lmsReviewQueue';

export type NuniStudyTask = {
  id: string;
  kind: 'assignment' | 'quiz';
  courseId: string;
  courseTitle: string;
  title: string;
  dueAt: string | null;
  state: 'open' | 'closed';
  submittedAt: string | null;
  feedback: string | null;
  reviewedAt: string | null;
};

export type NuniStudyAgenda = {
  tasks: NuniStudyTask[];
  workspaces: NuniWorkspace[];
  studiedCourseCount: number;
  failedCourseIds: string[];
  limitedCourseIds: string[];
};

type Classes = Pick<ReturnType<typeof createNuniClasses>, 'list' | 'assignments' | 'quizzes'>;
type ReadResult<T> = { ok: true; value: T } | { ok: false; error: unknown };
type CourseRead = { tasks: NuniStudyTask[]; failed: boolean; limited: boolean };
type Instant = string | number | Date;

const COURSE_CONCURRENCY = 3;
const SOURCE_PAGE_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function isSessionFailure(error: unknown): boolean {
  return error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');
}

function isCourseUnavailable(result: ReadResult<unknown>): boolean {
  return (
    result.ok === false &&
    result.error instanceof NuniError &&
    (result.error.status === 403 || result.error.status === 404)
  );
}

function assignmentTask(course: NuniWorkspace, item: NuniAssignment): NuniStudyTask {
  return {
    id: item.id,
    kind: 'assignment',
    courseId: course.id,
    courseTitle: course.title,
    title: item.title,
    dueAt: item.dueAt,
    state: item.state,
    submittedAt: item.mySubmission?.submittedAt ?? null,
    feedback: item.mySubmission?.teacherFeedback ?? null,
    reviewedAt: item.mySubmission?.reviewedAt ?? null,
  };
}

function quizTask(course: NuniWorkspace, item: NuniQuiz): NuniStudyTask {
  return {
    id: item.id,
    kind: 'quiz',
    courseId: course.id,
    courseTitle: course.title,
    title: item.title,
    dueAt: item.dueAt,
    state: item.state,
    submittedAt: item.myResponse?.submittedAt ?? null,
    feedback: item.myResponse?.teacherFeedback ?? null,
    reviewedAt: item.myResponse?.reviewedAt ?? null,
  };
}

/** Reads platform course work; university selection does not change these memberships. */
export async function loadNuniStudyAgenda(
  classes: Classes,
  workspaces?: NuniWorkspace[],
  fence?: { cancelled(): boolean },
): Promise<NuniStudyAgenda | 'cancelled'> {
  if (fence?.cancelled()) return 'cancelled';

  let stopped = false;
  const cancelled = () => stopped || Boolean(fence?.cancelled());
  const read = async <T>(request: () => Promise<T>): Promise<ReadResult<T>> => {
    try {
      return { ok: true, value: await request() };
    } catch (error) {
      if (isSessionFailure(error)) {
        stopped = true;
        throw error;
      }
      return { ok: false, error };
    }
  };

  try {
    const memberships = workspaces ?? (await classes.list());
    if (fence?.cancelled()) return 'cancelled';
    const snapshot = Array.from(
      new Map(memberships.map((course) => [course.id, { ...course }])).values(),
    );
    const studying = snapshot.filter(
      (course) => course.state === 'active' && course.memberRole === 'student',
    );
    const results: CourseRead[] = new Array(studying.length);
    let nextCourse = 0;

    async function worker() {
      while (!cancelled() && nextCourse < studying.length) {
        const index = nextCourse++;
        const course = studying[index];
        const [assignments, quizzes] = await Promise.all([
          read(() => classes.assignments(course.id)),
          read(() => classes.quizzes(course.id)),
        ]);
        if (cancelled()) return;

        // A revoked membership invalidates both results, even when one request succeeded.
        if (isCourseUnavailable(assignments) || isCourseUnavailable(quizzes)) {
          results[index] = { tasks: [], failed: true, limited: false };
          continue;
        }

        results[index] = {
          tasks: [
            ...(assignments.ok
              ? assignments.value.map((item) => assignmentTask(course, item))
              : []),
            ...(quizzes.ok ? quizzes.value.map((item) => quizTask(course, item)) : []),
          ],
          failed: !assignments.ok || !quizzes.ok,
          // These endpoints have no pagination cursor. A full page cannot prove completeness.
          limited:
            (assignments.ok && assignments.value.length >= SOURCE_PAGE_LIMIT) ||
            (quizzes.ok && quizzes.value.length >= SOURCE_PAGE_LIMIT),
        };
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(COURSE_CONCURRENCY, studying.length) }, () => worker()),
    );
    if (fence?.cancelled()) return 'cancelled';
    return {
      tasks: results.flatMap((result) => result.tasks),
      workspaces: snapshot,
      studiedCourseCount: studying.length,
      failedCourseIds: studying
        .filter((_, index) => results[index].failed)
        .map((course) => course.id),
      limitedCourseIds: studying
        .filter((_, index) => results[index].limited)
        .map((course) => course.id),
    };
  } catch (error) {
    stopped = true;
    if (fence?.cancelled()) return 'cancelled';
    throw error;
  }
}

export function studyTaskStatus(
  task: NuniStudyTask,
): 'pending' | 'submitted' | 'feedback' | 'closed' {
  if (task.submittedAt !== null && parseTaipeiInstant(task.submittedAt) !== null) {
    return needsFeedbackReview({
      teacherFeedback: task.feedback,
      submittedAt: task.submittedAt,
      reviewedAt: task.reviewedAt,
    })
      ? 'submitted'
      : 'feedback';
  }
  return task.state === 'closed' ? 'closed' : 'pending';
}

export function studyTaskTiming(
  task: NuniStudyTask,
  now: Instant,
): 'overdue' | 'today' | 'week' | 'later' | 'undated' {
  const due = task.dueAt === null ? null : parseTaipeiInstant(task.dueAt);
  const instant = parseTaipeiInstant(now);
  if (due === null || instant === null) return 'undated';
  if (due < instant) return 'overdue';
  const dueDate = taipeiParts(due)!;
  const today = taipeiParts(instant)!;
  const days =
    (Date.UTC(dueDate.year, dueDate.month - 1, dueDate.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
    DAY_MS;
  if (days === 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

export function sortStudyTasks(tasks: readonly NuniStudyTask[], now: Instant): NuniStudyTask[] {
  const statusRank = { pending: 0, closed: 1, submitted: 2, feedback: 2 };
  const timingRank = { overdue: 0, today: 1, week: 2, later: 3, undated: 4 };
  const dueTime = (task: NuniStudyTask) =>
    task.dueAt === null ? Infinity : (parseTaipeiInstant(task.dueAt) ?? Infinity);
  const receiptTime = (task: NuniStudyTask) =>
    (studyTaskStatus(task) === 'feedback' && task.reviewedAt
      ? parseTaipeiInstant(task.reviewedAt)
      : null) ??
    (task.submittedAt ? parseTaipeiInstant(task.submittedAt) : null) ??
    0;

  return [...tasks].sort((a, b) => {
    const group = statusRank[studyTaskStatus(a)] - statusRank[studyTaskStatus(b)];
    if (group !== 0) return group;
    if (statusRank[studyTaskStatus(a)] === 2) {
      const receipt = receiptTime(b) - receiptTime(a);
      if (receipt !== 0) return receipt;
    }
    const timing = timingRank[studyTaskTiming(a, now)] - timingRank[studyTaskTiming(b, now)];
    if (timing !== 0) return timing;
    const aDue = dueTime(a);
    const bDue = dueTime(b);
    if (aDue !== bDue) return aDue - bDue;
    return (
      a.courseTitle.localeCompare(b.courseTitle, 'zh-Hant') ||
      a.title.localeCompare(b.title, 'zh-Hant') ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id)
    );
  });
}

// A small, explainable queue: urgent work comes first, with course variety among
// equally urgent items. Only server-confirmed, still-open tasks can be suggested.
export type NuniFocusTiming = 'overdue' | 'today' | 'week' | 'later' | 'undated';
export type NuniFocusItem = { task: NuniStudyTask; timing: NuniFocusTiming };

export function recommendStudyFocus(
  tasks: readonly NuniStudyTask[],
  now: Instant,
  requestedLimit = 3,
): NuniFocusItem[] {
  const instant = parseTaipeiInstant(now);
  if (instant === null || !Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];
  const limit = Math.min(6, Math.floor(requestedLimit));
  if (!limit) return [];

  const pending = sortStudyTasks(
    tasks.filter((task) => studyTaskStatus(task) === 'pending'),
    instant,
  ).map((task) => ({ task, timing: studyTaskTiming(task, instant) }));
  const result: NuniFocusItem[] = [];

  for (const timing of ['overdue', 'today', 'week', 'later', 'undated'] as const) {
    const bucket = pending.filter((item) => item.timing === timing);
    const seenCourses = new Set<string>();
    const firstPass: NuniFocusItem[] = [];
    const remaining: NuniFocusItem[] = [];
    for (const item of bucket) {
      if (seenCourses.has(item.task.courseId)) remaining.push(item);
      else {
        seenCourses.add(item.task.courseId);
        firstPass.push(item);
      }
    }
    for (const item of [...firstPass, ...remaining]) {
      if (result.length === limit) return result;
      result.push(item);
    }
  }
  return result;
}
