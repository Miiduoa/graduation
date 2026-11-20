'use strict';

/**
 * 將 InboxTask 形狀的資料轉成 users/{uid}/nextBestActions 文件欄位，
 * 與 apps/mobile `actionFromInboxTask` / `parseNextBestAction` 對齊（含嵌套 inboxTask、inboxKind）。
 */

const { Timestamp } = require('firebase-admin/firestore');

const INBOX_KINDS = new Set(['live', 'assignment', 'quiz', 'group', 'assistant_queue']);

function normalizeUrgency(priority) {
  const p = Number(priority);
  if (p <= 0) return 'critical';
  if (p <= 2) return 'high';
  if (p <= 4) return 'medium';
  return 'low';
}

function actionTargetFromInboxTask(task) {
  if (task.kind === 'live' && task.sessionId) {
    return {
      tab: '學習',
      screen: 'Classroom',
      params: { groupId: task.groupId, sessionId: task.sessionId },
    };
  }

  if ((task.kind === 'assignment' || task.kind === 'quiz') && task.assignmentId) {
    return {
      tab: '訊息',
      screen: 'AssignmentDetail',
      params: { groupId: task.groupId, assignmentId: task.assignmentId },
    };
  }

  return {
    tab: '訊息',
    screen: 'GroupDetail',
    params: { groupId: task.groupId },
  };
}

function toFirestoreDueAt(value) {
  if (value == null) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value?.toDate === 'function') {
    try {
      return Timestamp.fromDate(value.toDate());
    } catch {
      return null;
    }
  }
  if (typeof value?.seconds === 'number') {
    return new Timestamp(value.seconds, Number(value.nanoseconds || 0));
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function buildFirestoreInboxTaskSnapshot(task) {
  return {
    id: String(task.id),
    kind: task.kind,
    groupId: String(task.groupId),
    groupName: String(task.groupName || '課程').slice(0, 200),
    title: String(task.title || '').slice(0, 300),
    subtitle: String(task.subtitle || '').slice(0, 500),
    priority: Number(task.priority),
    dueAt: toFirestoreDueAt(task.dueAt),
    unreadCount: typeof task.unreadCount === 'number' ? task.unreadCount : null,
    sessionId: task.sessionId != null ? String(task.sessionId) : null,
    assignmentId: task.assignmentId != null ? String(task.assignmentId) : null,
    sourceRunId: task.sourceRunId != null ? String(task.sourceRunId) : null,
    actionQueueId: task.actionQueueId != null ? String(task.actionQueueId) : null,
    queueAction: task.queueAction != null ? String(task.queueAction) : null,
    actionLabel: task.actionLabel != null ? String(task.actionLabel).slice(0, 120) : null,
    reason: task.reason != null ? String(task.reason).slice(0, 500) : null,
    consequence: task.consequence != null ? String(task.consequence).slice(0, 500) : null,
    nextStep: task.nextStep != null ? String(task.nextStep).slice(0, 500) : null,
  };
}

function defaultActionLabel(task) {
  if (task.actionLabel) return String(task.actionLabel).slice(0, 120);
  if (task.kind === 'live') return '進入課堂';
  if (task.kind === 'quiz') return '開始處理';
  if (task.kind === 'assignment') return '查看作業';
  return '查看更新';
}

/**
 * @param {object} task - InboxTask 形狀（plain object）
 * @param {{ source?: string }} [options]
 * @returns {object} Firestore 文件 body（不含文件 id）
 */
function buildNextBestActionFieldsFromInboxTask(task, options = {}) {
  const source = options.source || 'inbox';
  const urgency = normalizeUrgency(task.priority);
  const actionLabel = defaultActionLabel(task);

  return {
    title: String(task.title || '待辦').slice(0, 300),
    description: String(task.subtitle || '').slice(0, 500),
    priority: Number(task.priority),
    urgency,
    reason: task.reason != null ? String(task.reason).slice(0, 500) : '這個項目會影響今天的學習節奏。',
    consequence: task.consequence != null ? String(task.consequence).slice(0, 500) : null,
    nextStep: task.nextStep != null ? String(task.nextStep).slice(0, 500) : actionLabel,
    actionLabel,
    inboxKind: task.kind,
    inboxTask: buildFirestoreInboxTaskSnapshot(task),
    actionTarget: actionTargetFromInboxTask(task),
    evidenceRefs: [
      {
        type: task.kind === 'quiz' ? 'assignment' : task.kind === 'live' ? 'attendance' : 'course',
        id: task.assignmentId ?? task.sessionId ?? task.groupId,
        label: String(task.title || '').slice(0, 200),
      },
    ],
    requiresConfirmation: false,
    source,
    dueAt: toFirestoreDueAt(task.dueAt),
    updatedAt: Timestamp.now(),
  };
}

function assertValidInboxTaskPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('inboxTask must be an object');
  }
  const kind = raw.kind;
  if (typeof kind !== 'string' || !INBOX_KINDS.has(kind)) {
    throw new Error(`Invalid inboxTask.kind: ${kind}`);
  }
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new Error('inboxTask.id is required');
  }
  if (typeof raw.groupId !== 'string' || !raw.groupId.trim()) {
    throw new Error('inboxTask.groupId is required');
  }
  if (typeof raw.title !== 'string') {
    throw new Error('inboxTask.title is required');
  }
  if (typeof raw.subtitle !== 'string') {
    throw new Error('inboxTask.subtitle is required');
  }
  if (typeof raw.priority !== 'number' || Number.isNaN(raw.priority)) {
    throw new Error('inboxTask.priority must be a number');
  }
  if (kind === 'live' && raw.sessionId && typeof raw.sessionId !== 'string') {
    throw new Error('inboxTask.sessionId must be a string when set');
  }
  if ((kind === 'assignment' || kind === 'quiz') && raw.assignmentId && typeof raw.assignmentId !== 'string') {
    throw new Error('inboxTask.assignmentId must be a string when set');
  }
}

function sanitizeDocKey(taskId) {
  return String(taskId)
    .replace(/[^\w-]/g, '_')
    .slice(0, 120);
}

module.exports = {
  buildNextBestActionFieldsFromInboxTask,
  buildFirestoreInboxTaskSnapshot,
  actionTargetFromInboxTask,
  assertValidInboxTaskPayload,
  sanitizeDocKey,
  INBOX_KINDS,
};
