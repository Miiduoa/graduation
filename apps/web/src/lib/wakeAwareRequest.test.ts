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
