/**
 * Map-client POI identity and source checks shared by Web and native maps.
 * The public Agent production-source overlay pins providenceCampus.ts byte-for-byte.
 * Keep that reviewed module unchanged; consume its catalog without copying coordinates,
 * and explicitly import these stricter map rules in map/classroom clients.
 * Any change to the production Agent overlay requires separate security review.
 */
import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
  type CampusMapPlaceLike,
  type ProvidencePlace,
} from './providenceCampus';

export * from './providenceCampus';

const MAX_PLACE_IDENTITY_DISPLACEMENT_METERS = 50;
const EARTH_RADIUS_METERS = 6_371_008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;

function samePlaceCoordinates(a: CampusMapPlaceLike, b: CampusMapPlaceLike): boolean {
  // Local tangent-plane distance is accurate at campus scale. Reject corrupt
  // coordinates; an invalid marker must not inherit a source or hide a bus stop.
  const northMeters = (a.lat - b.lat) * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS;
  const eastMeters = (a.lng - b.lng) * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS *
    Math.cos((a.lat + b.lat) / 2 * DEGREES_TO_RADIANS);
  return Number.isFinite(northMeters) && Number.isFinite(eastMeters) &&
    Math.hypot(northMeters, eastMeters) <= MAX_PLACE_IDENTITY_DISPLACEMENT_METERS;
}

function sameOptionalPlaceField(a: string | undefined, b: string | undefined): boolean {
  const label = (value: string | undefined) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };
  return label(a) === label(b);
}

function samePlaceIdentity(a: CampusMapPlaceLike, b: CampusMapPlaceLike): boolean {
  // Only provenance is withheld when a marker's identity, category or location
  // differs; the marker itself stays visible. Blank building/floor labels are
  // the same as omitted fields.
  return a.id === b.id && a.name === b.name && a.category === b.category &&
    sameOptionalPlaceField(a.building, b.building) &&
    sameOptionalPlaceField(a.floor, b.floor) &&
    samePlaceCoordinates(a, b);
}

function allBundledProvidencePlaces(): readonly ProvidencePlace[] {
  return [...PROVIDENCE_CAMPUS_PLACES, ...PROVIDENCE_BUS_STOPS];
}

function findBundledProvidencePlace(location: CampusMapPlaceLike): ProvidencePlace | undefined {
  return allBundledProvidencePlaces().find((entry) => samePlaceIdentity(entry, location));
}

function samePlace(a: CampusMapPlaceLike, b: ProvidencePlace): boolean {
  // Nearby same-name stops may serve different directions. When the live
  // record declares stop IDs, it must cover every bundled ID before hiding
  // that marker. Keep the old proximity fallback only for legacy records
  // without stop metadata.
  if (a.category !== '公車站' || b.category !== '公車站' ||
      a.name !== b.name || !samePlaceCoordinates(a, b)) return false;
  if (!Object.prototype.hasOwnProperty.call(a, 'transitStopIds')) return true;
  const ids = (a as CampusMapPlaceLike & { transitStopIds?: unknown }).transitStopIds;
  if (!Array.isArray(ids) || ids.length === 0 ||
      !ids.every((id: unknown) => typeof id === 'string' && id.trim() === id && id.length > 0)) {
    return false;
  }
  return Boolean(b.transitStopIds?.length &&
    b.transitStopIds.every((id) => ids.includes(id)));
}

/**
 * 靜宜第一版地點組裝：
 * - Firestore 有地點時以它為準，只補上還沒有的公車站牌，讓建築與站牌同圖。
 * - Firestore 確認為空時，改用隨附的 OpenStreetMap 建築資料加站牌。
 * - 其他學校原樣回傳，不混入靜宜資料。
 */
export function withProvidenceCampusPlaces(
  schoolId: string,
  locations: readonly CampusMapPlaceLike[],
): CampusMapPlaceLike[] {
  if (schoolId !== 'pu') return [...locations];
  const base: readonly CampusMapPlaceLike[] = locations.length ? locations : PROVIDENCE_CAMPUS_PLACES;
  const merged = [...base];
  for (const stop of PROVIDENCE_BUS_STOPS) {
    // 同 ID 以伺服器／既有紀錄為準；不同 ID 仍用名稱＋鄰近座標保守去重。
    if (merged.some((place) => place.id === stop.id || samePlace(place, stop))) continue;
    merged.push(stop);
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export function providencePlaceSourceUrl(
  schoolId: string,
  location: CampusMapPlaceLike,
): string | null {
  if (schoolId !== 'pu') return null;
  return findBundledProvidencePlace(location)?.sourceUrl ?? null;
}

/** 只有單一來源、還沒交叉確認的地點，畫面會老實標「待確認」。 */
export function isProvidencePendingVerification(
  schoolId: string,
  location: CampusMapPlaceLike,
): boolean {
  if (schoolId !== 'pu') return false;
  return findBundledProvidencePlace(location)?.verification === 'single-source';
}
