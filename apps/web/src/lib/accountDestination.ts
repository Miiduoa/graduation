import { sanitizeInternalPath } from './navigation';
import { isPublicCampusPath } from './publicCampusServices';

/** Return to an existing platform or personal tool without granting school identity. */
export function platformDestination(value?: string | null): string {
  const safe = sanitizeInternalPath(value && value.length <= 1200 ? value : null, '/classroom');
  const destination = new URL(safe, 'https://campus.local');
  const path = destination.pathname;
  if (
    isPublicCampusPath(path) ||
    // GradesPage defaults to platform course feedback; only the semester tab reads school records.
    (path === '/grades' && destination.searchParams.get('tab') !== 'semester') ||
    [
      '/',
      '/profile',
      '/settings',
      '/social',
      '/timetable',
      '/calendar',
      '/import',
      '/dormitory',
      '/food',
      '/classroom',
      '/classroom/account',
      '/classroom/grades',
      '/classroom/material-bookmarks',
      '/admin',
      '/admin/ops',
      '/admin/school-review',
      '/merchant',
      '/merchant/apply',
      '/merchant/workspace',
    ].includes(path) ||
    /^\/cafeteria\/[^/]+$/.test(path) ||
    /^\/classroom\/course\/cw_[0-9a-f-]{36}$/.test(path)
  )
    return safe;
  return '/classroom';
}
