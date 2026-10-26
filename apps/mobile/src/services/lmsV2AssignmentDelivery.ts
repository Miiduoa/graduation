import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from './supabaseClient';
import { isLmsV2Enabled } from './lmsV2FeatureFlag';
import type { LmsWriteErr, LmsWriteResult } from './lmsV2WriteTools';

export type AssignmentRef = { courseId: string | number; assignmentId: string | number };
export type AssignmentDeviceDraft = { text: string; savedAt: string };

function draftKey(userId: string, ref: AssignmentRef) {
  return `campus:lms:v2:draft:${userId}:${ref.courseId}:${ref.assignmentId}`;
}

function failure(summary: string, errorCode: LmsWriteErr['errorCode'], detail?: string): LmsWriteErr {
  return { success: false, summary, errorCode, detail };
}

function client() {
  return isLmsV2Enabled() ? getSupabaseClient() : null;
}

async function ownDraftIdentity(): Promise<string | null> {
  const sb = client();
  if (!sb) return null;
  // The cached session partitions local drafts; server writes verify identity with getUser.
  try {
    const { data, error } = await sb.auth.getSession();
    return error ? null : (data?.session?.user?.id ?? null);
  } catch {
    return null;
  }
}

export async function readOwnAssignmentDraft(ref: AssignmentRef): Promise<AssignmentDeviceDraft | null> {
  const userId = await ownDraftIdentity();
  if (!userId) return null;
  try {
    const value = await AsyncStorage.getItem(draftKey(userId, ref));
    if (!value) return null;
    const draft = JSON.parse(value) as Partial<AssignmentDeviceDraft>;
    if (!draft || typeof draft.text !== 'string' || typeof draft.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(draft.savedAt))) return null;
    return { text: draft.text, savedAt: draft.savedAt };
  } catch {
    return null;
  }
}

export async function saveAssignmentDeviceDraft(opts: AssignmentRef & {
  contentText?: string;
  attachmentUrls?: string[];
}): Promise<LmsWriteResult> {
  if (!isLmsV2Enabled()) return failure('LMS v2 未啟用', 'flag_off');
  const userId = await ownDraftIdentity();
  if (!userId) return failure('請先登入 LMS，才能儲存個人草稿。', 'no_user');
  if (opts.attachmentUrls?.length) return failure('草稿尚未支援附件，請勿將附件視為已保存。', 'invalid_input');
  const draft: AssignmentDeviceDraft = { text: opts.contentText ?? '', savedAt: new Date().toISOString() };
  try {
    // Server schema has no draft status. Do not turn a draft into a submitted row.
    await AsyncStorage.setItem(draftKey(userId, opts), JSON.stringify(draft));
    return {
      success: true, summary: '草稿已儲存於這台裝置，尚未繳交。',
      data: { localOnly: true, savedAt: draft.savedAt }, is_draft: true, affects: ['self'],
    };
  } catch {
    return failure('裝置草稿儲存失敗，內容尚未保存。', 'supabase_error');
  }
}

export async function deliverAssignmentFinal(opts: AssignmentRef & {
  contentText?: string;
  attachmentUrls?: string[];
}): Promise<LmsWriteResult> {
  if (!isLmsV2Enabled()) return failure('LMS v2 未啟用', 'flag_off');
  const sb = client();
  if (!sb) return failure('LMS 服務尚未連線，無法確認繳交。', 'no_client');
  if (opts.attachmentUrls?.length)
    return failure('附件繳交尚未接通，請勿將附件連結視為已繳交。', 'invalid_input');
  const body = opts.contentText?.trim() ?? '';
  if (!body) return failure('請先填寫作業內容再繳交。', 'invalid_input');

  try {
    const { data: auth, error: authError } = await sb.auth.getUser();
    const userId = auth?.user?.id;
    if (authError || !userId) return failure('登入狀態已失效，請重新登入 LMS。', 'no_user');

    const { data: assignment, error: assignmentError } = await sb.from('assignments')
      .select('id, course_id').eq('id', opts.assignmentId).eq('course_id', opts.courseId).maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return failure('找不到這門課的作業，或目前沒有存取權限。', 'not_found');

    const { data: previous, error: previousError } = await sb.from('submissions')
      .select('id, graded_at').eq('assignment_id', opts.assignmentId).eq('student_id', userId).maybeSingle();
    if (previousError) throw previousError;
    if (previous?.graded_at)
      return failure('這份作業已批改，請先與老師確認重新繳交方式。', 'role_denied');

    const { data: receipt, error: submitError } = await sb.from('submissions')
      .upsert({
        assignment_id: opts.assignmentId,
        student_id: userId,
        body_text: body,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'assignment_id,student_id' })
      .select('id, assignment_id, student_id, body_text, submitted_at').single();
    if (submitError) throw submitError;
    if (!receipt?.id || String(receipt.assignment_id) !== String(opts.assignmentId)
      || receipt.student_id !== userId || receipt.body_text !== body || !receipt.submitted_at) {
      return failure('伺服器尚未回傳可核對的繳交紀錄，請重新讀取確認。', 'supabase_error');
    }

    try { await AsyncStorage.removeItem(draftKey(userId, opts)); } catch {
      // A confirmed submission remains valid even if clearing the local draft fails.
    }
    return {
      success: true,
      summary: '伺服器已確認作業繳交，可查看繳交紀錄。',
      data: { submissionId: receipt.id, submittedAt: receipt.submitted_at },
      affects: ['teacher'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure('繳交尚未確認，請檢查網路並重新查看繳交紀錄。', 
      /permission denied|row-level security|violates rls/i.test(message) ? 'rls_blocked' : 'supabase_error', message);
  }
}
