/* eslint-disable */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Paths, File } from 'expo-file-system';
import {
  Screen,
  Button,
  AnimatedCard,
  SegmentedControl,
  SearchBar,
  Spinner,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { formatPrice, formatDateTime } from '../utils/format';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useDataSource } from '../hooks/useDataSource';
import { useAsyncStorage } from '../hooks/useStorage';
import {
  loadPaymentDashboardData,
  loadTransferTargets as loadPaymentTransferTargets,
  type PaymentTransaction as Transaction,
  type TransferTarget,
} from '../features/payments';
import { analytics } from '../services/analytics';
import { isFeatureEnabled } from '../services/release';
import { getScopedStorageKey } from '../services/scopedStorage';

type PaymentMethod = 'student_card' | 'mobile_pay' | 'credit_card';

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: '1',
    title: '學生餐廳午餐',
    amount: -75,
    type: 'expense',
    category: 'meal',
    timestamp: new Date(Date.now() - 2 * 3600000),
    location: '一餐',
  },
  {
    id: '2',
    title: '儲值',
    amount: 500,
    type: 'topup',
    category: 'other',
    timestamp: new Date(Date.now() - 5 * 3600000),
  },
  {
    id: '3',
    title: '影印費',
    amount: -15,
    type: 'expense',
    category: 'print',
    timestamp: new Date(Date.now() - 1 * 86400000),
    location: '圖書館',
  },
  {
    id: '4',
    title: '飲料機',
    amount: -25,
    type: 'expense',
    category: 'vending',
    timestamp: new Date(Date.now() - 1 * 86400000),
    location: '工程館',
  },
  {
    id: '5',
    title: '洗衣費',
    amount: -30,
    type: 'expense',
    category: 'laundry',
    timestamp: new Date(Date.now() - 2 * 86400000),
    location: '宿舍',
  },
  {
    id: '6',
    title: '早餐',
    amount: -45,
    type: 'expense',
    category: 'meal',
    timestamp: new Date(Date.now() - 2 * 86400000),
    location: '二餐',
  },
  {
    id: '7',
    title: '退款 - 活動報名',
    amount: 100,
    type: 'refund',
    category: 'other',
    timestamp: new Date(Date.now() - 3 * 86400000),
  },
  {
    id: '8',
    title: '停車費',
    amount: -50,
    type: 'expense',
    category: 'parking',
    timestamp: new Date(Date.now() - 4 * 86400000),
    location: '停車場',
  },
];

type QuickAction = {
  id: string;
  title: string;
  icon: string;
  color: string;
};

type PaymentSettings = {
  passcode: string;
  biometricsEnabled: boolean;
  dailyLimit: number;
  invoiceCarrier: string;
};

type SettingsModalType = 'passcode' | 'dailyLimit' | 'invoiceCarrier' | null;

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'topup', title: '儲值', icon: 'add-circle', color: theme.colors.success },
  { id: 'transfer', title: '轉帳', icon: 'swap-horizontal', color: theme.colors.accent },
  { id: 'pay', title: '付款', icon: 'qr-code', color: '#8B5CF6' },
  { id: 'history', title: '紀錄', icon: 'receipt', color: '#F59E0B' },
];

const DEFAULT_TRANSFER_TARGETS: TransferTarget[] = [
  { id: 'u-class-001', name: '資工系學會', account: 'nchucs-club' },
  { id: 'u-dorm-001', name: '宿舍自治會', account: 'nchudorm' },
  { id: 'u-print-001', name: '校園影印中心', account: 'nchu-print' },
];

const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  passcode: '',
  biometricsEnabled: false,
  dailyLimit: 1000,
  invoiceCarrier: '',
};

function getCategoryIcon(category: Transaction['category']): string {
  switch (category) {
    case 'meal':
      return 'restaurant';
    case 'print':
      return 'print';
    case 'laundry':
      return 'water';
    case 'vending':
      return 'cafe';
    case 'parking':
      return 'car';
    default:
      return 'wallet';
  }
}

function getCategoryColor(category: Transaction['category']): string {
  switch (category) {
    case 'meal':
      return '#F97316';
    case 'print':
      return '#6366F1';
    case 'laundry':
      return '#06B6D4';
    case 'vending':
      return '#8B5CF6';
    case 'parking':
      return '#64748B';
    default:
      return theme.colors.muted;
  }
}

function formatAmount(amount: number): string {
  const prefix = amount >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(amount)}`;
}

function escapeCsvValue(value: unknown): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\n');
}

export function PaymentScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const paymentsEnabled = isFeatureEnabled('payments');

  const [selectedTab, setSelectedTab] = useState(0);
  const [balance, setBalance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('student_card');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showCustomTransferModal, setShowCustomTransferModal] = useState(false);
  const [showTransferTargetModal, setShowTransferTargetModal] = useState(false);
  const [transferTargetQuery, setTransferTargetQuery] = useState('');
  const [customTransferAmount, setCustomTransferAmount] = useState('');
  const [selectedTransferTarget, setSelectedTransferTarget] = useState<TransferTarget | null>(null);
  const [transferTargets, setTransferTargets] =
    useState<TransferTarget[]>(DEFAULT_TRANSFER_TARGETS);
  const [loadingTransferTargets, setLoadingTransferTargets] = useState(false);
  const recentTransferTargetsKey = useMemo(
    () =>
      getScopedStorageKey('payment-recent-transfer-targets', {
        uid: auth.user?.uid,
        schoolId: school.id,
      }),
    [auth.user?.uid, school.id],
  );
  const paymentSettingsKey = useMemo(
    () =>
      getScopedStorageKey('payment-settings', {
        uid: auth.user?.uid,
        schoolId: school.id,
      }),
    [auth.user?.uid, school.id],
  );
  const [recentTransferTargetIds, setRecentTransferTargetIds] = useAsyncStorage<string[]>(
    recentTransferTargetsKey,
    {
      defaultValue: [],
    },
  );
  const [storedPaymentSettings, setStoredPaymentSettings] = useAsyncStorage<PaymentSettings>(
    paymentSettingsKey,
    {
      defaultValue: DEFAULT_PAYMENT_SETTINGS,
    },
  );
  const [settingsModal, setSettingsModal] = useState<SettingsModalType>(null);
  const [settingsInput, setSettingsInput] = useState('');
  const [settingsConfirmInput, setSettingsConfirmInput] = useState('');

  const TABS = ['首頁', '交易紀錄', '設定'];
  const paymentSettings = storedPaymentSettings ?? DEFAULT_PAYMENT_SETTINGS;

  const loadPaymentData = useCallback(async () => {
    try {
      const dashboard = await loadPaymentDashboardData({
        userId: auth.user?.uid ?? null,
        schoolId: school.id,
        dataSource: ds,
        fallbackTransactions: MOCK_TRANSACTIONS,
        fallbackBalance: 1234,
      });
      setTransactions(dashboard.transactions);
      setBalance(dashboard.balance);
    } catch (error) {
      console.warn('Failed to load payment data:', error);
      setTransactions(MOCK_TRANSACTIONS);
      setBalance(1234);
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid, ds, school.id]);

  useEffect(() => {
    loadPaymentData();
  }, [loadPaymentData]);

  const loadTransferTargets = useCallback(async () => {
    setLoadingTransferTargets(true);
    try {
      const targets = await loadPaymentTransferTargets({
        currentUserId: auth.user?.uid ?? null,
        schoolId: school.id,
        fallbackTargets: DEFAULT_TRANSFER_TARGETS,
      });
      setTransferTargets(targets);
    } catch (error) {
      console.warn('Failed to load transfer targets:', error);
      setTransferTargets(DEFAULT_TRANSFER_TARGETS);
    } finally {
      setLoadingTransferTargets(false);
    }
  }, [auth.user?.uid, school.id]);

  useEffect(() => {
    loadTransferTargets();
  }, [loadTransferTargets]);

  const filteredTransactions = useMemo(() => {
    if (!searchQuery) return transactions;
    return transactions.filter(
      (t) =>
        t.title.includes(searchQuery) ||
        t.location?.includes(searchQuery) ||
        t.category.includes(searchQuery),
    );
  }, [searchQuery, transactions]);

  const todayExpense = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return transactions
      .filter((t) => t.type === 'expense' && t.timestamp >= today)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  const monthExpense = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return transactions
      .filter((t) => t.type === 'expense' && t.timestamp >= monthStart)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  const filteredTransferTargets = useMemo(() => {
    const kw = transferTargetQuery.trim().toLowerCase();
    if (!kw) return transferTargets;
    return transferTargets.filter((t) => {
      return t.name.toLowerCase().includes(kw) || t.account.toLowerCase().includes(kw);
    });
  }, [transferTargetQuery, transferTargets]);

  const recentTransferTargets = useMemo(() => {
    const idSet = new Set(recentTransferTargetIds);
    return transferTargets.filter((t) => idSet.has(t.id));
  }, [recentTransferTargetIds, transferTargets]);

  const nonRecentFilteredTransferTargets = useMemo(() => {
    const idSet = new Set(recentTransferTargetIds);
    return filteredTransferTargets.filter((t) => !idSet.has(t.id));
  }, [filteredTransferTargets, recentTransferTargetIds]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPaymentData();
    setRefreshing(false);
  }, [loadPaymentData]);

  const handleQuickAction = (action: QuickAction) => {
    switch (action.id) {
      case 'topup':
        Alert.alert('儲值', '請選擇儲值金額', [
          { text: '取消', style: 'cancel' },
          { text: '$100', onPress: () => handleTopup(100) },
          { text: '$300', onPress: () => handleTopup(300) },
          { text: '$500', onPress: () => handleTopup(500) },
        ]);
        break;
      case 'transfer':
        openTransferTargetPicker();
        break;
      case 'pay':
        nav?.navigate?.('QRCode', { mode: 'generate', type: 'payment' });
        break;
      case 'history':
        setSelectedTab(1);
        break;
    }
  };

  const openTransferTargetPicker = () => {
    if (!auth.user) {
      Alert.alert('請先登入', '您需要登入才能轉帳。');
      return;
    }
    if (loadingTransferTargets) {
      Alert.alert('資料載入中', '正在載入可轉帳對象，請稍後再試。');
      return;
    }
    if (transferTargets.length === 0) {
      Alert.alert('目前無可轉帳對象', '請稍後再試，或聯絡管理員。');
      return;
    }
    setTransferTargetQuery('');
    setShowTransferTargetModal(true);
  };

  const openTransferAmountPicker = (target: TransferTarget) => {
    Alert.alert('選擇轉帳金額', `收款方：${target.name}`, [
      { text: '$100', onPress: () => handleTransfer(target, 100) },
      { text: '$300', onPress: () => handleTransfer(target, 300) },
      { text: '$500', onPress: () => handleTransfer(target, 500) },
      { text: '$1000', onPress: () => handleTransfer(target, 1000) },
      {
        text: '自訂金額',
        onPress: () => {
          setSelectedTransferTarget(target);
          setCustomTransferAmount('');
          setShowCustomTransferModal(true);
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const openSettingsModal = useCallback(
    (type: Exclude<SettingsModalType, null>) => {
      setSettingsModal(type);
      if (type === 'dailyLimit') {
        setSettingsInput(String(paymentSettings.dailyLimit));
        setSettingsConfirmInput('');
        return;
      }

      if (type === 'invoiceCarrier') {
        setSettingsInput(paymentSettings.invoiceCarrier);
        setSettingsConfirmInput('');
        return;
      }

      setSettingsInput('');
      setSettingsConfirmInput('');
    },
    [paymentSettings.dailyLimit, paymentSettings.invoiceCarrier],
  );

  const closeSettingsModal = useCallback(() => {
    setSettingsModal(null);
    setSettingsInput('');
    setSettingsConfirmInput('');
  }, []);

  const toggleBiometrics = useCallback(async () => {
    if (!paymentSettings.passcode) {
      Alert.alert('請先設定支付密碼', '啟用生物辨識前，請先設定 4 至 6 位數支付密碼。');
      return;
    }

    const nextEnabled = !paymentSettings.biometricsEnabled;
    await setStoredPaymentSettings((prev) => ({
      ...prev,
      biometricsEnabled: nextEnabled,
    }));
    Alert.alert(
      nextEnabled ? '已開啟' : '已關閉',
      nextEnabled ? '之後可使用生物辨識快速確認付款。' : '已改為僅使用支付密碼。',
    );
  }, [paymentSettings.biometricsEnabled, paymentSettings.passcode, setStoredPaymentSettings]);

  const saveSettings = useCallback(async () => {
    if (!settingsModal) {
      return;
    }

    if (settingsModal === 'passcode') {
      const nextPasscode = settingsInput.trim();
      if (!/^\d{4,6}$/.test(nextPasscode)) {
        Alert.alert('格式錯誤', '支付密碼需為 4 至 6 位數字。');
        return;
      }
      if (nextPasscode !== settingsConfirmInput.trim()) {
        Alert.alert('兩次輸入不一致', '請重新確認支付密碼。');
        return;
      }

      await setStoredPaymentSettings((prev) => ({
        ...prev,
        passcode: nextPasscode,
      }));
      closeSettingsModal();
      Alert.alert('已儲存', '支付密碼已更新。');
      return;
    }

    if (settingsModal === 'dailyLimit') {
      const nextLimit = Number(settingsInput);
      if (!Number.isInteger(nextLimit) || nextLimit <= 0) {
        Alert.alert('限額錯誤', '每日限額需為大於 0 的整數。');
        return;
      }

      await setStoredPaymentSettings((prev) => ({
        ...prev,
        dailyLimit: nextLimit,
      }));
      closeSettingsModal();
      Alert.alert('已儲存', `每日限額已更新為 ${formatPrice(nextLimit)}。`);
      return;
    }

    const nextCarrier = settingsInput.trim().toUpperCase();
    if (nextCarrier && !/^\/[0-9A-Z.+-]{7}$/.test(nextCarrier)) {
      Alert.alert('載具格式錯誤', '請輸入 8 碼手機條碼，例如 /ABCD123。');
      return;
    }

    await setStoredPaymentSettings((prev) => ({
      ...prev,
      invoiceCarrier: nextCarrier,
    }));
    closeSettingsModal();
    Alert.alert('已儲存', nextCarrier ? '發票載具已更新。' : '已清除發票載具設定。');
  }, [
    closeSettingsModal,
    setStoredPaymentSettings,
    settingsConfirmInput,
    settingsInput,
    settingsModal,
  ]);

  const submitCustomTransfer = async () => {
    if (!selectedTransferTarget) {
      setShowCustomTransferModal(false);
      return;
    }
    const amount = Number(customTransferAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      Alert.alert('金額錯誤', '請輸入大於 0 的整數金額。');
      return;
    }
    if (amount > 10000) {
      Alert.alert('超過限額', '單次轉帳上限為 $10,000。');
      return;
    }
    setShowCustomTransferModal(false);
    await handleTransfer(selectedTransferTarget, amount);
  };

  const handleTransfer = async (target: TransferTarget, amount: number) => {
    if (!auth.user) {
      Alert.alert('請先登入', '您需要登入才能轉帳。');
      return;
    }
    if (amount <= 0) {
      Alert.alert('金額錯誤', '轉帳金額需大於 0。');
      return;
    }
    if (amount > balance) {
      Alert.alert('餘額不足', `目前餘額為 $${balance}，無法轉帳 $${amount}。`);
      return;
    }
    if (amount > paymentSettings.dailyLimit) {
      Alert.alert('超過每日限額', `目前每日限額為 ${formatPrice(paymentSettings.dailyLimit)}。`);
      return;
    }

    Alert.alert('確認轉帳', `將轉帳 $${amount} 至 ${target.name}（@${target.account}）`, [
      { text: '取消', style: 'cancel' },
      {
        text: '確認',
        onPress: async () => {
          setLoading(true);
          try {
            const result = await ds.processPayment({
              userId: auth.user!.uid,
              amount,
              paymentMethod: selectedPayment,
              merchantId: `transfer:${target.id}`,
              description: `轉帳給 ${target.name}`,
            });

            if (!result.success) {
              Alert.alert('轉帳失敗', result.errorMessage ?? '請稍後再試。');
              return;
            }

            const newBalance = result.newBalance ?? Math.max(0, balance - amount);
            setBalance(newBalance);
            setTransactions((prev) => [
              {
                id: result.transactionId ?? `transfer-${Date.now()}`,
                title: `轉帳給 ${target.name}`,
                amount: -amount,
                type: 'expense',
                category: 'other',
                timestamp: new Date(),
                location: '校園支付',
              },
              ...prev,
            ]);
            setRecentTransferTargetIds((prev) => {
              const next = [target.id, ...prev.filter((id) => id !== target.id)];
              return next.slice(0, 5);
            });
            analytics.logEvent('payment_transfer', {
              amount,
              targetId: target.id,
              paymentMethod: selectedPayment,
            });
            Alert.alert('轉帳成功', `已轉帳 $${amount} 給 ${target.name}`);
          } catch (error: any) {
            Alert.alert('轉帳失敗', error?.message ?? '請稍後再試。');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const handleTopup = async (amount: number) => {
    if (!auth.user) {
      Alert.alert('請先登入', '您需要登入才能儲值。');
      return;
    }

    // 驗證儲值金額限制
    if (amount < 100) {
      Alert.alert('金額不足', '最低儲值金額為 $100');
      return;
    }

    if (amount > 10000) {
      Alert.alert('超過限額', '單次儲值上限為 $10,000');
      return;
    }

    Alert.alert('確認儲值', `確定要儲值 $${amount} 嗎？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '確認',
        onPress: async () => {
          // 使用 loading 狀態防止重複點擊
          setLoading(true);

          try {
            // 安全性重點：透過後端 Cloud Function 處理儲值
            // 而不是前端直接更新餘額，避免被繞過驗證
            //
            // 後端會執行以下步驟：
            // 1. 驗證使用者身份和權限
            // 2. 處理支付（如連接第三方支付服務）
            // 3. 在交易成功後才更新餘額（使用 Firestore transaction 確保原子性）
            // 4. 建立交易記錄
            // 5. 回傳更新後的餘額

            const topupResult = await ds.processTopup({
              userId: auth.user!.uid,
              amount,
              paymentMethod: selectedPayment,
            });

            if (!topupResult.success) {
              Alert.alert('儲值失敗', topupResult.errorMessage ?? '請稍後再試。');
              return;
            }

            analytics.logEvent('topup', { amount });

            // 從後端返回的結果更新本地狀態
            // 而不是自己計算新餘額
            if (topupResult.newBalance !== undefined) {
              setBalance(topupResult.newBalance);
            }

            // 重新載入交易記錄以確保資料一致性
            await loadPaymentData();

            Alert.alert(
              '儲值成功',
              `已成功儲值 $${amount}` +
                (topupResult.newBalance !== undefined
                  ? `，目前餘額 $${topupResult.newBalance}`
                  : ''),
            );
          } catch (error: any) {
            console.error('Topup failed:', error);

            // 根據錯誤類型提供更詳細的錯誤訊息
            let errorMessage = '請稍後再試。';
            if (error?.code === 'NETWORK_ERROR') {
              errorMessage = '網路連線失敗，請檢查網路狀態。';
            } else if (error?.code === 'AUTH_ERROR') {
              errorMessage = '身份驗證失敗，請重新登入。';
            } else if (error?.code === 'PAYMENT_FAILED') {
              errorMessage = '支付失敗，請確認支付方式。';
            } else if (error?.message) {
              errorMessage = error.message;
            }

            Alert.alert('儲值失敗', errorMessage);
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  const handleTransactionPress = (transaction: Transaction) => {
    Alert.alert(
      transaction.title,
      `金額：${formatAmount(transaction.amount)}\n` +
        `時間：${formatDateTime(transaction.timestamp)}\n` +
        (transaction.location ? `地點：${transaction.location}` : ''),
      [{ text: '關閉' }],
    );
  };

  const handleExportTransactions = useCallback(async () => {
    if (transactions.length === 0) {
      Alert.alert('沒有資料', '目前沒有可匯出的交易紀錄。');
      return;
    }

    try {
      const csv = `\uFEFF${buildCsv(
        ['id', 'title', 'amount', 'type', 'category', 'timestamp', 'location'],
        transactions.map((transaction) => [
          transaction.id,
          transaction.title,
          transaction.amount,
          transaction.type,
          transaction.category,
          formatDateTime(transaction.timestamp),
          transaction.location ?? '',
        ]),
      )}`;
      const schoolCode = school.code ?? school.id ?? 'campus';
      const file = new File(Paths.cache, `payment-transactions-${schoolCode}-${Date.now()}.csv`);
      await file.write(csv);

      const canShare = await isAvailableAsync();
      if (!canShare) {
        Alert.alert('匯出成功', `CSV 已儲存至：${file.uri}`);
        return;
      }

      await shareAsync(file.uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
      });
      analytics.logEvent('payment_transactions_exported', { count: transactions.length });
    } catch (error: any) {
      Alert.alert('匯出失敗', error?.message ?? '無法匯出交易紀錄。');
    }
  }, [school, transactions]);

  const groupedTransactions = useMemo(() => {
    const groups: { date: string; items: Transaction[] }[] = [];
    const sorted = [...filteredTransactions].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    sorted.forEach((transaction) => {
      const dateStr = transaction.timestamp.toLocaleDateString('zh-TW', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      });
      const existingGroup = groups.find((g) => g.date === dateStr);
      if (existingGroup) {
        existingGroup.items.push(transaction);
      } else {
        groups.push({ date: dateStr, items: [transaction] });
      }
    });

    return groups;
  }, [filteredTransactions]);

  if (!paymentsEnabled) {
    return (
      <Screen>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          }}
        >
          <AnimatedCard title="校園支付尚未開通" subtitle="正式版目前不顯示未驗證的支付入口">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              支付供應商 webhook、對帳與商店審核素材完成前，正式版會先隱藏支付功能。
            </Text>
          </AnimatedCard>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView
          style={{ flex: 1, marginTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {selectedTab === 0 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              {loading ? (
                <View style={{ paddingVertical: 60, alignItems: 'center' }}>
                  <Spinner size={32} />
                  <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入中...</Text>
                </View>
              ) : (
                <>
                  <AnimatedCard>
                    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 14 }}>學生證餘額</Text>
                      <Text
                        style={{
                          color: theme.colors.text,
                          fontSize: 48,
                          fontWeight: '900',
                          marginTop: 8,
                        }}
                      >
                        ${balance}
                      </Text>
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 }}
                      >
                        <Ionicons name="shield-checkmark" size={14} color={theme.colors.success} />
                        <Text
                          style={{ color: theme.colors.success, fontSize: 12, fontWeight: '600' }}
                        >
                          已綁定學生證
                        </Text>
                      </View>
                    </View>
                  </AnimatedCard>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {QUICK_ACTIONS.map((action) => (
                      <Pressable
                        key={action.id}
                        onPress={() => handleQuickAction(action)}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          padding: 16,
                          borderRadius: theme.radius.lg,
                          backgroundColor: theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                        }}
                      >
                        <View
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: `${action.color}20`,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 8,
                          }}
                        >
                          <Ionicons name={action.icon as any} size={22} color={action.color} />
                        </View>
                        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                          {action.title}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <AnimatedCard title="消費統計" delay={100}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                      <View style={{ alignItems: 'center' }}>
                        <Text
                          style={{ color: theme.colors.danger, fontWeight: '900', fontSize: 24 }}
                        >
                          ${todayExpense}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                          今日消費
                        </Text>
                      </View>
                      <View style={{ width: 1, backgroundColor: theme.colors.border }} />
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 24 }}>
                          ${monthExpense}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                          本月消費
                        </Text>
                      </View>
                    </View>
                  </AnimatedCard>

                  <AnimatedCard title="最近交易" subtitle="查看更多" delay={150}>
                    <View style={{ gap: 10 }}>
                      {transactions.slice(0, 4).map((transaction) => (
                        <Pressable
                          key={transaction.id}
                          onPress={() => handleTransactionPress(transaction)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingVertical: 8,
                            gap: 12,
                          }}
                        >
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 20,
                              backgroundColor: `${getCategoryColor(transaction.category)}20`,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Ionicons
                              name={getCategoryIcon(transaction.category) as any}
                              size={20}
                              color={getCategoryColor(transaction.category)}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                              {transaction.title}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                              {transaction.location || '校園'}
                            </Text>
                          </View>
                          <Text
                            style={{
                              color:
                                transaction.amount >= 0 ? theme.colors.success : theme.colors.text,
                              fontWeight: '700',
                              fontSize: 15,
                            }}
                          >
                            {formatAmount(transaction.amount)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      onPress={() => setSelectedTab(1)}
                      style={{
                        marginTop: 12,
                        paddingVertical: 10,
                        alignItems: 'center',
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.border,
                      }}
                    >
                      <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>
                        查看完整紀錄
                      </Text>
                    </Pressable>
                  </AnimatedCard>
                </>
              )}
            </View>
          )}

          {selectedTab === 1 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <SearchBar
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜尋交易紀錄"
              />

              {groupedTransactions.map((group, gidx) => (
                <AnimatedCard key={group.date} title={group.date} delay={gidx * 50}>
                  <View style={{ gap: 10 }}>
                    {group.items.map((transaction) => (
                      <Pressable
                        key={transaction.id}
                        onPress={() => handleTransactionPress(transaction)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 8,
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            backgroundColor: `${getCategoryColor(transaction.category)}20`,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Ionicons
                            name={getCategoryIcon(transaction.category) as any}
                            size={20}
                            color={getCategoryColor(transaction.category)}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                            {transaction.title}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                            {transaction.timestamp.toLocaleTimeString('zh-TW', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            · {transaction.location || '校園'}
                          </Text>
                        </View>
                        <Text
                          style={{
                            color:
                              transaction.amount >= 0 ? theme.colors.success : theme.colors.text,
                            fontWeight: '700',
                            fontSize: 15,
                          }}
                        >
                          {formatAmount(transaction.amount)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </AnimatedCard>
              ))}
            </View>
          )}

          {selectedTab === 2 && (
            <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
              <AnimatedCard title="付款方式">
                {(
                  [
                    {
                      key: 'student_card',
                      label: '學生證',
                      icon: 'card',
                      desc: '使用學生證餘額付款',
                    },
                    {
                      key: 'mobile_pay',
                      label: '行動支付',
                      icon: 'phone-portrait',
                      desc: '連結 Apple Pay / Google Pay',
                    },
                    {
                      key: 'credit_card',
                      label: '信用卡',
                      icon: 'card-outline',
                      desc: '綁定信用卡快速付款',
                    },
                  ] as const
                ).map((method) => (
                  <Pressable
                    key={method.key}
                    onPress={() => setSelectedPayment(method.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 14,
                      marginVertical: 4,
                      borderRadius: theme.radius.md,
                      backgroundColor:
                        selectedPayment === method.key ? theme.colors.accentSoft : 'transparent',
                      gap: 12,
                    }}
                  >
                    <Ionicons
                      name={method.icon as any}
                      size={24}
                      color={
                        selectedPayment === method.key ? theme.colors.accent : theme.colors.muted
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color:
                            selectedPayment === method.key
                              ? theme.colors.accent
                              : theme.colors.text,
                          fontWeight: '600',
                        }}
                      >
                        {method.label}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                        {method.desc}
                      </Text>
                    </View>
                    {selectedPayment === method.key && (
                      <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} />
                    )}
                  </Pressable>
                ))}
              </AnimatedCard>

              <AnimatedCard title="安全設定" delay={100}>
                <View style={{ gap: 12 }}>
                  <Pressable
                    onPress={() => openSettingsModal('passcode')}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="key" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>支付密碼</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                        {paymentSettings.passcode ? '已設定' : '未設定'}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={toggleBiometrics}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="finger-print" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>生物辨識</Text>
                    </View>
                    <Text
                      style={{
                        color: paymentSettings.biometricsEnabled
                          ? theme.colors.success
                          : theme.colors.muted,
                        fontSize: 13,
                      }}
                    >
                      {paymentSettings.biometricsEnabled ? '已開啟' : '已關閉'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openSettingsModal('dailyLimit')}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="alert-circle" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>每日限額</Text>
                    </View>
                    <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                      {formatPrice(paymentSettings.dailyLimit)}
                    </Text>
                  </Pressable>
                </View>
              </AnimatedCard>

              <AnimatedCard title="其他" delay={150}>
                <View style={{ gap: 12 }}>
                  <Pressable
                    onPress={() => openSettingsModal('invoiceCarrier')}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="receipt-outline" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>發票載具</Text>
                    </View>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}
                    >
                      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                        {paymentSettings.invoiceCarrier || '未設定'}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={handleExportTransactions}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="download-outline" size={20} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>匯出紀錄</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                  </Pressable>
                </View>
              </AnimatedCard>
            </View>
          )}
        </ScrollView>
      </View>

      <Modal
        visible={showTransferTargetModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTransferTargetModal(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: 16,
              gap: 12,
              maxHeight: '75%',
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
              選擇轉帳對象
            </Text>
            <TextInput
              value={transferTargetQuery}
              onChangeText={setTransferTargetQuery}
              placeholder="搜尋名稱或帳號"
              placeholderTextColor={theme.colors.muted}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                color: theme.colors.text,
              }}
            />

            <ScrollView style={{ maxHeight: 320 }}>
              <View style={{ gap: 8 }}>
                {transferTargetQuery.trim() === '' && recentTransferTargets.length > 0 && (
                  <>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '700' }}>
                      最近轉帳
                    </Text>
                    {recentTransferTargets.map((target) => (
                      <Pressable
                        key={`recent-${target.id}`}
                        onPress={() => {
                          setShowTransferTargetModal(false);
                          openTransferAmountPicker(target);
                        }}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                          {target.name}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          @{target.account}
                        </Text>
                      </Pressable>
                    ))}
                    <Text
                      style={{
                        color: theme.colors.muted,
                        fontSize: 12,
                        fontWeight: '700',
                        marginTop: 2,
                      }}
                    >
                      其他對象
                    </Text>
                  </>
                )}
                {(transferTargetQuery.trim() === ''
                  ? nonRecentFilteredTransferTargets
                  : filteredTransferTargets
                ).map((target) => (
                  <Pressable
                    key={target.id}
                    onPress={() => {
                      setShowTransferTargetModal(false);
                      openTransferAmountPicker(target);
                    }}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                      {target.name}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      @{target.account}
                    </Text>
                  </Pressable>
                ))}
                {(transferTargetQuery.trim() === ''
                  ? nonRecentFilteredTransferTargets
                  : filteredTransferTargets
                ).length === 0 &&
                  recentTransferTargets.length === 0 && (
                    <Text style={{ color: theme.colors.muted }}>找不到符合條件的收款方</Text>
                  )}
              </View>
            </ScrollView>

            <Button text="取消" onPress={() => setShowTransferTargetModal(false)} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCustomTransferModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomTransferModal(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: 16,
              gap: 12,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
              自訂轉帳金額
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              收款方：{selectedTransferTarget?.name ?? '未選擇'}
            </Text>
            <TextInput
              value={customTransferAmount}
              onChangeText={setCustomTransferAmount}
              keyboardType="number-pad"
              placeholder="輸入金額（例如 250）"
              placeholderTextColor={theme.colors.muted}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                color: theme.colors.text,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button text="取消" onPress={() => setShowCustomTransferModal(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button text="確認轉帳" kind="primary" onPress={submitCustomTransfer} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={settingsModal !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSettingsModal}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: 16,
              gap: 12,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
              {settingsModal === 'passcode'
                ? '設定支付密碼'
                : settingsModal === 'dailyLimit'
                  ? '設定每日限額'
                  : '設定發票載具'}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              {settingsModal === 'passcode'
                ? '支付密碼僅儲存在此裝置，用於付款時的本機確認。'
                : settingsModal === 'dailyLimit'
                  ? '超過此金額的付款或轉帳會被擋下。'
                  : '可輸入手機條碼，留空則代表不設定。'}
            </Text>
            <TextInput
              value={settingsInput}
              onChangeText={setSettingsInput}
              keyboardType={
                settingsModal === 'dailyLimit' || settingsModal === 'passcode'
                  ? 'number-pad'
                  : 'default'
              }
              secureTextEntry={settingsModal === 'passcode'}
              autoCapitalize={settingsModal === 'invoiceCarrier' ? 'characters' : 'none'}
              placeholder={
                settingsModal === 'passcode'
                  ? '輸入 4 至 6 位數字'
                  : settingsModal === 'dailyLimit'
                    ? '例如 1000'
                    : '例如 /ABCD123'
              }
              placeholderTextColor={theme.colors.muted}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                color: theme.colors.text,
              }}
            />
            {settingsModal === 'passcode' && (
              <TextInput
                value={settingsConfirmInput}
                onChangeText={setSettingsConfirmInput}
                keyboardType="number-pad"
                secureTextEntry
                placeholder="再次輸入支付密碼"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                }}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button text="取消" onPress={closeSettingsModal} />
              </View>
              <View style={{ flex: 1 }}>
                <Button text="儲存" kind="primary" onPress={saveSettings} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
