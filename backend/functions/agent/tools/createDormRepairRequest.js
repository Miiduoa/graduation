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

/**
 * @returns {Promise<{
 *   success: true,
 *   repairId: string,
 *   requestId: string,
 *   status: string,
 *   dormitory: string,
 *   room: string,
 * } | {
 *   success: false,
 *   errorCode: string,
 *   errorMessage?: string,
 * }>}
 */
async function execute(ctx, rawInput) {
  try {
    if (String(process.env.DEBUG_FORCE_SUBMIT_REPAIR_ERROR || '').trim() === '1') {
      return {
        success: false,
        errorCode: 'debug_forced_failure',
        errorMessage: 'DEBUG_FORCE_SUBMIT_REPAIR_ERROR',
      };
    }

    const input = inputSchema.parse(rawInput ?? {});
    const uid = ctx.uid;
    const schoolId = ctx.schoolId;
    if (!uid) {
      return { success: false, errorCode: 'missing_uid', errorMessage: 'createDormRepairRequest requires ctx.uid' };
    }
    if (!schoolId) {
      return {
        success: false,
        errorCode: 'missing_school',
        errorMessage: 'createDormRepairRequest requires ctx.schoolId',
      };
    }

    const db = getFirestore();
    const repairRef = await db
      .collection('schools')
      .doc(schoolId)
      .collection('repairRequests')
      .add({
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

    const verify = await repairRef.get();
    if (!verify.exists) {
      return {
        success: false,
        errorCode: 'verify_failed',
        errorMessage: 'Repair document missing after write',
      };
    }

    const repairId = repairRef.id;
    return {
      success: true,
      repairId,
      requestId: repairId,
      status: 'pending',
      dormitory: input.dormitory,
      room: input.room,
    };
  } catch (e) {
    const isZod = e && typeof e === 'object' && e.name === 'ZodError';
    return {
      success: false,
      errorCode: isZod ? 'invalid_input' : 'write_failed',
      errorMessage: String(e?.message || e).slice(0, 400),
    };
  }
}

module.exports = {
  name: 'createDormRepairRequest',
  description:
    '幫使用者提交宿舍報修申請。需要宿舍棟名、房號、故障類別（category）、描述。緊急程度可選 low/normal/high。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
