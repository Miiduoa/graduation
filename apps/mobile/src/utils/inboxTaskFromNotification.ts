import type { InboxTask } from '../data/types';
import type { Notification } from '../state/notifications';

/**
 * 從「作業／測驗」推播 payload 還原 InboxTask，供 navigateFromInboxTask 與 Today／訊息一致。
 * 後端可在 data 帶 groupName、isQuiz、kind、type 以提高辨識。
 */
function noticeType(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function courseIdFromData(data: Record<string, unknown>): string | null {
  const gid = data.groupId ?? data.courseId ?? data.workspaceId;
  return typeof gid === 'string' && gid && !gid.includes('/') && gid !== '.' && gid !== '..'
    ? gid
    : null;
}

function workIdFromData(data: Record<string, unknown>): string | null {
  const aid = data.assignmentId ?? data.quizId;
  return typeof aid === 'string' && aid && !aid.includes('/') && aid !== '.' && aid !== '..'
    ? aid
    : null;
}

function isQuizData(data: Record<string, unknown>): boolean {
  return (
    data.isQuiz === true ||
    data.isQuiz === 'true' ||
    data.kind === 'quiz' ||
    data.type === 'quiz' ||
    data.category === 'exam'
  );
}

function isAssignmentNoticeType(type: string): boolean {
  return (
    type === 'assignment' ||
    type === 'assignment_due' ||
    type === 'homework' ||
    type === 'quiz' ||
    type === 'grade'
  );
}

function taskFromCourseData(
  id: string,
  data: Record<string, unknown>,
  type: string,
  title: string,
  subtitle: string,
): InboxTask | null {
  const gid = courseIdFromData(data);
  if (!gid) return null;
  const aid = workIdFromData(data);
  const isQuiz = type === 'quiz' || isQuizData(data) || typeof data.quizId === 'string';
  return {
    id,
    kind: isQuiz ? 'quiz' : 'assignment',
    groupId: gid,
    groupName: typeof data.groupName === 'string' ? data.groupName : '課程',
    title: title || (isQuiz ? '測驗' : '作業'),
    subtitle,
    priority: 2,
    ...(aid ? { assignmentId: aid } : {}),
  };
}

export function inboxTaskFromAssignmentPushData(data: Record<string, unknown>): InboxTask | null {
  return taskFromCourseData(
    `push-${workIdFromData(data) || courseIdFromData(data) || 'course'}`,
    data,
    noticeType(data.type),
    typeof data.title === 'string' ? data.title : '',
    typeof data.body === 'string' ? data.body : '',
  );
}

export function inboxTaskFromAssignmentNotification(n: Notification): InboxTask | null {
  const data = (n.data ?? {}) as Record<string, unknown>;
  const type = noticeType(n.type) || noticeType(data.type);
  if (!isAssignmentNoticeType(type)) return null;
  return taskFromCourseData(
    `notif-${n.id}`,
    data,
    type,
    n.title,
    typeof n.body === 'string' ? n.body : '',
  );
}
