import '@/test/campusEventShortlistLocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  campusEventShortlistKey,
  campusEventShortlistOwner,
  createCampusEventShortlistStore,
  type SavedCampusEvent,
} from '@campus/shared/src/campusEventShortlist';
import type { CampusEvent, CampusEventPage } from '@/lib/campusEvents';
import { CampusEventsWorkspace } from './CampusEventsWorkspace';
import { readCampusEventFilters } from './eventPresentation';

const loadCampusEventPage = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: null as null | { uid: string }, loading: false }));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));
vi.mock('@/lib/campusEvents', async () => ({
  ...(await vi.importActual<typeof import('@/lib/campusEvents')>('@/lib/campusEvents')),
  loadCampusEventPage,
}));

let school = 'nthu';
let run = 0;

const schoolSearch = () => `?schoolId=${school}&campus=${school}`;
const accountOwner = (uid: string) => campusEventShortlistOwner(uid, null);

function event(id: string, title: string, source: CampusEvent['source'] = 'school-events'): CampusEvent {
  return {
    id, title, source, schoolId: school, description: '', startsAt: '2099-10-25T08:00:00Z',
    appRegistrationConfigured: false,
  };
}

function page(items: CampusEvent[]): CampusEventPage {
  return { items, source: 'school-events', nextCursor: null, skipped: [] };
}

function saved(id: string, title: string, source: SavedCampusEvent['source'] = 'school-events'): SavedCampusEvent {
  return { schoolId: school, id, source, title };
}

const rawStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

/** Seed through the shared public API so these tests do not depend on its stored layout. */
async function seed(owner: string | null, ...events: SavedCampusEvent[]) {
  const store = createCampusEventShortlistStore(rawStorage);
  for (const item of [...events].reverse()) {
    await store.setSaved(campusEventShortlistKey(school, owner), item, true);
  }
}

function storedFor(owner: string | null) {
  return window.localStorage.getItem(campusEventShortlistKey(school, owner));
}

function mount(path = '/events?schoolId=nthu&campus=nthu') {
  window.history.replaceState(null, '', path);
  return render(
    <CampusEventsWorkspace
      key={school}
      schoolId={school}
      schoolSearch={schoolSearch()}
      initialFilters={readCampusEventFilters(new URLSearchParams(window.location.search))}
    />,
  );
}

beforeEach(() => {
  // The shortlist store caches by scope for the whole module, so every test gets its own school.
  school = `school-${++run}`;
  auth.user = null;
  auth.loading = false;
  loadCampusEventPage.mockReset();
  loadCampusEventPage.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('saves from the browse list, announces it, and reopens it from the saved view with return context', async () => {
  loadCampusEventPage.mockResolvedValue(page([event('talk', '校園講座'), event('club', '社團博覽會', 'school-club-events')]));
  mount(`/events?schoolId=${school}&campus=${school}&q=${encodeURIComponent('校園')}`);
  const save = await screen.findByRole('button', { name: '收藏「校園講座」' });
  await waitFor(() => expect(save.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(save);
  expect(await screen.findByText('已收藏「校園講座」。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消收藏「校園講座」' })).toBeTruthy();
  expect(JSON.parse(storedFor(null)!).items).toEqual([saved('talk', '校園講座')]);

  fireEvent.click(screen.getByRole('button', { name: /我的收藏/ }));
  const section = screen.getByRole('region', { name: '我的收藏活動' });
  expect(within(section).getByText('共 1 場')).toBeTruthy();
  expect(within(section).getByText(/訪客收藏保存在這個瀏覽器/)).toBeTruthy();
  const href = new URL(within(section).getByRole('link', { name: '校園講座' }).getAttribute('href')!, 'https://campus.example');
  expect(href.pathname).toBe('/events/talk');
  expect(Object.fromEntries(href.searchParams)).toMatchObject({
    schoolId: school, source: 'school-events', q: '校園', saved: '1',
  });
  expect(new URLSearchParams(window.location.search).get('saved')).toBe('1');
  expect(screen.getByRole('button', { name: /我的收藏/ }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '瀏覽活動' }));
  expect(new URLSearchParams(window.location.search).has('saved')).toBe(false);
  expect(new URLSearchParams(window.location.search).get('q')).toBe('校園');
  expect(screen.queryByRole('region', { name: '我的收藏活動' })).toBeNull();
  expect(loadCampusEventPage).toHaveBeenCalledTimes(1);
});

it('keeps saved events usable and removable when the live list is failing, without fetching it first', async () => {
  loadCampusEventPage.mockRejectedValue(new Error('network'));
  await seed(null, saved('gone', '已下架的講座'), saved('old', '第三頁的社團活動', 'school-club-events'));
  mount(`/events?schoolId=${school}&campus=${school}&saved=1`);
  const section = await screen.findByRole('region', { name: '我的收藏活動' });
  expect(await within(section).findByRole('link', { name: '已下架的講座' })).toBeTruthy();
  const club = new URL(within(section).getByRole('link', { name: '第三頁的社團活動' }).getAttribute('href')!, 'https://campus.example');
  expect(club.pathname).toBe('/events/old');
  expect(club.searchParams.get('source')).toBe('school-club-events');
  expect(loadCampusEventPage).not.toHaveBeenCalled();

  const first = within(section).getByRole('button', { name: '取消收藏「已下架的講座」' });
  first.focus();
  fireEvent.click(first);
  expect(await screen.findByText('已取消收藏「已下架的講座」。')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(
    within(section).getByRole('button', { name: '取消收藏「第三頁的社團活動」' }),
  ));

  fireEvent.click(within(section).getByRole('button', { name: '取消收藏「第三頁的社團活動」' }));
  await waitFor(() => expect(within(section).getByText('還沒有收藏的活動')).toBeTruthy());
  expect(document.activeElement).toBe(within(section).getByRole('heading', { name: '我的收藏活動' }));
  expect(within(section).getByText(/按「收藏」/)).toBeTruthy();

  fireEvent.click(within(section).getByRole('button', { name: '瀏覽活動' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(loadCampusEventPage).toHaveBeenCalledTimes(1);
});

it('does not show guest saves or write before auth resolves, then keeps guest and account separate', async () => {
  loadCampusEventPage.mockResolvedValue(page([event('talk', '校園講座')]));
  await seed(null, saved('guest-only', '訪客收藏'));
  auth.loading = true;
  const view = mount(`/events?schoolId=${school}&campus=${school}&saved=1`);
  expect(screen.getByText('正在確認登入狀態…')).toBeTruthy();
  expect(screen.queryByText('訪客收藏')).toBeNull();
  expect(screen.queryByText('還沒有收藏的活動')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '瀏覽活動' }));
  const save = await screen.findByRole('button', { name: '收藏「校園講座」' });
  expect(save.getAttribute('aria-disabled')).toBe('true');
  const before = storedFor(null);
  fireEvent.click(save);
  expect(storedFor(null)).toBe(before);
  expect(storedFor(accountOwner('alice'))).toBeNull();

  auth.loading = false;
  auth.user = { uid: 'alice' };
  view.rerender(<CampusEventsWorkspace key={school} schoolId={school} schoolSearch={schoolSearch()} initialFilters={{ q: '', view: 'all' }} />);
  const aliceSave = await screen.findByRole('button', { name: '收藏「校園講座」' });
  await waitFor(() => expect(aliceSave.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(aliceSave);
  expect(await screen.findByText('已收藏「校園講座」。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /我的收藏/ }));
  const section = screen.getByRole('region', { name: '我的收藏活動' });
  expect(within(section).getByText('校園講座')).toBeTruthy();
  expect(within(section).queryByText('訪客收藏')).toBeNull();
  expect(within(section).getByText(/依目前帳號與校園分開顯示/)).toBeTruthy();

  auth.user = { uid: 'bob' };
  view.rerender(<CampusEventsWorkspace key={school} schoolId={school} schoolSearch={schoolSearch()} initialFilters={{ q: '', view: 'all' }} />);
  expect(await screen.findByText('還沒有收藏的活動')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '我的收藏活動' })).queryByRole('link')).toBeNull();

  auth.user = null;
  view.rerender(<CampusEventsWorkspace key={school} schoolId={school} schoolSearch={schoolSearch()} initialFilters={{ q: '', view: 'all' }} />);
  expect(await screen.findByText('訪客收藏')).toBeTruthy();
  expect(screen.getByText(/訪客收藏保存在這個瀏覽器/)).toBeTruthy();
});

it('does not claim a save when the device refuses the write, and retries without losing the choice', async () => {
  loadCampusEventPage.mockResolvedValue(page([event('talk', '校園講座')]));
  const setItem = vi.spyOn(Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  mount(`/events?schoolId=${school}&campus=${school}`);
  const save = await screen.findByRole('button', { name: '收藏「校園講座」' });
  await waitFor(() => expect(save.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(save);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(/無法儲存變更/)).toBeTruthy();
  expect(screen.queryByText('已收藏「校園講座」。')).toBeNull();
  expect(screen.getByRole('button', { name: '收藏「校園講座」' })).toBeTruthy();
  expect(storedFor(null)).toBeNull();

  setItem.mockRestore();
  fireEvent.click(within(alert).getByRole('button', { name: '重試' }));
  expect(await screen.findByText('已收藏「校園講座」。')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '取消收藏「校園講座」' })).toBeTruthy();
});

it('shows an unreadable device copy as an error with retry instead of an empty invitation', async () => {
  const getItem = vi.spyOn(Object.hasOwn(localStorage, 'getItem') ? localStorage : Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  mount(`/events?schoolId=${school}&campus=${school}&saved=1`);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(/無法讀取此裝置的活動收藏/)).toBeTruthy();
  expect(screen.queryByText('還沒有收藏的活動')).toBeNull();
  getItem.mockRestore();
  fireEvent.click(within(alert).getByRole('button', { name: '重試' }));
  expect(await screen.findByText('還沒有收藏的活動')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('refreshes the saved view when another tab changes this scope', async () => {
  mount(`/events?schoolId=${school}&campus=${school}&saved=1`);
  expect(await screen.findByText('還沒有收藏的活動')).toBeTruthy();
  await seed(null, saved('other-tab', '另一個分頁收藏'));
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: campusEventShortlistKey(school, null) }));
  });
  expect(await screen.findByRole('link', { name: '另一個分頁收藏' })).toBeTruthy();
});

it('does not steal focus when a user moves to another control before a saved event is removed', async () => {
  await seed(null, saved('first', '第一場活動'), saved('second', '第二場活動'));
  mount(`/events?schoolId=${school}&campus=${school}&saved=1`);
  const first = await screen.findByRole('button', { name: '取消收藏「第一場活動」' });
  const browse = screen.getByRole('button', { name: '瀏覽活動' });
  first.focus();
  fireEvent.click(first);
  browse.focus();
  expect(await screen.findByText('已取消收藏「第一場活動」。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '第一場活動' })).toBeNull();
  expect(document.activeElement).toBe(browse);
});

it('does not move focus after removing an event whose button was never focused', async () => {
  await seed(null, saved('only', '唯一活動'));
  mount(`/events?schoolId=${school}&campus=${school}&saved=1`);
  const remove = await screen.findByRole('button', { name: '取消收藏「唯一活動」' });
  const browse = screen.getByRole('button', { name: '瀏覽活動' });
  browse.focus();
  fireEvent.click(remove);
  expect(await screen.findByText('還沒有收藏的活動')).toBeTruthy();
  expect(document.activeElement).toBe(browse);
});
