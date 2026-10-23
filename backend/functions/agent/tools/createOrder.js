'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { createOrderHandler } = require('../../createOrder');

const inputSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  cafeteriaId: z.string().min(1),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(20),
  expectedTotal: z.number().finite().nonnegative(),
  pickupTime: z.string().optional(),
  note: z.string().optional(),
  paymentMethod: z.enum(['onsite', 'campus_card', 'linepay', 'credit_card']).optional(),
});

async function execute(ctx, rawInput) {
  try {
    if (!ctx.uid || !ctx.schoolId) {
      return {
        success: false,
        errorCode: 'permission-denied',
        errorMessage: '請重新確認登入帳號與學校。',
      };
    }
    const input = inputSchema.parse(rawInput ?? {});
    const result = await createOrderHandler({ db: getFirestore() })({
      auth: { uid: ctx.uid },
      data: { ...input, schoolId: ctx.schoolId, source: 'ai_agent' },
    });
    return { ...result, itemCount: result.items.length };
  } catch (error) {
    return {
      success: false,
      errorCode: error?.name === 'ZodError' ? 'invalid_input' : error?.code || 'write_failed',
      errorMessage:
        error?.name === 'ZodError'
          ? '請從餐廳頁面重新確認品項與金額後送出。'
          : String(error?.message || error).slice(0, 400),
      ...(error?.details?.orderOutcome === 'not_created' ? { orderOutcome: 'not_created' } : {}),
    };
  }
}

module.exports = {
  name: 'createOrder',
  description:
    '確認餐廳訂單。必須提供已保存的 requestId、cafeteriaId、品項與數量及使用者確認的 expectedTotal；價格與接單資格由伺服器核對。',
  inputSchema,
  execute,
  requiresConfirmation: true,
};
