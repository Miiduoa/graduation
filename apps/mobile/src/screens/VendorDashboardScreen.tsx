/**
 * Vendor Dashboard — 餐廳員工今日駕駛艙
 *
 * 員工 ↔ 店家綁定：
 *  - 從 useMerchantContext 拿當下要管理的店家
 *  - 多個 assignment 時頂端顯示 merchant switcher
 *  - 依角色 (owner/manager/staff) 顯示不同操作
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  ScrollView,
  View,
  LayoutAnimation,
  Platform,
  UIManager,
  Pressable,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
  CockpitToolChip,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';
import { safeNavigate } from '../utils/safeNavigate';
import { aiVendorNextAction } from '../services/aiOrchestrator';
import { useMerchantContext } from '../hooks/useMerchantContext';
import {
  getDemoOrdersByMerchant,
  getDemoPopularByMerchant,
  type DemoMerchantOrder,
} from '../data/demoMerchants';
import { simulateVendorAdvanceOrder } from '../services/demoActionSimulator';
import {
  subscribeRoleEvent,
  loadVisibleRoleEventInbox,
  type OrderPlacedPayload,
  type RoleEvent,
} from '../services/roleEventBus';
import {
  updateDemoOrderStatus,
  listDemoMerchantOrders,
  subscribeDemoOrders,
} from '../services/demoMerchantOrders';
import { updateOrderStatus as updateDemoStoreOrderStatus } from '../services/demoStore';
import { AgentSummaryBanner } from '../components/AgentSummaryBanner';
import { AIMissionControl } from '../components/AIMissionControl';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function VendorDashboardScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  const merchantCtx = useMerchantContext();
  const [openSection, setOpenSection] = useState<null | 'pending' | 'popular'>('pending');
  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? null : k);
  };

  // 訂單 state — 從當前 merchant 拉
  const initialOrders = useMemo(
    () => merchantCtx.current ? getDemoOrdersByMerchant(merchantCtx.current.merchant.id) : [],
    [merchantCtx.current?.merchant.id],
  );
  const [orders, setOrders] = useState<DemoMerchantOrder[]>(initialOrders);

  // 切換 merchant 時 reset 訂單 + 載入歷史事件 inbox
  // ── 關鍵：學生在切換到 vendor demo 帳號之前下的單在 vendor 可見 inbox 裡，
  //   必須 mount 時讀進來，否則 vendor 看不到。
  useEffect(() => {
    const merchantId = merchantCtx.current?.merchant.id;
    if (!merchantId) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    const loadOrders = async () => {
      // 1. 從 inbox 讀「之前」的 order_placed events
      const vendorUid = auth.user?.uid ?? 'demo_cafeteria';
      const inboxEvents = await loadVisibleRoleEventInbox({
        uid: vendorUid,
        role: auth.profile?.role ?? 'vendor',
      }).catch(() => [] as RoleEvent<unknown>[]);
      const inboxOrders: DemoMerchantOrder[] = [];
      for (const event of inboxEvents) {
        if (event.kind !== 'order_placed') continue;
        const payload = event.payload as OrderPlacedPayload;
        if (payload.merchantId !== merchantId) continue;
        inboxOrders.push({
          id: payload.orderId,
          merchantId: payload.merchantId,
          studentUid: event.actorUid,
          studentName: payload.studentName,
          studentRole: payload.buyerRole,
          items: payload.items,
          total: payload.total,
          status: 'pending',
          orderedAt: event.occurredAt,
        });
      }

      // 1.5. 從 demoMerchantOrders store 撈「同一 session 內」學生剛下的單
      //     （它由 OrderingScreen 走 mockSource.createOrder → addDemoOrder 寫進去）
      const storeOrders: DemoMerchantOrder[] = listDemoMerchantOrders(merchantId)
        .filter((o) => !initialOrders.some((s) => s.id === o.id))
        .map((o) => ({
          id: o.id,
          merchantId,
          studentUid: o.userId,
          studentName: o.customerName ?? o.userId,
          studentRole: o.customerRole,
          items: o.items
            .map((it) => `${it.name} ×${it.quantity}`)
            .join('、'),
          total: o.totalAmount ?? o.total ?? 0,
          status:
            o.status === 'preparing'
              ? 'processing'
              : o.status === 'confirmed'
                ? 'pending'
              : o.status === 'pending'
                ? 'pending'
                : o.status === 'ready'
                  ? 'ready'
                  : 'completed',
          orderedAt: String(o.createdAt ?? new Date().toISOString()),
        }));

      if (cancelled) return;
      // 2. merge with static mock orders（dedupe by id）
      const merged: DemoMerchantOrder[] = [];
      const seen = new Set<string>();
      for (const o of [...storeOrders, ...inboxOrders, ...initialOrders]) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        merged.push(o);
      }
      setOrders(merged);
      if (inboxOrders.length > 0 || storeOrders.length > 0) {
        // 有新訂單時自動展開 pending section 提醒老闆
        setOpenSection('pending');
      }
    };
    void loadOrders();
    // 訂閱學生即時下單事件（同 session 內）
    const unsubStore = subscribeDemoOrders(() => {
      if (cancelled) return;
      void loadOrders();
    });
    return () => {
      cancelled = true;
      unsubStore();
    };
  }, [merchantCtx.current?.merchant.id, initialOrders, auth.profile?.role, auth.user?.uid]);

  // 學生下單 → 即時 push 進訂單佇列（in-memory listener 給「同一 session 中」即時聯動）
  useEffect(() => {
    const merchantId = merchantCtx.current?.merchant.id;
    if (!merchantId) return;
    const unsub = subscribeRoleEvent<OrderPlacedPayload>('order_placed', (event) => {
      if (event.payload.merchantId !== merchantId) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setOrders((prev) => {
        if (prev.find((o) => o.id === event.payload.orderId)) return prev;
        const newOrder: DemoMerchantOrder = {
          id: event.payload.orderId,
          merchantId: event.payload.merchantId,
          studentUid: event.actorUid,
          studentName: event.payload.studentName,
          studentRole: event.payload.buyerRole,
          items: event.payload.items,
          total: event.payload.total,
          status: 'pending',
          orderedAt: event.occurredAt,
        };
        // 開啟 pending section 讓老闆立刻看見
        setOpenSection('pending');
        return [newOrder, ...prev];
      });
    });
    return () => unsub();
  }, [merchantCtx.current?.merchant.id]);

  const stats = useMemo(() => {
    const todayRevenue = orders
      .filter((o) => o.status !== 'pending')
      .reduce((s, o) => s + o.total, 0);
    return {
      pending: orders.filter((o) => o.status === 'pending').length,
      processing: orders.filter((o) => o.status === 'processing').length,
      ready: orders.filter((o) => o.status === 'ready').length,
      revenue: todayRevenue,
    };
  }, [orders]);

  const advanceStatus = async (id: string) => {
    const target = orders.find((o) => o.id === id);
    if (!target) return;
    const next: DemoMerchantOrder['status'] =
      target.status === 'pending' ? 'processing'
      : target.status === 'processing' ? 'ready'
      : target.status === 'ready' ? 'completed'
      : 'completed';

    // 1. 本地 state 即時更新
    setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status: next } : o));

    // 1.5. 同步寫進 demoMerchantOrders store，讓學生 StudentOrdersScreen
    //      下次 refresh 拿到最新狀態（store 是 OrderingScreen 下單時寫進去的同一份）
    const storeStatus: 'pending' | 'preparing' | 'ready' | 'completed' =
      next === 'processing' ? 'preparing' : next;
    updateDemoOrderStatus(id, storeStatus);
    updateDemoStoreOrderStatus(id, next as 'processing' | 'ready' | 'completed');

    // 2. emit cross-role event 讓學生 inbox 收到
    if (target.studentUid && merchantCtx.current && auth.user) {
      try {
        await simulateVendorAdvanceOrder({
          vendorUid: auth.user.uid,
          vendorName: auth.profile?.displayName ?? '餐廳',
          studentUid: target.studentUid,
          orderId: target.id,
          merchantId: merchantCtx.current.merchant.id,
          merchantName: merchantCtx.current.merchant.name,
          newStatus: next as 'processing' | 'ready' | 'completed',
        });
      } catch (e) {
        // demo：emit 失敗 silently 不影響 UI
        // eslint-disable-next-line no-console
        console.warn('[VendorDashboard] emit failed', e);
      }
    }
  };

  const ctaFor = (s: DemoMerchantOrder['status']) => {
    switch (s) {
      case 'pending': return '開始備餐';
      case 'processing': return '完成 → 待取';
      case 'ready': return '已交付';
      default: return '';
    }
  };

  const activeOrders = orders.filter((o) => o.status !== 'completed');
  const popular = useMemo(
    () => merchantCtx.current ? getDemoPopularByMerchant(merchantCtx.current.merchant.id) : [],
    [merchantCtx.current?.merchant.id],
  );

  // 無 assignment 提示
  if (!merchantCtx.loading && !merchantCtx.current) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontSize: 48 }}>🍱</Text>
          <Text style={{
            color: theme.colors.text,
            fontSize: theme.typography.h2.fontSize,
            fontWeight: '700',
            marginTop: 12,
          }}>
            你還沒被指派到任何店家
          </Text>
          <Text style={{
            color: theme.colors.muted,
            fontSize: theme.typography.bodySmall.fontSize,
            textAlign: 'center',
            marginTop: 8,
          }}>
            請聯絡店長或校園商家管理員把你加進員工名單。
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: tabBarBottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Merchant switcher — 多個店家才顯示 */}
        {merchantCtx.available.length > 1 && (
          <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginBottom: theme.space.md, flexWrap: 'wrap' }}>
            {merchantCtx.available.map((a) => {
              const active = a.merchant.id === merchantCtx.current?.merchant.id;
              return (
                <Pressable
                  key={a.merchant.id}
                  onPress={() => merchantCtx.switchTo(a.merchant.id)}
                  style={({ pressed }) => ({
                    paddingHorizontal: theme.space.sm + 2,
                    paddingVertical: theme.space.xs + 4,
                    borderRadius: theme.radius.full,
                    backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                    opacity: pressed ? 0.7 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  })}
                >
                  <Text style={{ fontSize: 14 }}>{a.merchant.emoji}</Text>
                  <Text style={{
                    color: active ? theme.colors.onAccent : theme.colors.text,
                    fontSize: theme.typography.labelSmall.fontSize,
                    fontWeight: '600',
                  }}>
                    {a.merchant.name}
                  </Text>
                  <Text style={{
                    color: active ? theme.colors.onAccent : theme.colors.muted,
                    fontSize: theme.typography.labelSmall.fontSize - 2,
                    opacity: 0.85,
                    marginLeft: 2,
                  }}>
                    · {a.role.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <CockpitHero
          eyebrow={`午安，${auth.profile?.displayName?.split('（')[0] ?? '阿英'}${merchantCtx.current ? ` · ${merchantCtx.current.role.label}` : ''}`}
          title={merchantCtx.current ? `${merchantCtx.current.merchant.emoji} ${merchantCtx.current.merchant.name}` : '今日營運'}
          summary={(() => {
            const oldest = orders
              .filter((o) => o.status === 'pending')
              .reduce((m, o) => {
                const mins = (Date.now() - new Date(o.orderedAt).getTime()) / 60_000;
                return Math.max(m, mins);
              }, 0);
            const ai = aiVendorNextAction({
              pendingOrders: stats.pending,
              processingOrders: stats.processing,
              readyOrders: stats.ready,
              oldestPendingMinutes: Math.round(oldest),
              isOpen: merchantCtx.current?.merchant.isOpen,
              category: merchantCtx.current?.merchant.category as any,
              todayRevenue: merchantCtx.current?.merchant.todayRevenue,
              todayServed: merchantCtx.current?.merchant.todayServedCount,
            });
            return `🤖 ${ai.action}`;
          })()}
        />

        {/* 🤖 AI Agent 摘要 */}
        <AgentSummaryBanner cockpitLabel="餐廳" />

        {/* AI 任務指揮 — 商家專屬下一步 */}
        <View style={{ marginVertical: theme.space.md }}>
          <AIMissionControl uid={auth.user?.uid ?? 'demo_cafeteria'} maxVisible={3} hideWhenEmpty />
        </View>

        <CockpitMetricRow>
          <CockpitMetricChip label="新訂單" value={stats.pending} tone={stats.pending > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="製作中" value={stats.processing} />
          <CockpitMetricChip label="待取" value={stats.ready} tone={stats.ready > 0 ? 'success' : undefined} />
        </CockpitMetricRow>

        <View style={{ marginTop: theme.space.sm }}>
          <CockpitSection
            label="📋 訂單佇列"
            count={activeOrders.length}
            open={openSection === 'pending'}
            onToggle={() => toggle('pending')}
          >
            {activeOrders.length === 0 ? (
              <CockpitRow title="所有訂單都處理完了" subtitle="✨ 暫時休息一下" tone="success" />
            ) : (
              activeOrders.map((order) => (
                <View key={order.id} style={{ paddingVertical: theme.space.xs }}>
                  <CockpitRow
                    title={`${order.studentName}${order.studentRole ? ` (${order.studentRole})` : ''} · $${order.total}`}
                    subtitle={`${order.items} · ${new Date(order.orderedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`}
                    tone={order.status === 'pending' ? 'warn' : order.status === 'ready' ? 'success' : undefined}
                    rightSlot={
                      merchantCtx.current?.role.canHandleOrders ? (
                        <Pressable
                          onPress={() => advanceStatus(order.id)}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingHorizontal: theme.space.sm,
                            paddingVertical: theme.space.xs,
                            borderRadius: theme.radius.full,
                            backgroundColor: theme.colors.accent,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <Text style={{
                            color: theme.colors.onAccent,
                            fontSize: theme.typography.labelSmall.fontSize,
                            fontWeight: '700',
                          }}>
                            {ctaFor(order.status)}
                          </Text>
                          <Ionicons name="chevron-forward" size={12} color={theme.colors.onAccent} />
                        </Pressable>
                      ) : null
                    }
                  />
                </View>
              ))
            )}
          </CockpitSection>

          {merchantCtx.current?.role.canViewReports && (
            <CockpitSection
              label="🔥 本週熱門"
              count={popular.length}
              open={openSection === 'popular'}
              onToggle={() => toggle('popular')}
            >
              {popular.map((it, idx) => (
                <CockpitRow
                  key={it.name}
                  icon={`#${idx + 1}`}
                  title={it.name}
                  subtitle={`${it.count} 份 · $${it.revenue}`}
                />
              ))}
            </CockpitSection>
          )}
        </View>

        <View style={{
          marginTop: theme.space.lg,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.space.xs + 2,
        }}>
          {merchantCtx.current?.role.canEditMenu && (
            <CockpitToolChip
              icon="restaurant-outline"
              label="管理菜單"
              onPress={() => safeNavigate(navigation, 'VendorMenuManage')}
            />
          )}
          {merchantCtx.current?.role.canSendLoyaltyPush && (
            <CockpitToolChip
              icon="megaphone-outline"
              label="Loyalty 推播"
              onPress={() =>
                safeNavigate(navigation, 'VendorLoyaltyPush', undefined, {
                })
              }
            />
          )}
          {merchantCtx.current?.role.canViewReports && (
            <CockpitToolChip
              icon="stats-chart-outline"
              label="月度報表"
              onPress={() =>
                safeNavigate(navigation, 'VendorRevenueReport', undefined, {
                })
              }
            />
          )}
          {merchantCtx.current?.role.canManageStaff && (
            <CockpitToolChip
              icon="people-outline"
              label="員工管理"
              onPress={() =>
                safeNavigate(navigation, 'AdminCafeteria', undefined, {
                })
              }
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
