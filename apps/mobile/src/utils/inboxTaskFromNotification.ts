import type { InboxTask } from '../data/types';
import type { Notification } from '../state/notifications';

/**
 * 從「作業／測驗」推播 payload 還原 InboxTask，供 navigateFromInboxTask 與 Today／訊息一致。
 * 後端可在 data 帶 groupName、isQuiz、kind、type 以提高辨識。
 */
function courseIdFromData(data: Record<string, unknown>): string | null {
  const gid = data.groupId ?? data.courseId ?? data.workspaceId;
  return typeof gid === 'string' && gid && !gid.includes('/') ? gid : null;
}

function workIdFromData(data: Record<string, unknown>): string | null {
  const aid = data.assignmentId ?? data.quizId;
  return typeof aid === 'string' && aid && !aid.includes('/') ? aid : null;
}

function isQuizData(data: Record<string, unknown>): boolean {
  return (
    data.isQuiz === true ||
    data.kind === 'quiz' ||
    data.type === 'quiz' ||
    data.category === 'exam'
  );
}

export function inboxTaskFromAssignmentPushData(data: Record<string, unknown>): InboxTask | null {
  const gid = courseIdFromData(data);
  const aid = workIdFromData(data);
  if (!gid || !aid) return null;

  const isQuiz = isQuizData(data) || typeof data.quizId === 'string';

  return {
    id: `push-${aid}`,
    kind: isQuiz ? 'quiz' : 'assignment',
    groupId: gid,
    groupName: typeof data.groupName === 'string' ? data.groupName : '課程',
    title: typeof data.title === 'string' ? data.title : isQuiz ? '測驗' : '作業',
    subtitle: typeof data.body === 'string' ? data.body : '',
    priority: 2,
    assignmentId: aid,
  };
}

export function inboxTaskFromAssignmentNotification(n: Notification): InboxTask | null {
  if (
    n.type !== 'assignment' &&
    n.type !== 'assignment_due' &&
    n.type !== 'homework' &&
    n.type !== 'quiz' &&
    n.type !== 'grade'
  )
    return null;
  const data = (n.data ?? {}) as Record<string, unknown>;
  const gid = courseIdFromData(data);
  const aid = workIdFromData(data);
  if (!gid || !aid) return null;

  const isQuiz = n.type === 'quiz' || isQuizData(data) || typeof data.quizId === 'string';

  return {
    id: `notif-${n.id}`,
    kind: isQuiz ? 'quiz' : 'assignment',
    groupId: gid,
    groupName: typeof n.data?.groupName === 'string' ? n.data.groupName : '課程',
    title: n.title || (isQuiz ? '測驗通知' : '作業通知'),
    subtitle: typeof n.body === 'string' ? n.body : '',
    priority: 2,
    assignmentId: aid,
  };
}
