'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const inputSchema = z.object({
  loanId: z.string().min(1),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('returnBook requires ctx.uid');
  if (!schoolId) throw new Error('returnBook requires ctx.schoolId');

  const db = getFirestore();
  const loanRef = db.collection('schools').doc(schoolId).collection('libraryLoans').doc(input.loanId);
  const loanDoc = await loanRef.get();
  if (!loanDoc.exists) throw new Error('找不到此借閱記錄。');

  const loanData = loanDoc.data();
  if (loanData.userId !== uid) throw new Error('這不是您的借閱記錄。');
  if (!['borrowed', 'active'].includes(loanData.status)) throw new Error('此書已歸還或狀態異常。');

  const bookRef = db.collection('schools').doc(schoolId).collection('libraryBooks').doc(loanData.bookId);
  const bookDoc = await bookRef.get();
  const bookData = bookDoc.exists ? bookDoc.data() : {};

  const availUpdate = {};
  if (typeof bookData.availableCopies === 'number') availUpdate.availableCopies = FieldValue.increment(1);
  else availUpdate.available = FieldValue.increment(1);

  const batch = db.batch();
  batch.update(loanRef, { status: 'returned', returnedAt: FieldValue.serverTimestamp() });
  batch.set(
    db.collection('users').doc(uid).collection('schools').doc(schoolId)
      .collection('libraryLoans').doc(input.loanId),
    { userId: uid, schoolId, status: 'returned', returnedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  if (Object.keys(availUpdate).length > 0) batch.update(bookRef, availUpdate);
  await batch.commit();

  return { success: true, bookTitle: loanData.bookTitle || loanData.bookId };
}

module.exports = {
  name: 'returnBook',
  description: '幫使用者歸還圖書館書籍。需要 loanId（借閱記錄 ID）。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
