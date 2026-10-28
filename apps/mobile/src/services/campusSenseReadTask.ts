/**
 * Stop accepting an obsolete read without claiming to cancel an already-sent
 * Firebase request. Both promise branches stay observed after abort/timeout.
 */
export const CAMPUS_SENSE_PAGE_TIMEOUT_MS = 45_000;

export function awaitCampusSenseRead<T>(
  start: () => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = CAMPUS_SENSE_PAGE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const finish = (result: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ('error' in result) reject(result.error);
      else resolve(result.value);
    };
    const abort = () => finish({ error: new Error('sense-cancelled') });
    if (signal?.aborted) {
      abort();
      return;
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      finish({ error: new Error('sense-timeout') });
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    // Account for abort between the initial check and listener installation.
    if (signal?.aborted) {
      abort();
      return;
    }
    timer = setTimeout(() => finish({ error: new Error('sense-timeout') }), timeoutMs);
    try {
      start().then(
        (value) => finish({ value }),
        (error: unknown) => finish({ error }),
      );
    } catch (error) {
      finish({ error });
    }
  });
}
