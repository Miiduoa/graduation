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
  subdued = false,
  status = false,
}: {
  children: React.ReactNode;
  title?: boolean;
  alert?: boolean;
  subdued?: boolean;
  status?: boolean;
}) {
  const theme = useTheme();
  const color = alert
    ? theme.colors.danger
    : subdued
      ? theme.colors.muted
      : status
        ? theme.colors.textSecondary
        : theme.colors.text;
  return (
    <Text
      accessibilityRole={alert ? 'alert' : title ? 'header' : undefined}
      style={{
        color,
        fontSize: title ? 21 : status ? 15 : 16,
        lineHeight: title ? 29 : status ? 22 : 25,
        fontWeight: title ? '600' : status ? '500' : '400',
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
  variant = 'secondary',
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
  expanded?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected, expanded }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: primary ? 0 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: primary
          ? disabled
            ? theme.colors.disabledBg
            : theme.colors.accent
          : selected
            ? theme.colors.accentSoft
            : theme.colors.surface,
        opacity: disabled && !primary ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          color: primary
            ? disabled
              ? theme.colors.disabledText
              : theme.colors.onAccent
            : theme.colors.text,
          fontSize: 16,
          lineHeight: 24,
          fontWeight: primary || selected ? '600' : '400',
        }}
      >
        {children}
      </Text>
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
      <FoodText subdued>{label}</FoodText>
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
          backgroundColor: theme.colors.surface,
          color: theme.colors.text,
          fontSize: 16,
        }}
      />
    </View>
  );
}
export function FoodQuantityStepper({
  label,
  value,
  onChange,
  disabled = false,
  min = 1,
  max = 20,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const theme = useTheme();
  const parsed = /^\d+$/.test(value) ? Number(value) : 0;
  const setAmount = (next: number) => onChange(String(Math.max(min, Math.min(max, next))));
  return (
    <View style={{ gap: 8 }}>
      <FoodText subdued>{label}</FoodText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`減少${label.replace(/數量$/, '')}數量`}
          accessibilityState={{ disabled: disabled || parsed <= min }}
          disabled={disabled || parsed <= min}
          onPress={() => setAmount(parsed - 1)}
          style={{
            minWidth: 48,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderRadius: 8,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            opacity: disabled || parsed <= min ? 0.45 : 1,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '600' }}>−</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          editable={!disabled}
          keyboardType="number-pad"
          maxLength={2}
          style={{
            minWidth: 64,
            minHeight: 48,
            textAlign: 'center',
            borderWidth: 1,
            borderRadius: 8,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            fontSize: 18,
            fontWeight: '600',
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`增加${label.replace(/數量$/, '')}數量`}
          accessibilityState={{ disabled: disabled || parsed >= max }}
          disabled={disabled || parsed >= max}
          onPress={() => setAmount(parsed < min ? min : parsed + 1)}
          style={{
            minWidth: 48,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderRadius: 8,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            opacity: disabled || parsed >= max ? 0.45 : 1,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '600' }}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}
export function FoodCard({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: theme.colors.border,
        paddingTop: 18,
        gap: 12,
        backgroundColor: theme.colors.background,
      }}
    >
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
  const [errorKind, setErrorKind] = useState<'retryable' | 'unavailable' | null>(null);
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
      setErrorKind(null);
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
      setErrorKind(null);
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
          setErrorKind(null);
        },
        (failure: unknown) => {
          if (!current()) return;
          // Stale permissions and pickup credentials must disappear on failure.
          dataRef.current = null;
          setData(null);
          setError(readErrorMessage(failure));
          setErrorKind(
            failure instanceof NuniError &&
              (failure.code === 'SESSION_CHANGED' ||
                !([408, 429].includes(failure.status) || failure.status >= 500))
              ? 'unavailable'
              : 'retryable',
          );
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

  return { data, error, errorKind, loading, load, quietLoad };
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
  const [storageRevision, setStorageRevision] = useState(0);
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
        setError('');
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
  }, [accountId, key, setPending, storageRevision]);

  const recoverStorage = () => {
    if (!mounted.current || lock.current || !hydrated) return;
    // Read the durable record again before enabling any new operation. A failed
    // save may have written the original intent before its verification failed.
    setHydrated(false);
    setStorageBlocked(true);
    setError('');
    setStorageRevision((revision) => revision + 1);
  };

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
      if (!mounted.current || accountRef.current !== owner) return;
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
        if (!mounted.current || accountRef.current !== owner) return;
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
    recoverStorage,
    locked: busy || pending !== null || !hydrated || storageBlocked,
  };
}

export function FoodStorageRecovery({
  mutation,
}: {
  mutation: {
    busy: boolean;
    hydrated: boolean;
    storageBlocked: boolean;
    recoverStorage(): void;
  };
}) {
  if (!mutation.storageBlocked) return null;
  return (
    <FoodButton disabled={mutation.busy || !mutation.hydrated} onPress={mutation.recoverStorage}>
      {mutation.hydrated ? '重新確認裝置儲存' : '正在確認裝置儲存…'}
    </FoodButton>
  );
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
      {resource.loading ? <FoodText status>正在讀取最新狀態…</FoodText> : null}
      {resource.error ? <FoodText alert>{resource.error}</FoodText> : null}
      <FoodButton disabled={resource.loading || disabled} onPress={() => void resource.load()}>
        重新讀取
      </FoodButton>
    </>
  );
}
