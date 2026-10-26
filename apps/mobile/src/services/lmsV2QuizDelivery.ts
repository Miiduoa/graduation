import { getSupabaseClient } from './supabaseClient';
import { isLmsV2Enabled } from './lmsV2FeatureFlag';
import { quizAnswerInput, quizAnswerPayload, type QuizAnswerInput } from './lmsV2QuizModels';
import type { LmsWriteErr, LmsWriteResult } from './lmsV2WriteTools';

export type LmsQuiz = {
  id: string; course_id: string; title: string; description?: string;
  max_attempts: number; time_limit_seconds: number | null;
  enforce_time_limit: boolean; pool_pick_count: number | null;
};
export type LmsQuizAttempt = {
  id: string; quiz_id: string; student_id: string; attempt_no: number;
  started_at: string; submitted_at: string | null; score: number | null;
  drawn_question_ids: string[] | null;
};
export type LmsQuizQuestion = {
  id: string; quiz_id: string; question_type: string;
  prompt: string; choices: unknown; points: number | null;
};
export type LmsQuizWorkspace = {
  quiz: LmsQuiz;
  attempt: LmsQuizAttempt | null;
  attemptCount: number;
  questions: LmsQuizQuestion[];
  answers: Record<string, QuizAnswerInput>;
};

function fail(message: string, code: LmsWriteErr['errorCode'], error?: unknown): LmsWriteErr {
  const detail = error instanceof Error ? error.message
    : error && typeof error === 'object' && 'message' in error ? String(error.message) : undefined;
  return { success: false, summary: message, errorCode: code, ...(detail ? { detail } : {}) };
}
function readError(error: unknown): LmsWriteErr {
  const text = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const denied = /permission denied|row.level security|violates rls|42501/i.test(text);
  return fail('這次操作尚未取得伺服器確認，請重新讀取作答紀錄。', denied ? 'rls_blocked' : 'supabase_error', error);
}
async function authorized() {
  if (!isLmsV2Enabled()) throw new Error('LMS v2 未啟用');
  const sb = getSupabaseClient();
  if (!sb) throw new Error('LMS 尚未連線');
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user?.id) throw new Error('登入狀態已失效，請重新登入');
  return { sb, userId: String(data.user.id) };
}
function id(value: string | number): string {
  const key = String(value ?? '').trim();
  if (!key) throw new Error('缺少測驗識別碼');
  return key;
}

/** Only reads an authenticated student's own attempts; questions are hidden until an attempt exists. */
export async function loadLmsQuizWorkspace(
  courseId: string | number, quizId: string | number,
): Promise<LmsQuizWorkspace> {
  const { sb, userId } = await authorized();
  const course = id(courseId), quizKey = id(quizId);
  const { data: quiz, error: quizError } = await sb.from('quizzes')
    .select('id,course_id,title,description,max_attempts,time_limit_seconds,enforce_time_limit,pool_pick_count')
    .eq('id', quizKey).eq('course_id', course).maybeSingle();
  if (quizError) throw quizError;
  if (!quiz) throw new Error('找不到這份測驗，或沒有課程權限');
  const { data: attempts, error: attemptError } = await sb.from('quiz_attempts')
    .select('id,quiz_id,student_id,attempt_no,started_at,submitted_at,score,drawn_question_ids')
    .eq('quiz_id', quizKey).eq('student_id', userId)
    .order('attempt_no', { ascending: false }).limit(50);
  if (attemptError) throw attemptError;
  const rows: LmsQuizAttempt[] = attempts ?? [];
  const attempt = rows[0] ?? null;
  if (!attempt || attempt.submitted_at)
    return { quiz, attempt, attemptCount: rows.length, questions: [], answers: {} };
  if (attempt.quiz_id !== quizKey || attempt.student_id !== userId)
    throw new Error('作答紀錄與目前帳號不符');
  const { data: allQuestions, error: questionsError } = await sb.from('quiz_questions')
    .select('id,quiz_id,question_type,prompt,choices,points')
    .eq('quiz_id', quizKey).order('sort_order', { ascending: true }).limit(201);
  if (questionsError) throw questionsError;
  if ((allQuestions ?? []).length > 200) throw new Error('題目過多，無法確認完整試卷');
  const drawn = attempt.drawn_question_ids;
  const questions: LmsQuizQuestion[] = Array.isArray(drawn)
    ? (allQuestions ?? []).filter((q: LmsQuizQuestion) => drawn.includes(q.id))
    : allQuestions ?? [];
  if (Array.isArray(drawn) && questions.length !== drawn.length)
    throw new Error('本次抽題與課程題庫不一致，請聯絡老師');
  const { data: saved, error: answersError } = await sb.from('quiz_answers')
    .select('question_id,answer').eq('attempt_id', attempt.id).limit(201);
  if (answersError) throw answersError;
  if ((saved ?? []).length > 200) throw new Error('無法完整讀取已儲存答案');
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const answers: Record<string, QuizAnswerInput> = {};
  for (const row of saved ?? []) {
    const question = questionById.get(row.question_id);
    if (question) answers[row.question_id] = quizAnswerInput(question.question_type, row.answer);
  }
  return { quiz, attempt, attemptCount: rows.length, questions, answers };
}

/** RPC enforces attempt limit and server-selected question pools. Never start while merely browsing. */
export async function beginLmsQuizAttempt(opts: {
  courseId: string | number; quizId: string | number;
}): Promise<LmsWriteResult> {
  try {
    const workspace = await loadLmsQuizWorkspace(opts.courseId, opts.quizId);
    if (workspace.attempt && !workspace.attempt.submitted_at)
      return { success: true, summary: '恢復上次尚未完成的作答',
        data: { attemptId: workspace.attempt.id, resumed: true } };
    if (workspace.attemptCount >= (workspace.quiz.max_attempts ?? 1))
      return fail('已達這份測驗的作答次數上限', 'over_quota');
    const { sb, userId } = await authorized();
    const { data: attemptId, error } = await sb.rpc('start_quiz_attempt', { p_quiz_id: id(opts.quizId) });
    if (error) return readError(error);
    if (!attemptId) return fail('作答可能已開始，但沒有取得確認碼，請重新讀取', 'supabase_error');
    const { data: receipt, error: receiptError } = await sb.from('quiz_attempts')
      .select('id,quiz_id,student_id,submitted_at').eq('id', attemptId)
      .eq('student_id', userId).maybeSingle();
    if (receiptError) return readError(receiptError);
    if (!receipt || receipt.student_id !== userId || receipt.quiz_id !== String(opts.quizId)
      || receipt.submitted_at)
      return fail('尚未確認作答狀態，請重新讀取，避免重複開始', 'supabase_error');
    return { success: true, summary: '已開始作答',
      data: { attemptId: receipt.id, resumed: false } };
  } catch (error) {
    return readError(error);
  }
}

/** Saves or clears exactly one answer, verifying course, attempt, question and response. */
export async function storeLmsQuizAnswer(opts: {
  attemptId: string | number; questionId: string | number; answer: QuizAnswerInput;
}): Promise<LmsWriteResult> {
  try {
    const { sb, userId } = await authorized();
    const attemptId = id(opts.attemptId), questionId = id(opts.questionId);
    const { data: attempt, error: attemptError } = await sb.from('quiz_attempts')
      .select('id,quiz_id,student_id,submitted_at,drawn_question_ids')
      .eq('id', attemptId).eq('student_id', userId).maybeSingle();
    if (attemptError) return readError(attemptError);
    if (!attempt || attempt.submitted_at) return fail('已交卷或無法存取作答紀錄', 'role_denied');
    const { data: question, error: questionError } = await sb.from('quiz_questions')
      .select('id,quiz_id,question_type,choices').eq('id', questionId)
      .eq('quiz_id', attempt.quiz_id).maybeSingle();
    if (questionError) return readError(questionError);
    if (!question || (Array.isArray(attempt.drawn_question_ids)
      && !attempt.drawn_question_ids.includes(questionId)))
      return fail('這不是本次試卷可作答的題目', 'role_denied');
    let answer: ReturnType<typeof quizAnswerPayload>;
    try { answer = quizAnswerPayload(question.question_type, opts.answer, question.choices); }
    catch (error) { return fail(error instanceof Error ? error.message : '無法辨識答案', 'invalid_input'); }
    if (!answer) {
      const { error } = await sb.from('quiz_answers').delete()
        .eq('attempt_id', attemptId).eq('question_id', questionId);
      if (error) return readError(error);
      const { data: stillThere, error: checkError } = await sb.from('quiz_answers')
        .select('question_id').eq('attempt_id', attemptId).eq('question_id', questionId).maybeSingle();
      if (checkError || stillThere) return fail('無法確認答案已清除', 'supabase_error', checkError);
      return { success: true, summary: '答案已清除' };
    }
    const { data: receipt, error } = await sb.from('quiz_answers')
      .upsert({ attempt_id: attemptId, question_id: questionId, answer },
        { onConflict: 'attempt_id,question_id' })
      .select('attempt_id,question_id,answer').single();
    if (error) return readError(error);
    if (!receipt || String(receipt.attempt_id) !== attemptId
      || String(receipt.question_id) !== questionId
      || JSON.stringify(receipt.answer) !== JSON.stringify(answer))
      return fail('答案未取得伺服器儲存回執', 'supabase_error');
    return { success: true, summary: '答案已儲存' };
  } catch (error) { return readError(error); }
}

/** Server-side scoring/clock and verified persisted receipt, never a client-made score. */
export async function finishLmsQuizAttempt(opts: { attemptId: string | number }): Promise<LmsWriteResult> {
  try {
    const { sb, userId } = await authorized();
    const attemptId = id(opts.attemptId);
    const read = async () => sb.from('quiz_attempts')
      .select('id,quiz_id,student_id,submitted_at,score')
      .eq('id', attemptId).eq('student_id', userId).maybeSingle();
    const before = await read();
    if (before.error) return readError(before.error);
    if (!before.data) return fail('作答紀錄不存在或沒有存取權限', 'not_found');
    if (!before.data.submitted_at) {
      const { error } = await sb.rpc('submit_quiz_attempt', { p_attempt_id: attemptId });
      if (error) return readError(error);
    }
    const after = await read();
    if (after.error) return readError(after.error);
    const receipt = after.data;
    if (!receipt?.submitted_at || receipt.student_id !== userId
      || String(receipt.id) !== attemptId || receipt.quiz_id !== before.data.quiz_id
      || receipt.score === null || !Number.isFinite(Number(receipt.score)))
      return fail('尚未取得完整交卷回執，請重新讀取紀錄', 'supabase_error');
    return {
      success: true, summary: '伺服器已確認交卷；若有申論題，分數仍需教師補評。',
      data: { attemptId, score: Number(receipt.score), submittedAt: receipt.submitted_at },
    };
  } catch (error) { return readError(error); }
}
