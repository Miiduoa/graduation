import { isNetworkLayerError, isTimeoutFailure } from './loadFailureCopy';

export const WAKE_REQUEST_TIMEOUT_MS = 10_000;

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function codeOf(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function nameOf(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 413, 422, 429]);
const RETRYABLE_STATUSES = new Set([0, 500, 502, 503, 504]);
const NON_RETRYABLE_CODE =
  /^(INVALID_|SIGN_IN_|ORIGIN_|SESSION_|FORBIDDEN|AUTH_|RATE_|METHOD_|CONFIGURATION_)/;

export function isWakeRetryableFailure(error: unknown, callerAborted = false): boolean {
  if (callerAborted || error == null) return false;
  const code = codeOf(error);
  if (code === 'REQUEST_CANCELLED' || NON_RETRYABLE_CODE.test(code)) return false;
  const status = statusOf(error);
  if (status != null && NON_RETRYABLE_STATUSES.has(status)) return false;
  if (status != null && RETRYABLE_STATUSES.has(status)) return true;
  if (isTimeoutFailure(error) || isNetworkLayerError(error)) return true;
  const name = nameOf(error);
  return name === 'AbortError' || name === 'TimeoutError';
}

function combineSignals(
  left: AbortSignal | undefined,
  right: AbortSignal,
): { signal: AbortSignal; dispose(): void } {
  if (!left) return { signal: right, dispose() {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([left, right]), dispose() {} };
  }

  // Older React Native / browser runtimes need explicit listener disposal.
  const controller = new AbortController();
  if (left.aborted || right.aborted) {
    controller.abort((left.aborted ? left : right).reason);
    return { signal: controller.signal, dispose() {} };
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    left.removeEventListener('abort', abortLeft);
    right.removeEventListener('abort', abortRight);
  };
  const abortLeft = () => {
    dispose();
    controller.abort(left.reason);
  };
  const abortRight = () => {
    dispose();
    controller.abort(right.reason);
  };

  left.addEventListener('abort', abortLeft, { once: true });
  right.addEventListener('abort', abortRight, { once: true });
  // Handle signals that become aborted during listener registration.
  if (left.aborted) abortLeft();
  else if (right.aborted) abortRight();
  return { signal: controller.signal, dispose };
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; cancel(): void } {
  if (typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), cancel() {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer);
    },
  };
}

export async function withWakeRetry<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; externalSignal?: AbortSignal; retry?: boolean } = {},
): Promise<T> {
  const timeoutMs = Math.max(options.timeoutMs ?? WAKE_REQUEST_TIMEOUT_MS, WAKE_REQUEST_TIMEOUT_MS);
  const attempt = async () => {
    if (options.externalSignal?.aborted) {
      const reason = options.externalSignal.reason;
      throw reason instanceof Error ? reason : new Error('aborted');
    }
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const combined = combineSignals(options.externalSignal, timeout.signal);
      try {
        return await run(combined.signal);
      } finally {
        combined.dispose();
      }
    } finally {
      timeout.cancel();
    }
  };
  try {
    return await attempt();
  } catch (error) {
    if (
      options.retry === false ||
      options.externalSignal?.aborted ||
      !isWakeRetryableFailure(error)
    )
      throw error;
    return await attempt();
  }
}
