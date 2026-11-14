import { CAMPUS_SERVICES } from './campusServices';
import { campusServicePathname } from './campusNavigationLinks';
import { PRIMARY_DESTINATIONS as SHARED_DESTINATIONS } from '@campus/shared/src/primaryDestinations';

const icons = {
  today: 'calendar',
  study: 'library',
  life: 'map',
  connect: 'community',
  me: 'profile',
} as const;
export const PRIMARY_DESTINATIONS = SHARED_DESTINATIONS.map((destination) => ({
  id: destination.id,
  label: destination.label,
  href: destination.webPath,
  icon: icons[destination.id],
}));

export type PrimaryNavigationSection = (typeof PRIMARY_DESTINATIONS)[number]['id'] | 'more';

const standaloneServices = new Set(['/admin', '/merchant', '/ai-assistant', '/support']);

function includesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function primaryNavigationSection(
  pathname: string | null | undefined,
): PrimaryNavigationSection | null {
  if (!pathname) return null;
  // Legacy home aliases redirect to /; keep their active destination consistent.
  if (['/', '/today', '/today-v2', '/hub'].includes(pathname)) return 'today';
  if (pathname === '/life') return 'life';
  if (pathname === '/connect') return 'connect';
  if (
    includesRoute(pathname, '/orders') ||
    includesRoute(pathname, '/food') ||
    pathname === '/shops'
  )
    return 'life';
  if (pathname === '/me' || includesRoute(pathname, '/auth/account')) return 'me';
  if (includesRoute(pathname, '/auth/platform/class-workspace')) return 'study';
  if (pathname === '/search') return 'more';
  if (includesRoute(pathname, '/course') || includesRoute(pathname, '/classroom')) {
    if (pathname === '/classroom/account' || pathname.startsWith('/classroom/account/'))
      return 'me';
    if (pathname === '/classroom/login' || pathname.startsWith('/classroom/login/')) return null;
    return 'study';
  }

  const servicePathname = campusServicePathname(pathname);
  const service = CAMPUS_SERVICES.filter((item) =>
    includesRoute(servicePathname, item.href.split(/[?#]/, 1)[0]),
  ).sort((first, second) => second.href.length - first.href.length)[0];
  if (!service) return null;
  if (standaloneServices.has(service.href)) return 'more';
  if (service.category === 'study') return 'study';
  if (service.category === 'account') return 'me';
  if (service.category === 'connect') return 'connect';
  return 'life';
}
