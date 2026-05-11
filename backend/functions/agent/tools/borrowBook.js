'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const inputSchema = z.object({
  bookId: z.string().min(1),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('borrowBook requires ctx.uid');
  if (!schoolId) throw new Error('borrowBook requires ctx.schoolId');

  const db = getFirestore();
  const bookRef = db.collection('schools').doc(schoolId).collection('libraryBooks').doc(input.bookId);
  const bookDoc = await bookRef.get();
  if (!bookDoc.exists) throw new Error('找不到這本書。');

  const bookData = bookDoc.data();
  const available = Number(bookData.availableCopies ?? bookData.available ?? 0);
  if (available <= 0) throw new Error('目前無可借閱的庫存，請改天再試。');

  const userLoansSnap = await db
    .collection('schools').doc(schoolId).collection('libraryLoans')
    .where('userId', '==', uid)
    .where('status', 'in', ['borrowed', 'active'])
    .get();
  if (userLoansSnap.size >= 10) throw new Error('您已達借閱上限（10本）。');

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  const loanRef = db.collection('schools').doc(schoolId).collection('libraryLoans').doc();
  const scopedLoanRef = db.collection('users').doc(uid).collection('schools').doc(schoolId)
    .collection('libraryLoans').doc(loanRef.id);

  const payload = {
    userId: uid,
    schoolId,
    bookId: input.bookId,
    bookTitle: bookData.title || null,
    borrowedAt: FieldValue.serverTimestamp(),
    dueAt: Timestamp.fromDate(dueDate),
    status: 'borrowed',
    renewCount: 0,
  };

  const batch = db.batch();
  batch.set(loanRef, payload);
  batch.set(scopedLoanRef, payload);

  const availUpdate = {};
  if (typeof bookData.availableCopies === 'number') availUpdate.availableCopies = FieldValue.increment(-1);
  else availUpdate.available = FieldValue.increment(-1);
  batch.update(bookRef, availUpdate);

  await batch.commit();

  return {
    loanId: loanRef.id,
    bookTitle: bookData.title || input.bookId,
    dueAt: dueDate.toISOString(),
  };
}

module.exports = {
  name: 'borrowBook',
  description: '幫使用者借閱圖書館書籍。需要 bookId。還書期限為 14 天。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
