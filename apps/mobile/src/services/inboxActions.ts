/**
 * Inbox Actions — TronClass parity P1-4
 *
 * 把 InboxTask 對應到「使用者可立即執行的動作」，並導向 LearnStack 真實畫面
 * （繳交作業、測驗中心、智慧簽到、討論、教師批改等），而非只開群組頁。
 */

import type { InboxTask, NextBestAction } from '../data/types';
import type { CourseNavigationRole, NavigationLike } from '../utils/courseNavigation';
import { navigateToCourseScreen } from '../utils/courseNavigation';
import { aiOverlay } from '../app/useAIOverlay';
import { recordCompanionEvent } from './companionSignalRecorder';

export type InboxActionTarget =
  | 'submit_assignment'
  | 'grade_assignment'
  | 'start_quiz'
  | 'attendance_checkin'
  | 'open_discussion'
  | 'view_announcement'
  | 'harvest_plant'
  | 'pet_companion'
  | 'review_peer'
  | 'pay_balance'
  | 'view_grade'
  | 'go_to_screen'
  | 'assistant_continue';

export interface ResolvedInboxAction {
  label: string;
  target: InboxActionTarget;
  params?: Record<string, unknown>;
  emphasis?: 'primary' | 'secondary' | 'danger';
  recordEventOnComplete?: {
    kind: Parameters<typeof recordCompanionEvent>[0];
    payload?: Record<string, unknown>;
  };
}

export type ResolveInboxContext = {
  isTeachingRole?: boolean;
};

export function resolveInboxAction(
  task: InboxTask,
  ctx?: ResolveInboxContext,
): ResolvedInboxAction | null {
  const teaching = !!ctx?.isTeachingRole;

  switch (task.kind) {
    case 'assignment':
      if (teaching) {
        return {
          label: '去批改',
          target: 'grade_assignment',
          params: {
            assignmentId: task.assignmentId,
            courseSpaceId: task.groupId,
          },
          emphasis: 'primary',
          recordEventOnComplete: {
            kind: 'inbox_action_taken',
            payload: { source: 'inbox_assignment_grade' },
          },
        };
      }
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
        label: teaching ? '檢視測驗' : '去作答',
        target: 'start_quiz',
        params: {
          quizId: task.assignmentId,
          courseSpaceId: task.groupId,
        },
        emphasis: 'primary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: teaching ? 'inbox_quiz_teacher' : 'inbox_quiz' },
        },
      };
    case 'live':
      return {
        label: teaching ? '進入課堂' : '去簽到',
        target: 'attendance_checkin',
        params: {
          sessionId: task.sessionId,
          courseSpaceId: task.groupId,
        },
        emphasis: 'primary',
        recordEventOnComplete: {
          kind: 'inbox_action_taken',
          payload: { source: teaching ? 'inbox_live_teacher' : 'inbox_live' },
        },
      };
    case 'group':
      return {
        label: teaching ? '開啟課程討論' : '查看討論',
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
        target: 'assistant_continue',
        params: { sourceRunId: task.sourceRunId },
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

export type InboxNavigationContext = {
  role: CourseNavigationRole;
  isTeachingRole: boolean;
};

function emitInboxNavigationSignal(resolved: ResolvedInboxAction) {
  const rec = resolved.recordEventOnComplete;
  if (!rec) return;
  void recordCompanionEvent(rec.kind, { payload: rec.payload });
}

/**
 * 從訊息工作台導向「學習」分頁內的實作畫面；成功導向回 true。
 */
export function navigateFromInboxTask(
  navigation: NavigationLike | null | undefined,
  task: InboxTask,
  navCtx: InboxNavigationContext,
): boolean {
  const resolved = resolveInboxAction(task, { isTeachingRole: navCtx.isTeachingRole });
  if (!resolved) return false;

  const courseId = String(resolved.params?.courseSpaceId ?? task.groupId);
  const role = navCtx.role;

  const fallBackToCourseHub = () => {
    navigateToCourseScreen(navigation, role, 'CourseHub', {
      groupId: task.groupId,
      groupName: task.groupName,
    });
    emitInboxNavigationSignal(resolved);
    return true;
  };

  switch (resolved.target) {
    case 'submit_assignment': {
      const hwId = resolved.params?.assignmentId;
      if (typeof hwId !== 'string' || !hwId) {
        return fallBackToCourseHub();
      }
      navigateToCourseScreen(navigation, role, 'HomeworkSubmit', {
        courseId,
        hwId,
        hwTitle: task.title,
      });
      emitInboxNavigationSignal(resolved);
      return true;
    }
    case 'grade_assignment': {
      navigateToCourseScreen(navigation, role, 'TeacherGrading', {
        courseId: task.groupId,
        courseName: task.groupName,
        assignmentId: task.assignmentId,
        assignmentTitle: task.title,
      });
      emitInboxNavigationSignal(resolved);
      return true;
    }
    case 'start_quiz':
      navigateToCourseScreen(navigation, role, 'QuizCenter', {
        groupId: courseId,
        groupName: task.groupName,
      });
      emitInboxNavigationSignal(resolved);
      return true;

    case 'attendance_checkin': {
      const sessionId = resolved.params?.sessionId;
      if (navCtx.isTeachingRole) {
        navigateToCourseScreen(navigation, role, 'Classroom', {
          groupId: task.groupId,
          sessionId: typeof sessionId === 'string' ? sessionId : undefined,
          isTeacher: true,
        });
      } else if (typeof sessionId === 'string' && sessionId) {
        navigateToCourseScreen(navigation, role, 'AttendanceMultiMethod', {
          courseId,
          sessionId,
        });
      } else {
        navigateToCourseScreen(navigation, role, 'Classroom', {
          groupId: task.groupId,
          isTeacher: false,
        });
      }
      emitInboxNavigationSignal(resolved);
      return true;
    }

    case 'open_discussion':
      navigateToCourseScreen(navigation, role, 'CourseDiscussion', {
        groupId: task.groupId,
        groupName: task.groupName,
      });
      emitInboxNavigationSignal(resolved);
      return true;

    case 'assistant_continue': {
      const runId = resolved.params?.sourceRunId;
      aiOverlay.open({
        mode: 'chat',
        prompt:
          typeof runId === 'string' && runId
            ? `這是助理任務 ${runId}，幫我繼續處理。`
            : '幫我繼續處理收件匣裡的助理建議。',
        source: 'inbox_assistant',
      });
      emitInboxNavigationSignal(resolved);
      return true;
    }

    default:
      return false;
  }
}

/**
 * 舊版 Today／Agent 只存 actionTarget（訊息 AssignmentDetail）而沒有 inboxTask 時，還原成 InboxTask 再走 navigateFromInboxTask。
 */
export function inboxTaskFromLegacyAssignmentActionTarget(
  action: Pick<NextBestAction, 'id' | 'title' | 'description' | 'priority' | 'actionTarget' | 'dueAt'>,
): InboxTask | null {
  const target = action.actionTarget;
  if (!target || target.screen !== 'AssignmentDetail') return null;
  const p = target.params;
  if (!p || typeof p !== 'object') return null;
  const groupId = typeof p.groupId === 'string' ? p.groupId : null;
  const assignmentId = typeof p.assignmentId === 'string' ? p.assignmentId : null;
  if (!groupId || !assignmentId) return null;

  const isQuiz =
    p.isQuiz === true ||
    p.kind === 'quiz' ||
    p.type === 'quiz' ||
    p.category === 'exam';

  return {
    id: action.id,
    kind: isQuiz ? 'quiz' : 'assignment',
    groupId,
    groupName: typeof p.groupName === 'string' ? p.groupName : '課程',
    title: action.title,
    subtitle: typeof action.description === 'string' ? action.description : '',
    assignmentId,
    priority: action.priority,
    dueAt: action.dueAt ?? undefined,
  };
}

/**
 * 給 InboxScreen 用：批次解析一組 tasks。
 */
export function resolveInboxActions(
  tasks: InboxTask[],
  ctx?: ResolveInboxContext,
): Array<{
  task: InboxTask;
  action: ResolvedInboxAction | null;
}> {
  return tasks.map((task) => ({ task, action: resolveInboxAction(task, ctx) }));
}
