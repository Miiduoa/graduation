'use strict';

const { z } = require('zod');
const { searchPois, isPoiOpenNow } = require('../data/campusPois');

const inputSchema = z.object({
  query: z.string().min(1).max(80),
  category: z
    .enum([
      'academic',
      'admin',
      'library',
      'cafeteria',
      'dormitory',
      'sports',
      'parking',
      'convenience',
      'medical',
      'religious',
      'gate',
      'research',
      'other',
    ])
    .optional(),
  limit: z.number().int().min(1).max(10).default(5).optional(),
});

async function execute(ctx, rawInput) {
  try {
    const input = inputSchema.parse(rawInput ?? {});
    const limit = input.limit || 5;
    const matches = searchPois(input.query, input.category).slice(0, limit);
    const now = new Date();
    return {
      success: true,
      query: input.query,
      count: matches.length,
      pois: matches.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        nameEn: p.nameEn,
        category: p.category,
        lat: p.lat,
        lng: p.lng,
        floor: p.floor,
        description: p.description,
        departments: p.departments,
        openTime: p.openTime,
        closeTime: p.closeTime,
        openNow: isPoiOpenNow(p, now),
        cafeteriaId: p.cafeteriaId || null,
      })),
    };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.name === 'ZodError' ? 'invalid_input' : 'search_failed',
      errorMessage: String(e?.message || e).slice(0, 300),
    };
  }
}

module.exports = {
  name: 'findCampusPoi',
  description:
    '在校園地圖找建築/教室/餐廳/設施。傳入 query（中文名稱、代碼如 AK、系所或關鍵字），可選 category 篩選。回傳 POI 含 id、lat/lng、樓層、開放時間、是否營業中。若使用者問「XX 在哪」「找最近的 OO」優先呼叫。',
  inputSchema,
  execute,
};
