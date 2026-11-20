/**
 * LMS v2 Tool Specs — 把 lmsV2WriteTools 的 21 個 executor 包成 ToolSpec
 * ───────────────────────────────────────────────────────────
 * 給 aiToolRegistry.TOOL_SPECS 合併用。
 *
 * 設計:
 *   - 每個 spec 的 handler 把 LmsWriteResult 轉成 StandardToolResult
 *   - allowedRoles 只做粗略過濾;細粒度權限交給 executor 內的 assertCapability + Supabase RLS
 *   - kind / fields 對齊 LMS v2 角色動作矩陣 (見 docs/LMS_V2_ROLE_ACTION_MAP.md)
 */

import type {
  ToolSpec,
  ToolHandler,
  StandardToolResult,
  ToolErrorCode,
} from './aiToolRegistry';
import {
  submitAssignmentDraft,
  submitAssignmentFinal,
  startQuizAttempt,
  answerQuizQuestion,
  submitQuizAttempt,
  postForumReply,
  checkInLive,
  submitPeerReview,
  submitSurveyAnswer,
  createAssignment,
  gradeSubmission,
  publishCourseGrade,
  createAnnouncement,
  publishAnnouncement,
  moderateForumPost,
  markAttendance,
  startLiveSession,
  endLiveSession,
  enrollStudent,
  grantTACapabilities,
  undoLastWrite,
  type LmsWriteResult,
} from './lmsV2WriteTools';

// 統一錯誤碼對應
function mapErrorCode(c: string | undefined): ToolErrorCode {
  switch (c) {
    case 'no_user':
      return 'auth_required';
    case 'role_denied':
    case 'rls_blocked':
      return 'role_denied';
    case 'not_found':
      return 'not_found';
    case 'invalid_input':
      return 'missing_info';
    case 'window_closed':
      return 'precondition_failed';
    case 'flag_off':
    case 'no_client':
      return 'precondition_failed';
    case 'over_quota':
    case 'supabase_error':
    default:
      return 'execution_failed';
  }
}

// 把 LmsWriteResult 轉成 StandardToolResult
function toStandard(name: string, isWrite: boolean, r: LmsWriteResult): StandardToolResult {
  if (r.success === true) {
    return {
      success: true,
      toolName: name,
      summary: r.summary,
      data: { ...((r.data as object) ?? {}), affects: r.affects, audit_id: r.audit_id },
      isWrite,
      isDraft: !!r.is_draft,
    };
  }
  // success === false → 進入 LmsWriteErr 分支,可安全存取 errorCode / detail
  return {
    success: false,
    toolName: name,
    summary: r.summary,
    errorCode: mapErrorCode(r.errorCode),
    isWrite,
    isDraft: false,
    error: r.detail,
  };
}

// Helper:建立 ToolHandler 包裝
function mkHandler<T>(
  name: string,
  isWrite: boolean,
  fn: (a: T) => Promise<LmsWriteResult>,
): ToolHandler {
  return async args => {
    const r = await fn(args as any as T);
    return toStandard(name, isWrite, r);
  };
}

// 寫一份「萬用」allowedRoles(實際權限交給 executor + Supabase RLS)
const ANYBODY = ['student', 'teacher', 'staff', 'department_head', 'admin'] as const;
const TEACHERS = ['teacher', 'staff', 'department_head', 'admin'] as const;
const STUDENTS = ['student'] as const;

export const LMS_V2_TOOL_SPECS: readonly ToolSpec[] = [
  // ─────────────── STUDENT ───────────────
  {
    name: 'lms_submit_assignment_draft',
    aliases: ['submitAssignmentDraft'],
    description: 'LMS 學生:暫存作業草稿(尚未送出)。',
    kind: 'write',
    allowedRoles: [...STUDENTS, ...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'assignmentId', description: '作業 ID', type: 'string', required: true },
      { name: 'contentText', description: '作業文字內容', type: 'string' },
      { name: 'attachmentUrls', description: '附件 URL 列(逗號分隔)', type: 'string_list' },
    ],
    handler: mkHandler('lms_submit_assignment_draft', true, submitAssignmentDraft),
  },
  {
    name: 'lms_submit_assignment_final',
    aliases: ['submitAssignmentFinal'],
    description: 'LMS 學生:正式送出作業 → 教師收到批改通知。',
    kind: 'cross_role_write',
    allowedRoles: [...STUDENTS, ...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'assignmentId', description: '作業 ID', type: 'string', required: true },
      { name: 'contentText', description: '作業文字內容', type: 'string' },
      { name: 'attachmentUrls', description: '附件 URL 列(逗號分隔)', type: 'string_list' },
    ],
    handler: mkHandler('lms_submit_assignment_final', true, submitAssignmentFinal),
  },
  {
    name: 'lms_start_quiz_attempt',
    aliases: ['startQuizAttempt'],
    description: 'LMS 學生:開始一次測驗嘗試。',
    kind: 'write',
    allowedRoles: [...STUDENTS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'quizId', description: '測驗 ID', type: 'string', required: true },
    ],
    handler: mkHandler('lms_start_quiz_attempt', true, startQuizAttempt),
  },
  {
    name: 'lms_answer_quiz_question',
    aliases: ['answerQuizQuestion'],
    description: 'LMS 學生:回答某題目(可重複覆寫直到交卷)。',
    kind: 'write',
    allowedRoles: [...STUDENTS],
    fields: [
      { name: 'attemptId', description: '嘗試 ID', type: 'string', required: true },
      { name: 'questionId', description: '題目 ID', type: 'string', required: true },
      { name: 'answer', description: '答案內容(可為文字或選項陣列)', type: 'string', required: true },
    ],
    handler: mkHandler('lms_answer_quiz_question', true, answerQuizQuestion),
  },
  {
    name: 'lms_submit_quiz_attempt',
    aliases: ['submitQuizAttempt'],
    description: 'LMS 學生:正式交卷,送出整個測驗嘗試。',
    kind: 'cross_role_write',
    allowedRoles: [...STUDENTS],
    fields: [{ name: 'attemptId', description: '嘗試 ID', type: 'string', required: true }],
    handler: mkHandler('lms_submit_quiz_attempt', true, submitQuizAttempt),
  },
  {
    name: 'lms_post_forum_reply',
    aliases: ['postForumReply'],
    description: 'LMS:在課程討論版發文 / 回覆。',
    kind: 'cross_role_write',
    allowedRoles: [...ANYBODY],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'topicId', description: '主題 ID', type: 'string', required: true },
      { name: 'body', description: '貼文內容', type: 'string', required: true },
      { name: 'replyToPostId', description: '回覆某貼文 ID(可選)', type: 'string' },
    ],
    handler: mkHandler('lms_post_forum_reply', true, postForumReply),
  },
  {
    name: 'lms_check_in_live',
    aliases: ['checkInLive'],
    description: 'LMS 學生:課堂簽到(直播 / 點名)。',
    kind: 'write',
    allowedRoles: [...STUDENTS],
    fields: [
      { name: 'sessionId', description: '直播課堂 ID', type: 'string', required: true },
      { name: 'code', description: '簽到驗證碼(若需)', type: 'string' },
    ],
    handler: mkHandler('lms_check_in_live', true, checkInLive),
  },
  {
    name: 'lms_submit_peer_review',
    aliases: ['submitPeerReview'],
    description: 'LMS 學生:同儕互評送出評分與回饋。',
    kind: 'cross_role_write',
    allowedRoles: [...STUDENTS],
    fields: [
      { name: 'assignmentId', description: '同儕互評作業 ID', type: 'string', required: true },
      { name: 'reviewedSubmissionId', description: '被評的繳交 ID', type: 'string', required: true },
      { name: 'scores', description: '評分 JSON(criterionId → 分數)', type: 'string', required: true },
      { name: 'feedback', description: '文字回饋', type: 'string' },
    ],
    handler: mkHandler('lms_submit_peer_review', true, submitPeerReview),
  },
  {
    name: 'lms_submit_survey_answer',
    aliases: ['submitSurveyAnswer'],
    description: 'LMS 學生:填問卷。',
    kind: 'write',
    allowedRoles: [...STUDENTS],
    fields: [
      { name: 'surveyId', description: '問卷 ID', type: 'string', required: true },
      { name: 'answers', description: '答案 JSON', type: 'string', required: true },
    ],
    handler: mkHandler('lms_submit_survey_answer', true, submitSurveyAnswer),
  },

  // ─────────────── TEACHER / TA ───────────────
  {
    name: 'lms_create_assignment',
    aliases: ['createAssignment'],
    description: 'LMS 教師/TA:建立作業(預設 draft;設 status=published 才正式發布)。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'title', description: '作業標題', type: 'string', required: true },
      { name: 'body', description: '說明內容', type: 'string' },
      { name: 'dueAt', description: '截止 ISO datetime', type: 'datetime' },
      { name: 'weight', description: '佔分權重(預設 1)', type: 'number', default: 1 },
      { name: 'rubricId', description: '評分量表 ID(可選)', type: 'string' },
      {
        name: 'status',
        description: 'draft | published',
        type: 'enum',
        enum: ['draft', 'published'],
        default: 'draft',
      },
    ],
    handler: mkHandler('lms_create_assignment', true, createAssignment),
  },
  {
    name: 'lms_grade_submission',
    aliases: ['gradeSubmission'],
    description: 'LMS 教師/TA:批改某份繳交,給分與回饋。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'submissionId', description: '繳交 ID', type: 'string', required: true },
      { name: 'score', description: '分數 0-100', type: 'number', required: true },
      { name: 'feedback', description: '文字回饋', type: 'string' },
      { name: 'rubricScores', description: '量表分數 JSON', type: 'string' },
      {
        name: 'publishImmediately',
        description: '立即發佈給學生(預設 false 只存在教師端)',
        type: 'boolean',
        default: false,
      },
    ],
    handler: mkHandler('lms_grade_submission', true, gradeSubmission),
  },
  {
    name: 'lms_publish_course_grade',
    aliases: ['publishCourseGrade'],
    description: 'LMS 教師:發佈成績整批給全班(高影響,Agent 應先確認)。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'itemName', description: '只發布某項目(可選,不填則全課程)', type: 'string' },
    ],
    handler: mkHandler('lms_publish_course_grade', true, publishCourseGrade),
  },
  {
    name: 'lms_create_announcement',
    aliases: ['createAnnouncement'],
    description: 'LMS 教師/TA:建公告(預設 draft)。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'title', description: '標題', type: 'string', required: true },
      { name: 'body', description: '內文', type: 'string', required: true },
      {
        name: 'publishImmediately',
        description: '立即發布(預設 false)',
        type: 'boolean',
        default: false,
      },
    ],
    handler: mkHandler('lms_create_announcement', true, createAnnouncement),
  },
  {
    name: 'lms_publish_announcement',
    aliases: ['publishAnnouncement'],
    description: 'LMS:把已存草稿公告正式發布給全班。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'announcementId', description: '公告 ID', type: 'string', required: true },
    ],
    handler: mkHandler('lms_publish_announcement', true, publishAnnouncement),
  },
  {
    name: 'lms_moderate_forum_post',
    aliases: ['moderateForumPost'],
    description: 'LMS 教師/TA/版主:隱藏、取消隱藏或刪除某討論貼文。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'postId', description: '貼文 ID', type: 'string', required: true },
      {
        name: 'action',
        description: '動作',
        type: 'enum',
        enum: ['hide', 'unhide', 'delete'],
        required: true,
      },
      { name: 'reason', description: '原因', type: 'string' },
    ],
    handler: mkHandler('lms_moderate_forum_post', true, moderateForumPost),
  },
  {
    name: 'lms_mark_attendance',
    aliases: ['markAttendance'],
    description: 'LMS 教師/TA:標記某學生的出席狀態。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'sessionId', description: '直播課堂 ID', type: 'string', required: true },
      { name: 'userId', description: '學生 user_id', type: 'string', required: true },
      {
        name: 'status',
        description: '狀態',
        type: 'enum',
        enum: ['present', 'late', 'absent', 'excused'],
        required: true,
      },
    ],
    handler: mkHandler('lms_mark_attendance', true, markAttendance),
  },
  {
    name: 'lms_start_live_session',
    aliases: ['startLiveSession'],
    description: 'LMS 教師:開始一場直播課堂,簽到視窗 10 分鐘。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'title', description: '課堂名稱', type: 'string' },
      { name: 'durationMinutes', description: '預計時長(分鐘)', type: 'integer', default: 60 },
    ],
    handler: mkHandler('lms_start_live_session', true, startLiveSession),
  },
  {
    name: 'lms_end_live_session',
    aliases: ['endLiveSession'],
    description: 'LMS 教師:結束直播課堂。',
    kind: 'write',
    allowedRoles: [...TEACHERS],
    fields: [{ name: 'sessionId', description: '課堂 ID', type: 'string', required: true }],
    handler: mkHandler('lms_end_live_session', true, endLiveSession),
  },
  {
    name: 'lms_enroll_student',
    aliases: ['enrollStudent'],
    description: 'LMS 教師:把學生加入課程。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'studentUserId', description: '學生 user_id', type: 'string', required: true },
    ],
    handler: mkHandler('lms_enroll_student', true, enrollStudent),
  },
  {
    name: 'lms_grant_ta_capabilities',
    aliases: ['grantTACapabilities'],
    description: 'LMS 教師:設定 TA 角色與其能力清單。',
    kind: 'cross_role_write',
    allowedRoles: [...TEACHERS],
    fields: [
      { name: 'courseId', description: '課程 ID', type: 'string', required: true },
      { name: 'taUserId', description: '助教 user_id', type: 'string', required: true },
      {
        name: 'capabilities',
        description: '能力清單(逗號分隔,如 assignments.grade,forum.moderate)',
        type: 'string_list',
        required: true,
      },
    ],
    handler: mkHandler('lms_grant_ta_capabilities', true, grantTACapabilities),
  },

  // ─────────────── 通用 ───────────────
  {
    name: 'lms_undo_last_write',
    aliases: ['undoLastWrite'],
    description: 'LMS:撤銷 5 分鐘內由 AI 完成的單一寫入動作。',
    kind: 'write',
    allowedRoles: [...ANYBODY],
    fields: [{ name: 'auditId', description: 'audit_logs.id', type: 'string', required: true }],
    handler: mkHandler('lms_undo_last_write', true, undoLastWrite),
  },
];
