'use strict';

/**
 * Cloud Function: assignQueueNumber
 *
 * 每店每日唯一遞增的號碼牌計數器。
 * Firestore path: schools/{schoolId}/queueCounters/{vendorId}__{YYYY-MM-DD}
 *
 * 用 transaction 保證 atomic increment。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'asia-east1';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

module.exports.assignQueueNumber = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

  const schoolId = String(request.data?.schoolId || '').trim();
  const vendorId = String(request.data?.vendorId || '').trim();
  if (!schoolId || !vendorId) {
    throw new HttpsError('invalid-argument', 'Missing schoolId or vendorId');
  }

  const db = getFirestore();
  const date = todayKey();
  const docId = `${vendorId}__${date}`;
  const ref = db.collection('schools').doc(schoolId).collection('queueCounters').doc(docId);

  try {
    const serial = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      // 跨日：自動視為 nextSerial=1
      const nextSerial =
        current?.date === date && typeof current.nextSerial === 'number'
          ? current.nextSerial + 1
          : 1;
      tx.set(
        ref,
        {
          vendorId,
          date,
          nextSerial,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return nextSerial;
    });
    return { ok: true, serial };
  } catch (err) {
    console.error('[assignQueueNumber] failed:', err);
    throw new HttpsError('internal', 'Failed to assign queue number');
  }
});

/**
 * Cloud Function: dailyQueueReset (scheduled)
 *
 * 每天凌晨 00:05 (Asia/Taipei) 跑，清掉前一日的計數（避免文件無限累積）。
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');

module.exports.dailyQueueReset = onSchedule(
  {
    schedule: '5 0 * * *',
    timeZone: 'Asia/Taipei',
    region: REGION,
  },
  async () => {
    const db = getFirestore();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let totalDeleted = 0;

    // 找出所有 school
    const schoolsSnap = await db.collection('schools').get();
    for (const schoolDoc of schoolsSnap.docs) {
      const countersRef = schoolDoc.ref.collection('queueCounters');
      const stale = await countersRef.where('date', '==', yesterday).limit(500).get();
      if (stale.empty) continue;
      const batch = db.batch();
      stale.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += stale.size;
    }
    console.info(`[dailyQueueReset] deleted ${totalDeleted} counters for ${yesterday}`);
    return null;
  },
);
