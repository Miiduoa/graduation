'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'asia-east1';

function trimString(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

module.exports = onCall(
  {
    region: REGION,
  },
  async (request) => {
    const { userId, schoolId, vendorId, itemId, quantity, note } = request.data || {};
    const uid = request.auth?.uid;

    if (!uid || uid !== userId) {
      throw new HttpsError('permission-denied', '未登入或身分不符');
    }

    const safeSchoolId = trimString(schoolId, 120);
    const safeVendorId = trimString(vendorId, 160);
    const safeItemId = trimString(itemId, 160);
    const safeQuantity = Number.isFinite(Number(quantity)) && Number(quantity) > 0
      ? Math.floor(Number(quantity))
      : 1;
    const safeNote = trimString(note, 1000);

    if (!safeVendorId || !safeItemId) {
      throw new HttpsError('invalid-argument', '缺少 vendorId 或 itemId');
    }

    const db = getFirestore();
    let vendorRef = db.collection('vendors').doc(safeVendorId);
    let vendorSnap = await vendorRef.get();
    let cafeteriaRef = null;
    let cafeteriaSnap = null;

    if (!vendorSnap.exists && safeSchoolId) {
      const directCafeteriaRef = db
        .collection('schools')
        .doc(safeSchoolId)
        .collection('cafeterias')
        .doc(safeVendorId);
      const directCafeteriaSnap = await directCafeteriaRef.get();
      if (directCafeteriaSnap.exists) {
        cafeteriaRef = directCafeteriaRef;
        cafeteriaSnap = directCafeteriaSnap;
      } else {
        const byMerchant = await db
          .collection('schools')
          .doc(safeSchoolId)
          .collection('cafeterias')
          .where('merchantId', '==', safeVendorId)
          .limit(1)
          .get();
        const first = byMerchant.docs[0];
        if (first) {
          cafeteriaRef = first.ref;
          cafeteriaSnap = first;
        }
      }
    }

    if (!vendorSnap.exists && !cafeteriaSnap?.exists) {
      throw new HttpsError('not-found', '找不到餐廳');
    }

    let itemSnap = await vendorRef.collection('menuItems').doc(safeItemId).get();
    if (!itemSnap.exists && cafeteriaRef) {
      itemSnap = await cafeteriaRef.collection('menuItems').doc(safeItemId).get();
    }
    if (!itemSnap.exists && safeSchoolId) {
      itemSnap = await db
        .collection('schools')
        .doc(safeSchoolId)
        .collection('menus')
        .doc(safeItemId)
        .get();
    }
    if (!itemSnap.exists) {
      throw new HttpsError('not-found', '找不到菜單品項');
    }

    const vendor = vendorSnap.exists ? vendorSnap.data() || {} : cafeteriaSnap.data() || {};
    const item = itemSnap.data() || {};
    const orderingEnabled = vendor.orderingEnabled === true || vendor.orderingEnabled == null;
    if (!orderingEnabled) {
      throw new HttpsError('failed-precondition', '餐廳暫停接單');
    }

    const price = Number(item.price || 0);
    const subtotal = Number.isFinite(price) ? price * safeQuantity : 0;
    const orderRef = db.collection('orders').doc();
    const vendorName = trimString(vendor.name || item.vendorName, 160) || '未知餐廳';
    const itemName = trimString(item.name, 160) || '未知品項';
    const orderData = {
      id: orderRef.id,
      orderNo: orderRef.id,
      userId: uid,
      schoolId: safeSchoolId || null,
      vendorId: safeVendorId,
      vendorName,
      merchantId: trimString(vendor.merchantId, 160) || safeVendorId,
      merchantName: vendorName,
      itemId: safeItemId,
      itemName,
      items: [
        {
          menuItemId: safeItemId,
          name: itemName,
          price,
          quantity: safeQuantity,
          note: safeNote || null,
        },
      ],
      quantity: safeQuantity,
      subtotal,
      total: subtotal,
      totalAmount: subtotal,
      note: safeNote || null,
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      source: 'ai_order_food',
    };

    await orderRef.set(orderData);
    return orderData;
  },
);
