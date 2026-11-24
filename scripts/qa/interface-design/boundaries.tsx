import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import type { LinkProps } from 'next/link';

import { onRouterTransitionStart } from '../../../apps/web/src/instrumentation-client';

// Only data providers, Next routing and network boundaries are replaced. Product
// navigation, disclosures, controls, content components and CSS remain real.
const query = new URLSearchParams(location.search);
export const fixtureOptions = query;
const listeners = new Set<() => void>();
const schools = [
  { id: 'pu', code: 'PU', name: '靜宜大學', shortName: '靜宜', status: 'open' },
  { id: 'nchu', code: 'NCHU', name: '國立中興大學', shortName: '中興', status: 'open' },
];
const routeQuery = new URLSearchParams(query);
for (const key of ['path', 'theme', 'role', 'text', 'motion', 'font']) routeQuery.delete(key);
if (!['school', 'schoolId', 'campus'].some((key) => routeQuery.has(key))) {
  routeQuery.set('schoolId', 'pu');
  routeQuery.set('campus', 'pu');
}
let state = {
  pathname: query.get('path') || (location.pathname === '/index.html' ? '/' : location.pathname),
  search: routeQuery.toString(),
  schoolId: 'pu' as string | null,
};
history.replaceState(routerState(state), '', state.pathname + '?' + state.search);
const role = query.get('role') || 'student';
const ledger = { requests: [] as string[], navigations: [] as string[], logouts: 0 };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;
function update(next: typeof state) {
  state = next;
  listeners.forEach((listener) => listener());
}
function useFixture() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function routerState(route: typeof state) {
  // Like App Router's HistoryUpdater, each commit supplies fresh router internals.
  return {
    __NA: true,
    __PRIVATE_NEXTJS_INTERNALS_TREE: {
      tree: [route.pathname],
      renderedSearch: route.search ? '?' + route.search : '',
    },
  };
}

export function navigate(href: string, type: 'push' | 'replace' = 'push') {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) throw new Error('Fixture navigation must remain local');
  ledger.navigations.push(href);
  const destination = { ...state, pathname: url.pathname, search: url.search.slice(1) };
  const destinationUrl = url.pathname + url.search + url.hash;
  onRouterTransitionStart(destinationUrl, type);
  const currentUrl = location.pathname + location.search + location.hash;
  const push = type === 'push' && destinationUrl !== currentUrl;
  history[push ? 'pushState' : 'replaceState'](routerState(destination), '', destinationUrl);
  update(destination);
}
window.addEventListener('popstate', () => {
  onRouterTransitionStart(location.pathname + location.search + location.hash, 'traverse');
  // Search can replace its query directly in browser history between router commits.
  update({
    ...state,
    pathname: location.pathname,
    search: location.search.slice(1),
  });
});
export default function Link({
  href = '/',
  onClick,
  onNavigate,
  replace,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & Pick<LinkProps, 'onNavigate' | 'replace'>) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target && event.currentTarget.target !== '_self') ||
      event.currentTarget.hasAttribute('download') ||
      new URL(event.currentTarget.href).origin !== location.origin
    )
      return;
    event.preventDefault();
    let cancelled = false;
    onNavigate?.({
      preventDefault: () => {
        cancelled = true;
      },
    });
    if (!cancelled) navigate(String(href), replace ? 'replace' : 'push');
  }
  return (
    <a {...props} href={href} onClick={follow}>
      {children}
    </a>
  );
}
export const usePathname = () => useFixture().pathname;
export const useSearchParams = () => new URLSearchParams(useFixture().search);
export const useRouter = () => ({
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, 'replace'),
});
export const useAuth = () => ({
  user: null,
  loading: false,
  error: null,
  signOutUser: async () => {
    ledger.logouts += 1;
  },
});
export const useNuniSession = () => ({
  session:
    role === 'guest'
      ? null
      : {
          platformAccountId: 'synthetic-interface-account',
          context: 'synthetic-session',
          isPlatformOperator: role === 'operator',
        },
  loading: false,
  error: null,
  pendingLogout: false,
  logout: async () => {
    ledger.logouts += 1;
  },
  refresh: async () => {},
});
export const useOptionalNuniSession = useNuniSession;
export function useSelectedSchool() {
  const current = useFixture();
  return {
    schools,
    selectedSchool: schools.find((school) => school.id === current.schoolId) ?? null,
    selectedSchoolId: current.schoolId,
    loading: false,
    catalogStatus: 'ready',
    selectSchool: (schoolId: string | null) => update({ ...state, schoolId }),
  };
}
export const useOptionalSelectedSchool = useSelectedSchool;
export const isFirebaseConfigured = () => false;
// The full assistant is lazy-loaded by the header. Keep its infrastructure
// imports available, but fail loudly if this isolated fixture attempts access.
const unavailableFirebase = () => {
  throw new Error('Firebase access is disabled in the interface fixture');
};
export const getAuth = unavailableFirebase;
export const getDb = unavailableFirebase;
export const getFunctionsInstance = unavailableFirebase;
export const getCloudFunctionUrl = unavailableFirebase;
export const fetchAssistantWritePermissions = unavailableFirebase;
export const watchAccountNotifications = () => () => {};
export const notificationDestination = () => null;
export const usePersonalTodayRecords = () => {
  throw new Error('The fixture supplies StudentToday records directly');
};
export const interpretCampusRequest = async () => {
  throw new Error('Semantic network is disabled in the interface fixture');
};
export const browserRequest = async (action: string) => {
  if (action === 'sign-in-options') return { google: true, studentId: true };
  throw new Error('Platform network is disabled in the interface fixture');
};

window.fetch = async (input) => {
  ledger.requests.push(String(input));
  throw new Error('Unexpected network request in interface fixture: ' + String(input));
};
Object.assign(window, { __interfaceQA: { snapshot: () => ({ ...ledger, role, state }) } });
