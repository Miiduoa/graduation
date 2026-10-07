import type { AgentCard, CampusAssistantEnvelope } from './campusAssistantClient';

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const list = (value: unknown) => Array.isArray(value) ? value.slice(0, 20).map(fields) : [];
const place = (value: unknown) => {
  const p = fields(value);
  return { id: encodeURIComponent(text(p.id)), name: text(p.name), code: text(p.code), floor: text(p.floor),
    openTime: text(p.openTime), closeTime: text(p.closeTime), openNow: typeof p.openNow === 'boolean' ? p.openNow : null,
    seats: number(p.seats) };
};

/** The conversation offers information; transactions stay in their own service flow. */
export function readOnlyAssistantCards(value: unknown): AgentCard[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw): AgentCard[] => {
    const card = fields(raw);
    const p = fields(card.payload);
    if (card.kind === 'route_card') {
      const from = place(p.from);
      const to = place(p.to);
      if (!from.id || !from.name || !to.id || !to.name || number(p.walkMinutes) === undefined || number(p.distanceMeters) === undefined) return [];
      return [{ kind: 'route_card', payload: { from, to, walkMinutes: p.walkMinutes, distanceMeters: p.distanceMeters,
        steps: list(p.steps).map(s => ({ instruction: text(s.instruction) })).filter(s => s.instruction) } }];
    }
    if (card.kind === 'poi_card' || card.kind === 'cafeteria_list_card') {
      const key = card.kind === 'poi_card' ? 'pois' : 'cafeterias';
      const places = list(p[key]).map(place).filter(item => item.id && item.name);
      return places.length ? [{ kind: card.kind, payload: { [key]: places } }] : [];
    }
    if (card.kind === 'menu_card') {
      const items = list(p.items).filter(item => text(item.menuItemId) && text(item.name) && number(item.price) !== undefined)
        .map(item => ({ menuItemId: text(item.menuItemId), name: text(item.name), price: item.price,
          description: text(item.description), category: text(item.category) }));
      return text(p.cafeteriaName) && items.length
        ? [{ kind: 'menu_card', payload: { cafeteriaName: text(p.cafeteriaName), items } }] : [];
    }
    if (card.kind === 'navigate' && p.screen === 'GoogleMapsLike') {
      const params = fields(p.params);
      const fromPoiId = encodeURIComponent(text(params.fromPoiId));
      const toPoiId = encodeURIComponent(text(params.toPoiId));
      return fromPoiId && toPoiId ? [{ kind: 'navigate', payload: { screen: p.screen, params: { fromPoiId, toPoiId }, reason: text(p.reason) } }] : [];
    }
    return [];
  });
}

export function assistantSources(value: unknown): Array<{ url: string; label: string }> {
  const seen = new Set<string>();
  return list(value).flatMap(source => {
    try {
      const url = new URL(text(source.source) || text(source.url));
      if (!['https:', 'http:'].includes(url.protocol) || seen.has(url.href)) return [];
      seen.add(url.href);
      return [{ url: url.href, label: text(source.label) || url.hostname }];
    } catch { return []; }
  });
}

export function assistantSuggestions(envelope: CampusAssistantEnvelope): string[] {
  return Array.isArray(envelope.suggestions)
    ? envelope.suggestions.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 4) : [];
}

export function hasOrderProposal(envelope: CampusAssistantEnvelope): boolean {
  return Array.isArray(envelope.cards) && envelope.cards.some(card => ['order_draft_card', 'order_submitted'].includes(fields(card).kind as string));
}
