import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HomeCampusBusCard } from './HomeCampusBusCard';
import { queryTransit, type TransitResult } from '@/lib/transit';

vi.mock('@/lib/transit', async (original) => {
  const actual = await original<typeof import('@/lib/transit')>();
  return {
    ...actual,
    queryTransit: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(queryTransit).mockReset();
});

it('hides the home bus row when there is no next arrival to show', async () => {
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'unavailable',
    reason: 'not-configured',
  });
  const { container } = render(<HomeCampusBusCard schoolId="pu" />);
  await waitFor(() => expect(queryTransit).toHaveBeenCalled());
  expect(container.textContent).toBe('');
  expect(screen.queryByText('看全部')).toBeNull();
  expect(screen.queryByText('正在查看…')).toBeNull();
});

it('shows the real next campus-gate bus and does not invent a destination', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready',
    kind: 'arrivals',
    fetchedAt: now,
    arrivals: [
      {
        id: '162',
        route: '162',
        direction: 1,
        destination: '沙鹿火車站',
        status: 0,
        seconds: 180,
        updatedAt: now,
        stopName: '靜宜大學(英才路)',
      },
    ],
  });
  render(<HomeCampusBusCard schoolId="pu" />);
  const link = await screen.findByRole('link', { name: /下一班公車/ });
  expect(link.getAttribute('href')).toBe('/bus');
  expect(screen.getByText(/162 往沙鹿 3 分/)).toBeTruthy();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('never carries the previous school bus into an unsupported campus', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [{ id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0,
      seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' }],
  });
  const { rerender } = render(<HomeCampusBusCard schoolId="pu" />);
  expect(await screen.findByText(/162 往沙鹿 3 分/)).toBeTruthy();

  rerender(<HomeCampusBusCard schoolId="ncku" />);
  expect(screen.queryByTestId('home-bus-entry')).toBeNull();
  expect(queryTransit).toHaveBeenCalledTimes(1);
});

it('hides the home ETA on disconnect and waits for a confirmed response after reconnecting', async () => {
  let online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  const now = new Date().toISOString();
  const current: TransitResult = {
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [{ id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0,
      seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' }],
  };
  let complete!: (value: TransitResult) => void;
  vi.mocked(queryTransit).mockResolvedValueOnce(current).mockImplementationOnce(
    () => new Promise<TransitResult>((resolve) => { complete = resolve; }),
  );
  render(<HomeCampusBusCard schoolId="pu" />);
  expect(await screen.findByText(/162 往沙鹿 3 分/)).toBeTruthy();

  online = false;
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  expect(screen.queryByTestId('home-bus-entry')).toBeNull();

  online = true;
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(queryTransit).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('home-bus-entry')).toBeNull();

  await act(async () => { complete(current); });
  expect(await screen.findByText(/162 往沙鹿 3 分/)).toBeTruthy();
});

it('does not offer a next-bus countdown from a stale source snapshot', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockResolvedValue({
    status: 'ready', kind: 'arrivals', stale: true, fetchedAt: now,
    arrivals: [{ id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0,
      seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' }],
  });
  const { container } = render(<HomeCampusBusCard schoolId="pu" />);
  await waitFor(() => expect(queryTransit).toHaveBeenCalledTimes(1));
  expect(container.textContent).toBe('');
});

it('refreshes the home preview periodically only while the page is visible and online', async () => {
  let visible = true;
  let connected = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => connected);
  vi.useFakeTimers();
  vi.mocked(queryTransit).mockResolvedValue({ status: 'unavailable', reason: 'rate-limited' });

  render(<HomeCampusBusCard schoolId="pu" />);
  await act(async () => { await Promise.resolve(); });
  expect(queryTransit).toHaveBeenCalledTimes(1);

  await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
  expect(queryTransit).toHaveBeenCalledTimes(2);

  visible = false;
  await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
  expect(queryTransit).toHaveBeenCalledTimes(2);

  visible = true;
  connected = false;
  await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); });
  expect(queryTransit).toHaveBeenCalledTimes(2);
});
