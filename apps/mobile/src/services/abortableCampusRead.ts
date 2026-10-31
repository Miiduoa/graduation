/**
 * Firebase callable promises do not expose a transport abort handle. Stop the
 * local wait, consume any late rejection, and let the caller stop subsequent
 * pages. Already-sent server work is not recalled by cancellation or timeout.
 */
export const CAMPUS_SENSE_PAGE_TIMEOUT_MS = 45_000;

export function abortableCampusRead<T>(
  read: () => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = CAMPUS_SENSE_PAGE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener('abort', cancel);
    };
    const finish = (result: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ('error' in result) reject(result.error);
      else resolve(result.value);
    };
    const cancel = () => finish({ error: new Error('sense-cancelled') });
    if (signal?.aborted) { cancel(); return; }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      finish({ error: new Error('sense-timeout') });
      return;
    }
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    timer = setTimeout(() => finish({ error: new Error('sense-timeout') }), timeoutMs);
    try {
      read().then((value) => finish({ value }), (error: unknown) => finish({ error }));
    } catch (error) {
      finish({ error });
    }
  });
}
