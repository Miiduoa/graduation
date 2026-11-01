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
const NON_RETRYABLE_CODE = /^(INVALID_|SIGN_IN_|ORIGIN_|SESSION_|FORBIDDEN|AUTH_|RATE_|METHOD_|CONFIGURATION_)/;

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

function combineSignals(left?: AbortSignal, right?: AbortSignal): AbortSignal | undefined {
  if (!left) return right;
  if (!right) return left;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([left, right]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (left.aborted || right.aborted) {
    controller.abort();
    return controller.signal;
  }
  left.addEventListener('abort', abort);
  right.addEventListener('abort', abort);
  return controller.signal;
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
      const signal = combineSignals(options.externalSignal, timeout.signal) ?? timeout.signal;
      return await run(signal);
    } finally {
      timeout.cancel();
    }
  };
  try {
    return await attempt();
  } catch (error) {
    if (options.retry === false || options.externalSignal?.aborted || !isWakeRetryableFailure(error))
      throw error;
    return await attempt();
  }
}
