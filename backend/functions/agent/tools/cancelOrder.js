'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { createOrderStatusHandlers } = require('../../orderTransitions');

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

  const result = await createOrderStatusHandlers({ db: getFirestore() }).cancelOrder({
    auth: { uid },
    data: {
      schoolId,
      orderId: input.orderId,
      reason: input.reason?.trim() || '使用者取消',
    },
  });
  return { ...result, orderId: input.orderId };
}

module.exports = {
  name: 'cancelOrder',
  description: '幫使用者取消餐廳訂單。需要 orderId。只有 pending/confirmed 狀態的訂單可取消。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
