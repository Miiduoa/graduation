import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CampusBusBoard } from './CampusBusBoard';
import { queryTransit, type TransitResult } from '@/lib/transit';

vi.mock('@/lib/transit', async (original) => ({
  ...(await original<typeof import('@/lib/transit')>()),
  queryTransit: vi.fn(),
}));

const nowMs = Date.parse('2026-10-19T06:41:00.000Z');
const now = new Date(nowMs).toISOString();
let online = true;

function arrivals(stale = false): TransitResult {
  return {
    status: 'ready',
    kind: 'arrivals',
    fetchedAt: now,
    ...(stale ? { stale: true as const } : {}),
    arrivals: [{
      id: 'TXG162-1',
      route: '162',
      direction: 1,
      destination: '沙鹿火車站',
      status: 0,
      seconds: 180,
      updatedAt: now,
      stopName: '靜宜大學(英才路)',
    }],
  };
}

function board() {
  return render(<CampusBusBoard schoolId="pu" schoolName="靜宜大學" />);
}

beforeEach(() => {
  online = true;
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(nowMs);
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(queryTransit).mockResolvedValue(arrivals());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('shows an offline explanation instead of an endless loading skeleton on a disconnected launch', async () => {
  online = false;
  board();

  expect(await screen.findByText('離線時無法取得班次，連線後會自動重新查詢。')).toBeTruthy();
  expect(screen.queryByTestId('campus-skeleton')).toBeNull();
  expect(screen.queryByTestId('campus-approach')).toBeNull();
  expect(queryTransit).not.toHaveBeenCalled();
});

it('hides previously live countdowns, stop diagrams and live accessibility claims while offline', async () => {
  board();
  expect((await screen.findByTestId('campus-eta-minutes')).textContent).toBe('3');
  expect(screen.getByTestId('campus-approach')).toBeTruthy();

  online = false;
  await act(async () => { window.dispatchEvent(new Event('offline')); });

  expect(screen.getByText('目前離線，恢復網路後會重新查詢。')).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
  expect(screen.queryByTestId('campus-approach')).toBeNull();
  expect(screen.getByRole('button', { name: /162.*資料待更新/ })).toBeTruthy();
  expect(screen.getByText('資料待更新')).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新整理' }).hasAttribute('disabled')).toBe(true);
});

it('does not show a previous ETA during reconnection before the new result is confirmed', async () => {
  let complete!: (value: TransitResult) => void;
  let requests = 0;
  vi.mocked(queryTransit).mockImplementation(() => {
    requests += 1;
    return requests === 1 ? Promise.resolve(arrivals())
      : new Promise<TransitResult>((resolve) => { complete = resolve; });
  });
  board();
  expect(await screen.findByTestId('campus-eta-minutes')).toBeTruthy();

  online = false;
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  online = true;
  await act(async () => { window.dispatchEvent(new Event('online')); });

  expect(queryTransit).toHaveBeenCalledTimes(2);
  expect(screen.getByText('正在重新確認班次，暫不顯示到站預估。')).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
  expect(screen.queryByTestId('campus-approach')).toBeNull();

  await act(async () => { complete(arrivals()); });
  expect((await screen.findByTestId('campus-eta-minutes')).textContent).toBe('3');
  expect(screen.getByTestId('campus-approach')).toBeTruthy();
  expect(screen.queryByText('正在重新確認班次，暫不顯示到站預估。')).toBeNull();
});

it('keeps old estimates unverified if reconnecting fails and restores them only on a successful retry', async () => {
  let requests = 0;
  vi.mocked(queryTransit).mockImplementation(async () => {
    requests += 1;
    return requests === 2 ? { status: 'unavailable', reason: 'upstream' } : arrivals();
  });
  board();
  expect(await screen.findByTestId('campus-eta-minutes')).toBeTruthy();

  online = false;
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  online = true;
  await act(async () => { window.dispatchEvent(new Event('online')); });

  expect(await screen.findByText('目前無法確認最新班次，請稍後重試。')).toBeTruthy();
  expect(screen.getByRole('button', { name: /162.*資料待更新/ })).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
  expect(screen.queryByTestId('campus-approach')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await waitFor(() => expect(screen.getByTestId('campus-eta-minutes').textContent).toBe('3'));
  expect(queryTransit).toHaveBeenCalledTimes(3);
});

it('never animates a live arrival from a server-declared stale snapshot', async () => {
  vi.mocked(queryTransit).mockResolvedValue(arrivals(true));
  board();

  await waitFor(() => expect(queryTransit).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('button', { name: /162.*資料待更新/ })).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
  expect(screen.queryByTestId('campus-approach')).toBeNull();
});
