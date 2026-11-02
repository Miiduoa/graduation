import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler, type MouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchPage from '@/app/search/page';
import AssistantPage from '@/app/ai-assistant/page';
import { interpretCampusRequest, type CampusIntentResult } from '@/lib/campusIntentClient';
import {
  getCloudNavigationPreview,
  runCloudNavigationTask,
  type CloudNavigationPreviewResult,
  type CloudNavigationResult,
} from '@/lib/cloudNavigationClient';
import { QuickCampusEntry } from './QuickCampusEntry';
import { SchoolSelector } from './SchoolSelector';
import { SelectedSchoolProvider, schoolPreferenceKey, useSelectedSchool } from './SelectedSchoolProvider';

const auth = vi.hoisted(() => ({ uid: 'alice', loading: false }));
const navigation = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: auth.uid ? { uid: auth.uid } : null,
    loading: auth.loading,
    error: null,
    signOutUser: vi.fn(),
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ session: null, loading: false, pendingLogout: false, error: null }),
}));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ studentId: false, loading: false, error: false }),
}));
vi.mock('@/lib/campusIntentClient', () => ({ interpretCampusRequest: vi.fn() }));
vi.mock('@/lib/cloudNavigationClient', () => ({
  getCloudNavigationPreview: vi.fn(),
  runCloudNavigationTask: vi.fn(),
}));
vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    navigation.listeners.add(listener);
    return () => { navigation.listeners.delete(listener); };
  };
  const snapshot = () => window.location.href;
  function useHref() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
  return {
    useRouter: () => navigation,
    usePathname: () => new URL(useHref()).pathname,
    useSearchParams: () => {
      const href = useHref();
      return useMemo(() => new URL(href).searchParams, [href]);
    },
  };
});

const schools = [
  { id: 'pu', name: '甲校', code: 'PU' },
  { id: 'nthu', name: '乙校', code: 'NTHU' },
];
const QUERY = '從圖書館走到活動中心';
const SUMMARY = '合成回覆：先開啟校園地圖';
const navigationUrl = 'https://www.google.com/maps/dir/?api=1&origin=24.226282%2C120.581377&destination=24.227%2C120.582&travelmode=walking';
type Entry = 'quick' | 'search' | 'navigation';
type Commit = { school: string | null; text: string; inputs: string[] };
const commits: Commit[] = [];
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalDialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

function notifyNavigation() { navigation.listeners.forEach((listener) => listener()); }
function move(href: string) {
  window.history.pushState({ ...window.history.state }, '', href);
  notifyNavigation();
}
function visit(href: string) { act(() => move(href)); }
function campusPath(path: string, schoolId = 'pu') {
  return `${path}?campus=${schoolId}&schoolId=${schoolId}`;
}
function entryPath(entry: Entry) {
  return campusPath(entry === 'quick' ? '/' : entry === 'search' ? '/search' : '/ai-assistant');
}
function recordCommit() {
  commits.push({
    school: document.querySelector('[data-testid="journey-school"]')?.getAttribute('data-school') ?? null,
    text: document.body.textContent ?? '',
    inputs: [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].map((input) => input.value),
  });
}
function SelectedScope() {
  const selection = useSelectedSchool();
  return <output data-testid="journey-school" data-school={selection.selectedSchoolId ?? ''} />;
}
function RouteOutlet() {
  const path = usePathname();
  if (path === '/search') return <SearchPage />;
  if (path === '/ai-assistant') return <AssistantPage />;
  if (path === '/') return <QuickCampusEntry />;
  return <p>已離開助理入口</p>;
}
function routeLink(event: MouseEvent<HTMLDivElement>) {
  const anchor = event.target instanceof Element ? event.target.closest('a') : null;
  if (!anchor || anchor.target === '_blank') return;
  const target = new URL(anchor.href, window.location.href);
  if (target.origin !== window.location.origin) return;
  event.preventDefault();
  navigation.push(`${target.pathname}${target.search}${target.hash}`);
}
function Journey() {
  return (
    <Profiler id="agent-draft-journey" onRender={recordCommit}>
      <SelectedSchoolProvider
        ownerKey={auth.uid ? `firebase:${auth.uid}` : null}
        loading={auth.loading}
        schools={schools}
        catalogStatus="ready"
      >
        <div onClick={routeLink}>
          <SelectedScope />
          <section aria-label="旅程選校"><SchoolSelector /></section>
          <RouteOutlet />
        </div>
      </SelectedSchoolProvider>
    </Profiler>
  );
}
function composer(entry: Entry) {
  return screen.getByRole(entry === 'navigation' ? 'textbox' : 'searchbox', {
    name: entry === 'quick' ? '想做什麼？' : entry === 'search' ? '想找什麼？' : '出發地與目的地',
  }) as HTMLInputElement | HTMLTextAreaElement;
}
async function mount(entry: Entry) {
  window.history.replaceState({ __NA: true, tree: ['fixture-root'] }, '', entryPath(entry));
  const view = render(<Journey />);
  await waitFor(() => expect(composer(entry).disabled).toBe(false));
  return view;
}
function write(entry: Entry, value = QUERY) {
  fireEvent.change(composer(entry), { target: { value } });
}
async function review(entry: Entry) {
  if (entry === 'navigation') {
    fireEvent.submit(screen.getByRole('form', { name: '預覽導航查詢' }));
    await screen.findByRole('region', { name: '雲端查詢預覽' });
  } else {
    fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
    expect(screen.getByRole('heading', { name: '確認傳送內容' })).toBeTruthy();
  }
}
function submit(entry: Entry) {
  fireEvent.click(screen.getByRole('checkbox', { name: /我同意將/ }));
  fireEvent.click(screen.getByRole('button', { name: entry === 'navigation' ? '確認規劃' : '確認並找入口' }));
}
function selectSchool(id: string) {
  fireEvent.change(within(screen.getByRole('region', { name: '旅程選校' })).getByRole('combobox', { name: '瀏覽校園' }), { target: { value: id } });
}
function observeStorageWrites() {
  const owner = Object.prototype.hasOwnProperty.call(localStorage, 'setItem')
    ? localStorage
    : Object.getPrototypeOf(localStorage);
  return vi.spyOn(owner, 'setItem');
}
function expectFreshConfirmation(entry: Entry) {
  expect(screen.queryByRole('checkbox', { name: /我同意將/ })).toBeNull();
  expect(screen.queryByText(SUMMARY)).toBeNull();
  expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
  expect(screen.queryByRole('region', { name: '本頁任務紀錄' })).toBeNull();
  expect(screen.getByRole('button', { name: entry === 'navigation' ? '預覽傳送內容' : '查看傳送內容' })).toBeTruthy();
}
function semanticResult(): CampusIntentResult {
  return { status: 'understood', source: 'model', summary: SUMMARY, destinations: ['/map'], clarifyingQuestion: null, checkedAt: '2026-11-02T03:05:00.000Z' };
}
function previewResult(schoolId: string, query: string): CloudNavigationPreviewResult {
  return {
    status: 'preview', provider: 'groq', model: 'openai/gpt-oss-120b', schoolId, query,
    checkedAt: '2026-11-02T03:04:00.000Z', sourceUpdatedAt: null,
    fingerprint: 'a'.repeat(64), cloudReady: true,
    places: [
      { ref: 'p0', name: '圖書館', category: '圖書館', aliases: ['總圖'] },
      { ref: 'p1', name: '活動中心', category: '生活', aliases: ['學生活動中心'] },
    ],
  };
}
function completed(schoolId = 'pu'): CloudNavigationResult {
  return {
    status: 'completed', provider: 'groq', model: 'openai/gpt-oss-120b', schoolId,
    checkedAt: '2026-11-02T03:05:00.000Z', sourceUpdatedAt: null,
    route: {
      from: { id: 'library', name: '圖書館', schoolId, lat: 24.226282, lng: 120.581377 },
      to: { id: 'activity', name: '活動中心', schoolId, lat: 24.227, lng: 120.582 },
      navigationUrl,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function pendingResult(entry: Entry) {
  const semantic = deferred<CampusIntentResult>();
  const route = deferred<CloudNavigationResult>();
  vi.mocked(interpretCampusRequest).mockReturnValue(semantic.promise);
  vi.mocked(runCloudNavigationTask).mockReturnValue(route.promise);
  return {
    signal: () => entry === 'navigation'
      ? vi.mocked(runCloudNavigationTask).mock.calls[0]?.[1]
      : vi.mocked(interpretCampusRequest).mock.calls[0]?.[0].signal,
    finish: async () => { await act(async () => { semantic.resolve(semanticResult()); route.resolve(completed()); }); },
  };
}

beforeEach(() => {
  auth.uid = 'alice';
  auth.loading = false;
  commits.length = 0;
  navigation.listeners.clear();
  navigation.push.mockReset().mockImplementation(move);
  navigation.replace.mockReset().mockImplementation((href: string) => {
    window.history.replaceState({ ...window.history.state }, '', href);
    notifyNavigation();
  });
  vi.mocked(interpretCampusRequest).mockReset().mockResolvedValue(semanticResult());
  vi.mocked(getCloudNavigationPreview).mockReset().mockImplementation(async ({ schoolId, query }) => previewResult(schoolId, query));
  vi.mocked(runCloudNavigationTask).mockReset().mockResolvedValue(completed());
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected transport in synthetic journey'))));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => {
  cleanup();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalDialogClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalDialogClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('Agent drafts across real entry components', () => {
  it('hands Quick text to search only through its explicit Link and preserves newer search edits on return', async () => {
    await mount('quick');
    write('quick', '先找圖書館');
    fireEvent.click(screen.getByRole('link', { name: '搜尋更多服務' }));
    expect(composer('search').value).toBe('先找圖書館');
    write('search', '保留修改後的搜尋');
    fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
    await review('search');
    fireEvent.click(screen.getByRole('checkbox', { name: /我同意將/ }));
    visit(campusPath('/away'));
    visit(`${entryPath('search')}&q=先找圖書館`);
    expect(composer('search').value).toBe('保留修改後的搜尋');
    expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe('true');
    expectFreshConfirmation('search');
    visit(entryPath('quick'));
    expect(composer('quick').value).toBe('先找圖書館');
    write('quick', '這次改找餐廳');
    fireEvent.click(screen.getByRole('link', { name: '搜尋更多服務' }));
    expect(composer('search').value).toBe('這次改找餐廳');
    expect(within(screen.getByRole('group', { name: '服務分類' })).getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it('hands Quick text to the navigation page without submitting or reviving a reviewed plan', async () => {
    await mount('quick');
    write('quick');
    fireEvent.click(screen.getByRole('link', { name: '詢問校園助理' }));
    expect(composer('navigation').value).toBe(QUERY);
    expect(getCloudNavigationPreview).not.toHaveBeenCalled();
    write('navigation', '從活動中心走到圖書館');
    await review('navigation');
    fireEvent.click(screen.getByRole('checkbox', { name: /我同意將/ }));
    visit(campusPath('/away'));
    visit(`${entryPath('navigation')}&q=${encodeURIComponent(QUERY)}`);
    expect(composer('navigation').value).toBe('從活動中心走到圖書館');
    expectFreshConfirmation('navigation');
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it.each<Entry>(['quick', 'search', 'navigation'])('%s keeps only text when leaving a completed task and returning', async (entry) => {
    await mount(entry);
    write(entry);
    await review(entry);
    submit(entry);
    if (entry === 'navigation') await screen.findByRole('region', { name: '導航建議' });
    else await screen.findByText(SUMMARY);
    visit(campusPath('/away'));
    visit(entryPath(entry));
    expect(composer(entry).value).toBe(QUERY);
    expectFreshConfirmation(entry);
    expect(entry === 'navigation' ? runCloudNavigationTask : interpretCampusRequest).toHaveBeenCalledTimes(1);
    await review(entry);
    expect((screen.getByRole('checkbox', { name: /我同意將/ }) as HTMLInputElement).checked).toBe(false);
  });

  it.each<Entry>(['quick', 'search', 'navigation'])('%s discards a pending reply after leaving, while keeping the editable draft', async (entry) => {
    const pending = pendingResult(entry);
    await mount(entry);
    write(entry);
    await review(entry);
    submit(entry);
    expect(pending.signal()?.aborted).toBe(false);
    visit(campusPath('/away'));
    expect(pending.signal()?.aborted).toBe(true);
    visit(entryPath(entry));
    await pending.finish();
    expect(composer(entry).value).toBe(QUERY);
    expectFreshConfirmation(entry);
  });

  it.each<Entry>(['quick', 'search', 'navigation'])('%s cancels school switching without storage, routing, or a downstream school change', async (entry) => {
    const pending = pendingResult(entry);
    await mount(entry);
    write(entry);
    await review(entry);
    submit(entry);
    const storage = observeStorageWrites();
    const oldUrl = window.location.href;
    navigation.push.mockClear();
    navigation.replace.mockClear();
    commits.length = 0;
    selectSchool('nthu');
    const dialog = screen.getByRole('dialog', { name: '切換校園？' });
    fireEvent.click(within(dialog).getByRole('button', { name: '繼續編輯' }));
    expect(storage).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(window.location.href).toBe(oldUrl);
    expect(composer(entry).value).toBe(QUERY);
    expect(pending.signal()?.aborted).toBe(false);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((commit) => commit.school === 'pu')).toBe(true);
    await pending.finish();
    if (entry === 'navigation') await screen.findByRole('region', { name: '導航建議' });
    else await screen.findByText(SUMMARY);
  });

  it.each<Entry>(['quick', 'search', 'navigation'])('%s confirms school switching, clears text, and rejects late old-school results even after ABA', async (entry) => {
    const pending = pendingResult(entry);
    await mount(entry);
    write(entry);
    await review(entry);
    submit(entry);
    const storage = observeStorageWrites();
    selectSchool('nthu');
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: '切換校園？' })).getByRole('button', { name: '清除草稿並切換' }));
    await waitFor(() => expect(screen.getByTestId('journey-school').getAttribute('data-school')).toBe('nthu'));
    expect(composer(entry).value).toBe('');
    expect(storage).toHaveBeenCalledWith(schoolPreferenceKey('firebase:alice'), JSON.stringify({ schoolId: 'nthu' }));
    expect(localStorage.getItem(schoolPreferenceKey('firebase:alice'))).toBe(JSON.stringify({ schoolId: 'nthu' }));
    expect(pending.signal()?.aborted).toBe(true);
    commits.length = 0;
    selectSchool('pu');
    await pending.finish();
    expect(composer(entry).value).toBe('');
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(screen.queryByRole('region', { name: '導航建議' })).toBeNull();
    expect(commits.every((commit) => !commit.text.includes(SUMMARY) && !commit.inputs.includes(QUERY))).toBe(true);
  });

  it.each<Entry>(['search', 'navigation'])('%s rejects an old account history entry in every commit after an account change while away', async (entry) => {
    const view = await mount(entry);
    const privateDraft = '甲帳號獨有的合成草稿';
    write(entry, privateDraft);
    const oldUrl = new URL(window.location.href);
    oldUrl.searchParams.set('q', privateDraft);
    const oldState: unknown = structuredClone(window.history.state);
    visit(campusPath('/away'));
    auth.uid = 'bob';
    view.rerender(<Journey />);
    commits.length = 0;
    // Replay a saved history entry; real Next/browser Back is verified separately.
    act(() => {
      window.history.replaceState(oldState, '', oldUrl);
      notifyNavigation();
    });
    expect(composer(entry).value).toBe('');
    const replayRetainedQuery = new URL(window.location.href).searchParams.has('q');
    auth.uid = 'alice';
    view.rerender(<Journey />);
    expect(composer(entry).value).toBe('');
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((commit) => !commit.text.includes(privateDraft) && !commit.inputs.includes(privateDraft))).toBe(true);
    expect(replayRetainedQuery).toBe(false);
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(runCloudNavigationTask).not.toHaveBeenCalled();
  });

  it.each<Entry>(['quick', 'search', 'navigation'])('%s retains same-account text across background verification but invalidates pending consent and replies', async (entry) => {
    const pending = pendingResult(entry);
    const view = await mount(entry);
    write(entry);
    await review(entry);
    submit(entry);
    auth.loading = true;
    view.rerender(<Journey />);
    expect(pending.signal()?.aborted).toBe(true);
    await pending.finish();
    auth.loading = false;
    view.rerender(<Journey />);
    expect(composer(entry).value).toBe(QUERY);
    expectFreshConfirmation(entry);
    await review(entry);
    expect((screen.getByRole('checkbox', { name: /我同意將/ }) as HTMLInputElement).checked).toBe(false);
    expect(entry === 'navigation' ? runCloudNavigationTask : interpretCampusRequest).toHaveBeenCalledTimes(1);
  });

  it.each<Entry>(['search', 'navigation'])('%s never commits an old pending receipt after leaving, changing accounts, and returning through ABA', async (entry) => {
    const pending = pendingResult(entry);
    const view = await mount(entry);
    write(entry);
    await review(entry);
    submit(entry);
    visit(campusPath('/away'));
    auth.uid = 'bob';
    view.rerender(<Journey />);
    visit(entryPath(entry));
    commits.length = 0;
    auth.uid = 'alice';
    view.rerender(<Journey />);
    await pending.finish();
    expect(composer(entry).value).toBe('');
    expect(pending.signal()?.aborted).toBe(true);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((commit) => !commit.text.includes(SUMMARY) && !commit.text.includes('導航建議已備妥') && !commit.inputs.includes(QUERY))).toBe(true);
    expect(entry === 'navigation' ? runCloudNavigationTask : interpretCampusRequest).toHaveBeenCalledTimes(1);
  });
});
