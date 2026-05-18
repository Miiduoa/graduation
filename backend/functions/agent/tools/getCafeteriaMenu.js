'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');

const inputSchema = z.object({
  cafeteriaId: z.string().min(1),
  keyword: z.string().min(1).max(40).optional(),
  category: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(50).default(20).optional(),
});

async function execute(ctx, rawInput) {
  try {
    const input = inputSchema.parse(rawInput ?? {});
    const schoolId = ctx.schoolId;
    if (!schoolId) {
      return { success: false, errorCode: 'missing_school', errorMessage: 'getCafeteriaMenu requires ctx.schoolId' };
    }

    const db = getFirestore();
    const cafRef = db.collection('schools').doc(schoolId).collection('cafeterias').doc(input.cafeteriaId);
    const cafDoc = await cafRef.get();
    if (!cafDoc.exists) {
      return { success: false, errorCode: 'cafeteria_not_found', errorMessage: `找不到餐廳 ${input.cafeteriaId}` };
    }
    const cafData = cafDoc.data() || {};

    const menuSnap = await cafRef.collection('menuItems').get();
    let items = menuSnap.docs.map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        menuItemId: doc.id,
        name: d.name || doc.id,
        price: typeof d.price === 'number' ? d.price : 0,
        category: d.category || null,
        description: d.description || '',
        available: d.available !== false,
        stock: typeof d.stock === 'number' ? d.stock : null,
        tags: Array.isArray(d.tags) ? d.tags : [],
        imageUrl: d.imageUrl || null,
      };
    });

    if (input.keyword) {
      const k = input.keyword.toLowerCase();
      items = items.filter(
        (it) =>
          (it.name || '').toLowerCase().includes(k) ||
          (it.description || '').toLowerCase().includes(k) ||
          it.tags.some((t) => String(t).toLowerCase().includes(k)),
      );
    }
    if (input.category) {
      items = items.filter((it) => it.category === input.category);
    }
    items = items.filter((it) => it.available);
    const limit = input.limit || 20;

    return {
      success: true,
      cafeteriaId: input.cafeteriaId,
      cafeteriaName: cafData.name || input.cafeteriaId,
      count: items.length,
      items: items.slice(0, limit),
      orderingEnabled: cafData.orderingEnabled !== false,
    };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.name === 'ZodError' ? 'invalid_input' : 'read_failed',
      errorMessage: String(e?.message || e).slice(0, 300),
    };
  }
}

module.exports = {
  name: 'getCafeteriaMenu',
  description:
    '取得某間校園餐廳的菜單。需先用 listCafeterias 取得 cafeteriaId。可選 keyword（如「雞排」）或 category 篩選。下單前必須先呼叫此工具確認 menuItemId 與 price，再呼叫 createOrder。',
  inputSchema,
  execute,
};
