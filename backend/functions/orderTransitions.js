const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { normalizeCafeteriaOperatorRecord } = require('./authz');

const NEXT_STATUS = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};
const OPEN_STATUSES = Object.keys(NEXT_STATUS);
const TARGET_STATUSES = [...Object.values(NEXT_STATUS), 'cancelled'];

function identifier(value, name) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 160 ||
    value.includes('/') ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new HttpsError('invalid-argument', `Invalid ${name}`);
  }
  return value.trim();
}

function validateOrder(order, schoolId, orderId) {
  if (
    !order ||
    (order.schoolId != null && order.schoolId !== schoolId) ||
    (order.orderId != null && order.orderId !== orderId)
  ) {
    throw new HttpsError('failed-precondition', 'Order identity requires review');
  }
  try {
    identifier(order.userId, 'order owner');
  } catch {
    throw new HttpsError('failed-precondition', 'Order owner requires review');
  }
  if (
    order.userId !== order.userId.trim() ||
    ![...OPEN_STATUSES, 'completed', 'cancelled'].includes(order.status)
  ) {
    throw new HttpsError('failed-precondition', 'Order record requires review');
  }
}

// The canonical receipt is authoritative, including when repairing an old missing/stale mirror.
function writeOrderPatch(transaction, db, orderRef, schoolId, orderId, order, patch) {
  validateOrder(order, schoolId, orderId);
  const mirrorRef = db
    .collection('users')
    .doc(order.userId)
    .collection('schools')
    .doc(schoolId)
    .collection('orders')
    .doc(orderId);
  if (Object.keys(patch).length) transaction.update(orderRef, patch);
  transaction.set(mirrorRef, { ...order, ...patch });
}

function writeOrderTransition(
  transaction,
  db,
  orderRef,
  schoolId,
  orderId,
  order,
  status,
  extra = {},
) {
  if (!TARGET_STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Invalid status');
  validateOrder(order, schoolId, orderId);
  const reused = order.status === status;
  if (
    !reused &&
    !(
      NEXT_STATUS[order.status] === status ||
      (status === 'cancelled' && OPEN_STATUSES.includes(order.status))
    )
  ) {
    throw new HttpsError('failed-precondition', 'Invalid order status transition');
  }
  const timestamp = FieldValue.serverTimestamp();
  writeOrderPatch(
    transaction,
    db,
    orderRef,
    schoolId,
    orderId,
    order,
    reused
      ? {}
      : {
          ...extra,
          status,
          [`${status}At`]: timestamp,
          updatedAt: timestamp,
        },
  );
  return { success: true, status, reused };
}

function activeMembership(snapshot) {
  const membership = snapshot.exists ? snapshot.data() : null;
  // Preserve the existing authz helper's compatibility with legacy memberships without status.
  return membership && (!membership.status || membership.status === 'active') ? membership : null;
}

function createOrderStatusHandlers({ db, sendPushToUser, logger = console }) {
  async function change(request, customerCancellation) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    const input = request.data ?? {};
    const schoolId = identifier(input.schoolId, 'schoolId');
    const orderId = identifier(input.orderId, 'orderId');
    const status = customerCancellation ? 'cancelled' : input.status;
    if (!TARGET_STATUSES.includes(status))
      throw new HttpsError('invalid-argument', 'Invalid status');
    if (
      customerCancellation &&
      input.reason != null &&
      (typeof input.reason !== 'string' || input.reason.length > 1000)
    ) {
      throw new HttpsError('invalid-argument', 'Invalid cancellation reason');
    }
    const schoolRef = db.collection('schools').doc(schoolId);
    const orderRef = schoolRef.collection('orders').doc(orderId);
    const result = await db.runTransaction(async (transaction) => {
      const [orderDoc, membershipDoc] = await transaction.getAll(
        orderRef,
        schoolRef.collection('members').doc(uid),
      );
      if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
      const order = orderDoc.data();
      const membership = activeMembership(membershipDoc);
      if (customerCancellation) {
        if (!membership || order.userId !== uid)
          throw new HttpsError('permission-denied', 'This is not your active school order');
        if (!['pending', 'confirmed', 'cancelled'].includes(order.status))
          throw new HttpsError('failed-precondition', 'Cannot cancel order in this status');
      } else if (!['admin', 'editor'].includes(membership?.role)) {
        let cafeteriaId;
        try {
          cafeteriaId = identifier(order.cafeteriaId, 'cafeteriaId');
        } catch {
          throw new HttpsError(
            'permission-denied',
            'Legacy orders without cafeteriaId are read-only',
          );
        }
        const [operator] = await transaction.getAll(
          schoolRef.collection('cafeterias').doc(cafeteriaId).collection('operators').doc(uid),
        );
        if (
          !operator.exists ||
          normalizeCafeteriaOperatorRecord(operator.data()).status !== 'active'
        ) {
          throw new HttpsError('permission-denied', 'Cafeteria operator access required');
        }
      }
      const transition = writeOrderTransition(
        transaction,
        db,
        orderRef,
        schoolId,
        orderId,
        order,
        status,
        customerCancellation ? { cancelReason: input.reason?.trim() || 'User cancelled' } : {},
      );
      return { ...transition, userId: order.userId };
    });
    let notification = { status: 'not_requested' };
    if (!customerCancellation && !result.reused && ['ready', 'cancelled'].includes(status)) {
      try {
        notification = (await sendPushToUser(
          result.userId,
          {
            title: status === 'ready' ? '🍽️ 餐點已備妥' : '❌ 訂單已取消',
            body: status === 'ready' ? '您的餐點已準備完成，請前往取餐' : '您的訂單已被取消',
          },
          { type: 'order', orderId, schoolId, channel: 'orders' },
        )) ?? { status: 'unconfirmed' };
      } catch {
        logger.warn('Order status committed; notification delivery failed', { schoolId, orderId });
        notification = { status: 'failed' };
      }
    }
    return { success: true, status: result.status, reused: result.reused, notification };
  }
  return {
    updateOrderStatus: (request) => change(request, false),
    cancelOrder: (request) => change(request, true),
  };
}

module.exports = {
  createOrderStatusHandlers,
  writeOrderTransition,
  writeOrderPatch,
  OPEN_STATUSES,
  identifier,
};
