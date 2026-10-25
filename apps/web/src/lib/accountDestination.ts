import { sanitizeInternalPath } from './navigation';
import { isPublicCampusPath } from './publicCampusServices';

/** Platform login cannot establish a separate school identity. */
export function platformDestination(value?: string | null): string {
  const safe = sanitizeInternalPath(value && value.length <= 1200 ? value : null, '/classroom');
  const destination = new URL(safe, 'https://campus.local');
  const path = destination.pathname;
  if (
    isPublicCampusPath(path) ||
    (path === '/grades' && destination.searchParams.get('tab') === 'feedback') ||
    [
      '/',
      '/profile',
      '/settings',
      '/social',
      '/classroom',
      '/classroom/account',
      '/classroom/grades',
      '/admin',
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
