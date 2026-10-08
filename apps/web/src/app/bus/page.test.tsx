import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BusPage from './page';
import { loadBusArrivals, loadBusRoutes, type BusArrivals } from '@/lib/bus';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('schoolId=pu') }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/bus', async (original) => ({
  ...(await original<typeof import('@/lib/bus')>()),
  loadBusRoutes: vi.fn(),
  loadBusArrivals: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadBusRoutes).mockResolvedValue([
    {
      id: 'route',
      name: '實際路線',
      description: '',
      city: 'Taichung',
      stops: [
        { id: 'one', name: '第一站', order: 1 },
        { id: 'two', name: '第二站', order: 2 },
      ],
    },
  ]);
  vi.mocked(loadBusArrivals).mockResolvedValue({
    status: 'unavailable',
    arrivals: [],
    fetchedAt: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('offers the official service without inventing an arrival when realtime data is unavailable', async () => {
  render(<BusPage />);
  expect(await screen.findByText(/目前沒有可確認的即時到站資訊/)).toBeTruthy();
  expect(screen.queryByText(/8 分鐘/)).toBeNull();
  expect(screen.queryByText('校園環線')).toBeNull();
  expect(screen.getByRole('link', { name: /臺中市官方公車查詢/ }).getAttribute('href')).toBe(
    'https://citybus-free.taichung.gov.tw/',
  );
});

it('ignores an old station response after the user switches stations', async () => {
  let finish!: (data: BusArrivals) => void;
  vi.mocked(loadBusArrivals).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<BusPage />);
  fireEvent.change(await screen.findByLabelText(/候車站牌/), { target: { value: 'two' } });
  await screen.findByText(/目前沒有可確認的即時到站資訊/);
  await act(async () =>
    finish({
      status: 'ready',
      fetchedAt: new Date().toISOString(),
      arrivals: [{ routeName: '舊站資料', direction: '', label: '約 8 分鐘' }],
    }),
  );
  expect(screen.queryByText('舊站資料')).toBeNull();
  expect(screen.getByRole('heading', { name: '第二站 到站資訊' })).toBeTruthy();
});

it('removes estimates when their source timestamp expires while the page is hidden', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  vi.mocked(loadBusArrivals).mockResolvedValue({
    status: 'ready',
    fetchedAt: new Date().toISOString(),
    arrivals: [{ routeName: '實際路線', direction: '', label: '約 8 分鐘' }],
  });
  await act(async () => {
    render(<BusPage />);
  });
  expect(screen.getByText('約 8 分鐘')).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(90_000);
  });
  expect(screen.queryByText('約 8 分鐘')).toBeNull();
  expect(screen.getByText(/目前沒有可確認的即時到站資訊/)).toBeTruthy();
});
