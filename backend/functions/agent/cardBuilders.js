'use strict';

/**
 * Transforms a tool-call trace into UI cards consumed by Web ai-assistant and
 * Mobile AgentCardList. Each card has { kind, payload } and is rendered by the
 * client-side card components.
 *
 * Supported kinds:
 *  - route_card        : 路線規劃結果（步行距離、時間、polyline、turn-by-turn）
 *  - menu_card         : 餐廳菜單（可勾選 → 進入 proposeOrder）
 *  - poi_card          : POI 搜尋結果（含位置、樓層、營業狀態）
 *  - order_draft_card  : 訂單草稿（按下「確認下單」才會真的 createOrder）
 *  - order_submitted   : 訂單已建立（既有 kind，相容 Mobile AgentCards.tsx）
 *  - cafeteria_list_card : 營業中餐廳列表
 *  - navigate          : 一鍵跳轉地圖（既有 kind）
 */
function buildCardsFromToolTrace(trace) {
  if (!Array.isArray(trace) || trace.length === 0) return [];
  const cards = [];
  for (const call of trace) {
    const card = toolCallToCard(call);
    if (card) {
      if (Array.isArray(card)) cards.push(...card);
      else cards.push(card);
    }
  }
  return dedupeCards(cards);
}

function toolCallToCard(call) {
  if (!call || typeof call !== 'object') return null;
  const { name, output } = call;
  if (!output || output.success === false) return null;

  switch (name) {
    case 'planCampusRoute':
      return [
        {
          kind: 'route_card',
          payload: {
            from: output.from,
            to: output.to,
            distanceMeters: output.distanceMeters,
            walkMinutes: output.walkMinutes,
            polyline: output.polyline,
            steps: output.steps,
            deepLink: output.deepLink,
          },
        },
        // Companion navigate card for one-tap-to-map (Mobile)
        {
          kind: 'navigate',
          payload: {
            screen: 'GoogleMapsLike',
            params: { fromPoiId: output.from?.id, toPoiId: output.to?.id },
            reason: `${output.from?.name} → ${output.to?.name}（${output.walkMinutes} 分鐘 / ${output.distanceMeters} 公尺）`,
          },
        },
      ];

    case 'findCampusPoi':
      if (!Array.isArray(output.pois) || output.pois.length === 0) return null;
      return {
        kind: 'poi_card',
        payload: {
          query: output.query,
          pois: output.pois.map((p) => ({
            id: p.id,
            name: p.name,
            code: p.code,
            category: p.category,
            lat: p.lat,
            lng: p.lng,
            floor: p.floor,
            description: p.description,
            departments: p.departments,
            openTime: p.openTime,
            closeTime: p.closeTime,
            openNow: p.openNow,
            cafeteriaId: p.cafeteriaId || null,
          })),
        },
      };

    case 'listCafeterias':
      if (!Array.isArray(output.cafeterias) || output.cafeterias.length === 0) return null;
      return {
        kind: 'cafeteria_list_card',
        payload: { cafeterias: output.cafeterias },
      };

    case 'getCafeteriaMenu':
      if (!Array.isArray(output.items) || output.items.length === 0) return null;
      return {
        kind: 'menu_card',
        payload: {
          cafeteriaId: output.cafeteriaId,
          cafeteriaName: output.cafeteriaName,
          items: output.items,
          orderingEnabled: output.orderingEnabled,
        },
      };

    case 'proposeOrder':
      if (!output.draft) return null;
      return {
        kind: 'order_draft_card',
        payload: {
          ...output.draft,
          unavailable: output.unavailable || [],
          confirmHint: output.confirmHint,
          // Frontend uses this to actually call createOrder via callable function
          confirmAction: {
            functionName: 'createOrder',
            input: {
              cafeteriaId: output.draft.cafeteriaId,
              items: output.draft.items.map((it) => ({
                menuItemId: it.menuItemId,
                name: it.name,
                price: it.price,
                quantity: it.quantity,
                note: it.note,
              })),
              pickupTime: output.draft.pickupTime,
              paymentMethod: output.draft.paymentMethod,
              note: output.draft.note,
            },
          },
        },
      };

    default:
      return null;
  }
}

/**
 * Deduplicate by kind+identity so the LLM doesn't get to render the same
 * card twice from repeated tool calls within a single turn.
 */
function dedupeCards(cards) {
  const seen = new Set();
  const out = [];
  for (const c of cards) {
    const key = `${c.kind}:${identityKey(c)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function identityKey(card) {
  const p = card.payload || {};
  switch (card.kind) {
    case 'route_card':
      return `${p.from?.id}->${p.to?.id}`;
    case 'navigate':
      return `${p.screen}:${p.params?.fromPoiId || ''}->${p.params?.toPoiId || ''}`;
    case 'poi_card':
      return (p.pois || []).map((x) => x.id).join(',');
    case 'menu_card':
      return p.cafeteriaId || '';
    case 'cafeteria_list_card':
      return (p.cafeterias || []).map((x) => x.id).join(',');
    case 'order_draft_card':
      return `${p.cafeteriaId}:${(p.items || []).map((it) => `${it.menuItemId}x${it.quantity}`).join(',')}`;
    default:
      return JSON.stringify(p).slice(0, 80);
  }
}

module.exports = { buildCardsFromToolTrace };
