import {
  PROVIDENCE_BUS_STOPS,
  PROVIDENCE_CAMPUS_PLACES,
  providencePlaceSourceUrl,
  type CampusMapPlaceLike,
} from './providenceCampus';

export const MAX_CAMPUS_CLASSROOM_QUERY_LENGTH = 120;
/** Category labels may carry long parenthetical annotations; do not reuse the
 * 120-character query cap or a trailing `/ Temporary` can be sliced away. */
export const MAX_CAMPUS_CATEGORY_LENGTH = 2000;

function withoutClassroomControlCharacters(text: string): string {
  return text.replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ');
}

/** Keep the supplied room wording; normalization for matching happens separately. */
export function normalizeCampusClassroomQuery(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = withoutClassroomControlCharacters(value).replace(/\s+/g, ' ').trim();
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
  matchKind?: 'primary' | 'alias';
};

function comparisonText(value: unknown): string {
  return normalizeCampusClassroomQuery(value).normalize('NFKC').toLocaleLowerCase('zh-TW');
}

function comparablePublicName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return withoutClassroomControlCharacters(value).normalize('NFKC').toLocaleLowerCase('zh-TW')
    .replace(/\s+/g, ' ').trim();
}

export function campusPlaceNameMatchesQuery(name: string, query: string): boolean {
  const comparableQuery = comparablePublicName(query);
  return Boolean(comparableQuery) && comparablePublicName(name) === comparableQuery;
}

/** This only recognizes a suffix as room wording; it does not decode its building or floor. */
function isRoomSuffix(value: string): boolean {
  const suffix = value.replace(/^[\s:：,，·#/–—-]+/, '').trim();
  const room = '(?:(?:room|教室|室)\\s*)?[a-z]{0,8}\\s*-?\\s*\\d{1,5}[a-z]?(?:\\s*(?:教室|室))?';
  const floor = '(?:b?\\d{1,2}\\s*f|(?:地下|地上)?(?:\\d{1,2}|[一二三四五六七八九十]{1,3})樓)';
  // Bare 3F / B1F is a floor designation, even if the generic room
  // pattern could interpret its final F as an alphabetic room suffix.
  if (new RegExp(`^${floor}(?:\\s*(?:教室|室))?$`, 'u').test(suffix)) return false;
  if (new RegExp(`^${room}$`, 'u').test(suffix)) return true;
  // A timetable may explicitly write floor and room together (3F303 / 3樓303).
  // Accept only an immediately following numeric room, not arbitrary letter suffixes;
  // this still identifies a building POI, never a surveyed floor or indoor route.
  const adjoiningRoom = '\\d{1,5}[a-z]?(?:\\s*(?:教室|室))?';
  // A floor marker alone is not a classroom; require an explicit room number.
  return new RegExp(`^${floor}(?:[\\s,，:：·/\\-]+${room}|${adjoiningRoom})$`, 'u').test(suffix);
}

/** Classrooms belong to buildings, not a stop, car park, road or gateway
 * with the same name. This is a narrow denylist, not a school-specific
 * building whitelist: libraries, dormitories and teaching halls remain valid.
 * No room number, floor or entrance is inferred from the excluded POIs.
 */
const NON_CLASSROOM_POI_CATEGORIES = new Set([
  '公車站', '公車站牌', '公車', '停車', '停車場', '交通', '道路',
  '校車站', '接駁站', '巴士站', '校門', '出入口',
  'bus', 'bus stop', 'bus_stop', 'bus-stop', 'bus station', 'bus_station', 'bus-station',
  'shuttle stop', 'shuttle_stop', 'shuttle-stop', 'transit', 'parking', 'car park', 'car_park',
  'road', 'gate', 'entrance',
  // Restaurant/retail POIs may point to a teaching building through a
  // Firestore `building` field, but their own coordinates are not its entrance.
  // parseCampusMapRecord maps the legacy `convenience` category to 生活.
  '餐飲', '餐廳', '咖啡廳', '商店', '販賣部', '生活',
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
  // Some imported Firestore rows store a single stop ID as a string, or
  // contain malformed non-string array elements. Treat a nonblank marker
  // conservatively as transit identity; never route it to a classroom.
  const ids: unknown = 'transitStopIds' in location ? location.transitStopIds : undefined;
  // A malformed scalar (number, boolean, object) is not an absence of stop
  // metadata. Conservatively reject it rather than risk a false classroom POI.
  const hasMarker = typeof ids === 'string'
    ? ids.trim().length > 0
    : Array.isArray(ids)
      ? ids.some(
          (id: unknown) => typeof id === 'string' ? id.trim().length > 0 : id != null,
        )
      : ids != null;
  return hasMarker || (school === 'pu' && PUBLISHED_PROVIDENCE_BUS_STOP_IDS.has(location.id));
}

/** A reused published hall ID must not inherit a nearby stop's coordinates.
 * Compare squared degree distance only for already-sourced Providence halls.
 */
function closerToPublishedStopThanSourcedHall(
  school: string,
  location: CampusMapPlaceLike,
  published: CampusMapPlaceLike | undefined,
): boolean {
  if (school !== 'pu' || !published) return false;
  const hallDistance = (location.lat - published.lat) ** 2 + (location.lng - published.lng) ** 2;
  return PROVIDENCE_BUS_STOPS.some((stop) => {
    const stopDistance = (location.lat - stop.lat) ** 2 + (location.lng - stop.lng) ** 2;
    return stopDistance < hallDistance;
  });
}


/** Firestore may nest or chain campus/terminal annotations, such as
 * "Bus Stop (Campus (Inbound))" or "餐飲 [North [B1]]". The old single-level
 * 32-character suffix matcher missed those otherwise explicit stop categories.
 * Unwind only complete, balanced trailing groups: never classify an unrelated
 * building merely because its label contains the word "bus" or "交通".
 * categoryComparisonText bounds the input to MAX_CAMPUS_CATEGORY_LENGTH.
 */
function stripTrailingCategoryQualifiers(value: string): string {
  let unqualified = value;
  while (unqualified.endsWith(')') || unqualified.endsWith(']')) {
    const expectedOpeners: string[] = [];
    let start = -1;
    for (let index = unqualified.length - 1; index >= 0; index -= 1) {
      const char = unqualified[index];
      if (char === ')') expectedOpeners.push('(');
      else if (char === ']') expectedOpeners.push('[');
      else if (char === '(' || char === '[') {
        if (expectedOpeners.pop() !== char) { start = -1; break; }
        if (expectedOpeners.length === 0) { start = index; break; }
      }
    }
    if (start <= 0) break;
    unqualified = unqualified.slice(0, start).trim();
  }
  return unqualified;
}

/** Compare explicit non-building category roots, not substrings of legitimate
 * building labels such as "交通工程學院". Importers may append descriptive
 * qualifiers with punctuation instead of brackets (e.g. "公車站 / 校內").
 * Only a complete root category before a separator may exclude a POI.
 */


function categoryComparisonText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned)
    .slice(0, MAX_CAMPUS_CATEGORY_LENGTH)
    .join('')
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('zh-TW');
}

/** If a qualifier was truncated or left unclosed, use the text before the
 * still-open parenthesis or bracket so "Bus Stop (Campus / Inbound…" still
 * reduces to bus stop. */
function prefixBeforeUnclosedQualifier(category: string): string {
  let depth = 0;
  let start = -1;
  for (let index = 0; index < category.length; index += 1) {
    const char = category[index];
    if (char === '(' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if ((char === ')' || char === ']') && depth > 0) {
      depth -= 1;
      if (depth === 0) start = -1;
    }
  }
  return depth > 0 && start >= 0 ? category.slice(0, start).trim() : category;
}

function firstExternalCategoryAnnotationRoot(category: string): string {
  let depth = 0;
  for (let index = 0; index < category.length; index += 1) {
    const char = category[index];
    if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    else if (depth === 0) {
      if ('/:：／|｜·'.includes(char)) return category.slice(0, index).trim();
      if ('–—'.includes(char)) return category.slice(0, index).trim();
      // A hyphen is a separator when spaced on both sides, or when a
      // shortened display label leaves a trailing " -" with no right-hand text.
      if (
        char === '-' &&
        /\s/.test(category[index - 1] ?? '') &&
        (index === category.length - 1 || /\s/.test(category[index + 1] ?? ''))
      ) {
        return category.slice(0, index).trim();
      }
    }
  }
  return category;
}

function isExplicitNonClassroomCategory(value: unknown): boolean {
  const category = categoryComparisonText(value);
  if (!category) return false;
  if (NON_CLASSROOM_POI_CATEGORIES.has(stripTrailingCategoryQualifiers(category))) return true;
  // Split only on standalone annotation separators outside balanced
  // parentheses or brackets. "Bus Stop (Campus / Inbound) / Temporary"
  // must still reduce to bus stop; a slash inside the qualifier must not.
  // A bare ASCII hyphen within a code/name is not a delimiter.
  const root = firstExternalCategoryAnnotationRoot(category);
  if (root !== category && NON_CLASSROOM_POI_CATEGORIES.has(stripTrailingCategoryQualifiers(root))) {
    return true;
  }
  // A truncated or unclosed qualifier can hide the trailing annotation;
  // still honour the explicit root before the still-open group.
  const unclosed = prefixBeforeUnclosedQualifier(category);
  return unclosed !== category && NON_CLASSROOM_POI_CATEGORIES.has(stripTrailingCategoryQualifiers(unclosed));
}

/** Missing school scope is legacy/unscoped even when an importer writes
 * null, undefined or whitespace instead of omitting the property. Such rows
 * must still reserve their IDs; otherwise an ambiguous duplicate can be
 * selected by the map using a published building's ID. A real foreign-school
 * marker (or malformed non-string marker) is never treated as local.
 */
function isCandidateInSchoolScope(location: CampusMapPlaceLike, school: string): boolean {
  if (!('schoolId' in location)) return true;
  const suppliedSchool: unknown = location.schoolId;
  if (suppliedSchool == null) return true;
  if (typeof suppliedSchool !== 'string') return false;
  // Imported school IDs may be padded; trimming must apply to matching as
  // well as empty checks, otherwise a same-school duplicate evades ID safety.
  const normalizedSchool = suppliedSchool.trim();
  return !normalizedSchool || normalizedSchool === school;
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
    // A shorter alias must not consume the original building suffix as a room:
    // "Providence Hall 3F" is a floor-only request, not "Providence" + room "Hall 3F".
    // The full sourced name was checked first, so legitimate "Hall 303" still works.
    if (candidate !== name && suffix.startsWith(name.slice(candidate.length))) return false;
    // "Lab" must not become "Laboratory 101" merely through a Latin prefix collision.
    if (/[a-z]$/u.test(candidate) && /^[a-z]/u.test(suffix)) return false;
    // "R101" does not establish that the building is "R1" and the room is "01".
    if (/\d$/u.test(candidate) && !/^(?:[\s:：,，·#/–—-]|教室|室)/u.test(suffix)) return false;
    return isRoomSuffix(suffix);
  });
}

/**
 * The legacy PH building-code entry is from the University's 2026-05-06 table
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

/** Official English names from the campus POI catalog, keyed by the same
 * published Providence IDs. A name aliases only that sourced ID; it does not
 * confer identity on an unsourced or relabelled POI.
 */
const PUBLISHED_PROVIDENCE_ENGLISH_NAMES = new Map<string, readonly string[]>([
  ['pu-zhugu', ['Providence Hall']],
  ['pu-renyuan', ['Anthony Kuo Hall']],
  ['pu-boduo', ['St. Peter Hall']],
  ['pu-wenxing', ['Wen Xing Hall']],
  ['pu-gelun', ['Theodore Guerin Hall']],
  ['pu-fangji', ['St. Francis Hall']],
  ['pu-siyuan', ['Si Yuan Hall']],
  ['pu-jingan', ['Jing An Hall']],
  ['pu-library', ['Gaesia Library']],
  // campusPois.js uses "Chapel"; the mobile catalog uses the full title.
  ['pu-chapel', ['Chapel', 'Chapel of Our Lady of Providence']],
  ['pu-jingyuan', ['Jingyuan Cafeteria']],
  ['pu-yiyuan', ['Yiyuan Cafeteria']],
  ['pu-gym', ['John Paul II Sports Hall']],
  ['pu-health', ['Health Center']],
  ['pu-parking-moto', ['Motorcycle Parking']],
]);

// Additional official names serve as fallbacks when a primary match is absent.
const PROVIDENCE_ENGLISH_ALIASES = new Map<string, readonly string[]>([
  // Official admissions contact (checked 2026-11-24):
  // https://hstopu.pu.edu.tw/p/412-1105-1496.php
  ['pu-wenxing', ['Bishop Kupfer Hall']],
  // Official bilingual facilities page (checked 2026-11-24):
  // https://dpcd.pu.edu.tw/p/412-1047-3561.php
  ['pu-library', ['Luking Library']],
  ['pu-gym', ['John Paul II Stadium']],
  // Official university archives campus directory (checked 2026-11-24):
  // https://c067.pu.edu.tw/p/412-1121-4218.php
  ['pu-zhishan', ['Zhi Shan Hall']],
  ['pu-xijia', ['Schultz Hall']],
  ['pu-sigao', ['St. Bosco Hall']],
  ['pu-monastery', ['Our Lady of Providence Convent']],
]);

function primarySourcedNames(published: CampusMapPlaceLike): string[] {
  const names = [published.name];
  const catalogEnglish = PUBLISHED_PROVIDENCE_ENGLISH_NAMES.get(published.id);
  if (catalogEnglish) names.push(...catalogEnglish);
  if (Object.prototype.propertyIsEnumerable.call(published, 'nameEn')) {
    const nameEn: unknown = (published as { nameEn?: unknown }).nameEn;
    if (typeof nameEn === 'string' && nameEn.trim()) names.push(nameEn);
  }
  return names;
}

function isSourcedBuildingLabel(school: string, published: CampusMapPlaceLike, suppliedLabel: unknown): boolean {
  const label = comparisonText(suppliedLabel);
  if (!label) return false;
  if (primarySourcedNames(published).some((name) => comparisonText(name) === label)) return true;
  return VERIFIED_CLASSROOM_BUILDING_CODES.some(
    (entry) =>
      entry.schoolId === school &&
      entry.buildingNames.some((name) => comparisonText(name) === comparisonText(published.name)) &&
      entry.buildingNames.some((name) => comparisonText(name) === label),
  );
}

function sourcedBuildingLabel(school: string, published: CampusMapPlaceLike | undefined, building: unknown): unknown {
  if (!published || !comparisonText(building)) return building;
  return isSourcedBuildingLabel(school, published, building) ? building : undefined;
}

// A verified code may be followed by either a room (PH303 / PH303F) or an
// explicitly written floor + room (PH3F303). This identifies the same existing
// building; the digits do not verify an indoor floor, room position or route.
// A bare 3F or 12F is a floor marker, not evidence of a classroom number.
const VERIFIED_CODE_FLOOR_ONLY_SUFFIX = /^[\s:：-]*b?\d{1,2}\s*f(?:\s*(?:教室|室))?$/u;
const VERIFIED_CODE_ROOM_SUFFIX = /^[\s:：-]*\d{1,5}[a-z]?(?:\s*(?:教室|室))?$/u;
const VERIFIED_CODE_FLOOR_ROOM_SUFFIX =
  /^[\s:：-]*(?:b?\d{1,2}\s*f|(?:地下|地上)?(?:\d{1,2}|[一二三四五六七八九十]{1,3})樓)(?:[\s,，:：·/\-]+)?\d{1,5}[a-z]?(?:\s*(?:教室|室))?$/u;

/**
 * 2026-05-06 official summer-course building abbreviation table:
 * https://dorac.pu.edu.tw/p/16-1059-71708.php?Lang=zh-tw
 * These six additional codes map only to the existing cross-checked POI IDs.
 * C, 1R and 2R are intentionally not mapped without a separately verified pin.
 */
const VERIFIED_PROVIDENCE_CODE_BY_PLACE_ID = new Map<string, string>([
  ['pu-renyuan', 'ak'],
  ['pu-boduo', 'sp'],
  ['pu-jingan', 'ja'],
  ['pu-fangji', 'sf'],
  ['pu-siyuan', 'sy'],
  ['pu-gelun', 'tg'],
]);

function matchesVerifiedCodeRoomSuffix(suffix: string): boolean {
  return !VERIFIED_CODE_FLOOR_ONLY_SUFFIX.test(suffix) &&
    (VERIFIED_CODE_ROOM_SUFFIX.test(suffix) || VERIFIED_CODE_FLOOR_ROOM_SUFFIX.test(suffix));
}

function matchesSourcedProvidenceCode(query: string, published: CampusMapPlaceLike): boolean {
  const code = VERIFIED_PROVIDENCE_CODE_BY_PLACE_ID.get(published.id);
  return code !== undefined && query.startsWith(code) &&
    matchesVerifiedCodeRoomSuffix(query.slice(code.length));
}

function nameMatchesVerifiedCode(school: string, query: string, suppliedName: unknown): boolean {
  const name = comparisonText(suppliedName);
  if (!name) return false;
  return VERIFIED_CLASSROOM_BUILDING_CODES.some((entry) => {
    if (entry.schoolId !== school || !query.startsWith(entry.code)) return false;
    const suffix = query.slice(entry.code.length);
    return matchesVerifiedCodeRoomSuffix(suffix) &&
      entry.buildingNames.some((building) => comparisonText(building) === name);
  });
}

/**
 * The caller supplies only the current school's published map locations. This helper never
 * loads a fallback campus, guesses an alphabetic building code, or derives a floor from a room
 * number. A result refers to the original POI object and its existing coordinates.
 * Callers that classify individual candidates can supply the full campus batch
 * as publicNameLocations so exact public names still take precedence.
 */
export function resolveCampusClassroom<T extends CampusMapPlaceLike>({
  schoolId,
  query: rawQuery,
  locations,
  publicNameLocations = locations,
}: {
  schoolId: string | null | undefined;
  query: unknown;
  locations: readonly T[];
  publicNameLocations?: readonly CampusMapPlaceLike[];
}): CampusClassroomResolution<T> {
  const query = normalizeCampusClassroomQuery(rawQuery);
  if (!query) return { query, status: 'empty', matches: [] };
  const school = validSchoolId(schoolId);
  if (!school) return { query, status: 'unmatched', matches: [] };
  const comparable = comparisonText(query);
  // Imported map records are runtime data even when TypeScript callers use the
  // CampusMapPlaceLike interface. A single null row or a numeric ID must not
  // crash classroom lookup and prevent navigation to an otherwise valid hall.
  if (!Array.isArray(locations)) return { query, status: 'unmatched', matches: [] };
  const counts = new Map<string, number>();
  for (const location of locations) {
    if (!location || typeof location !== 'object' ||
        typeof location.id !== 'string' || !location.id.trim()) continue;
    // An out-of-scope campus row cannot be selected, so it must not reserve
    // this school's ID and hide a valid destination with the same identifier.
    // Rows without a schoolId still count: legacy data may be unscoped, and
    // duplicate IDs within the selected campus must continue to fail closed.
    if (!isCandidateInSchoolScope(location, school)) continue;
    counts.set(location.id, (counts.get(location.id) ?? 0) + 1);
  }
  const primaryMatches: T[] = [];
  const aliasMatches: T[] = [];
  for (const location of locations) {
    // An invalid row is never a destination. Still count duplicate *string*
    // IDs above, even when the other row is malformed, to fail closed rather
    // than let a broken import impersonate a published building ID.
    if (!location || typeof location !== 'object' ||
        typeof location.id !== 'string' || !location.id.trim() ||
        counts.get(location.id) !== 1) continue;
    if (
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng) ||
      Math.abs(location.lat) > 90 ||
      Math.abs(location.lng) > 180 ||
      // (0, 0) is a common unset-coordinate sentinel, never a safe campus
      // classroom destination. Do not reject genuine equator/meridian points.
      (location.lat === 0 && location.lng === 0)
    )
      continue;
    if (!isCandidateInSchoolScope(location, school)) continue;
    // Recheck the existing sourced identity rather than trusting a reused ID.
    // Classroom identity accepts normalized names and verified bilingual aliases.
    // Once the supplied name is verified, use the catalog name for attribution's
    // exact-name check while preserving its coordinate check and the original POI.
    const published = school === 'pu' ? PUBLISHED_PROVIDENCE_PLACES.get(location.id) : undefined;
    const aliases = published ? PROVIDENCE_ENGLISH_ALIASES.get(published.id) : undefined;
    if (
      published &&
      // Source identity and source category are both necessary: a matching
      // ID/name/coordinate does not make a restaurant a classroom building.
      (isExplicitNonClassroomCategory(published.category) ||
        (!isSourcedBuildingLabel(school, published, location.name) &&
          !aliases?.some((name) => campusPlaceNameMatchesQuery(name, location.name))) ||
        !providencePlaceSourceUrl(school, { ...location, name: published.name }))
    ) continue;
    // A nearby transit stop can be named after a hall or carry its building
    // field in Firestore. Never promote that stop into a classroom destination.
    if (hasTransitStopIdentity(location, school) || isExplicitNonClassroomCategory(location.category) ||
        closerToPublishedStopThanSourcedHall(school, location, published)) continue;
    // A sourced clinic, chapel or sports POI must not navigate to another
    // building through an unsourced Firestore `building` override.
    const building = sourcedBuildingLabel(school, published, location.building);
    const primaryNames = published ? primarySourcedNames(published) : [location.name, building];
    if (
      primaryNames.some((name) => nameMatchesRoom(comparable, name)) ||
      nameMatchesVerifiedCode(school, comparable, location.name) ||
      nameMatchesVerifiedCode(school, comparable, building)
    ) {
      primaryMatches.push(location);
    } else if (
      published &&
      (aliases?.some((name) => nameMatchesRoom(comparable, name)) ||
        matchesSourcedProvidenceCode(comparable, published))
    ) {
      aliasMatches.push(location);
    }
  }
  const matches = primaryMatches.length > 0 ? primaryMatches : aliasMatches;
  if (matches.length === 1) {
    const [match] = matches;
    const published = school === 'pu' ? PUBLISHED_PROVIDENCE_PLACES.get(match.id) : undefined;
    const building = sourcedBuildingLabel(school, published, match.building);
    const matchesPublicLabelOrLegacyCode = primaryMatches.length > 0 &&
      (!published || isSourcedBuildingLabel(school, published, match.name)) &&
      [match.name, building].some((name) =>
        nameMatchesRoom(comparable, name) || nameMatchesVerifiedCode(school, comparable, name)
      );
    // A public name can claim the full query even when its place is ineligible
    // for classroom navigation. Catalog-only names and codes yield to that name.
    const publicNameQuery = comparablePublicName(rawQuery);
    if (
      !matchesPublicLabelOrLegacyCode &&
      publicNameLocations.some((location) =>
        location && typeof location === 'object' && location.id !== match.id &&
        comparablePublicName(location.name) === publicNameQuery
      )
    ) {
      return { query, status: 'unmatched', matches: [] };
    }
  }
  return {
    query,
    status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'unmatched',
    matches,
    ...(matches.length ? { matchKind: primaryMatches.length ? 'primary' : 'alias' } : {}),
  };
}
