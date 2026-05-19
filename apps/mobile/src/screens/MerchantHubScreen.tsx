/* eslint-disable */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../services/demoSession';
import { useAsyncList } from '../hooks/useAsyncList';
import { listMerchantOrders, updateMerchantOrderStatus } from '../services/merchant';
import {
  listDemoMerchantOrders,
  updateDemoOrderStatus,
  subscribeDemoOrders,
} from '../services/demoMerchantOrders';
import { Screen, AnimatedCard, Button, Pill, Spinner } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import type { MerchantAssignment, Order } from '../data/types';

function getOrderStatusLabel(status: Order['status']) {
  switch (status) {
    case 'pending':
      return '待確認';
    case 'confirmed':
      return '已確認';
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

function getNextOrderAction(status: Order['status']) {
  switch (status) {
    case 'pending':
      return { status: 'confirmed', label: '確認接單' };
    case 'confirmed':
      return { status: 'preparing', label: '開始製作' };
    case 'preparing':
      return { status: 'ready', label: '標記可取餐' };
    case 'ready':
      return { status: 'completed', label: '標記已完成' };
    default:
      return null;
  }
}

export function MerchantHubScreen() {
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

  useEffect(() => {
    if (!assignments.some((assignment) => assignment.cafeteriaId === selectedAssignmentId)) {
      setSelectedAssignmentId(assignments[0]?.cafeteriaId ?? null);
    }
  }, [assignments, selectedAssignmentId]);

  const selectedAssignment =
    assignments.find((assignment) => assignment.cafeteriaId === selectedAssignmentId) ?? null;

  const isDemoSession = isDemoUid(auth.user?.uid);

  const {
    items: orders,
    loading,
    refreshing,
    error,
    refresh,
  } = useAsyncList<Order>(
    () => {
      if (!selectedAssignment) return Promise.resolve([]);
      // demo 模式直接讀本地 store + 預塞訂單，避免 Firestore 404 + 跨 id 對不上
      if (isDemoSession) {
        const merchantKey =
          selectedAssignment.merchantId ?? selectedAssignment.cafeteriaId;
        return Promise.resolve(listDemoMerchantOrders(merchantKey));
      }
      return listMerchantOrders({
        schoolId: selectedAssignment.schoolId,
        cafeteriaId: selectedAssignment.cafeteriaId,
        max: 80,
      });
    },
    [
      selectedAssignment?.schoolId,
      selectedAssignment?.cafeteriaId,
      selectedAssignment?.merchantId,
      isDemoSession,
    ],
    { keepPreviousData: true },
  );

  // demo 模式：學生剛下的單會走 demoMerchantOrders store。
  // 訂閱它的變化，店家畫面就能即時刷新「新訂單」
  useEffect(() => {
    if (!isDemoSession) return undefined;
    return subscribeDemoOrders(() => {
      void refresh();
    });
  }, [isDemoSession, refresh]);

  const filteredOrders = useMemo(() => {
    if (showAllOrders) {
      return orders;
    }
    return orders.filter((order) =>
      ['pending', 'confirmed', 'preparing', 'ready'].includes(order.status),
    );
  }, [orders, showAllOrders]);

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
    nextStatus: NonNullable<ReturnType<typeof getNextOrderAction>>['status'],
  ) => {
    if (!selectedAssignment) return;

    setUpdatingOrderId(order.id);
    try {
      if (isDemoSession) {
        // demo：直接寫進 in-memory store + 推 cross-role event 給學生 inbox
        updateDemoOrderStatus(order.id, nextStatus as Order['status']);
        if (nextStatus === 'preparing' || nextStatus === 'ready' || nextStatus === 'completed') {
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
      void import('../services/companionEngine').then((m) =>
        m.recordCompanionFeatureSignal('vendor_hub'),
      );
    } catch (error: any) {
      Alert.alert('更新失敗', error?.message ?? '請稍後再試。');
    } finally {
      setUpdatingOrderId(null);
    }
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
              <Pill text={`${summary.pending} 筆待確認`} kind="warning" />
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
              訂單列表
            </Text>
            <Button
              text={showAllOrders ? '只看待處理' : '顯示全部'}
              kind="outline"
              size="small"
              onPress={() => setShowAllOrders((value) => !value)}
            />
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
            <AnimatedCard title="目前沒有訂單" subtitle="新的訂單會出現在這裡">
              <Text style={{ color: theme.colors.muted }}>
                {showAllOrders ? '尚無任何訂單。' : '目前沒有待處理訂單。'}
              </Text>
            </AnimatedCard>
          ) : (
            filteredOrders.map((order, index) => {
              const nextAction = getNextOrderAction(order.status);
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
                          訂單 #{order.id.slice(0, 8)} · 使用者 {order.userId.slice(0, 8)}
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

                    {nextAction ? (
                      <Button
                        text={updatingOrderId === order.id ? '更新中...' : nextAction.label}
                        kind="primary"
                        disabled={updatingOrderId === order.id}
                        onPress={() => handleAdvanceOrder(order, nextAction.status)}
                      />
                    ) : (
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
