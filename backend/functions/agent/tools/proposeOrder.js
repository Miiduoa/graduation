'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');

const itemSchema = z.object({
  menuItemId: z.string().min(1),
  name: z.string().min(1).optional(),
  price: z.number().nonnegative().optional(),
  quantity: z.number().int().min(1).default(1),
  note: z.string().max(100).optional(),
});

const inputSchema = z.object({
  cafeteriaId: z.string().min(1),
  items: z.array(itemSchema).min(1).max(10),
  pickupTime: z.string().max(20).optional(),
  paymentMethod: z.enum(['campus_card', 'tappay', 'linepay', 'cash']).optional().default('campus_card'),
  note: z.string().max(200).optional(),
});

/**
 * Validates a proposed order against Firestore menu data and returns a draft
 * (no write). Frontend renders this as an order_draft card; user explicitly
 * confirms by calling createOrder.
 */
async function execute(ctx, rawInput) {
  try {
    const input = inputSchema.parse(rawInput ?? {});
    const schoolId = ctx.schoolId;
    if (!schoolId) {
      return { success: false, errorCode: 'missing_school', errorMessage: 'proposeOrder requires ctx.schoolId' };
    }

    const db = getFirestore();
    const cafRef = db.collection('schools').doc(schoolId).collection('cafeterias').doc(input.cafeteriaId);
    const cafDoc = await cafRef.get();
    if (!cafDoc.exists) {
      return { success: false, errorCode: 'cafeteria_not_found', errorMessage: `找不到餐廳 ${input.cafeteriaId}` };
    }
    const cafData = cafDoc.data() || {};
    if (cafData.orderingEnabled === false) {
      return { success: false, errorCode: 'ordering_disabled', errorMessage: `${cafData.name || input.cafeteriaId} 暫停接單。` };
    }

    // Resolve each item: look up menuItem in Firestore for canonical name + price + stock
    const resolvedItems = [];
    const unavailable = [];
    for (const it of input.items) {
      const docSnap = await cafRef.collection('menuItems').doc(it.menuItemId).get();
      if (!docSnap.exists) {
        unavailable.push({ menuItemId: it.menuItemId, reason: 'not_found' });
        continue;
      }
      const m = docSnap.data() || {};
      if (m.available === false) {
        unavailable.push({ menuItemId: it.menuItemId, reason: 'unavailable', name: m.name });
        continue;
      }
      if (typeof m.stock === 'number' && m.stock < it.quantity) {
        unavailable.push({ menuItemId: it.menuItemId, reason: 'out_of_stock', name: m.name, stock: m.stock });
        continue;
      }
      resolvedItems.push({
        menuItemId: it.menuItemId,
        name: m.name || it.name || it.menuItemId,
        price: typeof m.price === 'number' ? m.price : (it.price || 0),
        quantity: it.quantity,
        note: it.note,
      });
    }

    if (resolvedItems.length === 0) {
      return {
        success: false,
        errorCode: 'no_items_available',
        errorMessage: '所有品項都不可下單',
        unavailable,
      };
    }

    const subtotal = resolvedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    return {
      success: true,
      draft: {
        cafeteriaId: input.cafeteriaId,
        cafeteriaName: cafData.name || input.cafeteriaId,
        items: resolvedItems,
        subtotal,
        tax,
        total,
        pickupTime: input.pickupTime || null,
        paymentMethod: input.paymentMethod,
        note: input.note || null,
        itemCount: resolvedItems.reduce((n, it) => n + it.quantity, 0),
      },
      unavailable,
      // Helper for AI to message: "請確認下單"
      requiresUserConfirmation: true,
      confirmHint: '請使用者按下「確認下單」按鈕後，系統才會真的建立訂單並扣款（或於取餐時付款）。',
    };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.name === 'ZodError' ? 'invalid_input' : 'propose_failed',
      errorMessage: String(e?.message || e).slice(0, 300),
    };
  }
}

module.exports = {
  name: 'proposeOrder',
  description:
    '草擬一筆校園餐廳訂單（不會真的下單）。先呼叫 getCafeteriaMenu 取得 menuItemId 與 price 後再呼叫此工具。回傳訂單草稿（含小計、稅、總額），UI 會渲染為「確認下單卡片」由使用者確認，確認後才會由系統呼叫 createOrder 寫入。當使用者說「點 X」「我要 X」並且指定了餐廳時優先呼叫。',
  inputSchema,
  execute,
};
