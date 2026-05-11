'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const inputSchema = z.object({
  dormitory: z.string().min(1),
  room: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  urgency: z.enum(['low', 'normal', 'high']).optional().default('normal'),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('submitRepairRequest requires ctx.uid');
  if (!schoolId) throw new Error('submitRepairRequest requires ctx.schoolId');

  const db = getFirestore();
  const repairRef = await db
    .collection('schools').doc(schoolId).collection('repairRequests').add({
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
