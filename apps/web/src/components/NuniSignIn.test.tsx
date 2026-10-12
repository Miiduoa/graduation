import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniSignIn } from './NuniSignIn';

const mocks = vi.hoisted(() => ({
  session: null as null | { platformAccountId: string },
  loading: false,
  pendingLogout: false,
  error: '',
  refresh: vi.fn(),
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
  mocks.error = '';
  mocks.request.mockResolvedValue({ google: true });
});
it('keeps the requested task through the native OAuth form', async () => {
  render(<NuniSignIn returnUrl="/social?campus=pu" />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
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
  expect(screen.queryByRole('button', { name: '使用 Google 帳號繼續' })).toBeNull();
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
  await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
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
  expect(screen.queryByRole('button', { name: '使用 Google 帳號繼續' })).toBeNull();
});

it('uses one Google flow for a first account and a returning account', async () => {
  render(<NuniSignIn />);
  expect(screen.getByText(/第一次使用？透過 Google 繼續即可建立帳號/)).toBeTruthy();
  expect(await screen.findByRole('button', { name: '使用 Google 帳號繼續' })).toBeTruthy();
  expect(screen.queryByLabelText('密碼')).toBeNull();
  expect(screen.queryByRole('button', { name: '註冊' })).toBeNull();
});
it('rechecks an unknown session before starting a different login', async () => {
  mocks.error = '無法確認登入狀態，請重新連線後再試。';
  const view = render(<NuniSignIn />);
  expect(screen.getByRole('alert').textContent).toContain(mocks.error);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '使用 Google 帳號繼續' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  mocks.error = '';
  mocks.loading = true;
  view.rerender(<NuniSignIn />);
  expect(screen.getByRole('status').textContent).toBe('正在確認帳號…');
  mocks.loading = false;
  view.rerender(<NuniSignIn />);
  expect(await screen.findByRole('button', { name: '使用 Google 帳號繼續' })).toBeTruthy();
});
it('switches accounts only after the prior logout has completed', async () => {
  mocks.session = { platformAccountId: 'a' };
  const view = render(<NuniSignIn returnUrl="/social?campus=pu" />);
  fireEvent.click(screen.getByRole('button', { name: '登出並切換帳號' }));
  expect(mocks.logout).toHaveBeenCalledOnce();
  mocks.session = null;
  mocks.pendingLogout = true;
  view.rerender(<NuniSignIn returnUrl="/social?campus=pu" />);
  expect(screen.queryByRole('button', { name: '使用 Google 帳號繼續' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試登出' }));
  expect(mocks.logout).toHaveBeenCalledTimes(2);
  mocks.pendingLogout = false;
  view.rerender(<NuniSignIn returnUrl="/social?campus=pu" />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
  expect(button.closest('form')?.getAttribute('action')).toBe(
    '/auth/platform/start?returnUrl=%2Fsocial%3Fcampus%3Dpu',
  );
});

it('starts one OAuth transaction and enables retry after browser back', async () => {
  const onStart = vi.fn(() => true);
  render(<NuniSignIn returnUrl="/merchant" onStart={onStart} />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
  const form = button.closest('form')!;
  expect(fireEvent.submit(form)).toBe(true);
  expect(fireEvent.submit(form)).toBe(false);
  expect(onStart).toHaveBeenCalledOnce();
  expect(
    (screen.getByRole('button', { name: '正在前往 Google…' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent(window, new Event('pageshow'));
  expect(fireEvent.submit(form)).toBe(true);
  expect(onStart).toHaveBeenCalledTimes(2);
});
it('does not start OAuth while another credential flow owns the login form', async () => {
  const onStart = vi.fn(() => false);
  render(<NuniSignIn onStart={onStart} />);
  const button = await screen.findByRole('button', { name: '使用 Google 帳號繼續' });
  expect(fireEvent.submit(button.closest('form')!)).toBe(false);
  expect((button as HTMLButtonElement).disabled).toBe(false);
});
