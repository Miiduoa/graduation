/**
 * Firebase callable promises do not expose a transport abort handle. Cancel the
 * local wait immediately, consume any late rejection, and let the caller stop
 * subsequent pages. This does NOT claim to cancel server-side work already sent.
 */
export function abortableCampusRead<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error('sense-cancelled'));
  if (!signal) {
    try { return read(); } catch (error) { return Promise.reject(error); }
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      if (success) resolve(value as T);
      else reject(value);
    };
    const cancel = () => finish(false, new Error('sense-cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    // Guard a signal that changed between the initial check and listener setup.
    if (signal.aborted) { cancel(); return; }
    try {
      read().then((value) => finish(true, value), (error: unknown) => finish(false, error));
    } catch (error) {
      finish(false, error);
    }
  });
}
