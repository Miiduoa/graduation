import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// Only data providers, Next routing and network boundaries are replaced. Product
// navigation, disclosures, controls, content components and CSS remain real.
const query = new URLSearchParams(location.search);
const listeners = new Set<() => void>();
const schools = [
  { id: 'pu', code: 'PU', name: '靜宜大學', shortName: '靜宜', status: 'open' },
  { id: 'nchu', code: 'NCHU', name: '國立中興大學', shortName: '中興', status: 'open' },
];
let state = {
  pathname: query.get('path') || '/',
  search: 'schoolId=pu&campus=pu',
  schoolId: 'pu' as string | null,
};
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
  update({ ...state, pathname: url.pathname, search: url.search.slice(1) });
}
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
export const watchAccountNotifications = () => () => {};
export const notificationDestination = () => null;
export const usePersonalTodayRecords = () => {
  throw new Error('The fixture supplies StudentToday records directly');
};
export const interpretCampusRequest = async () => {
  throw new Error('Semantic network is disabled in the interface fixture');
};
export const browserRequest = async () => {
  throw new Error('Platform network is disabled in the interface fixture');
};

window.fetch = async (input) => {
  ledger.requests.push(String(input));
  throw new Error('Unexpected network request in interface fixture: ' + String(input));
};
Object.assign(window, { __interfaceQA: { snapshot: () => ({ ...ledger, role, state }) } });
