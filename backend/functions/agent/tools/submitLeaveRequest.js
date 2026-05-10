'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const inputSchema = z.object({
  courseId: z.string().min(1),
  date: z.string().min(1),
  type: z.string().min(1),
});

/**
 * 建立請假申請文件（後端 Admin 寫入）。敏感操作：預設僅在使用者確認後由 executeAgentWrite 或同等路徑呼叫。
 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  if (!uid) {
    throw new Error('submitLeaveRequest requires ctx.uid');
  }

  const db = getFirestore();
  const ref = db.collection('leaveRequests').doc();
  await ref.set({
    uid,
    schoolId: ctx.schoolId ?? null,
    courseId: input.courseId,
    date: input.date,
    type: input.type,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });

  return { requestId: ref.id, status: 'pending' };
}

module.exports = {
  name: 'submitLeaveRequest',
  inputSchema,
  execute,
  /** 為 true 時 runtime prefetch 後不會自動執行，須前端確認後呼叫 executeAgentWrite */
  requiresConfirmation: true,
};
