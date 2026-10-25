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
  const ready = selection !== null && !selection.loading && selection.catalogStatus === 'ready';

  return buildCampusNavigationSearch(params, selection?.selectedSchool, ready);
}

export function campusServiceHref(path: string, search: string): string {
  if (!search) return path;
  const hashIndex = path.indexOf('#');
  const fragment = hashIndex < 0 ? '' : path.slice(hashIndex);
  const destination = hashIndex < 0 ? path : path.slice(0, hashIndex);
  const queryIndex = destination.indexOf('?');
  const pathname = queryIndex < 0 ? destination : destination.slice(0, queryIndex);
  const existing = queryIndex < 0 ? '' : destination.slice(queryIndex + 1);
  const merged = new URLSearchParams(existing);
  new URLSearchParams(search).forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  const query = merged.toString();
  return `${pathname}${query ? `?${query}` : ''}${fragment}`;
}

export function campusServiceMatches(
  href: string,
  pathname: string | null | undefined,
  params: SearchLike,
): boolean {
  if (!pathname) return false;
  const destination = new URL(href, 'https://campus.local');
  if (pathname !== destination.pathname && !pathname.startsWith(`${destination.pathname}/`))
    return false;
  return [...destination.searchParams].every(([key, value]) => params?.get(key) === value);
}
