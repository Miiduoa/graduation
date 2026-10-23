import { act, cleanupAsync, renderHook } from '@testing-library/react-native/pure';
import { AppState, type AppStateStatus } from 'react-native';
import { FOOD_POLL_MS, useFoodLoad } from '../screens/nuni/NuniFoodUi';

const mockRefresh = jest.fn();
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => ({ refresh: mockRefresh }) }));
let listeners = new Set<(state: AppStateStatus) => void>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function visibility(state: AppStateStatus) {
  // Deliberately do not update currentState: the event itself is authoritative.
  for (const listener of listeners) listener(state);
}
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
});
afterEach(async () => {
  await cleanupAsync();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });

it('polls every ten seconds without a visibility event, and stops on unmount', async () => {
  const load = jest.fn().mockResolvedValue('current');
  const view = renderHook(() => useFoodLoad(load, { pollMs: FOOD_POLL_MS }));
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
  const load = jest.fn().mockResolvedValue('current');
  renderHook(() => useFoodLoad(load, { pollMs: FOOD_POLL_MS }));
  await flush();
  act(() => visibility('background'));
  await advance(30_000);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => visibility('active'));
  expect(load).toHaveBeenCalledTimes(2);
  await advance(10_000);
  expect(load).toHaveBeenCalledTimes(3);
});

it('queues one explicit refresh after an active read and deduplicates quiet reads', async () => {
  const first = deferred<string>();
  const load = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue('new receipt');
  const view = renderHook(() => useFoodLoad(load, { pollMs: FOOD_POLL_MS }));
  let manual!: Promise<void>;
  act(() => {
    manual = view.result.current.load();
    void view.result.current.load();
    void view.result.current.quietLoad();
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
  const oldLoad = jest.fn(() => first.promise);
  const nextLoad = jest.fn().mockResolvedValue('new account');
  const view = renderHook(({ load }) => useFoodLoad(load, { pollMs: FOOD_POLL_MS }), {
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
  const load = jest.fn().mockResolvedValueOnce('ready').mockResolvedValue('fulfilled');
  const view = renderHook(() =>
    useFoodLoad(load, { pollMs: FOOD_POLL_MS, shouldPoll: (value) => value !== 'fulfilled' }),
  );
  await flush();
  await advance(10_000);
  await flush();
  expect(view.result.current.data).toBe('fulfilled');
  await advance(30_000);
  await act(async () => visibility('active'));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => view.result.current.load());
  expect(load).toHaveBeenCalledTimes(3);
});

it('removes stale permissions or pickup credentials when a poll fails and retries later', async () => {
  const load = jest
    .fn()
    .mockResolvedValueOnce('pickup credential')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue('fulfilled');
  const view = renderHook(() => useFoodLoad(load, { pollMs: FOOD_POLL_MS }));
  await flush();
  await advance(10_000);
  await flush();
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.error).not.toBe('');
  await advance(10_000);
  await flush();
  expect(view.result.current.data).toBe('fulfilled');
  expect(view.result.current.error).toBe('');
});
