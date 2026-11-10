import { parseTaipeiInstant, taipeiParts } from '@campus/shared/src/taipeiTime';
import { courseHrefFromData, courseWorkHrefFromData } from './courseWorkLanding';
import type { HomeTask } from './homeOverview';
import { sanitizeInternalPath } from './navigation';

export const TODAY_WORK_TITLE = '今天要交';
export const TODAY_WORK_UNSIGNED =
  '登入後，這裡會列出所有課今天要交的作業與測驗。';
export const TODAY_WORK_EMPTY = '今天沒有要交的';
export const TODAY_WORK_NO_CLASS = '尚未加入課班，可以先匯入課表';
export const TODAY_WORK_NOTE =
  '來源是各課作業與測驗；截止時間和已繳狀態依課程資料鎖定，不會被整理改寫。';
export const LATER_WORK_TITLE = '稍後要交';
export const CALENDAR_DUE_TITLE = '作業截止';
export const CALENDAR_DUE_UNSIGNED =
  '登入後，行事曆會一併顯示已加入課程的作業截止日期，與手機版相同。';
export const CALENDAR_DUE_EMPTY = '這段期間沒有作業截止。';
export const CALENDAR_DUE_EMPTY_DAY = '這天沒有校園活動或作業截止。';
export const CALENDAR_DUE_LOAD_ERROR = '目前無法確認已加入課程的作業截止日期。';
export const TODAY_NOTIFY_TITLE = '未讀通知';
export const TODAY_NOTIFY_UNSIGNED = '登入後，這裡會摘要尚未讀取的通知。';
export const TODAY_NOTIFY_EMPTY = '目前沒有未讀通知。';
export const TODAY_NOTIFY_ERROR = '通知暫時讀不到，請稍後再試或前往通知匣。';
export const TODAY_FLOW_CLASS_TITLE = '今日課表';
export const TODAY_FLOW_WORK_TITLE = '課程待辦';
export const TEACHER_TODAY_GRADING_TITLE = '待批改與授課';
export const TEACHER_TODAY_DUE_TITLE = '即將到期作業';
export const TEACHER_TODAY_EMPTY_GRADING =
  '目前沒有待批改項目。開啟授課課程後可查看繳交與教材。';
export const TEACHER_TODAY_UNSIGNED = '登入教師帳號後，這裡會顯示今天的課、待批改與即將到期作業。';

export type CalendarDueItem = {
  id: string;
  title: string;
  courseName: string;
  courseId: string;
  dueDate: string;
  href: string;
};

function courseTaskFallback(task: HomeTask): string {
  const hash = task.kind === 'quiz' ? 'quiz' : 'assignment';
  const fromLanding =
    courseWorkHrefFromData(
      {
        courseId: task.courseId,
        ...(task.kind === 'quiz' ? { quizId: task.id } : { assignmentId: task.id }),
      },
      task.kind === 'quiz' ? 'quiz' : 'assignment',
    ) || courseHrefFromData({ courseId: task.courseId });
  if (fromLanding && fromLanding.includes('#')) return fromLanding;
  if (fromLanding) return `${fromLanding}#${hash}-${encodeURIComponent(task.id)}`;
  return `/course/${encodeURIComponent(task.courseId)}#${hash}-${encodeURIComponent(task.id)}`;
}

/** Only same-origin course paths with an assignment or quiz hash. Off-site values fall back. */
export function courseTaskHref(task: HomeTask): string {
  const fallback = courseTaskFallback(task);
  if (!task.href) return fallback;
  const safe = sanitizeInternalPath(task.href, '');
  if (!safe) return fallback;
  try {
    const url = new URL(safe, 'https://campus.local');
    const coursePath =
      /^\/course\/[^/]+$/.test(url.pathname) || /^\/classroom\/course\/[^/]+$/.test(url.pathname);
    return coursePath && /^#(assignment|quiz)-.+/.test(url.hash) ? safe : fallback;
  } catch {
    return fallback;
  }
}

function taipeiDayKey(value: string | Date | number): string | null {
  const parts = taipeiParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function dueDayKey(task: HomeTask): string | null {
  return task.dueAt ? taipeiDayKey(task.dueAt) : null;
}

/** Pending work due today (Taipei) or already overdue. Undated open work stays visible. */
export function selectTodayCourseWork(tasks: readonly HomeTask[], now: Date): HomeTask[] {
  const today = taipeiDayKey(now);
  if (!today) return [];
  return tasks.filter((task) => {
    if (!task.dueAt) return true;
    const due = dueDayKey(task);
    if (!due) return false;
    return due <= today;
  });
}

export function selectLaterCourseWork(tasks: readonly HomeTask[], now: Date): HomeTask[] {
  const today = taipeiDayKey(now);
  if (!today) return [];
  return tasks.filter((task) => {
    if (!task.dueAt) return false;
    const due = dueDayKey(task);
    if (!due) return false;
    return due > today;
  });
}

/** Dated assignment/quiz deadlines for calendar overlays (Web mirrors Mobile). */
export function calendarDueItemsFromTasks(tasks: readonly HomeTask[]): CalendarDueItem[] {
  return tasks.flatMap((task) => {
    if (!task.dueAt) return [];
    const instant = parseTaipeiInstant(task.dueAt);
    if (instant === null) return [];
    const dueDate = taipeiDayKey(instant);
    if (!dueDate) return [];
    return [
      {
        id: `${task.courseId}:${task.id}`,
        title: task.title,
        courseName: task.courseName,
        courseId: task.courseId,
        dueDate,
        href: courseTaskHref(task),
      },
    ];
  });
}

export function calendarDueItemsOnDate(
  items: readonly CalendarDueItem[],
  date: string,
): CalendarDueItem[] {
  return items.filter((item) => item.dueDate === date);
}

export function calendarDueItemsInMonth(
  items: readonly CalendarDueItem[],
  month: string,
): CalendarDueItem[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return items.filter((item) => item.dueDate.startsWith(`${month}-`));
}
