'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { getPoiById, isPoiOpenNow } = require('../data/campusPois');

const inputSchema = z.object({
  onlyOpenNow: z.boolean().optional(),
});

async function execute(ctx, rawInput) {
  try {
    const input = inputSchema.parse(rawInput ?? {});
    const schoolId = ctx.schoolId;
    if (!schoolId) {
      return { success: false, errorCode: 'missing_school', errorMessage: 'listCafeterias requires ctx.schoolId' };
    }

    const db = getFirestore();
    const snap = await db.collection('schools').doc(schoolId).collection('cafeterias').get();

    const now = new Date();
    let cafeterias = snap.docs.map((doc) => {
      const data = doc.data() || {};
      // Match POI by cafeteriaId to enrich with lat/lng/floor
      const poi =
        (data.poiId && getPoiById(data.poiId)) ||
        (data.poiId == null
          ? undefined
          : null) ||
        // fall back: try direct id match
        getPoiById(`pu-${doc.id}`);
      return {
        id: doc.id,
        name: data.name || (poi && poi.name) || doc.id,
        description: data.description || (poi && poi.description) || '',
        lat: poi?.lat ?? data.lat ?? null,
        lng: poi?.lng ?? data.lng ?? null,
        openTime: data.openTime || poi?.openTime || null,
        closeTime: data.closeTime || poi?.closeTime || null,
        orderingEnabled: data.orderingEnabled !== false,
        openNow: poi ? isPoiOpenNow(poi, now) : null,
        seats: data.seats ?? null,
        menuPreviewCount: data.menuPreviewCount ?? null,
      };
    });

    if (input.onlyOpenNow) {
      cafeterias = cafeterias.filter((c) => c.openNow !== false && c.orderingEnabled);
    }

    return { success: true, count: cafeterias.length, cafeterias };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.name === 'ZodError' ? 'invalid_input' : 'read_failed',
      errorMessage: String(e?.message || e).slice(0, 300),
    };
  }
}

module.exports = {
  name: 'listCafeterias',
  description:
    '列出校園內可下單的餐廳（含營業狀態、座位）。當使用者問「哪裡可以吃」「現在有開的餐廳」「想點外送」優先呼叫。',
  inputSchema,
  execute,
};
