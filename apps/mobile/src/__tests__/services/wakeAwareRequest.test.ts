import { WAKE_REQUEST_TIMEOUT_MS, withWakeRetry } from '@campus/shared/src/wakeAwareRequest';

describe('shared wake request lifecycle in the mobile test runtime', () => {
  const methods = ['any', 'timeout'] as const;
  let descriptors: Array<PropertyDescriptor | undefined>;

  beforeEach(() => {
    jest.useFakeTimers();
    descriptors = methods.map((method) => Object.getOwnPropertyDescriptor(AbortSignal, method));
    for (const method of methods) {
      Object.defineProperty(AbortSignal, method, { configurable: true, value: undefined });
    }
  });

  afterEach(() => {
    methods.forEach((method, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(AbortSignal, method, descriptor);
      else Reflect.deleteProperty(AbortSignal, method);
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('clears both fallback timers and listeners after a successful retry', async () => {
    const caller = new AbortController();
    const add = jest.spyOn(caller.signal, 'addEventListener');
    const remove = jest.spyOn(caller.signal, 'removeEventListener');
    const signals: AbortSignal[] = [];
    const run = jest.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      if (signals.length === 1) throw { status: 503 };
      return 'ready';
    });

    await expect(withWakeRetry(run, { externalSignal: caller.signal })).resolves.toBe('ready');

    expect(run).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
    const listeners = add.mock.calls.filter(([type]) => type === 'abort');
    expect(listeners).toHaveLength(2);
    for (const [, listener] of listeners) {
      expect(remove).toHaveBeenCalledWith('abort', listener);
    }
    caller.abort();
    jest.advanceTimersByTime(WAKE_REQUEST_TIMEOUT_MS * 2);
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
  });

  it('does not leave a timeout running when the caller cancels an active request', async () => {
    const caller = new AbortController();
    const remove = jest.spyOn(caller.signal, 'removeEventListener');
    const cancellation = new Error('screen closed');
    const run = jest.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(cancellation), { once: true });
        }),
    );

    const pending = withWakeRetry(run, { externalSignal: caller.signal });
    const rejected = expect(pending).rejects.toBe(cancellation);
    expect(jest.getTimerCount()).toBe(1);
    caller.abort();
    await rejected;
    expect(run).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries an expired request once and disposes the final fallback timer', async () => {
    const caller = new AbortController();
    const add = jest.spyOn(caller.signal, 'addEventListener');
    const remove = jest.spyOn(caller.signal, 'removeEventListener');
    const timeout = Object.assign(new Error('request expired'), { name: 'AbortError' });
    const run = jest.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(timeout), { once: true });
        }),
    );

    const pending = withWakeRetry(run, { externalSignal: caller.signal, timeoutMs: 1 });
    const rejected = expect(pending).rejects.toBe(timeout);
    await jest.advanceTimersByTimeAsync(WAKE_REQUEST_TIMEOUT_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(WAKE_REQUEST_TIMEOUT_MS);
    await rejected;

    expect(run).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not allocate a timer or invoke transport for a pre-cancelled caller', async () => {
    const caller = new AbortController();
    caller.abort();
    const run = jest.fn(async () => 'unexpected');
    await expect(withWakeRetry(run, { externalSignal: caller.signal })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
