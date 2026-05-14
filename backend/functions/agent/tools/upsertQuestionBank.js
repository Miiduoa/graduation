'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  checkQuestionBankHealth,
} = require('../../../../packages/shared/dist-cjs/lms/questionBank');

/**
 * upsertQuestionBank — 教師建立 / 更新題庫，自動跑健康檢查並回傳警告。
 */

const optionSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  isCorrect: z.boolean().optional(),
});

const entrySchema = z.object({
  id: z.string(),
  type: z.enum(['single_choice', 'multiple_choice', 'short_answer', 'essay', 'true_false']),
  prompt: z.string(),
  points: z.number().optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  options: z.array(optionSchema).optional(),
  acceptableAnswers: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
});

const inputSchema = z.object({
  bankId: z.string(),
  schoolId: z.string(),
  courseSpaceId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  entries: z.array(entrySchema),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');
  if (ctx.role !== 'teacher' && ctx.role !== 'admin') {
    return { success: false, errorCode: 'role_denied', summary: '只有教師或管理員能編輯題庫。' };
  }

  const db = getFirestore();
  const bankRef = db
    .collection('schools')
    .doc(input.schoolId)
    .collection('questionBanks')
    .doc(input.bankId);

  await bankRef.set(
    {
      title: input.title,
      description: input.description ?? '',
      courseSpaceId: input.courseSpaceId ?? null,
      entriesCount: input.entries.length,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.uid,
    },
    { merge: true },
  );

  const batch = db.batch();
  for (const e of input.entries) {
    batch.set(bankRef.collection('questions').doc(e.id), {
      ...e,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  const health = checkQuestionBankHealth({
    id: input.bankId,
    schoolId: input.schoolId,
    title: input.title,
    entries: input.entries,
  });

  return {
    success: true,
    summary: `題庫 ${input.title} 已更新（${input.entries.length} 題）。${
      health.warnings.length ? `警告：${health.warnings.join('；')}` : ''
    }`,
    health,
  };
}

module.exports = {
  name: 'upsertQuestionBank',
  description: '教師建立或更新題庫（含題目）。會自動回傳健康檢查警告。',
  inputSchema,
  execute,
};
