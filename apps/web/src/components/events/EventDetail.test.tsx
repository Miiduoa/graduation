import '@/test/campusEventShortlistLocks';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { campusEventShortlistKey, createCampusEventShortlistStore } from '@campus/shared/src/campusEventShortlist';
import { beforeEach, expect, it, vi } from 'vitest';
import { EventDetail } from './EventDetail';
import type { CampusEvent } from '@/lib/campusEvents';
import { buildCampusEventCalendar } from '@/lib/campusEventCalendar';

vi.mock('@/lib/campusEventCalendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/campusEventCalendar')>();
  return { ...actual, buildCampusEventCalendar: vi.fn(actual.buildCampusEventCalendar) };
});

const loadCampusEvent = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: null as null | { uid: string }, loading: false }));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));

vi.mock('@/lib/campusEvents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/campusEvents')>('@/lib/campusEvents');
  return {
    ...actual,
    loadCampusEvent,
  };
});

vi.mock('./EventRegistrationPanel', () => ({
  EventRegistrationPanel: ({ event, returnPath }: { event: CampusEvent; returnPath: string }) => (
    <div data-testid="registration-panel" data-return-path={returnPath}>{event.source}:{event.id}</div>
  ),
}));

function event(partial: Partial<CampusEvent> & Pick<CampusEvent, 'id' | 'title' | 'source'>): CampusEvent {
  return {
    schoolId: 'nthu',
    description: '說明',
    startsAt: '2026-05-01T02:00:00.000Z',
    appRegistrationConfigured: partial.source === 'school-club-events',
    ...partial,
  };
}

beforeEach(() => {
  loadCampusEvent.mockReset();
  auth.user = null;
  auth.loading = false;
});

it('keeps list filters for back and login while sharing only the event identity', async () => {
  loadCampusEvent.mockResolvedValue(event({ id: 'talk', title: '校園講座', source: 'school-events' }));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu&campus=nthu" eventId="talk"
    sourceParam="school-events" listFilters={{ q: '我的搜尋', view: 'upcoming' }} />);
  await screen.findByRole('heading', { name: '校園講座' });
  const back = new URL(screen.getByRole('link', { name: '回到活動列表' }).getAttribute('href')!, 'https://campus.example');
  expect(Object.fromEntries(back.searchParams)).toEqual({ schoolId: 'nthu', campus: 'nthu', q: '我的搜尋', view: 'upcoming' });
  expect(screen.getByTestId('registration-panel').getAttribute('data-return-path')).toContain('view=upcoming');
  fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  const shared = new URL(writeText.mock.calls[0][0]);
  expect(shared.searchParams.get('schoolId')).toBe('nthu');
  expect(shared.searchParams.get('source')).toBe('school-events');
  expect(shared.searchParams.has('q')).toBe(false);
  expect(shared.searchParams.has('view')).toBe(false);
});

it('does not offer a calendar download until a real event time exists', async () => {
  loadCampusEvent.mockResolvedValue(event({ id: 'tbd', title: '待公告活動', source: 'school-events', startsAt: '' }));
  render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="tbd" sourceParam="school-events" />);
  await screen.findByRole('heading', { name: '待公告活動' });
  expect((screen.getByRole('button', { name: '加入行事曆' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('活動時間待公告，提供開始時間後即可加入行事曆。')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
});

it('offers the Taipei calendar day, then the scoped venue search as the event approaches, even without cloud chat', async () => {
  const start = Date.parse('2027-11-30T16:20:00Z');
  const end = start + 60 * 60_000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start - 31 * 60_000);
  const activity = event({
    id: 'meet', title: '冬日演出', source: 'school-events', location: '禮堂 B1 & 北門',
    startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
  });
  loadCampusEvent.mockResolvedValue(activity);
  try {
    render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu&campus=nthu" eventId="meet"
      sourceParam="school-events" listFilters={{ q: '搜尋', view: 'upcoming' }} />);
    const suggestion = within(await screen.findByRole('region', { name: 'nuni 建議' }));
    const dayLink = suggestion.getByRole('link', { name: '查看活動當天的個人行程' });
    expect(dayLink.getAttribute('href')).toBe('/calendar?schoolId=nthu&date=2027-12-01');
    expect(suggestion.getByText(/冬日演出/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '加入行事曆' })).toBeTruthy();
    clock.mockReturnValue(start - 30 * 60_000);
    fireEvent.focus(window);
    const mapLink = suggestion.getByRole('link', { name: '在校園地圖查地點' });
    const map = new URL(mapLink.getAttribute('href')!, 'https://campus.local');
    expect(map.pathname).toBe('/map');
    expect(Object.fromEntries(map.searchParams)).toEqual({ schoolId: 'nthu', query: activity.location });
    expect(suggestion.queryByRole('link', { name: '查看活動當天的個人行程' })).toBeNull();
    clock.mockReturnValue(start);
    fireEvent.focus(window);
    expect(suggestion.getByText(/正在進行/)).toBeTruthy();
    clock.mockReturnValue(end);
    fireEvent.focus(window);
    expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
  } finally {
    clock.mockRestore();
  }
});

it.each(['線上講座', 'Google Meet', '地點待公告', 'https://meet.example/join', undefined])(
  'does not send an ongoing event with location %s to a physical map', async (location) => {
    loadCampusEvent.mockResolvedValue(event({
      id: 'remote', title: '同步活動', source: 'school-events', location,
      startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="remote" sourceParam="school-events" />);
    await screen.findByRole('heading', { name: '同步活動' });
    expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
  },
);

it('switches the current action and retires it at exact timer boundaries without focus or a reload', async () => {
  vi.useFakeTimers();
  const now = Date.UTC(2027, 1, 3, 4, 5, 6);
  const start = now + 30 * 60_000 + 850;
  vi.setSystemTime(now);
  loadCampusEvent.mockResolvedValue(event({
    id: 'tour', title: '校園導覽', location: '圖書館', source: 'school-events',
    startsAt: new Date(start).toISOString(), endsAt: new Date(start + 1_000).toISOString(),
  }));
  try {
    await act(async () => {
      render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="tour" sourceParam="school-events" />);
    });
    act(() => vi.advanceTimersByTime(849));
    expect(screen.getByRole('link', { name: '查看活動當天的個人行程' }).getAttribute('href'))
      .toBe('/calendar?schoolId=nthu&date=2027-02-03');
    act(() => vi.advanceTimersByTime(1));
    const map = screen.getByRole('link', { name: '在校園地圖查地點' });
    expect(map.getAttribute('href')).toBe(`/map?${new URLSearchParams({ schoolId: 'nthu', query: '圖書館' })}`);
    act(() => vi.advanceTimersByTime(30 * 60_000));
    expect(screen.getByText(/「校園導覽」正在進行/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByRole('link', { name: '在校園地圖查地點' })).toBe(map);
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
    expect(screen.getByText('已結束')).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it('withdraws the visible suggestion when a reload finds that the selected event was removed', async () => {
  loadCampusEvent.mockResolvedValueOnce(event({
    id: 'workshop', title: '工作坊', source: 'school-events', startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  })).mockResolvedValueOnce(null);
  render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="workshop" sourceParam="school-events" />);
  await screen.findByRole('region', { name: 'nuni 建議' });
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
  await screen.findByRole('heading', { name: '找不到這場活動' });
  expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
});

it('keeps a legacy display date without recommending plans for an ambiguous source time', async () => {
  loadCampusEvent.mockResolvedValue(event({
    id: 'legacy', title: '舊活動', source: 'legacy-events',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(), calendarTime: { startsAt: '', endsAt: '' },
  }));
  render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="legacy" sourceParam="legacy-events" />);
  await screen.findByRole('heading', { name: '舊活動' });
  expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
  expect(screen.getByText('時間待公告')).toBeTruthy();
  expect(screen.queryByText('即將開始')).toBeNull();
});

it('keeps the badge on calendarTime when the display start would look upcoming', async () => {
  const start = Date.parse('2027-11-30T16:20:00Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  try {
    loadCampusEvent.mockResolvedValue(event({
      id: 'legacy', title: '舊顯示時間', source: 'legacy-events', location: '禮堂',
      startsAt: new Date(start + 86_400_000).toISOString(),
      calendarTime: { startsAt: new Date(start - 5 * 60_000).toISOString() },
    }));
    render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="legacy" sourceParam="legacy-events" />);
    await screen.findByRole('heading', { name: '舊顯示時間' });
    expect(screen.getByText('已開始')).toBeTruthy();
    expect(screen.queryByText('即將開始')).toBeNull();
    expect(screen.getByRole('link', { name: '在校園地圖查地點' })).toBeTruthy();
  } finally {
    clock.mockRestore();
  }
});

it('still offers the venue map after a physical event has started without an end time', async () => {
  const start = Date.parse('2027-11-30T16:20:00Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start + 5 * 60_000);
  try {
    loadCampusEvent.mockResolvedValue(event({
      id: 'open-end', title: '開放式活動', source: 'school-events', location: '禮堂',
      startsAt: new Date(start).toISOString(),
    }));
    render(<EventDetail schoolId="nthu" schoolSearch="?schoolId=nthu" eventId="open-end" sourceParam="school-events" />);
    const suggestion = within(await screen.findByRole('region', { name: 'nuni 建議' }));
    expect(suggestion.getByText(/已開始/)).toBeTruthy();
    expect(suggestion.getByRole('link', { name: '在校園地圖查地點' }).getAttribute('href'))
      .toBe(`/map?${new URLSearchParams({ schoolId: 'nthu', query: '禮堂' })}`);
    expect(screen.getByText('已開始')).toBeTruthy();
  } finally {
    clock.mockRestore();
  }
});

it('rejects invalid source without probing collections by id alone', async () => {
  render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="same"
      sourceParam="made-up"
    />,
  );
  expect(await screen.findByRole('heading', { name: '無法開啟此活動' })).toBeTruthy();
  expect(loadCampusEvent).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '回到活動列表' }).getAttribute('href')).toBe(
    '/events?schoolId=nthu&campus=nthu',
  );
});

it('loads the exact source and never pairs noncanonical content to canonical registration by id', async () => {
  loadCampusEvent.mockResolvedValue(
    event({ id: 'same', title: '校園資料版', source: 'school-events' }),
  );
  render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="same"
      sourceParam="school-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '校園資料版' })).toBeTruthy();
  expect(loadCampusEvent).toHaveBeenCalledWith('nthu', 'same', 'school-events');
  expect(screen.getByTestId('registration-panel').textContent).toBe('school-events:same');
  expect(screen.getByText('校園活動資料')).toBeTruthy();
});

it('clears previous event immediately when identity changes', async () => {
  loadCampusEvent.mockImplementation(async (_schoolId: string, id: string, source: string) => {
    if (id === 'old' && source === 'school-club-events') {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return event({ id: 'old', title: '舊活動', source: 'school-club-events' });
    }
    return event({ id: 'new', title: '新活動', source: 'legacy-events' });
  });
  const view = render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu"
      eventId="old"
      sourceParam="school-club-events"
    />,
  );
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  view.rerender(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu"
      eventId="new"
      sourceParam="legacy-events"
    />,
  );
  expect(screen.queryByText('舊活動')).toBeNull();
  expect(await screen.findByRole('heading', { name: '新活動' })).toBeTruthy();
  expect(screen.getByTestId('registration-panel').textContent).toBe('legacy-events:new');
});

it('keeps read failure distinct from missing event and preserves school on back link', async () => {
  loadCampusEvent.mockRejectedValueOnce(new Error('unavailable'));
  const view = render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="missing"
      sourceParam="school-club-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '無法讀取這場活動' })).toBeTruthy();
  loadCampusEvent.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(await screen.findByRole('heading', { name: '找不到這場活動' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '回到活動列表' }).getAttribute('href')).toBe(
    '/events?schoolId=nthu&campus=nthu',
  );
  view.unmount();
});

it('copies a share URL that keeps school and source', async () => {
  loadCampusEvent.mockResolvedValue(
    event({ id: 'talk', title: '分享場', source: 'school-club-events' }),
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(
    <EventDetail
      schoolId="nthu"
      schoolSearch="?schoolId=nthu&campus=nthu"
      eventId="talk"
      sourceParam="school-club-events"
    />,
  );
  await screen.findByRole('heading', { name: '分享場' });
  fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(String(writeText.mock.calls[0]?.[0])).toContain(
    '/events/talk?schoolId=nthu&source=school-club-events',
  );
});

it.each(['school-club-events', 'school-events', 'legacy-events'] as const)(
  '%s calendar and copied links return to the same activity without list filters', async (source) => {
    const activity = event({ id: '迎新 & 說明會', title: '迎新說明會', source });
    loadCampusEvent.mockResolvedValue(activity);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const createUrl = vi.fn(() => 'blob:calendar');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      render(<EventDetail schoolId="nthu" schoolSearch="?school=nthu&campus=nthu"
        eventId={activity.id} sourceParam={source} listFilters={{ q: '搜尋', view: 'upcoming' }} />);
      await screen.findByRole('heading', { name: activity.title });
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      const detailUrl = new URL(`/events/${encodeURIComponent(activity.id)}?schoolId=nthu&source=${source}`, window.location.origin).href;
      expect(writeText).toHaveBeenCalledWith(detailUrl);
      fireEvent.click(screen.getByRole('button', { name: '加入行事曆' }));
      expect(buildCampusEventCalendar).toHaveBeenLastCalledWith(activity, detailUrl);
      const calendar = vi.mocked(buildCampusEventCalendar).mock.results.at(-1)?.value;
      expect(calendar.content.replace(/\r\n /g, '')).toContain(`URL:${detailUrl}`);
      expect(calendar.content.replace(/\r\n /g, '')).toContain('報名與時間異動請回到活動頁確認');
      expect(createUrl).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  },
);

// Each test uses its own school because the saved-event store caches by scope for the whole module.
let detailRun = 0;
function detailSchool() {
  return `detail-school-${++detailRun}`;
}
const detailStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

it('saves from the detail page with identity and title only, and returns to the saved view', async () => {
  const schoolId = detailSchool();
  loadCampusEvent.mockResolvedValue(event({
    id: 'talk', schoolId, title: '校園講座', description: '不應被收藏的長說明', location: '大講堂', source: 'school-events',
  }));
  render(<EventDetail schoolId={schoolId} schoolSearch={`?schoolId=${schoolId}&campus=${schoolId}`} eventId="talk"
    sourceParam="school-events" listFilters={{ q: '', view: 'all', saved: true }} />);
  await screen.findByRole('heading', { name: '校園講座' });
  const back = new URL(screen.getByRole('link', { name: '回到收藏活動' }).getAttribute('href')!, 'https://campus.example');
  expect(Object.fromEntries(back.searchParams)).toEqual({ schoolId, campus: schoolId, saved: '1' });
  expect(screen.getByTestId('registration-panel').getAttribute('data-return-path')).toContain('saved=1');
  const save = screen.getByRole('button', { name: '收藏「校園講座」' });
  await waitFor(() => expect(save.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(save);
  expect(await screen.findByText('已收藏「校園講座」。')).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消收藏「校園講座」' })).toBeTruthy();
  const stored = JSON.parse(window.localStorage.getItem(campusEventShortlistKey(schoolId, null))!);
  expect(stored.items).toEqual([{ schoolId, id: 'talk', source: 'school-events', title: '校園講座' }]);
  expect(screen.getByRole('button', { name: '加入行事曆' })).toBeTruthy();
});

it('does not claim a detail save when storage fails, and recovers on retry', async () => {
  const schoolId = detailSchool();
  loadCampusEvent.mockResolvedValue(event({ id: 'talk', schoolId, title: '校園講座', source: 'school-events' }));
  const setItem = vi.spyOn(Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try {
    render(<EventDetail schoolId={schoolId} schoolSearch={`?schoolId=${schoolId}`} eventId="talk" sourceParam="school-events" />);
    await screen.findByRole('heading', { name: '校園講座' });
    const save = screen.getByRole('button', { name: '收藏「校園講座」' });
    await waitFor(() => expect(save.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(save);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('無法儲存變更');
    expect(screen.queryByText('已收藏「校園講座」。')).toBeNull();
    expect(screen.getByRole('button', { name: '收藏「校園講座」' })).toBeTruthy();
    setItem.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('已收藏「校園講座」。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    setItem.mockRestore();
  }
});

it('keeps saving unavailable while sign-in is unresolved', async () => {
  const schoolId = detailSchool();
  auth.loading = true;
  loadCampusEvent.mockResolvedValue(event({ id: 'talk', schoolId, title: '校園講座', source: 'school-events' }));
  render(<EventDetail schoolId={schoolId} schoolSearch={`?schoolId=${schoolId}`} eventId="talk" sourceParam="school-events" />);
  const save = await screen.findByRole('button', { name: '收藏「校園講座」' });
  expect(save.getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByText(/正在確認登入狀態/)).toBeTruthy();
  fireEvent.click(save);
  expect(window.localStorage.getItem(campusEventShortlistKey(schoolId, null))).toBeNull();
  expect(screen.getByRole('heading', { name: '校園講座' })).toBeTruthy();
});

it('lets a student remove a saved event whose live record is gone', async () => {
  const schoolId = detailSchool();
  await createCampusEventShortlistStore(detailStorage).setSaved(
    campusEventShortlistKey(schoolId, null),
    { schoolId, id: 'deleted', source: 'school-club-events', title: '已刪除的社團活動' },
    true,
  );
  loadCampusEvent.mockResolvedValue(null);
  render(<EventDetail schoolId={schoolId} schoolSearch={`?schoolId=${schoolId}`} eventId="deleted"
    sourceParam="school-club-events" listFilters={{ q: '', view: 'all', saved: true }} />);
  expect(await screen.findByRole('heading', { name: '找不到這場活動' })).toBeTruthy();
  const remove = await screen.findByRole('button', { name: '取消收藏「已刪除的社團活動」' });
  fireEvent.click(remove);
  expect(await screen.findByText('已取消收藏「已刪除的社團活動」。')).toBeTruthy();
  const back = screen.getByRole('link', { name: '回到收藏活動' });
  await waitFor(() => expect(document.activeElement).toBe(back));
  expect(screen.queryByRole('button', { name: /取消收藏/ })).toBeNull();
});
