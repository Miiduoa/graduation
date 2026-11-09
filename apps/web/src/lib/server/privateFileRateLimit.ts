import { HttpsError } from './httpsError';

export const PRIVATE_FILE_RATE_LIMIT = {
  maxKeys: 4096,
  uploadsPerMinute: 6,
  requestsPerMinute: 20,
  minuteMs: 60_000,
  hourMs: 3_600_000,
} as const;

type WindowCount = { startedAt: number; count: number };

type UidState = {
  lastSeen: number;
  uploads: WindowCount;
  requests: WindowCount;
};

export type PrivateFileRateLimiter = {
  checkRequest: (uid: string) => void;
  checkUpload: (uid: string) => void;
  reset: () => void;
};

export function createPrivateFileRateLimiter(
  options: {
    maxKeys?: number;
    uploadsPerMinute?: number;
    requestsPerMinute?: number;
    now?: () => number;
  } = {},
): PrivateFileRateLimiter {
  const maxKeys = options.maxKeys ?? PRIVATE_FILE_RATE_LIMIT.maxKeys;
  const uploadsPerMinute = options.uploadsPerMinute ?? PRIVATE_FILE_RATE_LIMIT.uploadsPerMinute;
  const requestsPerMinute = options.requestsPerMinute ?? PRIVATE_FILE_RATE_LIMIT.requestsPerMinute;
  const nowFn = options.now ?? (() => Date.now());
  const store = new Map<string, UidState>();

  function evict(now: number): void {
    for (const [uid, state] of store) {
      if (now - state.lastSeen >= PRIVATE_FILE_RATE_LIMIT.hourMs) store.delete(uid);
    }
    while (store.size >= maxKeys) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  function rotate(window: WindowCount, now: number): void {
    if (now - window.startedAt >= PRIVATE_FILE_RATE_LIMIT.minuteMs) {
      window.startedAt = now;
      window.count = 0;
    }
  }

  function getOrCreate(uid: string, now: number): UidState {
    evict(now);
    const existing = store.get(uid);
    if (existing) {
      existing.lastSeen = now;
      store.delete(uid);
      store.set(uid, existing);
      return existing;
    }
    const created: UidState = {
      lastSeen: now,
      uploads: { startedAt: now, count: 0 },
      requests: { startedAt: now, count: 0 },
    };
    store.set(uid, created);
    return created;
  }

  return {
    checkRequest(uid) {
      const now = nowFn();
      const state = getOrCreate(uid, now);
      rotate(state.requests, now);
      if (state.requests.count >= requestsPerMinute) {
        throw new HttpsError('resource-exhausted', 'Too many requests');
      }
      state.requests.count += 1;
    },
    checkUpload(uid) {
      const now = nowFn();
      const state = getOrCreate(uid, now);
      rotate(state.uploads, now);
      if (state.uploads.count >= uploadsPerMinute) {
        throw new HttpsError('resource-exhausted', 'Too many uploads');
      }
      state.uploads.count += 1;
    },
    reset() {
      store.clear();
    },
  };
}

const singleton = createPrivateFileRateLimiter();
let active = singleton;

export function checkPrivateFileRequestRate(uid: string): void {
  active.checkRequest(uid);
}

export function checkPrivateFileUploadRate(uid: string): void {
  active.checkUpload(uid);
}

export function setPrivateFileRateLimiterForTests(limiter: PrivateFileRateLimiter | null): void {
  active = limiter ?? singleton;
}

export function resetPrivateFileRateLimitForTests(): void {
  active = singleton;
  singleton.reset();
}
