/**
 * 我的訂單（學生）
 *
 * 讀學生自己的訂單副本（伺服器上的 users/{uid}/schools/{schoolId}/orders），由新到舊、即時更新。
 * 每筆最上面是取餐號碼；沒號碼寫「號碼還沒拿到，請到櫃台確認。」和「下單時間・品項」，
 * 店家取消的單寫「這張單店家取消了」，不再顯示號碼。App 關掉重開一樣從伺服器讀，不靠手機本機存的訂單。
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { hasReadySchoolSession } from '../app/SchoolSessionBoundary';
import { toPublicSchoolId } from '../data/schoolIds';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { watchMyOrder, watchMyOrders, type MyOrder } from '../features/dining';
import {
  describePickupNumber,
  formatShortOrderCode,
} from '@campus/shared/src/ordering/pickupNumber';
import { ORDER_FOCUS_MISSING, parseOrderFocusId } from './orderDeepLink';

export const MY_ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '等店家接單',
  confirmed: '店家已接單',
  preparing: '準備中',
  ready: '餐點好了',
  completed: '已取餐',
  cancelled: '訂單已取消',
};

type Props = {
  navigation?: { goBack?: () => void };
  route?: { params?: { orderId?: string; schoolId?: string } };
};

export function MyOrderCard({
  order,
  focused = false,
  fromCache = false,
}: {
  order: MyOrder;
  focused?: boolean;
  fromCache?: boolean;
}) {
  const pickup = describePickupNumber(order);
  return (
    <AICard
      title={MY_ORDER_STATUS_LABELS[order.status] ?? '訂單紀錄'}
      source={order.shop}
      badge={focused ? (fromCache ? '通知訂單・上次同步' : '通知訂單') : undefined}
      style={
        focused
          ? { borderWidth: 2, borderColor: aiTokens.ai }
          : undefined
      }
    >
      <View style={{ gap: 6 }} accessibilityLabel={focused ? `目前通知訂單 ${formatShortOrderCode(order.id)}` : undefined}>
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

export default function MyOrdersScreen({ navigation, route }: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const auth = useAuth();
  const { school, selectionReady } = useSchool();
  const sourceSchool = route?.params?.schoolId;
  let content;
  if (auth.loading || auth.profileLoading || selectionReady === false) {
    content = <ActivityIndicator accessibilityLabel="確認帳號與學校" color={aiTokens.ai} />;
  } else if (!auth.user || !hasReadySchoolSession(auth, school.id)) {
    content = (
      <AICard title="登入後查看訂單">
        <Text style={{ color: aiTokens.muted }}>請使用目前學校的帳號登入。</Text>
      </AICard>
    );
  } else if (sourceSchool && toPublicSchoolId(sourceSchool) !== toPublicSchoolId(school.id)) {
    content = (
      <AICard title="這筆訂單屬於其他學校">
        <Text style={{ color: aiTokens.muted }}>請切換到下單時的學校，再開啟通知。</Text>
      </AICard>
    );
  } else {
    content = (
      <OrderList
        key={JSON.stringify([auth.user.uid, school.id])}
        userId={auth.user.uid}
        schoolId={school.id}
        focusOrderId={parseOrderFocusId(route?.params?.orderId)}
      />
    );
  }
  return (
    <AIDetailScreen
      title="我的訂單"
      subtitle="取餐號碼和訂單狀態以店家那邊為準，會自動更新。"
      onBack={navigation?.goBack}
    >
      {content}
    </AIDetailScreen>
  );
}

function OrderList({
  userId, schoolId, focusOrderId,
}: {
  userId: string;
  schoolId: string;
  focusOrderId: string | null;
}) {
  const [result, setResult] = useState<
    { orders: MyOrder[]; fromCache: boolean } | 'loading' | 'failed'
  >('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const stop = watchMyOrders(
      { userId, schoolId },
      (orders, fromCache) => {
        if (active) setResult({ orders, fromCache });
      },
      () => {
        if (active) setResult('failed');
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [userId, schoolId, attempt]);

  if (result === 'failed') {
    return (
      <AICard title="訂單讀不到">
        <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
          請確認網路連線後再試一次。
        </Text>
        <AIButton
          label="重新讀取訂單"
          onPress={() => {
            setResult('loading');
            setAttempt((value) => value + 1);
          }}
        />
      </AICard>
    );
  }
  if (result === 'loading') {
    return <ActivityIndicator accessibilityLabel="讀取訂單" color={aiTokens.ai} />;
  }
  const { orders, fromCache } = result;
  const selected = orders.find((order) => order.id === focusOrderId);
  return (
    <>
      {focusOrderId && !selected ? (
        <NotificationOrder key={focusOrderId} userId={userId} schoolId={schoolId} orderId={focusOrderId} />
      ) : null}
      {fromCache ? (
        <AICard title={orders.length ? '上次同步的訂單' : '等待訂單同步'}>
          <Text style={{ color: aiTokens.muted }}>
            {orders.length
              ? '連上伺服器後會更新取餐號碼與店家進度。'
              : '裝置尚未儲存近期的訂單，連上伺服器後會自動更新。'}
          </Text>
        </AICard>
      ) : null}
      {selected ? <MyOrderCard order={selected} focused /> : null}
      {orders.filter((order) => order !== selected).map((order) => (
        <MyOrderCard key={order.id} order={order} />
      ))}
      {!orders.length && !fromCache && !focusOrderId ? (
        <AICard title="還沒有訂單">
          <Text style={{ color: aiTokens.muted }}>這個帳號在目前學校還沒有訂單紀錄。</Text>
        </AICard>
      ) : null}
    </>
  );
}

// 通知可能指向近期 30 筆以外的訂單，單獨讀取，不中斷清單的即時更新。
function NotificationOrder({ userId, schoolId, orderId }: {
  userId: string;
  schoolId: string;
  orderId: string;
}) {
  const [result, setResult] = useState<
    { order: MyOrder | null; fromCache: boolean } | 'loading' | 'failed'
  >('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const stop = watchMyOrder(
      { userId, schoolId }, orderId,
      (order, fromCache) => {
        if (active) setResult({ order, fromCache });
      },
      () => {
        if (active) setResult('failed');
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [userId, schoolId, orderId, attempt]);
  if (result === 'failed') {
    return (
      <AICard title="通知訂單讀不到">
        <AIButton
          label="重試這筆訂單"
          onPress={() => {
            setResult('loading');
            setAttempt((value) => value + 1);
          }}
        />
      </AICard>
    );
  }
  if (result === 'loading' || (!result.order && result.fromCache)) {
    return <ActivityIndicator accessibilityLabel="正在確認通知訂單" color={aiTokens.ai} />;
  }
  if (!result.order) {
    return (
      <AICard title="通知訂單">
        <Text style={{ color: aiTokens.muted }}>{ORDER_FOCUS_MISSING}</Text>
      </AICard>
    );
  }
  return <MyOrderCard order={result.order} focused fromCache={result.fromCache} />;
}
