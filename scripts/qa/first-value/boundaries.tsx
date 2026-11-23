import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// Only routing, account and data sources are synthetic. Product UI and CSS
// are bundled from the checkout and are never intercepted by this boundary.
export const fixtureOptions = new URLSearchParams(location.search);
export type Scenario =
  | 'setup' | 'setup-refresh' | 'coursework' | 'weekend' | 'loading' | 'error' | 'partial'
  | 'work-error' | 'work-error-with-known' | 'work-refresh-with-known'
  | 'skeleton' | 'needs-campus' | 'class' | 'existing-course' | 'different-campus' | 'guest';
const schools = [
  { id: 'ntu', code: 'NTU', name: '合成校園 NTU', status: 'open' },
  { id: 'nchu', code: 'NCHU', name: '合成校園 NCHU', status: 'open' },
];
let state = {
  scenario: (fixtureOptions.get('scenario') || 'setup') as Scenario,
  owner: 'alpha',
  schoolId: 'ntu' as string | null,
  pathname: '/',
  search: 'school=NTU&schoolId=ntu&campus=ntu',
  revision: 0,
};
const listeners = new Set<() => void>();
const ledger = { requests: [] as string[], navigations: [] as string[], timetableRetries: 0, workRetries: 0 };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => state;
export const useFixture = () => useSyncExternalStore(subscribe, snapshot, snapshot);
function update(change: Partial<typeof state>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}
export function selectScenario(scenario: Scenario) {
  if (scenario === 'needs-campus') selectCampus(null);
  update({ scenario });
}
export function selectCampus(schoolId: string | null) {
  const school = schools.find((item) => item.id === schoolId);
  update({
    schoolId,
    scenario: schoolId ? 'setup' : 'needs-campus',
    search: school ? `school=${school.code}&schoolId=${school.id}&campus=${school.id}` : 'campus=all',
  });
}
export function switchAccount() { update({ owner: state.owner === 'alpha' ? 'beta' : 'alpha', scenario: 'setup' }); }
export function refreshSameScope() { update({ revision: state.revision + 1, scenario: 'setup-refresh' }); }
export function retryTimetable() { ledger.timetableRetries += 1; update({ scenario: 'setup' }); }
export function retryWork() { ledger.workRetries += 1; update({ scenario: 'coursework' }); }

export function navigate(href: string) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) throw new Error('Fixture navigation must stay local');
  ledger.navigations.push(href);
  history.pushState({}, '', url.pathname + url.search + url.hash);
  update({ pathname: url.pathname, search: url.search.slice(1) });
}
export default function Link({ href = '/', onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(String(href));
  }
  return <a {...props} href={href} onClick={follow}>{children}</a>;
}
export const usePathname = () => useFixture().pathname;
export const useSearchParams = () => new URLSearchParams(useFixture().search);
export const useRouter = () => ({ push: navigate, replace: navigate });
export function useAuth() {
  const current = useFixture();
  return { user: current.scenario === 'guest' ? null : { uid: current.owner }, loading: false, error: null };
}
export function useNuniSession() {
  const current = useFixture();
  return {
    session: current.scenario === 'guest' ? null : { platformAccountId: current.owner, context: 'synthetic-only' },
    loading: false, error: null, pendingLogout: false,
  };
}
export const useOptionalNuniSession = useNuniSession;
export function useSelectedSchool() {
  const current = useFixture();
  return {
    schools, selectedSchool: schools.find((item) => item.id === current.schoolId) ?? null,
    selectedSchoolId: current.schoolId, loading: false, catalogStatus: 'ready', selectSchool: selectCampus,
  };
}
export const useOptionalSelectedSchool = useSelectedSchool;
export const isFirebaseConfigured = () => true;
export function watchAccountNotifications(
  input: { uid: string; schoolId: string },
  receive: (value: { notifications: unknown[] }) => void,
) {
  receive({ notifications: [{
    id: `notice-${input.uid}-${input.schoolId}`, source: 'account', read: false,
    type: 'fixture', title: `${input.uid} 的 ${input.schoolId} 合成通知`, body: '這則通知不依賴課程是否存在。',
  }] });
  return () => {};
}
export const notificationDestination = () => null;
const unavailable = () => { throw new Error('Real infrastructure is disabled in first-value QA'); };
export const usePersonalTodayRecords = unavailable;
export const getAuth = unavailable;
export const getDb = unavailable;
export const getFunctionsInstance = unavailable;
export const getCloudFunctionUrl = unavailable;
export const browserRequest = unavailable;
export const fetchAssistantWritePermissions = unavailable;

window.fetch = async (input) => {
  ledger.requests.push(String(input));
  throw new Error('Unexpected network request in first-value QA: ' + String(input));
};
Object.assign(window, { __firstValueQA: {
  snapshot: () => ({ ...ledger, state }),
  // Model-only background updates must not move focus to a fixture button.
  refreshSameScope,
  selectScenario,
} });
