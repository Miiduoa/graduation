import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniSessionProvider, useNuniSession } from './Session';

const accountA = 'pa_11111111-1111-4111-8111-111111111111';
const accountB = 'pa_22222222-2222-4222-8222-222222222222';
const contextA = 'a'.repeat(43);
const contextB = 'b'.repeat(43);
const signed = (account = accountA, context = contextA) => ({
  authenticated: true,
  platformAccountId: account,
  isPlatformOperator: false,
  context,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetcher = vi.fn();

function View() {
  const { session, loading, error, refresh, logout, pendingLogout } = useNuniSession();
  return (
    <>
      <output>{session?.platformAccountId || 'signed-out'}</output>
      <p>{error}</p>
      <span>{loading ? 'checking' : 'ready'}</span>
      <span>{pendingLogout ? 'pending' : 'settled'}</span>
      <button onClick={refresh}>refresh</button>
      <button onClick={logout}>logout</button>
    </>
  );
}
beforeEach(() => vi.stubGlobal('fetch', fetcher.mockReset()));
afterEach(() => vi.unstubAllGlobals());

it('discards a delayed session read after logout has started', async () => {
  let finishRead!: (response: Response) => void;
  fetcher.mockResolvedValueOnce(response(signed()));
  render(
    <NuniSessionProvider>
      <View />
    </NuniSessionProvider>,
  );
  await screen.findByText(accountA);
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  fireEvent.click(screen.getByText('refresh'));
  fetcher
    .mockResolvedValueOnce(response(signed()))
    .mockResolvedValueOnce(response({ authenticated: false }));
  fireEvent.click(screen.getByText('logout'));
  await waitFor(() => expect(screen.getByText('settled')).toBeTruthy());
  await act(async () => {
    finishRead(response(signed()));
  });
  expect(screen.queryByText(accountA)).toBeNull();
});

it('does not revoke another account when the cookie changes after the page was opened', async () => {
  fetcher
    .mockResolvedValueOnce(response(signed()))
    .mockResolvedValueOnce(response(signed(accountB, contextB)));
  render(
    <NuniSessionProvider>
      <View />
    </NuniSessionProvider>,
  );
  await screen.findByText(accountA);
  fireEvent.click(screen.getByText('logout'));
  await screen.findByText('帳號已變更，請重新確認登入狀態。');
  expect(fetcher.mock.calls.every(([path]) => path === '/api/nuni/session')).toBe(true);
  expect(localStorage.getItem('campus-one.nuni.logout-pending')).toBeNull();
});

it('keeps data hidden across remounts when a logout response is lost', async () => {
  fetcher
    .mockResolvedValueOnce(response(signed()))
    .mockResolvedValueOnce(response(signed()))
    .mockRejectedValueOnce(new TypeError('offline'));
  const first = render(
    <NuniSessionProvider>
      <View />
    </NuniSessionProvider>,
  );
  await screen.findByText(accountA);
  fireEvent.click(screen.getByText('logout'));
  await screen.findByText('登出尚未完成，請重試以結束這次登入。');
  expect(localStorage.getItem('campus-one.nuni.logout-pending')).toBe(contextA);
  expect(screen.queryByText(accountA)).toBeNull();
  first.unmount();
  fetcher.mockResolvedValueOnce(response(signed()));
  render(
    <NuniSessionProvider>
      <View />
    </NuniSessionProvider>,
  );
  await screen.findByText('登出尚未完成，請重試以結束這次登入。');
  expect(screen.queryByText(accountA)).toBeNull();
  fetcher
    .mockResolvedValueOnce(response(signed()))
    .mockResolvedValueOnce(response({ authenticated: false }));
  fireEvent.click(screen.getByText('logout'));
  await waitFor(() => expect(localStorage.getItem('campus-one.nuni.logout-pending')).toBeNull());
  expect(screen.queryByText(accountA)).toBeNull();
});

it('keeps the same session mounted during revalidation and replaces it only after a verified account change', async () => {
  let finishRead!: (response: Response) => void;
  fetcher.mockResolvedValueOnce(response(signed()));
  render(
    <NuniSessionProvider>
      <View />
    </NuniSessionProvider>,
  );
  await screen.findByText(accountA);
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  fireEvent.click(screen.getByText('refresh'));
  expect(screen.getByText('checking')).toBeTruthy();
  expect(screen.getByText(accountA)).toBeTruthy();
  await act(async () => {
    finishRead(response(signed(accountB, contextB)));
  });
  await screen.findByText(accountB);
  expect(screen.queryByText(accountA)).toBeNull();
});
