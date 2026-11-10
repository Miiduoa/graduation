'use client';

import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { buildCampusNavigationSearch } from './campusNavigationLinks';

export {
  buildCampusNavigationSearch,
  campusServiceHref,
  campusServiceMatches,
} from './campusNavigationLinks';

type SearchLike = { get(key: string): string | null } | null | undefined;

export function useCampusNavigationSearch(params: SearchLike): string {
  const selection = useOptionalSelectedSchool();
  const ready = selection !== null && !selection.loading && selection.catalogStatus === 'ready';

  return buildCampusNavigationSearch(params, selection?.selectedSchool, ready);
}
