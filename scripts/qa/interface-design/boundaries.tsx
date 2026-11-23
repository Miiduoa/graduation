import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

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
history.replaceState(
  { ...history.state, interfaceRoute: state },
  '',
  state.pathname + '?' + state.search,
);
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

export function navigate(href: string) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) throw new Error('Fixture navigation must remain local');
  ledger.navigations.push(href);
  // The routing boundary supplies synthetic route data; use actual browser
  // history so product return-entry handling is not simulated by pathname alone.
  // Product search publishes its filters with replaceState before the router
  // acknowledges them. Preserve the real source URL in this routing boundary.
  const source = { ...state, pathname: location.pathname, search: location.search.slice(1) };
  history.replaceState({ ...history.state, interfaceRoute: source }, '');
  const destination = { ...source, pathname: url.pathname, search: url.search.slice(1) };
  const destinationUrl = url.pathname + url.search + url.hash;
  if (destinationUrl !== location.pathname + location.search + location.hash) {
    history.pushState({ interfaceRoute: destination }, '', destinationUrl);
  }
  update(destination);
}
window.addEventListener('popstate', () => {
  const restored = history.state?.interfaceRoute;
  update({
    ...state,
    pathname: restored?.pathname ?? location.pathname,
    search: restored?.search ?? location.search.slice(1),
  });
});
export default function Link({
  href = '/',
  onClick,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(String(href));
  }
  return (
    <a {...props} href={href} onClick={follow}>
      {children}
    </a>
  );
}
export const usePathname = () => useFixture().pathname;
export const useSearchParams = () => new URLSearchParams(useFixture().search);
export const useRouter = () => ({ push: navigate, replace: navigate });
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
