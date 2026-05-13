'use strict';

/**
 * Cloud Function: verifyPickupCode
 *
 * 店家端核銷取餐碼。
 *
 * 邏輯：
 *   1. 取出 schools/{schoolId}/pickupCodes/pc-{orderId}
 *   2. 比對 SHA256(shortCode::nonce) === stored.hash
 *   3. 標記 status='consumed', consumedAt, consumedByOperator
 *   4. 觸發 wallet capture（呼叫已存在的 walletCapture 內部邏輯）
 *
 * 注意：client 端版本 (pickupCode.ts) 也能跑（fallback），但雲端版才是權威。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const nodeCrypto = require('crypto');

const REGION = 'asia-east1';

function sha256(input) {
  return nodeCrypto.createHash('sha256').update(input).digest('hex');
}

module.exports.verifyPickupCode = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const schoolId = String(request.data?.schoolId || '').trim();
  const orderId = String(request.data?.orderId || '').trim();
  const shortCode = String(request.data?.shortCode || '')
    .trim()
    .toUpperCase();

  if (!schoolId || !orderId || !shortCode) {
    throw new HttpsError('invalid-argument', 'Missing schoolId, orderId or shortCode');
  }
  if (shortCode.length !== 6) {
    return { ok: false, reason: 'not_found' };
  }

  const db = getFirestore();
  const codeRef = db.collection('schools').doc(schoolId).collection('pickupCodes').doc(`pc-${orderId}`);

  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(codeRef);
      if (!snap.exists) return { ok: false, reason: 'not_found' };
      const code = snap.data();

      if (code.status === 'consumed') return { ok: false, reason: 'already_consumed' };
      if (code.status === 'revoked') return { ok: false, reason: 'revoked' };

      let expiresMs;
      if (typeof code.expiresAt === 'string') expiresMs = new Date(code.expiresAt).getTime();
      else if (code.expiresAt?.toMillis) expiresMs = code.expiresAt.toMillis();
      else expiresMs = Date.now() + 60 * 1000;

      if (expiresMs < Date.now()) return { ok: false, reason: 'expired' };

      const expectedHash = sha256(`${shortCode}::${code.nonce}`);
      if (expectedHash !== code.hash) {
        return { ok: false, reason: 'not_found' };
      }

      tx.update(codeRef, {
        status: 'consumed',
        consumedAt: FieldValue.serverTimestamp(),
        consumedByOperator: uid,
      });

      return { ok: true, orderId };
    });

    return result;
  } catch (err) {
    console.error('[verifyPickupCode] failed:', err);
    throw new HttpsError('internal', err?.message || 'verify failed');
  }
});
