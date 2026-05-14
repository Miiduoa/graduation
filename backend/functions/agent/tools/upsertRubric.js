'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

/**
 * upsertRubric — 教師建立 / 更新 Rubric。
 */

const levelSchema = z.object({
  id: z.string(),
  label: z.string(),
  points: z.number(),
  description: z.string().optional(),
});

const criterionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  weight: z.number().min(0).max(100),
  levels: z.array(levelSchema).min(2),
});

const inputSchema = z.object({
  schoolId: z.string(),
  courseSpaceId: z.string(),
  rubricId: z.string(),
  title: z.string(),
  maxScore: z.number().optional(),
  criteria: z.array(criterionSchema).min(1),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');
  if (ctx.role !== 'teacher' && ctx.role !== 'admin') {
    return { success: false, errorCode: 'role_denied', summary: '只有教師或管理員能建立 Rubric。' };
  }

  const db = getFirestore();
  const ref = db
    .collection('schools')
    .doc(input.schoolId)
    .collection('courseSpaces')
    .doc(input.courseSpaceId)
    .collection('rubrics')
    .doc(input.rubricId);

  await ref.set(
    {
      title: input.title,
      maxScore: input.maxScore ?? 100,
      criteria: input.criteria,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.uid,
    },
    { merge: true },
  );

  const totalWeight = input.criteria.reduce((acc, c) => acc + c.weight, 0);
  return {
    success: true,
    summary: `Rubric ${input.title} 已儲存（${input.criteria.length} 個評分項，權重總和 ${totalWeight}）`,
    rubricId: input.rubricId,
  };
}

module.exports = {
  name: 'upsertRubric',
  description: '教師建立或更新 Rubric 評分標準。',
  inputSchema,
  execute,
};
