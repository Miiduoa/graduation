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
  expect(screen.getByText(/不會向伺服器查詢尚未載入的內容/)).toBeTruthy();
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
