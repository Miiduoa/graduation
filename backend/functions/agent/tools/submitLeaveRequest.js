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
 * teacherUid：若需對應審核教師，須有可靠來源（例如課程／群組文件上的 instructorUid）；現階段不寫入以免誤植。
 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  if (!uid) {
    throw new Error('submitLeaveRequest requires ctx.uid');
  }

  let groupId =
    ctx.groupId != null && String(ctx.groupId).trim() ? String(ctx.groupId).trim() : null;

  const db = getFirestore();
  if (!groupId && input.courseId) {
    const courseSnap = await db
      .collection('users')
      .doc(uid)
      .collection('courses')
      .doc(input.courseId)
      .get();
    if (courseSnap.exists) {
      const cd = courseSnap.data() || {};
      const g = cd.groupId;
      if (g != null && String(g).trim()) {
        groupId = String(g).trim();
      }
    }
  }

  const ref = db.collection('leaveRequests').doc();
  await ref.set({
    uid,
    schoolId: ctx.schoolId ?? null,
    groupId,
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
  description:
    '（僅限使用者確認後由後端代為執行，不開放給 LLM 自動呼叫。）建立一筆待審請假申請。',
  inputSchema,
  execute,
  /** 為 true 時 runtime prefetch 後不會自動執行，須前端確認後呼叫 executeAgentWrite */
  requiresConfirmation: true,
};
