/**
 * LMS v2 Write Tools — AI 可呼叫的 LMS 寫入動作
 * ───────────────────────────────────────────────────────────
 * 設計依據:docs/LMS_V2_ROLE_ACTION_MAP.md
 *
 * 每個動作都是一個 async function,內建:
 *   1. capability 預檢 (assertCapability),失敗回 role_denied
 *   2. Supabase RLS 雙保險
 *   3. audit_logs 寫入 (誰、何時、做了什麼)
 *   4. 跨角色觸發提示 (回傳值附帶 affects[],讓 Agent 決定後續)
 *
 * 統一回傳形狀(對齊 aiToolRegistry.ToolStandardResult):
 *   { success, summary, data?, errorCode?, affects?, audit_id? }
 */

import { getSupabaseClient } from './supabaseClient';
import { isLmsV2Enabled } from './lmsV2FeatureFlag';

// ─── 共用型別 ───

export type LmsWriteOk<T = any> = {
  success: true;
  summary: string;
  data?: T;
  affects?: string[]; // 受影響的角色或人數描述,給 Agent plan 用
  audit_id?: string;
  is_draft?: boolean;
};
export type LmsWriteErr = {
  success: false;
  summary: string;
  errorCode:
    | 'flag_off'
    | 'no_client'
    | 'no_user'
    | 'role_denied'
    | 'not_found'
    | 'invalid_input'
    | 'over_quota'
    | 'window_closed'
    | 'rls_blocked'
    | 'supabase_error';
  detail?: string;
};
export type LmsWriteResult<T = any> = LmsWriteOk<T> | LmsWriteErr;

// ─── 內部 helpers ───

async function getClientOrErr(): Promise<
  | { ok: true; sb: any; userId: string }
  | { ok: false; err: LmsWriteErr }
> {
  if (!isLmsV2Enabled()) {
    return {
      ok: false,
      err: { success: false, summary: 'LMS v2 未啟用', errorCode: 'flag_off' },
    };
  }
  const sb = getSupabaseClient();
  if (!sb) {
    return {
      ok: false,
      err: { success: false, summary: 'Supabase client 不可用', errorCode: 'no_client' },
    };
  }
  try {
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) {
      return {
        ok: false,
        err: { success: false, summary: '未登入 LMS', errorCode: 'no_user' },
      };
    }
    return { ok: true, sb, userId: data.user.id };
  } catch (err: any) {
    return {
      ok: false,
      err: {
        success: false,
        summary: '取得 user 失敗',
        errorCode: 'no_user',
        detail: err?.message,
      },
    };
  }
}

async function assertCourseRole(
  sb: any,
  userId: string,
  courseId: string | number,
  expected: ('teacher' | 'assistant' | 'student' | 'moderator')[],
): Promise<{ ok: boolean; role?: string }> {
  const { data, error } = await sb
    .from('course_members')
    .select('role')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return { ok: false };
  const r = String(data.role || '').toLowerCase();
  return { ok: expected.includes(r as any), role: r };
}

async function assertCapability(
  sb: any,
  userId: string,
  courseId: string | number,
  capability: string,
): Promise<boolean> {
  // course_role_capabilities 為 role+capability 的多對多 seed
  // 先取 user 在此課程的 role,再查該 role 是否有此 capability
  const { data: member } = await sb
    .from('course_members')
    .select('role')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!member?.role) return false;
  if (member.role === 'teacher') return true; // teacher 萬能
  const { data: caps } = await sb
    .from('course_role_capabilities')
    .select('capability, enabled')
    .eq('course_id', courseId)
    .eq('role', member.role)
    .eq('capability', capability)
    .maybeSingle();
  return !!caps?.enabled;
}

async function writeAudit(
  sb: any,
  userId: string,
  courseId: string | number | null,
  action: string,
  target: string,
  detail?: any,
): Promise<string | undefined> {
  try {
    const { data } = await sb
      .from('audit_logs')
      .insert({
        actor_user_id: userId,
        course_id: courseId,
        action,
        target,
        detail: detail ? JSON.stringify(detail) : null,
        source: 'ai_agent',
      })
      .select('id')
      .single();
    return data?.id ? String(data.id) : undefined;
  } catch {
    // audit 失敗不阻塞主流程
    return undefined;
  }
}

function rls(err: any): LmsWriteErr {
  const msg = err?.message ?? String(err);
  if (/permission denied|row-level security|violates rls/i.test(msg)) {
    return {
      success: false,
      summary: '權限不足 (RLS 已擋下)',
      errorCode: 'rls_blocked',
      detail: msg,
    };
  }
  return {
    success: false,
    summary: msg || 'Supabase 寫入失敗',
    errorCode: 'supabase_error',
    detail: msg,
  };
}

// ──────────────────────────────────────────────────────────────
// STUDENT actions
// ──────────────────────────────────────────────────────────────

export async function submitAssignmentDraft(opts: {
  courseId: string | number;
  assignmentId: string | number;
  contentText?: string;
  attachmentUrls?: string[];
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;

  // RLS 自動限制 own + before due_at
  try {
    const { data, error } = await sb
      .from('submissions')
      .upsert(
        {
          course_id: opts.courseId,
          assignment_id: opts.assignmentId,
          user_id: userId,
          content_text: opts.contentText ?? null,
          attachment_urls: opts.attachmentUrls ?? null,
          status: 'draft',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'assignment_id,user_id' },
      )
      .select('id')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'submit_draft', `assignments/${opts.assignmentId}`, opts);
    return {
      success: true,
      summary: '草稿已存',
      data: { submissionId: data?.id },
      is_draft: true,
      audit_id: auditId,
      affects: ['self'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function submitAssignmentFinal(opts: {
  courseId: string | number;
  assignmentId: string | number;
  contentText?: string;
  attachmentUrls?: string[];
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;

  try {
    const { data, error } = await sb
      .from('submissions')
      .upsert(
        {
          course_id: opts.courseId,
          assignment_id: opts.assignmentId,
          user_id: userId,
          content_text: opts.contentText ?? null,
          attachment_urls: opts.attachmentUrls ?? null,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'assignment_id,user_id' },
      )
      .select('id')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'submit_final', `assignments/${opts.assignmentId}`, opts);
    return {
      success: true,
      summary: '已送出作業,教師將收到批改通知',
      data: { submissionId: data?.id },
      audit_id: auditId,
      affects: ['teacher', 'ta'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function startQuizAttempt(opts: {
  courseId: string | number;
  quizId: string | number;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { data, error } = await sb
      .from('quiz_attempts')
      .insert({
        course_id: opts.courseId,
        quiz_id: opts.quizId,
        user_id: userId,
        started_at: new Date().toISOString(),
        status: 'in_progress',
      })
      .select('id')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'start_quiz', `quizzes/${opts.quizId}`);
    return {
      success: true,
      summary: '測驗開始',
      data: { attemptId: data?.id },
      audit_id: auditId,
      affects: ['self'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function answerQuizQuestion(opts: {
  attemptId: string | number;
  questionId: string | number;
  answer: any;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { error } = await sb.from('quiz_answers').upsert(
      {
        attempt_id: opts.attemptId,
        question_id: opts.questionId,
        user_id: userId,
        answer: opts.answer,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'attempt_id,question_id' },
    );
    if (error) return rls(error);
    return { success: true, summary: '答案已存', affects: ['self'] };
  } catch (err) {
    return rls(err);
  }
}

export async function submitQuizAttempt(opts: {
  attemptId: string | number;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { error } = await sb
      .from('quiz_attempts')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', opts.attemptId)
      .eq('user_id', userId);
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, null, 'submit_quiz', `quiz_attempts/${opts.attemptId}`);
    return {
      success: true,
      summary: '測驗已交卷',
      audit_id: auditId,
      affects: ['teacher'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function postForumReply(opts: {
  courseId: string | number;
  topicId: string | number;
  body: string;
  replyToPostId?: string | number;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  if (!opts.body || opts.body.length < 1) {
    return { success: false, summary: '內容空白', errorCode: 'invalid_input' };
  }
  try {
    const { data, error } = await sb
      .from('forum_posts')
      .insert({
        course_id: opts.courseId,
        topic_id: opts.topicId,
        author_id: userId,
        body: opts.body,
        reply_to_id: opts.replyToPostId ?? null,
      })
      .select('id')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'forum_post', `topics/${opts.topicId}`);
    return {
      success: true,
      summary: '已發討論',
      data: { postId: data?.id },
      audit_id: auditId,
      affects: ['teacher', 'ta', 'subscribers'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function checkInLive(opts: {
  sessionId: string | number;
  code?: string;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { error } = await sb.from('live_attendance').insert({
      session_id: opts.sessionId,
      user_id: userId,
      status: 'present',
      checked_in_at: new Date().toISOString(),
      verify_code: opts.code ?? null,
    });
    if (error) {
      if (/window/i.test(error.message)) {
        return {
          success: false,
          summary: '簽到時間窗已關閉',
          errorCode: 'window_closed',
          detail: error.message,
        };
      }
      return rls(error);
    }
    const auditId = await writeAudit(sb, userId, null, 'check_in', `sessions/${opts.sessionId}`);
    return { success: true, summary: '已簽到', audit_id: auditId, affects: ['teacher'] };
  } catch (err) {
    return rls(err);
  }
}

export async function submitPeerReview(opts: {
  assignmentId: string | number;
  reviewedSubmissionId: string | number;
  scores: Record<string, number>;
  feedback?: string;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { error } = await sb.from('peer_review_submissions').insert({
      peer_assignment_id: opts.assignmentId,
      reviewed_submission_id: opts.reviewedSubmissionId,
      reviewer_id: userId,
      scores: opts.scores,
      feedback: opts.feedback ?? null,
      submitted_at: new Date().toISOString(),
    });
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, null, 'peer_review', `assignments/${opts.assignmentId}`);
    return {
      success: true,
      summary: '同儕互評已送出',
      audit_id: auditId,
      affects: ['reviewed_student', 'teacher'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function submitSurveyAnswer(opts: {
  surveyId: string | number;
  answers: Record<string, any>;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { error } = await sb.from('survey_answers').insert({
      survey_id: opts.surveyId,
      user_id: userId,
      answers: opts.answers,
      submitted_at: new Date().toISOString(),
    });
    if (error) return rls(error);
    return { success: true, summary: '問卷已提交', affects: ['self', 'teacher'] };
  } catch (err) {
    return rls(err);
  }
}

// ──────────────────────────────────────────────────────────────
// TEACHER / TA actions
// ──────────────────────────────────────────────────────────────

export async function createAssignment(opts: {
  courseId: string | number;
  title: string;
  body?: string;
  dueAt?: string; // ISO
  weight?: number;
  rubricId?: string | number;
  status?: 'draft' | 'published';
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const role = await assertCourseRole(sb, userId, opts.courseId, ['teacher', 'assistant']);
  if (!role.ok) {
    return { success: false, summary: '只有教師/助教能建作業', errorCode: 'role_denied' };
  }
  try {
    const { data, error } = await sb
      .from('assignments')
      .insert({
        course_id: opts.courseId,
        title: opts.title,
        body: opts.body ?? null,
        due_at: opts.dueAt ?? null,
        weight: opts.weight ?? 1,
        rubric_id: opts.rubricId ?? null,
        status: opts.status ?? 'draft',
        created_by: userId,
      })
      .select('id, status')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'assignment_create', `assignments/${data?.id}`, opts);
    return {
      success: true,
      summary: opts.status === 'published' ? '作業已發布,全班可看到' : '作業草稿已建立',
      data: { assignmentId: data?.id, status: data?.status },
      audit_id: auditId,
      is_draft: data?.status === 'draft',
      affects: data?.status === 'published' ? ['all_students'] : ['self'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function gradeSubmission(opts: {
  submissionId: string | number;
  score: number;
  feedback?: string;
  rubricScores?: Record<string, number>;
  publishImmediately?: boolean;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  // 找出 submission 對應的 courseId,檢查 capability
  const { data: sub } = await sb
    .from('submissions')
    .select('course_id, user_id, assignment_id')
    .eq('id', opts.submissionId)
    .maybeSingle();
  if (!sub) return { success: false, summary: '找不到 submission', errorCode: 'not_found' };
  const canGrade = await assertCapability(sb, userId, sub.course_id, 'assignments.grade');
  if (!canGrade) {
    return { success: false, summary: '無批改權限', errorCode: 'role_denied' };
  }
  try {
    const updatePayload: any = {
      score: opts.score,
      feedback: opts.feedback ?? null,
      graded_by: userId,
      graded_at: new Date().toISOString(),
      status: opts.publishImmediately ? 'graded_published' : 'graded',
    };
    const { error } = await sb.from('submissions').update(updatePayload).eq('id', opts.submissionId);
    if (error) return rls(error);
    if (opts.rubricScores) {
      await sb.from('submission_rubric_scores').upsert(
        Object.entries(opts.rubricScores).map(([criterion_id, score]) => ({
          submission_id: opts.submissionId,
          criterion_id,
          score,
          graded_by: userId,
        })),
      );
    }
    const auditId = await writeAudit(sb, userId, sub.course_id, 'grade_submission', `submissions/${opts.submissionId}`, {
      score: opts.score,
      published: opts.publishImmediately ?? false,
    });
    return {
      success: true,
      summary: opts.publishImmediately ? '已批改並發布給該學生' : '已批改 (尚未發布)',
      audit_id: auditId,
      affects: opts.publishImmediately ? ['the_student'] : ['self'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function publishCourseGrade(opts: {
  courseId: string | number;
  itemName?: string; // 若指定:只發布某一項;不指定:全課程
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const role = await assertCourseRole(sb, userId, opts.courseId, ['teacher']);
  if (!role.ok) {
    return { success: false, summary: '只有教師可發布成績', errorCode: 'role_denied' };
  }
  try {
    let q = sb.from('course_grade_rollups').update({
      published: true,
      published_at: new Date().toISOString(),
      published_by: userId,
    }).eq('course_id', opts.courseId);
    if (opts.itemName) q = q.eq('item_name', opts.itemName);
    const { error, count } = await q.select('id', { count: 'exact' });
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'publish_grades', 'course_grade_rollups', {
      itemName: opts.itemName,
      affected: count,
    });
    return {
      success: true,
      summary: `已發布成績(影響 ${count ?? '?'} 筆)`,
      data: { affected: count },
      audit_id: auditId,
      affects: ['all_students'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function createAnnouncement(opts: {
  courseId: string | number;
  title: string;
  body: string;
  publishImmediately?: boolean;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const can =
    (await assertCapability(sb, userId, opts.courseId, 'announcements.author')) ||
    (await assertCourseRole(sb, userId, opts.courseId, ['teacher'])).ok;
  if (!can) {
    return { success: false, summary: '無發公告權限', errorCode: 'role_denied' };
  }
  try {
    const { data, error } = await sb
      .from('announcements')
      .insert({
        course_id: opts.courseId,
        title: opts.title,
        body: opts.body,
        author_id: userId,
        status: opts.publishImmediately ? 'published' : 'draft',
        published_at: opts.publishImmediately ? new Date().toISOString() : null,
      })
      .select('id')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'announcement_create', `announcements/${data?.id}`, {
      published: opts.publishImmediately,
    });
    return {
      success: true,
      summary: opts.publishImmediately ? '公告已發布,全班收到推播' : '公告草稿已存',
      data: { announcementId: data?.id },
      audit_id: auditId,
      is_draft: !opts.publishImmediately,
      affects: opts.publishImmediately ? ['all_students'] : ['self'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function publishAnnouncement(opts: {
  announcementId: string | number;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const { data: ann } = await sb
    .from('announcements')
    .select('course_id')
    .eq('id', opts.announcementId)
    .maybeSingle();
  if (!ann) return { success: false, summary: '找不到公告', errorCode: 'not_found' };
  const can =
    (await assertCapability(sb, userId, ann.course_id, 'announcements.author')) ||
    (await assertCourseRole(sb, userId, ann.course_id, ['teacher'])).ok;
  if (!can) return { success: false, summary: '無發布權限', errorCode: 'role_denied' };
  try {
    const { error } = await sb
      .from('announcements')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .eq('id', opts.announcementId);
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, ann.course_id, 'announcement_publish', `announcements/${opts.announcementId}`);
    return {
      success: true,
      summary: '公告已發布,全班會收到推播',
      audit_id: auditId,
      affects: ['all_students'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function moderateForumPost(opts: {
  postId: string | number;
  action: 'hide' | 'unhide' | 'delete';
  reason?: string;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const { data: post } = await sb
    .from('forum_posts')
    .select('course_id, author_id')
    .eq('id', opts.postId)
    .maybeSingle();
  if (!post) return { success: false, summary: '找不到貼文', errorCode: 'not_found' };
  const can = await assertCapability(sb, userId, post.course_id, 'forum.moderate');
  if (!can) return { success: false, summary: '無版主權限', errorCode: 'role_denied' };
  try {
    if (opts.action === 'delete') {
      const { error } = await sb.from('forum_posts').delete().eq('id', opts.postId);
      if (error) return rls(error);
    } else {
      const { error } = await sb
        .from('forum_posts')
        .update({ hidden: opts.action === 'hide' })
        .eq('id', opts.postId);
      if (error) return rls(error);
    }
    await sb.from('forum_moderation_logs').insert({
      post_id: opts.postId,
      moderator_id: userId,
      action: opts.action,
      reason: opts.reason ?? null,
    });
    const auditId = await writeAudit(sb, userId, post.course_id, 'forum_moderate', `posts/${opts.postId}`, {
      action: opts.action,
    });
    return {
      success: true,
      summary: `已${opts.action === 'delete' ? '刪除' : opts.action === 'hide' ? '隱藏' : '取消隱藏'}該貼文`,
      audit_id: auditId,
      affects: ['post_author'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function markAttendance(opts: {
  sessionId: string | number;
  userId: string;
  status: 'present' | 'late' | 'absent' | 'excused';
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId: actor } = env;
  const { data: session } = await sb
    .from('live_sessions')
    .select('course_id')
    .eq('id', opts.sessionId)
    .maybeSingle();
  if (!session) return { success: false, summary: '找不到課堂', errorCode: 'not_found' };
  const can = await assertCapability(sb, actor, session.course_id, 'attendance.manage');
  if (!can) return { success: false, summary: '無點名權限', errorCode: 'role_denied' };
  try {
    const { error } = await sb.from('live_attendance').upsert(
      {
        session_id: opts.sessionId,
        user_id: opts.userId,
        status: opts.status,
        marked_by: actor,
        checked_in_at: opts.status === 'present' || opts.status === 'late' ? new Date().toISOString() : null,
      },
      { onConflict: 'session_id,user_id' },
    );
    if (error) return rls(error);
    const auditId = await writeAudit(sb, actor, session.course_id, 'attendance_mark', `sessions/${opts.sessionId}/users/${opts.userId}`, {
      status: opts.status,
    });
    return {
      success: true,
      summary: `已標記為 ${opts.status}`,
      audit_id: auditId,
      affects: ['the_student'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function startLiveSession(opts: {
  courseId: string | number;
  title?: string;
  durationMinutes?: number;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const role = await assertCourseRole(sb, userId, opts.courseId, ['teacher', 'assistant']);
  if (!role.ok) return { success: false, summary: '只有教師/助教能開課', errorCode: 'role_denied' };
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + (opts.durationMinutes ?? 60) * 60_000);
  try {
    const { data, error } = await sb
      .from('live_sessions')
      .insert({
        course_id: opts.courseId,
        title: opts.title ?? '直播課堂',
        starts_at: startedAt.toISOString(),
        ends_at: endsAt.toISOString(),
        attendance_window_start: startedAt.toISOString(),
        attendance_window_end: new Date(startedAt.getTime() + 10 * 60_000).toISOString(),
        started_by: userId,
      })
      .select('id')
      .single();
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'live_start', `sessions/${data?.id}`);
    return {
      success: true,
      summary: '直播已開始,簽到視窗 10 分鐘',
      data: { sessionId: data?.id, attendanceWindowMin: 10 },
      audit_id: auditId,
      affects: ['all_students'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function endLiveSession(opts: {
  sessionId: string | number;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  try {
    const { error } = await sb
      .from('live_sessions')
      .update({ ends_at: new Date().toISOString() })
      .eq('id', opts.sessionId);
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, null, 'live_end', `sessions/${opts.sessionId}`);
    return {
      success: true,
      summary: '直播已結束',
      audit_id: auditId,
      affects: ['all_students'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function enrollStudent(opts: {
  courseId: string | number;
  studentUserId: string;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const role = await assertCourseRole(sb, userId, opts.courseId, ['teacher']);
  if (!role.ok) return { success: false, summary: '只有教師可加學生', errorCode: 'role_denied' };
  try {
    const { error } = await sb.from('course_members').insert({
      course_id: opts.courseId,
      user_id: opts.studentUserId,
      role: 'student',
      enrolled_by: userId,
    });
    if (error) return rls(error);
    const auditId = await writeAudit(sb, userId, opts.courseId, 'enroll', `members/${opts.studentUserId}`);
    return {
      success: true,
      summary: '學生已加入課程',
      audit_id: auditId,
      affects: ['the_student'],
    };
  } catch (err) {
    return rls(err);
  }
}

export async function grantTACapabilities(opts: {
  courseId: string | number;
  taUserId: string;
  capabilities: string[];
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const role = await assertCourseRole(sb, userId, opts.courseId, ['teacher']);
  if (!role.ok) return { success: false, summary: '只有教師能設 TA', errorCode: 'role_denied' };
  try {
    // 1. 將該 user 設為 assistant
    await sb.from('course_members').upsert(
      {
        course_id: opts.courseId,
        user_id: opts.taUserId,
        role: 'assistant',
        enrolled_by: userId,
      },
      { onConflict: 'course_id,user_id' },
    );
    // 2. 啟用 capabilities (per-course-per-role)
    await sb.from('course_role_capabilities').upsert(
      opts.capabilities.map(c => ({
        course_id: opts.courseId,
        role: 'assistant',
        capability: c,
        enabled: true,
        granted_by: userId,
      })),
      { onConflict: 'course_id,role,capability' },
    );
    const auditId = await writeAudit(sb, userId, opts.courseId, 'grant_ta', `users/${opts.taUserId}`, opts);
    return {
      success: true,
      summary: `已設 TA,啟用 ${opts.capabilities.length} 項能力`,
      audit_id: auditId,
      affects: ['the_ta'],
    };
  } catch (err) {
    return rls(err);
  }
}

// ──────────────────────────────────────────────────────────────
// 通用工具
// ──────────────────────────────────────────────────────────────

/**
 * 撤銷最近一次 AI 寫入動作(5 分鐘內)。
 * 適用於 announcement_create / assignment_create / publish_* 等。
 * 用 audit_logs 的 id 找到對應 row 與 action,反向操作。
 */
export async function undoLastWrite(opts: {
  auditId: string;
}): Promise<LmsWriteResult> {
  const env = await getClientOrErr();
  if (env.ok === false) return env.err;
  const { sb, userId } = env;
  const { data: audit } = await sb
    .from('audit_logs')
    .select('action, target, course_id, actor_user_id, created_at, reverted_at')
    .eq('id', opts.auditId)
    .maybeSingle();
  if (!audit) return { success: false, summary: '找不到 audit', errorCode: 'not_found' };
  if (audit.actor_user_id !== userId) {
    return { success: false, summary: '只能撤銷自己的動作', errorCode: 'role_denied' };
  }
  if (audit.reverted_at) {
    return { success: false, summary: '此動作已被撤銷', errorCode: 'invalid_input' };
  }
  const ageMs = Date.now() - new Date(audit.created_at).getTime();
  if (ageMs > 5 * 60_000) {
    return { success: false, summary: '已超過 5 分鐘撤銷時限', errorCode: 'window_closed' };
  }

  // 解析 action,執行反向
  try {
    if (audit.action === 'announcement_create') {
      const id = String(audit.target).split('/').pop();
      await sb.from('announcements').delete().eq('id', id);
    } else if (audit.action === 'announcement_publish') {
      const id = String(audit.target).split('/').pop();
      await sb.from('announcements').update({ status: 'draft', published_at: null }).eq('id', id);
    } else if (audit.action === 'assignment_create') {
      const id = String(audit.target).split('/').pop();
      await sb.from('assignments').delete().eq('id', id);
    } else if (audit.action === 'publish_grades') {
      await sb
        .from('course_grade_rollups')
        .update({ published: false, published_at: null })
        .eq('course_id', audit.course_id);
    } else {
      return {
        success: false,
        summary: `action="${audit.action}" 不支援撤銷`,
        errorCode: 'invalid_input',
      };
    }
    await sb.from('audit_logs').update({ reverted_at: new Date().toISOString() }).eq('id', opts.auditId);
    return { success: true, summary: '已撤銷,影響面復原' };
  } catch (err) {
    return rls(err);
  }
}

// ──────────────────────────────────────────────────────────────
// Tool 註冊 declaration (給 aiToolRegistry / aiAgentTools 用)
// ──────────────────────────────────────────────────────────────

/**
 * 所有工具的 schema 描述 — 給 LLM function calling 用。
 * 每個工具同時帶有 kind / risk / affects / capabilityHint,
 * 讓 aiAgentRuntime.plan() 能正確估算影響面與護欄。
 */
export const LMS_V2_TOOL_DECLARATIONS = [
  // STUDENT
  { name: 'submitAssignmentDraft', kind: 'write', risk: 'low', affects: ['self'], capabilityHint: 'student' },
  { name: 'submitAssignmentFinal', kind: 'write', risk: 'medium', affects: ['self', 'teacher'], capabilityHint: 'student' },
  { name: 'startQuizAttempt', kind: 'write', risk: 'low', affects: ['self'], capabilityHint: 'student' },
  { name: 'answerQuizQuestion', kind: 'write', risk: 'low', affects: ['self'], capabilityHint: 'student' },
  { name: 'submitQuizAttempt', kind: 'write', risk: 'medium', affects: ['self', 'teacher'], capabilityHint: 'student' },
  { name: 'postForumReply', kind: 'write', risk: 'medium', affects: ['public_in_course'], capabilityHint: 'student' },
  { name: 'checkInLive', kind: 'write', risk: 'low', affects: ['self', 'teacher'], capabilityHint: 'student' },
  { name: 'submitPeerReview', kind: 'write', risk: 'medium', affects: ['reviewed_student'], capabilityHint: 'student' },
  { name: 'submitSurveyAnswer', kind: 'write', risk: 'low', affects: ['self'], capabilityHint: 'student' },
  // TEACHER / TA
  { name: 'createAssignment', kind: 'cross_role_write', risk: 'medium', affects: ['all_students_in_course'], capabilityHint: 'assignments.author' },
  { name: 'gradeSubmission', kind: 'cross_role_write', risk: 'medium', affects: ['the_student'], capabilityHint: 'assignments.grade' },
  { name: 'publishCourseGrade', kind: 'cross_role_write', risk: 'high', affects: ['all_students_in_course'], capabilityHint: 'grades.publish' },
  { name: 'createAnnouncement', kind: 'cross_role_write', risk: 'medium', affects: ['all_students_in_course'], capabilityHint: 'announcements.author' },
  { name: 'publishAnnouncement', kind: 'cross_role_write', risk: 'medium', affects: ['all_students_in_course'], capabilityHint: 'announcements.author' },
  { name: 'moderateForumPost', kind: 'cross_role_write', risk: 'medium', affects: ['post_author'], capabilityHint: 'forum.moderate' },
  { name: 'markAttendance', kind: 'cross_role_write', risk: 'low', affects: ['the_student'], capabilityHint: 'attendance.manage' },
  { name: 'startLiveSession', kind: 'cross_role_write', risk: 'medium', affects: ['all_students_in_course'], capabilityHint: 'live.host' },
  { name: 'endLiveSession', kind: 'write', risk: 'low', affects: ['all_students_in_course'], capabilityHint: 'live.host' },
  { name: 'enrollStudent', kind: 'cross_role_write', risk: 'low', affects: ['the_student'], capabilityHint: 'members.manage' },
  { name: 'grantTACapabilities', kind: 'cross_role_write', risk: 'medium', affects: ['the_ta'], capabilityHint: 'members.manage' },
  // 通用
  { name: 'undoLastWrite', kind: 'write', risk: 'low', affects: ['recent_action'], capabilityHint: 'any' },
] as const;

export type LmsV2ToolName = (typeof LMS_V2_TOOL_DECLARATIONS)[number]['name'];

/**
 * Executor map — 給 aiToolRegistry.executeToolStandard 用
 */
export const LMS_V2_EXECUTORS: Record<LmsV2ToolName, (args: any) => Promise<LmsWriteResult>> = {
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
};
