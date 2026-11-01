import type { InboxTask, UserRole } from '../data/types';
import type { RootTabName } from '../app/rootNavigation';
import {
  inboxTaskFromAssignmentNotification,
  inboxTaskFromAssignmentPushData,
} from './inboxTaskFromNotification';
import type { Notification } from '../state/notifications';

export type NotificationDestinationFailureCode =
  | 'unknown_type'
  | 'missing_ids'
  | 'malformed_id'
  | 'empty_payload'
  | 'school_mismatch'
  | 'role_denied';

export type NotificationDestinationContext = {
  uid?: string | null;
  schoolId?: string | null;
  role?: UserRole | null;
};

export type NotificationDestination =
  | {
      ok: true;
      mode: 'nested';
      tab: RootTabName;
      screen: string;
      params?: Record<string, unknown>;
      summary: string;
    }
  | {
      ok: true;
      mode: 'inboxTask';
      task: InboxTask;
      summary: string;
    }
  | {
      ok: false;
      code: NotificationDestinationFailureCode;
      reason: string;
    };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Firestore / 推播共用的路徑片段驗證：拒絕巢狀路徑與相對路徑。 */
export function isSafeDocumentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes('/') &&
    value !== '.' &&
    value !== '..'
  );
}

function noticeType(primary: unknown, fallback: unknown): string {
  if (typeof primary === 'string' && primary.trim()) return primary.trim();
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return '';
}

function requireId(
  value: unknown,
  label: string,
): { ok: true; id: string } | { ok: false; destination: NotificationDestination } {
  if (value == null || value === '') {
    return {
      ok: false,
      destination: {
        ok: false,
        code: 'missing_ids',
        reason: `這則通知缺少可用的${label}，無法開啟對應內容。可改為標成已讀，或稍後再試。`,
      },
    };
  }
  if (!isSafeDocumentId(value)) {
    return {
      ok: false,
      destination: {
        ok: false,
        code: 'malformed_id',
        reason: `這則通知的${label}格式無效，已保留未讀以免誤標。`,
      },
    };
  }
  return { ok: true, id: value };
}

const ASSIGNMENT_TYPES = new Set(['assignment', 'assignment_due', 'homework', 'quiz']);

/**
 * 將伺服器產生的通知／推播 payload 解析成已授權的導頁目的地。
 * 僅涵蓋既有 App 路由合約；未知類型回傳可操作說明，不臆造目的地。
 * 成績通知依 firestoreTriggerHandlers 實際 payload：gradeId + schoolId（無 groupId）。
 */
export function resolveNotificationDestination(
  input: {
    type?: unknown;
    data?: unknown;
    title?: string;
    body?: string;
    id?: string;
  },
  context: NotificationDestinationContext = {},
): NotificationDestination {
  const data = asRecord(input.data);
  const type = noticeType(input.type, data.type);

  if (!type && Object.keys(data).length === 0) {
    return {
      ok: false,
      code: 'empty_payload',
      reason: '這則通知沒有可用的目的地資料，已保留未讀。',
    };
  }

  if (type === 'local_assignment_due_v2') {
    if (!context.uid || data.uid !== context.uid || !context.schoolId || data.schoolId !== context.schoolId) {
      return { ok: true, mode: 'nested', tab: '學習', screen: 'LearnHome', summary: '返回課程' };
    }
    const group = requireId(data.groupId, '課程編號');
    if (group.ok === false) return group.destination;
    const assignment = requireId(data.assignmentId, '作業編號');
    if (assignment.ok === false) return assignment.destination;
    return { ok: true, mode: 'nested', tab: '學習', screen: 'HomeworkSubmit',
      params: { groupId: group.id, assignmentId: assignment.id, fromReminder: true },
      summary: '開啟作業' };
  }

  switch (type) {
    case 'ai_proactive':
      return {
        ok: true,
        mode: 'nested',
        tab: 'Today',
        screen: 'TodayHome',
        summary: '開啟今日首頁',
      };
    case 'announcement': {
      const id = requireId(data.announcementId, '公告編號');
      if (id.ok === false) return id.destination;
      return {
        ok: true,
        mode: 'nested',
        tab: 'Today',
        screen: '公告詳情',
        params: { id: id.id },
        summary: '開啟公告',
      };
    }
    case 'event': {
      const id = requireId(data.eventId, '活動編號');
      if (id.ok === false) return id.destination;
      return {
        ok: true,
        mode: 'nested',
        tab: 'Today',
        screen: '活動詳情',
        params: { id: id.id },
        summary: '開啟活動',
      };
    }
    case 'group_post': {
      const groupId = requireId(data.groupId, '群組編號');
      if (groupId.ok === false) return groupId.destination;
      const postId = requireId(data.postId, '貼文編號');
      if (postId.ok === false) return postId.destination;
      return {
        ok: true,
        mode: 'nested',
        tab: '訊息',
        screen: 'GroupPost',
        params: { groupId: groupId.id, postId: postId.id },
        summary: '開啟群組貼文',
      };
    }
    case 'friend_request':
    case 'friend_invite':
    case 'friend_accepted':
    case 'group_invite':
      return {
        ok: true,
        mode: 'nested',
        tab: '訊息',
        screen: 'FriendsManage',
        summary: '開啟好友與邀請',
      };
    case 'message': {
      const peerId = requireId(data.peerId, '對話對象');
      if (peerId.ok === false) return peerId.destination;
      return {
        ok: true,
        mode: 'nested',
        tab: '訊息',
        screen: 'Chat',
        params: { kind: 'dm', peerId: peerId.id },
        summary: '開啟私訊',
      };
    }
    case 'grade': {
      // 後端 sendPushToUser payload：{ type:'grade', gradeId, schoolId, channel:'grades' }
      const gradeId = requireId(data.gradeId, '成績編號');
      if (gradeId.ok === false) return gradeId.destination;
      const noticeSchool = requireId(data.schoolId, '學校編號');
      if (noticeSchool.ok === false) return noticeSchool.destination;
      if (!context.schoolId || context.schoolId !== noticeSchool.id) {
        return {
          ok: false,
          code: 'school_mismatch',
          reason: '這則成績通知屬於其他學校帳號範圍，已保留未讀。請切換到對應學校後再開啟。',
        };
      }
      // LearnStack「我的成績」：僅已登入學校身分可讀自己的成績清單，不導向作業繳交。
      if (!context.role || context.role === 'vendor' || context.role === 'guest') {
        return {
          ok: false,
          code: 'role_denied',
          reason: '目前身分無法開啟成績頁。可手動標成已讀，或以學生／教職員學校帳號查看。',
        };
      }
      return {
        ok: true,
        mode: 'nested',
        tab: '學習',
        screen: 'Grades',
        params: { gradeId: gradeId.id, schoolId: noticeSchool.id },
        summary: '開啟成績',
      };
    }
    default: {
      if (ASSIGNMENT_TYPES.has(type)) {
        const task =
          input.id != null
            ? inboxTaskFromAssignmentNotification({
                id: String(input.id),
                type: type as Notification['type'],
                title: input.title ?? '',
                body: typeof input.body === 'string' ? input.body : '',
                read: false,
                data,
              })
            : inboxTaskFromAssignmentPushData({ ...data, type, title: input.title, body: input.body });
        if (!task) {
          return {
            ok: false,
            code: 'missing_ids',
            reason: '這則作業／測驗通知缺少課程編號，無法開啟。已保留未讀。',
          };
        }
        return {
          ok: true,
          mode: 'inboxTask',
          task,
          summary: task.kind === 'quiz' ? '開啟測驗' : '開啟作業',
        };
      }
      return {
        ok: false,
        code: 'unknown_type',
        reason: type
          ? `尚不支援開啟「${type}」類型的通知。可手動標成已讀，或稍後在對應功能查看。`
          : '無法辨識這則通知的類型，已保留未讀以免誤標。',
      };
    }
  }
}

export function resolveNotificationRow(
  n: Notification,
  context: NotificationDestinationContext = {},
): NotificationDestination {
  return resolveNotificationDestination(
    {
      id: n.id,
      type: n.type,
      data: n.data,
      title: n.title,
      body: n.body,
    },
    context,
  );
}
