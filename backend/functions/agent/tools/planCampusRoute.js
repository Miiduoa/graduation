'use strict';

const { z } = require('zod');
const { planRouteBetweenPois, searchPois, getPoiById } = require('../data/campusPois');

const inputSchema = z
  .object({
    fromPoiId: z.string().optional(),
    toPoiId: z.string().optional(),
    fromQuery: z.string().min(1).optional(),
    toQuery: z.string().min(1).optional(),
  })
  .refine((v) => (v.fromPoiId || v.fromQuery) && (v.toPoiId || v.toQuery), {
    message: '必須提供 fromPoiId 或 fromQuery，以及 toPoiId 或 toQuery',
  });

function resolvePoi(idOrQuery) {
  if (idOrQuery.id) {
    const poi = getPoiById(idOrQuery.id);
    if (poi) return poi;
  }
  if (idOrQuery.query) {
    const matches = searchPois(idOrQuery.query);
    if (matches.length > 0) return matches[0];
  }
  return null;
}

async function execute(ctx, rawInput) {
  try {
    const input = inputSchema.parse(rawInput ?? {});
    const from = resolvePoi({ id: input.fromPoiId, query: input.fromQuery });
    const to = resolvePoi({ id: input.toPoiId, query: input.toQuery });
    if (!from) {
      return { success: false, errorCode: 'from_not_found', errorMessage: `找不到起點：${input.fromQuery || input.fromPoiId}` };
    }
    if (!to) {
      return { success: false, errorCode: 'to_not_found', errorMessage: `找不到終點：${input.toQuery || input.toPoiId}` };
    }
    const route = planRouteBetweenPois(from.id, to.id);
    if (!route.ok) {
      return { success: false, errorCode: 'route_failed', errorMessage: route.errorMessage || '無法規劃路線' };
    }
    return {
      success: true,
      from: route.from,
      to: route.to,
      distanceMeters: route.distanceMeters,
      walkMinutes: route.walkMinutes,
      polyline: route.polyline,
      steps: route.steps,
      // For UI deep link
      deepLink: {
        web: `/map?route=${encodeURIComponent(from.id)},${encodeURIComponent(to.id)}`,
        mobile: { screen: 'GoogleMapsLike', params: { fromPoiId: from.id, toPoiId: to.id } },
      },
    };
  } catch (e) {
    return {
      success: false,
      errorCode: e?.name === 'ZodError' ? 'invalid_input' : 'plan_failed',
      errorMessage: String(e?.message || e).slice(0, 300),
    };
  }
}

module.exports = {
  name: 'planCampusRoute',
  description:
    '規劃校園內步行路線（A* on 校園路網）。可以用 POI id（fromPoiId/toPoiId）或自然語言（fromQuery/toQuery 例如「校門口」「工程館」）。回傳距離、步行分鐘、polyline 與 turn-by-turn 步驟，並附地圖深連結。當使用者問「怎麼從 A 走到 B」「OO 要怎麼去」「從這裡到 XX 多久」優先呼叫。',
  inputSchema,
  execute,
};
