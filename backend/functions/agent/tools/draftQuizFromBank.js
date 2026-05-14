'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  drawQuestionsForQuiz,
} = require('../../../../packages/shared/dist-cjs/lms/questionBank');

/**
 * draftQuizFromBank — 教師從題庫抽題建立一份 quiz draft。
 */

const inputSchema = z.object({
  schoolId: z.string(),
  bankId: z.string(),
  courseSpaceId: z.string(),
  title: z.string(),
  count: z.number().int().min(1).max(50),
  topics: z.array(z.string()).optional(),
  difficultyDistribution: z
    .object({
      1: z.number().min(0).max(1).optional(),
      2: z.number().min(0).max(1).optional(),
      3: z.number().min(0).max(1).optional(),
    })
    .optional(),
  excludeIds: z.array(z.string()).optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');
  if (ctx.role !== 'teacher' && ctx.role !== 'admin') {
    return { success: false, errorCode: 'role_denied', summary: '只有教師或管理員能從題庫建測驗。' };
  }

  const db = getFirestore();
  const bankRef = db
    .collection('schools')
    .doc(input.schoolId)
    .collection('questionBanks')
    .doc(input.bankId);
  const questionsSnap = await bankRef.collection('questions').get();
  const entries = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const drawn = drawQuestionsForQuiz(
    {
      id: input.bankId,
      schoolId: input.schoolId,
      title: input.title,
      entries,
    },
    {
      count: input.count,
      topics: input.topics,
      difficultyDistribution: input.difficultyDistribution,
      excludeIds: new Set(input.excludeIds ?? []),
      seed: Date.now(),
    },
  );

  const quizId = `quiz_${Date.now()}`;
  const quizRef = db
    .collection('schools')
    .doc(input.schoolId)
    .collection('courseSpaces')
    .doc(input.courseSpaceId)
    .collection('quizzes')
    .doc(quizId);

  await quizRef.set({
    title: input.title,
    sourceBankId: input.bankId,
    createdBy: ctx.uid,
    createdAt: FieldValue.serverTimestamp(),
    status: 'draft',
    questionCount: drawn.length,
    points: drawn.reduce((acc, q) => acc + (q.points ?? 1), 0),
  });
  const batch = db.batch();
  for (const q of drawn) {
    batch.set(quizRef.collection('questions').doc(q.id), q);
  }
  await batch.commit();

  return {
    success: true,
    isDraft: true,
    summary: `已從題庫 ${input.bankId} 抽 ${drawn.length} 題建立草稿 ${input.title}。請到測驗管理頁送出。`,
    quizId,
  };
}

module.exports = {
  name: 'draftQuizFromBank',
  description: '教師從題庫抽題建立一份測驗草稿。回傳 quizId。',
  inputSchema,
  execute,
  requiresConfirmation: false,
};
