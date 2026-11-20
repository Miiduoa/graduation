import { HttpsError } from './httpsError';

export const UID_RATE_LIMIT = {
  maxKeys: 4096,
  requestsPerMinute: 10,
  invalidJoinCodesPerHour: 20,
  timetableSharesPerHour: 20,
  minuteMs: 60_000,
  hourMs: 3_600_000,
} as const;

type WindowCount = {
  startedAt: number;
  count: number;
};

type UidLimitState = {
  lastSeen: number;
  perMinute: WindowCount;
  invalidJoinCodes: WindowCount;
  timetableShares: WindowCount;
};

export type UidRateLimiter = {
  check: (uid: string) => void;
  assertJoinCodeAttemptsAllowed: (uid: string) => void;
  recordInvalidJoinCode: (uid: string) => void;
  assertTimetableShareCreatesAllowed: (uid: string) => void;
  recordTimetableShareCreate: (uid: string) => void;
  size: () => number;
  reset: () => void;
};

export function createUidRateLimiter(
  options: {
    maxKeys?: number;
    requestsPerMinute?: number;
    invalidJoinCodesPerHour?: number;
    timetableSharesPerHour?: number;
    now?: () => number;
  } = {},
): UidRateLimiter {
  const maxKeys = options.maxKeys ?? UID_RATE_LIMIT.maxKeys;
  const requestsPerMinute = options.requestsPerMinute ?? UID_RATE_LIMIT.requestsPerMinute;
  const invalidJoinCodesPerHour =
    options.invalidJoinCodesPerHour ?? UID_RATE_LIMIT.invalidJoinCodesPerHour;
  const timetableSharesPerHour =
    options.timetableSharesPerHour ?? UID_RATE_LIMIT.timetableSharesPerHour;
  const nowFn = options.now ?? (() => Date.now());
  const store = new Map<string, UidLimitState>();

  function evictExpired(now: number): void {
    for (const [uid, state] of store) {
      if (now - state.lastSeen >= UID_RATE_LIMIT.hourMs) store.delete(uid);
    }
  }

  function evictOldest(): void {
    while (store.size >= maxKeys) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  function touch(uid: string, state: UidLimitState): void {
    store.delete(uid);
    store.set(uid, state);
  }

  function getOrCreate(uid: string, now: number): UidLimitState {
    evictExpired(now);
    const existing = store.get(uid);
    if (existing) {
      existing.lastSeen = now;
      if (!existing.timetableShares) {
        existing.timetableShares = { startedAt: now, count: 0 };
      }
      touch(uid, existing);
      return existing;
    }
    evictOldest();
    const created: UidLimitState = {
      lastSeen: now,
      perMinute: { startedAt: now, count: 0 },
      invalidJoinCodes: { startedAt: now, count: 0 },
      timetableShares: { startedAt: now, count: 0 },
    };
    store.set(uid, created);
    return created;
  }

  function rotate(window: WindowCount, now: number, durationMs: number): void {
    if (now - window.startedAt >= durationMs) {
      window.startedAt = now;
      window.count = 0;
    }
  }

  return {
    check(uid: string) {
      const now = nowFn();
      const state = getOrCreate(uid, now);
      rotate(state.perMinute, now, UID_RATE_LIMIT.minuteMs);
      if (state.perMinute.count >= requestsPerMinute) {
        throw new HttpsError('resource-exhausted', 'Too many requests');
      }
      state.perMinute.count += 1;
    },
    assertJoinCodeAttemptsAllowed(uid: string) {
      const now = nowFn();
      const state = store.get(uid);
      if (!state) return;
      rotate(state.invalidJoinCodes, now, UID_RATE_LIMIT.hourMs);
      if (state.invalidJoinCodes.count >= invalidJoinCodesPerHour) {
        throw new HttpsError('resource-exhausted', 'Too many requests');
      }
    },
    recordInvalidJoinCode(uid: string) {
      const now = nowFn();
      const state = getOrCreate(uid, now);
      rotate(state.invalidJoinCodes, now, UID_RATE_LIMIT.hourMs);
      state.invalidJoinCodes.count += 1;
    },
    assertTimetableShareCreatesAllowed(uid: string) {
      const now = nowFn();
      const state = store.get(uid);
      if (!state?.timetableShares) return;
      rotate(state.timetableShares, now, UID_RATE_LIMIT.hourMs);
      if (state.timetableShares.count >= timetableSharesPerHour) {
        throw new HttpsError('resource-exhausted', 'Too many requests');
      }
    },
    recordTimetableShareCreate(uid: string) {
      const now = nowFn();
      const state = getOrCreate(uid, now);
      rotate(state.timetableShares, now, UID_RATE_LIMIT.hourMs);
      state.timetableShares.count += 1;
    },
    size() {
      return store.size;
    },
    reset() {
      store.clear();
    },
  };
}

const singleton = createUidRateLimiter();
let active = singleton;

export function checkUidRateLimit(uid: string): void {
  active.check(uid);
}

export function assertJoinCodeAttemptsAllowed(uid: string): void {
  active.assertJoinCodeAttemptsAllowed(uid);
}

export function recordInvalidJoinCode(uid: string): void {
  active.recordInvalidJoinCode(uid);
}

export function assertTimetableShareCreatesAllowed(uid: string): void {
  active.assertTimetableShareCreatesAllowed(uid);
}

export function recordTimetableShareCreate(uid: string): void {
  active.recordTimetableShareCreate(uid);
}

export function setUidRateLimiterForTests(limiter: UidRateLimiter | null): void {
  active = limiter ?? singleton;
}

export function resetUidRateLimitForTests(): void {
  active = singleton;
  singleton.reset();
}
