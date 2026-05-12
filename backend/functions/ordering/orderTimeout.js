'use strict';

/**
 * Scheduled Functions: 訂單超時處理 + 閃購到期清理
 *
 * scheduledOrderTimeoutSweep — 每 5 分鐘跑一次
 *   - pending 超過 10 分鐘 → 自動取消 + push 通知
 *   - preparing 超過 30 分鐘 → push 通知學生 + 警示店家
 *   - ready 超過 20 分鐘 → 標記 NoShow
 *
 * scheduledFlashDealExpiry — 每 10 分鐘跑一次
 *   - 把過期的 flash deals 標記 inactive
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const REGION = 'asia-east1';

const PENDING_TIMEOUT_MIN = 10;
const PREPARING_NOTIFY_MIN = 30;
const READY_NO_SHOW_MIN = 20;

function ageMinutes(timestamp) {
  if (!timestamp) return 0;
  let ms;
  if (typeof timestamp.toMillis === 'function') {
    ms = timestamp.toMillis();
  } else if (typeof timestamp.toDate === 'function') {
    ms = timestamp.toDate().getTime();
  } else if (timestamp.seconds) {
    ms = timestamp.seconds * 1000;
  } else if (typeof timestamp === 'string') {
    ms = new Date(timestamp).getTime();
  } else {
    return 0;
  }
  return (Date.now() - ms) / 60000;
}

async function pushToUser(uid, title, body, data = {}) {
  if (!uid) return;
  try {
    const db = getFirestore();
    const tokensSnap = await db
      .collection('users')
      .doc(uid)
      .collection('pushTokens')
      .limit(5)
      .get();
    const tokens = tokensSnap.docs.map((d) => d.data()?.token).filter(Boolean);
    if (tokens.length === 0) return;
    await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
    });
  } catch (err) {
    console.warn('[orderTimeout] push failed:', err);
  }
}

module.exports.scheduledOrderTimeoutSweep = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: REGION,
    timeZone: 'Asia/Taipei',
  },
  async () => {
    const db = getFirestore();
    const schoolsSnap = await db.collection('schools').get();
    let stats = { pendingCancelled: 0, preparingNotified: 0, readyNoShow: 0 };

    for (const schoolDoc of schoolsSnap.docs) {
      const ordersRef = schoolDoc.ref.collection('orders');

      // pending → 自動取消
      const pendingSnap = await ordersRef
        .where('status', '==', 'pending')
        .limit(100)
        .get();
      for (const docSnap of pendingSnap.docs) {
        const order = docSnap.data();
        if (ageMinutes(order.createdAt) <= PENDING_TIMEOUT_MIN) continue;
        try {
          await docSnap.ref.update({
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'system_timeout',
            cancelReasonText: '店家逾時未接單',
          });
          await pushToUser(
            order.userId || order.studentUid,
            '訂單已自動取消',
            '店家逾時未接單，您的訂單已自動取消並退款。',
            { type: 'order', orderId: docSnap.id, channel: 'orders' },
          );
          stats.pendingCancelled += 1;
        } catch (err) {
          console.warn('[orderTimeout] cancel pending failed:', err);
        }
      }

      // preparing → 通知（不取消）
      const preparingSnap = await ordersRef
        .where('status', '==', 'preparing')
        .limit(100)
        .get();
      for (const docSnap of preparingSnap.docs) {
        const order = docSnap.data();
        if (ageMinutes(order.preparingAt || order.confirmedAt || order.createdAt) <= PREPARING_NOTIFY_MIN) continue;
        if (order.timeoutNotified) continue;
        try {
          await docSnap.ref.update({ timeoutNotified: true });
          await pushToUser(
            order.userId || order.studentUid,
            '訂單製作時間較長',
            '您的餐點已製作超過 30 分鐘，如有問題可聯繫店家。',
            { type: 'order', orderId: docSnap.id, channel: 'orders' },
          );
          stats.preparingNotified += 1;
        } catch (err) {
          console.warn('[orderTimeout] notify preparing failed:', err);
        }
      }

      // ready → NoShow
      const readySnap = await ordersRef
        .where('status', '==', 'ready')
        .limit(100)
        .get();
      for (const docSnap of readySnap.docs) {
        const order = docSnap.data();
        if (ageMinutes(order.readyAt || order.completedAt || order.createdAt) <= READY_NO_SHOW_MIN) continue;
        try {
          await docSnap.ref.update({
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'system_no_show',
            cancelReasonText: '學生未於時限內取餐',
          });
          await pushToUser(
            order.userId || order.studentUid,
            '訂單已標記為未取餐',
            '您的餐點已標記為 NoShow，如有疑問請聯繫店家或客服。',
            { type: 'order', orderId: docSnap.id, channel: 'orders' },
          );
          stats.readyNoShow += 1;
        } catch (err) {
          console.warn('[orderTimeout] no-show failed:', err);
        }
      }
    }

    console.info('[orderTimeout] sweep done', stats);
    return null;
  },
);

module.exports.scheduledFlashDealExpiry = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: REGION,
    timeZone: 'Asia/Taipei',
  },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    let total = 0;

    const schoolsSnap = await db.collection('schools').get();
    for (const schoolDoc of schoolsSnap.docs) {
      const dealsRef = schoolDoc.ref.collection('flashDeals');
      const expired = await dealsRef
        .where('expiresAt', '<=', now)
        .where('active', '==', true)
        .limit(200)
        .get();
      if (expired.empty) continue;
      const batch = db.batch();
      expired.docs.forEach((d) => batch.update(d.ref, { active: false }));
      await batch.commit();
      total += expired.size;
    }
    console.info(`[scheduledFlashDealExpiry] expired ${total} deals`);
    return null;
  },
);
