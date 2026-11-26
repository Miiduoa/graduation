import { NuniError } from '@campus/shared/src/nuni';
import type { LmsReadOptions } from './tronClassLmsSource';

export const TRONCLASS_PREPARATION_TIMEOUT_MS = 50_000;

/** One request-local budget shared by preparation, its readers and authorization. */
export type TronClassPreparationRead = {
  readonly signal: AbortSignal;
  check(): void;
  wait<T>(request: () => Promise<T>): Promise<T>;
  read<T>(request: (options: LmsReadOptions) => Promise<T>): Promise<T>;
};

export async function withTronClassPreparationRead<T>(
  signal: AbortSignal | undefined,
  operation: (context: TronClassPreparationRead) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const deadline = Date.now() + TRONCLASS_PREPARATION_TIMEOUT_MS;
  const timeout = () => new NuniError(504, 'TRONCLASS_READ_TIMEOUT');
  const abort = () => controller.abort();
  let rejectCancellation!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancellation = () => reject(timeout());
    controller.signal.addEventListener('abort', rejectCancellation, { once: true });
  });
  const timer = setTimeout(abort, TRONCLASS_PREPARATION_TIMEOUT_MS);
  timer.unref?.();
  const check = () => {
    if (controller.signal.aborted || Date.now() >= deadline) {
      abort();
      throw timeout();
    }
  };
  const wait = async <R>(request: () => Promise<R>): Promise<R> => {
    check();
    try {
      const result = await request();
      check();
      return result;
    } catch (error) {
      check();
      throw error;
    }
  };
  const context: TronClassPreparationRead = Object.freeze({
    signal: controller.signal, check, wait,
    read: <R>(request: (options: LmsReadOptions) => Promise<R>) => wait(() => request({
      signal: controller.signal,
      timeoutMs: Math.max(1, Math.min(8_000, Math.ceil(deadline - Date.now()))),
    })),
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    // Racing also bounds injected providers that do not honor AbortSignal.
    // Their late continuations still encounter check() before the next read.
    return await Promise.race([wait(() => operation(context)), cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectCancellation);
    abort();
  }
}

export function readTronClassPreparationSource<T>(
  context: TronClassPreparationRead | undefined,
  request: (options?: LmsReadOptions) => Promise<T>,
): Promise<T> {
  return context ? context.read(request) : request();
}
