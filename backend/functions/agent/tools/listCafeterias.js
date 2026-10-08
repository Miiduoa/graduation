'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { hasCoordinates } = require('../../lib/assistantPois');

const text = (value) => typeof value === 'string' ? value.trim() : '';
const time = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text(value)) ? text(value) : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

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

    const cafeterias = snap.docs.map((doc) => {
      const data = doc.data() || {};
      if (data.schoolId != null && data.schoolId !== schoolId) {
        throw new Error('Cafeteria school does not match the requested school');
      }
      return {
        id: doc.id,
        schoolId,
        name: text(data.name) || doc.id,
        description: text(data.description),
        location: text(data.location),
        openingHours: text(data.openingHours),
        lat: hasCoordinates(data) ? data.lat : null,
        lng: hasCoordinates(data) ? data.lng : null,
        openTime: time(data.openTime),
        closeTime: time(data.closeTime),
        orderingEnabled: data.orderingEnabled === true,
        // The cafeteria producer has no authoritative live opening-status field.
        openNow: null,
        seats: count(data.seats),
        menuPreviewCount: count(data.menuPreviewCount),
      };
    });

    if (input.onlyOpenNow && cafeterias.length) {
      return {
        success: false,
        errorCode: 'opening_status_unavailable',
        errorMessage: '目前無法確認餐廳的即時營業狀態，請查看餐廳公布的營業時間。',
      };
    }

    return { success: true, schoolId, count: cafeterias.length, cafeterias };
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
    '查詢目前學校正式餐廳資料與已公布營業時間。未提供即時營業狀態時會明確回報無法確認；不可將餐廳列表視為可下單或營業中的保證。',
  inputSchema,
  execute,
};
