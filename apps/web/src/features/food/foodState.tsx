'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NuniError } from '@campus/shared/src/nuni';
import { Button } from '@/components/ui/Button';

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

export function useFoodRead<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const run = ++generation.current;
    setLoading(true);
    setData(null);
    setError('');
    try {
      const next = await load();
      if (run === generation.current) setData(next);
    } catch (failure) {
      if (run === generation.current)
        setError(
          failure instanceof NuniError && [401, 403].includes(failure.status)
            ? '目前無法確認使用權限，請重新確認帳號或再讀取一次。'
            : '目前無法讀取最新資料。請重新讀取，已填寫的內容仍保留。',
        );
    } finally {
      if (run === generation.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
    return () => {
      ++generation.current;
    };
  }, [reload]);
  return { data, error, loading, reload };
}

export function useFoodMutation({
  cache,
  scope,
  execute,
  onSuccess,
  onRejected,
  reload,
  enabled,
}: {
  cache: FoodDraftCache;
  scope: string;
  enabled: boolean;
  execute(intent: FoodIntent): Promise<unknown>;
  onSuccess(result: unknown, intent: FoodIntent): void;
  onRejected?(): void;
  reload(): Promise<unknown>;
}) {
  const [pending, setPending] = useFoodDraft<FoodIntent | null>(cache, `${scope}:pending`, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const lock = useRef(false);
  const callbacks = useRef({ execute, onSuccess, onRejected, reload });
  useLayoutEffect(() => {
    callbacks.current = { execute, onSuccess, onRejected, reload };
  }, [execute, onSuccess, onRejected, reload]);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function send(intent: FoodIntent, retry = false) {
    if (!active.current || lock.current || (!retry && (!enabled || pending))) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const frozen = structuredClone(intent);
    setPending(frozen);
    try {
      const result = await callbacks.current.execute(frozen);
      if (!active.current) return;
      setPending(null);
      callbacks.current.onSuccess(result, frozen);
      setNotice('已完成。');
      await callbacks.current.reload();
    } catch (failure) {
      if (!active.current) return;
      if (
        !retry &&
        failure instanceof NuniError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        failure.status !== 408
      ) {
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
      if (active.current) setBusy(false);
    }
  }
  return { pending, busy, error, notice, send, retry: () => pending && void send(pending, true) };
}

export function FoodMutationStatus({ task }: { task: ReturnType<typeof useFoodMutation> }) {
  return (
    <>
      {task.error && <p role="alert">{task.error}</p>}
      {task.notice && <p role="status">{task.notice}</p>}
      {task.pending && (
        <div role="status">
          <p>尚未確認是否成功，請用下方按鈕重試。</p>
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
