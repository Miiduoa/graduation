import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FOOD_POLL_MS, useFoodRead } from './foodState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function visibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => {
  vi.useFakeTimers();
  visibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
});
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('polls every ten seconds without a visibility event, and stops on unmount', async () => {
  const load = vi.fn().mockResolvedValue('current');
  const view = renderHook(() => useFoodRead(load, { pollMs: FOOD_POLL_MS }));
  await flush();
  expect(load).toHaveBeenCalledTimes(1);
  await advance(9_999);
  expect(load).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(load).toHaveBeenCalledTimes(2);
  await advance(10_000);
  expect(load).toHaveBeenCalledTimes(3);
  view.unmount();
  await advance(20_000);
  expect(load).toHaveBeenCalledTimes(3);
});

it('pauses in background and refreshes immediately on return', async () => {
  const load = vi.fn().mockResolvedValue('current');
  renderHook(() => useFoodRead(load, { pollMs: FOOD_POLL_MS }));
  await flush();
  act(() => visibility('hidden'));
  await advance(30_000);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => visibility('visible'));
  expect(load).toHaveBeenCalledTimes(2);
  await advance(10_000);
  expect(load).toHaveBeenCalledTimes(3);
});

it('queues one explicit refresh after an active read and deduplicates quiet reads', async () => {
  const first = deferred<string>();
  const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('new receipt');
  const view = renderHook(() => useFoodRead(load, { pollMs: FOOD_POLL_MS }));
  let manual!: Promise<void>;
  act(() => {
    manual = view.result.current.reload();
    void view.result.current.reload();
    void view.result.current.quietReload();
  });
  await advance(10_000);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.resolve('old receipt');
    await manual;
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(view.result.current.data).toBe('new receipt');
  expect(view.result.current.loading).toBe(false);
});

it('does not let a previous account or order response replace the current scope', async () => {
  const first = deferred<string>();
  const oldLoad = vi.fn(() => first.promise);
  const nextLoad = vi.fn().mockResolvedValue('new account');
  const view = renderHook(({ load }) => useFoodRead(load, { pollMs: FOOD_POLL_MS }), {
    initialProps: { load: oldLoad },
  });
  view.rerender({ load: nextLoad });
  await flush();
  await act(async () => first.resolve('old account'));
  expect(view.result.current.data).toBe('new account');
  await advance(10_000);
  expect(oldLoad).toHaveBeenCalledTimes(1);
  expect(nextLoad).toHaveBeenCalledTimes(2);
});

it('stops automatic refresh after a terminal result but permits manual reload', async () => {
  const load = vi.fn().mockResolvedValueOnce('ready').mockResolvedValue('fulfilled');
  const view = renderHook(() =>
    useFoodRead(load, { pollMs: FOOD_POLL_MS, shouldPoll: (value) => value !== 'fulfilled' }),
  );
  await flush();
  await advance(10_000);
  expect(view.result.current.data).toBe('fulfilled');
  await advance(30_000);
  await act(async () => visibility('visible'));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => view.result.current.reload());
  expect(load).toHaveBeenCalledTimes(3);
});

it('removes stale permissions or pickup credentials when a poll fails and retries later', async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce('pickup credential')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue('fulfilled');
  const view = renderHook(() => useFoodRead(load, { pollMs: FOOD_POLL_MS }));
  await flush();
  await advance(10_000);
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.error).not.toBe('');
  await advance(10_000);
  expect(view.result.current.data).toBe('fulfilled');
  expect(view.result.current.error).toBe('');
});
