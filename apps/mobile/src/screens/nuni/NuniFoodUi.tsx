import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { NuniError } from '@campus/shared/src/nuni';
import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { useNuniSession } from '../../state/nuniSession';
import { useNuniDraftState } from '../../state/nuniDrafts';
import { useTheme } from '../../state/theme';

export type FoodClient = ReturnType<typeof createNuniFoodClient>;
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
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
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
export function useFoodLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const alive = useRef(false);
  const sequence = useRef(0);
  const { refresh } = useNuniSession();
  const load = useCallback(async () => {
    const run = ++sequence.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await loader();
      if (alive.current && run === sequence.current) setData(result);
    } catch (failure) {
      if (alive.current && run === sequence.current) {
        setError(
          failure instanceof NuniError && [401, 403, 404].includes(failure.status)
            ? '目前無法取得這份資料，請重新確認帳號與權限。'
            : '目前無法讀取，請確認連線後重試。',
        );
        if (
          failure instanceof NuniError &&
          (failure.status === 401 || failure.code === 'SESSION_CHANGED')
        )
          void refresh();
      }
    } finally {
      if (alive.current && run === sequence.current) setLoading(false);
    }
  }, [loader, refresh]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      ++sequence.current;
    };
  }, [load]);
  return { data, error, loading, load };
}

/** Draft cache holds an immutable retry intent, never order data or permissions. */
export function useFoodMutation<I>(
  key: string,
  execute: (intent: I) => Promise<unknown>,
  onReceipt: (receipt: unknown, intent: I) => void,
) {
  const [pending, setPending] = useNuniDraftState<I | null>(key, null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const lock = useRef(false);
  const { refresh } = useNuniSession();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = async (fresh?: I) => {
    if (lock.current || !mounted.current) return;
    const intent = pending ?? fresh;
    if (!intent) return;
    const retry = pending !== null;
    lock.current = true;
    setBusy(true);
    setError('');
    setPending(intent);
    try {
      const receipt = await execute(intent);
      if (!mounted.current) return;
      setPending(null);
      onReceipt(receipt, intent);
    } catch (failure) {
      if (!mounted.current) return;
      const rejected =
        !retry &&
        failure instanceof NuniError &&
        [400, 403, 404, 409, 422, 429].includes(failure.status);
      if (rejected) setPending(null);
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
      if (mounted.current) setBusy(false);
    }
  };
  return { pending, busy, error, send, locked: busy || pending !== null };
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
