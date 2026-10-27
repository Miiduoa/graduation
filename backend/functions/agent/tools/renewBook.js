'use strict';

const { z } = require('zod');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { assertServiceScope, readServiceActor } = require('./serviceWriteGuard');

const inputSchema = z.object({ loanId: z.string().min(1).max(128).refine((id) => !id.includes('/')) });

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  assertServiceScope(ctx);
  const { uid, schoolId } = ctx;
  const db = getFirestore();
  const loanRef = db.doc(`schools/${schoolId}/libraryLoans/${input.loanId}`);
  return db.runTransaction(async (tx) => {
    await readServiceActor(tx, db, ctx);
    const loanDoc = await tx.get(loanRef);
    if (!loanDoc.exists) throw new HttpsError('not-found', '找不到此借閱紀錄。');
    const loan = loanDoc.data();
    if (loan.userId !== uid) throw new HttpsError('permission-denied', '這不是您的借閱紀錄。');
    if (!['borrowed', 'active'].includes(loan.status)) {
      throw new HttpsError('failed-precondition', '此書已歸還或狀態異常。');
    }
    const count = loan.renewCount ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count >= 2) {
      throw new HttpsError('failed-precondition', '您已達最大續借次數，或借閱資料需要核對。');
    }
    const currentDue = loan.dueAt?.toDate?.();
    if (!(currentDue instanceof Date) || !Number.isFinite(currentDue.getTime())) {
      throw new HttpsError('failed-precondition', '借閱期限資料不完整，未變更紀錄。');
    }
    const newDueDate = new Date(currentDue.getTime() + 7 * 86400000);
    const update = {
      dueAt: Timestamp.fromDate(newDueDate), renewCount: count + 1,
      lastRenewedAt: FieldValue.serverTimestamp(),
    };
    tx.update(loanRef, update);
    tx.set(db.doc(`users/${uid}/schools/${schoolId}/libraryLoans/${input.loanId}`), {
      ...loan, userId: uid, schoolId, ...update,
    });
    return { success: true, newDueAt: newDueDate.toISOString(), renewCount: count + 1 };
  });
}

module.exports = {
  name: 'renewBook', description: '幫使用者續借圖書館書籍（最多 2 次，每次延長 7 天）。需要 loanId。',
  inputSchema, execute, requiresConfirmation: true,
};
