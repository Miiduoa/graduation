'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { scoreQuizAttempt } = require('../../../../packages/shared/dist-cjs/lms/quizScoring');

/**
 * submitQuizAttempt — 學生提交測驗作答後：
 *   1. 從 Firestore 讀 quiz + questions
 *   2. 跑 scoreQuizAttempt（純函式，shared package）
 *   3. 結果寫入 users/{uid}/quizAttempts/{quizId} 並回傳
 *
 * 若 needsManualGrading=true，僅寫入 pending；教師後續 applyManualGrade 才會發成績。
 */

const answerSchema = z.object({
  questionId: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
});

const inputSchema = z.object({
  quizId: z.string(),
  courseSpaceId: z.string(),
  answers: z.array(answerSchema).default([]),
  // 留空時為 'cloud-fn'（後端代發），有給時應與 ctx.uid 一致
  submittedBy: z.string().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');
  if (!ctx.schoolId) throw new Error('school_required');

  const db = getFirestore();
  const quizRef = db
    .collection('schools')
    .doc(ctx.schoolId)
    .collection('courseSpaces')
    .doc(input.courseSpaceId)
    .collection('quizzes')
    .doc(input.quizId);

  const quizSnap = await quizRef.get();
  if (!quizSnap.exists) {
    return {
      success: false,
      errorCode: 'not_found',
      summary: '找不到這份測驗。',
    };
  }

  const questionsSnap = await quizRef.collection('questions').get();
  const questions = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const attempt = scoreQuizAttempt(questions, input.answers, {
    submittedAt: new Date().toISOString(),
  });

  await db
    .collection('users')
    .doc(ctx.uid)
    .collection('quizAttempts')
    .doc(input.quizId)
    .set(
      {
        quizId: input.quizId,
        courseSpaceId: input.courseSpaceId,
        schoolId: ctx.schoolId,
        ...attempt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return {
    success: true,
    summary: attempt.needsManualGrading
      ? `已收到作答，自動可評部分得 ${attempt.autoGradedPoints} / ${attempt.totalPoints} 分；申論題待老師人工評分。`
      : `作答完成！得分 ${attempt.earnedPoints} / ${attempt.totalPoints} 分（${attempt.percentage}%）。`,
    attempt,
  };
}

module.exports = {
  name: 'submitQuizAttempt',
  description:
    '提交學生對某一份測驗的作答，自動計分（單選 / 多選 / 是非 / 短答），申論題標記人工評分。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
