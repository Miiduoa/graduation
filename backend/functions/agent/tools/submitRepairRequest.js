'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const inputSchema = z.object({
  dormitory: z.string().min(1),
  room: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1).max(1000),
  urgency: z.enum(['low', 'normal', 'high']).optional().default('normal'),
});

async function execute(ctx, rawInput) {
  // 除錯：在 Functions 環境變數設 DEBUG_FORCE_SUBMIT_REPAIR_ERROR=1 可強制失敗，
  // 用來驗證客戶端／最終模型是否仍宣稱報修成功（勿在正式環境長開）。
  if (String(process.env.DEBUG_FORCE_SUBMIT_REPAIR_ERROR || '').trim() === '1') {
    throw new Error('[DEBUG] submitRepairRequest forced failure (unset DEBUG_FORCE_SUBMIT_REPAIR_ERROR)');
  }

  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('submitRepairRequest requires ctx.uid');
  if (!schoolId) throw new Error('submitRepairRequest requires ctx.schoolId');

  const db = getFirestore();
  const repairRef = await db
    .collection('schools').doc(schoolId).collection('repairRequests').add({
      schoolId,
      userId: uid,
      dormitory: input.dormitory,
      room: input.room,
      category: input.category,
      description: input.description,
      urgency: input.urgency,
      images: [],
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

  return {
    requestId: repairRef.id,
    status: 'pending',
    dormitory: input.dormitory,
    room: input.room,
  };
}

module.exports = {
  name: 'submitRepairRequest',
  description: '幫使用者提交宿舍報修申請。需要宿舍棟名、房號、故障類別（category）、描述。緊急程度可選 low/normal/high。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
