/**
 * Demo Action Simulator — 把 demo 的 5 角色動作串成 end-to-end 連鎖
 *
 * 設計：demo 時可以一鍵觸發「老師批改 → 學生收成績 → AI 重算 → 風險預警」整套流程。
 *  - 每個 simulate() 都會 emit RoleEvent → 所有角色 inbox 即時更新
 *  - 透過 aiOrchestrator 計算下游影響並回傳給 caller
 *  - 純函式入口 + AsyncStorage 副作用，無網路
 */
import {
  emitGradePublished,
  emitFeedbackDrafted,
  emitBulkReminder,
  emitAttendanceOpened,
  emitHomeworkPublished,
  emitPeerReviewAssigned,
  emitHomeworkSubmitted,
  emitAttendanceCheckedIn,
  emitDiscussionPosted,
  emitHelpRequested,
  emitAnnouncementPosted,
  emitOrderPlaced,
  emitOrderStatusChanged,
  emitDepartmentBroadcast,
} from './roleEventBus';
import { aiPreReviewGrade, aiVendorNextAction } from './aiOrchestrator';

// ─────────────────────────────────────────────────────────
// 1. 老師批改作業（端到端鏈）
// ─────────────────────────────────────────────────────────

export async function simulateTeacherGrade(input: {
  teacherUid: string;
  teacherName: string;
  studentUid: string;
  studentName: string;
  courseId: number;
  courseName: string;
  homeworkId: number;
  homeworkTitle: string;
  score: number;
  totalScore: number;
}): Promise<{
  aiPreview: ReturnType<typeof aiPreReviewGrade>;
  eventEmitted: 'grade_published';
}> {
  // 1. AI 先預測影響
  const preview = aiPreReviewGrade({
    courseId: input.courseId,
    homeworkId: input.homeworkId,
    studentUid: input.studentUid,
    studentName: input.studentName,
    newScore: input.score,
  });

  // 2. emit event → 學生 inbox + 任何訂閱者
  await emitGradePublished({
    actorUid: input.teacherUid,
    actorName: input.teacherName,
    targetUids: [input.studentUid],
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      itemTitle: input.homeworkTitle,
      itemKind: 'homework',
      score: input.score,
      totalScore: input.totalScore,
    },
  });

  return { aiPreview: preview, eventEmitted: 'grade_published' };
}

// ─────────────────────────────────────────────────────────
// 2. 學生繳交作業（反向事件）
// ─────────────────────────────────────────────────────────

export async function simulateStudentSubmit(input: {
  studentUid: string;
  studentName: string;
  teacherUid: string;
  courseId: number;
  courseName: string;
  homeworkId: number;
  homeworkTitle: string;
  isLate?: boolean;
}): Promise<{ eventEmitted: 'homework_submitted' }> {
  await emitHomeworkSubmitted({
    actorUid: input.studentUid,
    actorName: input.studentName,
    targetUids: [input.teacherUid],
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      homeworkId: input.homeworkId,
      homeworkTitle: input.homeworkTitle,
      studentName: input.studentName,
      isLate: input.isLate ?? false,
      submittedAt: new Date().toISOString(),
    },
  });
  return { eventEmitted: 'homework_submitted' };
}

// ─────────────────────────────────────────────────────────
// 3. 老師開點名 → 學生立刻收 critical 通知
// ─────────────────────────────────────────────────────────

export async function simulateTeacherOpenAttendance(input: {
  teacherUid: string;
  teacherName: string;
  courseId: number;
  courseName: string;
  method: 'rotating_qr' | 'number_code' | 'geofence' | 'selfie_liveness' | 'multi_factor';
  classroomLocation?: string;
  studentUids?: string[];
}) {
  const sessionId = `sess_${Date.now()}`;
  await emitAttendanceOpened({
    actorUid: input.teacherUid,
    actorName: input.teacherName,
    targetUids: input.studentUids,
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      sessionId,
      method: input.method,
      classroomLocation: input.classroomLocation,
    },
  });
  return { sessionId };
}

// ─────────────────────────────────────────────────────────
// 4. 學生簽到完成 → 老師簽到面板更新
// ─────────────────────────────────────────────────────────

export async function simulateStudentCheckIn(input: {
  studentUid: string;
  studentName: string;
  teacherUid: string;
  courseId: number;
  courseName: string;
  sessionId: string;
  method: 'rotating_qr' | 'number_code' | 'geofence' | 'selfie_liveness' | 'multi_factor';
  status: 'present' | 'late';
}) {
  await emitAttendanceCheckedIn({
    actorUid: input.studentUid,
    actorName: input.studentName,
    targetUids: [input.teacherUid],
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      sessionId: input.sessionId,
      method: input.method,
      status: input.status,
      studentName: input.studentName,
    },
  });
  return { eventEmitted: 'attendance_checked_in' };
}

// ─────────────────────────────────────────────────────────
// 5. 學生下訂單 → 餐廳收到
// ─────────────────────────────────────────────────────────

export async function simulateStudentOrderFood(input: {
  studentUid: string;
  studentName: string;
  merchantId: string;
  merchantName: string;
  items: string;
  total: number;
}) {
  const orderId = `order_${Date.now()}`;
  await emitOrderPlaced({
    actorUid: input.studentUid,
    actorName: input.studentName,
    // 仍保留 broadcast 行為（任何聽 order_placed 的店家 cockpit 自己用 merchantId 過濾），
    // 同時用 courseId 欄位放 merchantId，讓 vendor 端 subscriber 直接認得是哪家店。
    targetUids: undefined,
    courseId: input.merchantId,
    courseName: input.merchantName,
    payload: {
      orderId,
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      items: input.items,
      total: input.total,
      studentName: input.studentName,
    },
  });
  return { orderId };
}

// ─────────────────────────────────────────────────────────
// 6. 餐廳備餐進度 → 學生取餐通知
// ─────────────────────────────────────────────────────────

export async function simulateVendorAdvanceOrder(input: {
  vendorUid: string;
  vendorName: string;
  studentUid: string;
  orderId: string;
  merchantId: string;
  merchantName: string;
  newStatus: 'processing' | 'ready' | 'completed';
}) {
  const message =
    input.newStatus === 'processing'
      ? `${input.merchantName} 已開始為你備餐`
      : input.newStatus === 'ready'
        ? `${input.merchantName} 你的餐已準備好，請來取餐 🍱`
        : `${input.merchantName} 訂單已完成，謝謝！`;
  await emitOrderStatusChanged({
    actorUid: input.vendorUid,
    actorName: input.vendorName,
    targetUids: [input.studentUid],
    courseId: input.merchantId,
    courseName: input.merchantName,
    payload: {
      orderId: input.orderId,
      merchantName: input.merchantName,
      newStatus: input.newStatus,
      message,
    },
  });

  // AI 給餐廳下一步建議
  const aiAdvice = aiVendorNextAction({
    pendingOrders: 0,
    processingOrders: input.newStatus === 'processing' ? 1 : 0,
    readyOrders: input.newStatus === 'ready' ? 1 : 0,
    oldestPendingMinutes: 0,
  });

  return { message, aiAdvice };
}

// ─────────────────────────────────────────────────────────
// 7. 主任發系所公告 → 全體
// ─────────────────────────────────────────────────────────

export async function simulateDepartmentBroadcast(input: {
  adminUid: string;
  adminName: string;
  title: string;
  body: string;
  audience: 'students' | 'teachers' | 'all';
}) {
  await emitDepartmentBroadcast({
    actorUid: input.adminUid,
    actorName: input.adminName,
    // 不指定 targetUids → 廣播到 __all__
    targetUids: undefined,
    courseId: 'department',
    courseName: '系所公告',
    payload: input,
  });
  return { eventEmitted: 'department_broadcast' };
}

// ─────────────────────────────────────────────────────────
// 8. 老師發新作業 → 學生待辦 +1
// ─────────────────────────────────────────────────────────

export async function simulateTeacherPublishHomework(input: {
  teacherUid: string;
  teacherName: string;
  courseId: number;
  courseName: string;
  homeworkId: number;
  homeworkTitle: string;
  dueAt: string;
  /** 班級學生 uid 陣列；空 → 廣播全班 */
  studentUids?: string[];
}) {
  await emitHomeworkPublished({
    actorUid: input.teacherUid,
    actorName: input.teacherName,
    targetUids: input.studentUids,
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      homeworkTitle: input.homeworkTitle,
      homeworkId: input.homeworkId,
      dueAt: input.dueAt,
    },
  });
  return { eventEmitted: 'homework_published' as const };
}

// ─────────────────────────────────────────────────────────
// 9. 老師指派互評 → 學生收任務
// ─────────────────────────────────────────────────────────

export async function simulateTeacherAssignPeerReview(input: {
  teacherUid: string;
  teacherName: string;
  courseId: number;
  courseName: string;
  reviewId: number;
  assignmentTitle: string;
  dueAt: string;
  studentUids?: string[];
}) {
  await emitPeerReviewAssigned({
    actorUid: input.teacherUid,
    actorName: input.teacherName,
    targetUids: input.studentUids,
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      assignmentTitle: input.assignmentTitle,
      reviewId: input.reviewId,
      dueAt: input.dueAt,
    },
  });
  return { eventEmitted: 'peer_review_assigned' as const };
}

// ─────────────────────────────────────────────────────────
// 10. 老師 / 主任發課程公告 → 全班 inbox
// ─────────────────────────────────────────────────────────

export async function simulateAnnouncementPosted(input: {
  authorUid: string;
  authorName: string;
  courseId: number | string;
  courseName: string;
  title: string;
  content: string;
  studentUids?: string[];
}) {
  await emitAnnouncementPosted({
    actorUid: input.authorUid,
    actorName: input.authorName,
    targetUids: input.studentUids,
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      title: input.title,
      content: input.content,
    },
  });
  return { eventEmitted: 'announcement_posted' as const };
}

// ─────────────────────────────────────────────────────────
// 11. 學生發討論 → 老師 / TA 待回覆 +1
// ─────────────────────────────────────────────────────────

export async function simulateStudentPostDiscussion(input: {
  studentUid: string;
  studentName: string;
  teacherUid: string;
  taUid?: string;
  courseId: number;
  courseName: string;
  threadId: number;
  threadTitle: string;
  preview: string;
}) {
  const targets = [input.teacherUid, ...(input.taUid ? [input.taUid] : [])];
  await emitDiscussionPosted({
    actorUid: input.studentUid,
    actorName: input.studentName,
    targetUids: targets,
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      authorName: input.studentName,
      preview: input.preview,
    },
  });
  return { eventEmitted: 'discussion_posted' as const };
}

// ─────────────────────────────────────────────────────────
// 12. 學生求助 → 助教 inbox
// ─────────────────────────────────────────────────────────

export async function simulateStudentRequestHelp(input: {
  studentUid: string;
  studentName: string;
  taUid: string;
  courseId: number;
  courseName: string;
  topic: string;
  preview: string;
  urgency: 'low' | 'medium' | 'high';
}) {
  await emitHelpRequested({
    actorUid: input.studentUid,
    actorName: input.studentName,
    targetUids: [input.taUid],
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      topic: input.topic,
      preview: input.preview,
      urgency: input.urgency,
    },
  });
  return { eventEmitted: 'help_requested' as const };
}

// ─────────────────────────────────────────────────────────
// 13. End-to-end demo orchestration
//    一鍵跑完整鏈：學生繳交 → 老師批改 → 學生收新成績 + 評語
// ─────────────────────────────────────────────────────────

export async function simulateFullGradingCycle(input: {
  studentUid: string;
  studentName: string;
  teacherUid: string;
  teacherName: string;
  courseId: number;
  courseName: string;
  homeworkId: number;
  homeworkTitle: string;
  score: number;
  totalScore: number;
  feedbackPreview: string;
}) {
  const steps: string[] = [];

  // step 1: 學生繳交
  await simulateStudentSubmit({
    studentUid: input.studentUid,
    studentName: input.studentName,
    teacherUid: input.teacherUid,
    courseId: input.courseId,
    courseName: input.courseName,
    homeworkId: input.homeworkId,
    homeworkTitle: input.homeworkTitle,
  });
  steps.push(`✅ 學生 ${input.studentName} 繳交 ${input.homeworkTitle}`);

  // step 2: 老師收到 + 批改
  const grade = await simulateTeacherGrade(input);
  steps.push(`✅ 老師 ${input.teacherName} 批改：${input.score}/${input.totalScore}`);
  steps.push(`🤖 AI 預判：${grade.aiPreview.suggestion}`);

  // step 3: 評語送達
  await emitFeedbackDrafted({
    actorUid: input.teacherUid,
    actorName: input.teacherName,
    targetUids: [input.studentUid],
    courseId: input.courseId,
    courseName: input.courseName,
    payload: {
      studentName: input.studentName,
      homeworkTitle: input.homeworkTitle,
      draftPreview: input.feedbackPreview,
    },
  });
  steps.push(`✅ 評語送達學生 inbox`);

  return { steps, aiPreview: grade.aiPreview };
}
