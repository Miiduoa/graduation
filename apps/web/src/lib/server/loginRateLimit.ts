/**
 * 學號登入頻率限制分兩層：
 * 1. 本機記憶體先同步預扣同一 IP／帳號，並同步預佔每日 Firestore 寫入預算。
 * 2. 通過第一層的嘗試才進 Firestore `_rateLimits/{hmac}`，多台機器共用。
 * 文件 key 是加鹽 HMAC，鹽從 FIREBASE_SERVICE_ACCOUNT_JSON 衍生；密鑰為空則 fail closed。
 * 過期計數在交易裡覆寫。校園逾時可退還帳號次數，退還也算寫入預算。
 */
import { createHmac } from 'node:crypto';

export const LOGIN_RATE_LIMIT = {
  ip: { limit: 20, windowMs: 10 * 60 * 1000 },
  account: { limit: 5, windowMs: 15 * 60 * 1000 },
  dailyWrites: 1500,
  maxKeys: 4096,
} as const;

export const RATE_LIMITS_COLLECTION = '_rateLimits';
export const ACCOUNT_SCOPE = 'school-login-pu-account';
export const IP_SCOPE = 'school-login-pu-ip';

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

type Bucket = { count: number; resetAt: number };

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

export type LoginRateGate = {
  increment: (scope: string, key: string, limit: number, windowMs: number) => void;
  decrement: (scope: string, key: string) => void;
  reserveWrites: (writes?: number) => void;
  releaseWrites: (writes?: number) => void;
  reset: () => void;
  writesUsed: () => number;
};

export type LoginRateContext = {
  db: RateLimitFirestore;
  salt?: string;
  now?: number;
  gate?: LoginRateGate;
  accountScope?: string;
  ipScope?: string;
};

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function deriveRateLimitSalt(
  secret: string | undefined = process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
): string {
  const material = String(secret || '').trim();
  if (!material) {
    throw new LoginRateStoreError();
  }
  return createHmac('sha256', material).update('nuni-web/_rateLimits').digest('hex');
}

export function requireRateLimitSalt(salt?: string): string {
  const explicit = String(salt || '').trim();
  if (explicit) return explicit;
  return deriveRateLimitSalt();
}

export function hashRateLimitDocId(scope: string, value: string, salt: string): string {
  return createHmac('sha256', salt).update(`${scope}\0${value}`).digest('hex');
}

export function createLoginRateGate(
  options: { now?: () => number; dailyWriteLimit?: number; maxKeys?: number } = {},
): LoginRateGate {
  const nowFn = options.now ?? (() => Date.now());
  const dailyWriteLimit = options.dailyWriteLimit ?? LOGIN_RATE_LIMIT.dailyWrites;
  const maxKeys = options.maxKeys ?? LOGIN_RATE_LIMIT.maxKeys;
  const store = new Map<string, Bucket>();
  let day = utcDay(nowFn());
  let writes = 0;

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

  function rollDay(now: number): void {
    const today = utcDay(now);
    if (today !== day) {
      day = today;
      writes = 0;
    }
  }

  return {
    increment(scope, key, limit, windowMs) {
      const now = nowFn();
      evict(now);
      const id = `${scope}:${key}`;
      let current = store.get(id);
      if (!current || current.resetAt <= now) {
        store.delete(id);
        current = { count: 0, resetAt: now + windowMs };
        store.set(id, current);
      }
      if (current.count >= limit) {
        throw new LoginRateLimitError();
      }
      current.count += 1;
    },
    decrement(scope, key) {
      const id = `${scope}:${key}`;
      const current = store.get(id);
      if (current && current.count > 0) current.count -= 1;
    },
    reserveWrites(amount = 1) {
      rollDay(nowFn());
      if (writes + amount > dailyWriteLimit) {
        throw new LoginRateStoreError();
      }
      writes += amount;
    },
    releaseWrites(amount = 1) {
      rollDay(nowFn());
      writes = Math.max(0, writes - amount);
    },
    reset() {
      store.clear();
      writes = 0;
      day = utcDay(nowFn());
    },
    writesUsed() {
      rollDay(nowFn());
      return writes;
    },
  };
}

const singleton = createLoginRateGate();
let activeGate = singleton;

export function getLoginRateGate(): LoginRateGate {
  return activeGate;
}

export function setLoginRateGateForTests(gate: LoginRateGate | null): void {
  activeGate = gate ?? singleton;
}

export function resetLoginRateLimitForTests(): void {
  activeGate = singleton;
  singleton.reset();
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

function resolveGate(ctx?: Pick<LoginRateContext, 'gate'>): LoginRateGate {
  return ctx?.gate ?? activeGate;
}

export async function consumeLoginRateLimit(
  db: RateLimitFirestore,
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
  salt?: string,
): Promise<void> {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.doc !== 'function') {
    throw new LoginRateStoreError();
  }
  const resolvedSalt = requireRateLimitSalt(salt);
  const ref = db.doc(`${RATE_LIMITS_COLLECTION}/${hashRateLimitDocId(scope, key, resolvedSalt)}`);
  try {
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const resetAt = expiryMillis(data.ttl ?? data.expiresAt);
      if (!snap.exists || resetAt <= now) {
        const ttl = new Date(now + windowMs);
        tx.set(ref, { count: 1, ttl, scope });
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

async function refundLoginRateLimit(
  db: RateLimitFirestore,
  scope: string,
  key: string,
  now: number,
  salt: string,
): Promise<boolean> {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.doc !== 'function') {
    throw new LoginRateStoreError();
  }
  const ref = db.doc(`${RATE_LIMITS_COLLECTION}/${hashRateLimitDocId(scope, key, salt)}`);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'skip' as const;
    const data = snap.data();
    const resetAt = expiryMillis(data.ttl ?? data.expiresAt);
    if (resetAt <= now) return 'skip' as const;
    const count = typeof data.count === 'number' ? data.count : 0;
    if (count <= 0) return 'skip' as const;
    tx.set(
      ref,
      {
        count: count - 1,
        ttl: data.ttl ?? data.expiresAt ?? new Date(resetAt),
        scope,
      },
      { merge: true },
    );
    return 'ok' as const;
  });
  return outcome === 'ok';
}

async function writeSharedLimit(
  db: RateLimitFirestore,
  gate: LoginRateGate,
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  salt: string,
): Promise<void> {
  gate.reserveWrites(1);
  try {
    await consumeLoginRateLimit(db, scope, key, limit, windowMs, now, salt);
  } catch (error) {
    gate.releaseWrites(1);
    throw error;
  }
}

function accountScopeOf(ctx: LoginRateContext): string {
  return ctx.accountScope || ACCOUNT_SCOPE;
}

function ipScopeOf(ctx: LoginRateContext): string {
  return ctx.ipScope || IP_SCOPE;
}

export async function consumeLoginIpLimit(ip: string, ctx: LoginRateContext): Promise<void> {
  const gate = resolveGate(ctx);
  const now = ctx.now ?? Date.now();
  const salt = requireRateLimitSalt(ctx.salt);
  const key = ip || 'unknown';
  const scope = ipScopeOf(ctx);
  gate.increment(scope, key, LOGIN_RATE_LIMIT.ip.limit, LOGIN_RATE_LIMIT.ip.windowMs);
  try {
    await writeSharedLimit(
      ctx.db,
      gate,
      scope,
      key,
      LOGIN_RATE_LIMIT.ip.limit,
      LOGIN_RATE_LIMIT.ip.windowMs,
      now,
      salt,
    );
  } catch (error) {
    gate.decrement(scope, key);
    throw error;
  }
}

export async function consumeLoginAccountLimit(account: string, ctx: LoginRateContext): Promise<void> {
  const gate = resolveGate(ctx);
  const now = ctx.now ?? Date.now();
  const salt = requireRateLimitSalt(ctx.salt);
  const scope = accountScopeOf(ctx);
  gate.increment(scope, account, LOGIN_RATE_LIMIT.account.limit, LOGIN_RATE_LIMIT.account.windowMs);
  try {
    await writeSharedLimit(
      ctx.db,
      gate,
      scope,
      account,
      LOGIN_RATE_LIMIT.account.limit,
      LOGIN_RATE_LIMIT.account.windowMs,
      now,
      salt,
    );
  } catch (error) {
    gate.decrement(scope, account);
    throw error;
  }
}

export async function refundLoginAccountLimit(account: string, ctx: LoginRateContext): Promise<void> {
  const gate = resolveGate(ctx);
  const now = ctx.now ?? Date.now();
  const salt = requireRateLimitSalt(ctx.salt);
  const scope = accountScopeOf(ctx);
  try {
    gate.reserveWrites(1);
  } catch {
    return;
  }
  try {
    const wrote = await refundLoginRateLimit(ctx.db, scope, account, now, salt);
    if (!wrote) {
      gate.releaseWrites(1);
      return;
    }
    gate.decrement(scope, account);
  } catch {
    gate.releaseWrites(1);
  }
}

export async function enforceLoginRateLimit(
  db: RateLimitFirestore,
  ip: string,
  account: string,
  now = Date.now(),
  options: { salt?: string; gate?: LoginRateGate } = {},
): Promise<void> {
  const ctx = { db, now, salt: options.salt, gate: options.gate };
  await consumeLoginIpLimit(ip, ctx);
  await consumeLoginAccountLimit(account, ctx);
}
