/**
 * 統一的重試工具函數
 * 用於處理網路請求和其他可能失敗的異步操作
 */

export interface RetryConfig {
  /** 最大重試次數 (預設 3) */
  maxRetries?: number;
  /** 基礎延遲時間 (毫秒, 預設 1000) */
  baseDelayMs?: number;
  /** 最大延遲時間 (毫秒, 預設 30000) */
  maxDelayMs?: number;
  /** 是否使用指數退避 (預設 true) */
  exponentialBackoff?: boolean;
  /** 是否加入隨機抖動 (預設 true) */
  jitter?: boolean;
  /** 判斷是否應該重試的函數 */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** 每次重試前的回調 */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** AbortSignal 用於取消重試 */
  signal?: AbortSignal;
}

const DEFAULT_CONFIG: Required<Omit<RetryConfig, "shouldRetry" | "onRetry" | "signal">> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  exponentialBackoff: true,
  jitter: true,
};

/**
 * 判斷錯誤是否可重試
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const name = error.name?.toLowerCase() || "";

  // 網路錯誤通常可重試
  const networkErrors = [
    "network",
    "timeout",
    "econnrefused",
    "econnreset",
    "enotfound",
    "socket hang up",
    "fetch failed",
  ];
  if (networkErrors.some((e) => message.includes(e) || name.includes(e))) {
    return true;
  }

  // 特定 HTTP 狀態碼可重試
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  const statusMatch = message.match(/status[:\s]*(\d{3})/i);
  if (statusMatch && retryableStatusCodes.includes(parseInt(statusMatch[1]))) {
    return true;
  }

  // Firebase 特定錯誤
  const firebaseRetryableCodes = [
    "unavailable",
    "resource-exhausted",
    "deadline-exceeded",
    "internal",
  ];
  if (firebaseRetryableCodes.some((code) => message.includes(code))) {
    return true;
  }

  return false;
}

/**
 * 計算重試延遲時間
 */
function calculateDelay(
  attempt: number,
  config: Required<Omit<RetryConfig, "shouldRetry" | "onRetry" | "signal">>
): number {
  let delay = config.baseDelayMs;

  if (config.exponentialBackoff) {
    delay = config.baseDelayMs * Math.pow(2, attempt - 1);
  }

  if (config.jitter) {
    // 加入 -25% 到 +25% 的隨機抖動
    const jitterFactor = 0.75 + Math.random() * 0.5;
    delay = delay * jitterFactor;
  }

  return Math.min(delay, config.maxDelayMs);
}

/**
 * 等待指定時間，支援取消
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    });
  });
}

/**
 * 帶重試的異步函數執行器
 * 
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetchData(),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const { maxRetries, shouldRetry, onRetry, signal } = {
    ...mergedConfig,
    shouldRetry: config.shouldRetry ?? isRetryableError,
    onRetry: config.onRetry,
    signal: config.signal,
  };

  let lastError: Error;
  let attempt = 0;

  while (attempt <= maxRetries) {
    // 檢查是否已取消
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      // 檢查是否應該重試
      if (attempt > maxRetries || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // 計算延遲
      const delay = calculateDelay(attempt, mergedConfig);

      // 觸發重試回調
      onRetry?.(lastError, attempt, delay);

      // 等待後重試
      await sleep(delay, signal);
    }
  }

  throw lastError!;
}

/**
 * 帶超時的 Promise 包裝
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * 建立可取消的 Promise
 */
export function createCancellable<T>(
  fn: (signal: AbortSignal) => Promise<T>
): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController();

  return {
    promise: fn(controller.signal),
    cancel: () => controller.abort(),
  };
}

/**
 * 批次執行並發請求，限制並發數
 */
export async function withConcurrencyLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i], i).then((result) => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}
