import { withConcurrencyLimit, withRetry } from '../../utils/retry';

describe('withRetry abort listener lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const config = { baseDelayMs: 100, exponentialBackoff: false, jitter: false };

  it('removes the same abort listener after each completed retry delay', async () => {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok');

    const result = withRetry(fn, { ...config, signal: controller.signal });
    await jest.advanceTimersByTimeAsync(0);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(100);
    expect(remove).toHaveBeenNthCalledWith(1, 'abort', add.mock.calls[0][1]);
    expect(add).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('ok');
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(2, 'abort', add.mock.calls[1][1]);
    controller.abort();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('clears the pending delay and removes its listener on abort', async () => {
    const controller = new AbortController();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const fn = jest.fn().mockRejectedValue(new Error('network'));

    const result = withRetry(fn, { ...config, signal: controller.signal });
    const assertion = expect(result).rejects.toThrow('Aborted');
    await jest.advanceTimersByTimeAsync(0);
    expect(add).toHaveBeenCalledTimes(1);
    const pendingTimers = jest.getTimerCount();
    controller.abort();
    await assertion;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
    expect(jest.getTimerCount()).toBe(pendingTimers - 1);
    await jest.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not register a listener or start a request for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const add = jest.spyOn(controller.signal, 'addEventListener');
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(withRetry(fn, { ...config, signal: controller.signal })).rejects.toThrow('Aborted');
    expect(fn).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('preserves retry behavior without an abort signal', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');
    const result = withRetry(fn, config);
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withConcurrencyLimit settlement tracking', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('keeps the actual pending tasks within the limit and returns results in input order', async () => {
    const tasks = Array.from({ length: 5 }, () => deferred<number>());
    const run = jest.fn((index: number) => tasks[index].promise);
    const result = withConcurrencyLimit([0, 1, 2, 3, 4], run, 2);

    await flush();
    expect(run.mock.calls.map(([index]) => index)).toEqual([0, 1]);

    tasks[0].resolve(10);
    await flush();
    expect(run.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);

    tasks[2].resolve(30);
    await flush();
    expect(run.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3]);

    tasks[3].resolve(40);
    await flush();
    expect(run.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3, 4]);

    tasks[4].resolve(50);
    tasks[1].resolve(20);
    await expect(result).resolves.toEqual([10, 20, 30, 40, 50]);
  });

  it('does not resolve while an earlier, slower task is still pending', async () => {
    const tasks = Array.from({ length: 3 }, () => deferred<number>());
    let finished = false;
    const result = withConcurrencyLimit([0, 1, 2], (index) => tasks[index].promise, 2)
      .then((values) => {
        finished = true;
        return values;
      });

    await flush();
    tasks[0].resolve(10);
    await flush();
    tasks[2].resolve(30);
    await flush();
    expect(finished).toBe(false);

    tasks[1].resolve(20);
    await expect(result).resolves.toEqual([10, 20, 30]);
  });

  it('propagates a rejection from a slower task instead of losing it', async () => {
    const tasks = Array.from({ length: 3 }, () => deferred<number>());
    const error = new Error('slow task failed');
    const result = withConcurrencyLimit([0, 1, 2], (index) => tasks[index].promise, 2);
    const assertion = expect(result).rejects.toBe(error);

    await flush();
    tasks[0].resolve(10);
    await flush();
    tasks[1].reject(error);
    tasks[2].resolve(30);
    await assertion;
  });

  it('does not repeatedly race a slow pending task as fast tasks complete', async () => {
    const slow = deferred<number>();
    const items = Array.from({ length: 128 }, (_, index) => index);
    const run = jest.fn((index: number) => index === 0 ? slow.promise : Promise.resolve(index));
    const race = jest.spyOn(Promise, 'race');

    try {
      const result = withConcurrencyLimit(items, run, 2);
      await flush();
      const raceCalls = race.mock.calls.length;
      slow.resolve(0);
      await expect(result).resolves.toEqual(items);
      expect(run).toHaveBeenCalledTimes(items.length);
      expect(raceCalls).toBe(0);
    } finally {
      slow.resolve(0);
      race.mockRestore();
    }
  });

  it('rejects promptly, observes late failures and stops dispatching queued work', async () => {
    const slow = deferred<number>();
    const failure = deferred<number>();
    const error = new Error('first failure');
    const run = jest.fn((index: number) => index === 0 ? slow.promise : failure.promise);
    const result = withConcurrencyLimit([0, 1, 2, 3], run, 2);
    const assertion = expect(result).rejects.toBe(error);

    await flush();
    failure.reject(error);
    await assertion;
    slow.reject(new Error('late failure'));
    await flush();

    expect(run.mock.calls.map(([index]) => index)).toEqual([0, 1]);
  });

  it('returns an empty list without starting any work', async () => {
    const run = jest.fn();
    await expect(withConcurrencyLimit([], run)).resolves.toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
