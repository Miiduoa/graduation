import { searchSchools } from '@campus/shared/src/schools';
export { normalizeSchoolQuery } from '@campus/shared/src/schools';

export function filterSchools<T extends { id?: string; name: string; shortName?: string; code?: string }>(
  schools: readonly T[],
  query: string,
): T[] {
  return searchSchools(query, schools);
}
