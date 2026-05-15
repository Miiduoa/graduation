/**
 * Role Event Bus — 跨角色資料聯動（本地 demo + 即時推送）
 *
 * 設計：老師動作（批改、發提醒、開點名）會在本機 fire event；
 * 學生螢幕監聽到後自動 refresh / 跳通知。
 *
 * 也支援 AsyncStorage 持久化 inbox messages，這樣登出登入後仍看得到。
 *
 * 7 個事件 kind：
 *  - grade_published        (老師批改 → 學生看到新成績)
 *  - bulk_reminder_sent     (老師批量提醒 → 學生 inbox 進件)
 *  - feedback_drafted       (老師起草評語 → 學生收到評語)
 *  - attendance_session_opened (老師開點名 → 學生立刻收 critical 通知)
 *  - announcement_posted    (老師公告 → 全班看到)
 *  - homework_published     (老師發布作業 → 學生待辦多一項)
 *  - peer_review_assigned   (老師指派互評 → 學生收任務)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getScopedStorageKey } from './scopedStorage';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type RoleEventKind =
  // 老師 / TA / 主任 → 學生
  | 'grade_published'
  | 'bulk_reminder_sent'
  | 'feedback_drafted'
  | 'attendance_session_opened'
  | 'announcement_posted'
  | 'homework_published'
  | 'peer_review_assigned'
  // 學生 → 老師 / TA (反向)
  | 'homework_submitted'        // 學生繳交作業 → 老師待批改 +1
  | 'attendance_checked_in'      // 學生簽到完成 → 老師簽到面板更新
  | 'discussion_posted'           // 學生發討論 → 老師可選擇回覆
  | 'help_requested'              // 學生求助 → 助教 inbox
  // 餐廳 ↔ 學生
  | 'order_placed'                // 學生下單 → 餐廳收到
  | 'order_status_changed'        // 餐廳備餐進度更新 → 學生收通知
  // 主任 → 全體
  | 'department_broadcast';        // 系所公告 → 全班 / 全系

export interface RoleEvent<P = unknown> {
  /** 事件唯一 ID */
  id: string;
  kind: RoleEventKind;
  /** 觸發者（老師/TA/admin uid） */
  actorUid: string;
  actorName?: string;
  /** 目標收件人（學生 uid 陣列；空 → 全班） */
  targetUids?: string[];
  /** 課程 id */
  courseId: string | number;
  courseName: string;
  /** ISO timestamp */
  occurredAt: string;
  /** event-specific payload */
  payload: P;
}

// ─────────────────────────────────────────────────────────
// Listener registry (in-memory)
// ─────────────────────────────────────────────────────────

type Listener<P = unknown> = (event: RoleEvent<P>) => void | Promise<void>;

const listeners = new Map<RoleEventKind, Set<Listener>>();

export function subscribeRoleEvent<P>(
  kind: RoleEventKind,
  listener: Listener<P>,
): () => void {
  if (!listeners.has(kind)) {
    listeners.set(kind, new Set());
  }
  listeners.get(kind)!.add(listener as Listener);
  return () => {
    listeners.get(kind)?.delete(listener as Listener);
  };
}

/**
 * 全部 14 種 RoleEventKind 一次訂閱。
 * 之前只訂閱前 7 種「老師→學生」事件，導致學生收不到 order_status_changed、
 * department_broadcast，餐廳收不到 order_placed，老師收不到 homework_submitted
 * 等反向事件 — 整個跨角色聯動斷掉一半。已修補。
 */
export const ALL_ROLE_EVENT_KINDS: RoleEventKind[] = [
  // 老師 / TA / 主任 → 學生
  'grade_published',
  'bulk_reminder_sent',
  'feedback_drafted',
  'attendance_session_opened',
  'announcement_posted',
  'homework_published',
  'peer_review_assigned',
  // 學生 → 老師 / TA
  'homework_submitted',
  'attendance_checked_in',
  'discussion_posted',
  'help_requested',
  // 餐廳 ↔ 學生
  'order_placed',
  'order_status_changed',
  // 主任 → 全體
  'department_broadcast',
];

export function subscribeAllRoleEvents(listener: Listener): () => void {
  const unsubs = ALL_ROLE_EVENT_KINDS.map((k) => subscribeRoleEvent(k, listener));
  return () => unsubs.forEach((u) => u());
}

// ─────────────────────────────────────────────────────────
// Emit + persist
// ─────────────────────────────────────────────────────────

const ROLE_EVENT_LOG_BASE = 'role_event_log_v1';

export async function emitRoleEvent<P>(event: Omit<RoleEvent<P>, 'id' | 'occurredAt'>): Promise<RoleEvent<P>> {
  const full: RoleEvent<P> = {
    ...event,
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    occurredAt: new Date().toISOString(),
  };

  // 1. notify in-memory listeners
  const set = listeners.get(full.kind);
  if (set) {
    for (const l of set) {
      try {
        await l(full);
      } catch {
        /* swallow */
      }
    }
  }

  // 2. persist to inbox for each target uid（demo 模式：所有 events 都 broadcast）
  try {
    const targets = full.targetUids ?? ['__all__'];
    for (const uid of targets) {
      const key = getScopedStorageKey(ROLE_EVENT_LOG_BASE, { uid, schoolId: null });
      const raw = await AsyncStorage.getItem(key);
      const arr: RoleEvent<unknown>[] = raw ? JSON.parse(raw) : [];
      arr.unshift(full as RoleEvent<unknown>);
      // 限制 100 筆
      const truncated = arr.slice(0, 100);
      await AsyncStorage.setItem(key, JSON.stringify(truncated));
    }
  } catch {
    /* swallow */
  }

  return full;
}

// ─────────────────────────────────────────────────────────
// 讀取某 uid 的 inbox events
// ─────────────────────────────────────────────────────────

export async function loadRoleEventInbox(uid: string): Promise<RoleEvent<unknown>[]> {
  try {
    // 1. 學生自己的 inbox
    const key = getScopedStorageKey(ROLE_EVENT_LOG_BASE, { uid, schoolId: null });
    const raw = await AsyncStorage.getItem(key);
    const own: RoleEvent<unknown>[] = raw ? (Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []) : [];

    // 2. 全班廣播 inbox
    const allKey = getScopedStorageKey(ROLE_EVENT_LOG_BASE, { uid: '__all__', schoolId: null });
    const rawAll = await AsyncStorage.getItem(allKey);
    const broadcast: RoleEvent<unknown>[] = rawAll
      ? (Array.isArray(JSON.parse(rawAll)) ? JSON.parse(rawAll) : [])
      : [];

    const merged = [...own, ...broadcast].sort((a, b) => {
      return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    });
    return merged;
  } catch {
    return [];
  }
}

export async function clearRoleEventInbox(uid: string): Promise<void> {
  try {
    const key = getScopedStorageKey(ROLE_EVENT_LOG_BASE, { uid, schoolId: null });
    await AsyncStorage.removeItem(key);
  } catch {
    /* swallow */
  }
}

// ─────────────────────────────────────────────────────────
// Helpers — typed emitters for each event kind
// ─────────────────────────────────────────────────────────

export interface GradePublishedPayload {
  itemTitle: string;
  itemKind: 'homework' | 'exam' | 'quiz';
  score: number;
  totalScore: number;
}

export const emitGradePublished = (
  e: Omit<RoleEvent<GradePublishedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'grade_published' });

export interface BulkReminderPayload {
  homeworkTitle: string;
  homeworkId?: string | number;
  count: number;
}

export const emitBulkReminder = (
  e: Omit<RoleEvent<BulkReminderPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'bulk_reminder_sent' });

export interface FeedbackPayload {
  studentName: string;
  homeworkTitle: string;
  draftPreview: string;
}

export const emitFeedbackDrafted = (
  e: Omit<RoleEvent<FeedbackPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'feedback_drafted' });

export interface AttendanceOpenedPayload {
  sessionId: string;
  method: 'rotating_qr' | 'number_code' | 'geofence' | 'selfie_liveness' | 'multi_factor';
  classroomLocation?: string;
}

export const emitAttendanceOpened = (
  e: Omit<RoleEvent<AttendanceOpenedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'attendance_session_opened' });

export interface AnnouncementPayload {
  title: string;
  content: string;
}

export const emitAnnouncementPosted = (
  e: Omit<RoleEvent<AnnouncementPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'announcement_posted' });

export interface HomeworkPublishedPayload {
  homeworkTitle: string;
  homeworkId: string | number;
  dueAt: string;
}

export const emitHomeworkPublished = (
  e: Omit<RoleEvent<HomeworkPublishedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'homework_published' });

export interface PeerReviewAssignedPayload {
  assignmentTitle: string;
  reviewId: string | number;
  dueAt: string;
}

export const emitPeerReviewAssigned = (
  e: Omit<RoleEvent<PeerReviewAssignedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'peer_review_assigned' });

// ─────────────────────────────────────────────────────────
// 學生 → 老師 / TA 反向事件
// ─────────────────────────────────────────────────────────

export interface HomeworkSubmittedPayload {
  homeworkId: string | number;
  homeworkTitle: string;
  studentName: string;
  isLate: boolean;
  submittedAt: string;
}

export const emitHomeworkSubmitted = (
  e: Omit<RoleEvent<HomeworkSubmittedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'homework_submitted' });

export interface AttendanceCheckedInPayload {
  sessionId: string;
  method: 'rotating_qr' | 'number_code' | 'geofence' | 'selfie_liveness' | 'multi_factor';
  status: 'present' | 'late';
  studentName: string;
}

export const emitAttendanceCheckedIn = (
  e: Omit<RoleEvent<AttendanceCheckedInPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'attendance_checked_in' });

export interface DiscussionPostedPayload {
  threadId: string | number;
  threadTitle: string;
  authorName: string;
  preview: string;
}

export const emitDiscussionPosted = (
  e: Omit<RoleEvent<DiscussionPostedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'discussion_posted' });

export interface HelpRequestedPayload {
  topic: string;
  preview: string;
  urgency: 'low' | 'medium' | 'high';
}

export const emitHelpRequested = (
  e: Omit<RoleEvent<HelpRequestedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'help_requested' });

// ─────────────────────────────────────────────────────────
// 餐廳 ↔ 學生
// ─────────────────────────────────────────────────────────

export interface OrderPlacedPayload {
  orderId: string;
  merchantId: string;
  merchantName: string;
  items: string;
  total: number;
  studentName: string;
}

export const emitOrderPlaced = (
  e: Omit<RoleEvent<OrderPlacedPayload>, 'id' | 'occurredAt' | 'kind'> & {
    /** orderId 也放外面方便 list 用 */
  },
) => emitRoleEvent({ ...e, kind: 'order_placed' });

export interface OrderStatusChangedPayload {
  orderId: string;
  merchantName: string;
  newStatus: 'processing' | 'ready' | 'completed';
  /** 給學生看的友善文案 */
  message: string;
}

export const emitOrderStatusChanged = (
  e: Omit<RoleEvent<OrderStatusChangedPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'order_status_changed' });

// ─────────────────────────────────────────────────────────
// 主任 → 全體
// ─────────────────────────────────────────────────────────

export interface DepartmentBroadcastPayload {
  title: string;
  body: string;
  audience: 'students' | 'teachers' | 'all';
}

export const emitDepartmentBroadcast = (
  e: Omit<RoleEvent<DepartmentBroadcastPayload>, 'id' | 'occurredAt' | 'kind'>,
) => emitRoleEvent({ ...e, kind: 'department_broadcast' });
