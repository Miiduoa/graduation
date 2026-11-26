'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { isAccountUnavailable } = require('../../accountLifecycle');
const {
  ASSISTANT_PERMISSIONS_DOC_ID,
  normalizeAssistantWritePermissions,
  isAssistantWriteToolAllowed,
  assistantWritePermissionDeniedMessage,
} = require('../../lib/assistantWritePermissions');
const { assertServiceScope } = require('./serviceWriteGuard');

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

    assertServiceScope(ctx);
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const schoolRef = db.collection('schools').doc(schoolId);
    const repairRef = schoolRef.collection('repairRequests').doc();

    // A proposal claim prevents duplicate confirmations; it does not freeze
    // authority. Read the current actor and grant in the same transaction as
    // the memo so a retry also observes revocation before any business write.
    return await db.runTransaction(async (tx) => {
      const [account, member, permission] = await Promise.all([
        tx.get(userRef),
        tx.get(schoolRef.collection('members').doc(uid)),
        tx.get(userRef.collection('settings').doc(ASSISTANT_PERMISSIONS_DOC_ID)),
      ]);
      // Preserve the existing admission semantics for new/legacy profiles.
      if (isAccountUnavailable(account.exists ? account.data() : {})) {
        throw new HttpsError('failed-precondition', '帳號正在刪除或已停用。');
      }
      const membership = member.exists ? member.data() : null;
      if (!membership || (membership.status && membership.status !== 'active')) {
        throw new HttpsError('permission-denied', '請使用目前學校的有效帳號。');
      }
      const permissions = normalizeAssistantWritePermissions(permission.exists ? permission.data() : null);
      if (!isAssistantWriteToolAllowed(permissions, 'createDormRepairRequest')) {
        throw new HttpsError('permission-denied', assistantWritePermissionDeniedMessage('createDormRepairRequest'));
      }

      tx.create(repairRef, {
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

      // The caller receives this receipt only after the transaction commits.
      // An uncertain commit still follows the existing failure path below.
      return {
        success: true,
        repairId: repairRef.id,
        requestId: repairRef.id,
        status: 'pending',
        dormitory: input.dormitory,
        room: input.room,
      };
    });
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
    '幫使用者把宿舍報修存成個人備忘。需要宿舍棟名、房號、故障類別（category）、描述。這不會送到學校。緊急程度可選 low/normal/high。回傳的 repairId 是內部識別，不是校方單號，請勿向使用者說成單號或已送到學校。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
