import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WAKE_REQUEST_TIMEOUT_MS, withWakeRetry } from '@campus/shared/src/wakeAwareRequest';
import { browserRequest, NuniSessionProvider, useNuniSession } from './Session';

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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function useFakeRequestTimeouts() {
  vi.useFakeTimers();
  // Native AbortSignal.timeout does not follow Vitest's clock in every runtime.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException('The request timed out.', 'TimeoutError')),
      milliseconds,
    );
    return controller.signal;
  });
}

it('encodes food cursors as data while preserving origin and session restrictions', async () => {
  fetcher.mockResolvedValue(response({ orders: [] }));
  await browserRequest('realms/school-one/food/orders', contextA, undefined, undefined, {
    cursor: 'abc+/=next&personId=other',
  });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/nuni/realms/school-one/food/orders?cursor=abc%2B%2F%3Dnext%26personId%3Dother',
    expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      headers: { 'X-Campus-Session': contextA },
    }),
  );
  await expect(browserRequest('//foreign.test', contextA)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  await expect(
    browserRequest('realms/school-one/food/orders', contextA, {}, undefined, { cursor: 'abc' }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps a GET alive past 12 seconds while the BFF finishes its second upstream attempt', async () => {
  useFakeRequestTimeouts();
  const payload = { workspaces: [] };
  let attempts = 0;
  const upstream = vi.fn(
    (signal: AbortSignal) =>
      new Promise<Response>((resolve, reject) => {
        attempts += 1;
        let ready: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
          clearTimeout(ready);
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        // The cold first attempt times out; the warm retry answers three seconds later.
        if (attempts === 2)
          ready = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve(response(payload));
          }, 3000);
      }),
  );
  fetcher.mockImplementation(
    (_path: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal!;
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        // Model the existing BFF retry, without adding a second browser request.
        void withWakeRetry(upstream, { timeoutMs: WAKE_REQUEST_TIMEOUT_MS }).then((result) => {
          signal.removeEventListener('abort', abort);
          resolve(result);
        }, reject);
      }),
  );
  const outcome = browserRequest('class-workspaces', contextA).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(12_000);
  expect(upstream).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(outcome).resolves.toEqual({ value: payload });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'X-Campus-Session': contextA },
  });
});

it.each(['POST', 'PUT'] as const)('keeps %s at 12 seconds without retrying', async (method) => {
  useFakeRequestTimeouts();
  fetcher.mockImplementation(
    (_path: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init.signal!;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const outcome = browserRequest('class-workspaces', contextA, {}, method).catch(
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(11_999);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await expect(outcome).resolves.toMatchObject({ name: 'TimeoutError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

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

it('hydrates against the server loading markup after a restored session', async () => {
  fetcher.mockResolvedValue(response(signed()));
  const app = (
    <NuniSessionProvider>
      <View />
    </NuniSessionProvider>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.querySelector('span')?.textContent).toBe('checking');
  expect(container.querySelector('output')?.textContent).toBe('signed-out');
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(await screen.findByText(accountA)).toBeTruthy();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
