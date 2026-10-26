/**
 * 學號登入頻率限制。計數寫在 Firestore `_rateLimits/{key}`，多台機器共用。
 * 這個 collection 沒有 client rules，只有 Admin SDK 能讀寫。
 * 計數失敗時 fail closed，不改走記憶體。
 */
export const LOGIN_RATE_LIMIT = {
  ip: { limit: 20, windowMs: 10 * 60 * 1000 },
  account: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const;

export const RATE_LIMITS_COLLECTION = '_rateLimits';

type RateLimitSnapshot = {
  exists: boolean;
  data: () => Record<string, unknown>;
};

type RateLimitDocRef = {
  path?: string;
};

type RateLimitTransaction = {
  get: (ref: RateLimitDocRef) => Promise<RateLimitSnapshot>;
  set: (ref: RateLimitDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => void;
};

export type RateLimitFirestore = {
  doc: (path: string) => RateLimitDocRef;
  runTransaction: <T>(fn: (transaction: RateLimitTransaction) => Promise<T>) => Promise<T>;
};

export class LoginRateLimitError extends Error {
  readonly status = 429;

  constructor() {
    super('Too many requests');
    this.name = 'LoginRateLimitError';
  }
}

export class LoginRateStoreError extends Error {
  readonly status = 503;

  constructor() {
    super('服務暫時無法使用');
    this.name = 'LoginRateStoreError';
  }
}

function rateLimitDocId(scope: string, key: string): string {
  return `${scope}:${key}`.replace(/\//g, '_').slice(0, 700);
}

function expiryMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') {
    const record = value as { toMillis?: unknown; seconds?: unknown };
    if (typeof record.toMillis === 'function') return record.toMillis();
    if (typeof record.seconds === 'number') return record.seconds * 1000;
  }
  return 0;
}

export async function consumeLoginRateLimit(
  db: RateLimitFirestore,
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<void> {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.doc !== 'function') {
    throw new LoginRateStoreError();
  }
  const ref = db.doc(`${RATE_LIMITS_COLLECTION}/${rateLimitDocId(scope, key)}`);
  try {
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const resetAt = expiryMillis(data.ttl ?? data.expiresAt);
      if (!snap.exists || resetAt <= now) {
        const ttl = new Date(now + windowMs);
        tx.set(ref, { count: 1, ttl, scope, key });
        return 'ok' as const;
      }
      const count = typeof data.count === 'number' ? data.count : 0;
      if (count >= limit) {
        return 'limited' as const;
      }
      tx.set(
        ref,
        {
          count: count + 1,
          ttl: data.ttl ?? data.expiresAt ?? new Date(resetAt),
          scope,
          key,
        },
        { merge: true },
      );
      return 'ok' as const;
    });
    if (outcome === 'limited') {
      throw new LoginRateLimitError();
    }
  } catch (error) {
    if (error instanceof LoginRateLimitError || error instanceof LoginRateStoreError) {
      throw error;
    }
    throw new LoginRateStoreError();
  }
}

export async function enforceLoginRateLimit(
  db: RateLimitFirestore,
  ip: string,
  account: string,
  now = Date.now(),
): Promise<void> {
  await consumeLoginRateLimit(
    db,
    'pu-student-login-ip',
    ip || 'unknown',
    LOGIN_RATE_LIMIT.ip.limit,
    LOGIN_RATE_LIMIT.ip.windowMs,
    now,
  );
  await consumeLoginRateLimit(
    db,
    'pu-student-login-account',
    account,
    LOGIN_RATE_LIMIT.account.limit,
    LOGIN_RATE_LIMIT.account.windowMs,
    now,
  );
}
