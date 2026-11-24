import {
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

// Only identity, campus selection, routing and infrastructure are synthetic.
// The workspace, composer, conversation, response rendering and CSS are real.
export const fixtureOptions = new URLSearchParams(location.search);
const schools = [
  { id: 'pu', code: 'PU', name: '合成校園・靜宜大學', shortName: '合成靜宜', status: 'open' },
  { id: 'ntu', code: 'NTU', name: '合成校園・臺灣大學', shortName: '合成臺大', status: 'open' },
];
let state = {
  owner: 'qa-alpha',
  guest: fixtureOptions.get('guest') === '1',
  schoolId: 'pu' as string | null,
  pathname: '/',
  search: 'school=PU&schoolId=pu&campus=pu',
  checking: false,
  cloudReady: true,
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;
export const useFixture = () => useSyncExternalStore(subscribe, snapshot, snapshot);
function update(change: Partial<typeof state>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}
const ledger = {
  requests: [] as Array<{ path: string; method: string; body: Record<string, unknown> | null }>,
  navigations: [] as string[],
  unexpected: [] as string[],
};
export function navigate(href: string) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) throw new Error('Fixture navigation must stay local');
  ledger.navigations.push(url.pathname + url.search + url.hash);
  history.pushState({}, '', url.pathname + url.search + url.hash);
  update({ pathname: url.pathname, search: url.search.slice(1) });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
addEventListener('popstate', () =>
  update({ pathname: location.pathname, search: location.search.slice(1) }),
);

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
export function useSearchParams() {
  const query = useFixture().search;
  return useMemo(() => new URLSearchParams(query), [query]);
}
export const useRouter = () => ({ push: navigate, replace: navigate });
export function switchAccount() {
  update({ owner: state.owner === 'qa-alpha' ? 'qa-beta' : 'qa-alpha', guest: false });
}
export function setGuest(guest: boolean) {
  update({ guest });
}
export function setChecking(checking: boolean) {
  update({ checking });
}
export function setCloudReady(cloudReady: boolean) {
  update({ cloudReady });
}
export function selectCampus(schoolId: string | null) {
  const school = schools.find((item) => item.id === schoolId);
  const search = school
    ? `school=${school.code}&schoolId=${school.id}&campus=${school.id}`
    : 'campus=all';
  history.replaceState({}, '', state.pathname + '?' + search);
  update({ schoolId, search });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function useAuth() {
  const current = useFixture();
  // Platform-only identity exercises the real Nuni Conversation without a
  // synthetic school token or any Firebase account.
  return {
    user: null,
    loading: current.checking,
    error: null,
    signOutUser: async () => setGuest(true),
  };
}
export function useNuniSession() {
  const current = useFixture();
  return {
    session: current.guest
      ? null
      : {
          platformAccountId: current.owner,
          context: (current.owner === 'qa-alpha' ? 'a' : 'b').repeat(43),
        },
    loading: current.checking,
    error: null,
    pendingLogout: false,
    refresh: async () => {},
    logout: async () => setGuest(true),
  };
}
export const useOptionalNuniSession = useNuniSession;
export function useSelectedSchool() {
  const current = useFixture();
  return {
    schools,
    selectedSchool: schools.find((item) => item.id === current.schoolId) ?? null,
    selectedSchoolId: current.schoolId,
    loading: current.checking,
    catalogStatus: 'ready',
    selectSchool: selectCampus,
    onRetryCatalog: () => {},
  };
}
export const useOptionalSelectedSchool = useSelectedSchool;
export function NuniSessionProvider({ children }: { children: ReactNode }) {
  return children;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}
export const AuthGuard = AuthProvider;
export const GuestAuthProvider = AuthProvider;
export const SelectedSchoolProvider = AuthProvider;

function unexpected(name: string): never {
  ledger.unexpected.push(name);
  throw new Error('Real infrastructure is disabled in AI workspace QA: ' + name);
}
export async function browserRequest(path: string) {
  return unexpected('browserRequest:' + path);
}
export async function browserUpload(path: string) {
  return unexpected('browserUpload:' + path);
}

const json = (value: object) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  const body =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  ledger.requests.push({ path: url.pathname, method, body });
  if (url.origin !== location.origin) return unexpected('external-fetch:' + url.origin);
  if (url.pathname === '/api/nuni/assistant/capability' && method === 'GET')
    return json({
      enabled: true,
      ready: state.cloudReady,
      version: 2,
      planning: true,
      fallback: false,
    });
  if (url.pathname === '/api/nuni/assistant/ask' && method === 'POST') {
    if (
      !body ||
      typeof body.question !== 'string' ||
      body.consent !== true ||
      state.guest ||
      !state.cloudReady
    )
      return unexpected('unconsented-or-unavailable-ask');
    // The reply is explicitly synthetic; there are no actionable write cards.
    return json({
      answer: `合成回覆：已為 ${state.owner} 整理「${body.question}」。`,
      steps: [],
      cards: [],
    });
  }
  return unexpected(method + ':' + url.pathname);
};
Object.assign(window, {
  __aiWorkspaceQA: {
    snapshot: () => ({ state, ...ledger }),
    navigate,
    switchAccount,
    selectCampus,
    setGuest,
    setChecking,
    setCloudReady,
  },
});
