import { findSchoolsByCode } from '@campus/shared/src/schools';
import type { SchoolSearchParams } from './pageContext';

export type ServiceListSearchParams = SchoolSearchParams & {
  [key: string]: string | string[] | undefined;
};
export type ServiceListQuery = ServiceListSearchParams | URLSearchParams | undefined;
export const SERVICE_LIST_CHANGE_EVENT = 'campus-service-list-change';

export function subscribeServiceListQuery(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(SERVICE_LIST_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(SERVICE_LIST_CHANGE_EVENT, onChange);
  };
}

export function listQueryValue(query: ServiceListQuery, key: string): string {
  const value = query instanceof URLSearchParams ? query.get(key) : query?.[key];
  return typeof value === 'string' ? value : '';
}

export function listSearchText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
}

export function listPageNumber(value: string): number {
  return /^\d{1,3}$/.test(value) ? Math.max(1, Math.min(100, Number(value))) : 1;
}

/** Rebuild only the verified campus context; no arbitrary return destinations. */
export function serviceListSchoolQuery(
  schoolId: string,
  source?: ServiceListQuery,
): URLSearchParams {
  const query = new URLSearchParams({ schoolId });
  const campus = listQueryValue(source, 'campus').trim();
  if (campus === schoolId) query.set('campus', schoolId);
  const school = listQueryValue(source, 'school').trim();
  if (school && findSchoolsByCode(school).some((item) => item.id === schoolId)) {
    query.set('school', school);
  }
  return query;
}

export function isCurrentServiceList(pathname: string, schoolId: string): boolean {
  if (window.location.pathname !== pathname) return false;
  const query = new URLSearchParams(window.location.search);
  const requestedSchool = query.get('campus')?.trim() || query.get('schoolId')?.trim();
  if (requestedSchool) return requestedSchool === schoolId;
  const school = query.get('school')?.trim();
  if (!school) return true;
  const matches = findSchoolsByCode(school);
  return matches.length === 1 && matches[0].id === schoolId;
}

/** Keep the browser history entry, unrelated UI parameters, campus selection and fragment. */
export function replaceServiceListQuery(
  pathname: string,
  schoolId: string,
  ownedKeys: readonly string[],
  values: URLSearchParams,
): void {
  if (!isCurrentServiceList(pathname, schoolId)) return;
  const url = new URL(window.location.href);
  for (const key of ownedKeys) {
    url.searchParams.delete(key);
    const value = values.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  url.searchParams.set('schoolId', schoolId);
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    window.dispatchEvent(new Event(SERVICE_LIST_CHANGE_EVENT));
  } catch {
    // The visible filters still work when the browser denies History access.
  }
}
