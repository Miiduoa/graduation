import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useTheme } from '../state/theme';
import { safeNavigate } from '../utils/safeNavigate';
import { watchMyOrders, type MyOrder } from '../features/dining';
import { describePickupNumber, formatShortOrderCode } from '@campus/shared/src/ordering/pickupNumber';

const OPEN_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

/** 最新一張還沒取餐的單；沒有就回 null */
export function latestOpenOrder(orders: MyOrder[]): MyOrder | null {
  return orders.find((order) => OPEN_STATUSES.includes(order.status)) ?? null;
}

/**
 * 首頁的取餐卡：有還沒取餐的單時顯示號碼（沒號碼就寫待給號碼兩行），點了開「我的訂單」。
 * 沒有這種單、沒登入、讀不到就整張不出現。
 */
export function OpenOrderCard({ navigation }: { navigation?: unknown }) {
  const theme = useTheme();
  const { user } = useAuth();
  const { school } = useSchool();
  const uid = user?.uid ?? '';
  const [order, setOrder] = useState<MyOrder | null>(null);

  useEffect(() => {
    setOrder(null);
    if (!uid || !school.id) return undefined;
    let active = true;
    const stop = watchMyOrders(
      { userId: uid, schoolId: school.id },
      (orders) => {
        if (active) setOrder(latestOpenOrder(orders));
      },
      () => {
        if (active) setOrder(null);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [uid, school.id]);

  if (!order) return null;
  const pickup = describePickupNumber(order);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`還沒取餐的單，${pickup.text}，打開我的訂單`}
      onPress={() => safeNavigate(navigation as never, 'StudentOrders')}
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        padding: 16,
        gap: 4,
        marginVertical: 12,
      }}
    >
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>還沒取餐 · {order.shop}</Text>
      <Text style={{ color: theme.colors.text, fontSize: pickup.state === 'assigned' ? 22 : 16, fontWeight: '700' }}>
        {pickup.text}
      </Text>
      {pickup.state === 'pending' ? (
        <View style={{ gap: 2 }}>
          {pickup.detail ? <Text style={{ color: theme.colors.text }}>{pickup.detail}</Text> : null}
          <Text style={{ color: theme.colors.muted }}>狀態：{pickup.label}</Text>
        </View>
      ) : null}
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{formatShortOrderCode(order.id)} · 看我的訂單</Text>
    </Pressable>
  );
}
