'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NuniError } from '@campus/shared/src/nuni';
import { Button } from '@/components/ui/Button';
import {
  FoodStorageError,
  clearFoodPending,
  loadFoodPending,
  saveFoodPending,
} from './foodPersistence';

export type FoodDraftCache = Map<string, unknown>;
export type FoodIntent = {
  action: string;
  input: Record<string, unknown>;
  orderId?: string;
  ticketId?: string;
};

export function useFoodClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function useFoodDraft<T>(cache: FoodDraftCache, key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() =>
    cache.has(key)
      ? (cache.get(key) as T)
      : typeof initial === 'function'
        ? (initial as () => T)()
        : initial,
  );
  const current = useRef(value);
  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      const result =
        typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
      current.current = result;
      cache.set(key, result);
      setValue(result);
    },
    [cache, key],
  );
  return [value, update] as const;
}

function readErrorMessage(failure: unknown) {
  return failure instanceof NuniError && [401, 403].includes(failure.status)
    ? '目前無法確認使用權限，請重新確認帳號或再讀取一次。'
    : '目前無法讀取最新資料。請重新讀取，已填寫的內容仍保留。';
}

export function useFoodRead<T>(
  load: () => Promise<T>,
  options?: {
    pollMs?: number;
    /** Return false to stop periodic polling (e.g. terminal order detail). */
    shouldPoll?: (data: T | null) => boolean;
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const dataRef = useRef<T | null>(null);
  const shouldPollRef = useRef(options?.shouldPoll);
  const pollMs = options?.pollMs;
  shouldPollRef.current = options?.shouldPoll;
  const scopeRef = useRef<{
    active: boolean;
    loader: () => Promise<T>;
    revision: number;
    inFlight: Promise<void> | null;
    queued: Promise<void> | null;
  } | null>(null);

  const read = useCallback(function read(quiet: boolean): Promise<void> {
    const scope = scopeRef.current;
    if (!scope?.active) return Promise.resolve();
    if (scope.inFlight) {
      // A post-mutation/manual refresh must run after the older read. Quiet
      // refreshes join it, so polling and returning to the tab cannot overlap.
      if (quiet) return scope.queued ?? scope.inFlight;
      if (scope.queued) return scope.queued;
      ++scope.revision;
      dataRef.current = null;
      setData(null);
      setError('');
      setLoading(true);
      scope.queued = scope.inFlight.then(() => {
        scope.queued = null;
        if (!scope.active || scopeRef.current !== scope) return;
        return read(false);
      });
      return scope.queued;
    }
    const revision = ++scope.revision;
    if (!quiet) {
      dataRef.current = null;
      setData(null);
      setError('');
      setLoading(true);
    }
    const current = () => scope.active && scopeRef.current === scope && revision === scope.revision;
    const pending = Promise.resolve()
      .then(() => scope.loader())
      .then(
        (next) => {
          if (!current()) return;
          dataRef.current = next;
          setData(next);
          setError('');
        },
        (failure: unknown) => {
          if (!current()) return;
          // Stale permissions and pickup credentials must disappear on failure.
          dataRef.current = null;
          setData(null);
          setError(readErrorMessage(failure));
        },
      )
      .finally(() => {
        if (scope.inFlight === pending) scope.inFlight = null;
        if (current()) setLoading(false);
      });
    scope.inFlight = pending;
    return pending;
  }, []);
  const reload = useCallback(() => read(false), [read]);
  const quietReload = useCallback(() => read(true), [read]);

  useLayoutEffect(() => {
    const scope = { active: true, loader: load, revision: 0, inFlight: null, queued: null };
    scopeRef.current = scope;
    void reload();
    return () => {
      scope.active = false;
    };
  }, [reload, load]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;

    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

    const schedule = () => {
      clearTimeout(timer);
      if (!active || !visible()) return;
      timer = setTimeout(() => void tick(), pollMs);
    };

    async function tick() {
      if (!active || inflight || !visible()) return;
      if (shouldPollRef.current && !shouldPollRef.current(dataRef.current)) return;
      inflight = true;
      try {
        await quietReload();
      } finally {
        inflight = false;
        if (active && visible()) schedule();
      }
    }

    const onVisibility = () => {
      clearTimeout(timer);
      if (!active) return;
      if (visible()) void tick();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollMs, quietReload, load]);

  return { data, error, loading, reload, quietReload };
}

export function useFoodMutation({
  cache,
  scope,
  accountId,
  execute,
  onSuccess,
  onRejected,
  reload,
  enabled,
}: {
  cache: FoodDraftCache;
  scope: string;
  accountId: string;
  enabled: boolean;
  execute(intent: FoodIntent): Promise<unknown>;
  onSuccess(result: unknown, intent: FoodIntent): void;
  onRejected?(): void;
  reload(): Promise<unknown>;
}) {
  const pendingKey = `${scope}:pending`;
  const [pending, setPending] = useFoodDraft<FoodIntent | null>(cache, pendingKey, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storageBlocked, setStorageBlocked] = useState(false);
  const active = useRef(false);
  const lock = useRef(false);
  const accountRef = useRef(accountId);
  const callbacks = useRef({ execute, onSuccess, onRejected, reload });
  useLayoutEffect(() => {
    callbacks.current = { execute, onSuccess, onRejected, reload };
  }, [execute, onSuccess, onRejected, reload]);
  useLayoutEffect(() => {
    active.current = true;
    accountRef.current = accountId;
    return () => {
      active.current = false;
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    try {
      const stored = loadFoodPending(accountId, scope);
      if (!active.current || accountRef.current !== accountId) return;
      if (stored) {
        cache.set(pendingKey, stored);
        setPending(stored);
      }
      setStorageBlocked(false);
    } catch (failure) {
      if (!active.current || accountRef.current !== accountId) return;
      setStorageBlocked(true);
      setError(
        failure instanceof FoodStorageError
          ? failure.message
          : '目前無法安全保存這次訂餐操作，請稍後再試。',
      );
    }
  }, [accountId, scope, cache, pendingKey, setPending]);

  async function send(intent: FoodIntent, retry = false) {
    if (!active.current || lock.current || (!retry && (!enabled || pending || storageBlocked)))
      return;
    if (!accountId) {
      setError('目前無法確認帳號，請重新確認後再操作。');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const frozen = structuredClone(intent);
    const owner = accountId;
    try {
      saveFoodPending(owner, scope, frozen);
      if (!active.current || accountRef.current !== owner) return;
      setPending(frozen);
      setStorageBlocked(false);
    } catch (failure) {
      if (!active.current || accountRef.current !== owner) return;
      setStorageBlocked(true);
      setError(
        failure instanceof FoodStorageError
          ? failure.message
          : '目前無法安全保存這次訂餐操作，請稍後再試。',
      );
      lock.current = false;
      setBusy(false);
      return;
    }
    try {
      const result = await callbacks.current.execute(frozen);
      if (!active.current || accountRef.current !== owner) return;
      try {
        clearFoodPending(owner, scope);
      } catch {
        /* Clear is best-effort after a confirmed result. */
      }
      setPending(null);
      callbacks.current.onSuccess(result, frozen);
      setNotice('已完成。');
      await callbacks.current.reload();
    } catch (failure) {
      if (!active.current || accountRef.current !== owner) return;
      if (
        !retry &&
        failure instanceof NuniError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408
      ) {
        try {
          clearFoodPending(owner, scope);
        } catch {
          /* ignore */
        }
        setPending(null);
        callbacks.current.onRejected?.();
        setError(
          failure.status === 409
            ? '訂單或班別已有變更，已重新讀取。請確認最新狀態後再操作。'
            : '這次操作未被接受，請確認最新資料與使用權限。',
        );
        await callbacks.current.reload();
      } else {
        setError('尚未確認這次操作的結果。請重試同一份操作，避免重複收款或下單。');
      }
    } finally {
      lock.current = false;
      if (active.current && accountRef.current === owner) setBusy(false);
    }
  }
  return {
    pending,
    busy,
    error,
    notice,
    storageBlocked,
    send,
    retry: () => pending && void send(pending, true),
  };
}

export function FoodMutationStatus({ task }: { task: ReturnType<typeof useFoodMutation> }) {
  return (
    <>
      {task.error && <p role="alert">{task.error}</p>}
      {task.notice && <p role="status">{task.notice}</p>}
      {task.pending && (
        <div role="status">
          <p>{task.busy ? '正在確認這次操作…' : '尚未確認是否成功，請用下方按鈕重試。'}</p>
          <Button disabled={task.busy} onClick={task.retry}>
            重試同一份操作
          </Button>
        </div>
      )}
    </>
  );
}

export const foodKey = () => `food-${crypto.randomUUID()}`;
export const foodMoney = (value: { amountMinor: number; currency: string }) =>
  `NT$${value.amountMinor.toLocaleString('zh-TW')}`;
export const foodTime = (value: string) =>
  new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export const foodStateLabels: Record<string, string> = {
  'payment-pending': '待付款',
  paid: '已付款，待店家接單',
  accepted: '已接單',
  preparing: '準備中',
  ready: '可以取餐',
  fulfilled: '已取餐',
  canceled: '已取消',
  rejected: '店家未接單',
  'payment-expired': '付款逾時',
  'cancellation-pending-refund': '取消中，待退款',
  'rejection-pending-refund': '未接單，待退款',
};

export { FOOD_POLL_MS, FOOD_TERMINAL_STATES } from './foodPersistence';
