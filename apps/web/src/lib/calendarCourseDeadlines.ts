import {
  createNuniClasses,
  NuniError,
  type NuniAssignment,
  type NuniQuiz,
  type NuniTransport,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { parseTaipeiInstant, taipeiParts } from '@campus/shared/src/taipeiTime';
import type { HomeTask } from './homeOverview';
import {
  calendarDueItemsFromTasks,
  type CalendarDueItem,
} from './todayCourseWork';

export const CALENDAR_DEADLINE_SOURCE_NUNI = 'nuni 課程';
export const CALENDAR_DEADLINE_SOURCE_LMS = '校園 LMS／匯入';

export type CalendarDeadlineSource = 'nuni' | 'lms';

export type CalendarCourseDeadline = CalendarDueItem & {
  source: CalendarDeadlineSource;
  sourceLabel: string;
};

type Classes = Pick<ReturnType<typeof createNuniClasses>, 'list' | 'assignments' | 'quizzes'>;

const COURSE_CONCURRENCY = 3;
const TEACHING_ROLES = new Set(['owner-teacher', 'co-teacher']);

function taipeiDayKey(value: string | Date | number): string | null {
  const parts = taipeiParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Deep link into /classroom course work; hash carries the assignment/quiz id. */
export function classroomAssignmentHref(
  courseId: string,
  kind: 'assignment' | 'quiz',
  workId: string,
): string {
  const view = kind === 'quiz' ? 'quizzes' : 'assignments';
  return `/classroom/course/${encodeURIComponent(courseId)}?view=${view}#${kind}-${encodeURIComponent(workId)}`;
}

function deadlineFromNuni(input: {
  courseId: string;
  courseName: string;
  workId: string;
  title: string;
  dueAt: string | null;
  kind: 'assignment' | 'quiz';
}): CalendarCourseDeadline | null {
  if (!input.dueAt) return null;
  const instant = parseTaipeiInstant(input.dueAt);
  if (instant === null) return null;
  const dueDate = taipeiDayKey(instant);
  if (!dueDate) return null;
  return {
    id: `${input.courseId}:${input.workId}`,
    title: input.title,
    courseName: input.courseName,
    courseId: input.courseId,
    dueDate,
    href: classroomAssignmentHref(input.courseId, input.kind, input.workId),
    source: 'nuni',
    sourceLabel: CALENDAR_DEADLINE_SOURCE_NUNI,
  };
}

export function calendarDeadlinesFromLmsTasks(
  tasks: readonly HomeTask[],
): CalendarCourseDeadline[] {
  return sortDeadlines(
    calendarDueItemsFromTasks(tasks).map((item) => ({
      ...item,
      source: 'lms' as const,
      sourceLabel: CALENDAR_DEADLINE_SOURCE_LMS,
    })),
  );
}

function fromNuniAssignment(
  course: NuniWorkspace,
  item: NuniAssignment,
): CalendarCourseDeadline | null {
  return deadlineFromNuni({
    courseId: course.id,
    courseName: course.title,
    workId: item.id,
    title: item.title,
    dueAt: item.dueAt,
    kind: 'assignment',
  });
}

function fromNuniQuiz(course: NuniWorkspace, item: NuniQuiz): CalendarCourseDeadline | null {
  return deadlineFromNuni({
    courseId: course.id,
    courseName: course.title,
    workId: item.id,
    title: item.title,
    dueAt: item.dueAt,
    kind: 'quiz',
  });
}

function isRelevantMembership(course: NuniWorkspace): boolean {
  return (
    course.state === 'active' &&
    (course.memberRole === 'student' || TEACHING_ROLES.has(course.memberRole))
  );
}

function sortDeadlines(items: CalendarCourseDeadline[]): CalendarCourseDeadline[] {
  return [...items].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      a.courseName.localeCompare(b.courseName, 'zh-TW') ||
      a.title.localeCompare(b.title, 'zh-TW') ||
      a.id.localeCompare(b.id),
  );
}

function softKey(item: CalendarCourseDeadline): string {
  return `${item.dueDate}|${item.title.trim().toLocaleLowerCase('zh-TW')}|${item.courseName.trim().toLocaleLowerCase('zh-TW')}`;
}

/**
 * Prefer nuni classroom rows when the same work also appears from LMS／匯入.
 * Match by course:work id first, then by due date + title + course name.
 */
export function mergeCalendarCourseDeadlines(
  nuni: readonly CalendarCourseDeadline[],
  lms: readonly CalendarCourseDeadline[],
): CalendarCourseDeadline[] {
  const byId = new Map<string, CalendarCourseDeadline>();
  const soft = new Set<string>();

  for (const item of nuni) {
    byId.set(item.id, item);
    soft.add(softKey(item));
  }
  for (const item of lms) {
    if (byId.has(item.id) || soft.has(softKey(item))) continue;
    byId.set(item.id, item);
    soft.add(softKey(item));
  }
  return sortDeadlines([...byId.values()]);
}

export function calendarCourseDeadlinesOnDate(
  items: readonly CalendarCourseDeadline[],
  date: string,
): CalendarCourseDeadline[] {
  return items.filter((item) => item.dueDate === date);
}

export function calendarCourseDeadlinesInMonth(
  items: readonly CalendarCourseDeadline[],
  month: string,
): CalendarCourseDeadline[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return items.filter((item) => item.dueDate.startsWith(`${month}-`));
}

async function readCourseDeadlines(
  classes: Classes,
  course: NuniWorkspace,
): Promise<CalendarCourseDeadline[]> {
  const [assignments, quizzes] = await Promise.all([
    classes.assignments(course.id).catch((error: unknown) => {
      if (
        error instanceof NuniError &&
        (error.status === 401 || error.code === 'SESSION_CHANGED' || error.code === 'INVALID_RESPONSE')
      ) {
        throw error;
      }
      if (error instanceof NuniError && (error.status === 403 || error.status === 404)) {
        return [] as NuniAssignment[];
      }
      return [] as NuniAssignment[];
    }),
    classes.quizzes(course.id).catch((error: unknown) => {
      if (
        error instanceof NuniError &&
        (error.status === 401 || error.code === 'SESSION_CHANGED' || error.code === 'INVALID_RESPONSE')
      ) {
        throw error;
      }
      if (error instanceof NuniError && (error.status === 403 || error.status === 404)) {
        return [] as NuniQuiz[];
      }
      return [] as NuniQuiz[];
    }),
  ]);
  return [
    ...assignments.flatMap((item) => {
      const row = fromNuniAssignment(course, item);
      return row ? [row] : [];
    }),
    ...quizzes.flatMap((item) => {
      const row = fromNuniQuiz(course, item);
      return row ? [row] : [];
    }),
  ];
}

/** Loads dated nuni /classroom assignments for studying or teaching memberships. */
export async function loadNuniCalendarDeadlines(
  transport: NuniTransport,
  platformAccountId: string,
  fence?: { cancelled(): boolean },
): Promise<CalendarCourseDeadline[] | 'cancelled'> {
  if (fence?.cancelled()) return 'cancelled';
  const classes = createNuniClasses(transport, platformAccountId);
  const memberships = await classes.list();
  if (fence?.cancelled()) return 'cancelled';
  const courses = memberships.filter(isRelevantMembership);
  const results: CalendarCourseDeadline[][] = new Array(courses.length);
  let next = 0;

  async function worker() {
    while (!fence?.cancelled() && next < courses.length) {
      const index = next++;
      results[index] = await readCourseDeadlines(classes, courses[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(COURSE_CONCURRENCY, Math.max(courses.length, 1)) }, () =>
      worker(),
    ),
  );
  if (fence?.cancelled()) return 'cancelled';
  return sortDeadlines(results.flat());
}
