import type { InboxTask } from '../data/types';
import type { Notification } from '../state/notifications';

/**
 * 從「作業／測驗」推播 payload 還原 InboxTask，供 navigateFromInboxTask 與 Today／訊息一致。
 * 後端可在 data 帶 groupName、isQuiz、kind、type 以提高辨識。
 */
/** 原生推播 `data`（與 Notifications 資料列盡量對齊） */
export function inboxTaskFromAssignmentPushData(data: Record<string, unknown>): InboxTask | null {
  const gid = data.groupId;
  const aid = data.assignmentId;
  if (typeof gid !== 'string' || typeof aid !== 'string') return null;

  const isQuiz =
    data.isQuiz === true ||
    data.kind === 'quiz' ||
    data.type === 'quiz' ||
    data.category === 'exam';

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
  if (n.type !== 'assignment') return null;
  const gid = n.data?.groupId;
  const aid = n.data?.assignmentId;
  if (typeof gid !== 'string' || typeof aid !== 'string') return null;

  const isQuiz =
    n.data?.isQuiz === true ||
    n.data?.kind === 'quiz' ||
    n.data?.type === 'quiz' ||
    n.data?.category === 'exam';

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
