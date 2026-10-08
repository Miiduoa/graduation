import type { AgentCard, CampusAssistantEnvelope } from './campusAssistantClient';

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const list = (value: unknown) => Array.isArray(value) ? value.slice(0, 20).map(fields) : [];
const coordinates = (value: Fields) =>
  number(value.lat) !== undefined && Math.abs(value.lat as number) <= 90 &&
  number(value.lng) !== undefined && Math.abs(value.lng as number) <= 180;
const place = (value: unknown) => {
  const p = fields(value);
  return { id: encodeURIComponent(text(p.id)), name: text(p.name), code: text(p.code), floor: text(p.floor),
    openTime: text(p.openTime), closeTime: text(p.closeTime), openingHours: text(p.openingHours), openNow: typeof p.openNow === 'boolean' ? p.openNow : null,
    seats: number(p.seats), navigationAvailable: coordinates(p) };
};

function directions(payload: Fields, schoolId: string): Fields | null {
  const from = fields(payload.from);
  const to = fields(payload.to);
  if (!schoolId || payload.schoolId !== schoolId || from.schoolId !== schoolId || to.schoolId !== schoolId ||
      !text(from.id) || !text(to.id) || from.id === to.id || !text(from.name) || !text(to.name) ||
      !coordinates(from) || !coordinates(to)) return null;
  try {
    const url = new URL(text(payload.navigationUrl));
    const expected = new URLSearchParams({
      api: '1', origin: `${from.lat},${from.lng}`,
      destination: `${to.lat},${to.lng}`, travelmode: 'walking',
    });
    if (url.protocol !== 'https:' || url.hostname !== 'www.google.com' || url.port ||
        url.username || url.password || url.pathname !== '/maps/dir/' || url.hash ||
        [...url.searchParams].length !== 4 ||
        [...expected].some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) return null;
    return {
      schoolId,
      from: { id: text(from.id), name: text(from.name), schoolId, lat: from.lat, lng: from.lng },
      to: { id: text(to.id), name: text(to.name), schoolId, lat: to.lat, lng: to.lng },
      navigationUrl: `https://www.google.com/maps/dir/?${expected.toString()}`,
    };
  } catch { return null; }
}

/** The conversation offers information; transactions stay in their own service flow. */
export function readOnlyAssistantCards(value: unknown, schoolId: string): AgentCard[] {
  if (!schoolId || !Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((raw): AgentCard[] => {
    const card = fields(raw);
    const p = fields(card.payload);
    if (card.kind === 'directions_card') {
      const payload = directions(p, schoolId);
      return payload ? [{ kind: 'directions_card', payload }] : [];
    }
    if (card.kind === 'poi_card' || card.kind === 'cafeteria_list_card') {
      const key = card.kind === 'poi_card' ? 'pois' : 'cafeterias';
      if (p.schoolId !== schoolId || list(p[key]).some(item => item.schoolId !== schoolId)) return [];
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
