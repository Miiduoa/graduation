'use strict';

const { z } = require('zod');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const inputSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().optional(),
});

async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid;
  const schoolId = ctx.schoolId;
  if (!uid) throw new Error('cancelOrder requires ctx.uid');
  if (!schoolId) throw new Error('cancelOrder requires ctx.schoolId');

  const db = getFirestore();
  const orderRef = db.collection('schools').doc(schoolId).collection('orders').doc(input.orderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) throw new Error('找不到此訂單。');

  const order = orderDoc.data();
  if (order.userId !== uid) throw new Error('這不是您的訂單。');
  if (['preparing', 'ready', 'completed'].includes(order.status)) {
    throw new Error(`訂單狀態為「${order.status}」，已無法取消。`);
  }

  const updatePayload = {
    status: 'cancelled',
    cancelledAt: FieldValue.serverTimestamp(),
    cancelReason: input.reason || '使用者取消',
  };

  await orderRef.update(updatePayload);
  await db.collection('users').doc(uid).collection('schools').doc(schoolId)
    .collection('orders').doc(input.orderId).set(
      { ...updatePayload, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

  return { success: true, orderId: input.orderId };
}

module.exports = {
  name: 'cancelOrder',
  description: '幫使用者取消餐廳訂單。需要 orderId。只有 pending/confirmed 狀態的訂單可取消。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
