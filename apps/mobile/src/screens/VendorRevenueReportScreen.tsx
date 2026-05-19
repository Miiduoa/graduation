/**
 * Vendor Revenue Report — 餐廳月度 / 週度收入報表
 *
 * 從 DEMO_MERCHANT_ORDERS（含 completed / pending / processing / ready）+ DEMO_MERCHANT_POPULAR
 * 算出：
 *   - 今日 / 本週 / 本月 三個區間的營收
 *   - 與歷史平均的對照（用 vendorPredictor 預測）
 *   - 熱銷品項 top 5
 *   - 訂單佈局：完成率 / 待處理 / 平均單價
 *
 * 設計：純讀取現有資料，無新 emit。提供「深入分析 → 跳 vendorPredictor 即時建議」連結。
 */
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
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
import { useMerchantContext } from '../hooks/useMerchantContext';
import {
  DEMO_MERCHANTS,
  DEMO_MERCHANT_ORDERS,
  getDemoOrdersByMerchant,
  getDemoPopularByMerchant,
  type DemoMerchantOrder,
} from '../data/demoMerchants';
import { safeNavigate } from '../utils/safeNavigate';

type Period = 'today' | 'week' | 'month';

interface PeriodStats {
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  completedRate: number;
  pendingCount: number;
}

function statsForOrders(orders: DemoMerchantOrder[]): PeriodStats {
  const total = orders.length;
  if (total === 0) {
    return { totalRevenue: 0, totalOrders: 0, avgTicket: 0, completedRate: 0, pendingCount: 0 };
  }
  const revenue = orders.reduce((a, o) => a + o.total, 0);
  const completed = orders.filter((o) => o.status === 'completed').length;
  const pending = orders.filter((o) => o.status === 'pending' || o.status === 'processing').length;
  return {
    totalRevenue: revenue,
    totalOrders: total,
    avgTicket: Math.round(revenue / total),
    completedRate: Math.round((completed / total) * 100),
    pendingCount: pending,
  };
}

function filterByPeriod(orders: DemoMerchantOrder[], period: Period): DemoMerchantOrder[] {
  const now = Date.now();
  const periodMs =
    period === 'today' ? 86400_000 : period === 'week' ? 7 * 86400_000 : 30 * 86400_000;
  return orders.filter((o) => {
    const t = new Date(o.orderedAt).getTime();
    return now - t <= periodMs;
  });
}

export default function VendorRevenueReportScreen() {
  const navigation = useNavigation<any>();
  const bottomPad = useTabBarContentBottomPadding();
  const merchantCtx = useMerchantContext();
  const [period, setPeriod] = useState<Period>('week');

  // 沒選店家就用第一個（demo 用 merchant_cafe_a）
  const merchantId = merchantCtx.current?.merchant.id ?? DEMO_MERCHANTS[0]?.id ?? 'merchant_cafe_a';
  const merchant = DEMO_MERCHANTS.find((m) => m.id === merchantId);

  // 計算各區間
  const allOrders = useMemo(() => getDemoOrdersByMerchant(merchantId), [merchantId]);
  const periodOrders = useMemo(() => filterByPeriod(allOrders, period), [allOrders, period]);
  const stats = useMemo(() => statsForOrders(periodOrders), [periodOrders]);

  // 全體（給 demo 即使資料很少也能顯示有意義數字）
  const overallStats = useMemo(() => statsForOrders(allOrders), [allOrders]);

  // 熱銷品項
  const popular = useMemo(() => getDemoPopularByMerchant(merchantId).slice(0, 5), [merchantId]);

  // 與「歷史同期」對比（demo：用整體 vs 該期間的比例）
  const periodMultiplier = period === 'today' ? 1 / 7 : period === 'week' ? 1 : 30 / 7;
  const expectedRevenue = Math.round(overallStats.totalRevenue * periodMultiplier);
  const deviationPercent = expectedRevenue === 0
    ? 0
    : Math.round(((stats.totalRevenue - expectedRevenue) / expectedRevenue) * 100);

  const tone = deviationPercent > 15 ? 'success' : deviationPercent < -15 ? 'warn' : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={`📊 ${merchant?.name ?? '店家'} · 營收報表`}
          title={`NT$ ${stats.totalRevenue.toLocaleString()}`}
          summary={`${period === 'today' ? '今日' : period === 'week' ? '本週' : '本月'}營收 · ${stats.totalOrders} 單 · 平均客單價 NT$ ${stats.avgTicket}`}
        />

        {/* 期間切換 */}
        <View style={{ flexDirection: 'row', gap: theme.space.xs, marginBottom: theme.space.md }}>
          {(['today', 'week', 'month'] as Period[]).map((p) => {
            const active = p === period;
            const label = p === 'today' ? '今日' : p === 'week' ? '本週' : '本月';
            return (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: active ? theme.colors.text : theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? theme.colors.text : theme.colors.border,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text
                  style={{
                    color: active ? theme.colors.bg : theme.colors.text,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <CockpitMetricRow>
          <CockpitMetricChip label="訂單數" value={stats.totalOrders} />
          <CockpitMetricChip label="完成率" value={`${stats.completedRate}%`}
            tone={stats.completedRate >= 80 ? 'success' : undefined} />
          <CockpitMetricChip label="待處理" value={stats.pendingCount}
            tone={stats.pendingCount > 5 ? 'warn' : undefined} />
          <CockpitMetricChip label="與預期" value={`${deviationPercent > 0 ? '+' : ''}${deviationPercent}%`}
            tone={tone} />
        </CockpitMetricRow>

        {/* 預期 vs 實際 對照卡 */}
        <View
          style={{
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accentSoft,
            marginBottom: theme.space.md,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
            預期 vs 實際
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 13, color: theme.colors.text }}>
              歷史同期預估 NT$ {expectedRevenue.toLocaleString()}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color:
                  deviationPercent > 15
                    ? theme.colors.success
                    : deviationPercent < -15
                      ? theme.colors.warning
                      : theme.colors.muted,
                fontWeight: '700',
              }}
            >
              {deviationPercent > 15
                ? `📈 比預期多 ${deviationPercent}%`
                : deviationPercent < -15
                  ? `📉 比預期少 ${Math.abs(deviationPercent)}%`
                  : '與預期一致'}
            </Text>
          </View>
        </View>

        <CockpitSection label="🔥 熱銷品項" count={popular.length} open onToggle={() => undefined}>
          {popular.length === 0 ? (
            <CockpitRow title="尚無熱銷紀錄" />
          ) : (
            popular.map((p, idx) => (
              <CockpitRow
                key={p.name}
                icon={`#${idx + 1}`}
                title={p.name}
                subtitle={`賣出 ${p.count} 份 · 營收 NT$ ${p.revenue.toLocaleString()} · 趨勢 ${p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→'}`}
                tone={idx === 0 ? 'success' : undefined}
              />
            ))
          )}
        </CockpitSection>

        <CockpitSection label="📋 本期間訂單" count={periodOrders.length} open onToggle={() => undefined}>
          {periodOrders.length === 0 ? (
            <CockpitRow title="本期間尚無訂單" />
          ) : (
            periodOrders.slice(0, 10).map((o) => {
              const statusIcon =
                o.status === 'completed' ? '✅'
                  : o.status === 'ready' ? '🔔'
                    : o.status === 'processing' ? '🍳'
                      : '📋';
              const statusLabel =
                o.status === 'completed' ? '已交付'
                  : o.status === 'ready' ? '待取'
                    : o.status === 'processing' ? '製作中'
                      : '待處理';
              return (
                <CockpitRow
                  key={o.id}
                  icon={statusIcon}
                  title={`${o.studentName} · ${o.items}`}
                  subtitle={`${statusLabel} · NT$ ${o.total}${o.note ? ` · ${o.note}` : ''}`}
                />
              );
            })
          )}
        </CockpitSection>

        {/* 深入分析連結 */}
        <Pressable
          onPress={() =>
            safeNavigate(navigation, 'TodayHome', undefined, {
            })
          }
          style={({ pressed }) => ({
            marginTop: theme.space.md,
            paddingVertical: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.text,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="bulb" size={16} color={theme.colors.bg} />
          <Text style={{ color: theme.colors.bg, fontSize: 13, fontWeight: '700' }}>
            看即時 AI 預測建議
          </Text>
        </Pressable>

        <Text
          style={{
            marginTop: theme.space.md,
            textAlign: 'center',
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
          }}
        >
          報表資料來自本地 demo 資料 · 正式版將接 Firestore 訂單歷史
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
