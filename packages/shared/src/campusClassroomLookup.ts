import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
  providencePlaceSourceUrl,
  type CampusMapPlaceLike,
} from './providenceCampus';

export const MAX_CAMPUS_CLASSROOM_QUERY_LENGTH = 120;

/** Keep the supplied room wording; normalization for matching happens separately. */
export function normalizeCampusClassroomQuery(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, MAX_CAMPUS_CLASSROOM_QUERY_LENGTH).join('').trim();
}

function validSchoolId(value: string | null | undefined): string | null {
  const id = value?.trim();
  if (!id || ['all', 'personal', 'unavailable-campus'].includes(id)) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(id) ? id : null;
}

/** A room is a search request, never an invented destination or an inferred floor. */
export function buildCampusClassroomMapHref({
  schoolId,
  location,
}: {
  schoolId: string | null | undefined;
  location: unknown;
}): string | null {
  const school = validSchoolId(schoolId);
  const query = normalizeCampusClassroomQuery(location);
  if (!school || !query) return null;
  return `/map?${new URLSearchParams({ schoolId: school, query })}`;
}

export type CampusClassroomResolution<T extends CampusMapPlaceLike> = {
  query: string;
  status: 'empty' | 'unmatched' | 'matched' | 'ambiguous';
  matches: readonly T[];
};

function comparisonText(value: unknown): string {
  return normalizeCampusClassroomQuery(value).normalize('NFKC').toLocaleLowerCase('zh-TW');
}

/** This only recognizes a suffix as room wording; it does not decode its building or floor. */
function isRoomSuffix(value: string): boolean {
  const suffix = value.replace(/^[\s:：,，·#/–—-]+/, '').trim();
  const room = '(?:(?:room|教室|室)\\s*)?[a-z]{0,8}\\s*-?\\s*\\d{1,5}[a-z]?(?:\\s*(?:教室|室))?';
  if (new RegExp(`^${room}$`, 'u').test(suffix)) return true;
  const floor = '(?:b?\\d{1,2}\\s*f|(?:地下|地上)?(?:\\d{1,2}|[一二三四五六七八九十]{1,3})樓)';
  return new RegExp(`^${floor}(?:[\\s,，:：·/\\-]+${room})?$`, 'u').test(suffix);
}

/** Classrooms belong to buildings, not a stop, car park, road or gateway
 * with the same name. This is a narrow denylist, not a school-specific
 * building whitelist: libraries, dormitories and teaching halls remain valid.
 * No room number, floor or entrance is inferred from the excluded POIs.
 */
const NON_CLASSROOM_POI_CATEGORIES = new Set([
  '公車站', '公車站牌', '公車', '停車', '停車場', '交通', '道路',
  '校車站', '接駁站', '巴士站', '校門', '出入口',
  'bus', 'bus stop', 'bus_stop', 'bus station', 'bus_station',
  'shuttle stop', 'shuttle_stop', 'transit', 'parking', 'car park', 'car_park',
  'road', 'gate', 'entrance',
  // Restaurant/retail POIs may point to a teaching building through a
  // Firestore `building` field, but their own coordinates are not its entrance.
  '餐飲', '餐廳', '咖啡廳', '商店', '販賣部',
  'restaurant', 'cafe', 'cafeteria', 'food court', 'food_court',
  'shop', 'store', 'convenience store', 'convenience_store', 'atm',
]);

/** Match bundled stop IDs against the actual published catalog, rather
 * than inferring transport identity from a place name or an ID prefix.
 * A Firestore replacement can accidentally omit optional transitStopIds;
 * the bundled stop ID must still never become a classroom destination.
 */
const PUBLISHED_PROVIDENCE_BUS_STOP_IDS = new Set(PROVIDENCE_BUS_STOPS.map((stop) => stop.id));

/** A server row reusing a published building ID must still match that
 * building's sourced name and approximate coordinates. An ID alone cannot
 * authorize classroom routing after a Firestore replacement or bad import.
 * Unknown IDs and other schools retain the existing shared resolver behavior.
 */
const PUBLISHED_PROVIDENCE_PLACES = new Map(PROVIDENCE_CAMPUS_PLACES.map((place) => [place.id, place]));

function hasTransitStopIdentity(location: CampusMapPlaceLike, school: string): boolean {
  const ids = 'transitStopIds' in location ? location.transitStopIds : undefined;
  return (
    (Array.isArray(ids) && ids.some(
      (id: unknown) => typeof id === 'string' && id.trim().length > 0,
    )) ||
    (school === 'pu' && PUBLISHED_PROVIDENCE_BUS_STOP_IDS.has(location.id))
  );
}

/** Firestore category labels may append a campus/terminal qualifier in parentheses.
 * Compare only exact known non-building categories, never a substring of a
 * legitimate teaching-building label such as "交通工程學院".
 */
function isExplicitNonClassroomCategory(value: unknown): boolean {
  const category = comparisonText(value);
  // Firestore may append multiple short parenthetical qualifiers, e.g.
  // "Bus Stop (Campus) (Inbound)". Strip only complete trailing qualifiers;
  // unrelated building categories such as "交通工程學院" stay eligible.
  let unqualified = category;
  // The category is already bounded to MAX_CAMPUS_CLASSROOM_QUERY_LENGTH.
  // Stop only when no complete qualifier remains: four or more qualifiers
  // must not silently turn a known bus stop into a classroom destination.
  while (true) {
    const next = unqualified.replace(/\s*(?:\([^()]{1,32}\)|\[[^\[\]]{1,32}\])\s*$/u, '').trim();
    if (next === unqualified) break;
    unqualified = next;
  }
  return NON_CLASSROOM_POI_CATEGORIES.has(category) || NON_CLASSROOM_POI_CATEGORIES.has(unqualified);
}

function nameMatchesRoom(query: string, suppliedName: unknown): boolean {
  const name = comparisonText(suppliedName);
  if (!name) return false;
  if (query === name) return true;
  // A short name is derived only from a provided building label. No campus code dictionary.
  const shortened = name.replace(/(?:大樓|樓|\s+(?:building|hall))$/u, '').trim();
  const names = [name];
  if (shortened !== name && Array.from(shortened).length >= 2) names.push(shortened);
  return names.some((candidate) => {
    if (!query.startsWith(candidate)) return false;
    const suffix = query.slice(candidate.length);
    // "Lab" must not become "Laboratory 101" merely through a Latin prefix collision.
    if (/[a-z]$/u.test(candidate) && /^[a-z]/u.test(suffix)) return false;
    // "R101" does not establish that the building is "R1" and the room is "01".
    if (/\d$/u.test(candidate) && !/^(?:[\s:：,，·#/–—-]|教室|室)/u.test(suffix)) return false;
    return isRoomSuffix(suffix);
  });
}

/**
 * The sole building-code entry is from the University's 2026-05-06 table
 * (https://dorac.pu.edu.tw/p/16-1059-71708.php?Lang=zh-tw)
 * and OITS bilingual building name
 * (https://oits.pu.edu.tw/p/406-1002-2655,r207.php?Lang=zh-tw).
 * A code never establishes a room, floor, entrance or indoor route.
 */
const VERIFIED_CLASSROOM_BUILDING_CODES = [
  { schoolId: 'pu', code: 'ph', buildingNames: ['主顧樓', 'Providence Hall'] },
] as const;

/** A bundled, source-identified POI cannot inherit a different building's
 * classroom destination just because Firestore adds a `building` label.
 * Allow its own sourced name and explicitly verified bilingual code aliases;
 * other schools and unsourced records retain the existing matching behavior.
 */
function sourcedBuildingLabel(school: string, published: CampusMapPlaceLike | undefined, building: unknown): unknown {
  if (!published || !comparisonText(building)) return building;
  const label = comparisonText(building);
  if (label === comparisonText(published.name)) return building;
  const verifiedAlias = VERIFIED_CLASSROOM_BUILDING_CODES.some(
    (entry) =>
      entry.schoolId === school &&
      entry.buildingNames.some((name) => comparisonText(name) === comparisonText(published.name)) &&
      entry.buildingNames.some((name) => comparisonText(name) === label),
  );
  return verifiedAlias ? building : undefined;
}

function nameMatchesVerifiedCode(school: string, query: string, suppliedName: unknown): boolean {
  const name = comparisonText(suppliedName);
  if (!name) return false;
  return VERIFIED_CLASSROOM_BUILDING_CODES.some(
    (entry) =>
      entry.schoolId === school &&
      query.startsWith(entry.code) &&
      // The verified building code must be followed by a numeric room token, not arbitrary letters.
      /^[\s:：-]*\d{1,5}[a-z]?(?:\s*(?:教室|室))?$/u.test(query.slice(entry.code.length)) &&
      entry.buildingNames.some((building) => comparisonText(building) === name),
  );
}

/**
 * The caller supplies only the current school's published map locations. This helper never
 * loads a fallback campus, guesses an alphabetic building code, or derives a floor from a room
 * number. A result refers to the original POI object and its existing coordinates.
 */
export function resolveCampusClassroom<T extends CampusMapPlaceLike>({
  schoolId,
  query: rawQuery,
  locations,
}: {
  schoolId: string | null | undefined;
  query: unknown;
  locations: readonly T[];
}): CampusClassroomResolution<T> {
  const query = normalizeCampusClassroomQuery(rawQuery);
  if (!query) return { query, status: 'empty', matches: [] };
  const school = validSchoolId(schoolId);
  if (!school) return { query, status: 'unmatched', matches: [] };
  const comparable = comparisonText(query);
  const counts = new Map<string, number>();
  for (const location of locations) counts.set(location.id, (counts.get(location.id) ?? 0) + 1);
  const matches = locations.filter((location) => {
    // A duplicate ID cannot be selected safely by MapClient's existing ID-based contract.
    if (!location.id?.trim() || counts.get(location.id) !== 1) return false;
    if (
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng) ||
      Math.abs(location.lat) > 90 ||
      Math.abs(location.lng) > 180 ||
      // (0, 0) is a common unset-coordinate sentinel, never a safe campus
      // classroom destination. Do not reject genuine equator/meridian points.
      (location.lat === 0 && location.lng === 0)
    )
      return false;
    if ('schoolId' in location && location.schoolId !== school) return false;
    // Recheck the existing sourced identity rather than trusting a reused ID.
    // The shared attribution helper checks name and position; do not invent
    // a building location when an imported catalog row has drifted.
    const published = school === 'pu' ? PUBLISHED_PROVIDENCE_PLACES.get(location.id) : undefined;
    if (
      published &&
      // Source identity and source category are both necessary: a matching
      // ID/name/coordinate does not make a restaurant a classroom building.
      (isExplicitNonClassroomCategory(published.category) ||
        !providencePlaceSourceUrl(school, location))
    ) return false;
    // A nearby transit stop can be named after a hall or carry its building
    // field in Firestore. Never promote that stop into a classroom destination.
    if (hasTransitStopIdentity(location, school) || isExplicitNonClassroomCategory(location.category)) return false;
    // A sourced clinic, chapel or sports POI must not navigate to another
    // building through an unsourced Firestore `building` override.
    const building = sourcedBuildingLabel(school, published, location.building);
    return (
      nameMatchesRoom(comparable, location.name) ||
      nameMatchesRoom(comparable, building) ||
      nameMatchesVerifiedCode(school, comparable, location.name) ||
      nameMatchesVerifiedCode(school, comparable, building)
    );
  });
  return {
    query,
    status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'unmatched',
    matches,
  };
}
