'use strict';

const { z } = require('zod');
const { readAssistantPois, matchPois } = require('../../lib/assistantPois');

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
    if (!ctx.schoolId) return { success: false, errorCode: 'missing_school', errorMessage: '請先選擇學校。' };
    const limit = input.limit || 5;
    const pois = await readAssistantPois(ctx.schoolId);
    const matches = matchPois(pois, input.query, input.category).slice(0, limit);
    return {
      success: true,
      schoolId: ctx.schoolId,
      query: input.query,
      count: matches.length,
      pois: matches.map((p) => ({
        id: p.id,
        schoolId: p.schoolId,
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
        openNow: null,
        cafeteriaId: p.cafeteriaId || null,
      })),
    };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.name === 'ZodError' ? 'invalid_input' : 'search_failed',
      errorMessage: e?.name === 'ZodError' ? '請輸入要查詢的地點。' : '目前無法讀取校園地點，請稍後再試。',
    };
  }
}

module.exports = {
  name: 'findCampusPoi',
  description:
    '搜尋目前學校正式登錄的建築與設施。可傳名稱、代碼、系所或關鍵字；只回傳來源已有的座標與時間，無法判定即時營業狀態。',
  inputSchema,
  execute,
};
