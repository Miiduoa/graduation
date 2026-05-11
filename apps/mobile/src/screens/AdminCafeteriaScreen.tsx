/* eslint-disable */
/**
 * 校園餐廳管理員畫面 — 靜宜大學（總務處/學校管理員）
 *
 * 功能：
 *   - 總覽：統計資訊、系統警告
 *   - 公告管理：建立、編輯、刪除公告
 *   - 衛生稽查：記錄稽查紀錄、評分
 *   - 店家管理：檢視店家資訊、狀態
 *   - 數據統計：訂單、營收、評分分析
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card, Screen, SectionTitle, Pill } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import {
  getCafeterias,
  getVendors,
  getVendor,
  getOrders,
  getReviews,
  getAnnouncements,
  addAnnouncement,
  getInspections,
  addInspection,
  CAFETERIAS,
  VENDORS,
  CATEGORY_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  CROWD_LABELS,
  CROWD_COLORS,
  estimateCrowdLevel,
  subscribeOrders,
  setOrderSchoolId,
  type Cafeteria,
  type CafeteriaId,
  type Vendor,
  type Order,
  type Review,
  type CafeteriaAnnouncement,
  type InspectionRecord,
} from '../services/cafeteriaData';

// ══════════════════════════════════════════════════
// 主畫面
// ══════════════════════════════════════════════════

export function AdminCafeteriaScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'announcements' | 'inspections' | 'vendors' | 'statistics'
  >('overview');
  const [orders, setOrders] = useState<Order[]>([]);
  const [announcements, setAnnouncements] = useState<CafeteriaAnnouncement[]>([]);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);

  // 初始化數據（管理員看全部訂單 — 即時訂閱）
  useEffect(() => {
    setOrderSchoolId('pu');

    // 即時訂閱全校訂單
    const unsub = subscribeOrders(
      { schoolId: 'pu' },
      (liveOrders) => setOrders(liveOrders),
    );

    // 若 Firestore 不可用，fallback 一次性載入
    if (!unsub) {
      getOrders()
        .then(setOrders)
        .catch((err) => console.error('Failed to load orders:', err));
    }

    // 載入公告 + 稽查
    getAnnouncements()
      .then(setAnnouncements)
      .catch((err) => console.error('Failed to load announcements:', err));
    getInspections()
      .then(setInspections)
      .catch((err) => console.error('Failed to load inspections:', err));

    return () => {
      unsub?.();
    };
  }, []);

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          gap: 12,
          padding: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
      >
        {/* 標題 */}
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <View>
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 22 }}>
              餐廳管理
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              靜宜大學 · 學校管理員
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
            <Ionicons name="arrow-back" size={18} color={theme.colors.accent} />
          </Pressable>
        </View>

        {/* Tab 切換 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
          {(['overview', 'announcements', 'inspections', 'vendors', 'statistics'] as const).map(
            (tab) => {
              const tabLabels = {
                overview: '總覽',
                announcements: '公告',
                inspections: '稽查',
                vendors: '店家',
                statistics: '統計',
              };
              const isActive = activeTab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: isActive ? theme.colors.accent : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: isActive ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: isActive ? '#fff' : theme.colors.muted,
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {tabLabels[tab]}
                  </Text>
                </Pressable>
              );
            },
          )}
        </View>

        {/* 內容區域 */}
        {activeTab === 'overview' && (
          <OverviewTab orders={orders} announcements={announcements} inspections={inspections} />
        )}

        {activeTab === 'announcements' && (
          <AnnouncementsTab
            announcements={announcements}
            onRefresh={() => {
              getAnnouncements().then(setAnnouncements);
            }}
          />
        )}

        {activeTab === 'inspections' && (
          <InspectionsTab
            inspections={inspections}
            onRefresh={() => {
              getInspections().then(setInspections);
            }}
          />
        )}

        {activeTab === 'vendors' && <VendorsTab />}

        {activeTab === 'statistics' && <StatisticsTab orders={orders} />}
      </ScrollView>
    </Screen>
  );
}

// ══════════════════════════════════════════════════
// 總覽 Tab
// ══════════════════════════════════════════════════

function OverviewTab(props: {
  orders: Order[];
  announcements: CafeteriaAnnouncement[];
  inspections: InspectionRecord[];
}) {
  const { orders, announcements, inspections } = props;
  const vendors = VENDORS;
  const crowdLevel = estimateCrowdLevel();

  // 計算統計數據
  const stats = useMemo(() => {
    const totalSeats = CAFETERIAS.reduce((s, c) => s + c.seats, 0);
    const totalVendors = vendors.length;
    const totalCafeterias = CAFETERIAS.length;
    const todayOrders = orders.filter((o) => {
      const date = new Date(o.createdAt);
      const today = new Date();
      return date.toDateString() === today.toDateString();
    }).length;
    const todayRevenue = orders
      .filter((o) => {
        const date = new Date(o.createdAt);
        const today = new Date();
        return date.toDateString() === today.toDateString();
      })
      .reduce((sum, o) => sum + o.totalPrice, 0);

    return {
      totalSeats,
      totalVendors,
      totalCafeterias,
      todayOrders,
      todayRevenue,
    };
  }, [vendors, orders]);

  // 識別警告問題
  const alerts = useMemo(() => {
    const issues: Array<{ type: 'warning' | 'error'; title: string; count: number }> = [];

    // 低評分店家
    const lowRatedVendors = vendors.filter((v) => v.rating < 3.5);
    if (lowRatedVendors.length > 0) {
      issues.push({
        type: 'warning',
        title: '低評分店家（<3.5分）',
        count: lowRatedVendors.length,
      });
    }

    // 過期稽查
    const now = Date.now();
    const vendorsWithoutRecentInspection = vendors.filter((v) => {
      const lastInspection = inspections
        .filter((i) => i.vendorId === v.id)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (!lastInspection) return true;
      const daysSinceInspection =
        (now - new Date(lastInspection.date).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceInspection > 90; // 超過 90 天
    });
    if (vendorsWithoutRecentInspection.length > 0) {
      issues.push({
        type: 'error',
        title: '超過 90 天未稽查',
        count: vendorsWithoutRecentInspection.length,
      });
    }

    // 稽查不及格
    const failedInspections = inspections.filter((i) => !i.passed);
    if (failedInspections.length > 0) {
      issues.push({
        type: 'error',
        title: '稽查不及格紀錄',
        count: failedInspections.length,
      });
    }

    return issues;
  }, [vendors, inspections, orders]);

  // 各餐廳統計
  const cafeteriaStats = useMemo(() => {
    return CAFETERIAS.map((caf) => {
      const cafVendors = vendors.filter((v) => v.cafeteriaId === caf.id);
      const cafOrders = orders.filter((o) => o.cafeteriaId === caf.id);
      const todayOrders = cafOrders.filter((o) => {
        const date = new Date(o.createdAt);
        const today = new Date();
        return date.toDateString() === today.toDateString();
      }).length;

      return {
        cafeteria: caf,
        vendorCount: cafVendors.length,
        todayOrders,
        avgRating:
          cafVendors.length > 0
            ? (cafVendors.reduce((s, v) => s + v.rating, 0) / cafVendors.length).toFixed(1)
            : 'N/A',
      };
    });
  }, [vendors, orders]);

  return (
    <View style={{ gap: 16 }}>
      {/* 系統統計卡片 */}
      <Card title="系統統計" subtitle="">
        <View style={{ gap: 12 }}>
          <StatRow
            label="餐廳數"
            value={stats.totalCafeterias.toString()}
            icon="business-outline"
          />
          <StatRow label="店家數" value={stats.totalVendors.toString()} icon="restaurant-outline" />
          <StatRow label="座位數" value={stats.totalSeats.toString()} icon="people-outline" />
          <StatRow label="今日訂單" value={stats.todayOrders.toString()} icon="receipt-outline" />
          <StatRow label="今日營收" value={`$${stats.todayRevenue}`} icon="cash-outline" />
        </View>
      </Card>

      {/* 人潮狀況 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 10,
          borderRadius: 10,
          backgroundColor: `${CROWD_COLORS[crowdLevel]}10`,
          borderWidth: 1,
          borderColor: `${CROWD_COLORS[crowdLevel]}30`,
        }}
      >
        <Ionicons name="people-outline" size={16} color={CROWD_COLORS[crowdLevel]} />
        <Text style={{ color: CROWD_COLORS[crowdLevel], fontSize: 13, fontWeight: '600' }}>
          目前人潮：{CROWD_LABELS[crowdLevel]}
        </Text>
      </View>

      {/* 系統警告 */}
      {alerts.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionTitle text={`系統警告 (${alerts.length})`} />
          {alerts.map((alert, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: 10,
                backgroundColor: alert.type === 'error' ? '#DC262610' : '#F59E0B10',
                borderLeftWidth: 4,
                borderLeftColor: alert.type === 'error' ? '#DC2626' : '#F59E0B',
              }}
            >
              <Ionicons
                name={alert.type === 'error' ? 'alert-circle' : 'warning'}
                size={20}
                color={alert.type === 'error' ? '#DC2626' : '#F59E0B'}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {alert.title}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                  {alert.count} {alert.count === 1 ? '個' : '個'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 各餐廳概況 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="各餐廳概況" />
        {cafeteriaStats.map((stat) => (
          <View
            key={stat.cafeteria.id}
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 6,
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
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                  {stat.cafeteria.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                  {stat.cafeteria.location}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pill text={`${stat.vendorCount} 間店家`} kind="default" />
              <Pill text={`今日 ${stat.todayOrders} 單`} kind="accent" />
              <Pill text={`評分 ${stat.avgRating}`} kind="default" />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 公告管理 Tab
// ══════════════════════════════════════════════════

function AnnouncementsTab(props: {
  announcements: CafeteriaAnnouncement[];
  onRefresh: () => void;
}) {
  const { announcements, onRefresh } = props;
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <View style={{ gap: 12 }}>
      <Pressable
        onPress={() => setShowCreateModal(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          borderRadius: 10,
          backgroundColor: pressed ? `${theme.colors.accent}cc` : theme.colors.accent,
          justifyContent: 'center',
        })}
      >
        <Ionicons name="add-circle" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>新建公告</Text>
      </Pressable>

      {announcements.length === 0 ? (
        <Card title="還沒有公告" subtitle="點擊「新建公告」建立新公告">
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
            公告會在發布時立即通知全校學生和店家。
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          <SectionTitle text={`公告列表 (${announcements.length})`} />
          {announcements.map((ann) => (
            <AnnouncementCard key={ann.id} announcement={ann} onRefresh={onRefresh} />
          ))}
        </View>
      )}

      {showCreateModal && (
        <CreateAnnouncementModal
          onClose={() => {
            setShowCreateModal(false);
            onRefresh();
          }}
        />
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════
// 衛生稽查 Tab
// ══════════════════════════════════════════════════

function InspectionsTab(props: { inspections: InspectionRecord[]; onRefresh: () => void }) {
  const { inspections, onRefresh } = props;
  const [showCreateModal, setShowCreateModal] = useState(false);

  const inspectionsByVendor = useMemo(() => {
    const map = new Map<string, InspectionRecord[]>();
    inspections.forEach((i) => {
      if (!map.has(i.vendorId)) map.set(i.vendorId, []);
      map.get(i.vendorId)!.push(i);
    });
    return map;
  }, [inspections]);

  return (
    <View style={{ gap: 12 }}>
      <Pressable
        onPress={() => setShowCreateModal(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          borderRadius: 10,
          backgroundColor: pressed ? `${theme.colors.accent}cc` : theme.colors.accent,
          justifyContent: 'center',
        })}
      >
        <Ionicons name="add-circle" size={20} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>新增稽查紀錄</Text>
      </Pressable>

      {inspections.length === 0 ? (
        <Card title="還沒有稽查紀錄" subtitle="點擊「新增稽查紀錄」建立新的衛生檢查">
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
            請定期進行衛生稽查，確保食品安全。
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          <SectionTitle text={`稽查紀錄 (${inspections.length})`} />
          {inspections
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((insp) => (
              <InspectionCard key={insp.id} inspection={insp} />
            ))}
        </View>
      )}

      {showCreateModal && (
        <CreateInspectionModal
          onClose={() => {
            setShowCreateModal(false);
            onRefresh();
          }}
        />
      )}
    </View>
  );
}

// ══════════════════════════════════════════════════
// 店家管理 Tab
// ══════════════════════════════════════════════════

function VendorsTab() {
  const [selectedCafeteria, setSelectedCafeteria] = useState<CafeteriaId | null>(null);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [allVendors, setAllVendors] = useState<Vendor[]>(VENDORS); // 初始值用本地，之後用 Firestore

  useEffect(() => {
    try {
      const vs = getVendors();
      if (vs.length > 0) setAllVendors(vs);
    } catch (_) { /* ignore */ }
  }, []);

  const filteredVendors = useMemo(
    () =>
      selectedCafeteria ? allVendors.filter((v) => v.cafeteriaId === selectedCafeteria) : allVendors,
    [selectedCafeteria, allVendors],
  );

  return (
    <View style={{ gap: 12 }}>
      {/* 餐廳篩選 */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable
          onPress={() => setSelectedCafeteria(null)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor:
              selectedCafeteria === null ? theme.colors.accent : theme.colors.surface,
            borderWidth: 1,
            borderColor: selectedCafeteria === null ? theme.colors.accent : theme.colors.border,
          }}
        >
          <Text
            style={{
              color: selectedCafeteria === null ? '#fff' : theme.colors.muted,
              fontSize: 12,
              fontWeight: '600',
            }}
          >
            全部餐廳
          </Text>
        </Pressable>
        {CAFETERIAS.map((caf) => (
          <Pressable
            key={caf.id}
            onPress={() => setSelectedCafeteria(caf.id)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor:
                selectedCafeteria === caf.id ? theme.colors.accent : theme.colors.surface,
              borderWidth: 1,
              borderColor: selectedCafeteria === caf.id ? theme.colors.accent : theme.colors.border,
            }}
          >
            <Text
              style={{
                color: selectedCafeteria === caf.id ? '#fff' : theme.colors.muted,
                fontSize: 12,
                fontWeight: '600',
              }}
            >
              {caf.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 店家列表 */}
      <View style={{ gap: 10 }}>
        <SectionTitle text={`店家列表 (${filteredVendors.length})`} />
        {filteredVendors.map((vendor) => (
          <VendorManagementCard
            key={vendor.id}
            vendor={vendor}
            isExpanded={expandedVendor === vendor.id}
            onToggleExpand={() =>
              setExpandedVendor(expandedVendor === vendor.id ? null : vendor.id)
            }
          />
        ))}
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 數據統計 Tab
// ══════════════════════════════════════════════════

function StatisticsTab(props: { orders: Order[] }) {
  const { orders } = props;
  const vendors = VENDORS;

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalPrice, 0);
    const avgOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0';

    // 評分分析
    const avgRating =
      vendors.length > 0
        ? (vendors.reduce((s, v) => s + v.rating, 0) / vendors.length).toFixed(2)
        : '0';
    const topRatedVendors = [...vendors].sort((a, b) => b.rating - a.rating).slice(0, 5);
    const lowestRatedVendors = [...vendors].sort((a, b) => a.rating - b.rating).slice(0, 5);

    // 類別分佈
    const categoryDistribution = vendors.reduce(
      (acc, v) => {
        const cat = v.category;
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // 各餐廳統計
    const cafeteriaBreakdown = CAFETERIAS.map((caf) => ({
      cafeteria: caf,
      vendorCount: vendors.filter((v) => v.cafeteriaId === caf.id).length,
      orders: orders.filter((o) => o.cafeteriaId === caf.id).length,
      revenue: orders
        .filter((o) => o.cafeteriaId === caf.id)
        .reduce((sum, o) => sum + o.totalPrice, 0),
    }));

    return {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      avgRating,
      topRatedVendors,
      lowestRatedVendors,
      categoryDistribution,
      cafeteriaBreakdown,
    };
  }, [orders, vendors]);

  return (
    <View style={{ gap: 16 }}>
      {/* 整體數據 */}
      <Card title="整體統計" subtitle="">
        <View style={{ gap: 12 }}>
          <StatRow label="總訂單數" value={stats.totalOrders.toString()} icon="receipt-outline" />
          <StatRow label="總營收" value={`$${stats.totalRevenue}`} icon="cash-outline" />
          <StatRow label="平均訂單值" value={`$${stats.avgOrderValue}`} icon="calculator" />
          <StatRow label="平均評分" value={stats.avgRating} icon="star" />
        </View>
      </Card>

      {/* 評分最高的店家 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="評分最高的店家" />
        {stats.topRatedVendors.map((v, i) => (
          <View
            key={v.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              borderRadius: 10,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: '#16A34A20',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#16A34A', fontWeight: '700', fontSize: 12 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                {v.name}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                {v.rating.toFixed(1)} 分 · {v.ratingCount} 個評價
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 13 }}>
                {v.rating.toFixed(1)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* 評分最低的店家 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="需要關注的店家" />
        {stats.lowestRatedVendors.map((v, i) => (
          <View
            key={v.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              borderRadius: 10,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: '#DC262630',
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: '#DC262620',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                {v.name}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                {v.rating.toFixed(1)} 分 · {v.ratingCount} 個評價
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 13 }}>
                {v.rating.toFixed(1)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* 各餐廳明細 */}
      <View style={{ gap: 8 }}>
        <SectionTitle text="各餐廳明細" />
        {stats.cafeteriaBreakdown.map((stat) => (
          <View
            key={stat.cafeteria.id}
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 8,
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
              {stat.cafeteria.name}
            </Text>
            <View style={{ gap: 4 }}>
              <StatRow label="店家數" value={stat.vendorCount.toString()} icon="restaurant" />
              <StatRow label="訂單數" value={stat.orders.toString()} icon="receipt-outline" />
              <StatRow label="營收" value={`$${stat.revenue}`} icon="cash-outline" />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 公告卡片
// ══════════════════════════════════════════════════

function AnnouncementCard(props: { announcement: CafeteriaAnnouncement; onRefresh: () => void }) {
  const { announcement: ann, onRefresh } = props;

  const priorityColor =
    ann.priority === 'urgent' ? '#DC2626' : ann.priority === 'important' ? '#F59E0B' : '#6B7280';

  const cafeteriaName =
    ann.cafeteriaId === 'all'
      ? '全校公告'
      : (CAFETERIAS.find((c) => c.id === ann.cafeteriaId)?.name ?? '未知餐廳');

  const handleDelete = () => {
    Alert.alert('刪除公告', '確定要刪除此公告嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          const { deleteAnnouncement } = await import('../services/cafeteriaData');
          await deleteAnnouncement(ann.id);
          onRefresh();
        },
      },
    ]);
  };

  return (
    <Pressable
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 8,
      }}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
              {ann.title}
            </Text>
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: `${priorityColor}20`,
              }}
            >
              <Text style={{ color: priorityColor, fontSize: 10, fontWeight: '700' }}>
                {ann.priority === 'urgent'
                  ? '緊急'
                  : ann.priority === 'important'
                    ? '重要'
                    : '一般'}
              </Text>
            </View>
          </View>
          <Text
            style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4, lineHeight: 18 }}
            numberOfLines={2}
          >
            {ann.content}
          </Text>
        </View>
        <Pressable onPress={handleDelete} style={{ padding: 4 }}>
          <Ionicons name="trash" size={18} color="#DC2626" />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Pill text={cafeteriaName} kind="default" />
        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
          {new Date(ann.createdAt).toLocaleDateString('zh-TW')}
        </Text>
      </View>
    </Pressable>
  );
}

// ══════════════════════════════════════════════════
// 稽查卡片
// ══════════════════════════════════════════════════

function InspectionCard(props: { inspection: InspectionRecord }) {
  const { inspection: insp } = props;
  const vendor = getVendor(insp.vendorId);

  const scoreColor = insp.score >= 90 ? '#16A34A' : insp.score >= 70 ? '#F59E0B' : '#DC2626';

  return (
    <View
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 8,
      }}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
            {vendor?.name ?? '未知店家'}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            稽查員：{insp.inspectorName}
          </Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: scoreColor, fontWeight: '800', fontSize: 18 }}>{insp.score}</Text>
          <Text style={{ color: scoreColor, fontSize: 10, fontWeight: '700', marginTop: 2 }}>
            {insp.passed ? '及格' : '不及格'}
          </Text>
        </View>
      </View>
      {insp.items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{item.category}</Text>
          <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 11 }}>
            {item.score}/{item.maxScore}
          </Text>
        </View>
      ))}
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
        {new Date(insp.date).toLocaleDateString('zh-TW')}
      </Text>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 店家管理卡片
// ══════════════════════════════════════════════════

function VendorManagementCard(props: {
  vendor: Vendor;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const { vendor: v, isExpanded, onToggleExpand } = props;
  const cafeteriaName = CAFETERIAS.find((c) => c.id === v.cafeteriaId)?.name ?? '';

  return (
    <Pressable
      onPress={onToggleExpand}
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
            {v.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            {cafeteriaName} · {v.floor} {v.stallNumber}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Ionicons name="star" size={14} color="#F59E0B" />
            <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 12 }}>
              {v.rating.toFixed(1)}
            </Text>
          </View>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.colors.muted}
          />
        </View>
      </View>

      {isExpanded && (
        <View
          style={{
            gap: 8,
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <InfoRow label="類別" value={CATEGORY_LABELS[v.category]} />
          <InfoRow label="狀態" value={v.isOpen ? '營業中' : '休息中'} />
          <InfoRow label="評價數" value={v.ratingCount.toString()} />
          <InfoRow label="平均消費" value={`$${v.avgPrice}`} />
          <InfoRow label="營業時間" value={`${v.openTime}~${v.closeTime}`} />
        </View>
      )}
    </Pressable>
  );
}

// ══════════════════════════════════════════════════
// 建立公告 Modal
// ══════════════════════════════════════════════════

function CreateAnnouncementModal(props: { onClose: () => void }) {
  const { onClose } = props;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [targetCafeteria, setTargetCafeteria] = useState<CafeteriaId | 'all'>('all');
  const [isLoading, setIsLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) {
      Alert.alert('驗證錯誤', '請填入公告標題和內容');
      return;
    }

    setIsLoading(true);
    try {
      await addAnnouncement({
        cafeteriaId: targetCafeteria,
        title: title.trim(),
        content: content.trim(),
        priority,
        expiresAt: null,
        authorName: '系統管理員',
      });
      Alert.alert('成功', '公告已發佈');
      onClose();
    } catch (err) {
      Alert.alert('失敗', '發佈公告時出錯，請稍後再試');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 16,
            paddingTop: 60,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 18 }}>
            新建公告
          </Text>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
        >
          {/* 標題 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              公告標題
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="輸入公告標題..."
              placeholderTextColor={theme.colors.muted}
              style={{
                color: theme.colors.text,
                fontSize: 14,
                padding: 12,
                borderRadius: 10,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            />
          </View>

          {/* 內容 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              公告內容
            </Text>
            <TextInput
              value={content}
              onChangeText={setContent}
              placeholder="輸入公告內容..."
              placeholderTextColor={theme.colors.muted}
              multiline
              textAlignVertical="top"
              style={{
                color: theme.colors.text,
                fontSize: 14,
                padding: 12,
                borderRadius: 10,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                minHeight: 120,
              }}
            />
          </View>

          {/* 優先級 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              優先級
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['normal', 'important', 'urgent'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: priority === p ? theme.colors.accent : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: priority === p ? theme.colors.accent : theme.colors.border,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: priority === p ? '#fff' : theme.colors.muted,
                      fontWeight: '600',
                      fontSize: 12,
                    }}
                  >
                    {p === 'normal' ? '一般' : p === 'important' ? '重要' : '緊急'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 目標餐廳 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              目標餐廳
            </Text>
            <View style={{ gap: 6 }}>
              <Pressable
                onPress={() => setTargetCafeteria('all')}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor:
                    targetCafeteria === 'all' ? theme.colors.accent : theme.colors.surface,
                  borderWidth: 1,
                  borderColor:
                    targetCafeteria === 'all' ? theme.colors.accent : theme.colors.border,
                }}
              >
                <Text
                  style={{
                    color: targetCafeteria === 'all' ? '#fff' : theme.colors.text,
                    fontWeight: '600',
                    fontSize: 13,
                  }}
                >
                  全校公告
                </Text>
              </Pressable>
              {CAFETERIAS.map((caf) => (
                <Pressable
                  key={caf.id}
                  onPress={() => setTargetCafeteria(caf.id)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor:
                      targetCafeteria === caf.id ? theme.colors.accent : theme.colors.surface,
                    borderWidth: 1,
                    borderColor:
                      targetCafeteria === caf.id ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: targetCafeteria === caf.id ? '#fff' : theme.colors.text,
                      fontWeight: '600',
                      fontSize: 13,
                    }}
                  >
                    {caf.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* 發佈按鈕 */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 16,
            backgroundColor: theme.colors.background,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            gap: 8,
          }}
        >
          <Pressable
            onPress={handleCreate}
            disabled={isLoading}
            style={({ pressed }) => ({
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: pressed ? `${theme.colors.accent}cc` : theme.colors.accent,
              alignItems: 'center',
              opacity: isLoading ? 0.6 : 1,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
              {isLoading ? '發佈中...' : '發佈公告'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ══════════════════════════════════════════════════
// 建立稽查紀錄 Modal
// ══════════════════════════════════════════════════

function CreateInspectionModal(props: { onClose: () => void }) {
  const { onClose } = props;
  const [vendorId, setVendorId] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const [envScore, setEnvScore] = useState(25); // 環境清潔
  const [foodScore, setFoodScore] = useState(25); // 食材管理
  const [hygieneScore, setHygieneScore] = useState(25); // 個人衛生
  const [equipScore, setEquipScore] = useState(25); // 設備維護
  const [comment, setComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const selectedVendor = VENDORS.find((v) => v.id === vendorId);
  const totalScore = envScore + foodScore + hygieneScore + equipScore;
  const passed = totalScore >= 70;

  const handleCreate = async () => {
    if (!vendorId || !inspectorName.trim()) {
      Alert.alert('驗證錯誤', '請選擇店家並輸入稽查員名稱');
      return;
    }

    if (!selectedVendor) return;

    setIsLoading(true);
    try {
      await addInspection({
        vendorId,
        cafeteriaId: selectedVendor.cafeteriaId,
        inspectorName: inspectorName.trim(),
        date: new Date().toISOString().split('T')[0],
        score: totalScore,
        items: [
          { category: '環境清潔', score: envScore, maxScore: 25, note: '' },
          { category: '食材管理', score: foodScore, maxScore: 25, note: '' },
          { category: '個人衛生', score: hygieneScore, maxScore: 25, note: '' },
          { category: '設備維護', score: equipScore, maxScore: 25, note: '' },
        ],
        overallComment: comment.trim(),
        passed,
      });
      Alert.alert('成功', `稽查紀錄已保存 (${totalScore} 分，${passed ? '及格' : '不及格'})`);
      onClose();
    } catch (err) {
      Alert.alert('失敗', '保存稽查紀錄時出錯，請稍後再試');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 16,
            paddingTop: 60,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 18 }}>
            新增稽查紀錄
          </Text>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
        >
          {/* 選擇店家 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              選擇店家
            </Text>
            <View style={{ gap: 6 }}>
              {VENDORS.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => setVendorId(v.id)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: vendorId === v.id ? theme.colors.accent : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: vendorId === v.id ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: vendorId === v.id ? '#fff' : theme.colors.text,
                      fontWeight: '600',
                      fontSize: 13,
                    }}
                  >
                    {v.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 稽查員名稱 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              稽查員名稱
            </Text>
            <TextInput
              value={inspectorName}
              onChangeText={setInspectorName}
              placeholder="輸入稽查員名稱..."
              placeholderTextColor={theme.colors.muted}
              style={{
                color: theme.colors.text,
                fontSize: 14,
                padding: 12,
                borderRadius: 10,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            />
          </View>

          {/* 評分項目 */}
          <View style={{ gap: 12, paddingVertical: 8 }}>
            <ScoreSlider
              label="環境清潔"
              value={envScore}
              onValueChange={setEnvScore}
              maxScore={25}
            />
            <ScoreSlider
              label="食材管理"
              value={foodScore}
              onValueChange={setFoodScore}
              maxScore={25}
            />
            <ScoreSlider
              label="個人衛生"
              value={hygieneScore}
              onValueChange={setHygieneScore}
              maxScore={25}
            />
            <ScoreSlider
              label="設備維護"
              value={equipScore}
              onValueChange={setEquipScore}
              maxScore={25}
            />
          </View>

          {/* 總分 */}
          <View
            style={{
              padding: 12,
              borderRadius: 10,
              backgroundColor:
                totalScore >= 90 ? '#16A34A10' : totalScore >= 70 ? '#F59E0B10' : '#DC262610',
              borderWidth: 1,
              borderColor:
                totalScore >= 90 ? '#16A34A30' : totalScore >= 70 ? '#F59E0B30' : '#DC262630',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Text
              style={{
                color: totalScore >= 90 ? '#16A34A' : totalScore >= 70 ? '#F59E0B' : '#DC2626',
                fontWeight: '800',
                fontSize: 20,
              }}
            >
              {totalScore} 分
            </Text>
            <Text
              style={{
                color: totalScore >= 90 ? '#16A34A' : totalScore >= 70 ? '#F59E0B' : '#DC2626',
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              {passed ? '及格 (>=70)' : '不及格 (<70)'}
            </Text>
          </View>

          {/* 備註 */}
          <View style={{ gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
              備註（選填）
            </Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="輸入稽查備註..."
              placeholderTextColor={theme.colors.muted}
              multiline
              textAlignVertical="top"
              style={{
                color: theme.colors.text,
                fontSize: 14,
                padding: 12,
                borderRadius: 10,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                minHeight: 80,
              }}
            />
          </View>
        </ScrollView>

        {/* 保存按鈕 */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 16,
            backgroundColor: theme.colors.background,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            gap: 8,
          }}
        >
          <Pressable
            onPress={handleCreate}
            disabled={isLoading || !vendorId || !inspectorName.trim()}
            style={({ pressed }) => ({
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: pressed ? `${theme.colors.accent}cc` : theme.colors.accent,
              alignItems: 'center',
              opacity: isLoading || !vendorId || !inspectorName.trim() ? 0.6 : 1,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
              {isLoading ? '保存中...' : '保存稽查紀錄'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ══════════════════════════════════════════════════
// 評分滑桿
// ══════════════════════════════════════════════════

function ScoreSlider(props: {
  label: string;
  value: number;
  onValueChange: (val: number) => void;
  maxScore: number;
}) {
  const { label, value, onValueChange, maxScore } = props;

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>{label}</Text>
        <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 14 }}>
          {value}/{maxScore}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          onPress={() => onValueChange(Math.max(0, value - 1))}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="remove" size={16} color={theme.colors.muted} />
        </Pressable>
        <View
          style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.surface,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: '100%',
              width: `${(value / maxScore) * 100}%`,
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
        <Pressable
          onPress={() => onValueChange(Math.min(maxScore, value + 1))}
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={16} color={theme.colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════
// 輔助組件
// ══════════════════════════════════════════════════

function StatRow(props: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  const { label, value, icon } = props;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={16} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{label}</Text>
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

function InfoRow(props: { label: string; value: string }) {
  const { label, value } = props;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 12 }}>{value}</Text>
    </View>
  );
}
