const nodeCrypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { Timestamp } = require('firebase-admin/firestore');

function identifier(value, name, max = 160) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    value.includes('/') ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new HttpsError('invalid-argument', `Invalid ${name}`);
  }
  return value.trim();
}
function moneyInCents(value) {
  const cents = Math.round(value * 100);
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(cents) ||
    Math.abs(value * 100 - cents) > 0.000001
  ) {
    throw new HttpsError('failed-precondition', '菜單價格尚未完成設定');
  }
  return cents;
}
function normalizeInput(input = {}) {
  const schoolId = identifier(input.schoolId, 'schoolId');
  const cafeteriaId = identifier(input.cafeteriaId, 'cafeteriaId');
  const requestId = identifier(input.requestId ?? input.orderId, 'requestId', 128);
  if (input.requestId != null && input.orderId != null && input.requestId !== input.orderId) {
    throw new HttpsError('invalid-argument', 'Conflicting requestId and orderId');
  }
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 20) {
    throw new HttpsError('invalid-argument', 'Order requires 1 to 20 menu items');
  }
  const quantities = new Map();
  for (const item of input.items) {
    const menuItemId = identifier(item?.menuItemId ?? item?.id, 'menuItemId');
    if (item.menuItemId != null && item.id != null && item.menuItemId !== item.id)
      throw new HttpsError('invalid-argument', 'Conflicting menu item identifiers');
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 99)
      throw new HttpsError('invalid-argument', 'Invalid item quantity');
    const quantity = (quantities.get(menuItemId) || 0) + item.quantity;
    if (quantity > 99) throw new HttpsError('invalid-argument', 'Item quantity exceeds 99');
    quantities.set(menuItemId, quantity);
  }
  const items = [...quantities]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
  const paymentMethod = input.paymentMethod || 'campus_card';
  if (!['onsite', 'campus_card', 'linepay', 'credit_card'].includes(paymentMethod))
    throw new HttpsError('invalid-argument', 'Unsupported payment method');
  const text = (value, max) => {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > max)
      throw new HttpsError('invalid-argument', 'Invalid order note or pickup time');
    return value.trim() || null;
  };
  let expectedTotal = null;
  if (input.expectedTotal != null) {
    try {
      expectedTotal = moneyInCents(input.expectedTotal);
    } catch {
      throw new HttpsError('invalid-argument', 'Invalid expected total');
    }
  }
  return {
    requestId,
    schoolId,
    cafeteriaId,
    items,
    paymentMethod,
    pickupTime: text(input.pickupTime, 100),
    note: text(input.note, 1000),
    expectedTotal,
  };
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  return value;
}
function immutableReceiptDigest(payload) {
  const immutable = [
    'schemaVersion',
    'orderId',
    'requestId',
    'userId',
    'schoolId',
    'cafeteriaId',
    'merchantId',
    'cafeteria',
    'items',
    'subtotal',
    'tax',
    'total',
    'totalAmount',
    'currency',
    'paymentMethod',
    'pickupTime',
    'note',
  ].map((field) => [field, payload[field] ?? null]);
  return nodeCrypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(immutable)))
    .digest('hex');
}
function notCreated(message) {
  return new HttpsError('failed-precondition', message, { orderOutcome: 'not_created' });
}
function receipt(payload, orderId, reused) {
  return {
    success: true,
    reused,
    orderId,
    requestId: payload.requestId,
    userId: payload.userId,
    schoolId: payload.schoolId,
    cafeteriaId: payload.cafeteriaId,
    merchantId: payload.merchantId,
    cafeteria: payload.cafeteria,
    items: payload.items,
    subtotal: payload.subtotal,
    tax: payload.tax,
    total: payload.total,
    totalAmount: payload.total,
    currency: payload.currency,
    paymentMethod: payload.paymentMethod,
    paymentStatus: payload.paymentStatus,
    status: payload.status,
  };
}

function createOrderHandler({ db }) {
  return async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    if (request.data?.userId != null && request.data.userId !== uid)
      throw new HttpsError('permission-denied', 'Order belongs to another user');
    const intent = normalizeInput(request.data);
    const { schoolId, cafeteriaId, requestId } = intent;
    const hash = nodeCrypto
      .createHash('sha256')
      .update(`${uid}\u0000${requestId}`, 'utf8')
      .digest('hex');
    const orderId = `co_${hash}`;
    const fingerprint = nodeCrypto
      .createHash('sha256')
      .update(JSON.stringify(intent))
      .digest('hex');
    const schoolRef = db.collection('schools').doc(schoolId);
    const orderRef = schoolRef.collection('orders').doc(orderId);
    const userOrderRef = db
      .collection('users')
      .doc(uid)
      .collection('schools')
      .doc(schoolId)
      .collection('orders')
      .doc(orderId);
    const keyRef = db.collection('_orderRequests').doc(orderId);
    const result = await db.runTransaction(async (transaction) => {
      const [keyDoc, memberDoc, orderDoc, mirrorDoc] = await transaction.getAll(
        keyRef,
        schoolRef.collection('members').doc(uid),
        orderRef,
        userOrderRef,
      );
      if (!memberDoc.exists || memberDoc.data().status !== 'active')
        throw new HttpsError('permission-denied', 'Active school membership required');
      if (keyDoc.exists) {
        const key = keyDoc.data();
        if (key.userId !== uid || key.fingerprint !== fingerprint || key.schoolId !== schoolId)
          throw new HttpsError('already-exists', '此送出編號已用於其他訂單內容');
        if (key.outcome === 'rejected' && !orderDoc.exists && !mirrorDoc.exists)
          return { notCreatedMessage: key.reason };
        if (
          !orderDoc.exists ||
          orderDoc.data().userId !== uid ||
          orderDoc.data().requestId !== requestId ||
          orderDoc.data().schoolId !== schoolId ||
          orderDoc.data().cafeteriaId !== cafeteriaId ||
          immutableReceiptDigest(orderDoc.data()) !== key.receiptDigest
        )
          throw new HttpsError('failed-precondition', '原訂單紀錄需要確認，請勿重新下單');
        transaction.set(userOrderRef, orderDoc.data());
        return receipt(orderDoc.data(), orderId, true);
      }
      if (orderDoc.exists || mirrorDoc.exists)
        throw new HttpsError('already-exists', 'Order identifier already exists');
      try {
        const cafeteriaRef = schoolRef.collection('cafeterias').doc(cafeteriaId);
        const [cafeteriaDoc, ...menus] = await transaction.getAll(
          cafeteriaRef,
          ...intent.items.map((item) => schoolRef.collection('menus').doc(item.menuItemId)),
        );
        if (!cafeteriaDoc.exists) throw notCreated('店家尚未開通接單');
        const cafeteria = cafeteriaDoc.data();
        if (
          cafeteria.orderingEnabled !== true ||
          cafeteria.pilotStatus !== 'live' ||
          (cafeteria.schoolId != null && cafeteria.schoolId !== schoolId) ||
          (cafeteria.currency != null && cafeteria.currency !== 'TWD')
        ) {
          throw notCreated('店家尚未開通接單');
        }
        const operators = await transaction.get(
          cafeteriaRef.collection('operators').where('status', '==', 'active').limit(1),
        );
        if (operators.empty) throw notCreated('店家尚未開通接單');
        const missing = menus.flatMap((menu, index) => (menu.exists ? [] : [index]));
        if (missing.length) {
          const fallback = await transaction.getAll(
            ...missing.map((index) =>
              schoolRef.collection('cafeteriaMenus').doc(intent.items[index].menuItemId),
            ),
          );
          missing.forEach((index, offset) => {
            menus[index] = fallback[offset];
          });
        }
        let subtotalCents = 0;
        const items = intent.items.map((item, index) => {
          const menuDoc = menus[index];
          if (!menuDoc.exists) throw notCreated('餐點尚未開放訂購');
          const menu = menuDoc.data();
          if (
            menu.cafeteriaId !== cafeteriaId ||
            (menu.schoolId != null && menu.schoolId !== schoolId) ||
            menu.available !== true ||
            menu.orderingEnabled !== true ||
            menu.soldOut === true ||
            (menu.currency != null && menu.currency !== 'TWD')
          ) {
            throw notCreated('餐點尚未開放訂購');
          }
          if (typeof menu.name !== 'string' || !menu.name.trim())
            throw notCreated('菜單尚未完成設定');
          let priceCents;
          try {
            priceCents = moneyInCents(menu.price);
          } catch (error) {
            throw notCreated(error.message);
          }
          subtotalCents += priceCents * item.quantity;
          return {
            menuItemId: item.menuItemId,
            name: menu.name,
            price: priceCents / 100,
            quantity: item.quantity,
            amount: (priceCents * item.quantity) / 100,
          };
        });
        if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 100000000)
          throw new HttpsError('invalid-argument', 'Order amount exceeds limit');
        const subtotal = subtotalCents / 100;
        const tax = Math.round(subtotal * 0.05);
        const total = (subtotalCents + tax * 100) / 100;
        if (intent.expectedTotal != null && intent.expectedTotal !== subtotalCents + tax * 100)
          throw notCreated('菜單或金額已變更，請重新確認');
        const payload = {
          schemaVersion: 2,
          orderId,
          requestId,
          userId: uid,
          schoolId,
          cafeteriaId,
          merchantId:
            typeof cafeteria.merchantId === 'string' && cafeteria.merchantId.trim()
              ? cafeteria.merchantId.trim()
              : cafeteriaId,
          cafeteria: typeof cafeteria.name === 'string' ? cafeteria.name : cafeteriaId,
          items,
          subtotal,
          tax,
          total,
          totalAmount: total,
          currency: 'TWD',
          pickupTime: intent.pickupTime,
          note: intent.note,
          paymentMethod: intent.paymentMethod,
          status: 'pending',
          paymentStatus: 'pending',
          createdAt: Timestamp.now(),
          ...(request.data?.source === 'ai_agent' ? { source: 'ai_agent' } : {}),
        };
        transaction.create(orderRef, payload);
        transaction.create(userOrderRef, payload);
        transaction.create(keyRef, {
          userId: uid,
          schoolId,
          orderId,
          requestId,
          fingerprint,
          receiptDigest: immutableReceiptDigest(payload),
        });
        return receipt(payload, orderId, false);
      } catch (error) {
        if (error instanceof HttpsError && error.details?.orderOutcome === 'not_created') {
          transaction.create(keyRef, {
            userId: uid,
            schoolId,
            orderId,
            requestId,
            fingerprint,
            outcome: 'rejected',
            reason: error.message,
          });
          return { notCreatedMessage: error.message };
        }
        throw error;
      }
    });
    if (result.notCreatedMessage) throw notCreated(result.notCreatedMessage);
    return result;
  };
}
module.exports = { createOrderHandler };
