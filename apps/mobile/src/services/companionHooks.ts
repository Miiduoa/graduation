/**
 * Campus Companion Hooks — 給既有畫面 / service 呼叫的「成功事件 → 信號」轉接層。
 *
 * 為什麼用 hooks 而不是直接改既有 service：
 *  - 既有 service 大多獨立、有單元測試，不想為了埋信號破壞它們
 *  - hook 是 fire-and-forget，失敗不影響主要動作
 *  - 集中在一個檔案，未來加新事件不必到處找
 *
 * 使用方式（呼叫端）：
 *   import { onMealOrdered } from '../services/companionHooks';
 *   await placeOrderApi(...);
 *   onMealOrdered({ uid, vendorId, balanced: true });
 */

import { recordCompanionEvent } from './companionSignalRecorder';

type WithUid<T = unknown> = T & { uid?: string | null };

// ─────────────────────────────────────────────────────────
// LMS / Study
// ─────────────────────────────────────────────────────────

export function onAssignmentSubmitted(args: WithUid<{ assignmentId?: string }>) {
  void recordCompanionEvent('assignment_submitted', {
    uid: args.uid ?? null,
    payload: { assignmentId: args.assignmentId ?? null },
  });
}

export function onMaterialRead(args: WithUid<{ materialId?: string; minutes?: number }>) {
  void recordCompanionEvent('material_read', { uid: args.uid ?? null, payload: { materialId: args.materialId } });
  if (args.minutes) {
    void recordCompanionEvent('study_session_logged', {
      uid: args.uid ?? null,
      payload: { minutes: args.minutes },
    });
  }
}

export function onQuizAttempt(
  args: WithUid<{ quizId: string; percentage: number | null; isPerfect?: boolean }>,
) {
  void recordCompanionEvent('quiz_attempt_submitted', {
    uid: args.uid ?? null,
    payload: { quizId: args.quizId, percentage: args.percentage },
  });
  if (args.isPerfect) {
    void recordCompanionEvent('quiz_perfect_score', {
      uid: args.uid ?? null,
      payload: { quizId: args.quizId },
    });
  }
}

export function onAttendanceCheckin(
  args: WithUid<{ sessionId: string; courseSpaceId?: string }>,
) {
  void recordCompanionEvent('attendance_checkin', {
    uid: args.uid ?? null,
    payload: { sessionId: args.sessionId, courseSpaceId: args.courseSpaceId },
  });
}

export function onAITutorTurn(args: WithUid<{ topic?: string }>) {
  void recordCompanionEvent('ai_tutor_turn', { uid: args.uid ?? null, payload: { topic: args.topic } });
}

// ─────────────────────────────────────────────────────────
// Library
// ─────────────────────────────────────────────────────────

export function onLibraryBorrow(args: WithUid<{ bookId?: string }>) {
  void recordCompanionEvent('library_borrow', { uid: args.uid ?? null, payload: { bookId: args.bookId } });
}

export function onLibrarySeatReserved(args: WithUid<{ seatId?: string }>) {
  void recordCompanionEvent('library_seat_reserved', {
    uid: args.uid ?? null,
    payload: { seatId: args.seatId },
  });
}

// ─────────────────────────────────────────────────────────
// Cafeteria
// ─────────────────────────────────────────────────────────

export function onMealOrdered(
  args: WithUid<{ vendorId: string; itemIds?: string[]; balanced?: boolean }>,
) {
  void recordCompanionEvent('meal_ordered', {
    uid: args.uid ?? null,
    payload: { vendorId: args.vendorId, itemIds: args.itemIds, balanced: args.balanced ?? false },
  });
}

export function onCafeteriaViewed(args: WithUid<{ source?: string }>) {
  void recordCompanionEvent('cafeteria_viewed', { uid: args.uid ?? null, payload: { source: args.source } });
}

export function onGroupOrderJoined(args: WithUid<{ orderId?: string }>) {
  void recordCompanionEvent('group_order_joined', {
    uid: args.uid ?? null,
    payload: { orderId: args.orderId },
  });
}

// ─────────────────────────────────────────────────────────
// Campus Explore / Transport
// ─────────────────────────────────────────────────────────

export function onPoiVisited(args: WithUid<{ poiId: string }>) {
  void recordCompanionEvent('poi_visited', { uid: args.uid ?? null, payload: { poiId: args.poiId } });
}

export function onARNavigationCompleted(args: WithUid<{ to?: string }>) {
  void recordCompanionEvent('ar_navigation_completed', { uid: args.uid ?? null, payload: { to: args.to } });
}

export function onStepsLogged(args: WithUid<{ steps: number }>) {
  if (!Number.isFinite(args.steps) || args.steps <= 0) return;
  void recordCompanionEvent('steps_logged', { uid: args.uid ?? null, payload: { steps: args.steps } });
}

export function onBusCheckin(args: WithUid<{ routeId?: string }>) {
  void recordCompanionEvent('bus_checkin', { uid: args.uid ?? null, payload: { routeId: args.routeId } });
}

// ─────────────────────────────────────────────────────────
// Campus Services
// ─────────────────────────────────────────────────────────

export function onPrintJobCreated(args: WithUid<{ jobId?: string; copies?: number }>) {
  void recordCompanionEvent('print_job_created', {
    uid: args.uid ?? null,
    payload: { jobId: args.jobId, copies: args.copies },
  });
}

export function onHealthAppointmentCreated(args: WithUid<{ department?: string }>) {
  void recordCompanionEvent('health_appointment_created', {
    uid: args.uid ?? null,
    payload: { department: args.department },
  });
}

export function onDormRepairCreated(args: WithUid<{ ticketId?: string; type?: string }>) {
  void recordCompanionEvent('dorm_repair_created', {
    uid: args.uid ?? null,
    payload: { ticketId: args.ticketId, type: args.type },
  });
}

export function onLostFoundPosted(args: WithUid<{ type: 'lost' | 'found'; itemId?: string }>) {
  const kind = args.type === 'found' ? 'lost_found_claimed' : 'lost_found_posted';
  void recordCompanionEvent(kind, { uid: args.uid ?? null, payload: { itemId: args.itemId } });
}

// ─────────────────────────────────────────────────────────
// Social
// ─────────────────────────────────────────────────────────

export function onGroupPostCreated(args: WithUid<{ groupId: string; postId: string }>) {
  void recordCompanionEvent('group_post_created', {
    uid: args.uid ?? null,
    payload: { groupId: args.groupId, postId: args.postId },
  });
}

export function onCommentCreated(args: WithUid<{ postId: string; commentId: string }>) {
  void recordCompanionEvent('group_comment_created', {
    uid: args.uid ?? null,
    payload: { postId: args.postId, commentId: args.commentId },
  });
}

export function onPeerReviewGiven(args: WithUid<{ submissionId: string }>) {
  void recordCompanionEvent('peer_review_given', {
    uid: args.uid ?? null,
    payload: { submissionId: args.submissionId },
  });
}

export function onPeerReviewReceived(args: WithUid<{ submissionId: string }>) {
  void recordCompanionEvent('peer_review_received', {
    uid: args.uid ?? null,
    payload: { submissionId: args.submissionId },
  });
}

export function onDiscussionPosted(
  args: WithUid<{ threadId: string; isReply?: boolean }>,
) {
  void recordCompanionEvent('discussion_post_created', {
    uid: args.uid ?? null,
    payload: { threadId: args.threadId, isReply: args.isReply ?? false },
  });
}

export function onEncouragementSent(args: WithUid<{ recipientUid: string }>) {
  void recordCompanionEvent('encouragement_sent', {
    uid: args.uid ?? null,
    payload: { recipientUid: args.recipientUid },
  });
}

// ─────────────────────────────────────────────────────────
// Event / System
// ─────────────────────────────────────────────────────────

export function onEventSignup(args: WithUid<{ eventId: string }>) {
  void recordCompanionEvent('event_signup', { uid: args.uid ?? null, payload: { eventId: args.eventId } });
}

export function onEventCheckin(args: WithUid<{ eventId: string }>) {
  void recordCompanionEvent('event_checkin', { uid: args.uid ?? null, payload: { eventId: args.eventId } });
}

export function onInboxActionTaken(args: WithUid<{ source: string }>) {
  void recordCompanionEvent('inbox_action_taken', { uid: args.uid ?? null, payload: { source: args.source } });
}

export function onCreditAuditViewed(args: WithUid<unknown>) {
  void recordCompanionEvent('credit_audit_viewed', { uid: args.uid ?? null });
}

export function onPlantHarvested(args: WithUid<{ courseId: string; points: number }>) {
  void recordCompanionEvent('plant_harvested', {
    uid: args.uid ?? null,
    payload: { courseId: args.courseId, points: args.points },
  });
}

export function onLegacyTreePlanted(args: WithUid<{ treeId: string }>) {
  void recordCompanionEvent('legacy_tree_planted', {
    uid: args.uid ?? null,
    payload: { treeId: args.treeId },
  });
}

export function onMarkHibernate(args: WithUid<{ reason?: 'exam_week' | 'sick' | 'vacation' }>) {
  void recordCompanionEvent('mark_hibernate', { uid: args.uid ?? null, payload: { reason: args.reason } });
}
