'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  quantity: z.number().int().min(1),
  note: z.string().optional(),
});

const inputSchema = z.object({
  cafeteriaId: z.string().min(1),
  items: z.array(orderItemSchema).min(1),
  pickupTime: z.string().optional(),
  note: z.string().optional(),
  paymentMethod: z.string().optional().default('campus_card'),
});

async function execute(ctx, rawInput) {
  try {
    if (String(process.env.DEBUG_FORCE_CREATE_ORDER_ERROR || '').trim() === '1') {
      return {
        success: false,
        errorCode: 'debug_forced_failure',
        errorMessage: 'DEBUG_FORCE_CREATE_ORDER_ERROR',
      };
    }

    const input = inputSchema.parse(rawInput ?? {});
    const uid = ctx.uid;
    const schoolId = ctx.schoolId;
    if (!uid) {
      return { success: false, errorCode: 'missing_uid', errorMessage: 'createOrder requires ctx.uid' };
    }
    if (!schoolId) {
      return { success: false, errorCode: 'missing_school', errorMessage: 'createOrder requires ctx.schoolId' };
    }

    const db = getFirestore();

    const cafeteriaRef = db.collection('schools').doc(schoolId).collection('cafeterias').doc(input.cafeteriaId);
    const cafeteriaDoc = await cafeteriaRef.get();
    if (!cafeteriaDoc.exists) {
      return { success: false, errorCode: 'cafeteria_not_found', errorMessage: '找不到此餐廳，請確認餐廳 ID。' };
    }

    const cafeteriaData = cafeteriaDoc.data() || {};
    if (cafeteriaData.orderingEnabled === false) {
      return { success: false, errorCode: 'ordering_disabled', errorMessage: '此餐廳目前暫停接單。' };
    }

    const subtotal = input.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    const orderPayload = {
      userId: uid,
      schoolId,
      source: 'ai_agent',
      cafeteriaId: input.cafeteriaId,
      merchantId: cafeteriaData.merchantId || input.cafeteriaId,
      cafeteria: cafeteriaData.name || input.cafeteriaId,
      items: input.items,
      subtotal,
      tax,
      total,
      totalAmount: total,
      pickupTime: input.pickupTime || null,
      note: input.note || null,
      paymentMethod: input.paymentMethod,
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    };

    const orderRef = db.collection('schools').doc(schoolId).collection('orders').doc();
    const userOrderRef = db
      .collection('users')
      .doc(uid)
      .collection('schools')
      .doc(schoolId)
      .collection('orders')
      .doc(orderRef.id);

    await db.runTransaction(async (tx) => {
      tx.set(orderRef, orderPayload);
      tx.set(userOrderRef, orderPayload);
    });

    const verify = await orderRef.get();
    if (!verify.exists) {
      return {
        success: false,
        errorCode: 'verify_failed',
        errorMessage: 'Order document missing after write',
      };
    }

    return {
      success: true,
      orderId: orderRef.id,
      cafeteria: cafeteriaData.name || input.cafeteriaId,
      total,
      itemCount: input.items.length,
    };
  } catch (e) {
    const isZod = e && typeof e === 'object' && e.name === 'ZodError';
    return {
      success: false,
      errorCode: isZod ? 'invalid_input' : 'write_failed',
      errorMessage: String(e?.message || e).slice(0, 400),
    };
  }
}

module.exports = {
  name: 'createOrder',
  description: '幫使用者向學校餐廳下訂單。需要 cafeteriaId、items 陣列（含 menuItemId、name、price、quantity）。可選 pickupTime 和 note。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
