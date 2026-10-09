import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniSignIn } from './NuniSignIn';

const mocks = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string },
  loading: false,
  pendingLogout: false,
  logout: vi.fn(),
  request: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => mocks,
  browserRequest: mocks.request,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = null;
  mocks.loading = false;
  mocks.pendingLogout = false;
  mocks.request.mockResolvedValue({ google: true });
});
it('keeps the requested task through the native OAuth form', async () => {
  render(<NuniSignIn returnUrl="/social?campus=pu" />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號登入' });
  expect(button.closest('form')?.getAttribute('action')).toBe(
    '/auth/platform/start?returnUrl=%2Fsocial%3Fcampus%3Dpu',
  );
});
it('recognizes an authenticated account and avoids school-login redirect loops', () => {
  mocks.session = { platformAccountId: 'a' };
  render(<NuniSignIn returnUrl="/grades" />);
  expect(screen.getByRole('link', { name: '繼續使用' }).getAttribute('href')).toBe('/classroom');
  expect(mocks.request).not.toHaveBeenCalled();
});
it('blocks a new login until pending logout is completed', () => {
  mocks.pendingLogout = true;
  render(<NuniSignIn />);
  fireEvent.click(screen.getByRole('button', { name: '重試登出' }));
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).toBeNull();
});
it('hides the prior account while its authority is being checked', () => {
  mocks.session = { platformAccountId: 'a' };
  const view = render(<NuniSignIn />);
  expect(screen.getByRole('link', { name: '繼續使用' })).toBeTruthy();
  mocks.loading = true;
  view.rerender(<NuniSignIn />);
  expect(screen.queryByRole('link', { name: '繼續使用' })).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('正在確認帳號…');
});
it('recovers from unavailable login options and ignores an old request', async () => {
  let finish!: (v: unknown) => void;
  mocks.request.mockRejectedValueOnce(new Error('offline'));
  const view = render(<NuniSignIn />);
  fireEvent.click(await screen.findByRole('button', { name: '重新確認' }));
  await screen.findByRole('button', { name: '使用 Google 帳號登入' });
  view.unmount();
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const other = render(<NuniSignIn />);
  mocks.pendingLogout = true;
  other.rerender(<NuniSignIn />);
  await act(async () => finish({ google: true }));
  expect(screen.queryByRole('button', { name: '使用 Google 帳號登入' })).toBeNull();
});
