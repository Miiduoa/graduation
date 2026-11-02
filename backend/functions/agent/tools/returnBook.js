'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor, userServiceGuard } = require('./serviceWriteGuard');

const inputSchema = z.object({ loanId: z.string().min(1).max(128).refine((id) => !id.includes('/')) });

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const loanRef = db.doc(`schools/${schoolId}/libraryLoans/${input.loanId}`);
  const guardRef = userServiceGuard(db, ctx, 'library');
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const [loanDoc] = await Promise.all([tx.get(loanRef), tx.get(guardRef)]);
    if (!loanDoc.exists) throw new HttpsError('not-found', '找不到此借閱紀錄。');
    const loan = loanDoc.data();
    if (loan.userId !== uid) throw new HttpsError('permission-denied', '這不是您的借閱紀錄。');
    if (!['borrowed', 'active'].includes(loan.status)) {
      throw new HttpsError('failed-precondition', '此書已歸還或狀態異常。');
    }
    if (typeof loan.bookId !== 'string' || !loan.bookId || loan.bookId.includes('/')) {
      throw new HttpsError('failed-precondition', '借閱資料不完整，請聯絡管理人員。');
    }
    const bookRef = db.doc(`schools/${schoolId}/libraryBooks/${loan.bookId}`);
    const bookDoc = await tx.get(bookRef);
    if (!bookDoc.exists) throw new HttpsError('failed-precondition', '書籍資料不存在，未變更借閱紀錄。');
    const book = bookDoc.data();
    const availabilityField = typeof book.availableCopies === 'number' ? 'availableCopies' : 'available';
    const available = book[availabilityField];
    if (!Number.isSafeInteger(available) || available < 0 || available === Number.MAX_SAFE_INTEGER) {
      throw new HttpsError('failed-precondition', '書籍庫存資料不完整，未變更借閱紀錄。');
    }
    const returnedAt = FieldValue.serverTimestamp();
    tx.update(loanRef, { status: 'returned', returnedAt });
    // 鏡像可能是舊版或曾被用戶端改動，以伺服器紀錄重建，避免部分更新。
    tx.set(db.doc(`users/${uid}/schools/${schoolId}/libraryLoans/${input.loanId}`), {
      ...loan, userId: uid, schoolId, status: 'returned', returnedAt,
    });
    const availability = { [availabilityField]: available + 1 };
    if (typeof book.availableCopies === 'number' && typeof book.available === 'number') {
      availability.available = available + 1;
    }
    tx.update(bookRef, availability);
    tx.set(guardRef, { updatedAt: FieldValue.serverTimestamp() });
    const bookTitle = typeof loan.bookTitle === 'string' && loan.bookTitle.trim()
      ? loan.bookTitle : loan.bookId;
    return { success: true, bookTitle };
  });
}

module.exports = {
  name: 'returnBook', description: '幫使用者歸還圖書館書籍。需要 loanId（借閱紀錄 ID）。',
  inputSchema, execute, requiresConfirmation: true,
};
