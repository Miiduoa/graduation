'use strict';

const { z } = require('zod');
const { readAssistantPois, hasCoordinates, resolvePoi, walkingDirectionsUrl } = require('../../lib/assistantPois');

const inputSchema = z.object({
  fromPoiId: z.string().min(1).optional(),
  toPoiId: z.string().min(1).optional(),
  fromQuery: z.string().min(1).max(80).optional(),
  toQuery: z.string().min(1).max(80).optional(),
}).refine((value) => (value.fromPoiId || value.fromQuery) && (value.toPoiId || value.toQuery), {
  message: '請提供起點與終點。',
});

async function execute(ctx, rawInput) {
  try {
    const input = inputSchema.parse(rawInput ?? {});
    if (!ctx.schoolId) return { success: false, errorCode: 'missing_school', errorMessage: '請先選擇學校。' };
    const pois = await readAssistantPois(ctx.schoolId);
    const fromResult = resolvePoi(pois, input.fromPoiId, input.fromQuery);
    const toResult = resolvePoi(pois, input.toPoiId, input.toQuery);
    if (fromResult.ambiguous || toResult.ambiguous) {
      return { success: false, errorCode: 'ambiguous_location', errorMessage: '找到多個符合的地點，請提供完整名稱或先選擇地點。' };
    }
    const from = fromResult.poi;
    const to = toResult.poi;
    if (!from || !to) {
      return { success: false, errorCode: !from ? 'from_not_found' : 'to_not_found', errorMessage: '在目前學校的正式地點資料中找不到起點或終點，請重新選擇。' };
    }
    if (from.id === to.id) return { success: false, errorCode: 'same_location', errorMessage: '起點與終點相同，請選擇不同地點。' };
    if (!hasCoordinates(from) || !hasCoordinates(to)) {
      return { success: false, errorCode: 'coordinates_unavailable', errorMessage: '起點或終點尚未提供有效座標，目前無法開啟步行導航。' };
    }
    return {
      success: true, schoolId: ctx.schoolId, from, to,
      navigationUrl: walkingDirectionsUrl(from, to),
      message: '開啟 Google 地圖查詢可通行的步行路線與時間；目前不提供未驗證的距離或估時。',
    };
  } catch (error) {
    return {
      success: false, errorCode: error?.name === 'ZodError' ? 'invalid_input' : 'read_failed',
      errorMessage: error?.name === 'ZodError' ? '請提供起點與終點。' : '目前無法讀取校園地點，請稍後再試。',
    };
  }
}

module.exports = {
  name: 'planCampusRoute',
  description: '使用目前學校正式地點的座標建立 Google 地圖步行導航連結。可提供起終點的 POI id 或名稱；缺少座標或地點不明確時不產生路線，不自行估計距離、時間或通行狀態。',
  inputSchema,
  execute,
};
