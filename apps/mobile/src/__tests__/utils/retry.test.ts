import { withRetry } from '../../utils/retry';

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
