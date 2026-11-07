import type { CampusMapPlaceLike } from './providenceCampus';

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
      Math.abs(location.lng) > 180
    )
      return false;
    if ('schoolId' in location && location.schoolId !== school) return false;
    return (
      nameMatchesRoom(comparable, location.name) || nameMatchesRoom(comparable, location.building)
    );
  });
  return {
    query,
    status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'unmatched',
    matches,
  };
}
