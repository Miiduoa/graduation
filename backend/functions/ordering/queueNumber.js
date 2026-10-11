'use strict';

/**
 * Cloud Function: assignQueueNumber
 *
 * 每店每日唯一遞增的號碼牌計數器，台灣午夜換日。
 * Firestore path: schools/{schoolId}/queueCounters/{vendorId}__tpe__{台灣日期 YYYY-MM-DD}
 *
 * 舊版用 UTC 日期當鍵（{vendorId}__{YYYY-MM-DD}），台灣早上 8 點才換日。
 * 換版當天，同一個台灣日期可能已經用舊鍵發過號：凌晨 0–8 點記在前一天的 UTC 鍵，
 * 8 點以後記在當天的 UTC 鍵。發號時會一起看這兩個舊鍵裡「今天台灣時間有更新過」的號碼，
 * 從新鍵和舊鍵中最大的那個接著發，同一天不會重號。舊資料不搬，由 dailyQueueReset 清掉；
 * 舊鍵清掉之後讀到的都是不存在的文件，結果不受影響。
 *
 * 用 transaction 保證 atomic increment。
 */

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../accountLifecycle');
const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { TAIPEI_TIME_ZONE, taipeiDateKey, taipeiDayStart, shiftDateKey } = require('../lib/taipeiDay');

const REGION = 'asia-east1';

function counterDocId(vendorId, date) {
  return `${vendorId}__tpe__${date}`;
}

function legacyCounterDocId(vendorId, utcDate) {
  return `${vendorId}__${utcDate}`;
}

function toMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value._seconds === 'number') return value._seconds * 1000;
  return null;
}

/**
 * 舊 UTC 鍵在這個台灣日期已經發到幾號。
 * 只算今天（台灣時間）有更新過的舊鍵；沒有 updatedAt 的保守算進去。
 */
function legacySerialForTaipeiDay(legacySnaps, date) {
  const dayStartMs = taipeiDayStart(date).getTime();
  let max = 0;
  for (const snap of legacySnaps) {
    if (!snap?.exists) continue;
    const data = snap.data() || {};
    if (typeof data.nextSerial !== 'number') continue;
    const updatedMs = toMillis(data.updatedAt);
    if (updatedMs != null && updatedMs < dayStartMs) continue;
    max = Math.max(max, data.nextSerial);
  }
  return max;
}

async function allocateQueueSerial(db, { schoolId, vendorId, now = new Date() }) {
  const date = taipeiDateKey(now);
  const countersRef = db.collection('schools').doc(schoolId).collection('queueCounters');
  const ref = countersRef.doc(counterDocId(vendorId, date));
  // 台灣日期 D 的 0–8 點落在 UTC D-1，8 點以後落在 UTC D
  const legacyRefs = [shiftDateKey(date, -1), date].map((utcDate) =>
    countersRef.doc(legacyCounterDocId(vendorId, utcDate)),
  );

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // 舊鍵每次都在同一個 transaction 裡讀：換版那一刻還在跑的舊版請求寫進舊鍵，
    // 這邊會因為衝突重跑並讀到新的號碼，不會發出重複的號
    const legacySnaps = [];
    for (const legacyRef of legacyRefs) legacySnaps.push(await tx.get(legacyRef));
    const current = snap.exists ? snap.data() : null;
    const issuedToday =
      current?.date === date && typeof current.nextSerial === 'number' ? current.nextSerial : 0;
    const nextSerial = Math.max(issuedToday, legacySerialForTaipeiDay(legacySnaps, date)) + 1;
    tx.set(
      ref,
      {
        vendorId,
        date,
        dayTimeZone: TAIPEI_TIME_ZONE,
        nextSerial,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return nextSerial;
  });
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
  try {
    const serial = await allocateQueueSerial(db, { schoolId, vendorId });
    return { ok: true, serial };
  } catch (err) {
    console.error('[assignQueueNumber] failed:', err);
    throw new HttpsError('internal', 'Failed to assign queue number');
  }
});

/**
 * Cloud Function: dailyQueueReset (scheduled)
 *
 * 每天凌晨 00:05 (Asia/Taipei) 跑，清掉前幾天的計數（避免文件無限累積）。
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');

module.exports.dailyQueueReset = onSchedule(
  {
    schedule: '5 0 * * *',
    timeZone: 'Asia/Taipei',
    region: REGION,
  },
  async () => runDailyQueueReset(getFirestore()),
);

/**
 * 清掉台灣日期比今天早的計數（新鍵、舊 UTC 鍵都清；兩種的 date 欄位都是 YYYY-MM-DD）。
 */
async function runDailyQueueReset(db, now = new Date()) {
  const today = taipeiDateKey(now);
  let totalDeleted = 0;
  const schoolsSnap = await db.collection('schools').get();
  for (const schoolDoc of schoolsSnap.docs) {
    const countersRef = schoolDoc.ref.collection('queueCounters');
    for (let round = 0; round < 20; round += 1) {
      const stale = await countersRef.where('date', '<', today).limit(500).get();
      if (stale.empty) break;
      const batch = db.batch();
      stale.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += stale.size;
      if (stale.size < 500) break;
    }
  }
  console.info(`[dailyQueueReset] deleted ${totalDeleted} counters before ${today}`);
  return totalDeleted;
}

module.exports.allocateQueueSerial = allocateQueueSerial;
module.exports.runDailyQueueReset = runDailyQueueReset;
module.exports.counterDocId = counterDocId;
