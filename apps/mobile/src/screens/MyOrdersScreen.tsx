/**
 * 我的訂單（學生）
 *
 * 讀學生自己的訂單副本（伺服器上的 users/{uid}/schools/{schoolId}/orders），由新到舊、即時更新。
 * 每筆最上面是取餐號碼；沒號碼寫「號碼還沒拿到，請到櫃台確認。」和「下單時間・品項」，
 * 店家取消的單寫「這張單店家取消了」，不再顯示號碼。App 關掉重開一樣從伺服器讀，不靠手機本機存的訂單。
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AIDetailScreen, AICard, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { watchMyOrders, type MyOrder } from '../features/dining';
import {
  describePickupNumber,
  formatShortOrderCode,
} from '@campus/shared/src/ordering/pickupNumber';

export const MY_ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '等店家接單',
  confirmed: '店家已接單',
  preparing: '準備中',
  ready: '餐點好了',
  completed: '已取餐',
  cancelled: '訂單已取消',
};

type Props = { navigation?: { goBack?: () => void } };

export function MyOrderCard({ order }: { order: MyOrder }) {
  const pickup = describePickupNumber(order);
  return (
    <AICard title={MY_ORDER_STATUS_LABELS[order.status] ?? '訂單紀錄'} source={order.shop}>
      <View style={{ gap: 6 }}>
        {pickup.state === 'assigned' ? (
          <Text
            accessibilityLabel={pickup.text}
            style={{ color: aiTokens.text, fontSize: 22, fontWeight: '700' }}
          >
            {pickup.text}
          </Text>
        ) : pickup.state === 'cancelled' ? (
          <Text style={{ color: aiTokens.danger, fontWeight: '700' }}>{pickup.text}</Text>
        ) : (
          <>
            <Text style={{ color: aiTokens.text, fontWeight: '700' }}>{pickup.text}</Text>
            {pickup.detail ? (
              <Text selectable style={{ color: aiTokens.text }}>
                {pickup.detail}
              </Text>
            ) : null}
            <Text style={{ color: aiTokens.muted }}>狀態：{pickup.label}</Text>
          </>
        )}
        {order.total != null ? (
          <Text style={{ color: aiTokens.muted }}>到店付款 NT${order.total}</Text>
        ) : null}
        <Text selectable style={{ color: aiTokens.muted }}>
          {formatShortOrderCode(order.id)}
        </Text>
      </View>
    </AICard>
  );
}

export default function MyOrdersScreen({ navigation }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const userId = user?.uid ?? '';
  const schoolId = school.id;
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setOrders(null);
    setFailed(false);
    if (!userId) return undefined;
    let active = true;
    const stop = watchMyOrders(
      { userId, schoolId },
      (next) => {
        if (!active) return;
        setOrders(next);
        setFailed(false);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [userId, schoolId]);
  return (
    <AIDetailScreen
      title="我的訂單"
      subtitle="取餐號碼和訂單狀態以店家那邊為準，會自動更新。"
      onBack={() => navigation?.goBack?.()}
    >
      {!userId ? (
        <AICard title="登入後查看訂單">
          <Text style={{ color: aiTokens.muted }}>請先登入學校帳號。</Text>
        </AICard>
      ) : failed ? (
        <AICard title="訂單讀不到">
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
            目前讀不到訂單，請確認連線後再開一次這頁。
          </Text>
        </AICard>
      ) : orders === null ? (
        <ActivityIndicator accessibilityLabel="讀取訂單" color={aiTokens.ai} />
      ) : orders.length === 0 ? (
        <AICard title="還沒有訂單">
          <Text style={{ color: aiTokens.muted }}>在「餐廳」點餐後，訂單和取餐號碼會出現在這裡。</Text>
        </AICard>
      ) : (
        orders.map((order) => <MyOrderCard key={order.id} order={order} />)
      )}
    </AIDetailScreen>
  );
}
