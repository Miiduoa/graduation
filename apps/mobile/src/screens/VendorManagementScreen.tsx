/* eslint-disable */
/**
 * 店家老闆管理系統 — 靜宜大學校園餐廳
 *
 * 功能：
 *   店家老闆用以管理訂單、菜單、評價、營業狀態、查看統計等
 *
 * 角色：店家老闆（Vendor Owner）
 */

import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, Screen, SectionTitle, Pill } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import {
  getVendors,
  getVendor,
  getMenuItems,
  getMenuItemsAsync,
  addMenuItem,
  updateMenuItem as updateMenuItemData,
  deleteMenuItem as deleteMenuItemData,
  getReviews,
  getOrders,
  updateOrderStatus,
  subscribeOrders,
  setOrderSchoolId,
  estimateWaitTime,
  isVendorCurrentlyOpen,
  getFlashDeals,
  createFlashDeal,
  VENDORS,
  CATEGORY_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  SAMPLE_MENUS,
  SAMPLE_REVIEWS,
  type Vendor,
  type MenuItem,
  type MenuOption,
  type Order,
  type OrderStatus,
  type Review,
  type FlashDeal,
} from '../services/cafeteriaData';

// ══════════════════════════════════════════════════
// 主畫面
// ══════════════════════════════════════════════════

export function VendorManagementScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();

  // 找到當前使用者擁有的店家（透過 ownerUid 匹配），找不到時示範用第一間
  const myVendor = useMemo(() => {
    const uid = auth.profile?.uid ?? auth.user?.uid;
    if (uid) {
      const owned = VENDORS.find((v) => v.ownerUid === uid);
      if (owned) return owned;
    }
    return VENDORS[0]; // demo fallback
  }, [auth.profile?.uid, auth.user?.uid]);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'menu' | 'reviews' | 'stats'>(
    'dashboard',
  );
  const [isOpen, setIsOpen] = useState(myVendor?.isOpen ?? true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [vendorOrders, setVendorOrders] = useState<Order[]>([]);
  const [vendorReviews, setVendorReviews] = useState<Review[]>([]);

  // 即時訂閱本店訂單（Firestore onSnapshot）
  const unsubOrdersRef = useRef<ReturnType<typeof subscribeOrders>>(null);

  const loadOrders = useCallback(async () => {
    try {
      const orders = await getOrders(undefined, myVendor.id);
      setVendorOrders(orders);
    } catch {
      /* ignore */
    }
  }, [myVendor.id]);

  // 載入本店評價
  const loadReviews = useCallback(async () => {
    try {
      const reviews = await getReviews(myVendor.id);
      setVendorReviews(reviews);
    } catch {
      /* ignore */
    }
  }, [myVendor.id]);

  useEffect(() => {
    // 設定 schoolId 以便 Firestore 查詢
    setOrderSchoolId('pu'); // 靜宜大學

    // 嘗試 real-time 訂閱；若失敗就 fallback 一次性 getOrders
    const unsub = subscribeOrders(
      { vendorId: myVendor.id },
      (orders) => setVendorOrders(orders),
    );
    unsubOrdersRef.current = unsub;

    if (!unsub) {
      // Firestore 不可用，退回手動載入
      loadOrders();
    }

    loadReviews();

    return () => {
      unsubOrdersRef.current?.();
    };
  }, [myVendor.id, loadOrders, loadReviews]);

  // 訂單統計
  const orderStats = useMemo(() => {
    return {
      pending: vendorOrders.filter((o) => o.status === 'pending').length,
      confirmed: vendorOrders.filter((o) => o.status === 'confirmed').length,
      preparing: vendorOrders.filter((o) => o.status === 'preparing').length,
      ready: vendorOrders.filter((o) => o.status === 'ready').length,
      completed: vendorOrders.filter((o) => o.status === 'completed').length,
      total: vendorOrders.length,
      revenue: vendorOrders.reduce((sum, o) => sum + o.totalPrice, 0),
      avgOrder:
        vendorOrders.length > 0
          ? Math.round(vendorOrders.reduce((sum, o) => sum + o.totalPrice, 0) / vendorOrders.length)
          : 0,
    };
  }, [vendorOrders]);

  // 菜單項目（async 載入，支援店家自訂覆蓋）
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => SAMPLE_MENUS[myVendor.id] ?? []);

  const loadMenu = useCallback(async () => {
    try {
      const items = await getMenuItemsAsync(myVendor.id);
      setMenuItems(items);
    } catch {
      /* ignore */
    }
  }, [myVendor.id]);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  const avgRating =
    vendorReviews.length > 0
      ? (vendorReviews.reduce((sum, r) => sum + r.rating, 0) / vendorReviews.length).toFixed(1)
      : '未評';

  // 處理訂單狀態更新（若有即時訂閱會自動更新，否則手動 reload）
  const handleUpdateOrderStatus = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      try {
        await updateOrderStatus(orderId, newStatus);
        Alert.alert('成功', `訂單已更新為 ${ORDER_STATUS_LABELS[newStatus]}`);
        // 若無 real-time 訂閱才手動 reload
        if (!unsubOrdersRef.current) {
          await loadOrders();
        }
      } catch (e) {
        Alert.alert('錯誤', '更新訂單狀態失敗');
      }
    },
    [loadOrders],
  );

  const handleToggleOpen = useCallback(() => {
    setIsOpen(!isOpen);
    Alert.alert(
      '營業狀態已更改',
      !isOpen ? '您的店家現在接受新訂單' : '您的店家現在暫停接受新訂單',
    );
  }, [isOpen]);

  return (
    <Screen noPadding>
      {/* 標題欄 */}
      <View
        style={{
          padding: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <View>
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 22 }}>
              {myVendor.name}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              店家管理系統
            </Text>
          </View>
          <Pressable
            onPress={() => nav?.goBack?.()}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={20} color={theme.colors.text} />
          </Pressable>
        </View>

        {/* 營業狀態切換 */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 10,
            borderRadius: 10,
            backgroundColor: isOpen ? `${theme.colors.success}10` : `${theme.colors.danger}10`,
            borderWidth: 1,
            borderColor: isOpen ? `${theme.colors.success}30` : `${theme.colors.danger}30`,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons
              name={isOpen ? 'checkmark-circle' : 'close-circle'}
              size={18}
              color={isOpen ? theme.colors.success : theme.colors.danger}
            />
            <View>
              <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                {isOpen ? '營業中' : '暫停營業'}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>點擊切換營業狀態</Text>
            </View>
          </View>
          <Switch value={isOpen} onValueChange={handleToggleOpen} />
        </View>
      </View>

      {/* 分頁標籤 */}
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        {(['dashboard', 'orders', 'menu', 'reviews', 'stats'] as const).map((tab) => {
          const labels: Record<typeof tab, string> = {
            dashboard: '儀表板',
            orders: '訂單',
            menu: '菜單',
            reviews: '評價',
            stats: '統計',
          };
          const icons: Record<typeof tab, keyof typeof Ionicons.glyphMap> = {
            dashboard: 'home-outline',
            orders: 'receipt-outline',
            menu: 'document-outline',
            reviews: 'star-outline',
            stats: 'bar-chart-outline',
          };
          const isActive = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={{
                flex: 1,
                paddingVertical: 12,
                alignItems: 'center',
                borderBottomWidth: isActive ? 3 : 0,
                borderBottomColor: isActive ? theme.colors.accent : 'transparent',
              }}
            >
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Ionicons
                  name={icons[tab]}
                  size={18}
                  color={isActive ? theme.colors.accent : theme.colors.muted}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: isActive ? '600' : '400',
                    color: isActive ? theme.colors.accent : theme.colors.muted,
                  }}
                >
                  {labels[tab]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 內容區域 */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {activeTab === 'dashboard' && (
          <DashboardTab
            vendor={myVendor}
            orderStats={orderStats}
            reviews={vendorReviews}
            avgRating={avgRating}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersTab
            orders={vendorOrders}
            onSelectOrder={setSelectedOrder}
            onUpdateStatus={handleUpdateOrderStatus}
            onShowCancel={setShowCancelModal}
          />
        )}
        {activeTab === 'menu' && (
          <MenuTab vendorId={myVendor.id} menuItems={menuItems} onRefresh={loadMenu} />
        )}
        {activeTab === 'reviews' && <ReviewsTab reviews={vendorReviews} avgRating={avgRating} />}
        {activeTab === 'stats' && (
          <StatsTab vendor={myVendor} orders={vendorOrders} reviews={vendorReviews} />
        )}
      </ScrollView>

      {/* 取消訂單 Modal */}
      {showCancelModal && selectedOrder && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setShowCancelModal(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: '#00000060',
              justifyContent: 'flex-end',
            }}
          >
            <View
              style={{
                backgroundColor: theme.colors.background,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 20,
                paddingBottom: 30,
              }}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: '700',
                  fontSize: 16,
                  marginBottom: 12,
                }}
              >
                取消訂單 #{selectedOrder.id}
              </Text>
              <TextInput
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="輸入取消原因（可選）"
                placeholderTextColor={theme.colors.muted}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 10,
                  padding: 12,
                  color: theme.colors.text,
                  marginBottom: 16,
                  minHeight: 80,
                  textAlignVertical: 'top',
                }}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => setShowCancelModal(false)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    backgroundColor: theme.colors.surface,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>返回</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    handleUpdateOrderStatus(selectedOrder.id, 'cancelled');
                    setShowCancelModal(false);
                    setCancelReason('');
                    setSelectedOrder(null);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    backgroundColor: theme.colors.danger,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>確認取消</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </Screen>
  );
}

// ══════════════════════════════════════════════════
// 儀表板分頁
// ══════════════════════════════════════════════════

function DashboardTab(props: {
  vendor: Vendor;
  orderStats: Record<string, number>;
  reviews: Review[];
  avgRating: string;
}) {
  const { vendor, orderStats, reviews, avgRating } = props;

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* 概況卡片 */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>
              今日訂單
            </Text>
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 20 }}>
              {orderStats.total}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>
              共 {orderStats.total} 筆訂單
            </Text>
          </View>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 14,
              backgroundColor: `${theme.colors.success}10`,
              borderWidth: 1,
              borderColor: `${theme.colors.success}30`,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>
              今日營收
            </Text>
            <Text style={{ color: theme.colors.success, fontWeight: '800', fontSize: 20 }}>
              NT${orderStats.revenue}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>
              平均 ${orderStats.avgOrder}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 14,
              backgroundColor: `${theme.colors.accent}10`,
              borderWidth: 1,
              borderColor: `${theme.colors.accent}30`,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>
              平均評分
            </Text>
            <Text style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 20 }}>
              {avgRating}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>
              {reviews.length} 則評價
            </Text>
          </View>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 14,
              backgroundColor: `${'#F59E0B'}10`,
              borderWidth: 1,
              borderColor: `${'#F59E0B'}30`,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 6 }}>待處理</Text>
            <Text style={{ color: '#F59E0B', fontWeight: '800', fontSize: 20 }}>
              {orderStats.pending + orderStats.confirmed}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>
              {orderStats.pending} 待確認
            </Text>
          </View>
        </View>
      </View>

      {/* 訂單狀態分佈 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="訂單狀態分佈" />
        <View style={{ gap: 8 }}>
          {(['pending', 'confirmed', 'preparing', 'ready'] as const).map((status) => (
            <View
              key={status}
              style={{
                padding: 12,
                borderRadius: 10,
                backgroundColor: theme.colors.surface2,
                borderLeftWidth: 4,
                borderLeftColor: ORDER_STATUS_COLORS[status],
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '500', fontSize: 13 }}>
                {ORDER_STATUS_LABELS[status]}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: ORDER_STATUS_COLORS[status] + '20',
                  }}
                >
                  <Text
                    style={{
                      color: ORDER_STATUS_COLORS[status],
                      fontWeight: '700',
                      fontSize: 14,
                    }}
                  >
                    {orderStats[status]}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 快速操作 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="快速操作" />
        <Pressable
          style={{
            padding: 12,
            borderRadius: 10,
            backgroundColor: theme.colors.surface2,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${theme.colors.accent}10`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="document-outline" size={18} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              查看菜單
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>管理菜單可用性</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 訂單管理分頁
// ══════════════════════════════════════════════════

function OrdersTab(props: {
  orders: Order[];
  onSelectOrder: (order: Order) => void;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onShowCancel: (show: boolean) => void;
}) {
  const { orders, onSelectOrder, onUpdateStatus, onShowCancel } = props;

  const groupedOrders = useMemo(() => {
    return {
      pending: orders.filter((o) => o.status === 'pending'),
      confirmed: orders.filter((o) => o.status === 'confirmed'),
      preparing: orders.filter((o) => o.status === 'preparing'),
      ready: orders.filter((o) => o.status === 'ready'),
      completed: orders.filter((o) => o.status === 'completed'),
    };
  }, [orders]);

  return (
    <View style={{ paddingVertical: 16 }}>
      {/* 待確認訂單 - 優先顯示 */}
      {groupedOrders.pending.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ marginBottom: 10 }}>
            <SectionTitle text={`待確認訂單 (${groupedOrders.pending.length})`} />
          </View>
          <View style={{ gap: 8 }}>
            {groupedOrders.pending.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onAccept={() => onUpdateStatus(order.id, 'confirmed')}
                onCancel={() => {
                  onSelectOrder(order);
                  onShowCancel(true);
                }}
              />
            ))}
          </View>
        </View>
      )}

      {/* 已確認訂單 */}
      {groupedOrders.confirmed.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ marginBottom: 10 }}>
            <SectionTitle text={`已確認訂單 (${groupedOrders.confirmed.length})`} />
          </View>
          <View style={{ gap: 8 }}>
            {groupedOrders.confirmed.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onAccept={() => onUpdateStatus(order.id, 'preparing')}
                actionLabel="開始製作"
              />
            ))}
          </View>
        </View>
      )}

      {/* 製作中訂單 */}
      {groupedOrders.preparing.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ marginBottom: 10 }}>
            <SectionTitle text={`製作中訂單 (${groupedOrders.preparing.length})`} />
          </View>
          <View style={{ gap: 8 }}>
            {groupedOrders.preparing.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onAccept={() => onUpdateStatus(order.id, 'ready')}
                actionLabel="準備完成"
              />
            ))}
          </View>
        </View>
      )}

      {/* 可取餐訂單 */}
      {groupedOrders.ready.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ marginBottom: 10 }}>
            <SectionTitle text={`可取餐訂單 (${groupedOrders.ready.length})`} />
          </View>
          <View style={{ gap: 8 }}>
            {groupedOrders.ready.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onAccept={() => onUpdateStatus(order.id, 'completed')}
                actionLabel="已取餐"
              />
            ))}
          </View>
        </View>
      )}

      {/* 已完成訂單 */}
      {groupedOrders.completed.length > 0 && (
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{ marginBottom: 10 }}>
            <SectionTitle text={`已完成訂單 (${groupedOrders.completed.length})`} />
          </View>
          <View style={{ gap: 8 }}>
            {groupedOrders.completed.map((order) => (
              <OrderCard key={order.id} order={order} isCompleted />
            ))}
          </View>
        </View>
      )}

      {orders.length === 0 && (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Ionicons name="happy-outline" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12 }}>
            目前沒有訂單
          </Text>
        </View>
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════
// 訂單卡片
// ══════════════════════════════════════════════════

function OrderCard(props: {
  order: Order;
  onAccept?: () => void;
  onCancel?: () => void;
  actionLabel?: string;
  isCompleted?: boolean;
}) {
  const { order, onAccept, onCancel, actionLabel = '確認訂單', isCompleted } = props;

  const createdTime = new Date(order.createdAt);
  const timeAgo = Math.round((Date.now() - createdTime.getTime()) / 60000);

  return (
    <View
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 4,
        borderLeftColor: ORDER_STATUS_COLORS[order.status],
      }}
    >
      {/* 標題行 */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
            訂單 #{order.id.slice(-4).toUpperCase()}
          </Text>
          {order.queueNumber && (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: `${ORDER_STATUS_COLORS[order.status]}20`,
              }}
            >
              <Text
                style={{
                  color: ORDER_STATUS_COLORS[order.status],
                  fontSize: 11,
                  fontWeight: '600',
                }}
              >
                號碼 {order.queueNumber}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
          {timeAgo < 1 ? '剛才' : `${timeAgo} 分鐘前`}
        </Text>
      </View>

      {/* 狀態和金額 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: ORDER_STATUS_COLORS[order.status],
            }}
          />
          <Text
            style={{ color: ORDER_STATUS_COLORS[order.status], fontWeight: '600', fontSize: 12 }}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </Text>
        </View>
        <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
          NT$ {order.totalPrice}
        </Text>
      </View>

      {/* 品項 */}
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: 8,
          padding: 8,
          marginBottom: 8,
        }}
      >
        {order.items.map((item, idx) => (
          <View key={idx} style={{ marginBottom: idx === order.items.length - 1 ? 0 : 6 }}>
            <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '500' }}>
              {item.menuItemName} × {item.quantity}
            </Text>
            {item.selectedOptions.length > 0 && (
              <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>
                {item.selectedOptions.map((opt) => `${opt.optionName}: ${opt.choice}`).join(' / ')}
              </Text>
            )}
          </View>
        ))}
      </View>

      {/* 備註 */}
      {order.note && (
        <View
          style={{
            marginBottom: 8,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>備註：{order.note}</Text>
        </View>
      )}

      {/* 操作按鈕 */}
      {!isCompleted && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {onAccept && (
            <Pressable
              onPress={onAccept}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: theme.colors.accent,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>{actionLabel}</Text>
            </Pressable>
          )}
          {onCancel && (
            <Pressable
              onPress={onCancel}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.colors.danger, fontWeight: '600', fontSize: 12 }}>
                取消訂單
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════
// 菜單管理分頁（完整 CRUD）
// ══════════════════════════════════════════════════

function MenuTab(props: { vendorId: string; menuItems: MenuItem[]; onRefresh: () => void }) {
  const { vendorId, menuItems, onRefresh } = props;

  const groupedByCategory = useMemo(() => {
    const groups: Record<string, MenuItem[]> = {};
    menuItems.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }, [menuItems]);

  // ── 編輯 / 新增 Modal 狀態 ──
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null); // null = 新增模式
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formCalories, setFormCalories] = useState('');
  const [formAllergens, setFormAllergens] = useState('');
  const [formIsPopular, setFormIsPopular] = useState(false);
  const [formIsAvailable, setFormIsAvailable] = useState(true);

  // 快閃折扣
  const [showFlashDeal, setShowFlashDeal] = useState(false);
  const [flashItem, setFlashItem] = useState<MenuItem | null>(null);
  const [flashPrice, setFlashPrice] = useState('');
  const [flashQty, setFlashQty] = useState('5');
  const [flashReason, setFlashReason] = useState('即將打烊');
  const [flashHours, setFlashHours] = useState('2');

  const openNewItem = useCallback(() => {
    setEditingItem(null);
    setFormName('');
    setFormDesc('');
    setFormPrice('');
    setFormCategory('');
    setFormCalories('');
    setFormAllergens('');
    setFormIsPopular(false);
    setFormIsAvailable(true);
    setShowEditor(true);
  }, []);

  const openEditItem = useCallback((item: MenuItem) => {
    setEditingItem(item);
    setFormName(item.name);
    setFormDesc(item.description);
    setFormPrice(item.price.toString());
    setFormCategory(item.category);
    setFormCalories(item.calories?.toString() ?? '');
    setFormAllergens(item.allergens.join('、'));
    setFormIsPopular(item.isPopular);
    setFormIsAvailable(item.isAvailable);
    setShowEditor(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formName.trim() || !formPrice.trim()) {
      Alert.alert('錯誤', '品項名稱和價格為必填');
      return;
    }
    const price = parseInt(formPrice, 10);
    if (isNaN(price) || price < 0) {
      Alert.alert('錯誤', '請輸入正確的價格');
      return;
    }
    const allergens = formAllergens.trim() ? formAllergens.split(/[、,，\s]+/).filter(Boolean) : [];
    const calories = formCalories.trim() ? parseInt(formCalories, 10) : null;

    try {
      if (editingItem) {
        await updateMenuItemData(vendorId, editingItem.id, {
          name: formName.trim(),
          description: formDesc.trim(),
          price,
          category: formCategory.trim() || '其他',
          calories: calories && !isNaN(calories) ? calories : null,
          allergens,
          isPopular: formIsPopular,
          isAvailable: formIsAvailable,
        });
        Alert.alert('成功', '品項已更新');
      } else {
        await addMenuItem(vendorId, {
          name: formName.trim(),
          description: formDesc.trim(),
          price,
          category: formCategory.trim() || '其他',
          imageUrl: null,
          isAvailable: formIsAvailable,
          isPopular: formIsPopular,
          allergens,
          calories: calories && !isNaN(calories) ? calories : null,
          options: [],
        });
        Alert.alert('成功', '新品項已新增');
      }
      setShowEditor(false);
      onRefresh();
    } catch {
      Alert.alert('錯誤', '儲存失敗');
    }
  }, [
    vendorId,
    editingItem,
    formName,
    formDesc,
    formPrice,
    formCategory,
    formCalories,
    formAllergens,
    formIsPopular,
    formIsAvailable,
    onRefresh,
  ]);

  const handleDelete = useCallback(
    (item: MenuItem) => {
      Alert.alert('確認刪除', `確定要刪除「${item.name}」嗎？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            await deleteMenuItemData(vendorId, item.id);
            onRefresh();
          },
        },
      ]);
    },
    [vendorId, onRefresh],
  );

  const handleToggleAvailability = useCallback(
    async (item: MenuItem) => {
      await updateMenuItemData(vendorId, item.id, { isAvailable: !item.isAvailable });
      onRefresh();
    },
    [vendorId, onRefresh],
  );

  // 快閃折扣
  const openFlashDeal = useCallback((item: MenuItem) => {
    setFlashItem(item);
    setFlashPrice(Math.round(item.price * 0.7).toString());
    setFlashQty('5');
    setFlashReason('即將打烊');
    setFlashHours('2');
    setShowFlashDeal(true);
  }, []);

  const handleCreateFlashDeal = useCallback(async () => {
    if (!flashItem) return;
    const dp = parseInt(flashPrice, 10);
    const qty = parseInt(flashQty, 10);
    const hrs = parseInt(flashHours, 10);
    if (isNaN(dp) || isNaN(qty) || isNaN(hrs)) {
      Alert.alert('錯誤', '請輸入正確的數字');
      return;
    }
    const expires = new Date();
    expires.setHours(expires.getHours() + hrs);
    await createFlashDeal({
      vendorId,
      menuItemId: flashItem.id,
      menuItemName: flashItem.name,
      originalPrice: flashItem.price,
      discountPrice: dp,
      remainingQty: qty,
      reason: flashReason,
      expiresAt: expires.toISOString(),
    });
    Alert.alert('成功', `「${flashItem.name}」快閃折扣已發布！`);
    setShowFlashDeal(false);
  }, [vendorId, flashItem, flashPrice, flashQty, flashReason, flashHours]);

  return (
    <View style={{ paddingVertical: 16 }}>
      {/* 操作列 */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16, flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={openNewItem}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: theme.colors.accent,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Ionicons name="add-circle-outline" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>新增品項</Text>
        </Pressable>
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>
            共 {menuItems.length} 項
          </Text>
        </View>
      </View>

      {/* 菜單列表（按分類） */}
      {Object.entries(groupedByCategory).map(([category, items]) => (
        <View key={category} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ marginBottom: 10 }}>
            <SectionTitle text={category} />
          </View>
          <View style={{ gap: 8 }}>
            {items.map((item) => (
              <View
                key={item.id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: item.isAvailable ? theme.colors.border : `${theme.colors.danger}30`,
                  opacity: item.isAvailable ? 1 : 0.7,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                        {item.name}
                      </Text>
                      {item.isPopular && (
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 4,
                            backgroundColor: '#F59E0B20',
                          }}
                        >
                          <Text style={{ color: '#F59E0B', fontSize: 9, fontWeight: '600' }}>
                            熱門
                          </Text>
                        </View>
                      )}
                      {!item.isAvailable && (
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 4,
                            backgroundColor: `${theme.colors.danger}20`,
                          }}
                        >
                          <Text
                            style={{ color: theme.colors.danger, fontSize: 9, fontWeight: '600' }}
                          >
                            已下架
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginBottom: 4 }}>
                      {item.description}
                    </Text>
                    {item.allergens.length > 0 && (
                      <Text style={{ color: '#F59E0B', fontSize: 10, marginBottom: 4 }}>
                        過敏原：{item.allergens.join('、')}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 14 }}>
                        NT${item.price}
                      </Text>
                      {item.calories != null && (
                        <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                          {item.calories} kcal
                        </Text>
                      )}
                    </View>
                  </View>
                  <Switch
                    value={item.isAvailable}
                    onValueChange={() => handleToggleAvailability(item)}
                    trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                  />
                </View>
                {/* 操作按鈕列 */}
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 10,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                    paddingTop: 10,
                  }}
                >
                  <Pressable
                    onPress={() => openEditItem(item)}
                    style={{
                      flex: 1,
                      paddingVertical: 7,
                      borderRadius: 8,
                      backgroundColor: `${theme.colors.accent}10`,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <Ionicons name="create-outline" size={14} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '600' }}>
                      編輯
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openFlashDeal(item)}
                    style={{
                      flex: 1,
                      paddingVertical: 7,
                      borderRadius: 8,
                      backgroundColor: '#F59E0B10',
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <Ionicons name="flash-outline" size={14} color="#F59E0B" />
                    <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '600' }}>
                      快閃折扣
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(item)}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      backgroundColor: `${theme.colors.danger}10`,
                      alignItems: 'center',
                      flexDirection: 'row',
                      gap: 4,
                    }}
                  >
                    <Ionicons name="trash-outline" size={14} color={theme.colors.danger} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}

      {menuItems.length === 0 && (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Ionicons name="document-outline" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12 }}>
            目前沒有菜單項目
          </Text>
          <Pressable
            onPress={openNewItem}
            style={{
              marginTop: 12,
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 8,
              backgroundColor: theme.colors.accent,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>新增第一個品項</Text>
          </Pressable>
        </View>
      )}

      {/* ═══ 新增 / 編輯 Modal ═══ */}
      <Modal
        visible={showEditor}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditor(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#00000060', justifyContent: 'flex-end' }}>
          <ScrollView
            style={{
              maxHeight: '85%',
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text
              style={{
                color: theme.colors.text,
                fontWeight: '700',
                fontSize: 18,
                marginBottom: 16,
              }}
            >
              {editingItem ? '編輯品項' : '新增品項'}
            </Text>

            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
              品項名稱 *
            </Text>
            <TextInput
              value={formName}
              onChangeText={setFormName}
              placeholder="例如：雞腿飯"
              placeholderTextColor={theme.colors.muted}
              style={editorInputStyle}
            />

            <Text
              style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4, marginTop: 12 }}
            >
              描述
            </Text>
            <TextInput
              value={formDesc}
              onChangeText={setFormDesc}
              placeholder="例如：滷雞腿附三配菜"
              placeholderTextColor={theme.colors.muted}
              style={editorInputStyle}
              multiline
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                  價格 (NT$) *
                </Text>
                <TextInput
                  value={formPrice}
                  onChangeText={setFormPrice}
                  placeholder="65"
                  placeholderTextColor={theme.colors.muted}
                  style={editorInputStyle}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                  分類
                </Text>
                <TextInput
                  value={formCategory}
                  onChangeText={setFormCategory}
                  placeholder="主食"
                  placeholderTextColor={theme.colors.muted}
                  style={editorInputStyle}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                  熱量 (kcal)
                </Text>
                <TextInput
                  value={formCalories}
                  onChangeText={setFormCalories}
                  placeholder="選填"
                  placeholderTextColor={theme.colors.muted}
                  style={editorInputStyle}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                  過敏原
                </Text>
                <TextInput
                  value={formAllergens}
                  onChangeText={setFormAllergens}
                  placeholder="蛋、奶、麩質"
                  placeholderTextColor={theme.colors.muted}
                  style={editorInputStyle}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 20, marginTop: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Switch value={formIsPopular} onValueChange={setFormIsPopular} />
                <Text style={{ color: theme.colors.text, fontSize: 13 }}>標記熱門</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Switch value={formIsAvailable} onValueChange={setFormIsAvailable} />
                <Text style={{ color: theme.colors.text, fontSize: 13 }}>上架中</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable
                onPress={() => setShowEditor(false)}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 10,
                  backgroundColor: theme.colors.surface,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 10,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {editingItem ? '儲存修改' : '新增品項'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ═══ 快閃折扣 Modal ═══ */}
      <Modal
        visible={showFlashDeal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFlashDeal(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#00000060', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              paddingBottom: 40,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Ionicons name="flash" size={22} color="#F59E0B" />
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 18 }}>
                發布惜食快閃折扣
              </Text>
            </View>

            {flashItem && (
              <View
                style={{
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: theme.colors.surface2,
                  marginBottom: 16,
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 14 }}>
                  {flashItem.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  原價 NT${flashItem.price}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                  折扣價 (NT$)
                </Text>
                <TextInput
                  value={flashPrice}
                  onChangeText={setFlashPrice}
                  style={editorInputStyle}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
                  限量份數
                </Text>
                <TextInput
                  value={flashQty}
                  onChangeText={setFlashQty}
                  style={editorInputStyle}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>原因</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {['即將打烊', '剩餘食材', '限時優惠', '新品試賣'].map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setFlashReason(r)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor:
                      flashReason === r ? theme.colors.accent : theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: flashReason === r ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: flashReason === r ? '#fff' : theme.colors.text,
                      fontSize: 12,
                      fontWeight: '500',
                    }}
                  >
                    {r}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
              有效時間（小時）
            </Text>
            <TextInput
              value={flashHours}
              onChangeText={setFlashHours}
              style={editorInputStyle}
              keyboardType="number-pad"
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable
                onPress={() => setShowFlashDeal(false)}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 10,
                  backgroundColor: theme.colors.surface,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateFlashDeal}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 10,
                  backgroundColor: '#F59E0B',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>發布折扣</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const editorInputStyle = {
  borderWidth: 1,
  borderColor: theme.colors.border,
  borderRadius: 10,
  padding: 12,
  color: theme.colors.text,
  fontSize: 14,
  backgroundColor: theme.colors.surface2,
} as const;

// ══════════════════════════════════════════════════
// 評價檢視分頁
// ══════════════════════════════════════════════════

function ReviewsTab(props: { reviews: Review[]; avgRating: string }) {
  const { reviews, avgRating } = props;

  const ratingBreakdown = useMemo(() => {
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>;
    reviews.forEach((r) => {
      breakdown[r.rating]++;
    });
    return breakdown;
  }, [reviews]);

  return (
    <View style={{ paddingVertical: 16 }}>
      {/* 評分概況 */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <View
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Ionicons name="star" size={24} color="#F59E0B" />
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 28 }}>
              {avgRating}
            </Text>
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            基於 {reviews.length} 則評價
          </Text>

          {/* 評分分佈 */}
          <View style={{ marginTop: 12, width: '100%' }}>
            {[5, 4, 3, 2, 1].map((rating) => (
              <View
                key={rating}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}
              >
                <View style={{ width: 50 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{rating} 星</Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.surface,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      width: `${(ratingBreakdown[rating] / reviews.length) * 100}%`,
                      backgroundColor: '#F59E0B',
                    }}
                  />
                </View>
                <Text
                  style={{ color: theme.colors.muted, fontSize: 11, width: 30, textAlign: 'right' }}
                >
                  {ratingBreakdown[rating]}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 評價列表 */}
      <View style={{ paddingHorizontal: 16 }}>
        <SectionTitle text="所有評價" />
        <View style={{ gap: 8 }}>
          {reviews.map((review) => (
            <View
              key={review.id}
              style={{
                padding: 12,
                borderRadius: 12,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
                  {review.studentName}
                </Text>
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  {Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <Ionicons
                        key={i}
                        name="star"
                        size={14}
                        color={i < review.rating ? '#F59E0B' : theme.colors.border}
                      />
                    ))}
                </View>
              </View>
              <Text
                style={{ color: theme.colors.text, fontSize: 12, lineHeight: 18, marginBottom: 8 }}
              >
                {review.comment}
              </Text>
              {review.tags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {review.tags.map((tag) => (
                    <View
                      key={tag}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 6,
                        backgroundColor: `${theme.colors.accent}10`,
                      }}
                    >
                      <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: '500' }}>
                        {tag}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                {new Date(review.createdAt).toLocaleDateString('zh-TW')}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {reviews.length === 0 && (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Ionicons name="star-outline" size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12 }}>
            目前沒有評價
          </Text>
        </View>
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════
// 統計分頁
// ══════════════════════════════════════════════════

function StatsTab(props: { vendor: Vendor; orders: Order[]; reviews: Review[] }) {
  const { vendor, orders, reviews } = props;

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalPrice, 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const avgRating =
      reviews.length > 0
        ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
        : '未評';
    const completedOrders = orders.filter((o) => o.status === 'completed').length;
    const peakHour = orders.length > 0 ? new Date(orders[0].createdAt).getHours() : '未知';

    return {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      avgRating,
      completedOrders,
      peakHour,
      reviewCount: reviews.length,
    };
  }, [orders, reviews]);

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* 統計卡片網格 */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatCard label="總訂單數" value={stats.totalOrders.toString()} icon="receipt-outline" />
          <StatCard label="總營收" value={`NT$${stats.totalRevenue}`} icon="cash-outline" />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatCard
            label="平均訂單額"
            value={`NT$${stats.avgOrderValue}`}
            icon="trending-up-outline"
          />
          <StatCard label="平均評分" value={stats.avgRating} icon="star-outline" />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatCard
            label="已完成訂單"
            value={stats.completedOrders.toString()}
            icon="checkmark-circle-outline"
          />
          <StatCard label="評價數" value={stats.reviewCount.toString()} icon="chatbox-outline" />
        </View>
      </View>

      {/* 詳細統計 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="店家資訊" />
        <View
          style={{
            padding: 12,
            borderRadius: 12,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>店家名稱</Text>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
              {vendor.name}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>分類</Text>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
              {CATEGORY_LABELS[vendor.category]}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>營業時間</Text>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
              {vendor.openTime}~{vendor.closeTime}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>攤位號碼</Text>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>
              {vendor.floor} {vendor.stallNumber}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 統計卡片
// ══════════════════════════════════════════════════

function StatCard(props: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { label, value, icon } = props;

  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color={theme.colors.accent} style={{ marginBottom: 6 }} />
      <Text style={{ color: theme.colors.muted, fontSize: 10, marginBottom: 4 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>{value}</Text>
    </View>
  );
}
