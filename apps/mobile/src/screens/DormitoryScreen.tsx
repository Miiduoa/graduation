/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
/**
 * 靜宜大學宿舍服務 — 商業級智慧宿舍體驗
 *
 * 創新功能：
 * 1. 時段感知首頁 — 早上推薦洗衣、傍晚提醒取包裹、深夜顯示緊急聯絡
 * 2. 即時洗衣儀表板 — 全棟洗衣/烘衣機狀態 + 完成通知 + 尖峰預警
 * 3. 智慧報修 — 9 大類別 + 平均回應時間 + 進度追蹤 + 維修評分
 * 4. 包裹即時追蹤 — 物流辨識 + 到件通知 + 取件確認
 * 5. 社區互動 — 借物/揪團/失物/二手交易/生活分享
 * 6. 宿舍評分 — 整潔/安靜/設備/安全/交通 五維度評分
 * 7. 電費追蹤 — IC 卡餘額 + 每月用量分析
 * 8. 緊急求助 — SOS 一鍵撥號 + 24hr 緊急聯絡
 * 9. 門禁管理 — 夜歸登記 + 訪客登記 + 門禁延長申請
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ScrollView,
  Text,
  View,
  Pressable,
  RefreshControl,
  Alert,
  Modal,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  AnimatedCard,
  Button,
  Pill,
  SegmentedControl,
  EmptyState,
  ProgressRing,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useDataSource } from '../hooks/useDataSource';
import { useSchool } from '../state/school';
import { formatDateTime } from '../utils/format';
import type {
  RepairRequest,
  DormPackage,
  WashingMachine,
  DormitoryInfo,
  DormAnnouncement,
} from '../data/types';

import type { RepairType } from '../data/types';
import {
  DORM_OFFICE_INFO,
  DORM_BUILDINGS,
  type DormBuildingId,
  ROOM_TYPES,
  ROOM_EQUIPMENT,
  ACCESS_RULES,
  ACCESS_POLICY,
  simulateLaundryStatus,
  getLaundryStats,
  type LaundryMachine,
  type LaundryStatus,
  REPAIR_CATEGORIES,
  type RepairCategory,
  PACKAGE_LOCATIONS,
  CARRIERS,
  ELECTRICITY_INFO,
  getSmartDormSuggestions,
  COMMUNITY_CATEGORIES,
  type CommunityPostType,
  DORM_FAQS,
  ROLE_DORM_ACCESS,
  getDormRatings,
  EMERGENCY_CONTACTS,
  QUICK_ACTIONS,
  // ── 抽籤系統 ──
  LOTTERY_TIMELINE,
  type LotteryPhase,
  getCurrentLotteryPhase,
  PRIORITY_RULES,
  type PriorityRule,
  type LotteryApplication,
  type LotteryAppStatus,
  type LotteryWish,
  getLotteryStatusLabel,
  getLotteryStatusColor,
  type RoomSwapRequest,
  getSwapStatusLabel,
  simulateLotteryStats,
  simulateMyApplication,
} from '../data/puDormData';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ═══════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════

function getRepairStatusLabel(status: string): string {
  const m: Record<string, string> = {
    pending: '待處理',
    assigned: '已派工',
    inProgress: '處理中',
    completed: '已完成',
    cancelled: '已取消',
  };
  return m[status] ?? status;
}

function getRepairStatusColor(status: string): string {
  const m: Record<string, string> = {
    pending: theme.colors.muted,
    assigned: '#F59E0B',
    inProgress: theme.colors.accent,
    completed: theme.colors.success,
    cancelled: theme.colors.danger,
  };
  return m[status] ?? theme.colors.muted;
}

function getLaundryStatusLabel(status: LaundryStatus): string {
  const m: Record<LaundryStatus, string> = {
    available: '空閒',
    inUse: '使用中',
    finished: '已完成',
    maintenance: '維修中',
    reserved: '已預約',
  };
  return m[status] ?? status;
}

function getLaundryStatusColor(status: LaundryStatus): string {
  const m: Record<LaundryStatus, string> = {
    available: theme.colors.success,
    inUse: '#F59E0B',
    finished: '#3B82F6',
    maintenance: theme.colors.danger,
    reserved: theme.colors.accent,
  };
  return m[status] ?? theme.colors.muted;
}

// ═══════════════════════════════════════════════════
// 主畫面
// ═══════════════════════════════════════════════════

export function DormitoryScreen(props: any) {
  const nav = props?.navigation;
  const ds = useDataSource();
  const auth = useAuth();
  const { school } = useSchool();

  type DormTab = 'home' | 'repair' | 'package' | 'laundry' | 'lottery' | 'community' | 'info';
  const [tab, setTab] = useState<string>('home');
  const [refreshing, setRefreshing] = useState(false);

  // 我的宿舍資料
  const [dormInfo, setDormInfo] = useState<DormitoryInfo | null>(null);
  const [repairs, setRepairs] = useState<RepairRequest[]>([]);
  const [packages, setPackages] = useState<DormPackage[]>([]);
  const [announcements, setAnnouncements] = useState<DormAnnouncement[]>([]);

  // 洗衣機
  const myBuilding: DormBuildingId = (
    dormInfo?.building?.includes('希嘉')
      ? 'schultz'
      : dormInfo?.building?.includes('思高')
        ? 'bosco'
        : 'shepherd'
  ) as DormBuildingId;
  const [laundryMachines, setLaundryMachines] = useState<LaundryMachine[]>([]);
  const [laundryFilter, setLaundryFilter] = useState<'all' | 'washer' | 'dryer'>('all');

  // 電費模擬
  const [acBalance, setAcBalance] = useState(187); // 模擬 IC 卡餘額
  const [monthlyUsage, setMonthlyUsage] = useState(42); // 模擬月用電 kWh

  // 抽籤系統
  const [lotteryStats, setLotteryStats] = useState(simulateLotteryStats());
  const [myApplication, setMyApplication] = useState<LotteryApplication | null>(null);
  const [lotteryWishes, setLotteryWishes] = useState<LotteryWish[]>([
    { priority: 1, buildingId: 'schultz', roomTypeId: 'schultz-4p' },
  ]);
  const [showPriorityInfo, setShowPriorityInfo] = useState(false);
  const [showSwapForm, setShowSwapForm] = useState(false);

  // Modals
  const [showFAQ, setShowFAQ] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [showBuildingDetail, setShowBuildingDetail] = useState<DormBuildingId | null>(null);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  const TABS = [
    { key: 'home', label: '首頁' },
    { key: 'repair', label: '報修' },
    { key: 'package', label: '包裹' },
    { key: 'laundry', label: '洗衣' },
    { key: 'lottery', label: '抽籤' },
    { key: 'community', label: '社區' },
    { key: 'info', label: '資訊' },
  ];

  // ── 載入資料 ──
  const loadData = useCallback(async () => {
    try {
      // 洗衣即時模擬
      setLaundryMachines(simulateLaundryStatus(myBuilding));
      // 抽籤資料
      setLotteryStats(simulateLotteryStats());
      setMyApplication(simulateMyApplication());

      if (!auth.user?.uid) return;
      const [di, rep, pkg, ann] = await Promise.all([
        ds.getDormitoryInfo(auth.user.uid).catch(() => null),
        ds.listRepairRequests(auth.user.uid, undefined, school?.id).catch(() => []),
        ds.listDormPackages(auth.user.uid, undefined, school?.id).catch(() => []),
        ds.listDormAnnouncements(school?.id).catch(() => []),
      ]);
      setDormInfo(di);
      setRepairs(rep);
      setPackages(pkg);
      setAnnouncements(ann);
    } catch (e) {
      console.error('[Dorm] load error:', e);
    }
  }, [auth.user?.uid, school?.id, myBuilding]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── 統計 ──
  const pendingPackages = useMemo(() => packages.filter((p) => p.status === 'pending'), [packages]);
  const activeRepairs = useMemo(
    () => repairs.filter((r) => r.status !== 'completed' && r.status !== 'cancelled'),
    [repairs],
  );
  const laundryStats = useMemo(() => getLaundryStats(laundryMachines), [laundryMachines]);
  const suggestions = useMemo(() => getSmartDormSuggestions(myBuilding), [myBuilding]);

  // ── 報修 ──
  // Map extended categories to base RepairType
  const toRepairType = (cat: RepairCategory): RepairType => {
    const map: Record<RepairCategory, RepairType> = {
      electrical: 'electrical',
      plumbing: 'plumbing',
      furniture: 'furniture',
      ac: 'ac',
      internet: 'internet',
      door_lock: 'other',
      bathroom: 'plumbing',
      pest: 'other',
      other: 'other',
    };
    return map[cat] ?? 'other';
  };

  const handleSubmitRepair = (cat: RepairCategory) => {
    if (!auth.user) return Alert.alert('請先登入', '需要登入才能報修');
    Alert.prompt(
      '問題描述',
      `請描述${REPAIR_CATEGORIES.find((c) => c.id === cat)?.label ?? ''}問題`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '送出報修',
          onPress: async (desc) => {
            if (!desc?.trim()) return Alert.alert('請輸入描述');
            const room =
              dormInfo?.building && dormInfo?.room
                ? `${dormInfo.building} ${dormInfo.room}`
                : '未指定';
            const label = REPAIR_CATEGORIES.find((c) => c.id === cat)?.label ?? '';
            try {
              const newRepair = await ds.createRepairRequest({
                type: toRepairType(cat),
                title: `${label}問題`,
                description: desc,
                room,
                userId: auth.user!.uid,
                schoolId: school?.id,
              });
              setRepairs([newRepair, ...repairs]);
              try {
                const { aiBrain } = await import('../services/aiBrain');
                aiBrain.reportToolOutcome(
                  'report_repair',
                  {
                    type: cat,
                    room,
                    description: desc.slice(0, 80),
                    location: room,
                  },
                  'success',
                  undefined,
                  `在「${room}」報修：${label}（${desc.slice(0, 40)}）`,
                );
              } catch (brainErr) {
                console.warn('[Dormitory] brain.observe failed:', brainErr);
              }
              Alert.alert('報修成功 ✅', '維修人員將盡快處理');
              void import('../services/companionEngine').then((m) =>
                m.recordCompanionFeatureSignal('dorm_repair'),
              );
            } catch (e: any) {
              try {
                const { aiBrain } = await import('../services/aiBrain');
                aiBrain.reportToolOutcome(
                  'report_repair',
                  { type: cat, room },
                  'failure',
                  e?.message,
                );
              } catch (brainErr) {
                console.warn('[Dormitory] brain.observe failed:', brainErr);
              }
              Alert.alert('報修失敗', '請稍後再試');
            }
          },
        },
      ],
      'plain-text',
    );
  };

  // ── 取件 ──
  const handlePickPackage = (pkgId: string) => {
    Alert.alert('確認取件', '確定已取得此包裹？', [
      { text: '取消', style: 'cancel' },
      {
        text: '確認',
        onPress: async () => {
          try {
            await ds.confirmPackagePickup(pkgId, school?.id);
            setPackages(
              packages.map((p) =>
                p.id === pkgId
                  ? { ...p, status: 'picked' as const, pickedAt: new Date().toISOString() }
                  : p,
              ),
            );
          } catch {
            Alert.alert('操作失敗');
          }
        },
      },
    ]);
  };

  // ── 洗衣預約 ──
  const handleReserveLaundry = (machine: LaundryMachine) => {
    if (!auth.user) return Alert.alert('請先登入');
    if (machine.status !== 'available') return;
    Alert.alert(
      '預約確認',
      `預約 ${machine.floor} ${machine.number} 號${machine.type === 'washer' ? '洗衣機' : '烘乾機'}？\n費用：$${machine.price}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認預約',
          onPress: async () => {
            try {
              await ds.reserveWashingMachine(machine.id, auth.user!.uid, school?.id);
              setLaundryMachines(
                laundryMachines.map((m) =>
                  m.id === machine.id ? { ...m, status: 'reserved' as LaundryStatus } : m,
                ),
              );
              try {
                const { aiBrain } = await import('../services/aiBrain');
                aiBrain.reportToolOutcome(
                  'reserve_washing_machine',
                  {
                    machineId: machine.id,
                    floor: machine.floor,
                    type: machine.type,
                  },
                  'success',
                  undefined,
                  `預約 ${machine.floor} ${machine.number} 號${machine.type === 'washer' ? '洗衣機' : '烘乾機'}`,
                );
              } catch (brainErr) {
                console.warn('[Dormitory] brain.observe failed:', brainErr);
              }
              Alert.alert('預約成功 ✅', '請在 10 分鐘內前往使用');
            } catch (e: any) {
              try {
                const { aiBrain } = await import('../services/aiBrain');
                aiBrain.reportToolOutcome(
                  'reserve_washing_machine',
                  { machineId: machine.id },
                  'failure',
                  e?.message,
                );
              } catch (brainErr) {
                console.warn('[Dormitory] brain.observe failed:', brainErr);
              }
              Alert.alert('預約失敗', e?.message ?? '請稍後再試');
            }
          },
        },
      ],
    );
  };

  // ── 夜歸登記 ──
  const handleLateReturn = () => {
    if (!auth.user) return Alert.alert('請先登入');
    const now = new Date();
    const h = now.getHours();
    if (h >= 6 && h < 22) return Alert.alert('提醒', '夜歸登記僅 22:00 至隔日 06:00 可使用');
    Alert.alert(
      '夜歸登記',
      `登記時間：${now.toLocaleString('zh-TW')}\n宿舍：${dormInfo?.building ?? '—'} ${dormInfo?.room ?? ''}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認登記',
          onPress: async () => {
            try {
              await ds.createLateReturnRecord({
                userId: auth.user!.uid,
                building: dormInfo?.building,
                room: dormInfo?.room,
                returnTime: now.toISOString(),
                schoolId: school?.id,
              });
              Alert.alert('登記成功 ✅', '已完成夜歸登記');
            } catch (e: any) {
              Alert.alert('登記失敗', e?.message ?? '');
            }
          },
        },
      ],
    );
  };

  // ── 訪客登記 ──
  const handleVisitorReg = () => {
    if (!auth.user) return Alert.alert('請先登入');
    Alert.prompt(
      '訪客姓名',
      '請輸入訪客姓名',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '下一步',
          onPress: (name) => {
            if (!name?.trim()) return Alert.alert('請輸入姓名');
            Alert.prompt(
              '訪客電話',
              '請輸入聯絡電話',
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '提交登記',
                  onPress: async (phone) => {
                    if (!phone?.trim()) return Alert.alert('請輸入電話');
                    try {
                      const leave = new Date();
                      leave.setHours(leave.getHours() + 2);
                      await ds.createVisitorRecord({
                        userId: auth.user!.uid,
                        visitorName: name,
                        visitorPhone: phone!,
                        building: dormInfo?.building,
                        room: dormInfo?.room,
                        arrivalTime: new Date().toISOString(),
                        expectedLeaveTime: leave.toISOString(),
                        schoolId: school?.id,
                      });
                      Alert.alert(
                        '登記成功 ✅',
                        `訪客 ${name} 已登記，預計 ${leave.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 離開`,
                      );
                    } catch (e: any) {
                      Alert.alert('登記失敗', e?.message ?? '');
                    }
                  },
                },
              ],
              'plain-text',
              '',
              'phone-pad',
            );
          },
        },
      ],
      'plain-text',
    );
  };

  // ── 快捷動作分發 ──
  const handleQuickAction = (actionId: string) => {
    switch (actionId) {
      case 'repair':
        setTab('repair');
        break;
      case 'package':
        setTab('package');
        break;
      case 'laundry':
        setTab('laundry');
        break;
      case 'community':
        setTab('community');
        break;
      case 'lottery':
        setTab('lottery');
        break;
      case 'visitor':
        handleVisitorReg();
        break;
      case 'late':
        handleLateReturn();
        break;
      case 'access':
        handleAccessApp();
        break;
      case 'emergency':
        setShowEmergency(true);
        break;
    }
  };

  // ── 門禁申請 ──
  const handleAccessApp = () => {
    if (!auth.user) return Alert.alert('請先登入');
    Alert.alert('門禁申請', '選擇申請類型', [
      {
        text: '延長門禁',
        onPress: () => {
          Alert.prompt(
            '延長門禁',
            '預計返回時間（如 23:30）',
            [
              { text: '取消', style: 'cancel' },
              {
                text: '提交',
                onPress: async (time) => {
                  if (!time?.trim()) return;
                  try {
                    await ds.createAccessApplication({
                      userId: auth.user!.uid,
                      type: 'extended_hours',
                      requestedTime: time,
                      reason: '個人需求',
                      schoolId: school?.id,
                    });
                    Alert.alert('申請成功 ✅', '請等待審核');
                  } catch (e: any) {
                    Alert.alert('申請失敗', e?.message ?? '');
                  }
                },
              },
            ],
            'plain-text',
          );
        },
      },
      {
        text: '臨時出入',
        onPress: () => {
          Alert.prompt(
            '臨時出入申請',
            '請輸入原因',
            [
              { text: '取消', style: 'cancel' },
              {
                text: '提交',
                onPress: async (reason) => {
                  if (!reason?.trim()) return;
                  try {
                    await ds.createAccessApplication({
                      userId: auth.user!.uid,
                      type: 'temporary_access',
                      reason: reason!,
                      schoolId: school?.id,
                    });
                    Alert.alert('申請成功 ✅');
                  } catch (e: any) {
                    Alert.alert('申請失敗', e?.message ?? '');
                  }
                },
              },
            ],
            'plain-text',
          );
        },
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  // ── AR 導航 ──
  const handleARNav = (buildingId: DormBuildingId) => {
    const b = DORM_BUILDINGS.find((x) => x.id === buildingId);
    if (!b) return;
    nav?.navigate('ARNavigation', {
      destination: { lat: b.lat, lng: b.lng },
      destinationName: b.name,
    });
  };

  // ══════════════════════════════════════════════════
  // TAB: 首頁
  // ══════════════════════════════════════════════════
  const renderHome = () => (
    <View style={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 我的宿舍 + 電費 */}
      <AnimatedCard>
        <View style={{ gap: 12 }}>
          {dormInfo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="home" size={28} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
                  {dormInfo.building} {dormInfo.room}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  {dormInfo.roommates?.length
                    ? `室友：${dormInfo.roommates.join('、')}`
                    : '尚無室友資料'}
                </Text>
              </View>
              <Pressable
                onPress={() => setShowEmergency(true)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: theme.colors.dangerSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="warning" size={20} color={theme.colors.danger} />
              </Pressable>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Ionicons name="home-outline" size={36} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, marginTop: 8 }}>尚未登記宿舍</Text>
            </View>
          )}

          {/* 快速統計 */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatBox
              icon="cube"
              color={theme.colors.accent}
              value={pendingPackages.length}
              label="待取包裹"
              highlight={pendingPackages.length > 0}
              onPress={() => setTab('package')}
            />
            <StatBox
              icon="construct"
              color="#F59E0B"
              value={activeRepairs.length}
              label="處理中報修"
              highlight={activeRepairs.length > 0}
              onPress={() => setTab('repair')}
            />
            <StatBox
              icon="water"
              color={theme.colors.success}
              value={laundryStats.washersAvailable}
              label="空閒洗衣"
              onPress={() => setTab('laundry')}
            />
          </View>
        </View>
      </AnimatedCard>

      {/* 智慧建議 */}
      {suggestions.length > 0 && (
        <AnimatedCard delay={60}>
          <View style={{ gap: 8 }}>
            {suggestions.map((s, i) => (
              <Pressable
                key={i}
                onPress={() => s.action && handleQuickAction(s.action)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${s.color}12`,
                }}
              >
                <Ionicons name={s.icon as any} size={18} color={s.color} />
                <Text
                  style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600', flex: 1 }}
                >
                  {s.text}
                </Text>
                {s.action && (
                  <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
                )}
              </Pressable>
            ))}
          </View>
        </AnimatedCard>
      )}

      {/* 電費卡 */}
      <AnimatedCard
        title="冷氣電費"
        subtitle={ELECTRICITY_INFO[myBuilding]?.paymentMethod ?? 'IC 卡'}
        delay={100}
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: acBalance > 50 ? theme.colors.successSoft : theme.colors.dangerSoft,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: acBalance > 50 ? theme.colors.success : theme.colors.danger,
                fontSize: 28,
                fontWeight: '800',
              }}
            >
              ${acBalance}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>卡片餘額</Text>
          </View>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface2,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>
              {monthlyUsage}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>本月 kWh</Text>
          </View>
        </View>
        {acBalance <= 50 && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              padding: 10,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.dangerSoft,
            }}
          >
            <Ionicons name="alert-circle" size={16} color={theme.colors.danger} />
            <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: '600', flex: 1 }}>
              餘額偏低！請至 {ELECTRICITY_INFO[myBuilding]?.topUpLocations[0] ?? '服務檯'} 儲值
            </Text>
          </View>
        )}
      </AnimatedCard>

      {/* 快捷服務 */}
      <AnimatedCard title="快捷服務" delay={140}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              key={action.id}
              onPress={() => handleQuickAction(action.id)}
              style={{
                width: (SCREEN_WIDTH - 56) / 4 - 8,
                paddingVertical: 12,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface2,
                alignItems: 'center',
                gap: 6,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: `${action.color}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={action.icon as any} size={20} color={action.color} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: '700' }}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* 公告 */}
      {announcements.length > 0 && (
        <AnimatedCard title="宿舍公告" delay={180}>
          <View style={{ gap: 8 }}>
            {announcements.slice(0, 3).map((ann) => {
              const typeColor: Record<string, string> = {
                notice: theme.colors.accent,
                warning: '#F59E0B',
                emergency: theme.colors.danger,
                maintenance: '#6366F1',
              };
              const color = typeColor[ann.type] ?? theme.colors.muted;
              return (
                <View
                  key={ann.id}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: `${color}12`,
                    flexDirection: 'row',
                    gap: 10,
                  }}
                >
                  <Ionicons
                    name={ann.type === 'emergency' ? 'warning' : 'alert-circle'}
                    size={18}
                    color={color}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color, fontWeight: '700', fontSize: 13 }}>{ann.title}</Text>
                    <Text
                      style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}
                      numberOfLines={2}
                    >
                      {ann.content}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </AnimatedCard>
      )}
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB: 報修
  // ══════════════════════════════════════════════════
  const renderRepair = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 報修類別選擇 */}
      <AnimatedCard title="選擇報修類別">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {REPAIR_CATEGORIES.map((cat) => (
            <Pressable
              key={cat.id}
              onPress={() => handleSubmitRepair(cat.id)}
              style={{
                width: (SCREEN_WIDTH - 56) / 3 - 7,
                paddingVertical: 14,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface2,
                alignItems: 'center',
                gap: 6,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: `${cat.color}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={cat.icon as any} size={20} color={cat.color} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700' }}>
                {cat.label}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                ~{cat.avgResponseHours}h 回應
              </Text>
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* 我的報修紀錄 */}
      <AnimatedCard title="我的報修" subtitle={`${activeRepairs.length} 件處理中`} delay={80}>
        {repairs.length === 0 ? (
          <EmptyState title="沒有報修紀錄" subtitle="設備有問題？點擊上方類別即可報修" />
        ) : (
          <View style={{ gap: 10 }}>
            {repairs.map((repair) => {
              const catInfo = REPAIR_CATEGORIES.find((c) => c.id === repair.type);
              return (
                <View
                  key={repair.id}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        backgroundColor: `${getRepairStatusColor(repair.status)}15`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name={(catInfo?.icon ?? 'construct-outline') as any}
                        size={20}
                        color={getRepairStatusColor(repair.status)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                        {repair.title}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                        {repair.room} · {formatDateTime(new Date(repair.createdAt))}
                      </Text>
                    </View>
                    <Pill
                      text={getRepairStatusLabel(repair.status)}
                      kind={
                        repair.status === 'completed'
                          ? 'success'
                          : repair.status === 'inProgress'
                            ? 'accent'
                            : 'default'
                      }
                      size="sm"
                    />
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                    {repair.description}
                  </Text>
                  {repair.status === 'completed' && repair.completedAt && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        padding: 8,
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.colors.successSoft,
                      }}
                    >
                      <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
                      <Text style={{ color: theme.colors.success, fontSize: 11 }}>
                        已於 {formatDateTime(new Date(repair.completedAt))} 完成
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </AnimatedCard>
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB: 包裹
  // ══════════════════════════════════════════════════
  const renderPackage = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 待取 */}
      {pendingPackages.length > 0 ? (
        <AnimatedCard title="待取包裹" subtitle={`${pendingPackages.length} 件`}>
          <View style={{ gap: 10 }}>
            {pendingPackages.map((pkg) => {
              const carrier = CARRIERS.find((c) => pkg.carrier?.includes(c.name));
              return (
                <View
                  key={pkg.id}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.accentSoft,
                    gap: 10,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: `${carrier?.color ?? theme.colors.accent}20`,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name={(carrier?.icon ?? 'cube-outline') as any}
                        size={22}
                        color={carrier?.color ?? theme.colors.accent}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                        {pkg.carrier}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                        {pkg.trackingNumber}
                      </Text>
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                      >
                        <Ionicons name="location" size={12} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          {pkg.location}
                        </Text>
                      </View>
                    </View>
                    <Button
                      text="已取件"
                      kind="primary"
                      size="small"
                      onPress={() => handlePickPackage(pkg.id)}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </AnimatedCard>
      ) : (
        <AnimatedCard>
          <EmptyState title="沒有待取包裹" subtitle="有新包裹到達會通知你" icon="cube-outline" />
        </AnimatedCard>
      )}

      {/* 領取地點 */}
      <AnimatedCard title="領取地點" delay={80}>
        <View style={{ gap: 8 }}>
          {PACKAGE_LOCATIONS.map((loc) => (
            <View
              key={loc.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="location-outline" size={16} color={theme.colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {loc.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  領取時間：{loc.pickupHours}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 歷史 */}
      {packages.filter((p) => p.status === 'picked').length > 0 && (
        <AnimatedCard title="已取件" delay={120}>
          <View style={{ gap: 6 }}>
            {packages
              .filter((p) => p.status === 'picked')
              .map((pkg) => (
                <View
                  key={pkg.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 6,
                    opacity: 0.6,
                  }}
                >
                  <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                  <Text style={{ color: theme.colors.text, flex: 1, fontSize: 13 }}>
                    {pkg.carrier}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已取</Text>
                </View>
              ))}
          </View>
        </AnimatedCard>
      )}
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB: 洗衣
  // ══════════════════════════════════════════════════
  const filteredMachines = useMemo(() => {
    if (laundryFilter === 'all') return laundryMachines.filter((m) => m.type !== 'dehydrator');
    return laundryMachines.filter((m) => m.type === laundryFilter);
  }, [laundryMachines, laundryFilter]);

  const renderLaundry = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 統計 */}
      <AnimatedCard>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.successSoft,
              alignItems: 'center',
            }}
          >
            <Ionicons name="water" size={24} color={theme.colors.success} />
            <Text
              style={{ color: theme.colors.success, fontSize: 24, fontWeight: '800', marginTop: 6 }}
            >
              {laundryStats.washersAvailable}
            </Text>
            <Text style={{ color: theme.colors.success, fontSize: 11 }}>
              空閒洗衣機 / {laundryStats.washersTotal}
            </Text>
          </View>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
            }}
          >
            <Ionicons name="sunny" size={24} color={theme.colors.accent} />
            <Text
              style={{ color: theme.colors.accent, fontSize: 24, fontWeight: '800', marginTop: 6 }}
            >
              {laundryStats.dryersAvailable}
            </Text>
            <Text style={{ color: theme.colors.accent, fontSize: 11 }}>
              空閒烘乾機 / {laundryStats.dryersTotal}
            </Text>
          </View>
          {laundryStats.avgWaitMinutes > 0 && (
            <View
              style={{
                flex: 1,
                padding: 14,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface2,
                alignItems: 'center',
              }}
            >
              <Ionicons name="time" size={24} color={theme.colors.muted} />
              <Text
                style={{ color: theme.colors.text, fontSize: 24, fontWeight: '800', marginTop: 6 }}
              >
                {laundryStats.avgWaitMinutes}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>平均等待(分)</Text>
            </View>
          )}
        </View>
      </AnimatedCard>

      {/* 篩選 */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            { key: 'all', label: '全部', icon: 'grid-outline' },
            { key: 'washer', label: '洗衣機', icon: 'water-outline' },
            { key: 'dryer', label: '烘乾機', icon: 'sunny-outline' },
          ] as const
        ).map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setLaundryFilter(f.key)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: theme.radius.md,
              backgroundColor:
                laundryFilter === f.key ? theme.colors.accentSoft : theme.colors.surface2,
              borderWidth: laundryFilter === f.key ? 1 : 0,
              borderColor: laundryFilter === f.key ? theme.colors.accent : 'transparent',
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Ionicons
              name={f.icon as any}
              size={16}
              color={laundryFilter === f.key ? theme.colors.accent : theme.colors.muted}
            />
            <Text
              style={{
                color: laundryFilter === f.key ? theme.colors.accent : theme.colors.muted,
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 機器列表 */}
      {filteredMachines.map((machine, idx) => (
        <AnimatedCard key={machine.id} delay={idx * 30}>
          <Pressable
            onPress={() => handleReserveLaundry(machine)}
            disabled={machine.status !== 'available'}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: `${getLaundryStatusColor(machine.status)}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={machine.type === 'washer' ? 'water' : 'sunny'}
                  size={24}
                  color={getLaundryStatusColor(machine.status)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                  {machine.number} 號{machine.type === 'washer' ? '洗衣機' : '烘乾機'}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  {machine.floor} · {machine.capacity} · ${machine.price}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Pill
                  text={getLaundryStatusLabel(machine.status)}
                  kind={
                    machine.status === 'available'
                      ? 'success'
                      : machine.status === 'finished'
                        ? 'accent'
                        : 'default'
                  }
                  size="sm"
                />
                {machine.status === 'inUse' && machine.remainingMinutes > 0 && (
                  <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '600' }}>
                    剩 {machine.remainingMinutes} 分
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
        </AnimatedCard>
      ))}

      {/* 費用 */}
      <AnimatedCard title="費用說明" delay={200}>
        <View style={{ gap: 6 }}>
          <PriceRow label="洗衣機（每次）" price="$20" />
          <PriceRow label="烘乾機（每次）" price="$10" />
          <PriceRow label="脫水機" price="免費" />
        </View>
      </AnimatedCard>
    </View>
  );

  // ══════════════════════════════════════════════════
  // 抽籤操作
  // ══════════════════════════════════════════════════

  const handleSubmitLottery = () => {
    if (!auth.user) return Alert.alert('請先登入', '需要登入才能申請抽籤');
    if (lotteryWishes.length === 0) return Alert.alert('請至少填寫一個志願');
    Alert.alert('確認送出', `將送出 ${lotteryWishes.length} 個志願，送出後可在確認期前修改`, [
      { text: '取消', style: 'cancel' },
      {
        text: '送出申請',
        onPress: () => {
          setMyApplication({
            id: `app-${Date.now()}`,
            userId: auth.user!.uid,
            userName: '同學',
            status: 'submitted',
            wishes: lotteryWishes,
            preferredRoommates: [],
            priorityPoints: 38,
            priorityBreakdown: [
              { ruleId: 'distance', points: 20 },
              { ruleId: 'gpa_mid', points: 8 },
              { ruleId: 'good_record', points: 5 },
              { ruleId: 'dorm_staff_bonus', points: 5 },
            ],
            appliedAt: new Date().toISOString(),
          });
          Alert.alert('申請成功 ✅', '志願已送出，可在截止前修改');
        },
      },
    ]);
  };

  const handleConfirmLottery = () => {
    if (!myApplication || myApplication.status !== 'won') return;
    Alert.alert(
      '確認入住',
      `確認入住 ${DORM_BUILDINGS.find((b) => b.id === myApplication.resultBuildingId)?.name ?? ''} ${myApplication.resultRoom ?? ''}？\n確認後需在 7 日內完成繳費`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認入住',
          onPress: () => {
            setMyApplication({
              ...myApplication,
              status: 'confirmed',
              confirmedAt: new Date().toISOString(),
            });
            Alert.alert('確認成功 ✅', '請於 7 日內至出納組完成繳費');
          },
        },
        {
          text: '放棄資格',
          style: 'destructive',
          onPress: () => {
            Alert.alert('確認放棄', '放棄後名額將轉給候補同學，無法復原', [
              { text: '再想想', style: 'cancel' },
              {
                text: '確認放棄',
                style: 'destructive',
                onPress: () => {
                  setMyApplication({ ...myApplication, status: 'forfeited' });
                },
              },
            ]);
          },
        },
      ],
    );
  };

  const handleAddWish = () => {
    if (lotteryWishes.length >= 3) return Alert.alert('最多 3 個志願');
    setLotteryWishes([
      ...lotteryWishes,
      {
        priority: lotteryWishes.length + 1,
        buildingId: 'schultz',
        roomTypeId: 'schultz-4p',
      },
    ]);
  };

  const handleRemoveWish = (idx: number) => {
    const next = lotteryWishes
      .filter((_, i) => i !== idx)
      .map((w, i) => ({ ...w, priority: i + 1 }));
    setLotteryWishes(next);
  };

  const handleSwapRequest = () => {
    if (!auth.user) return Alert.alert('請先登入');
    Alert.prompt(
      '換房申請',
      '請輸入對方房號（如 A棟-305）',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '下一步',
          onPress: (targetRoom) => {
            if (!targetRoom?.trim()) return;
            Alert.prompt(
              '換房原因',
              '請簡述換房原因',
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '送出申請',
                  onPress: (reason) => {
                    if (!reason?.trim()) return;
                    Alert.alert('申請已送出 ✅', '對方確認後將由住服組審核');
                  },
                },
              ],
              'plain-text',
            );
          },
        },
      ],
      'plain-text',
    );
  };

  // ══════════════════════════════════════════════════
  // TAB: 抽籤
  // ══════════════════════════════════════════════════
  const renderLottery = () => {
    const phase = lotteryStats.currentPhase;
    const isApplying = phase === 'applying';
    const isAnnounced = phase === 'announced';
    const isConfirming = phase === 'confirming';
    const hasApp = !!myApplication && myApplication.status !== 'cancelled';

    return (
      <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {/* ── 抽籤時程 ── */}
        <AnimatedCard
          title="抽籤時程"
          subtitle={`${lotteryStats.totalApplicants} 人申請 / ${lotteryStats.totalBeds} 床位`}
        >
          <View style={{ gap: 6 }}>
            {LOTTERY_TIMELINE.filter((t) => t.phase !== 'closed').map((t, i) => {
              const isCurrent = t.phase === phase;
              const isPast = LOTTERY_TIMELINE.findIndex((x) => x.phase === phase) > i;
              return (
                <View
                  key={t.phase}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: isCurrent
                      ? theme.colors.accentSoft
                      : isPast
                        ? theme.colors.successSoft
                        : theme.colors.surface2,
                    borderWidth: isCurrent ? 1 : 0,
                    borderColor: isCurrent ? theme.colors.accent : 'transparent',
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: isCurrent
                        ? theme.colors.accent
                        : isPast
                          ? theme.colors.success
                          : theme.colors.surface2,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons
                      name={(isPast ? 'checkmark' : t.icon) as any}
                      size={18}
                      color={isCurrent || isPast ? '#FFF' : theme.colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: isCurrent
                          ? theme.colors.accent
                          : isPast
                            ? theme.colors.success
                            : theme.colors.text,
                        fontWeight: isCurrent ? '800' : '600',
                        fontSize: 13,
                      }}
                    >
                      {t.label}
                      {isCurrent && '  ← 目前階段'}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                      {t.dateRange} · {t.description}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </AnimatedCard>

        {/* ── 各棟競爭度 ── */}
        <AnimatedCard title="各棟競爭度" delay={60}>
          <View style={{ gap: 10 }}>
            {lotteryStats.buildingStats.map((bs) => {
              const bld = DORM_BUILDINGS.find((b) => b.id === bs.building);
              const ratio = bs.applicants / bs.beds;
              const tension = ratio > 1 ? 'danger' : ratio > 0.7 ? 'warning' : 'safe';
              const tensionColor =
                tension === 'danger'
                  ? theme.colors.danger
                  : tension === 'warning'
                    ? '#F59E0B'
                    : theme.colors.success;
              return (
                <View
                  key={bs.building}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                      {bld?.name ?? bs.building}
                    </Text>
                    <Text style={{ color: tensionColor, fontWeight: '800', fontSize: 15 }}>
                      {Math.round(bs.rate * 100)}%
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: `${tensionColor}20`,
                      }}
                    >
                      <View
                        style={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: tensionColor,
                          width: `${Math.min(bs.rate * 100, 100)}%`,
                        }}
                      />
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      申請 {bs.applicants} 人
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      床位 {bs.beds} 個
                    </Text>
                    <Text style={{ color: tensionColor, fontSize: 11, fontWeight: '600' }}>
                      {tension === 'danger'
                        ? '競爭激烈'
                        : tension === 'warning'
                          ? '中等競爭'
                          : '名額充裕'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </AnimatedCard>

        {/* ── 我的申請 ── */}
        {hasApp ? (
          <AnimatedCard title="我的申請" delay={100}>
            <View style={{ gap: 12 }}>
              {/* 狀態 */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: `${getLotteryStatusColor(myApplication!.status)}12`,
                }}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: `${getLotteryStatusColor(myApplication!.status)}25`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={
                      myApplication!.status === 'won'
                        ? 'trophy'
                        : myApplication!.status === 'confirmed'
                          ? 'checkmark-circle'
                          : 'document-text'
                    }
                    size={24}
                    color={getLotteryStatusColor(myApplication!.status)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: getLotteryStatusColor(myApplication!.status),
                      fontWeight: '800',
                      fontSize: 16,
                    }}
                  >
                    {getLotteryStatusLabel(myApplication!.status)}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                    積分 {myApplication!.priorityPoints} 分 · 志願 {myApplication!.wishes.length} 個
                  </Text>
                </View>
                {myApplication!.status === 'won' && (
                  <Button
                    text="確認入住"
                    kind="primary"
                    size="small"
                    onPress={handleConfirmLottery}
                  />
                )}
              </View>

              {/* 志願列表 */}
              <View style={{ gap: 6 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                  志願序
                </Text>
                {myApplication!.wishes.map((w) => {
                  const bld = DORM_BUILDINGS.find((b) => b.id === w.buildingId);
                  const rt = ROOM_TYPES.find((r) => r.id === w.roomTypeId);
                  return (
                    <View
                      key={w.priority}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: theme.colors.accentSoft,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 13 }}
                        >
                          {w.priority}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: theme.colors.text,
                          fontWeight: '600',
                          flex: 1,
                          fontSize: 13,
                        }}
                      >
                        {bld?.name ?? w.buildingId} · {rt ? `${rt.occupancy}人房` : w.roomTypeId}
                      </Text>
                      {rt && (
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          ${rt.totalCost.toLocaleString()}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* 積分明細 */}
              <Pressable onPress={() => setShowPriorityInfo(!showPriorityInfo)}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                    積分明細
                  </Text>
                  <Ionicons
                    name={showPriorityInfo ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={theme.colors.muted}
                  />
                </View>
              </Pressable>
              {showPriorityInfo && (
                <View style={{ gap: 6 }}>
                  {myApplication!.priorityBreakdown.map((bd) => {
                    const rule = PRIORITY_RULES.find((r) => r.id === bd.ruleId);
                    return (
                      <View
                        key={bd.ruleId}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          padding: 8,
                          borderRadius: theme.radius.sm,
                          backgroundColor: theme.colors.surface2,
                        }}
                      >
                        <Ionicons
                          name={(rule?.icon ?? 'add-outline') as any}
                          size={16}
                          color={theme.colors.accent}
                        />
                        <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1 }}>
                          {rule?.label ?? bd.ruleId}
                        </Text>
                        <Text
                          style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 13 }}
                        >
                          +{bd.points}
                        </Text>
                      </View>
                    );
                  })}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingTop: 8,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>總分</Text>
                    <Text style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 16 }}>
                      {myApplication!.priorityPoints} 分
                    </Text>
                  </View>
                </View>
              )}

              {/* 中籤結果 */}
              {myApplication!.resultRoom && (
                <View
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.successSoft,
                    gap: 6,
                  }}
                >
                  <Text style={{ color: theme.colors.success, fontWeight: '800', fontSize: 15 }}>
                    分配結果
                  </Text>
                  <Text style={{ color: theme.colors.text, fontSize: 13 }}>
                    {DORM_BUILDINGS.find((b) => b.id === myApplication!.resultBuildingId)?.name}{' '}
                    {myApplication!.resultRoom}
                  </Text>
                  {myApplication!.resultRoommates && myApplication!.resultRoommates.length > 0 && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                      室友：{myApplication!.resultRoommates.join('、')}
                    </Text>
                  )}
                </View>
              )}
            </View>
          </AnimatedCard>
        ) : isApplying ? (
          /* ── 新申請表單 ── */
          <AnimatedCard title="填寫志願" subtitle="最多 3 個志願" delay={100}>
            <View style={{ gap: 12 }}>
              {lotteryWishes.map((w, idx) => {
                const buildingRoomTypes = ROOM_TYPES.filter((r) => r.building === w.buildingId);
                return (
                  <View
                    key={idx}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      gap: 10,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: theme.colors.accentSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: theme.colors.accent, fontWeight: '800' }}>
                            {idx + 1}
                          </Text>
                        </View>
                        <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                          第 {idx + 1} 志願
                        </Text>
                      </View>
                      {lotteryWishes.length > 1 && (
                        <Pressable onPress={() => handleRemoveWish(idx)}>
                          <Ionicons name="close-circle" size={22} color={theme.colors.danger} />
                        </Pressable>
                      )}
                    </View>

                    {/* 宿舍選擇 */}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {DORM_BUILDINGS.map((bld) => (
                        <Pressable
                          key={bld.id}
                          onPress={() => {
                            const next = [...lotteryWishes];
                            next[idx] = {
                              ...next[idx],
                              buildingId: bld.id,
                              roomTypeId: ROOM_TYPES.find((r) => r.building === bld.id)?.id ?? '',
                            };
                            setLotteryWishes(next);
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: theme.radius.md,
                            backgroundColor:
                              w.buildingId === bld.id ? theme.colors.accentSoft : theme.colors.bg,
                            borderWidth: w.buildingId === bld.id ? 1 : 0,
                            borderColor:
                              w.buildingId === bld.id ? theme.colors.accent : 'transparent',
                            alignItems: 'center',
                          }}
                        >
                          <Text
                            style={{
                              color:
                                w.buildingId === bld.id ? theme.colors.accent : theme.colors.muted,
                              fontWeight: '600',
                              fontSize: 11,
                            }}
                          >
                            {bld.name.slice(0, 2)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {/* 房型選擇 */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {buildingRoomTypes.map((rt) => (
                        <Pressable
                          key={rt.id}
                          onPress={() => {
                            const next = [...lotteryWishes];
                            next[idx] = { ...next[idx], roomTypeId: rt.id };
                            setLotteryWishes(next);
                          }}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: theme.radius.full,
                            backgroundColor:
                              w.roomTypeId === rt.id ? theme.colors.accent : theme.colors.bg,
                          }}
                        >
                          <Text
                            style={{
                              color: w.roomTypeId === rt.id ? '#FFF' : theme.colors.text,
                              fontWeight: '600',
                              fontSize: 12,
                            }}
                          >
                            {rt.occupancy}人房 ${rt.totalCost.toLocaleString()}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })}

              {lotteryWishes.length < 3 && (
                <Pressable
                  onPress={handleAddWish}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: 12,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderStyle: 'dashed',
                  }}
                >
                  <Ionicons name="add-circle-outline" size={18} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 13 }}>
                    新增志願
                  </Text>
                </Pressable>
              )}

              <Button text="送出申請" kind="primary" onPress={handleSubmitLottery} />
            </View>
          </AnimatedCard>
        ) : (
          <AnimatedCard delay={100}>
            <EmptyState
              title={phase === 'closed' ? '抽籤尚未開放' : '抽籤進行中'}
              subtitle={
                phase === 'closed'
                  ? '下一期抽籤約在每年 6 月開放申請'
                  : '系統正在進行抽籤作業，請耐心等候'
              }
              icon={phase === 'closed' ? 'lock-closed-outline' : 'hourglass-outline'}
            />
          </AnimatedCard>
        )}

        {/* ── 積分規則 ── */}
        <AnimatedCard title="優先積分規則" subtitle="分數越高中籤機率越大" delay={140}>
          <View style={{ gap: 6 }}>
            {PRIORITY_RULES.map((rule) => (
              <View
                key={rule.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={rule.icon as any} size={16} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                    {rule.label}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    {rule.description}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 14 }}>
                  +{rule.points}
                </Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* ── 換房申請 (僅住宿生) ── */}
        {dormInfo && myApplication?.status === 'confirmed' && (
          <AnimatedCard title="換房服務" subtitle="和其他住宿生互換房間" delay={180}>
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                換房流程：提出申請 → 對方確認 → 住服組審核 → 完成換房。雙方都需同意才會進入審核。
              </Text>
              <Button
                text="提出換房申請"
                kind="secondary"
                icon="swap-horizontal-outline"
                onPress={handleSwapRequest}
              />
            </View>
          </AnimatedCard>
        )}
      </View>
    );
  };

  // ══════════════════════════════════════════════════
  // TAB: 社區
  // ══════════════════════════════════════════════════
  const renderCommunity = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      <AnimatedCard title="社區功能" subtitle="和鄰居互動吧！">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {COMMUNITY_CATEGORIES.map((cat) => (
            <Pressable
              key={cat.id}
              onPress={() =>
                Alert.alert(cat.label, `${cat.description}\n\n此功能開發中，敬請期待！`)
              }
              style={{
                width: (SCREEN_WIDTH - 56) / 3 - 7,
                paddingVertical: 16,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface2,
                alignItems: 'center',
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: `${cat.color}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={cat.icon as any} size={22} color={cat.color} />
              </View>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                {cat.label}
              </Text>
              <Text
                style={{ color: theme.colors.muted, fontSize: 10, textAlign: 'center' }}
                numberOfLines={2}
              >
                {cat.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* 門禁規則 */}
      <AnimatedCard title="門禁規則" delay={80}>
        <View style={{ gap: 8 }}>
          {ACCESS_RULES.map((rule, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name="time-outline" size={16} color={theme.colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {rule.period}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  {rule.rule} — {rule.note}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 宿舍評分 */}
      <AnimatedCard
        title="宿舍評分"
        subtitle={DORM_BUILDINGS.find((b) => b.id === myBuilding)?.name ?? ''}
        delay={120}
      >
        <View style={{ gap: 10 }}>
          {getDormRatings(myBuilding).map((rating) => (
            <View
              key={rating.category}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Ionicons name={rating.icon as any} size={16} color={theme.colors.accent} />
              <Text
                style={{ color: theme.colors.text, fontWeight: '600', width: 40, fontSize: 13 }}
              >
                {rating.category}
              </Text>
              <View
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor:
                      rating.score >= 4
                        ? theme.colors.success
                        : rating.score >= 3
                          ? '#F59E0B'
                          : theme.colors.danger,
                    width: `${(rating.score / 5) * 100}%`,
                  }}
                />
              </View>
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: '700',
                  fontSize: 13,
                  width: 28,
                  textAlign: 'right',
                }}
              >
                {rating.score}
              </Text>
            </View>
          ))}
        </View>
      </AnimatedCard>
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB: 資訊
  // ══════════════════════════════════════════════════
  const renderInfo = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 三棟宿舍 */}
      <AnimatedCard title="宿舍一覽">
        <View style={{ gap: 10 }}>
          {DORM_BUILDINGS.map((bld) => (
            <Pressable
              key={bld.id}
              onPress={() => setShowBuildingDetail(bld.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor:
                    bld.gender === 'female'
                      ? '#EC489915'
                      : bld.gender === 'male'
                        ? '#3B82F615'
                        : '#8B5CF615',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name="home"
                  size={24}
                  color={
                    bld.gender === 'female'
                      ? '#EC4899'
                      : bld.gender === 'male'
                        ? '#3B82F6'
                        : '#8B5CF6'
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{bld.name}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                  {bld.englishName} · {bld.totalBeds} 床 ·{' '}
                  {bld.gender === 'female' ? '女宿' : bld.gender === 'male' ? '男宿' : '男女皆有'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* 房型費用 */}
      <AnimatedCard title="房型與費用" subtitle="每學期 18 週" delay={60}>
        <View style={{ gap: 8 }}>
          {ROOM_TYPES.map((rt) => (
            <View
              key={rt.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>
                  {DORM_BUILDINGS.find((b) => b.id === rt.building)?.name} {rt.occupancy}人房
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{rt.note}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.colors.accent, fontWeight: '800' }}>
                  ${rt.totalCost.toLocaleString()}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                  含 ${rt.deposit} 保證金
                </Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 房間設備 */}
      <AnimatedCard title="房間配備" delay={100}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {ROOM_EQUIPMENT.map((eq) => (
            <View
              key={eq.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Ionicons name={eq.icon as any} size={14} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 12 }}>{eq.label}</Text>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* FAQ */}
      <AnimatedCard title="常見問題" delay={140}>
        <View style={{ gap: 8 }}>
          {DORM_FAQS.slice(0, 6).map((faq, idx) => (
            <Pressable
              key={idx}
              onPress={() => setExpandedFAQ(expandedFAQ === idx ? null : idx)}
              style={{
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pill text={faq.category} size="sm" />
                <Text
                  style={{ color: theme.colors.text, fontWeight: '600', flex: 1, fontSize: 13 }}
                >
                  {faq.question}
                </Text>
                <Ionicons
                  name={expandedFAQ === idx ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={theme.colors.muted}
                />
              </View>
              {expandedFAQ === idx && (
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 12,
                    marginTop: 8,
                    lineHeight: 18,
                    paddingLeft: 8,
                  }}
                >
                  {faq.answer}
                </Text>
              )}
            </Pressable>
          ))}
          <Button text="查看更多問題" onPress={() => setShowFAQ(true)} />
        </View>
      </AnimatedCard>

      {/* 聯絡資訊 */}
      <AnimatedCard title="聯絡我們" delay={180}>
        <View style={{ gap: 8 }}>
          <InfoRow icon="call-outline" label="辦公室" value={DORM_OFFICE_INFO.phone} />
          <InfoRow
            icon="call-outline"
            label="24hr 緊急"
            value={DORM_OFFICE_INFO.emergencyPhone}
            valueColor={theme.colors.danger}
          />
          <InfoRow icon="mail-outline" label="Email" value={DORM_OFFICE_INFO.email} />
          <InfoRow icon="time-outline" label="服務時間" value={DORM_OFFICE_INFO.serviceHours} />
        </View>
      </AnimatedCard>
    </View>
  );

  // ══════════════════════════════════════════════════
  // 緊急聯絡 Modal
  // ══════════════════════════════════════════════════
  const renderEmergencyModal = () => (
    <Modal visible={showEmergency} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: 40,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 20,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.danger, fontSize: 18, fontWeight: '800' }}>
              緊急聯絡
            </Text>
            <Pressable onPress={() => setShowEmergency(false)}>
              <Ionicons name="close" size={24} color={theme.colors.muted} />
            </Pressable>
          </View>
          <View style={{ padding: 20, gap: 10 }}>
            {EMERGENCY_CONTACTS.map((contact, i) => (
              <Pressable
                key={i}
                onPress={() =>
                  void linkingOpenWithPuTronClassGate(
                    `tel:${contact.phone.replace(/[^0-9+#]/g, '')}`,
                  )
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: `${contact.color}12`,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: `${contact.color}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={contact.icon as any} size={22} color={contact.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                    {contact.label}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {contact.note}
                  </Text>
                </View>
                <Text style={{ color: contact.color, fontWeight: '800', fontSize: 15 }}>
                  {contact.phone}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );

  // ══════════════════════════════════════════════════
  // 宿舍詳情 Modal
  // ══════════════════════════════════════════════════
  const renderBuildingDetailModal = () => {
    const bld = DORM_BUILDINGS.find((b) => b.id === showBuildingDetail);
    if (!bld) return null;
    return (
      <Modal visible={!!showBuildingDetail} animationType="slide" transparent>
        <View
          style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }}
        >
          <View
            style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '85%',
              paddingBottom: 40,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 20,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
                {bld.name}
              </Text>
              <Pressable onPress={() => setShowBuildingDetail(null)}>
                <Ionicons name="close" size={24} color={theme.colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={{ gap: 16, paddingBottom: 20 }}>
                <View style={{ gap: 8 }}>
                  <InfoRow icon="globe-outline" label="英文名" value={bld.englishName} />
                  <InfoRow icon="information-circle-outline" label="命名" value={bld.nameOrigin} />
                  <InfoRow
                    icon="people-outline"
                    label="性別"
                    value={
                      bld.gender === 'female' ? '女宿' : bld.gender === 'male' ? '男宿' : '男女皆有'
                    }
                  />
                  <InfoRow icon="layers-outline" label="樓層" value={`${bld.floors} 層`} />
                  <InfoRow icon="bed-outline" label="總床位" value={`${bld.totalBeds} 床`} />
                  <InfoRow icon="call-outline" label="內線撥號" value={bld.dialExample} />
                </View>

                <View>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 8 }}>
                    公共設施
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {bld.facilities.map((f) => (
                      <Pill key={f} text={f} size="sm" />
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 8 }}>
                    特色
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {bld.features.map((f) => (
                      <Pill key={f} text={f} kind="accent" size="sm" />
                    ))}
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button
                    text="AR 導航"
                    kind="primary"
                    icon="navigate-outline"
                    onPress={() => {
                      setShowBuildingDetail(null);
                      handleARNav(bld.id);
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════════
  // FAQ Modal
  // ══════════════════════════════════════════════════
  const renderFAQModal = () => (
    <Modal visible={showFAQ} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: '85%',
            paddingBottom: 40,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 20,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
              常見問題
            </Text>
            <Pressable onPress={() => setShowFAQ(false)}>
              <Ionicons name="close" size={24} color={theme.colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={{ padding: 20 }}>
            <View style={{ gap: 8, paddingBottom: 20 }}>
              {DORM_FAQS.map((faq, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => setExpandedFAQ(expandedFAQ === idx ? null : idx)}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Pill text={faq.category} size="sm" />
                    <Text
                      style={{ color: theme.colors.text, fontWeight: '600', flex: 1, fontSize: 13 }}
                    >
                      {faq.question}
                    </Text>
                    <Ionicons
                      name={expandedFAQ === idx ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={theme.colors.muted}
                    />
                  </View>
                  {expandedFAQ === idx && (
                    <Text
                      style={{
                        color: theme.colors.muted,
                        fontSize: 12,
                        marginTop: 8,
                        lineHeight: 18,
                        paddingLeft: 8,
                      }}
                    >
                      {faq.answer}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ══════════════════════════════════════════════════
  // Main Render
  // ══════════════════════════════════════════════════
  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={tab} onChange={(k) => setTab(k)} />

        <ScrollView
          style={{ flex: 1, marginTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'home' && renderHome()}
          {tab === 'repair' && renderRepair()}
          {tab === 'package' && renderPackage()}
          {tab === 'laundry' && renderLaundry()}
          {tab === 'lottery' && renderLottery()}
          {tab === 'community' && renderCommunity()}
          {tab === 'info' && renderInfo()}
        </ScrollView>
      </View>

      {renderEmergencyModal()}
      {renderBuildingDetailModal()}
      {renderFAQModal()}
    </Screen>
  );
}

// ══════════════════════════════════════════════════
// 子元件
// ══════════════════════════════════════════════════

function StatBox({
  icon,
  color,
  value,
  label,
  highlight,
  onPress,
}: {
  icon: string;
  color: string;
  value: number;
  label: string;
  highlight?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        padding: 12,
        borderRadius: theme.radius.lg,
        backgroundColor: highlight ? `${color}15` : theme.colors.surface2,
        borderWidth: highlight ? 1 : 0,
        borderColor: highlight ? color : 'transparent',
        alignItems: 'center',
      }}
    >
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '800', marginTop: 4 }}>
        {value}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{label}</Text>
    </Pressable>
  );
}

function PriceRow({ label, price }: { label: string; price: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: 13 }}>{price}</Text>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: string;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name={icon as any} size={16} color={theme.colors.muted} />
      <Text style={{ color: theme.colors.muted, fontSize: 13, width: 60 }}>{label}</Text>
      <Text
        style={{ color: valueColor ?? theme.colors.text, fontWeight: '600', fontSize: 13, flex: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}
