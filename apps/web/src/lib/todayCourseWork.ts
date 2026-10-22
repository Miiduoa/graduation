import { taipeiParts } from '@campus/shared/src/taipeiTime';
import type { HomeTask } from './homeOverview';

export const TODAY_WORK_TITLE = '今天要交';
export const TODAY_WORK_UNSIGNED =
  '登入後，這裡會列出所有課今天要交的作業與測驗。';
export const TODAY_WORK_EMPTY = '今天沒有要交的';
export const TODAY_WORK_NO_CLASS = '尚未加入課班，可以先匯入課表';
export const TODAY_WORK_NOTE =
  '來源是各課作業與測驗；截止時間和已繳狀態依課程資料鎖定，不會被整理改寫。';
export const LATER_WORK_TITLE = '稍後要交';

export function courseTaskHref(task: HomeTask): string {
  if (task.href) return task.href;
  const hash = task.kind === 'quiz' ? 'quiz' : 'assignment';
  return `/course/${encodeURIComponent(task.courseId)}#${hash}-${encodeURIComponent(task.id)}`;
}

function taipeiDayKey(value: string | Date): string | null {
  const parts = taipeiParts(value);
  if (!parts) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  const todayKeys = new Set(
    selectTodayCourseWork(tasks, now).map((task) => `${task.courseId}:${task.id}`),
  );
  return tasks.filter((task) => !todayKeys.has(`${task.courseId}:${task.id}`));
}
