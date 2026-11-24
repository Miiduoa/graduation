import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { collection, getDocsFromServer, limit, query, where } from 'firebase/firestore';
import { getOfficialCampusMapUrl } from '@campus/shared/src/campusMapLookup';
import { parseCampusMapRecord } from '@campus/shared/src/campusMapRecords';
import {
  hasBundledCampusPlaces,
  isProvidencePendingVerification,
  providencePlaceSourceUrl,
  withProvidenceCampusPlaces,
  type CampusMapPlaceLike,
} from '@campus/shared/src/providenceCampus';
import { guardedPublicCampusRead, type PublicCampusReadGuard } from '../../publicCampusReadGuard';
import { V2Error } from './contracts';
import {
  boundedTransitStopMarker, campusMapHref, campusMapMatch, campusMapResolution, campusMapSourcePath,
  parseCampusMapArguments, parseCampusMapResult, validCampusMapSchool, type CampusMapArguments,
  type CampusMapItem, type CampusMapRead, type CampusMapSource,
} from './campusMap';

/** One bounded query plus an optional legacy query. Every query is accounted
 * for by the same guard as other assistant public readers. */
export const CAMPUS_MAP_SOURCE_LIMIT = 200;

function plain(value: string, max: number): string {
  return value.replace(/<[^<>]*>/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
function clippedPlace(place: CampusMapPlaceLike): boolean {
  return place.name.length > 160 || place.category.length > 80 || place.description.length > 320 ||
    (place.building?.length ?? 0) > 120 || (place.floor?.length ?? 0) > 80 ||
    (place.facilities?.length ?? 0) > 12 || Boolean(place.facilities?.some(value => value.length > 80));
}
function safePlace(place: CampusMapPlaceLike): CampusMapPlaceLike | null {
  if (!place.id.trim() || place.id !== place.id.trim() || place.id.length > 200 || place.id.includes('/') ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(place.id) ||
      ['.', '..', '__proto__', 'prototype', 'constructor'].includes(place.id)) return null;
  const name = plain(place.name, 160);
  if (!name) return null;
  const building = place.building ? plain(place.building, 120) : '';
  const floor = place.floor ? plain(place.floor, 80) : '';
  // Preserve a bounded stop marker without widening CampusMapPlaceLike or
  // copying raw Firestore values into the assistant result.
  return { id: place.id, name, category: plain(place.category, 80) || '其他',
    description: plain(place.description, 320), lat: place.lat, lng: place.lng,
    facilities: [...new Set((place.facilities ?? []).map(value => plain(value, 80)).filter(Boolean))].slice(0, 12),
    ...(building ? { building } : {}), ...(floor ? { floor } : {}),
    ...boundedTransitStopMarker(place) } as CampusMapPlaceLike;
}

export async function readCampusMap(input: {
  schoolId: string;
  args: CampusMapArguments;
  guard: PublicCampusReadGuard;
  now?: number;
}): Promise<CampusMapRead> {
  const { schoolId, guard } = input;
  const args = parseCampusMapArguments(input.args);
  if (!validCampusMapSchool(schoolId)) throw new V2Error(422, 'INVALID_INPUT');
  guard.afterRead();
  const now = input.now ?? Date.now();
  if (!Number.isFinite(new Date(now).getTime())) throw new V2Error(422, 'INVALID_INPUT');
  let source: CampusMapSource = 'school-pois';
  let incomplete = false;
  let sourceUnavailable = false;
  const published: CampusMapPlaceLike[] = [];
  if (guard.db) {
    try {
      const primaryPath = campusMapSourcePath(schoolId, source);
      let sourcePath = primaryPath;
      let snapshot = await guardedPublicCampusRead(guard, () => getDocsFromServer(
        query(collection(guard.db!, 'schools', schoolId, 'pois'), limit(CAMPUS_MAP_SOURCE_LIMIT + 1)),
      ));
      // Match the map page: a source error or invalid records never trigger a
      // legacy lookup. Only the canonical source's confirmed empty result can.
      if (snapshot.empty) {
        source = 'legacy-pois';
        sourcePath = 'pois';
        snapshot = await guardedPublicCampusRead(guard, () => getDocsFromServer(
          query(collection(guard.db!, 'pois'), where('schoolId', '==', schoolId), limit(CAMPUS_MAP_SOURCE_LIMIT + 1)),
        ));
      }
      incomplete = snapshot.docs.length > CAMPUS_MAP_SOURCE_LIMIT;
      for (const document of snapshot.docs.slice(0, CAMPUS_MAP_SOURCE_LIMIT)) {
        try {
          if (document.ref.parent.path !== sourcePath) throw new Error('Invalid map collection');
          const data = document.data();
          if (source === 'legacy-pois' && data.schoolId !== schoolId) throw new Error('Invalid legacy school');
          const place = parseCampusMapRecord(document.id, data, schoolId);
          const safe = place ? safePlace(place) : null;
          if (!safe) { incomplete = true; continue; }
          if (place && clippedPlace(place)) incomplete = true;
          published.push(safe);
        } catch {
          incomplete = true;
        }
      }
    } catch (error) {
      guard.afterRead();
      // Cancellation, authentication changes and the shared budget remain
      // errors. They cannot be disguised by an available bundled catalogue.
      if (error instanceof V2Error || (error as { name?: string }).name === 'AbortError') throw error;
      sourceUnavailable = true;
      incomplete = true;
    }
  } else {
    sourceUnavailable = true;
    incomplete = true;
  }
  guard.afterRead();
  const ids = new Map<string, number>();
  for (const place of published) ids.set(place.id, (ids.get(place.id) ?? 0) + 1);
  const unique = published.filter(place => ids.get(place.id) === 1);
  if (unique.length !== published.length) incomplete = true;
  const publishedIds = new Set(unique.map(place => place.id));
  const publicSchoolId = toPublicSchoolId(schoolId)!;
  const places = withProvidenceCampusPlaces(publicSchoolId, unique);
  if (!unique.length && hasBundledCampusPlaces(publicSchoolId)) source = 'bundled-providence';
  const candidates: CampusMapItem[] = [];
  for (const rawPlace of places) {
    const place = safePlace(rawPlace);
    if (!place) { incomplete = true; continue; }
    const match = campusMapMatch(schoolId, args.query, place);
    if (!match) continue;
    const itemSource = publishedIds.has(place.id) ? source : 'bundled-providence';
    const sourceUrl = providencePlaceSourceUrl(publicSchoolId, place);
    candidates.push({ ...place, schoolId, facilities: place.facilities ?? [],
      source: itemSource, sourcePath: campusMapSourcePath(schoolId, itemSource),
      href: campusMapHref(schoolId, args.query, place.id), match,
      verification: sourceUrl ? isProvidencePendingVerification(publicSchoolId, place) ? 'single-source' : 'cross-checked' : 'published',
      ...(sourceUrl ? { sourceUrl } : {}) });
  }
  const rank = { place: 0, building: 1, search: 2 };
  candidates.sort((a, b) => rank[a.match] - rank[b.match] || a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id));
  const items = candidates.slice(0, args.limit);
  const partial = incomplete || candidates.length > args.limit;
  const available = places.length > 0;
  const officialMapUrl = getOfficialCampusMapUrl(publicSchoolId);
  const result: CampusMapRead = { version: 1, kind: 'map', schoolId, query: args.query, limit: args.limit,
    checkedAt: new Date(now).toISOString(), source, sourcePath: campusMapSourcePath(schoolId, source),
    status: available ? 'ready' : 'unavailable', items, partial,
    resolution: campusMapResolution(items, partial), href: campusMapHref(schoolId, args.query),
    ...(officialMapUrl ? { officialMapUrl } : {}),
    ...(!available ? { unavailable: sourceUnavailable || incomplete ? 'SOURCE_UNAVAILABLE' as const : 'NOT_CONNECTED' as const } : {}) };
  if (partial) guard.onIncomplete?.();
  guard.afterRead();
  return parseCampusMapResult(result, schoolId, args);
}
