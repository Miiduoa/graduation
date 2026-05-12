'use strict';

/**
 * Cloud Functions: walletHold / walletCapture / walletRelease
 *
 * 對接現有的 wallet collection（users/{uid}/schools/{schoolId}/wallet/balance），
 * 並用 schools/{schoolId}/walletHolds/{holdId} 追蹤每筆 hold 的生命週期。
 *
 * available + pending = 總餘額
 *   - hold:    available - amount, pending + amount
 *   - capture: pending - amount, ledger entry created
 *   - release: available + amount, pending - amount
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'asia-east1';
const DEFAULT_CURRENCY = 'TWD';

function userWalletRef(db, uid, schoolId) {
  return db.collection('users').doc(uid).collection('schools').doc(schoolId).collection('wallet').doc('balance');
}

function holdRef(db, schoolId, holdId) {
  return db.collection('schools').doc(schoolId).collection('walletHolds').doc(holdId);
}

function ledgerRef(db, uid, schoolId) {
  return db.collection('users').doc(uid).collection('schools').doc(schoolId).collection('walletLedger');
}

/** walletHold — 凍結金額 */
module.exports.walletHold = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const schoolId = String(request.data?.schoolId || '').trim();
  const orderId = String(request.data?.orderId || '').trim();
  const amount = Number(request.data?.amount);
  const paymentMethod = String(request.data?.paymentMethod || 'campus_card');

  if (!schoolId || !orderId || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'Missing or invalid fields');
  }

  const db = getFirestore();
  const walletDoc = userWalletRef(db, uid, schoolId);
  const holdId = `hold-${orderId}-${Date.now()}`;
  const newHoldRef = holdRef(db, schoolId, holdId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const walletSnap = await tx.get(walletDoc);
      const current = walletSnap.exists ? walletSnap.data() : null;
      const available = Number(current?.available ?? 0);
      const pending = Number(current?.pending ?? 0);
      const currency = current?.currency || DEFAULT_CURRENCY;

      if (paymentMethod === 'campus_card' && available < amount) {
        return { ok: false, reason: 'insufficient_balance' };
      }

      tx.set(
        walletDoc,
        {
          available: paymentMethod === 'campus_card' ? available - amount : available,
          pending: pending + amount,
          currency,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(newHoldRef, {
        id: holdId,
        uid,
        orderId,
        amount,
        currency,
        paymentMethod,
        status: 'held',
        createdAt: FieldValue.serverTimestamp(),
        capturedAt: null,
        releasedAt: null,
      });

      return { ok: true, holdId };
    });

    return result;
  } catch (err) {
    console.error('[walletHold] failed:', err);
    throw new HttpsError('internal', err?.message || 'Wallet hold failed');
  }
});

/** walletCapture — 實扣 */
module.exports.walletCapture = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const schoolId = String(request.data?.schoolId || '').trim();
  const holdId = String(request.data?.holdId || '').trim();
  if (!schoolId || !holdId) {
    throw new HttpsError('invalid-argument', 'Missing schoolId or holdId');
  }

  const db = getFirestore();
  const ref = holdRef(db, schoolId, holdId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, reason: 'wallet_not_found' };
      const hold = snap.data();
      if (hold.status === 'captured') return { ok: false, reason: 'already_captured' };
      if (hold.status === 'released') return { ok: false, reason: 'already_released' };
      if (hold.status !== 'held') return { ok: false, reason: 'unknown' };

      const walletDoc = userWalletRef(db, hold.uid, schoolId);
      const walletSnap = await tx.get(walletDoc);
      const current = walletSnap.exists ? walletSnap.data() : null;
      const pending = Number(current?.pending ?? 0);

      tx.update(walletDoc, {
        pending: Math.max(0, pending - hold.amount),
        lastUpdated: FieldValue.serverTimestamp(),
      });

      tx.update(ref, {
        status: 'captured',
        capturedAt: FieldValue.serverTimestamp(),
      });

      // ledger
      tx.set(ledgerRef(db, hold.uid, schoolId).doc(), {
        type: 'capture',
        amount: -hold.amount,
        currency: hold.currency || DEFAULT_CURRENCY,
        holdId,
        orderId: hold.orderId,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true };
    });

    return result;
  } catch (err) {
    console.error('[walletCapture] failed:', err);
    throw new HttpsError('internal', err?.message || 'Wallet capture failed');
  }
});

/** walletRelease — 釋放凍結 */
module.exports.walletRelease = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const schoolId = String(request.data?.schoolId || '').trim();
  const holdId = String(request.data?.holdId || '').trim();
  if (!schoolId || !holdId) {
    throw new HttpsError('invalid-argument', 'Missing schoolId or holdId');
  }

  const db = getFirestore();
  const ref = holdRef(db, schoolId, holdId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, reason: 'wallet_not_found' };
      const hold = snap.data();
      if (hold.status === 'released') return { ok: false, reason: 'already_released' };
      if (hold.status === 'captured') return { ok: false, reason: 'already_captured' };
      if (hold.status !== 'held') return { ok: false, reason: 'unknown' };

      const walletDoc = userWalletRef(db, hold.uid, schoolId);
      const walletSnap = await tx.get(walletDoc);
      const current = walletSnap.exists ? walletSnap.data() : null;
      const available = Number(current?.available ?? 0);
      const pending = Number(current?.pending ?? 0);

      tx.set(
        walletDoc,
        {
          available: available + (hold.paymentMethod === 'campus_card' ? hold.amount : 0),
          pending: Math.max(0, pending - hold.amount),
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.update(ref, {
        status: 'released',
        releasedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true };
    });

    return result;
  } catch (err) {
    console.error('[walletRelease] failed:', err);
    throw new HttpsError('internal', err?.message || 'Wallet release failed');
  }
});
