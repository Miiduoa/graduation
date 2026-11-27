import { act, renderHook } from '@testing-library/react-native';
import { useAsyncList } from '../../hooks/useAsyncList';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('useAsyncList request ownership', () => {
  it.each([
    ['reload', 'resolve'],
    ['reload', 'reject'],
    ['dependency change', 'resolve'],
    ['dependency change', 'reject'],
  ] as const)('ends an obsolete refresh on %s and ignores its late %s', async (change, outcome) => {
    const initial = deferred<string[]>();
    const staleRefresh = deferred<string[]>();
    const nextLoad = deferred<string[]>();
    const load = jest
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(nextLoad.promise);
    const onRefreshError = jest.fn();
    const onLoadError = jest.fn();
    const view = renderHook(
      ({ scope }) =>
        useAsyncList<string>(load, [scope], {
          onRefreshError,
          onLoadError,
        }),
      { initialProps: { scope: 'school-a' } },
    );
    await act(async () => initial.resolve(['initial']));

    let refreshing!: Promise<void>;
    act(() => {
      refreshing = view.result.current.refresh();
    });
    expect(view.result.current.refreshing).toBe(true);
    if (change === 'reload') act(() => view.result.current.reload());
    else view.rerender({ scope: 'school-b' });

    expect(load).toHaveBeenCalledTimes(3);
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.refreshing).toBe(false);
    await act(async () => nextLoad.resolve(['current']));
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.refreshing).toBe(false);
    expect(view.result.current.items).toEqual(['current']);

    await act(async () => {
      if (outcome === 'resolve') staleRefresh.resolve(['obsolete']);
      else staleRefresh.reject(new Error('obsolete refresh failed'));
      await refreshing;
    });
    expect(view.result.current.items).toEqual(['current']);
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.refreshing).toBe(false);
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.lastRefreshError).toBeNull();
    expect(onRefreshError).not.toHaveBeenCalled();
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it('keeps a newer refresh active when the superseded refresh finishes', async () => {
    const initial = deferred<string[]>();
    const staleRefresh = deferred<string[]>();
    const currentRefresh = deferred<string[]>();
    const load = jest
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(currentRefresh.promise);
    const view = renderHook(() => useAsyncList<string>(load, []));
    await act(async () => initial.resolve(['initial']));

    let stale!: Promise<void>;
    let current!: Promise<void>;
    act(() => {
      stale = view.result.current.refresh();
    });
    act(() => {
      current = view.result.current.refresh();
    });
    await act(async () => {
      staleRefresh.resolve(['obsolete']);
      await stale;
    });
    expect(view.result.current.refreshing).toBe(true);
    expect(view.result.current.items).toEqual(['initial']);

    await act(async () => {
      currentRefresh.resolve(['current']);
      await current;
    });
    expect(view.result.current.refreshing).toBe(false);
    expect(view.result.current.items).toEqual(['current']);
  });

  it('clears a previous refresh error when a new scope starts loading', async () => {
    const initial = deferred<string[]>();
    const nextLoad = deferred<string[]>();
    const load = jest
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockReturnValueOnce(nextLoad.promise);
    const view = renderHook(({ scope }) => useAsyncList<string>(load, [scope]), {
      initialProps: { scope: 'school-a' },
    });
    await act(async () => initial.resolve(['initial']));
    await act(() => view.result.current.refresh());
    expect(view.result.current.lastRefreshError).toBe('refresh failed');

    view.rerender({ scope: 'school-b' });
    expect(view.result.current.lastRefreshError).toBeNull();
    await act(async () => nextLoad.resolve(['current']));
    expect(view.result.current.items).toEqual(['current']);
    expect(view.result.current.lastRefreshError).toBeNull();
  });
});

describe('useAsyncList retry timer lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('clears the pending retry timer when the list unmounts', async () => {
    const initial = deferred<string[]>();
    const load = jest.fn().mockReturnValue(initial.promise);
    const schedule = jest.spyOn(global, 'setTimeout');
    const clear = jest.spyOn(global, 'clearTimeout');
    const view = renderHook(() =>
      useAsyncList<string>(load, [], { retryCount: 1, retryDelay: 12345 }),
    );

    await act(async () => initial.reject(new Error('temporary failure')));
    const index = schedule.mock.calls.findIndex(([, delay]) => delay === 12345);
    expect(index).toBeGreaterThanOrEqual(0);
    const timer = schedule.mock.results[index].value;

    view.unmount();
    expect(clear).toHaveBeenCalledWith(timer);
    await act(async () => jest.advanceTimersByTime(12345));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a retry for a request rejected after unmount', async () => {
    const initial = deferred<string[]>();
    const load = jest.fn().mockReturnValue(initial.promise);
    const schedule = jest.spyOn(global, 'setTimeout');
    const view = renderHook(() =>
      useAsyncList<string>(load, [], { retryCount: 1, retryDelay: 12345 }),
    );

    view.unmount();
    await act(async () => initial.reject(new Error('late failure')));
    expect(schedule.mock.calls.some(([, delay]) => delay === 12345)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('clears the old retry timer when a refresh takes ownership', async () => {
    const initial = deferred<string[]>();
    const load = jest.fn().mockReturnValueOnce(initial.promise).mockResolvedValueOnce(['fresh']);
    const schedule = jest.spyOn(global, 'setTimeout');
    const clear = jest.spyOn(global, 'clearTimeout');
    const view = renderHook(() =>
      useAsyncList<string>(load, [], { retryCount: 1, retryDelay: 12345 }),
    );

    await act(async () => initial.reject(new Error('temporary failure')));
    const index = schedule.mock.calls.findIndex(([, delay]) => delay === 12345);
    expect(index).toBeGreaterThanOrEqual(0);
    const timer = schedule.mock.results[index].value;

    await act(() => view.result.current.refresh());
    expect(clear).toHaveBeenCalledWith(timer);
    await act(async () => jest.advanceTimersByTime(12345));
    expect(load).toHaveBeenCalledTimes(2);
    expect(view.result.current.items).toEqual(['fresh']);
    expect(view.result.current.loading).toBe(false);
  });

  it('still retries an active request after the configured delay', async () => {
    const initial = deferred<string[]>();
    const load = jest.fn().mockReturnValueOnce(initial.promise).mockResolvedValueOnce(['retry']);
    const view = renderHook(() =>
      useAsyncList<string>(load, [], { retryCount: 1, retryDelay: 12345 }),
    );

    await act(async () => initial.reject(new Error('temporary failure')));
    await act(async () => jest.advanceTimersByTime(12344));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(1));
    expect(load).toHaveBeenCalledTimes(2);
    expect(view.result.current.items).toEqual(['retry']);
    expect(view.result.current.loading).toBe(false);
  });
});
