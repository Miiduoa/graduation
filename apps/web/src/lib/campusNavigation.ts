'use client';

import { findSchoolById } from '@campus/shared/src/schools';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';

type SearchLike = { get(key: string): string | null } | null | undefined;

export function buildCampusNavigationSearch(
  params: SearchLike,
  selected?: { id: string; code?: string } | null,
  selectionReady = false,
): string {
  const search = new URLSearchParams();
  if (!selectionReady) {
    for (const key of ['school', 'schoolId', 'campus']) {
      const value = params?.get(key);
      if (value) search.set(key, value);
    }
  } else if (selected) {
    search.set('schoolId', selected.id);
    search.set('campus', selected.id);
    const code = selected.code || findSchoolById(selected.id)?.code;
    if (code) search.set('school', code);
  } else {
    search.set('campus', 'all');
  }
  return search.toString();
}

export function useCampusNavigationSearch(params: SearchLike): string {
  const selection = useOptionalSelectedSchool();
  const ready =
    selection !== null &&
    !selection.loading &&
    selection.catalogStatus === 'ready';

  return buildCampusNavigationSearch(params, selection?.selectedSchool, ready);
}

export function campusServiceHref(path: string, search: string): string {
  if (!search) return path;
  const [pathname, existing = ''] = path.split('?');
  const merged = new URLSearchParams(existing);
  new URLSearchParams(search).forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  const query = merged.toString();
  return query ? `${pathname}?${query}` : pathname;
}
