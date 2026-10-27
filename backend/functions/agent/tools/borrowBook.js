'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor, userServiceGuard } = require('./serviceWriteGuard');

const inputSchema = z.object({ bookId: z.string().min(1).max(128).refine((id) => !id.includes('/')) });

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const bookRef = db.doc(`schools/${schoolId}/libraryBooks/${input.bookId}`);
  const guardRef = userServiceGuard(db, ctx, 'library');
  const loans = db.collection('schools').doc(schoolId).collection('libraryLoans');
  const loanRef = loans.doc();
  const scopedLoanRef = db.doc(`users/${uid}/schools/${schoolId}/libraryLoans/${loanRef.id}`);
  const dueDate = new Date(Date.now() + 14 * 86400000);

  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const [bookDoc, userLoans] = await Promise.all([
      tx.get(bookRef),
      tx.get(loans.where('userId', '==', uid).where('status', 'in', ['borrowed', 'active'])),
      tx.get(guardRef),
    ]);
    if (!bookDoc.exists) throw new HttpsError('not-found', '找不到這本書。');
    const book = bookDoc.data();
    const availabilityField = typeof book.availableCopies === 'number' ? 'availableCopies' : 'available';
    const available = book[availabilityField];
    if (!Number.isSafeInteger(available) || available <= 0) {
      throw new HttpsError('failed-precondition', '目前無可借閱的庫存，請改天再試。');
    }
    if (userLoans.size >= 10) throw new HttpsError('failed-precondition', '您已達借閱上限（10 本）。');
    const payload = {
      userId: uid, schoolId, bookId: input.bookId, bookTitle: book.title || null,
      borrowedAt: FieldValue.serverTimestamp(), dueAt: Timestamp.fromDate(dueDate),
      status: 'borrowed', renewCount: 0,
    };
    tx.create(loanRef, payload);
    tx.set(scopedLoanRef, payload);
    const availability = { [availabilityField]: available - 1 };
    if (typeof book.availableCopies === 'number' && typeof book.available === 'number') {
      availability.available = available - 1;
    }
    tx.update(bookRef, availability);
    tx.set(guardRef, { updatedAt: FieldValue.serverTimestamp() });
    return { loanId: loanRef.id, bookTitle: book.title || input.bookId, dueAt: dueDate.toISOString() };
  });
}

module.exports = {
  name: 'borrowBook',
  description: '幫使用者借閱圖書館書籍。需要 bookId。還書期限為 14 天。',
  inputSchema, execute, requiresConfirmation: true,
};
