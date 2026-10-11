/* eslint-disable */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../services/demoSession';
import { useMerchantOrders } from '../hooks/useMerchantOrders';
import { ordersForView, type MerchantOrderView } from '../features/merchantOrderViews';
import {
  giveMerchantQueueNumber,
  updateMerchantOrderStatus,
} from '../services/merchant';
import {
  PICKUP_NUMBER_PENDING_LABEL,
  formatShortOrderCode,
  formatTaipeiOrderTime,
} from '@campus/shared/src/ordering/pickupNumber';
import { updateDemoOrderStatus } from '../services/demoMerchantOrders';
import { updateOrderStatus as updateDemoStoreOrderStatus } from '../services/demoStore';
import { Screen, AnimatedCard, Button, Pill, Spinner } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import type { MerchantAssignment, Order } from '../data/types';

function getOrderStatusLabel(status: Order['status']) {
  switch (status) {
    case 'pending':
      return '待接單';
    case 'confirmed':
      return '已接單';
    case 'preparing':
      return '製作中';
    case 'ready':
      return '可取餐';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function getOrderStatusKind(status: Order['status']) {
  switch (status) {
    case 'ready':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'preparing':
      return 'warning';
    case 'completed':
      return 'accent';
    default:
      return 'default';
  }
}

function realQueueNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function getNextOrderAction(status: Order['status']) {
  switch (status) {
    case 'pending':
      return { status: 'confirmed' as const, label: '確認接單' };
    case 'confirmed':
      return { status: 'preparing' as const, label: '開始製作' };
    case 'preparing':
      return { status: 'ready' as const, label: '標記可取餐' };
    case 'ready':
      return { status: 'completed' as const, label: '標記已完成' };
    default:
      return null;
  }
}

export { ordersForView, type MerchantOrderView } from '../features/merchantOrderViews';

export function MerchantHubScreen({
  view,
  onAssignmentChange,
}: {
  view?: MerchantOrderView;
  /** 讓外層（店家工作台）知道現在看哪家店，分頁標題的數字才會對同一家店 */
  onAssignmentChange?: (cafeteriaId: string | null) => void;
} = {}) {
  const auth = useAuth();
  const assignments = useMemo(
    () =>
      (auth.profile?.merchantAssignments ?? []).filter(
        (assignment) => assignment.status === 'active',
      ),
    [auth.profile?.merchantAssignments],
  );
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(
    assignments[0]?.cafeteriaId ?? null,
  );
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  // 按了「給號碼」之後先換上伺服器回的號碼，重新整理後以訂單資料為準
  const [givenNumbers, setGivenNumbers] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!assignments.some((assignment) => assignment.cafeteriaId === selectedAssignmentId)) {
      setSelectedAssignmentId(assignments[0]?.cafeteriaId ?? null);
    }
  }, [assignments, selectedAssignmentId]);

  const selectedAssignment =
    assignments.find((assignment) => assignment.cafeteriaId === selectedAssignmentId) ?? null;

  const isDemoSession = isDemoUid(auth.user?.uid);

  useEffect(() => {
    onAssignmentChange?.(selectedAssignment?.cafeteriaId ?? null);
  }, [onAssignmentChange, selectedAssignment?.cafeteriaId]);

  // 即時監聽這家店的訂單，新單進來不用下拉；換店或離開畫面就關掉監聽
  const { orders, loading, refreshing, error, refresh } = useMerchantOrders({
    assignment: selectedAssignment,
    isDemo: isDemoSession,
    includeClosed: !view && showAllOrders,
  });

  const filteredOrders = useMemo(() => {
    if (view) return ordersForView(orders, view);
    if (showAllOrders) {
      return orders;
    }
    return orders.filter((order) =>
      ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status),
    );
  }, [orders, showAllOrders, view]);

  const summary = useMemo(
    () => ({
      pending: orders.filter((order) => order.status === 'pending').length,
      preparing: orders.filter((order) => order.status === 'preparing').length,
      ready: orders.filter((order) => order.status === 'ready').length,
    }),
    [orders],
  );

  const handleAdvanceOrder = async (
    order: Order,
    nextStatus: Order['status'],
  ) => {
    if (!selectedAssignment) return;

    setUpdatingOrderId(order.id);
    try {
      if (isDemoSession) {
        // demo：直接寫進 in-memory store + 推 cross-role event 給學生 inbox
        updateDemoOrderStatus(order.id, nextStatus as Order['status']);
        if (nextStatus === 'preparing' || nextStatus === 'ready' || nextStatus === 'completed') {
          updateDemoStoreOrderStatus(
            order.id,
            nextStatus === 'preparing' ? 'processing' : nextStatus,
          );
          try {
            const { simulateVendorAdvanceOrder } = await import(
              '../services/demoActionSimulator'
            );
            const studentUid =
              typeof order.userId === 'string' && order.userId
                ? order.userId
                : 'demo_student_kuchih';
            await simulateVendorAdvanceOrder({
              vendorUid: auth.user?.uid ?? 'demo_cafeteria',
              vendorName: auth.profile?.displayName ?? '商家',
              studentUid,
              orderId: order.id,
              merchantId:
                selectedAssignment.merchantId ?? selectedAssignment.cafeteriaId,
              merchantName: selectedAssignment.cafeteriaName,
              newStatus:
                nextStatus === 'preparing'
                  ? 'processing'
                  : (nextStatus as 'ready' | 'completed'),
            });
          } catch (busError) {
            console.warn('[MerchantHub] simulateVendorAdvanceOrder failed:', busError);
          }
        }
      } else {
        await updateMerchantOrderStatus({
          schoolId: selectedAssignment.schoolId,
          orderId: order.id,
          status: nextStatus,
        });
      }
      await refresh();
      // 使用紀錄失敗不影響已經改好的訂單狀態
      try {
        void import('../services/companionEngine')
          .then((m) => m.recordCompanionFeatureSignal('vendor_hub'))
          .catch(() => undefined);
      } catch {
        // ignore
      }
    } catch (error: any) {
      Alert.alert('更新失敗', error?.message ?? '請稍後再試。');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // 給號碼：伺服器發號碼；還沒接的單一併接下來，會從「待接單」移到「出餐」
  const handleGiveNumber = async (order: Order) => {
    if (!selectedAssignment || isDemoSession) return;
    setUpdatingOrderId(order.id);
    try {
      const given = await giveMerchantQueueNumber({
        schoolId: selectedAssignment.schoolId,
        orderId: order.id,
        cafeteriaId: selectedAssignment.cafeteriaId,
      });
      setGivenNumbers((current) => ({ ...current, [order.id]: given.queueNumber }));
      await refresh();
    } catch (error: any) {
      Alert.alert(
        '號碼還沒給出去',
        `${error?.message ?? '請稍後再試一次。'}\n不接這張單可以按「拒單」。`,
      );
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // 拒單：走原本的取消訂單，學生那邊會看到「這張單店家取消了」，號碼也拿掉
  const handleReject = (order: Order) => {
    Alert.alert('確定拒單？', '學生會看到「這張單店家取消了」。', [
      { text: '先不要', style: 'cancel' },
      {
        text: '拒單',
        style: 'destructive',
        onPress: () => void handleAdvanceOrder(order, 'cancelled'),
      },
    ]);
  };

  // Check if user has merchant role
  // 注意：demo 商家角色 (role === 'vendor') 也需通過此檢查
  const hasMerchantRole =
    auth.profile?.role === 'vendor' ||
    auth.profile?.serviceRoles?.includes('merchant') ||
    assignments.length > 0;

  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <Screen>
        <AnimatedCard title="商家接單" subtitle="未登入">
          <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
            請先登入才能存取商家接單功能。
          </Text>
        </AnimatedCard>
      </Screen>
    );
  }

  if (!hasMerchantRole || assignments.length === 0) {
    return (
      <Screen>
        <AnimatedCard title="商家接單" subtitle="您目前沒有商家權限">
          <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
            只有被指派為 active operator 的帳號才會顯示商家接單入口。
          </Text>
        </AnimatedCard>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <AnimatedCard title="商家接單" subtitle={selectedAssignment?.schoolName ?? '店家營運'}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pill text={`${summary.pending} 筆待接單`} kind="warning" />
              <Pill text={`${summary.preparing} 筆製作中`} kind="accent" />
              <Pill text={`${summary.ready} 筆可取餐`} kind="success" />
            </View>
            <Text
              style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700', marginTop: 14 }}
            >
              {selectedAssignment?.cafeteriaName}
            </Text>
            <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
              {selectedAssignment?.orderingEnabled ? '接單功能已開啟' : '接單功能已關閉'}
            </Text>
          </AnimatedCard>

          {assignments.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {assignments.map((assignment) => (
                  <Pressable
                    key={`${assignment.schoolId}:${assignment.cafeteriaId}`}
                    onPress={() => setSelectedAssignmentId(assignment.cafeteriaId)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: theme.radius.full,
                      backgroundColor:
                        selectedAssignment?.cafeteriaId === assignment.cafeteriaId
                          ? theme.colors.accent
                          : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor:
                        selectedAssignment?.cafeteriaId === assignment.cafeteriaId
                          ? theme.colors.accent
                          : theme.colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          selectedAssignment?.cafeteriaId === assignment.cafeteriaId
                            ? '#fff'
                            : theme.colors.text,
                        fontWeight: '700',
                      }}
                    >
                      {assignment.cafeteriaName}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}

          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 17 }}>
              {view === 'pending' ? '待接單' : view === 'kitchen' ? '出餐' : '訂單列表'}
            </Text>
            {view ? null : (
              <Button
                text={showAllOrders ? '只看待處理' : '顯示全部'}
                kind="outline"
                size="small"
                onPress={() => setShowAllOrders((value) => !value)}
              />
            )}
          </View>

          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <Spinner size={32} />
              <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入訂單中...</Text>
            </View>
          ) : error ? (
            <AnimatedCard title="讀取失敗" subtitle="無法取得餐廳訂單">
              <Text style={{ color: theme.colors.danger }}>{error}</Text>
              <Button text="重試" onPress={refresh} style={{ marginTop: 12 }} />
            </AnimatedCard>
          ) : filteredOrders.length === 0 ? (
            <AnimatedCard
              title={view === 'pending' ? '沒有待接的單' : view === 'kitchen' ? '沒有要出的餐' : '目前沒有訂單'}
              subtitle={view === 'kitchen' ? '接下來的單會出現在這裡' : '新的訂單會出現在這裡'}
            >
              <Text style={{ color: theme.colors.muted }}>
                {view === 'pending'
                  ? '學生下單後會先出現在這裡。'
                  : view === 'kitchen'
                    ? '在「待接單」按「給號碼並接單」或「確認接單」後，單會移到這裡。'
                    : showAllOrders
                      ? '尚無任何訂單。'
                      : '目前沒有待處理訂單。'}
              </Text>
            </AnimatedCard>
          ) : (
            filteredOrders.map((order, index) => {
              const cancelled = order.status === 'cancelled';
              const queueNumber = cancelled
                ? null
                : (realQueueNumber(order.queueNumber) ?? givenNumbers[order.id] ?? null);
              // 待給號碼：店家按「給號碼並接單」（待接單）或「給號碼」（出餐）由伺服器發真的號碼
              const needsNumber =
                !isDemoSession &&
                queueNumber == null &&
                order.status !== 'completed' &&
                !cancelled;
              const isPending = order.status === 'pending';
              const nextAction =
                needsNumber && isPending ? null : getNextOrderAction(order.status);
              const busy = updatingOrderId === order.id;
              const customerLabel = order.customerName ?? order.userId;
              const customerRole = order.customerRole ? ` · ${order.customerRole}` : '';
              return (
                <AnimatedCard key={order.id} delay={index * 40}>
                  <View style={{ gap: 12 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ gap: 6 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
                          {order.cafeteria ?? selectedAssignment?.cafeteriaName ?? '餐廳訂單'}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {formatShortOrderCode(order.id)} · {customerLabel}{customerRole}
                        </Text>
                      </View>
                      <Pill
                        text={getOrderStatusLabel(order.status)}
                        kind={getOrderStatusKind(order.status) as any}
                      />
                    </View>

                    <View
                      style={{
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        padding: 12,
                        gap: 8,
                      }}
                    >
                      {order.items.map((item, itemIndex) => (
                        <View
                          key={`${order.id}:${item.menuItemId}:${itemIndex}`}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
                        >
                          <Text style={{ color: theme.colors.text, flex: 1 }}>
                            {item.name} x{item.quantity}
                          </Text>
                          <Text style={{ color: theme.colors.muted }}>
                            ${item.price * item.quantity}
                          </Text>
                        </View>
                      ))}
                    </View>

                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: theme.colors.muted }}>
                        總額 ${order.totalAmount ?? order.total ?? 0}
                        {' · '}
                        {order.paymentLabel ?? (order.paymentMethod === 'onsite' ? '到店付款' : '線上付款')}
                      </Text>
                      {order.note ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            maxWidth: '60%',
                          }}
                        >
                          <Ionicons
                            name="document-text-outline"
                            size={16}
                            color={theme.colors.muted}
                          />
                          <Text style={{ color: theme.colors.muted }} numberOfLines={1}>
                            {order.note}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {queueNumber != null ? (
                      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                        取餐號碼 {queueNumber}
                      </Text>
                    ) : needsNumber ? (
                      <Text style={{ color: theme.colors.danger, fontWeight: '700' }}>
                        取餐號碼：{PICKUP_NUMBER_PENDING_LABEL}
                        {formatTaipeiOrderTime(order.createdAt)
                          ? `・下單 ${formatTaipeiOrderTime(order.createdAt)}`
                          : ''}
                      </Text>
                    ) : null}

                    {needsNumber ? (
                      <Button
                        text={busy ? '給號碼中...' : isPending ? '給號碼並接單' : '給號碼'}
                        kind="primary"
                        disabled={busy}
                        onPress={() => handleGiveNumber(order)}
                      />
                    ) : null}

                    {nextAction ? (
                      <Button
                        text={busy ? '更新中...' : nextAction.label}
                        kind="primary"
                        disabled={busy}
                        onPress={() => handleAdvanceOrder(order, nextAction.status)}
                      />
                    ) : null}

                    {isPending ? (
                      <Button
                        text="拒單"
                        kind="outline"
                        disabled={busy}
                        onPress={() => handleReject(order)}
                      />
                    ) : null}

                    {nextAction || needsNumber || isPending ? null : (
                      <Text style={{ color: theme.colors.muted, textAlign: 'center' }}>
                        此訂單目前不需要進一步操作。
                      </Text>
                    )}
                  </View>
                </AnimatedCard>
              );
            })
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
