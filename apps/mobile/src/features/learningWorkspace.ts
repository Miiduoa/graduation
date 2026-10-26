import type { CourseSpace, InboxTask } from '../data/types';
import { taipeiParts } from '@campus/shared/src/taipeiTime';

export type LearningTaskFilter = 'all' | 'week' | 'assignment' | 'quiz' | 'live';
export type LearningTaskTone = 'muted' | 'ai' | 'warning' | 'danger' | 'success';

export type LearningTaskLabel = {
  label: string;
  tone: LearningTaskTone;
};

function dueTime(task: InboxTask): number | null {
  if (!(task.dueAt instanceof Date)) return null;
  const time = task.dueAt.getTime();
  return Number.isFinite(time) ? time : null;
}

function taipeiDay(time: number): number | null {
  const parts = taipeiParts(time);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : null;
}

export function describeLearningTask(task: InboxTask, now = new Date()): LearningTaskLabel {
  if (task.preferredIntent === 'review') {
    return { label: task.actionLabel || '待批改', tone: 'ai' };
  }
  if (task.kind === 'live') return { label: '進行中', tone: 'warning' };
  const due = dueTime(task);
  if (due === null) {
    if (task.kind === 'quiz') return { label: '測驗', tone: 'muted' };
    if (task.kind === 'assignment') return { label: '作業', tone: 'muted' };
    return { label: '課程動態', tone: 'muted' };
  }
  if (due < now.getTime()) return { label: task.lateSubmissionAllowed ? '逾期可補交' : '已逾期', tone: 'danger' };

  const today = taipeiDay(now.getTime());
  const target = taipeiDay(due);
  if (today !== null && target !== null) {
    const days = Math.round((target - today) / 86400000);
    if (days === 0) return { label: '今日截止', tone: 'warning' };
    if (days === 1) return { label: '明日截止', tone: 'warning' };
    if (days <= 7) return { label: days + ' 天後截止', tone: 'ai' };
  }

  const date = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
  }).format(due);
  return { label: date + ' 截止', tone: 'muted' };
}

/**
 * All counts come from the signed-in student's enrolled spaces. A task from another
 * course is never surfaced, even if the upstream inbox happens to include it.
 */
export function buildLearningWorkspace(courses: CourseSpace[], tasks: InboxTask[], now = new Date()) {
  const memberships = new Set(courses.map((course) => course.groupId));
  const relevant = tasks.filter(
    (task) => task.kind !== 'assistant_queue' && memberships.has(task.groupId),
  );
  const current = now.getTime();
  const weekEnd = current + 7 * 86400000;
  const ordered = [...relevant].sort((a, b) => {
    const rank = (task: InboxTask) => {
      if (task.kind === 'live') return 0;
      const due = dueTime(task);
      if (due !== null && due < current) return 1;
      if (due !== null) return 2;
      return 3;
    };
    const difference = rank(a) - rank(b);
    if (difference !== 0) return difference;
    const aDue = dueTime(a);
    const bDue = dueTime(b);
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
    return a.priority - b.priority;
  });

  return {
    courses,
    tasks: ordered,
    taskCount: ordered.length,
    overdueCount: ordered.filter((task) => {
      const due = dueTime(task);
      return task.lateSubmissionAllowed === true && due !== null && due < current;
    }).length,
    upcomingCount: ordered.filter((task) => {
      const due = dueTime(task);
      return due !== null && due >= current && due <= weekEnd;
    }).length,
  };
}

export function filterLearningTasks(
  tasks: InboxTask[],
  filter: LearningTaskFilter,
  now = new Date(),
  options: { query?: string; groupId?: string } = {},
): InboxTask[] {
  const query = options.query?.trim().normalize('NFKC').toLocaleLowerCase('zh-TW') ?? '';
  const scoped = tasks.filter((task) => {
    if (options.groupId && task.groupId !== options.groupId) return false;
    if (!query) return true;
    return [task.title, task.groupName, task.subtitle]
      .some((value) => value.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(query));
  });
  if (filter === 'all') return scoped;
  if (filter === 'assignment' || filter === 'quiz' || filter === 'live') {
    return scoped.filter((task) => task.kind === filter);
  }
  const current = now.getTime();
  const weekEnd = current + 7 * 86400000;
  return scoped.filter((task) => {
    const due = dueTime(task);
    return due !== null && due >= current && due <= weekEnd;
  });
}
