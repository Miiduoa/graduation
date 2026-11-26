import { afterEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import {
  WAKE_REQUEST_TIMEOUT_MS,
  isWakeRetryableFailure,
  withWakeRetry,
} from '@campus/shared/src/wakeAwareRequest';

afterEach(() => {
  vi.useRealTimers();
});

it('retries a waking-database failure once and waits at least ten seconds', async () => {
  expect(WAKE_REQUEST_TIMEOUT_MS).toBe(10_000);
  expect(isWakeRetryableFailure(new NuniError(503, 'SERVICE_UNAVAILABLE'))).toBe(true);
  expect(isWakeRetryableFailure(new NuniError(401, 'SIGN_IN_REQUIRED'))).toBe(false);
  expect(isWakeRetryableFailure(new NuniError(0, 'REQUEST_CANCELLED'))).toBe(false);

  const run = vi
    .fn()
    .mockRejectedValueOnce(new NuniError(503, 'SERVICE_UNAVAILABLE'))
    .mockResolvedValueOnce({ ok: true });
  await expect(withWakeRetry(run, { timeoutMs: 10_000 })).resolves.toEqual({ ok: true });
  expect(run).toHaveBeenCalledTimes(2);
});

it('does not retry a caller abort or a 4xx failure', async () => {
  const controller = new AbortController();
  controller.abort();
  const run = vi.fn(async () => {
    throw new NuniError(0, 'REQUEST_CANCELLED');
  });
  await expect(withWakeRetry(run, { externalSignal: controller.signal })).rejects.toThrow();
  expect(run).toHaveBeenCalledTimes(0);

  const forbidden = vi.fn(async () => {
    throw new NuniError(403, 'FORBIDDEN');
  });
  await expect(withWakeRetry(forbidden)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(forbidden).toHaveBeenCalledTimes(1);
});

async function withoutNativeSignalAny(run: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    await run();
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal, 'any', descriptor);
    else Reflect.deleteProperty(AbortSignal, 'any');
  }
}

it('releases legacy abort listeners after every attempt, including a retry', async () => {
  await withoutNativeSignalAny(async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const run = vi
      .fn()
      .mockRejectedValueOnce(new NuniError(503, 'SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce('ready');
    try {
      await expect(withWakeRetry(run, { externalSignal: controller.signal })).resolves.toBe(
        'ready',
      );
      expect(run).toHaveBeenCalledTimes(2);
      const listeners = add.mock.calls
        .filter(([type]) => type === 'abort')
        .map(([, listener]) => listener);
      expect(listeners).toHaveLength(2);
      for (const listener of listeners) {
        expect(remove).toHaveBeenCalledWith('abort', listener);
      }
      expect(remove).toHaveBeenCalledTimes(2);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
});

it('preserves the caller abort reason and removes the legacy listener without retrying', async () => {
  await withoutNativeSignalAny(async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reason = new Error('navigation cancelled');
    const run = vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          controller.abort(reason);
        }),
    );
    try {
      await expect(withWakeRetry(run, { externalSignal: controller.signal })).rejects.toBe(reason);
      expect(run).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      remove.mockRestore();
    }
  });
});

it('releases legacy listeners after a non-retryable failure', async () => {
  await withoutNativeSignalAny(async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const run = vi.fn(async () => {
      throw new NuniError(403, 'FORBIDDEN');
    });
    try {
      await expect(withWakeRetry(run, { externalSignal: controller.signal })).rejects.toMatchObject(
        { code: 'FORBIDDEN' },
      );
      expect(run).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      remove.mockRestore();
    }
  });
});
