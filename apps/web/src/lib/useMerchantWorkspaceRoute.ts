'use client';

import { useCallback, useEffect, useSyncExternalStore, type MouseEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isCurrentTabNavigationClick } from './currentTabNavigation';
import {
  merchantApplicationsHref,
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
const isApplicationsView = (params: URLSearchParams | null) =>
  params?.get('view') === 'applications';

/** The URL selects a workspace; the authenticated API still decides access. */
export function useMerchantWorkspaceRoute(enabled: boolean) {
  const routerPathname = usePathname();
  const routerSearch = useSearchParams();
  useEffect(() => {
    // Also observe navigation from the site's menu or another Next link.
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [routerPathname, routerSearch]);
  const url = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const params = enabled && url ? new URL(url, 'https://nuni.local').searchParams : null;
  const location: MerchantWorkspaceLocation = params
    ? readMerchantWorkspaceLocation(params)
    : { status: 'list' };
  const showApplications = location.status === 'list' && isApplicationsView(params);
  const navigate = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!isCurrentTabNavigationClick(event, event.currentTarget)) return;
    const destination = new URL(event.currentTarget.href);
    if (destination.origin !== window.location.origin) return;
    const source = window.location.pathname;
    const target = readMerchantWorkspaceLocation(destination.searchParams);
    const toWorkspace = destination.pathname === '/merchant/workspace';
    const withinWorkspace = source === '/merchant/workspace' && toWorkspace;
    const fromOverview = source === '/merchant' && toWorkspace && target.status === 'selected';
    const toOverview = source === '/merchant/workspace' && destination.pathname === '/merchant';
    if (!withinWorkspace && !fromOverview && !toOverview) return;
    // Keep the mounted account workspace across the overview and store views.
    const href = toOverview
      ? '/merchant'
      : target.status === 'selected'
        ? merchantWorkspaceHref(target)
        : isApplicationsView(destination.searchParams)
          ? merchantApplicationsHref
          : '/merchant/workspace';
    try {
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href) {
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
  return { location, showApplications, hydrated: url !== null, navigate };
}
