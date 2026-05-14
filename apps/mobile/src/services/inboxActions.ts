/**
 * Inbox Actions — TronClass parity P1-4
 *
 * 把 InboxTask 對應到「使用者可立即執行的動作」。
 * 純函式 + 副作用包在 caller 端執行：
 *   resolveInboxAction(task) → { label, target, params, requires? }
 *
 * 之後 InboxScreen 卡片直接渲染 action button。
 */

import type { InboxTask } from '../data/types';
import { recordCompanionEvent } from './companionSignalRecorder';

export type InboxActionTarget =
  | 'submit_assignment'
  | 'start_quiz'
  | 'attendance_checkin'
  | 'open_discussion'
  | 'view_announcement'
  | 'harvest_plant'
  | 'pet_companion'
  | 'review_peer'
  | 'pay_balance'
  | 'view_grade'
  | 'go_to_screen';

export interface ResolvedInboxAction {
  label: string;
  /** 用於 navigator.navigate(target, params) 或 deep link */
  target: InboxActionTarget;
  /** Navigation 用的參數 */
  params?: Record<string, unknown>;
  /** UI 強調樣式 */
  emphasis?: 'primary' | 'secondary' | 'danger';
  /** 完成後該記錄哪個 companion event */
  recordEventOnComplete?: {
    kind: Parameters<typeof recordCompanionEvent>[0];
    payload?: Record<string, unknown>;
  };
}

export function resolveInboxAction(task: InboxTask): ResolvedInboxAction | null {
  switch (task.kind) {
    case 'assignment':
      return {
        label: '去繳交',
        target: 'submit_assignment',
        params: {
          assignmentId: task.assignmentId,
          courseSpaceId: task.groupId,
        },
        emphasis: 'primary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: 'inbox_assignment' },
        },
      };
    case 'quiz':
      return {
        label: '去作答',
        target: 'start_quiz',
        params: {
          quizId: task.assignmentId,
          courseSpaceId: task.groupId,
        },
        emphasis: 'primary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: 'inbox_quiz' },
        },
      };
    case 'live':
      return {
        label: '去簽到',
        target: 'attendance_checkin',
        params: {
          sessionId: task.sessionId,
          courseSpaceId: task.groupId,
        },
        emphasis: 'primary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: 'inbox_live' },
        },
      };
    case 'group':
      return {
        label: '查看討論',
        target: 'open_discussion',
        params: { groupId: task.groupId },
        emphasis: 'secondary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: 'inbox_group' },
        },
      };
    case 'assistant_queue':
      return {
        label: '確認 AI 建議',
        target: 'go_to_screen',
        params: { screen: 'AssistantQueue', queueId: (task as unknown as { queueId?: string }).queueId },
        emphasis: 'secondary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: 'inbox_assistant_queue' },
        },
      };
    default:
      return null;
  }
}

/**
 * 給 InboxScreen 用：批次解析一組 tasks。
 */
export function resolveInboxActions(tasks: InboxTask[]): Array<{
  task: InboxTask;
  action: ResolvedInboxAction | null;
}> {
  return tasks.map((task) => ({ task, action: resolveInboxAction(task) }));
}
