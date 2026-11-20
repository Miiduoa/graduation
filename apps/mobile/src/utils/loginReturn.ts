import { sanitizeLoginReturnPath } from '@campus/shared/src/signedInSocialReads';
import { safeNavigate } from './safeNavigate';

export type LoginReturnDestination = {
  route: string;
  params?: Record<string, unknown>;
};

export function parseLoginReturnTo(value?: string | null): LoginReturnDestination | null {
  const path = sanitizeLoginReturnPath(value, '');
  if (!path) return null;
  let url: URL;
  try {
    url = new URL(path, 'https://campus.local');
  } catch {
    return null;
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/cafeteria') return { route: 'Cafeteria' };
  const storefront = pathname.match(/^\/cafeteria\/([^/]+)$/);
  if (storefront?.[1] && storefront[1] !== 'order') {
    try {
      return { route: 'Storefront', params: { cafeteriaId: decodeURIComponent(storefront[1]) } };
    } catch {
      return null;
    }
  }
  if (pathname === '/lost-found') return { route: 'LostFound' };
  if (pathname === '/lost-found/post') return { route: 'LostFoundPost' };
  const lostFound = pathname.match(/^\/lost-found\/([^/]+)$/);
  if (lostFound?.[1]) {
    try {
      return { route: 'LostFoundDetail', params: { id: decodeURIComponent(lostFound[1]) } };
    } catch {
      return null;
    }
  }
  return null;
}

export function finishLoginReturn(
  navigation:
    | {
        goBack?: () => void;
        navigate?: (...args: unknown[]) => void;
        getState?: () => unknown;
        getParent?: () => unknown;
      }
    | null
    | undefined,
  returnTo?: string | null,
): boolean {
  const destination = parseLoginReturnTo(returnTo);
  if (destination) {
    safeNavigate(navigation, destination.route, destination.params);
    return true;
  }
  navigation?.goBack?.();
  return false;
}
