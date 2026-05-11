'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const inputSchema = z.object({
  loanId: z.string().min(1),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('renewBook requires ctx.uid');
  if (!schoolId) throw new Error('renewBook requires ctx.schoolId');

  const db = getFirestore();
  const loanRef = db.collection('schools').doc(schoolId).collection('libraryLoans').doc(input.loanId);
  const loanDoc = await loanRef.get();
  if (!loanDoc.exists) throw new Error('找不到此借閱記錄。');

  const loanData = loanDoc.data();
  if (loanData.userId !== uid) throw new Error('這不是您的借閱記錄。');
  if (loanData.renewCount >= 2) throw new Error('您已達最大續借次數（2次）。');

  const newDueDate = loanData.dueAt.toDate();
  newDueDate.setDate(newDueDate.getDate() + 7);

  await loanRef.update({
    dueAt: Timestamp.fromDate(newDueDate),
    renewCount: FieldValue.increment(1),
    lastRenewedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('users').doc(uid).collection('schools').doc(schoolId)
    .collection('libraryLoans').doc(input.loanId).set(
      {
        userId: uid,
        schoolId,
        dueAt: Timestamp.fromDate(newDueDate),
        renewCount: FieldValue.increment(1),
        lastRenewedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return {
    success: true,
    newDueAt: newDueDate.toISOString(),
    renewCount: loanData.renewCount + 1,
  };
}

module.exports = {
  name: 'renewBook',
  description: '幫使用者續借圖書館書籍（最多 2 次，每次延長 7 天）。需要 loanId。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
