import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EventList } from './EventList';
import type { CampusEvent, CampusEventPage } from '@/lib/campusEvents';

const loadCampusEventPage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/campusEvents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/campusEvents')>('@/lib/campusEvents');
  return {
    ...actual,
    loadCampusEventPage,
  };
});

function event(
  partial: Partial<CampusEvent> & Pick<CampusEvent, 'id' | 'title' | 'source'>,
): CampusEvent {
  return {
    schoolId: 'nthu',
    description: '',
    startsAt: '2026-05-01T02:00:00.000Z',
    appRegistrationConfigured: partial.source === 'school-club-events',
    ...partial,
  };
}

function page(partial: Partial<CampusEventPage> & Pick<CampusEventPage, 'items'>): CampusEventPage {
  return {
    source: partial.items[0]?.source || 'school-club-events',
    nextCursor: null,
    skipped: [],
    ...partial,
  };
}

beforeEach(() => {
  loadCampusEventPage.mockReset();
  window.history.replaceState(null, '', '/events?schoolId=nthu');
});

it('restores search and time filters from a detail return URL and keeps the campus on navigation', async () => {
  loadCampusEventPage.mockResolvedValue(page({ items: [
    event({ id: 'talk', title: '未來講座', source: 'school-events', startsAt: '2099-10-25T08:00:00Z' }),
    event({ id: 'old', title: '往年講座', source: 'school-events', startsAt: '2020-01-01T08:00:00Z', endsAt: '2020-01-01T09:00:00Z' }),
  ] }));
  window.history.replaceState(null, '', '/events?schoolId=nthu&q=講座&view=upcoming');
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu&campus=nthu" initialFilters={{ q: '講座', view: 'upcoming' }} />);
  const link = await screen.findByRole('link', { name: '未來講座' });
  expect(screen.queryByRole('link', { name: '往年講座' })).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('講座');
  const href = new URL(link.getAttribute('href')!, 'https://campus.example');
  expect(Object.fromEntries(href.searchParams)).toMatchObject({ schoolId: 'nthu', campus: 'nthu', source: 'school-events', q: '講座', view: 'upcoming' });
  fireEvent.click(screen.getByRole('button', { name: '全部活動' }));
  expect(screen.getByRole('link', { name: '往年講座' })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get('q')).toBe('講座');
  expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
});

it('responds to browser history without applying another campus query', async () => {
  loadCampusEventPage.mockResolvedValue(page({ items: [event({ id: 'talk', title: '講座', source: 'school-events' })] }));
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '講座' });
  act(() => {
    window.history.replaceState({ preserved: true }, '', '/events?schoolId=nthu&q=找不到&view=upcoming#results');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('找不到');
  expect(screen.getByRole('button', { name: '即將開始' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '清除全部篩選' }));
  expect(window.location.hash).toBe('#results');
  expect(window.history.state).toEqual({ preserved: true });
  act(() => {
    window.history.replaceState(null, '', '/events?schoolId=pu&q=其他學校');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('retains visible activities and filters when refresh fails, then recovers', async () => {
  loadCampusEventPage.mockResolvedValueOnce(page({ items: [event({ id: 'a', title: '讀書會', source: 'school-events' })] }))
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(page({ items: [event({ id: 'b', title: '讀書會新場次', source: 'school-events' })] }));
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '讀書會' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '讀書' } });
  fireEvent.click(screen.getByRole('button', { name: '更新活動' }));
  expect(screen.getByRole('link', { name: '讀書會' })).toBeTruthy();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('讀書');
  fireEvent.click(screen.getByRole('button', { name: '更新活動' }));
  expect(await screen.findByRole('link', { name: '讀書會新場次' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '讀書會' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reclassifies an event when returning to the page after its start and end', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T08:00:00Z'));
  try {
    loadCampusEventPage.mockResolvedValue(page({ items: [event({ id: 'a', title: '晚間講座', source: 'school-events', startsAt: '2026-10-25T09:00:00Z', endsAt: '2026-10-25T10:00:00Z' })] }));
    render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
    await screen.findByRole('link', { name: '晚間講座' });
    fireEvent.click(screen.getByRole('button', { name: '進行中' }));
    expect(screen.queryByRole('link', { name: '晚間講座' })).toBeNull();
    clock.mockReturnValue(Date.parse('2026-10-25T09:30:00Z'));
    fireEvent.focus(window);
    expect(screen.getByRole('link', { name: '晚間講座' })).toBeTruthy();
    clock.mockReturnValue(Date.parse('2026-10-25T10:00:00Z'));
    fireEvent.focus(window);
    expect(screen.queryByRole('link', { name: '晚間講座' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '已開始／過往' }));
    expect(screen.getByRole('link', { name: '晚間講座' })).toBeTruthy();
    expect(screen.getByText('已結束')).toBeTruthy();
  } finally {
    clock.mockRestore();
  }
});

it('clears old school filters when the active campus changes without remounting', async () => {
  loadCampusEventPage.mockResolvedValue(page({ items: [event({ id: 'a', title: '校園場次', source: 'school-events' })] }));
  const view = render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '校園場次' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '清華限定' } });
  view.rerender(<EventList schoolId="pu" schoolSearch="?schoolId=pu" />);
  await screen.findByRole('link', { name: '校園場次' });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('restores a later page after detail navigation and keeps that depth through refresh', async () => {
  const cursor = { schoolId: 'nthu', source: 'school-events' as const, document: { id: 'a' } as never };
  const first = page({ items: [event({ id: 'a', title: '第一頁', source: 'school-events' })], nextCursor: cursor });
  const second = page({ items: [event({ id: 'b', title: '第二頁目標', source: 'school-events' })] });
  loadCampusEventPage.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    .mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  window.history.replaceState(null, '', '/events?schoolId=nthu&q=目標&page=2');
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" initialFilters={{ q: '目標', view: 'all', page: 2 }} />);
  const target = await screen.findByRole('link', { name: '第二頁目標' });
  expect(new URL(target.getAttribute('href')!, window.location.origin).searchParams.get('page')).toBe('2');
  expect(loadCampusEventPage).toHaveBeenNthCalledWith(2, 'nthu', cursor);
  fireEvent.click(screen.getByRole('button', { name: '更新活動' }));
  await waitFor(() => expect(loadCampusEventPage).toHaveBeenCalledTimes(4));
  expect(await screen.findByRole('link', { name: '第二頁目標' })).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('目標');
});

it('stops automatic page restoration on failure and offers the same cursor for retry', async () => {
  const cursor = { schoolId: 'nthu', source: 'school-events' as const, document: { id: 'a' } as never };
  loadCampusEventPage.mockResolvedValueOnce(page({ items: [event({ id: 'a', title: '第一頁', source: 'school-events' })], nextCursor: cursor }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page({ items: [event({ id: 'b', title: '重試後場次', source: 'school-events' })] }));
  window.history.replaceState(null, '', '/events?schoolId=nthu&page=2');
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" initialFilters={{ q: '', view: 'all', page: 2 }} />);
  await screen.findByRole('alert');
  expect(loadCampusEventPage).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: '第一頁' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
  expect(await screen.findByRole('link', { name: '重試後場次' })).toBeTruthy();
  expect(loadCampusEventPage).toHaveBeenNthCalledWith(3, 'nthu', cursor);
});

it('refreshes the pages expanded manually, not just the page count in the initial URL', async () => {
  const cursor = { schoolId: 'nthu', source: 'school-events' as const, document: { id: 'a' } as never };
  const first = page({ items: [event({ id: 'a', title: '首批活動', source: 'school-events' })], nextCursor: cursor });
  const second = page({ items: [event({ id: 'b', title: '後續活動', source: 'school-events' })] });
  loadCampusEventPage.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '首批活動' });
  fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
  await screen.findByRole('link', { name: '後續活動' });
  fireEvent.click(screen.getByRole('button', { name: '更新活動' }));
  await waitFor(() => expect(loadCampusEventPage).toHaveBeenCalledTimes(4));
  expect(await screen.findByRole('link', { name: '後續活動' })).toBeTruthy();
});

it('does not issue two requests for one cursor when load-more clicks arrive in one render', async () => {
  const cursor = { schoolId: 'nthu', source: 'school-events' as const, document: { id: 'a' } as never };
  let resolveMore!: (value: CampusEventPage) => void;
  loadCampusEventPage.mockResolvedValueOnce(page({ items: [event({ id: 'a', title: '首批活動', source: 'school-events' })], nextCursor: cursor }))
    .mockImplementationOnce(() => new Promise<CampusEventPage>((resolve) => { resolveMore = resolve; }));
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '首批活動' });
  const more = screen.getByRole('button', { name: '載入更多' });
  act(() => { more.click(); more.click(); });
  expect(loadCampusEventPage).toHaveBeenCalledTimes(2);
  await act(async () => resolveMore(page({ items: [event({ id: 'b', title: '單一後續活動', source: 'school-events' })] })));
  expect(screen.getAllByRole('link', { name: '單一後續活動' })).toHaveLength(1);
});

it('restores a long previous list in bounded batches without losing the requested depth', async () => {
  loadCampusEventPage.mockImplementation(async (_school: string, cursor: { document: { id: string } } | null) => {
    const currentPage = cursor ? Number(cursor.document.id) + 1 : 1;
    return page({
      items: [event({ id: String(currentPage), title: `第 ${currentPage} 頁活動`, source: 'school-events' })],
      nextCursor: currentPage < 12 ? { schoolId: 'nthu', source: 'school-events', document: { id: String(currentPage) } as never } : null,
    });
  });
  window.history.replaceState(null, '', '/events?schoolId=nthu&page=12');
  await act(async () => {
    render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" initialFilters={{ q: '', view: 'all', page: 12 }} />);
  });
  expect(screen.getByRole('link', { name: '第 10 頁活動' })).toBeTruthy();
  expect(loadCampusEventPage).toHaveBeenCalledTimes(10);
  expect(screen.queryByRole('link', { name: '第 11 頁活動' })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '繼續還原先前列表' }));
  });
  const last = screen.getByRole('link', { name: '第 12 頁活動' });
  expect(loadCampusEventPage).toHaveBeenCalledTimes(12);
  expect(new URL(last.getAttribute('href')!, window.location.origin).searchParams.get('page')).toBe('12');
});

it('shows loading then ready items with source-preserving detail links', async () => {
  loadCampusEventPage.mockResolvedValue(
    page({
      items: [
        event({ id: 'same', title: '社團場次', source: 'school-club-events' }),
        event({ id: 'same', title: '校園場次', source: 'school-events' }),
      ],
    }),
  );
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu&campus=nthu" />);
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  expect((await screen.findByRole('link', { name: '社團場次' })).getAttribute('href')).toBe(
    '/events/same?schoolId=nthu&campus=nthu&source=school-club-events',
  );
  expect(screen.getByRole('link', { name: '校園場次' }).getAttribute('href')).toBe(
    '/events/same?schoolId=nthu&campus=nthu&source=school-events',
  );
  expect(screen.getByText('社團活動資料')).toBeTruthy();
  expect(screen.getByText('校園活動資料')).toBeTruthy();
});

it('keeps read errors distinct from empty and retries', async () => {
  loadCampusEventPage.mockRejectedValueOnce(new Error('permission-denied'));
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  expect(await screen.findByRole('heading', { name: '無法讀取校園活動' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '目前沒有可顯示的校園活動' })).toBeNull();
  loadCampusEventPage.mockResolvedValue(page({ items: [] }));
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  expect(await screen.findByRole('heading', { name: '目前沒有可顯示的校園活動' })).toBeTruthy();
});

it('surfaces skipped rows as incomplete data instead of pretending there are no events', async () => {
  loadCampusEventPage.mockResolvedValue(
    page({
      items: [event({ id: 'ok', title: '可顯示', source: 'legacy-events' })],
      skipped: [{ id: 'bad', reason: 'Invalid campus content' }],
    }),
  );
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  expect(await screen.findByText(/有 1 筆活動資料不完整/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '可顯示' })).toBeTruthy();
});

it('searches only loaded items with truthful copy', async () => {
  loadCampusEventPage.mockResolvedValue(
    page({
      items: [
        event({ id: 'a', title: 'AI 講座', source: 'school-events' }),
        event({ id: 'b', title: '社團聚', source: 'school-club-events' }),
      ],
    }),
  );
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: 'AI 講座' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '講座' } });
  expect(screen.getByRole('link', { name: 'AI 講座' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '社團聚' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '沒有這個' } });
  expect(screen.getByRole('heading', { name: '已載入的活動中沒有符合的結果' })).toBeTruthy();
  expect(screen.getByText(/目前已載入全部活動，請試試其他關鍵字或清除搜尋/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(screen.getByRole('link', { name: '社團聚' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
});

it('continues searching later pages without discarding the query and keeps retry available', async () => {
  const cursor = {
    schoolId: 'nthu',
    source: 'school-club-events' as const,
    document: { id: 'a' } as never,
  };
  loadCampusEventPage
    .mockResolvedValueOnce(
      page({
        items: [event({ id: 'a', title: '社團聚會', source: 'school-club-events' })],
        nextCursor: cursor,
      }),
    )
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(
      page({
        items: [event({ id: 'b', title: '創業講座', source: 'school-club-events' })],
      }),
    );
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '社團聚會' });
  const search = screen.getByRole('searchbox') as HTMLInputElement;
  fireEvent.change(search, { target: { value: '創業' } });
  expect(screen.getByText(/可保留關鍵字，繼續載入更多/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
  await screen.findByRole('alert');
  expect(search.value).toBe('創業');
  fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
  expect(await screen.findByRole('link', { name: '創業講座' })).toBeTruthy();
  expect(search.value).toBe('創業');
  expect(screen.queryByRole('link', { name: '社團聚會' })).toBeNull();
  expect(screen.queryByRole('button', { name: '載入更多' })).toBeNull();
  expect(loadCampusEventPage.mock.calls[2]?.[1]).toBe(cursor);
});

it('preserves items and cursor when load-more fails', async () => {
  const cursor = {
    schoolId: 'nthu',
    source: 'school-club-events' as const,
    document: { id: 'a' } as never,
  };
  loadCampusEventPage
    .mockResolvedValueOnce(
      page({
        items: [event({ id: 'a', title: '第一頁', source: 'school-club-events' })],
        nextCursor: cursor,
      }),
    )
    .mockRejectedValueOnce(new Error('network'));
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '第一頁' });
  fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: '第一頁' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '載入更多' })).toBeTruthy();
  expect(loadCampusEventPage).toHaveBeenCalledTimes(2);
  expect(loadCampusEventPage.mock.calls[1]?.[1]).toBe(cursor);
});

it('clears previous school content immediately when school identity changes', async () => {
  loadCampusEventPage.mockImplementation(async (schoolId: string) => {
    if (schoolId === 'nthu') {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return page({ items: [event({ id: 'n1', title: '清華活動', source: 'school-events' })] });
    }
    return page({ items: [event({ id: 'p1', title: '靜宜活動', source: 'school-events' })] });
  });
  const view = render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  view.rerender(<EventList schoolId="pu" schoolSearch="?schoolId=pu" />);
  expect(screen.getByRole('status').textContent).toContain('正在讀取');
  expect(screen.queryByText('清華活動')).toBeNull();
  expect(await screen.findByRole('link', { name: '靜宜活動' })).toBeTruthy();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(screen.queryByText('清華活動')).toBeNull();
});

it('deduplicates by source:id across pages', async () => {
  const cursor = {
    schoolId: 'nthu',
    source: 'school-club-events' as const,
    document: { id: 'a' } as never,
  };
  loadCampusEventPage
    .mockResolvedValueOnce(
      page({
        items: [event({ id: 'a', title: '第一頁', source: 'school-club-events' })],
        nextCursor: cursor,
      }),
    )
    .mockResolvedValueOnce(
      page({
        items: [
          event({ id: 'a', title: '重複', source: 'school-club-events' }),
          event({ id: 'b', title: '第二頁', source: 'school-club-events' }),
        ],
      }),
    );
  render(<EventList schoolId="nthu" schoolSearch="?schoolId=nthu" />);
  await screen.findByRole('link', { name: '第一頁' });
  fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
  await waitFor(() => expect(screen.getByRole('link', { name: '第二頁' })).toBeTruthy());
  expect(screen.getAllByRole('link', { name: /第一頁|重複/ })).toHaveLength(1);
});
