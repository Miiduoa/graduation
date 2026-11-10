import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CampusNextRow, TransitArrival } from '@/lib/transit';
import { revealStopResult } from '@/lib/revealStopResult';
import { CampusArrivalRow } from './CampusArrivalRow';
import css from './transit.module.css';

vi.mock('@/lib/revealStopResult', () => ({ revealStopResult: vi.fn() }));

const now = Date.parse('2026-10-19T06:40:00.000Z');
const row = (overrides: Partial<TransitArrival> = {}): CampusNextRow => ({
  route: '162',
  heading: '沙鹿火車站',
  arrival: {
    id: '162-ying', route: '162', direction: 1, destination: '沙鹿火車站',
    status: 0, seconds: 180, updatedAt: new Date(now).toISOString(),
    stopName: '靜宜大學(英才路)', ...overrides,
  },
});
const minutes = () => screen.getByTestId('campus-eta-minutes');
const isChanging = () => minutes().classList.contains(css.etaNumberChanged);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps the initial value and unchanged live polls still', () => {
  const { rerender } = render(<CampusArrivalRow row={row()} now={now} />);
  const initial = minutes();
  expect(initial.textContent).toBe('3');
  expect(isChanging()).toBe(false);

  rerender(<CampusArrivalRow row={row({
    seconds: 150, updatedAt: new Date(now + 30_000).toISOString(),
  })} now={now + 30_000} />);
  expect(minutes()).toBe(initial);
  expect(isChanging()).toBe(false);
});

it('changes only the minute display once when a trusted live value changes', () => {
  const { rerender } = render(<CampusArrivalRow row={row()} now={now} />);
  const initial = minutes();
  rerender(<CampusArrivalRow row={row({ seconds: 120 })} now={now} />);
  const changed = minutes();
  expect(changed.textContent).toBe('2');
  expect(changed).not.toBe(initial);
  expect(isChanging()).toBe(true);

  rerender(<CampusArrivalRow row={row({ seconds: 120 })} now={now} />);
  expect(minutes()).toBe(changed);
  expect(isChanging()).toBe(true);
});

it('keeps the minute node stable when opening and closing route details', () => {
  const onSelect = vi.fn();
  const { rerender } = render(<CampusArrivalRow row={row()} now={now} onSelect={onSelect} />);
  rerender(<CampusArrivalRow row={row({ seconds: 120 })} now={now} onSelect={onSelect} />);
  const changed = minutes();
  const button = screen.getByRole('button', { name: '162 往 沙鹿火車站 2 分' });

  fireEvent.click(button);
  expect(screen.getByTestId('opened-route-panel').textContent).toContain('終點 沙鹿火車站');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(minutes()).toBe(changed);
  expect(onSelect).toHaveBeenCalledOnce();
  expect(revealStopResult).toHaveBeenCalledOnce();

  rerender(<CampusArrivalRow row={row({ seconds: 120 })} now={now} onSelect={onSelect} />);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(minutes()).toBe(changed);
  fireEvent.click(button);
  expect(screen.queryByTestId('opened-route-panel')).toBeNull();
  expect(minutes()).toBe(changed);
});

it('does not animate offline or stale updates or replay them when live updates resume', () => {
  const { rerender } = render(<CampusArrivalRow row={row()} now={now} />);
  rerender(<CampusArrivalRow row={row({ seconds: 120 })} now={now} animateUpdates={false} />);
  const offlineValue = minutes();
  expect(offlineValue.textContent).toBe('2');
  expect(isChanging()).toBe(false);

  rerender(<CampusArrivalRow row={row({ seconds: 120 })} now={now} animateUpdates />);
  expect(minutes()).toBe(offlineValue);
  expect(isChanging()).toBe(false);

  rerender(<CampusArrivalRow row={row({ seconds: 180 })} now={now} animateUpdates />);
  expect(isChanging()).toBe(true);
  rerender(<CampusArrivalRow row={row({ seconds: 180 })} now={now} animateUpdates={false} />);
  expect(isChanging()).toBe(false);
});

it('removes expired live minutes and starts fresh without animating a recovered value', () => {
  const { rerender } = render(<CampusArrivalRow row={row()} now={now} />);
  rerender(<CampusArrivalRow row={row()} now={now + 91_000} />);
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
  expect(screen.getByText('暫無班次資訊')).toBeTruthy();

  rerender(<CampusArrivalRow row={row({
    seconds: 120, updatedAt: new Date(now + 91_000).toISOString(),
  })} now={now + 91_000} />);
  expect(minutes().textContent).toBe('2');
  expect(isChanging()).toBe(false);
});

it('keeps timetable and ended statuses as text instead of a live counter', () => {
  const { rerender } = render(<CampusArrivalRow row={row({
    seconds: null, scheduledAt: new Date(now + 12 * 60_000).toISOString(),
  })} now={now} />);
  expect(screen.getByText(/表定 14:52/)).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();

  rerender(<CampusArrivalRow row={row({ status: 3, seconds: null })} now={now} />);
  expect(screen.getByText('今天收班')).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
});

it('keeps the arriving indication static when a live estimate reaches the stop', () => {
  const { rerender } = render(<CampusArrivalRow row={row({ seconds: 120 })} now={now} />);
  rerender(<CampusArrivalRow row={row({ seconds: 40 })} now={now} />);
  expect(screen.getByText('進站中')).toBeTruthy();
  expect(screen.queryByTestId('campus-eta-minutes')).toBeNull();
});
