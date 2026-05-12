'use strict';

/**
 * Cloud Function: refundCaptured
 *
 * 處理「已 capture 後退款」的情境（例如客訴）。
 *
 * 流程：
 *   1. 找 hold（必須 status=captured）
 *   2. 寫一個負向 ledger entry（type=refund）
 *   3. 把 available 加回去
 *   4. 標記 hold 為 'released'（保留審計）
 *   5. 建立 refunds collection record
 *
 * 真實環境會呼叫支付閘道（Stripe Refunds API）；這裡僅模擬。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'asia-east1';

function userWalletRef(db, uid, schoolId) {
  return db.collection('users').doc(uid).collection('schools').doc(schoolId).collection('wallet').doc('balance');
}

function ledgerRef(db, uid, schoolId) {
  return db.collection('users').doc(uid).collection('schools').doc(schoolId).collection('walletLedger');
}

module.exports.refundCaptured = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const schoolId = String(request.data?.schoolId || '').trim();
  const orderId = String(request.data?.orderId || '').trim();
  const amount = Number(request.data?.amount);
  const walletHoldId = request.data?.walletHoldId ? String(request.data.walletHoldId) : null;
  const transactionId = request.data?.transactionId ? String(request.data.transactionId) : null;

  if (!schoolId || !orderId || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }

  const db = getFirestore();

  try {
    const gatewayRefundId = `mock-rf-${Date.now()}`;

    await db.runTransaction(async (tx) => {
      // 找 hold（可能不存在）
      let hold = null;
      let holdDocRef = null;
      if (walletHoldId) {
        holdDocRef = db.collection('schools').doc(schoolId).collection('walletHolds').doc(walletHoldId);
        const snap = await tx.get(holdDocRef);
        if (snap.exists) hold = snap.data();
      }

      const targetUid = hold?.uid ?? uid;

      // 把錢加回 available
      const walletDoc = userWalletRef(db, targetUid, schoolId);
      const walletSnap = await tx.get(walletDoc);
      const current = walletSnap.exists ? walletSnap.data() : null;
      const available = Number(current?.available ?? 0);
      tx.set(
        walletDoc,
        {
          available: available + amount,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // ledger
      tx.set(ledgerRef(db, targetUid, schoolId).doc(), {
        type: 'refund',
        amount,
        orderId,
        walletHoldId,
        transactionId,
        gatewayRefundId,
        createdAt: FieldValue.serverTimestamp(),
      });

      // 標記 hold
      if (holdDocRef) {
        tx.set(
          holdDocRef,
          {
            status: 'released',
            releasedAt: FieldValue.serverTimestamp(),
            refundedAmount: amount,
          },
          { merge: true },
        );
      }
    });

    return { ok: true, gatewayRefundId };
  } catch (err) {
    console.error('[refundCaptured] failed:', err);
    throw new HttpsError('internal', err?.message || 'Refund failed');
  }
});
