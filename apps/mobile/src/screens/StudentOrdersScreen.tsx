/**
 * Student Orders — 我的訂單（學生視角）
 *
 * 從 inbox 內 order_placed / order_status_changed 事件聚合出：
 *  - 進行中訂單（pending / processing / ready）
 *  - 已完成訂單（completed）
 *  - 推播 timeline（每次狀態變更）
 *
 * 點訂單 → 取餐位置 + 預估時間 + 推播歷史。
 * 直接從 inbox 讀，不另開資料層。
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';
import {
  loadVisibleRoleEventInbox,
  subscribeRoleEvent,
  type RoleEvent,
  type OrderPlacedPayload,
  type OrderStatusChangedPayload,
} from '../services/roleEventBus';
import { DEMO_MERCHANTS, DEMO_MERCHANT_ORDERS } from '../data/demoMerchants';
import { listDemoOrdersForStudent, subscribeDemoOrders } from '../services/demoMerchantOrders';

interface AggregatedOrder {
  orderId: string;
  merchantId: string;
  merchantName: string;
  emoji: string;
  items: string;
  total: number;
  status: 'pending' | 'processing' | 'ready' | 'completed';
  placedAt: string;
  // 推播 timeline
  events: Array<{ status: string; message?: string; at: string }>;
}

function aggregateOrders(events: RoleEvent<unknown>[]): AggregatedOrder[] {
  const map = new Map<string, AggregatedOrder>();

  // order_placed 先處理（建立 order 物件）
  for (const e of events) {
    if (e.kind !== 'order_placed') continue;
    const p = e.payload as OrderPlacedPayload;
    const merchant = DEMO_MERCHANTS.find((m) => m.id === p.merchantId);
    map.set(p.orderId, {
      orderId: p.orderId,
      merchantId: p.merchantId,
      merchantName: p.merchantName,
      emoji: merchant?.emoji ?? '🍱',
      items: p.items,
      total: p.total,
      status: 'pending',
      placedAt: e.occurredAt,
      events: [{ status: 'pending', message: '已下訂', at: e.occurredAt }],
    });
  }

  // order_status_changed 套用狀態變更
  for (const e of events) {
    if (e.kind !== 'order_status_changed') continue;
    const p = e.payload as OrderStatusChangedPayload;
    const o = map.get(p.orderId);
    if (!o) {
      // 沒對應 placed 事件（可能是 seed 直接給的 ready），建一個假的
      const merchant = DEMO_MERCHANTS.find((m) => m.name === p.merchantName);
      map.set(p.orderId, {
        orderId: p.orderId,
        merchantId: merchant?.id ?? '',
        merchantName: p.merchantName,
        emoji: merchant?.emoji ?? '🍱',
        items: '— (歷史訂單)',
        total: 0,
        status: p.newStatus as AggregatedOrder['status'],
        placedAt: e.occurredAt,
        events: [{ status: p.newStatus, message: p.message, at: e.occurredAt }],
      });
      continue;
    }
    o.status = p.newStatus as AggregatedOrder['status'];
    o.events.push({ status: p.newStatus, message: p.message, at: e.occurredAt });
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
  );
}

const STATUS_META: Record<AggregatedOrder['status'], { emoji: string; label: string; tone?: 'danger' | 'warn' | 'success' }> = {
  pending: { emoji: '🟡', label: '等待餐廳接單', tone: 'warn' },
  processing: { emoji: '🍳', label: '備餐中', tone: 'warn' },
  ready: { emoji: '✅', label: '可以取餐', tone: 'success' },
  completed: { emoji: '✔️', label: '已完成' },
};

export default function StudentOrdersScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const [events, setEvents] = useState<RoleEvent<unknown>[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<AggregatedOrder | null>(null);

  const reload = useCallback(async () => {
    if (!auth.user?.uid) return;
    const e = await loadVisibleRoleEventInbox({
      uid: auth.user.uid,
      role: auth.profile?.role,
    });
    setEvents(e);
  }, [auth.profile?.role, auth.user?.uid]);

  useEffect(() => { reload(); }, [reload]);

  // 即時訂閱新訂單狀態
  useEffect(() => {
    const unsub1 = subscribeRoleEvent('order_placed', () => reload());
    const unsub2 = subscribeRoleEvent('order_status_changed', () => reload());
    return () => { unsub1(); unsub2(); };
  }, [reload]);

  // demo 模式：把 demoMerchantOrders 內的 live + 靜態訂單一起 push 進畫面
  // 這樣 AI 助理代下單、或從 Cafeteria 下單後，學生「我的訂單」立刻看得到。
  const [demoOrders, setDemoOrders] = useState<AggregatedOrder[]>([]);
  useEffect(() => {
    if (!auth.user?.uid?.startsWith('demo_')) return;
    const refreshDemo = () => {
      const uid = auth.user!.uid!;
      const live = listDemoOrdersForStudent(uid);
      // 也把靜態 DEMO_MERCHANT_ORDERS 中 studentUid 是當前學生的訂單帶進來
      const studentStatic = DEMO_MERCHANT_ORDERS.filter((o) => o.studentUid === uid);
      const aggregated: AggregatedOrder[] = [
        ...live.map((o) => {
          const merchant = DEMO_MERCHANTS.find((m) => m.id === o.merchantId);
          return {
            orderId: o.id,
            merchantId: o.merchantId ?? 'unknown',
            merchantName: merchant?.name ?? o.merchantId ?? '校園商家',
            emoji: merchant?.emoji ?? '🍱',
            items: o.items.map((it: any) => `${it.name} ×${it.quantity}`).join('、'),
            total: o.total ?? 0,
            status: ((o.status ?? 'pending') === 'preparing'
              ? 'processing'
              : (o.status ?? 'pending')) as AggregatedOrder['status'],
            placedAt: String(o.createdAt ?? new Date().toISOString()),
            events: [
              { status: 'pending', message: '已下訂', at: String(o.createdAt ?? new Date().toISOString()) },
            ],
          };
        }),
        ...studentStatic.map((o) => {
          const merchant = DEMO_MERCHANTS.find((m) => m.id === o.merchantId);
          const st = (o.status === 'processing'
            ? 'processing'
            : (o.status as AggregatedOrder['status']));
          return {
            orderId: o.id,
            merchantId: o.merchantId,
            merchantName: merchant?.name ?? o.merchantId,
            emoji: merchant?.emoji ?? '🍱',
            items: o.items,
            total: o.total,
            status: st,
            placedAt: o.orderedAt,
            events: [{ status: st, message: '訂單建立', at: o.orderedAt }],
          };
        }),
      ];
      setDemoOrders(aggregated);
    };
    refreshDemo();
    const unsub = subscribeDemoOrders(refreshDemo);
    return () => unsub();
  }, [auth.user?.uid]);

  const aggregated = useMemo(() => aggregateOrders(events), [events]);
  const orders = useMemo(() => {
    // 用 orderId 去重，demoOrders 優先
    const map = new Map<string, AggregatedOrder>();
    for (const o of aggregated) map.set(o.orderId, o);
    for (const o of demoOrders) if (!map.has(o.orderId)) map.set(o.orderId, o);
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
    );
  }, [aggregated, demoOrders]);
  const active = orders.filter((o) => o.status !== 'completed');
  const done = orders.filter((o) => o.status === 'completed');

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const totalSpent = orders.reduce((s, o) => s + o.total, 0);
  const readyCount = orders.filter((o) => o.status === 'ready').length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow="我的訂單"
          title="🛒 校園消費"
          summary={
            active.length > 0
              ? `🟢 ${active.length} 筆進行中${readyCount > 0 ? `（${readyCount} 筆已備好可取餐）` : ''}`
              : '目前沒有進行中的訂單，從首頁推薦下訂吧'
          }
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="進行中" value={active.length} tone={active.length > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="待取餐" value={readyCount} tone={readyCount > 0 ? 'success' : undefined} />
          <CockpitMetricChip label="累計訂單" value={orders.length} />
          <CockpitMetricChip label="累計消費" value={`$${totalSpent}`} />
        </CockpitMetricRow>

        {/* 進行中 */}
        {active.length > 0 && (
          <View style={{ marginTop: theme.space.sm }}>
            <CockpitSection
              label="🔴 進行中"
              count={active.length}
              open
              onToggle={() => {}}
            >
              {active.map((o) => {
                const meta = STATUS_META[o.status];
                const ago = Math.max(0, Math.round((Date.now() - new Date(o.placedAt).getTime()) / 60_000));
                return (
                  <Pressable
                    key={o.orderId}
                    onPress={() => setSelectedOrder(o)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: theme.space.sm + 2,
                      gap: theme.space.sm,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>{o.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: theme.colors.text, fontSize: 14 }} numberOfLines={1}>
                        {o.merchantName}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {o.items}{o.total > 0 ? ` · $${o.total}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{
                        color: meta.tone === 'success' ? theme.colors.success : meta.tone === 'warn' ? theme.colors.warning : theme.colors.text,
                        fontSize: 12,
                        fontWeight: '700',
                      }}>
                        {meta.emoji} {meta.label}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>
                        {ago < 1 ? '剛剛' : `${ago} 分前`}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </CockpitSection>
          </View>
        )}

        {/* 已完成 */}
        {done.length > 0 && (
          <View style={{ marginTop: theme.space.sm }}>
            <CockpitSection
              label="📦 已完成"
              count={done.length}
              open={false}
              onToggle={() => {}}
            >
              {done.slice(0, 10).map((o) => (
                <CockpitRow
                  key={o.orderId}
                  icon={o.emoji}
                  title={o.merchantName}
                  subtitle={`${o.items}${o.total > 0 ? ` · $${o.total}` : ''} · ${new Date(o.placedAt).toLocaleDateString('zh-TW')}`}
                  onPress={() => setSelectedOrder(o)}
                />
              ))}
            </CockpitSection>
          </View>
        )}

        {/* 沒訂單時 */}
        {orders.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: theme.space.xxl }}>
            <Text style={{ fontSize: 56 }}>🛒</Text>
            <Text style={{
              color: theme.colors.text,
              fontSize: theme.typography.h3.fontSize,
              fontWeight: '600',
              marginTop: theme.space.md,
            }}>
              還沒有訂單
            </Text>
            <Text style={{
              color: theme.colors.muted,
              fontSize: 12,
              textAlign: 'center',
              marginTop: theme.space.xs,
              lineHeight: 18,
            }}>
              回到首頁「下一餐 AI 建議」一鍵下訂{'\n'}
              demo 場景下訂後切到餐廳帳號看推進，{'\n'}
              訂單狀態變化會即時 push 到這裡。
            </Text>
          </View>
        )}

        {/* 訂單詳情 modal */}
        {selectedOrder && (
          <View
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              alignItems: 'center',
              justifyContent: 'center',
              padding: theme.space.lg,
            }}
          >
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.xl,
                padding: theme.space.lg,
                width: '100%',
                maxWidth: 420,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md }}>
                <Text style={{ fontSize: 32 }}>{selectedOrder.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>
                    {selectedOrder.merchantName}
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                    訂單 #{selectedOrder.orderId.slice(-6)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSelectedOrder(null)}
                  hitSlop={20}
                >
                  <Ionicons name="close" size={20} color={theme.colors.muted} />
                </Pressable>
              </View>

              <View
                style={{
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceMuted,
                  marginBottom: theme.space.md,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>內容</Text>
                <Text style={{ fontSize: 14, color: theme.colors.text, marginBottom: 6 }}>
                  {selectedOrder.items}
                </Text>
                {selectedOrder.total > 0 && (
                  <Text style={{ fontSize: 14, color: theme.colors.text, fontWeight: '700' }}>
                    總計 ${selectedOrder.total}
                  </Text>
                )}
              </View>

              <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: theme.space.xs, letterSpacing: 0.3 }}>
                狀態 TIMELINE
              </Text>
              {selectedOrder.events.map((evt, i) => {
                const meta = STATUS_META[evt.status as AggregatedOrder['status']] ?? { emoji: '🔔', label: evt.status };
                const ago = Math.max(0, Math.round((Date.now() - new Date(evt.at).getTime()) / 60_000));
                return (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      gap: theme.space.sm,
                      paddingVertical: theme.space.xs + 2,
                      borderBottomWidth: i < selectedOrder.events.length - 1 ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{meta.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, color: theme.colors.text, fontWeight: '600' }}>
                        {meta.label}
                      </Text>
                      {evt.message ? (
                        <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 2 }}>
                          {evt.message}
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 10, color: theme.colors.muted, marginTop: 2 }}>
                        {ago < 1 ? '剛剛' : `${ago} 分鐘前`}
                      </Text>
                    </View>
                  </View>
                );
              })}

              {selectedOrder.status === 'ready' && (
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      '取餐位置',
                      `${selectedOrder.merchantName}\n${DEMO_MERCHANTS.find((m) => m.id === selectedOrder.merchantId)?.location ?? '位置 demo'}`,
                    );
                  }}
                  style={({ pressed }) => ({
                    marginTop: theme.space.md,
                    padding: theme.space.md,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.accent,
                    alignItems: 'center',
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>
                    📍 看取餐位置
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
