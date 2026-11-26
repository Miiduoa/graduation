import { findSchoolById, searchSchools } from '@campus/shared/src/schools';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import type { BrowseSchool } from './SelectedSchoolProvider';
export { normalizeSchoolQuery } from '@campus/shared/src/schools';

// Search hints never become additional campuses or select a tenant for a legacy URL.
export function schoolSearchEntry(school: BrowseSchool): BrowseSchool {
  const bundled = findSchoolById(school.id === 'nchu' ? 'tw-nchu' : toPublicSchoolId(school.id));
  if (!bundled) return school;
  return {
    ...school,
    shortName: school.shortName ?? bundled.shortName,
    code: school.code ?? bundled.code,
    aliases: school.aliases ?? bundled.aliases,
    domains: school.domains ?? bundled.domains,
  };
}

export function filterSchools<T extends { id?: string; name: string; shortName?: string; code?: string }>(
  schools: readonly T[],
  query: string,
): T[] {
  return searchSchools(query, schools);
}
