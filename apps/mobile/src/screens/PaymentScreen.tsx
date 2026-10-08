import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, RefreshControl, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Paths, File } from 'expo-file-system';
import { AIScreen, AIHero, AISection, AICard, AIRow, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { isFeatureEnabled } from '../services/release';
import { formatDateTime, formatPrice } from '../utils/format';
import { safeNavigate } from '../utils/safeNavigate';
import {
  loadPaymentDashboardData,
  formatPaymentAmount,
  buildPaymentCsv,
  PAYMENT_HISTORY_LIMIT,
  type PaymentDashboard,
  type PaymentTransaction,
} from '../features/payments';

type Props = { navigation?: Parameters<typeof safeNavigate>[0] };
type WalletState = {
  scope: string;
  data: PaymentDashboard | null;
  loading: boolean;
  error: boolean;
};
const STATUS_LABELS = {
  pending: '處理中',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
};

export function PaymentScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const auth = useAuth();
  const { school } = useSchool();
  const userId = auth.user?.uid;
  const schoolId = school.id;
  const paymentsEnabled = isFeatureEnabled('payments');
  const scope = JSON.stringify([userId, schoolId, paymentsEnabled]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const generation = useRef(0);
  const mounted = useRef(false);
  const [state, setState] = useState<WalletState | null>(null);
  const [search, setSearch] = useState('');
  const visible = state?.scope === scope ? state : null;
  const stillCurrent = useCallback(
    () => mounted.current && currentScope.current === scope,
    [scope],
  );

  const load = useCallback(async () => {
    if (!stillCurrent() || !paymentsEnabled || !userId || !schoolId) return;
    const request = ++generation.current;
    setState({ scope, data: null, loading: true, error: false });
    try {
      const data = await loadPaymentDashboardData({ userId, schoolId });
      if (stillCurrent() && request === generation.current)
        setState({ scope, data, loading: false, error: false });
    } catch {
      if (stillCurrent() && request === generation.current)
        setState({ scope, data: null, loading: false, error: true });
    }
  }, [paymentsEnabled, userId, schoolId, scope, stillCurrent]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      setSearch('');
      void load();
      return () => {
        mounted.current = false;
        generation.current += 1;
      };
    }, [load]),
  );

  const exportTransactions = async () => {
    if (!stillCurrent() || !visible?.data?.transactions.length) return;
    const transactions = visible.data.transactions;
    const exportGeneration = generation.current;
    const exportIsCurrent = () => stillCurrent() && generation.current === exportGeneration;
    let file: File | null = null;
    try {
      const available = await isAvailableAsync();
      if (!exportIsCurrent()) return;
      if (!available) {
        Alert.alert('此裝置無法匯出', '請使用支援分享檔案的裝置匯出交易紀錄。');
        return;
      }
      file = new File(Paths.cache, `campus-payments-${Date.now()}.csv`);
      file.write(buildPaymentCsv(transactions));
      if (!exportIsCurrent()) return;
      await shareAsync(file.uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
      });
    } catch {
      if (exportIsCurrent()) Alert.alert('匯出失敗', '交易紀錄未能匯出，請稍後再試。');
    } finally {
      try {
        if (file?.exists) file.delete();
      } catch {
        // Sharing has finished; the OS also clears files left in its cache.
      }
    }
  };

  const showTransaction = (transaction: PaymentTransaction) => {
    if (!stillCurrent()) return;
    Alert.alert(
      transaction.title,
      [
        `金額：${formatPaymentAmount(transaction.amount)}`,
        `狀態：${STATUS_LABELS[transaction.status]}`,
        `時間：${transaction.timestamp ? formatDateTime(transaction.timestamp) : '未提供'}`,
        ...(transaction.location ? [`地點：${transaction.location}`] : []),
        `交易編號：${transaction.id}`,
      ].join('\n'),
    );
  };

  const transactions = visible?.data?.transactions ?? [];
  const filtered = transactions.filter((row) =>
    [row.title, row.location, row.id].some((value) =>
      value?.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  const expenses = transactions
    .filter((row) => row.type === 'expense' && row.status === 'completed')
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);

  return (
    <AIScreen
      refreshControl={
        userId && paymentsEnabled ? (
          <RefreshControl refreshing={Boolean(visible?.loading)} onRefresh={() => void load()} />
        ) : undefined
      }
    >
      <AIHero eyebrow="CAMPUS ONE" title="校園錢包" subtitle="查看餘額、儲值狀態與校園交易紀錄。" />
      {!paymentsEnabled ? (
        <AICard title="校園支付尚未開通">
          <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
            目前請使用校內原有付款與儲值管道。開通後，可在這裡查詢餘額與交易紀錄。
          </Text>
        </AICard>
      ) : !userId ? (
        <AICard title="登入後查看錢包">
          <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
            錢包與交易紀錄只提供本人查詢。
          </Text>
        </AICard>
      ) : !visible || visible.loading ? (
        <ActivityIndicator accessibilityLabel="讀取錢包" color={aiTokens.ai} />
      ) : visible.error ? (
        <AICard title="暫時無法讀取錢包">
          <View accessibilityRole="alert" style={{ gap: 12 }}>
            <Text style={{ color: aiTokens.text }}>請確認登入狀態與網路後重試。</Text>
            <AIButton label="重新讀取" onPress={() => void load()} />
          </View>
        </AICard>
      ) : visible.data ? (
        <>
          <AICard title={`${school.name} · 可用餘額`}>
            <Text
              style={{ color: aiTokens.text, fontSize: 40, fontWeight: '700', marginVertical: 12 }}
            >
              {visible.data.balance === null
                ? '尚無本校錢包資料'
                : formatPrice(visible.data.balance)}
            </Text>
            {visible.data.pending > 0 ? (
              <Text style={{ color: aiTokens.muted }}>
                處理中的款項：{formatPrice(visible.data.pending)}
              </Text>
            ) : null}
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              {visible.data.balance === null
                ? '若已有校內餘額，請向學校確認帳務同步狀態。'
                : '餘額以本校錢包帳務為準，實體學生證餘額請向學校查詢。'}
            </Text>
          </AICard>
          <AISection title="儲值">
            <AIRow title="線上儲值尚未開放" subtitle="需要儲值時，請洽校內原有儲值窗口。" static />
          </AISection>
          <AISection
            title="交易紀錄"
            subtitle={`最近 ${PAYMENT_HISTORY_LIMIT} 筆以內，消費合計 ${formatPrice(expenses)}`}
          >
            <View style={{ padding: 16, gap: 12 }}>
              <TextInput
                accessibilityLabel="搜尋交易紀錄"
                placeholder="搜尋項目、地點或交易編號"
                placeholderTextColor={aiTokens.muted}
                value={search}
                onChangeText={setSearch}
                style={{
                  borderWidth: 1,
                  borderColor: aiTokens.border,
                  borderRadius: 12,
                  padding: 12,
                  color: aiTokens.text,
                  backgroundColor: aiTokens.surface,
                }}
              />
              <AIButton
                label="匯出已載入紀錄"
                variant="ghost"
                disabled={!transactions.length}
                onPress={() => void exportTransactions()}
              />
            </View>
            {filtered.length ? (
              filtered.map((transaction) => (
                <AIRow
                  key={transaction.id}
                  title={transaction.title}
                  subtitle={`${transaction.timestamp ? formatDateTime(transaction.timestamp) : '時間未提供'} · ${STATUS_LABELS[transaction.status]}`}
                  right={
                    <Text
                      style={{
                        color: transaction.amount > 0 ? aiTokens.success : aiTokens.text,
                        fontWeight: '600',
                      }}
                    >
                      {formatPaymentAmount(transaction.amount)}
                    </Text>
                  }
                  onPress={() => showTransaction(transaction)}
                />
              ))
            ) : (
              <Text style={{ padding: 16, color: aiTokens.muted }}>
                {transactions.length ? '找不到符合條件的交易。' : '目前沒有本校交易紀錄。'}
              </Text>
            )}
          </AISection>
          <AISection title="付款與服務">
            <AIRow
              title="我的訂單"
              subtitle="查看訂單內容與付款狀態"
              onPress={() => safeNavigate(navigation, 'StudentOrders')}
            />
            <AIRow
              title="轉帳與付款碼"
              subtitle="目前尚未提供個人轉帳與付款碼，請使用商家提供的結帳方式。"
              static
            />
          </AISection>
        </>
      ) : null}
    </AIScreen>
  );
}
