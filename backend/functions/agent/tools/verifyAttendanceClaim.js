'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  verifyAttendance,
} = require('../../../../packages/shared/dist-cjs/lms/attendanceEngine');

/**
 * verifyAttendanceClaim — server-side 點名驗證
 *
 * 流程：
 *  1. 讀 schools/{schoolId}/courseSpaces/{cid}/attendanceSessions/{sid} 拿 cfg
 *  2. 跑 verifyAttendance(claim, cfg) 純函式
 *  3. 通過 → 寫 records/{uid}；標反作弊 flag 寫 audit
 *  4. 驅動 companion signal + risk radar 重算
 */

const inputSchema = z.object({
  courseId: z.string(),
  sessionId: z.string(),
  claim: z.object({
    claimedAt: z.string().optional(),
    deviceFingerprint: z.string().optional(),
    token: z.string().optional(),
    code: z.string().optional(),
    location: z
      .object({
        lat: z.number(),
        lng: z.number(),
        accuracyMeters: z.number().optional(),
      })
      .optional(),
    selfieSimilarity: z.number().optional(),
  }),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  if (!ctx.uid) throw new Error('auth_required');
  if (!ctx.schoolId) throw new Error('school_required');

  const db = getFirestore();
  const sessionRef = db
    .collection('schools')
    .doc(ctx.schoolId)
    .collection('courseSpaces')
    .doc(input.courseId)
    .collection('attendanceSessions')
    .doc(input.sessionId);

  const snap = await sessionRef.get();
  if (!snap.exists) {
    return { success: false, errorCode: 'not_found', summary: '找不到此點名 session。' };
  }
  const cfg = { sessionId: input.sessionId, courseId: input.courseId, ...snap.data() };
  if (!cfg.method) {
    return {
      success: false,
      errorCode: 'config_error',
      summary: '此 session 未設定點名方式。',
    };
  }

  const claim = {
    uid: ctx.uid,
    claimedAt: input.claim.claimedAt ?? new Date().toISOString(),
    ...input.claim,
  };

  const result = verifyAttendance(claim, cfg);

  // 寫 record
  await sessionRef.collection('records').doc(ctx.uid).set(
    {
      uid: ctx.uid,
      sessionId: input.sessionId,
      status: result.status,
      valid: result.valid,
      flags: result.flags,
      reason: result.reason ?? null,
      method: cfg.method,
      checkedInAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // 反作弊有任何 flag 都寫 audit
  if (result.flags.length > 0) {
    await db.collection('auditLogs').add({
      kind: 'attendance_flag',
      uid: ctx.uid,
      sessionId: input.sessionId,
      courseId: input.courseId,
      flags: result.flags,
      details: result.details ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    success: result.valid,
    summary: result.valid
      ? `簽到完成（${result.status === 'late' ? '遲到' : '準時'}）`
      : `簽到失敗：${result.reason ?? '未知原因'}`,
    status: result.status,
    flags: result.flags,
  };
}

module.exports = {
  name: 'verifyAttendanceClaim',
  description: '驗證學生簽到 claim（QR / 數字 / GPS / 自拍 / multi-factor），server-side 跑同一個 attendanceEngine。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
