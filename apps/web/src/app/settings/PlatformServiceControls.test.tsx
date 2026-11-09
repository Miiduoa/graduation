import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlatformServiceControls } from './PlatformServiceControls';

const runtime = vi.hoisted(() => ({
  session: { platformAccountId: 'pa_a', context: 'a' } as { platformAccountId: string; context: string } | null,
  loading: false,
  pendingLogout: false,
  error: '',
  refresh: vi.fn(),
  request: vi.fn(),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({
    session: runtime.session,
    loading: runtime.loading,
    pendingLogout: runtime.pendingLogout,
    error: runtime.error,
    refresh: runtime.refresh,
  }),
  browserRequest: runtime.request,
}));
beforeEach(() => {
  vi.clearAllMocks();
  runtime.session = { platformAccountId: 'pa_a', context: 'a' };
  runtime.loading = false;
  runtime.pendingLogout = false;
  runtime.error = '';
});
afterEach(cleanup);

it('loads current Google permissions and confirms a save from the server before showing success', async () => {
  let saved = { social: true, cloudAi: true, scope: 'web-session' };
  runtime.request.mockImplementation(async (_path: string, _context: string, input?: object) => {
    if (input) saved = { ...saved, ...input };
    return saved;
  });
  render(<PlatformServiceControls />);
  const social = await screen.findByRole('switch', { name: '公開社群' });
  const ai = screen.getByRole('switch', { name: '雲端 AI 助理' });
  expect(social.getAttribute('aria-checked')).toBe('true');
  expect(ai.getAttribute('aria-checked')).toBe('true');
  expect((screen.getByRole('button', { name: '儲存本次登入權限' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(ai);
  fireEvent.click(screen.getByRole('button', { name: '儲存本次登入權限' }));
  await waitFor(() => expect(screen.getByText('已套用到目前的網頁登入')).toBeTruthy());
  expect(runtime.request.mock.calls.filter((call) => call[2])).toEqual([
    ['service-access', 'a', { social: true, cloudAi: false }],
  ]);
  expect(runtime.request).toHaveBeenCalledTimes(3);
  expect(ai.getAttribute('aria-checked')).toBe('false');
});

it('keeps unverified saves in recovery rather than silently sending again', async () => {
  let reads = 0;
  runtime.request.mockImplementation(async (_path: string, _context: string, body?: object) => {
    if (body) return { social: false, cloudAi: true, scope: 'web-session' };
    reads += 1;
    return reads === 1
      ? { social: true, cloudAi: true, scope: 'web-session' }
      : { social: true, cloudAi: true, scope: 'web-session' };
  });
  render(<PlatformServiceControls />);
  fireEvent.click(await screen.findByRole('switch', { name: '公開社群' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存本次登入權限' }));
  await screen.findByText(/變更結果尚未確認/);
  expect(runtime.request.mock.calls.filter((call) => call[2])).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByRole('switch', { name: '公開社群' });
  expect(runtime.request.mock.calls.filter((call) => call[2])).toHaveLength(1);
});

it('does not reveal the previous account data after switching accounts during a delayed read', async () => {
  let releaseOld: ((value: unknown) => void) | undefined;
  runtime.request.mockImplementation((_path: string, context: string) =>
    context === 'a'
      ? new Promise((resolve) => { releaseOld = resolve; })
      : Promise.resolve({ social: false, cloudAi: true, scope: 'web-session' }),
  );
  const view = render(<PlatformServiceControls />);
  await waitFor(() => expect(releaseOld).toBeDefined());
  runtime.session = { platformAccountId: 'pa_b', context: 'b' };
  view.rerender(<PlatformServiceControls />);
  const social = await screen.findByRole('switch', { name: '公開社群' });
  expect(social.getAttribute('aria-checked')).toBe('false');
  await act(async () => { releaseOld?.({ social: true, cloudAi: true, scope: 'web-session' }); });
  expect(social.getAttribute('aria-checked')).toBe('false');
});

it('does not show writable controls for a Google-only visitor or uncertain logout', async () => {
  runtime.session = null;
  const view = render(<PlatformServiceControls />);
  expect(screen.getByRole('link', { name: '使用 Google 登入' })).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  runtime.pendingLogout = true;
  view.rerender(<PlatformServiceControls />);
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認登入' }));
  expect(runtime.refresh).toHaveBeenCalledTimes(1);
});

it('reloads the latest restrictions after a different tab changes platform access', async () => {
  let values = { social: true, cloudAi: true, scope: 'web-session' };
  runtime.request.mockImplementation(async (_path: string, _context: string, input?: object) => {
    if (input) values = { ...values, ...input };
    return values;
  });
  render(<PlatformServiceControls />);
  const social = await screen.findByRole('switch', { name: '公開社群' });
  fireEvent.click(social);
  expect(social.getAttribute('aria-checked')).toBe('false');
  values = { ...values, social: false, cloudAi: false };
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key: 'nuni.platform.service-access-changed', newValue: 'cloudAi:another-tab',
  })));
  await waitFor(() => expect(screen.getByRole('switch', { name: '雲端 AI 助理' }).getAttribute('aria-checked')).toBe('false'));
  expect(screen.getByRole('switch', { name: '公開社群' }).getAttribute('aria-checked')).toBe('false');
  expect(runtime.request.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

it('keeps account B editable while account A has an unfinished save', async () => {
  let finish!: (value: unknown) => void;
  runtime.request.mockImplementation((_path: string, ctx: string, input?: object) => (
    ctx === 'a' && input
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ social: ctx === 'a', cloudAi: true, scope: 'web-session' })
  ));
  const view = render(<PlatformServiceControls />);
  fireEvent.click(await screen.findByRole('switch', { name: '公開社群' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存本次登入權限' }));
  runtime.session = { platformAccountId: 'pa_b', context: 'b' };
  view.rerender(<PlatformServiceControls />);
  const other = await screen.findByRole('switch', { name: '公開社群' });
  expect(other.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(other);
  expect((screen.getByRole('button', { name: '儲存本次登入權限' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => finish({ social: false, cloudAi: true, scope: 'web-session' }));
  expect((screen.getByRole('button', { name: '儲存本次登入權限' }) as HTMLButtonElement).disabled).toBe(false);
});

it('does not announce a permission change on a failed server readback', async () => {
  runtime.request.mockImplementation(async (_path: string, _ctx: string, input?: object) =>
    ({ social: input ? false : true, cloudAi: true, scope: 'web-session' })
  );
  const notify = vi.spyOn(Storage.prototype, 'setItem');
  try {
    render(<PlatformServiceControls />);
    fireEvent.click(await screen.findByRole('switch', { name: '公開社群' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存本次登入權限' }));
    await screen.findByText(/變更結果尚未確認/);
    expect(notify.mock.calls.filter(([key]) => key === 'nuni.platform.service-access-changed')).toHaveLength(0);
  } finally {
    notify.mockRestore();
  }
});
