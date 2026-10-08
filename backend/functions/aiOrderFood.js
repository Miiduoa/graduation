'use strict';

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('./accountLifecycle');
const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});
const { getFirestore } = require('firebase-admin/firestore');
const { createOrderHandler } = require('./createOrder');

module.exports = onCall({ region: 'asia-east1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '請先登入後再確認訂單。');
  const input = request.data || {};
  if (input.userId != null && input.userId !== uid)
    throw new HttpsError('permission-denied', '無法代其他帳號建立訂單。');
  if (
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    typeof input.expectedTotal !== 'number' ||
    !Number.isFinite(input.expectedTotal) ||
    input.expectedTotal < 0 ||
    typeof input.schoolId !== 'string' ||
    !input.schoolId.trim() ||
    typeof input.cafeteriaId !== 'string' ||
    !input.cafeteriaId.trim() ||
    !Array.isArray(input.items) ||
    input.items.length === 0
  ) {
    throw new HttpsError(
      'failed-precondition',
      '缺少已確認的品項、金額或送出編號，這次未建立訂單。請從餐廳頁面重新確認。',
    );
  }
  const result = await createOrderHandler({ db: getFirestore() })({
    auth: { uid },
    data: {
      userId: uid,
      schoolId: input.schoolId,
      cafeteriaId: input.cafeteriaId,
      requestId: input.requestId,
      items: input.items,
      expectedTotal: input.expectedTotal,
      paymentMethod: input.paymentMethod,
      pickupTime: input.pickupTime,
      note: input.note,
      source: 'ai_agent',
    },
  });
  return {
    ...result,
    id: result.orderId,
    orderNo: result.orderId,
    vendorId: result.cafeteriaId,
    vendorName: result.cafeteria,
    merchantName: result.cafeteria,
    ...(result.items.length === 1 ? { itemId: result.items[0].menuItemId } : {}),
    itemName: result.items.map((item) => item.name).join('、'),
    quantity: result.items.reduce((sum, item) => sum + item.quantity, 0),
  };
});
