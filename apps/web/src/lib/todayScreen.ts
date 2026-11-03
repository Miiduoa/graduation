import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import {
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';
import type { PersonalTodayEntry } from '@campus/shared';
import { courseHrefFromData } from './courseWorkLanding';
import type { HomeCourse, HomeTask } from './homeOverview';
import { courseTaskHref } from './todayCourseWork';
import { sanitizeInternalPath } from './navigation';

export const TIMETABLE_COURSE_WORK_LABEL = '作業與教材';
export const TIMETABLE_COURSE_WORK_FALLBACK = '/classroom';

export function todayClassesFromSchedule(
  entries: readonly PersonalTodayEntry[],
  now: Date,
): TodayClass[] {
  void now;
  return entries.flatMap((entry) => {
    const { startAt, endAt } = entry;
    const linked = entry.row.linkedCourseId?.trim();
    return [
      {
        id: entry.row.id,
        title: entry.row.title,
        location: entry.row.location?.trim() || '',
        startAt,
        endAt,
        // Only trust explicit linkedCourseId; never guess by course title.
        courseId: linked || undefined,
      },
    ];
  });
}

export function todayTodosFromHomeTasks(tasks: readonly HomeTask[]): TodayTodo[] {
  return tasks.flatMap((task) => {
    const dueAt = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
    if (task.dueAt && dueAt === null) return [];
    return [
      {
        id: `${task.courseId}:${task.id}`,
        title: task.title,
        courseName: task.courseName,
        courseId: task.courseId,
        dueAt,
        href: courseTaskHref(task),
      },
    ];
  });
}

/** Same shell as courseWorkLanding: nuni classroom vs school /course. */
export function courseWeekHref(courseId: string | undefined, fallbackHref?: string): string {
  if (fallbackHref) {
    const safe = sanitizeInternalPath(fallbackHref, '');
    if (safe) return weekHash(safe);
  }
  if (!courseId) return '/timetable';
  const landed = courseHrefFromData({ courseId });
  return landed ? `${landed}#week` : '/timetable';
}

/**
 * Resolve a timetable row into the course work shell.
 * Only trust explicit linkedCourseId; otherwise fall back to the classroom list.
 */
export function resolveTimetableCourseWorkHref(input: {
  linkedCourseId?: string | null;
  courseName: string;
  courses?: readonly Pick<HomeCourse, 'id' | 'name'>[];
  fallbackHref?: string;
}): string {
  const linked = input.linkedCourseId?.trim();
  if (linked) {
    const href = courseHrefFromData({ courseId: linked });
    if (href) return href;
  }
  const fallback = sanitizeInternalPath(input.fallbackHref ?? '', '');
  return fallback || TIMETABLE_COURSE_WORK_FALLBACK;
}

export function assignmentHref(todo: TodayTodo): string {
  if (todo.href) return todo.href;
  return courseWeekHref(todo.courseId);
}

export function assignmentSubmitHref(todo: TodayTodo): string {
  const href = assignmentHref(todo);
  try {
    const url = new URL(href, 'https://campus.local');
    // Platform course cards are addressed by their original assignment/quiz ID.
    // Only the school course view has a separate submission-form anchor.
    if (url.pathname.startsWith('/classroom/course/')) return href;
    if (url.hash) return `${url.pathname}${url.search}${url.hash}-submit`;
    return `${href}#submit`;
  } catch {
    return href;
  }
}

function weekHash(path: string): string {
  try {
    const url = new URL(path, 'https://campus.local');
    if (!url.hash) url.hash = 'week';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}
