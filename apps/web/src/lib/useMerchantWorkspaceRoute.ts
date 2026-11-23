'use client';

import { useCallback, useEffect, useSyncExternalStore, type MouseEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isCurrentTabNavigationClick } from './currentTabNavigation';
import {
  merchantWorkspaceHref,
  readMerchantWorkspaceLocation,
  type MerchantWorkspaceLocation,
} from './merchantWorkspaceNavigation';

const CHANGE_EVENT = 'nuni-merchant-workspace-navigation';
const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};
const snapshot = () => `${window.location.pathname}${window.location.search}`;
const serverSnapshot = () => null;

/** The URL selects a workspace; the authenticated API still decides access. */
export function useMerchantWorkspaceRoute(enabled: boolean) {
  const routerPathname = usePathname();
  const routerSearch = useSearchParams();
  useEffect(() => {
    // Also observe navigation from the site's menu or another Next link.
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [routerPathname, routerSearch]);
  const url = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const location: MerchantWorkspaceLocation =
    enabled && url
      ? readMerchantWorkspaceLocation(new URL(url, 'https://nuni.local').searchParams)
      : { status: 'list' };
  const navigate = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!isCurrentTabNavigationClick(event, event.currentTarget)) return;
    const destination = new URL(event.currentTarget.href);
    // Let Next handle an actual route change. Within this page, keep the same
    // account-owned draft caches while giving Back and Forward real entries.
    if (
      destination.origin !== window.location.origin ||
      destination.pathname !== '/merchant/workspace' ||
      window.location.pathname !== destination.pathname
    )
      return;
    const target = readMerchantWorkspaceLocation(destination.searchParams);
    const href =
      target.status === 'selected' ? merchantWorkspaceHref(target) : '/merchant/workspace';
    try {
      if (`${window.location.pathname}${window.location.search}` !== href) {
        const state = { ...window.history.state };
        // Next skips synchronization for router-owned writes. Its patched
        // History API copies current internals; retain unrelated state only.
        delete state.__NA;
        delete state._N;
        delete state.__PRIVATE_NEXTJS_INTERNALS_TREE;
        window.history.pushState(state, '', href);
        window.dispatchEvent(new Event(CHANGE_EVENT));
      }
      event.preventDefault();
    } catch {
      // A real link remains usable when the browser denies History access.
    }
  }, []);
  return { location, hydrated: url !== null, navigate };
}
