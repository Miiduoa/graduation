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
 *
 * 發號一定綁一筆訂單（orderId）：只有下單的學生本人或這家店的店員能拿號，
 * 號碼存在訂單上，同一筆訂單重複呼叫回同一個號碼，不會多發。
 */

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../accountLifecycle');
const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { TAIPEI_TIME_ZONE, taipeiDateKey, taipeiDayStart, shiftDateKey } = require('../lib/taipeiDay');

const { writeOrderPatch, writeOrderTransition, identifier } = require('../orderTransitions');
const { normalizeCafeteriaOperatorRecord } = require('../authz');

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

/**
 * 在 transaction 裡算出這家店今天（台灣日期）的下一號。只讀不寫，回傳 write() 讓呼叫端
 * 在讀完其他文件之後再寫（Firestore transaction 要先讀後寫）。
 */
async function readNextSerial(tx, countersRef, vendorId, date) {
  const ref = countersRef.doc(counterDocId(vendorId, date));
  // 台灣日期 D 的 0–8 點落在 UTC D-1，8 點以後落在 UTC D
  const legacyRefs = [shiftDateKey(date, -1), date].map((utcDate) =>
    countersRef.doc(legacyCounterDocId(vendorId, utcDate)),
  );
  const snap = await tx.get(ref);
  // 舊鍵每次都在同一個 transaction 裡讀：換版那一刻還在跑的舊版請求寫進舊鍵，
  // 這邊會因為衝突重跑並讀到新的號碼，不會發出重複的號
  const legacySnaps = [];
  for (const legacyRef of legacyRefs) legacySnaps.push(await tx.get(legacyRef));
  const current = snap.exists ? snap.data() : null;
  const issuedToday =
    current?.date === date && typeof current.nextSerial === 'number' ? current.nextSerial : 0;
  const nextSerial = Math.max(issuedToday, legacySerialForTaipeiDay(legacySnaps, date)) + 1;
  return {
    nextSerial,
    write() {
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
    },
  };
}

async function allocateQueueSerial(db, { schoolId, vendorId, now = new Date() }) {
  const date = taipeiDateKey(now);
  const countersRef = db.collection('schools').doc(schoolId).collection('queueCounters');
  return db.runTransaction(async (tx) => {
    const plan = await readNextSerial(tx, countersRef, vendorId, date);
    plan.write();
    return plan.nextSerial;
  });
}

const CLOSED_ORDER_STATUSES = ['completed', 'cancelled'];

/**
 * 幫一筆訂單拿號碼牌，和 assignQueueNumber 共用同一個計數器（以訂單的 cafeteriaId 為店）。
 * - 訂單已有號碼就直接回那個號碼，不會再發一次。
 * - 系統（actor = 'system'）：createOrder 建單後馬上拿號。
 * - 下單的學生本人：重試拿號。
 * - 這家店在職的店員：按「給號碼」（actor = 'merchant'）；訂單還在待接單時一併接單，不會卡在待接單。
 * - 其他人（別家店、無關的學生）一律擋下，不會多發號。
 * 號碼和狀態同時寫進學校訂單和學生自己的訂單副本，學生畫面會跟著換成真的號碼。
 */
async function assignNumberForOrder(
  db,
  { schoolId, orderId, uid, actor, vendorId = null, now = new Date() },
) {
  const schoolRef = db.collection('schools').doc(schoolId);
  const orderRef = schoolRef.collection('orders').doc(orderId);
  const countersRef = schoolRef.collection('queueCounters');
  const date = taipeiDateKey(now);
  return db.runTransaction(async (tx) => {
    const orderDoc = await tx.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const order = orderDoc.data();
    let cafeteriaId;
    try {
      cafeteriaId = identifier(order.cafeteriaId, 'cafeteriaId');
    } catch {
      throw new HttpsError('failed-precondition', 'Order has no store to number');
    }
    if (vendorId != null && vendorId !== cafeteriaId && vendorId !== order.merchantId)
      throw new HttpsError('permission-denied', 'Order does not belong to this store');
    const isOperator = async () => {
      if (!uid) return false;
      const operator = await tx.get(
        schoolRef.collection('cafeterias').doc(cafeteriaId).collection('operators').doc(uid),
      );
      return operator.exists && normalizeCafeteriaOperatorRecord(operator.data()).status === 'active';
    };
    // 誰可以拿號：系統（建單後）、下單的學生本人、這家店在職的店員。其他人一律擋下
    let role;
    if (actor === 'system') role = 'system';
    else if (actor !== 'merchant' && uid && order.userId === uid) role = 'customer';
    else if (await isOperator()) role = 'merchant';
    else throw new HttpsError('permission-denied', 'Only the buyer or this store can get a number');
    if (typeof order.queueNumber === 'number' && order.queueNumber > 0) {
      if (order.queueStatus !== 'assigned') {
        writeOrderPatch(tx, db, orderRef, schoolId, orderId, order, { queueStatus: 'assigned' });
      }
      return { queueNumber: order.queueNumber, queueStatus: 'assigned', reused: true, status: order.status };
    }
    if (CLOSED_ORDER_STATUSES.includes(order.status))
      throw new HttpsError('failed-precondition', 'Order is already closed');
    const plan = await readNextSerial(tx, countersRef, cafeteriaId, date);
    plan.write();
    const numberPatch = {
      queueNumber: plan.nextSerial,
      queueStatus: 'assigned',
      queueDate: date,
      queueAssignedBy: role,
      queueAssignedAt: FieldValue.serverTimestamp(),
    };
    let status = order.status;
    if (role === 'merchant' && order.status === 'pending') {
      writeOrderTransition(tx, db, orderRef, schoolId, orderId, order, 'confirmed', numberPatch);
      status = 'confirmed';
    } else {
      writeOrderPatch(tx, db, orderRef, schoolId, orderId, order, numberPatch);
    }
    return { queueNumber: plan.nextSerial, queueStatus: 'assigned', reused: false, status };
  });
}

function orderKey(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 160 || text.includes('/'))
    throw new HttpsError('invalid-argument', `Invalid ${name}`);
  return text;
}

/**
 * Cloud Function: assignQueueNumber
 * { schoolId, orderId, vendorId?, as? }
 * 一定要帶 orderId，一筆訂單只會有一個號碼：號碼存在訂單上，重複呼叫回同一個號碼。
 * 店家畫面的「給號碼」帶 as: 'merchant'，走同一條路。
 */
function assignQueueNumberHandler({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    const schoolId = orderKey(request.data?.schoolId, 'schoolId');
    if (request.data?.orderId == null)
      throw new HttpsError('invalid-argument', 'orderId is required');
    const orderId = orderKey(request.data.orderId, 'orderId');
    const vendorId =
      request.data?.vendorId == null ? null : orderKey(request.data.vendorId, 'vendorId');
    const actor = request.data?.as === 'merchant' ? 'merchant' : 'request';
    const result = await assignNumberForOrder(db, { schoolId, orderId, uid, actor, vendorId });
    return { ok: true, serial: result.queueNumber, ...result };
  };
}

module.exports.assignQueueNumber = onCall({ region: REGION }, (request) =>
  assignQueueNumberHandler({ db: getFirestore() })(request),
);

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
module.exports.assignNumberForOrder = assignNumberForOrder;
module.exports.assignQueueNumberHandler = assignQueueNumberHandler;
module.exports.runDailyQueueReset = runDailyQueueReset;
module.exports.counterDocId = counterDocId;
