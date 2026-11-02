import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import {
  type TodayClass,
  type TodayTodo,
} from '@campus/shared/src/pickNextAction';
import type { PersonalTodayEntry } from '@campus/shared';
import type { HomeCourse, HomeTask } from './homeOverview';
import { courseTaskHref } from './todayCourseWork';
import { sanitizeInternalPath } from './navigation';

export function todayClassesFromSchedule(
  entries: readonly PersonalTodayEntry[],
  _now: Date,
  courses: readonly HomeCourse[] = [],
): TodayClass[] {
  return entries.flatMap((entry) => {
    const { startAt, endAt } = entry;
    const linked = entry.row.linkedCourseId?.trim();
    const matched = courses.find((course) => course.name.trim() === entry.row.title.trim());
    return [
      {
        id: entry.row.id,
        title: entry.row.title,
        location: entry.row.location?.trim() || '',
        startAt,
        endAt,
        courseId: linked || matched?.id,
      },
    ];
  });
}

export function todayTodosFromHomeTasks(
  tasks: readonly HomeTask[],
  now?: Date | null,
): TodayTodo[] {
  const nowMs = now?.getTime() ?? NaN;
  return tasks.flatMap((task) => {
    const dueAt = task.dueAt ? parseTaipeiInstant(task.dueAt) : null;
    if (task.dueAt && dueAt === null) return [];
    if (
      task.acceptsLate === false &&
      dueAt !== null &&
      Number.isFinite(nowMs) &&
      dueAt < nowMs
    )
      return [];
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

export function courseWeekHref(courseId: string | undefined, fallbackHref?: string): string {
  if (fallbackHref) {
    const safe = sanitizeInternalPath(fallbackHref, '');
    if (safe) return weekHash(safe);
  }
  if (!courseId) return '/timetable';
  const path = /^cw_[0-9a-f-]{36}$/i.test(courseId)
    ? `/classroom/course/${encodeURIComponent(courseId)}`
    : `/course/${encodeURIComponent(courseId)}`;
  return `${path}#week`;
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
