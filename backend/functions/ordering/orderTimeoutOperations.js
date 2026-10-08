const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { writeOrderTransition, writeOrderPatch } = require('../orderTransitions');

function elapsedMinutes(timestamp, now) {
  let millis;
  if (typeof timestamp?.toMillis === 'function') millis = timestamp.toMillis();
  else if (typeof timestamp?.toDate === 'function') millis = timestamp.toDate().getTime();
  else if (typeof timestamp?.seconds === 'number') millis = timestamp.seconds * 1000;
  else if (typeof timestamp === 'string') millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? (now - millis) / 60000 : null;
}

function createTimeoutOrderProcessor({ db, sendPushToUser, now = Date.now, logger = console }) {
  return async ({ schoolId, orderId, expectedStatus }) => {
    if (!['pending', 'preparing', 'ready'].includes(expectedStatus))
      throw new Error('Unknown timeout status');
    const ref = db.collection('schools').doc(schoolId).collection('orders').doc(orderId);
    const result = await db.runTransaction(async (transaction) => {
      const [snapshot] = await transaction.getAll(ref);
      if (!snapshot.exists) return null;
      const order = snapshot.data();
      if (order.status !== expectedStatus) return null;
      const time =
        expectedStatus === 'pending'
          ? order.createdAt
          : expectedStatus === 'preparing'
            ? order.preparingAt || order.confirmedAt || order.createdAt
            : order.readyAt || order.completedAt || order.createdAt;
      const limit = expectedStatus === 'pending' ? 10 : expectedStatus === 'preparing' ? 30 : 20;
      const age = elapsedMinutes(time, now());
      if (age == null || age <= limit || (expectedStatus === 'preparing' && order.timeoutNotified))
        return null;
      if (expectedStatus === 'preparing') {
        writeOrderPatch(transaction, db, ref, schoolId, orderId, order, {
          timeoutNotified: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        writeOrderTransition(transaction, db, ref, schoolId, orderId, order, 'cancelled', {
          cancelReason: expectedStatus === 'pending' ? 'system_timeout' : 'system_no_show',
          cancelReasonText: expectedStatus === 'pending' ? '店家逾時未接單' : '學生未於時限內取餐',
        });
      }
      return { userId: order.userId };
    });
    if (!result) return { changed: false, notification: { status: 'not_requested' } };
    const notificationContent =
      expectedStatus === 'pending'
        ? { title: '訂單已自動取消', body: '店家逾時未接單，您的訂單已自動取消。' }
        : expectedStatus === 'preparing'
          ? { title: '訂單製作時間較長', body: '您的餐點已製作超過 30 分鐘，如有問題可聯繫店家。' }
          : {
              title: '訂單已標記為未取餐',
              body: '您的餐點已標記為 NoShow，如有疑問請聯繫店家或客服。',
            };
    let notification;
    try {
      notification = (await sendPushToUser(result.userId, notificationContent, {
        type: 'order',
        orderId,
        schoolId,
        channel: 'orders',
      })) ?? { status: 'unconfirmed' };
    } catch {
      logger.warn('Order timeout committed; notification delivery failed', { schoolId, orderId });
      notification = { status: 'failed' };
    }
    return { changed: true, notification };
  };
}

function createOrderTimeoutSweep({ db, sendPushToUser, now = Date.now, logger = console }) {
  const processOrder = createTimeoutOrderProcessor({ db, sendPushToUser, now, logger });
  return async () => {
    const schools = await db.collection('schools').get();
    const stats = { pendingCancelled: 0, preparingNotified: 0, readyNoShow: 0 };
    const counters = {
      pending: 'pendingCancelled',
      preparing: 'preparingNotified',
      ready: 'readyNoShow',
    };
    for (const school of schools.docs) {
      for (const status of ['pending', 'preparing', 'ready']) {
        let cursor;
        while (true) {
          let query = school.ref
            .collection('orders')
            .where('status', '==', status)
            .orderBy(FieldPath.documentId())
            .limit(100);
          if (cursor) query = query.startAfter(cursor);
          const candidates = await query.get();
          for (const candidate of candidates.docs) {
            try {
              const result = await processOrder({
                schoolId: school.id,
                orderId: candidate.id,
                expectedStatus: status,
              });
              if (result.changed) stats[counters[status]] += 1;
            } catch (error) {
              logger.warn('[orderTimeout] transaction failed', {
                schoolId: school.id,
                orderId: candidate.id,
                code: error.code,
              });
            }
          }
          if (candidates.size < 100) break;
          cursor = candidates.docs[candidates.size - 1].id;
        }
      }
    }
    logger.info('[orderTimeout] sweep done', stats);
    return stats;
  };
}

module.exports = { createTimeoutOrderProcessor, createOrderTimeoutSweep };
