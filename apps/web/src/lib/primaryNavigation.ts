import { CAMPUS_SERVICES } from './campusServices';

export type PrimaryNavigationSection = 'today' | 'study' | 'life' | 'me' | 'more';

const standaloneServices = new Set(['/admin', '/merchant', '/ai-assistant', '/support']);

function includesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function primaryNavigationSection(
  pathname: string | null | undefined,
): PrimaryNavigationSection | null {
  if (!pathname) return null;
  // /today、/hub 有轉址 page 進首頁；區塊別名仍對應 today／life。
  if (pathname === '/' || pathname === '/today' || pathname === '/today-v2') return 'today';
  if (pathname === '/life' || pathname === '/hub') return 'life';
  if (includesRoute(pathname, '/orders') || includesRoute(pathname, '/food') || pathname === '/shops')
    return 'life';
  if (pathname === '/me') return 'me';
  if (pathname === '/search') return 'more';
  if (includesRoute(pathname, '/course') || includesRoute(pathname, '/classroom')) {
    if (pathname === '/classroom/account' || pathname.startsWith('/classroom/account/')) return 'me';
    if (pathname === '/classroom/login' || pathname.startsWith('/classroom/login/')) return null;
    return 'study';
  }

  const service = CAMPUS_SERVICES.filter((item) =>
    includesRoute(pathname, item.href.split(/[?#]/, 1)[0]),
  ).sort((first, second) => second.href.length - first.href.length)[0];
  if (!service) return null;
  if (standaloneServices.has(service.href)) return 'more';
  if (service.category === 'study') return 'study';
  if (service.category === 'account') return 'me';
  return 'life';
}
