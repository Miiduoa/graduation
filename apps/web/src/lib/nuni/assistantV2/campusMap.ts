import { resolveCampusClassroom } from '@campus/shared/src/campusClassroomLookup';
import { getOfficialCampusMapUrl } from '@campus/shared/src/campusMapLookup';
import {
  isProvidencePendingVerification,
  locationMatchesSearch,
  providencePlaceSourceUrl,
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
  PROVIDENCE_CAMPUS_SOURCE,
  type CampusMapPlaceLike,
} from '@campus/shared/src/providenceCampus';
import { findSchoolById } from '@campus/shared/src/schools';
import { object, V2Error } from './contracts';

export type CampusMapArguments = { query: string; limit: number };
export type CampusMapSource = 'school-pois' | 'legacy-pois' | 'bundled-providence';
export type CampusMapMatch = 'place' | 'building' | 'search';
export type CampusMapItem = CampusMapPlaceLike & {
  schoolId: string;
  facilities: string[];
  source: CampusMapSource;
  sourcePath: string;
  href: string;
  match: CampusMapMatch;
  verification: 'published' | 'cross-checked' | 'single-source';
  sourceUrl?: string;
};
export type CampusMapRead = {
  version: 1;
  kind: 'map';
  schoolId: string;
  query: string;
  limit: number;
  checkedAt: string;
  source: CampusMapSource;
  sourcePath: string;
  status: 'ready' | 'unavailable';
  items: CampusMapItem[];
  partial: boolean;
  resolution: 'matched' | 'candidates' | 'ambiguous' | 'unmatched' | 'partial';
  href: string;
  officialMapUrl?: string;
  unavailable?: 'NOT_CONNECTED' | 'SOURCE_UNAVAILABLE';
};

const unsafeText = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
function clean(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || value !== value.trim() ||
      (!empty && !value) || unsafeText.test(value)) throw new Error('Invalid map text');
  return value;
}
export function validCampusMapSchool(schoolId: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) &&
    !['personal', 'all', 'unavailable-campus', 'tw-demo-uni'].includes(schoolId);
}
function safeId(value: unknown): string {
  const id = clean(value, 200);
  if (id.includes('/') || ['.', '..', '__proto__', 'prototype', 'constructor'].includes(id))
    throw new Error('Invalid map identity');
  return id;
}

/** The bound school never comes from model arguments. */
export function parseCampusMapArguments(raw: unknown): CampusMapArguments {
  try {
    const value = object(raw, ['query', 'limit']);
    if (typeof value.query !== 'string' || unsafeText.test(value.query)) throw new Error('Invalid query');
    const query = clean(value.query.trim(), 120);
    const limit = value.limit ?? 5;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 5) throw new Error('Invalid limit');
    return { query, limit: Number(limit) };
  } catch {
    throw new V2Error(422, 'INVALID_INPUT');
  }
}

export function campusMapHref(schoolId: string, query: string, focus?: string): string {
  const parameters = new URLSearchParams({ schoolId, query });
  if (focus) parameters.set('focus', focus);
  return '/map?' + parameters.toString();
}
export function campusMapSourcePath(schoolId: string, source: CampusMapSource): string {
  return source === 'school-pois' ? `schools/${schoolId}/pois`
    : source === 'legacy-pois' ? 'pois' : 'bundled/providence-campus';
}


const BOUNDED_TRANSIT_STOP_MARKER = ['1'];

/** Classroom matching only needs a yes/no stop marker. Never copy a raw
 * Firestore value into a validated assistant result or the tool summary.
 * Emptiness rules must match the shared resolver: a long array of blank
 * strings is not a stop marker. */
export function boundedTransitStopMarker(place: object): { transitStopIds: string[] } | Record<string, never> {
  if (!Object.prototype.propertyIsEnumerable.call(place, 'transitStopIds')) return {};
  const ids: unknown = (place as { transitStopIds?: unknown }).transitStopIds;
  const hasMarker = typeof ids === 'string'
    ? ids.trim().length > 0
    : Array.isArray(ids)
      ? ids.some((id: unknown) => (typeof id === 'string' ? id.trim().length > 0 : id != null))
      : ids != null;
  return hasMarker ? { transitStopIds: [...BOUNDED_TRANSIT_STOP_MARKER] } : {};
}

function comparable(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, ' ').trim();
}

/** Reuse the map's room-to-building and text matching, without decoding a
 * classroom number into a floor or inventing a route. */
export function campusMapMatchDetails(
  schoolId: string, query: string, location: CampusMapPlaceLike,
): { match: CampusMapMatch; alias: boolean } | null {
  const room = resolveCampusClassroom({ schoolId, query, locations: [location] });
  const alias = room.matchKind === 'alias';
  if (comparable(query) === comparable(location.name)) return { match: 'place', alias };
  if (room.matchKind) return { match: 'building', alias };
  return locationMatchesSearch(location, query) ? { match: 'search', alias: false } : null;
}

export function campusMapMatch(schoolId: string, query: string, location: CampusMapPlaceLike): CampusMapMatch | null {
  return campusMapMatchDetails(schoolId, query, location)?.match ?? null;
}

export function campusMapResolution(items: readonly CampusMapItem[], partial: boolean): CampusMapRead['resolution'] {
  if (partial) return 'partial';
  if (!items.length) return 'unmatched';
  if (items.length > 1) return 'ambiguous';
  return items[0].match !== 'search' && items[0].verification !== 'single-source' ? 'matched' : 'candidates';
}

/** Validate scope, query, map links and source identity before either the model
 * or a deterministic answer may use the result. */
export function parseCampusMapResult(raw: unknown, schoolId: string, requested: CampusMapArguments): CampusMapRead {
  try {
    const args = parseCampusMapArguments(requested);
    const value = object(raw, ['version', 'kind', 'schoolId', 'query', 'limit', 'checkedAt', 'source', 'sourcePath',
      'status', 'items', 'partial', 'resolution', 'href', 'officialMapUrl', 'unavailable']);
    if (!validCampusMapSchool(schoolId) || value.version !== 1 || value.kind !== 'map' || value.schoolId !== schoolId ||
        value.query !== args.query || value.limit !== args.limit || !['ready', 'unavailable'].includes(String(value.status)) ||
        typeof value.partial !== 'boolean' || !Array.isArray(value.items) || value.items.length > args.limit ||
        !['school-pois', 'legacy-pois', 'bundled-providence'].includes(String(value.source))) throw new Error('Invalid map source');
    const source = value.source as CampusMapSource;
    if ((source === 'bundled-providence' && schoolId !== 'pu') ||
        value.sourcePath !== campusMapSourcePath(schoolId, source) ||
        value.href !== campusMapHref(schoolId, args.query) ||
        value.officialMapUrl !== (getOfficialCampusMapUrl(schoolId) ?? undefined)) throw new Error('Invalid map scope');
    const checkedAt = clean(value.checkedAt, 40);
    if (!Number.isFinite(Date.parse(checkedAt)) || new Date(checkedAt).toISOString() !== checkedAt)
      throw new Error('Invalid map time');
    if (value.status === 'unavailable' ? !['NOT_CONNECTED', 'SOURCE_UNAVAILABLE'].includes(String(value.unavailable)) || value.items.length > 0
      : value.unavailable !== undefined) throw new Error('Invalid map availability');
    const items = value.items.map((rawItem): CampusMapItem => {
      const item = object(rawItem, ['id', 'schoolId', 'name', 'category', 'description', 'lat', 'lng', 'building', 'floor',
        'facilities', 'source', 'sourcePath', 'href', 'match', 'verification', 'sourceUrl', 'transitStopIds']);
      const id = safeId(item.id);
      if (item.schoolId !== schoolId || ![source, 'bundled-providence'].includes(item.source as CampusMapSource) ||
          (item.source === 'bundled-providence' && schoolId !== 'pu') ||
          item.sourcePath !== campusMapSourcePath(schoolId, item.source as CampusMapSource) ||
          item.href !== campusMapHref(schoolId, args.query, id) ||
          typeof item.lat !== 'number' || typeof item.lng !== 'number' || !Number.isFinite(item.lat) || !Number.isFinite(item.lng) ||
          Math.abs(item.lat) > 90 || Math.abs(item.lng) > 180 || (item.lat === 0 && item.lng === 0) ||
          !Array.isArray(item.facilities) || item.facilities.length > 12) throw new Error('Invalid map place');
      const parsed = { id, schoolId, name: clean(item.name, 160), category: clean(item.category, 80),
        description: clean(item.description, 320, true), lat: item.lat, lng: item.lng,
        facilities: item.facilities.map(facility => clean(facility, 80)), source: item.source as CampusMapSource,
        sourcePath: item.sourcePath as string, href: item.href as string,
        match: item.match as CampusMapMatch, verification: item.verification as CampusMapItem['verification'],
        ...(item.building !== undefined ? { building: clean(item.building, 120) } : {}),
        ...(item.floor !== undefined ? { floor: clean(item.floor, 80) } : {}),
        ...boundedTransitStopMarker(item) } as CampusMapItem;
      if (new Set(parsed.facilities).size !== parsed.facilities.length ||
          parsed.match !== campusMapMatch(schoolId, args.query, parsed)) throw new Error('Invalid map match');
      const sourceUrl = providencePlaceSourceUrl(schoolId, parsed);
      const verification = sourceUrl ? isProvidencePendingVerification(schoolId, parsed) ? 'single-source' : 'cross-checked' : 'published';
      if (parsed.verification !== verification || item.sourceUrl !== (sourceUrl ?? undefined) ||
          (parsed.source === 'bundled-providence' && !sourceUrl)) throw new Error('Invalid map provenance');
      if (parsed.source === 'bundled-providence') {
        const bundled = [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS].find(place => place.id === parsed.id);
        if (!bundled || parsed.name !== bundled.name || parsed.category !== bundled.category ||
            parsed.description !== bundled.description || parsed.lat !== bundled.lat || parsed.lng !== bundled.lng ||
            parsed.building !== bundled.building || parsed.floor !== bundled.floor ||
            JSON.stringify(parsed.facilities) !== JSON.stringify(bundled.facilities ?? []))
          throw new Error('Changed bundled map place');
      }
      if (sourceUrl) parsed.sourceUrl = sourceUrl;
      return parsed;
    });
    if (new Set(items.map(item => item.id)).size !== items.length ||
        value.resolution !== campusMapResolution(items, value.partial)) throw new Error('Invalid map coverage');
    return { version: 1, kind: 'map', schoolId, query: args.query, limit: args.limit, checkedAt,
      source, sourcePath: value.sourcePath as string, status: value.status as CampusMapRead['status'],
      items, partial: value.partial, resolution: value.resolution as CampusMapRead['resolution'], href: value.href as string,
      ...(value.officialMapUrl ? { officialMapUrl: value.officialMapUrl as string } : {}),
      ...(value.unavailable ? { unavailable: value.unavailable as CampusMapRead['unavailable'] } : {}) };
  } catch {
    throw new V2Error(502, 'INVALID_CAMPUS_MAP_RESULT');
  }
}

/** Keep uncertainty ahead of excerpts so task-summary clipping cannot turn a
 * partial candidate into a confirmed classroom or a navigation instruction. */
export function formatCampusMapRead(read: CampusMapRead): string {
  const checkedAt = new Date(Date.parse(read.checkedAt) + 28800000).toISOString().slice(0, 16).replace('T', ' ');
  const lines = [`校園：${findSchoolById(read.schoolId)?.name || read.schoolId}；查詢「${read.query}」。`,
    `查詢時間：${checkedAt}（台北）；資料來自校園地圖。`];
  if (read.status === 'unavailable') {
    lines.push(read.unavailable === 'NOT_CONNECTED' ? '尚未接通可核對的地點資料，無法確認這個地點。'
      : '地點來源無法完整讀取，這次無法確認位置。');
  } else {
    if (read.partial) lines.push('來源或候選清單尚未完整核對；目前結果不能確認唯一地點。');
    if (read.resolution === 'ambiguous') lines.push('有多個候選地點，請先核對要找哪一個。');
    if (read.resolution === 'candidates') lines.push('目前只有候選地點，尚不能確認是你要找的位置。');
    if (!read.items.length) lines.push('本次已讀取的地圖沒有符合項目；不代表校內沒有這個地點。');
    if (read.items.some(item => item.source === 'bundled-providence')) {
      lines.push(`含隨附地點快照：建築 ${PROVIDENCE_CAMPUS_SOURCE.retrievedAt}、設施 ${PROVIDENCE_CAMPUS_SOURCE.facilitiesRetrievedAt}、站牌 ${PROVIDENCE_CAMPUS_SOURCE.transitCatalogDate}；非即時資料。`);
    }
    let shown = 0;
    for (const item of read.items) {
      const entry = `・${item.name}｜${item.category}` +
        (item.building ? `｜建築：${item.building}` : '') + (item.floor ? `｜來源樓層：${item.floor}` : '') +
        (item.match === 'building' ? '\n只核對到建築，沒有確認房號或從房號推算樓層。' : '') +
        (item.verification === 'single-source' ? '\n此地點只有單一來源，仍待交叉核對。' : '') +
        `\n座標：${item.lat}, ${item.lng}` +
        (item.facilities.length ? `\n來源列出的設施：${item.facilities.slice(0, 4).join('、')}` : '') +
        (item.sourceUrl ? `\n${item.sourceUrl}` : '');
      if (shown >= 3 || lines.join('\n').length + entry.length > 980) break;
      lines.push(entry);
      shown++;
    }
    if (shown < read.items.length) lines.push(`另有 ${read.items.length - shown} 筆已讀取地點，請到地圖核對。`);
    lines.push('位置供地圖核對；尚未建立導航路線或計算到達時間。');
  }
  if (read.officialMapUrl) lines.push(`校方地圖：${read.officialMapUrl}`);
  if (read.href.length <= 200) lines.push(read.href);
  return lines.join('\n');
}
