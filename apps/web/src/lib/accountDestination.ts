import { sanitizeInternalPath } from './navigation';

/** Platform login cannot establish a separate school identity. */
export function platformDestination(value?: string | null): string {
  const safe = sanitizeInternalPath(value && value.length <= 1200 ? value : null, '/classroom');
  const path = new URL(safe, 'https://campus.local').pathname;
  if (
    [
      '/',
      '/profile',
      '/settings',
      '/social',
      '/classroom',
      '/classroom/account',
      '/admin',
    ].includes(path) ||
    /^\/classroom\/course\/cw_[0-9a-f-]{36}$/.test(path)
  )
    return safe;
  return '/classroom';
}
