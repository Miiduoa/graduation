import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdminHeader } from './AdminHeader';

const auth = vi.hoisted(() => ({
  session: {} as object | null,
  loading: false,
  pendingLogout: false,
  logout: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({ useNuniSession: () => auth }));

beforeEach(() => {
  auth.session = {};
  auth.loading = false;
  auth.pendingLogout = false;
  auth.logout.mockReset().mockResolvedValue(undefined);
});

it('waits for logout to finish before accepting another request', async () => {
  let finish!: () => void;
  auth.logout.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<AdminHeader />);
  fireEvent.click(screen.getByRole('button', { name: '登出' }));
  const pending = screen.getByRole('button', { name: '登出中…' }) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  fireEvent.click(pending);
  expect(auth.logout).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(screen.getByRole('button', { name: '登出' })).toBeTruthy());
});

it('keeps retrying an incomplete logout available without an active session', () => {
  auth.session = null;
  auth.pendingLogout = true;
  render(<AdminHeader />);
  fireEvent.click(screen.getByRole('button', { name: '重試登出' }));
  expect(auth.logout).toHaveBeenCalledTimes(1);
});
