/**
 * 學號登入頻率限制。計數存在單一 Node 行程的記憶體，多台機器之間不共用。
 * 正式站若水平擴充，每台各自計算；這是刻意取捨，避免為了登入去寫共用儲存。
 */
export const LOGIN_RATE_LIMIT = {
  ip: { limit: 20, windowMs: 10 * 60 * 1000 },
  account: { limit: 5, windowMs: 15 * 60 * 1000 },
  maxKeys: 4096,
} as const;

type Bucket = { count: number; resetAt: number };

export class LoginRateLimitError extends Error {
  readonly status = 429;

  constructor() {
    super('Too many requests');
    this.name = 'LoginRateLimitError';
  }
}

export type LoginRateLimiter = {
  consume: (scope: string, key: string, limit: number, windowMs: number) => void;
  reset: () => void;
  size: () => number;
};

export function createLoginRateLimiter(
  options: { maxKeys?: number; now?: () => number } = {},
): LoginRateLimiter {
  const maxKeys = options.maxKeys ?? LOGIN_RATE_LIMIT.maxKeys;
  const nowFn = options.now ?? (() => Date.now());
  const store = new Map<string, Bucket>();

  function evict(now: number): void {
    for (const [id, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(id);
    }
    while (store.size >= maxKeys) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  return {
    consume(scope, key, limit, windowMs) {
      const now = nowFn();
      evict(now);
      const id = `${scope}:${key}`;
      const current = store.get(id);
      if (!current || current.resetAt <= now) {
        store.delete(id);
        store.set(id, { count: 1, resetAt: now + windowMs });
        return;
      }
      if (current.count >= limit) {
        throw new LoginRateLimitError();
      }
      current.count += 1;
      store.delete(id);
      store.set(id, current);
    },
    reset() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

const singleton = createLoginRateLimiter();
let active = singleton;

export function enforceLoginRateLimit(ip: string, account: string): void {
  active.consume('pu-student-login-ip', ip || 'unknown', LOGIN_RATE_LIMIT.ip.limit, LOGIN_RATE_LIMIT.ip.windowMs);
  active.consume(
    'pu-student-login-account',
    account,
    LOGIN_RATE_LIMIT.account.limit,
    LOGIN_RATE_LIMIT.account.windowMs,
  );
}

export function setLoginRateLimiterForTests(limiter: LoginRateLimiter | null): void {
  active = limiter ?? singleton;
}

export function resetLoginRateLimitForTests(): void {
  active = singleton;
  singleton.reset();
}
