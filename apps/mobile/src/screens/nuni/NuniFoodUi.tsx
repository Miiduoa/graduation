import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { NuniError } from '@campus/shared/src/nuni';
import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { useNuniSession } from '../../state/nuniSession';
import { useNuniDraftState } from '../../state/nuniDrafts';
import {
  FoodStorageError,
  clearFoodPending,
  loadFoodPending,
  saveFoodPending,
} from '../../state/foodPersistence';
import { useTheme } from '../../state/theme';

export type FoodClient = ReturnType<typeof createNuniFoodClient>;
export { FOOD_POLL_MS, FOOD_TERMINAL_STATES } from '../../state/foodPersistence';
export const money = (value: { amountMinor: number; currency: string }) =>
  `${value.amountMinor.toLocaleString('zh-TW')} 元`;
export const foodTime = (value: string) =>
  new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export const orderState: Record<string, string> = {
  'payment-pending': '等待現場付款',
  paid: '已收款，等待接單',
  accepted: '店家已接單',
  preparing: '正在備餐',
  ready: '可以取餐',
  fulfilled: '已取餐',
  canceled: '已取消',
  rejected: '店家未接單',
  'payment-expired': '付款期限已過',
  'cancellation-pending-refund': '已申請取消，等待退款',
  'rejection-pending-refund': '未接單，等待退款',
};
export function FoodText({
  children,
  title = false,
  alert = false,
}: {
  children: React.ReactNode;
  title?: boolean;
  alert?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole={alert ? 'alert' : title ? 'header' : undefined}
      style={{
        color: alert ? theme.colors.danger : theme.colors.text,
        fontSize: title ? 21 : 16,
        lineHeight: title ? 29 : 25,
        fontWeight: title ? '600' : '400',
      }}
    >
      {children}
    </Text>
  );
}
export function FoodButton({
  children,
  onPress,
  disabled = false,
  selected = false,
  accessibilityLabel,
  expanded,
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
  expanded?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected, expanded }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <FoodText>{children}</FoodText>
    </Pressable>
  );
}
export function FoodField({
  label,
  value,
  onChange,
  disabled = false,
  numeric = false,
  max = 300,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  numeric?: boolean;
  max?: number;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 5 }}>
      <FoodText>{label}</FoodText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={max}
        style={{
          minHeight: 48,
          padding: 12,
          borderWidth: 1,
          borderRadius: 8,
          borderColor: theme.colors.border,
          color: theme.colors.text,
          fontSize: 16,
        }}
      />
    </View>
  );
}
export function FoodCard({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ borderTopWidth: 1, borderColor: theme.colors.border, paddingTop: 18, gap: 12 }}>
      {children}
    </View>
  );
}
export function useFoodClient(context: string) {
  const { request } = useNuniSession();
  return useMemo(
    () =>
      createNuniFoodClient((path, input, query) => request(path, context, input, undefined, query)),
    [request, context],
  );
}

function readErrorMessage(failure: unknown) {
  return failure instanceof NuniError && [401, 403, 404].includes(failure.status)
    ? '目前無法取得這份資料，請重新確認帳號與權限。'
    : '目前無法讀取，請確認連線後重試。';
}

export function useFoodLoad<T>(
  loader: () => Promise<T>,
  options?: {
    pollMs?: number;
    shouldPoll?: (data: T | null) => boolean;
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { refresh } = useNuniSession();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
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
          if (
            failure instanceof NuniError &&
            (failure.status === 401 || failure.code === 'SESSION_CHANGED')
          )
            void refreshRef.current();
        },
      )
      .finally(() => {
        if (scope.inFlight === pending) scope.inFlight = null;
        if (current()) setLoading(false);
      });
    scope.inFlight = pending;
    return pending;
  }, []);
  const load = useCallback(() => read(false), [read]);
  const quietLoad = useCallback(() => read(true), [read]);

  useLayoutEffect(() => {
    const scope = { active: true, loader, revision: 0, inFlight: null, queued: null };
    scopeRef.current = scope;
    void load();
    return () => {
      scope.active = false;
    };
  }, [load, loader]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;

    let appState = AppState.currentState;
    const foreground = () => appState === 'active';

    const schedule = () => {
      clearTimeout(timer);
      if (!active || !foreground()) return;
      timer = setTimeout(() => void tick(), pollMs);
    };

    async function tick() {
      if (!active || inflight || !foreground()) return;
      if (shouldPollRef.current && !shouldPollRef.current(dataRef.current)) return;
      inflight = true;
      try {
        await quietLoad();
      } finally {
        inflight = false;
        if (active && foreground()) schedule();
      }
    }

    const subscription = AppState.addEventListener('change', (next) => {
      appState = next;
      clearTimeout(timer);
      if (!active) return;
      if (next === 'active') void tick();
    });

    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [pollMs, quietLoad, loader]);

  return { data, error, loading, load, quietLoad };
}

/** Draft cache holds an immutable retry intent, never order data or permissions. */
export function useFoodMutation<I>(
  key: string,
  execute: (intent: I) => Promise<unknown>,
  onReceipt: (receipt: unknown, intent: I) => void,
) {
  const auth = useNuniSession();
  const accountId = auth.session?.platformAccountId ?? '';
  const [pending, setPending] = useNuniDraftState<I | null>(key, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const mounted = useRef(false);
  const lock = useRef(false);
  const accountRef = useRef(accountId);
  const { refresh } = useNuniSession();
  useEffect(() => {
    mounted.current = true;
    accountRef.current = accountId;
    return () => {
      mounted.current = false;
    };
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    if (!accountId) {
      setHydrated(true);
      setStorageBlocked(true);
      setError('目前無法確認帳號，請重新確認後再操作。');
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const stored = (await loadFoodPending(accountId, key)) as I | null;
        if (cancelled || !mounted.current || accountRef.current !== accountId) return;
        if (stored) setPending(stored);
        setStorageBlocked(false);
      } catch (failure) {
        if (cancelled || !mounted.current || accountRef.current !== accountId) return;
        setStorageBlocked(true);
        setError(
          failure instanceof FoodStorageError
            ? failure.message
            : '目前無法安全保存這次訂餐操作，請稍後再試。',
        );
      } finally {
        if (!cancelled && mounted.current && accountRef.current === accountId) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, key, setPending]);

  const send = async (fresh?: I) => {
    if (lock.current || !mounted.current) return;
    if (!hydrated || storageBlocked) {
      setError(
        !hydrated
          ? '正在恢復尚未確認的訂餐操作，請稍候。'
          : '目前無法安全保存這次訂餐操作，請稍後再試。',
      );
      return;
    }
    if (!accountId) {
      setError('目前無法確認帳號，請重新確認後再操作。');
      return;
    }
    const intent = pending ?? fresh;
    if (!intent) return;
    const retry = pending !== null;
    lock.current = true;
    setBusy(true);
    setError('');
    const owner = accountId;
    try {
      await saveFoodPending(owner, key, intent);
      if (!mounted.current || accountRef.current !== owner) return;
      setPending(intent);
      setStorageBlocked(false);
    } catch (failure) {
      if (!mounted.current || accountRef.current !== owner) return;
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
      const receipt = await execute(intent);
      if (!mounted.current || accountRef.current !== owner) return;
      try {
        await clearFoodPending(owner, key);
      } catch {
        /* best-effort after confirmed result */
      }
      setPending(null);
      onReceipt(receipt, intent);
    } catch (failure) {
      if (!mounted.current || accountRef.current !== owner) return;
      const rejected =
        !retry &&
        failure instanceof NuniError &&
        [400, 403, 404, 409, 422, 429].includes(failure.status);
      if (rejected) {
        try {
          await clearFoodPending(owner, key);
        } catch {
          /* ignore */
        }
        setPending(null);
      }
      setError(
        rejected
          ? '這次操作未被接受。請重新讀取最新狀態後再確認。'
          : '尚未確認是否成功，請用下方按鈕重試。',
      );
      if (
        failure instanceof NuniError &&
        (failure.status === 401 || failure.code === 'SESSION_CHANGED')
      )
        void refresh();
    } finally {
      lock.current = false;
      if (mounted.current && accountRef.current === owner) setBusy(false);
    }
  };
  return {
    pending,
    busy,
    error,
    send,
    hydrated,
    storageBlocked,
    locked: busy || pending !== null || !hydrated || storageBlocked,
  };
}
export function FoodReadState({
  resource,
  disabled = false,
}: {
  resource: { error: string; loading: boolean; load(): Promise<void> };
  disabled?: boolean;
}) {
  return (
    <>
      {resource.loading ? <FoodText>正在讀取最新狀態…</FoodText> : null}
      {resource.error ? <FoodText alert>{resource.error}</FoodText> : null}
      <FoodButton disabled={resource.loading || disabled} onPress={() => void resource.load()}>
        重新讀取
      </FoodButton>
    </>
  );
}
