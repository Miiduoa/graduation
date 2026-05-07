/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
/**
 * 靜宜大學列印服務 — 商業級智慧列印體驗
 *
 * 創新功能：
 * 1. 場景快速啟動 — 交作業/報告/海報/論文/考古題/掃描 一鍵設定
 * 2. 智慧推薦引擎 — 根據需求推薦最佳印表機（含即時排隊/耗材/距離）
 * 3. 雲端列印流程 — 上傳 → 預覽 → QR Code → 到機器取件
 * 4. 即時機器狀態 — 碳粉/紙張/排隊視覺化 + 時段繁忙度
 * 5. 環保積分系統 — 雙面列印省點數 + 累積綠色等級 + 獎勵
 * 6. 點數餘額追蹤 — 消費分析 + 省錢建議 + 角色免費額度
 * 7. AR 找最近印表機 — 從地圖直接導航到機器旁
 * 8. 常見問題即時查 — 不用打電話也能解決 90% 問題
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
import * as DocumentPicker from 'expo-document-picker';
import {
  Screen,
  AnimatedCard,
  Card,
  Button,
  Pill,
  SegmentedControl,
  SearchBar,
  ProgressRing,
  EmptyState,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useDataSource } from '../hooks/useDataSource';
import { useSchool } from '../state/school';
import { formatDateTime } from '../utils/format';
import type { PrintJob } from '../data/types';

import {
  PRINT_SERVICE_INFO,
  PRICING_RULES,
  calculateCost,
  type PaperSize,
  type ColorMode,
  type PrintMode,
  PRINT_STATIONS,
  type PrintStation,
  type MachineStatus,
  type MachineType,
  getStationStatusLabel,
  getStationStatusColor,
  getMachineTypeLabel,
  getMachineTypeIcon,
  recommendStation,
  type PrintRecommendation,
  ECO_ACTIONS,
  ECO_LEVELS,
  getEcoLevel,
  type EcoAction,
  type EcoLevel,
  PRINT_QUOTAS,
  PRINT_SCENARIOS,
  type PrintScenario,
  simulateStationStatus,
  PRINT_FAQS,
  type PrintFAQ,
  ROLE_PRINT_ACCESS,
} from '../data/puPrintData';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ═══════════════════════════════════════════════════
// 主畫面
// ═══════════════════════════════════════════════════

export function PrintServiceScreen(props: any) {
  const nav = props?.navigation;
  const ds = useDataSource();
  const auth = useAuth();
  const { school } = useSchool();

  const [selectedTab, setSelectedTab] = useState<string>('home');
  const [refreshing, setRefreshing] = useState(false);

  // 列印設定
  const [selectedScenario, setSelectedScenario] = useState<PrintScenario | null>(null);
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [colorMode, setColorMode] = useState<ColorMode>('bw');
  const [duplex, setDuplex] = useState(true);
  const [copies, setCopies] = useState(1);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    uri: string;
    size: number;
  } | null>(null);

  // 機器狀態
  const [stations, setStations] = useState<PrintStation[]>(PRINT_STATIONS);
  const [selectedStation, setSelectedStation] = useState<PrintStation | null>(null);
  const [stationFilter, setStationFilter] = useState<
    'all' | 'printer' | 'copier' | 'multifunction'
  >('all');

  // 紀錄
  const [jobs, setJobs] = useState<PrintJob[]>([]);

  // 點數 & 環保
  const [cardBalance, setCardBalance] = useState(87); // 模擬餘額
  const [ecoPoints, setEcoPoints] = useState(42); // 模擬環保積分
  const [totalPrintedPages, setTotalPrintedPages] = useState(156);

  // Modals
  const [showStationDetail, setShowStationDetail] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [showCostCalc, setShowCostCalc] = useState(false);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  type PrintTab = 'home' | 'machines' | 'history' | 'eco';
  const TABS = [
    { key: 'home', label: '首頁' },
    { key: 'machines', label: '機器' },
    { key: 'history', label: '紀錄' },
    { key: 'eco', label: '環保' },
  ];

  // ── 載入資料 ──
  const loadData = useCallback(async () => {
    try {
      const updated = simulateStationStatus();
      setStations(updated);
      if (auth.user?.uid) {
        const jobsData = await ds
          .listPrintJobs(auth.user.uid, undefined, school?.id)
          .catch(() => []);
        setJobs(jobsData);
      }
    } catch (e) {
      console.error('[PrintService] load error:', e);
    }
  }, [auth.user?.uid, school?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── 場景選擇 ──
  const handleSelectScenario = (scenario: PrintScenario) => {
    setSelectedScenario(scenario);
    setPaperSize(scenario.defaults.paperSize);
    setColorMode(scenario.defaults.colorMode);
    setDuplex(scenario.defaults.duplex);

    // 自動推薦最佳機器
    const recs = recommendStation({
      needColor: scenario.defaults.colorMode === 'color',
      needA3: scenario.defaults.paperSize === 'A3',
      needScan: scenario.id === 'scan',
      needCloud: scenario.defaults.needCloud,
    });
    if (recs.length > 0) setSelectedStation(recs[0].station);
  };

  // ── 選檔案 ──
  const handleSelectFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/*',
        ],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const f = result.assets[0];
        setSelectedFile({ name: f.name, uri: f.uri, size: f.size || 0 });
      }
    } catch {
      Alert.alert('錯誤', '無法選擇檔案');
    }
  };

  // ── 送出列印 ──
  const handleSubmitPrint = () => {
    if (!auth.user) return Alert.alert('請先登入', '需要登入才能使用列印服務');
    if (!selectedFile) return Alert.alert('請選擇檔案', '請先上傳要列印的文件');
    if (!selectedStation) return Alert.alert('請選擇機器', '請先選擇要使用的印表機');

    const estPages = Math.max(1, Math.ceil(selectedFile.size / 50000));
    const { points, estimatedNTD } = calculateCost(estPages, copies, paperSize, colorMode, duplex);

    Alert.alert(
      '確認列印',
      `📄 ${selectedFile.name}\n🖨️ ${selectedStation.name}\n📊 預估 ${estPages} 頁 × ${copies} 份\n${colorMode === 'color' ? '🌈 彩色' : '⬛ 黑白'} / ${duplex ? '雙面' : '單面'}\n\n💰 ${points} 點 (≈$${estimatedNTD})${duplex ? '\n🌿 +2 環保積分（雙面列印）' : ''}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認送出',
          onPress: async () => {
            try {
              const newJob = await ds.createPrintJob({
                userId: auth.user!.uid,
                schoolId: school?.id,
                printerId: selectedStation.id,
                fileName: selectedFile.name,
                fileUrl: selectedFile.uri,
                pages: estPages,
                copies,
                color: colorMode === 'color',
                duplex,
              });
              setJobs([newJob, ...jobs]);
              setCardBalance(Math.max(0, cardBalance - points));
              if (duplex) setEcoPoints(ecoPoints + 2);
              setTotalPrintedPages(totalPrintedPages + estPages * copies);
              setSelectedFile(null);
              setSelectedScenario(null);
              setSelectedTab('history');
              Alert.alert(
                '已送出 ✅',
                `列印工作已送至 ${selectedStation.name}\n${duplex ? '🌿 獲得 2 環保積分！' : ''}`,
              );
            } catch (err: any) {
              Alert.alert('送出失敗', err?.message ?? '請稍後再試');
            }
          },
        },
      ],
    );
  };

  // ── AR 導航 ──
  const handleARNav = (station: PrintStation) => {
    nav?.navigate('ARNavigation', {
      destination: { lat: station.lat, lng: station.lng },
      destinationName: station.name,
    });
  };

  // ── 推薦結果 ──
  const recommendations = useMemo(() => {
    return recommendStation({
      needColor: colorMode === 'color',
      needA3: paperSize === 'A3',
      needCloud: true,
    });
  }, [colorMode, paperSize, stations]);

  // ── 篩選機器 ──
  const filteredStations = useMemo(() => {
    if (stationFilter === 'all') return stations;
    return stations.filter((s) => s.type === stationFilter);
  }, [stations, stationFilter]);

  // ── 環保等級 ──
  const currentEcoLevel = getEcoLevel(ecoPoints);
  const nextLevel = ECO_LEVELS.find((l) => l.minPoints > ecoPoints);

  // ── 時段問候語 ──
  const getTimeGreeting = () => {
    const h = new Date().getHours();
    if (h < 10) return { text: '早安！趁人少趕快印 🌅', tip: '上午時段排隊人數較少' };
    if (h < 12) return { text: '上午好！期中考前衝刺？ 📝', tip: '10-12 點為尖峰時段' };
    if (h < 14) return { text: '午安！午休時間人較少 ☀️', tip: '中午時段比較空閒' };
    if (h < 17) return { text: '下午好！交作業的好時機 📋', tip: '14-17 點為尖峰時段' };
    if (h < 21) return { text: '傍晚了！記得在閉館前列印 🌆', tip: '服務至 21:00 止' };
    return { text: '圖書館已閉館 🌙', tip: '明天再來吧！' };
  };

  const greeting = getTimeGreeting();

  // ══════════════════════════════════════════════════
  // TAB 0: 首頁 — 場景快速啟動 + 智慧推薦
  // ══════════════════════════════════════════════════
  const renderHome = () => (
    <View style={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 時段問候 + 卡片餘額 */}
      <AnimatedCard>
        <View style={{ gap: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800' }}>
                {greeting.text}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                {greeting.tip}
              </Text>
            </View>
            <Pressable
              onPress={() => setShowFAQ(true)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="help-circle-outline" size={20} color={theme.colors.muted} />
            </Pressable>
          </View>

          {/* 快速統計 */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View
              style={{
                flex: 1,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accentSoft,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 22, fontWeight: '800' }}>
                {cardBalance}
              </Text>
              <Text style={{ color: theme.colors.accent, fontSize: 11, marginTop: 2 }}>
                剩餘點數
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.successSoft,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.colors.success, fontSize: 22, fontWeight: '800' }}>
                {ecoPoints}
              </Text>
              <Text style={{ color: theme.colors.success, fontSize: 11, marginTop: 2 }}>
                環保積分
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '800' }}>
                {totalPrintedPages}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                已印頁數
              </Text>
            </View>
          </View>
        </View>
      </AnimatedCard>

      {/* 場景快速啟動 */}
      <AnimatedCard title="我要做什麼？" delay={80}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {PRINT_SCENARIOS.map((sc) => (
            <Pressable
              key={sc.id}
              onPress={() => handleSelectScenario(sc)}
              style={{
                width: (SCREEN_WIDTH - 56) / 3 - 7,
                paddingVertical: 14,
                paddingHorizontal: 6,
                borderRadius: theme.radius.lg,
                backgroundColor:
                  selectedScenario?.id === sc.id ? theme.colors.accentSoft : theme.colors.surface2,
                borderWidth: selectedScenario?.id === sc.id ? 1.5 : 0,
                borderColor: selectedScenario?.id === sc.id ? theme.colors.accent : 'transparent',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Ionicons
                name={sc.icon as any}
                size={24}
                color={selectedScenario?.id === sc.id ? theme.colors.accent : theme.colors.muted}
              />
              <Text
                style={{
                  color: selectedScenario?.id === sc.id ? theme.colors.accent : theme.colors.text,
                  fontWeight: '700',
                  fontSize: 13,
                }}
              >
                {sc.label}
              </Text>
              <Text
                style={{ color: theme.colors.muted, fontSize: 10, textAlign: 'center' }}
                numberOfLines={2}
              >
                {sc.description}
              </Text>
            </Pressable>
          ))}
        </View>
        {selectedScenario?.savingTip && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 10,
              padding: 10,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.successSoft,
            }}
          >
            <Ionicons name="bulb-outline" size={16} color={theme.colors.success} />
            <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '600', flex: 1 }}>
              {selectedScenario.savingTip}
            </Text>
          </View>
        )}
      </AnimatedCard>

      {/* 上傳檔案 */}
      <AnimatedCard title="上傳檔案" delay={120}>
        {selectedFile ? (
          <View style={{ gap: 10 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="document" size={22} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700' }} numberOfLines={1}>
                  {selectedFile.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  {(selectedFile.size / 1024).toFixed(1)} KB · 預估{' '}
                  {Math.max(1, Math.ceil(selectedFile.size / 50000))} 頁
                </Text>
              </View>
              <Pressable onPress={() => setSelectedFile(null)}>
                <Ionicons name="close-circle" size={24} color={theme.colors.muted} />
              </Pressable>
            </View>
            <Button text="更換檔案" onPress={handleSelectFile} />
          </View>
        ) : (
          <Pressable
            onPress={handleSelectFile}
            style={{
              alignItems: 'center',
              padding: 28,
              borderRadius: theme.radius.lg,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: theme.colors.border,
            }}
          >
            <Ionicons name="cloud-upload-outline" size={44} color={theme.colors.muted} />
            <Text
              style={{ color: theme.colors.text, fontWeight: '700', marginTop: 10, fontSize: 15 }}
            >
              點擊上傳檔案
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
              PDF、Word、圖片
            </Text>
          </Pressable>
        )}
      </AnimatedCard>

      {/* 列印選項 */}
      <AnimatedCard title="列印設定" delay={160}>
        <View style={{ gap: 14 }}>
          {/* 紙張大小 */}
          <View>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: 12,
                fontWeight: '600',
                marginBottom: 8,
              }}
            >
              紙張大小
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['A4', 'B4', 'A3'] as PaperSize[]).map((size) => (
                <Pressable
                  key={size}
                  onPress={() => setPaperSize(size)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor:
                      paperSize === size ? theme.colors.accentSoft : theme.colors.surface2,
                    borderWidth: paperSize === size ? 1.5 : 0,
                    borderColor: paperSize === size ? theme.colors.accent : 'transparent',
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: paperSize === size ? theme.colors.accent : theme.colors.text,
                      fontWeight: '700',
                    }}
                  >
                    {size}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 色彩 */}
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="color-palette-outline" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>彩色列印</Text>
            </View>
            <ToggleSwitch
              value={colorMode === 'color'}
              onToggle={() => setColorMode(colorMode === 'color' ? 'bw' : 'color')}
            />
          </View>

          {/* 雙面 */}
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="copy-outline" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>雙面列印</Text>
              {duplex && <Pill text="+2 🌿" kind="success" size="sm" />}
            </View>
            <ToggleSwitch value={duplex} onToggle={() => setDuplex(!duplex)} />
          </View>

          {/* 份數 */}
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="layers-outline" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>份數</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                onPress={() => setCopies(Math.max(1, copies - 1))}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: theme.colors.surface2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="remove" size={18} color={theme.colors.text} />
              </Pressable>
              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: '800',
                  fontSize: 16,
                  minWidth: 28,
                  textAlign: 'center',
                }}
              >
                {copies}
              </Text>
              <Pressable
                onPress={() => setCopies(Math.min(99, copies + 1))}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      </AnimatedCard>

      {/* 智慧推薦機器 */}
      {recommendations.length > 0 && (
        <AnimatedCard title="推薦印表機" subtitle="根據你的設定自動推薦" delay={200}>
          <View style={{ gap: 10 }}>
            {recommendations.slice(0, 3).map((rec, idx) => (
              <Pressable
                key={rec.station.id}
                onPress={() => setSelectedStation(rec.station)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor:
                    selectedStation?.id === rec.station.id
                      ? theme.colors.accentSoft
                      : theme.colors.surface2,
                  borderWidth: selectedStation?.id === rec.station.id ? 1.5 : 0,
                  borderColor:
                    selectedStation?.id === rec.station.id ? theme.colors.accent : 'transparent',
                }}
              >
                {/* 排名 */}
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: idx === 0 ? theme.colors.accent : theme.colors.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: idx === 0 ? '#fff' : theme.colors.muted,
                      fontWeight: '800',
                      fontSize: 13,
                    }}
                  >
                    {idx + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                      {rec.station.name}
                    </Text>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: getStationStatusColor(rec.station.status),
                      }}
                    />
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                    {rec.reasons.slice(0, 3).join(' · ')}
                  </Text>
                  {/* 耗材條 */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    <MiniBar label="碳粉" value={rec.station.tonerLevel} />
                    <MiniBar label="紙張" value={rec.station.paperLevel} />
                  </View>
                </View>
                {rec.station.queueLength > 0 && (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.warning, fontWeight: '800', fontSize: 16 }}>
                      {rec.station.queueLength}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 10 }}>排隊</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </AnimatedCard>
      )}

      {/* 費用預估 */}
      {selectedFile && selectedStation && (
        <AnimatedCard title="費用預估" delay={240}>
          {(() => {
            const est = Math.max(1, Math.ceil(selectedFile.size / 50000));
            const cost = calculateCost(est, copies, paperSize, colorMode, duplex);
            const canAfford = cardBalance >= cost.points;
            return (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.colors.muted }}>頁數 × 份數</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    {est} 頁 × {copies} 份
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.colors.muted }}>單價</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                    {PRICING_RULES.find(
                      (r) => r.paperSize === paperSize && r.colorMode === colorMode,
                    )?.pointsPerPage ?? 1}{' '}
                    點/張
                  </Text>
                </View>
                {duplex && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.colors.success }}>雙面列印省一半 🌿</Text>
                    <Text style={{ color: theme.colors.success, fontWeight: '600' }}>-50%</Text>
                  </View>
                )}
                <View
                  style={{
                    height: 1,
                    backgroundColor: theme.colors.border,
                    marginVertical: 4,
                  }}
                />
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
                    總計
                  </Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: theme.colors.accent, fontWeight: '800', fontSize: 20 }}>
                      {cost.points} 點
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      ≈ ${cost.estimatedNTD}
                    </Text>
                  </View>
                </View>
                {!canAfford && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      padding: 10,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.dangerSoft,
                    }}
                  >
                    <Ionicons name="warning" size={16} color={theme.colors.danger} />
                    <Text
                      style={{
                        color: theme.colors.danger,
                        fontSize: 12,
                        fontWeight: '600',
                        flex: 1,
                      }}
                    >
                      餘額不足！需補充 {cost.points - cardBalance} 點（至 1F 參考諮詢檯購買影印卡）
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}
        </AnimatedCard>
      )}

      {/* 送出按鈕 */}
      <Button
        text={selectedScenario?.id === 'scan' ? '前往掃描' : '送出列印'}
        kind="primary"
        size="large"
        icon={selectedScenario?.id === 'scan' ? 'scan-outline' : 'print-outline'}
        onPress={handleSubmitPrint}
        disabled={!selectedFile || !selectedStation}
      />

      {/* 收費速查 */}
      <AnimatedCard
        title="收費標準"
        subtitle={`影印卡 $${PRINT_SERVICE_INFO.cardPrice} / ${PRINT_SERVICE_INFO.cardPoints} 點`}
        delay={280}
      >
        <View style={{ gap: 8 }}>
          {PRICING_RULES.map((rule) => (
            <View
              key={rule.description}
              style={{ flexDirection: 'row', justifyContent: 'space-between' }}
            >
              <Text style={{ color: theme.colors.muted }}>{rule.description}</Text>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                {rule.pointsPerPage} 點/張
              </Text>
            </View>
          ))}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
              padding: 8,
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
              購買地點：{PRINT_SERVICE_INFO.purchaseLocation}
            </Text>
          </View>
        </View>
      </AnimatedCard>
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB 1: 機器 — 全校印表機/影印機即時狀態
  // ══════════════════════════════════════════════════
  const renderMachines = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 篩選 */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            { key: 'all', label: '全部', icon: 'grid-outline' },
            { key: 'printer', label: '列印機', icon: 'print-outline' },
            { key: 'copier', label: '影印機', icon: 'copy-outline' },
            { key: 'multifunction', label: '多功能', icon: 'apps-outline' },
          ] as const
        ).map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setStationFilter(f.key)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: theme.radius.md,
              backgroundColor:
                stationFilter === f.key ? theme.colors.accentSoft : theme.colors.surface2,
              borderWidth: stationFilter === f.key ? 1 : 0,
              borderColor: stationFilter === f.key ? theme.colors.accent : 'transparent',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Ionicons
              name={f.icon as any}
              size={16}
              color={stationFilter === f.key ? theme.colors.accent : theme.colors.muted}
            />
            <Text
              style={{
                color: stationFilter === f.key ? theme.colors.accent : theme.colors.muted,
                fontSize: 11,
                fontWeight: '600',
              }}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 狀態統計 */}
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          padding: 12,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <StatChip
          color={theme.colors.success}
          count={stations.filter((s) => s.status === 'online').length}
          label="可用"
        />
        <StatChip
          color="#F59E0B"
          count={stations.filter((s) => s.status === 'busy').length}
          label="忙碌"
        />
        <StatChip
          color={theme.colors.danger}
          count={
            stations.filter((s) =>
              ['offline', 'error', 'outOfPaper', 'outOfToner', 'maintenance'].includes(s.status),
            ).length
          }
          label="異常"
        />
      </View>

      {/* 機器列表 */}
      {filteredStations.map((station, idx) => (
        <AnimatedCard key={station.id} delay={idx * 40}>
          <Pressable
            onPress={() => {
              setSelectedStation(station);
              setShowStationDetail(true);
            }}
          >
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: `${getStationStatusColor(station.status)}15`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={getMachineTypeIcon(station.type) as any}
                    size={24}
                    color={getStationStatusColor(station.status)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
                      {station.name}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {station.location} · {getMachineTypeLabel(station.type)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Pill
                    text={getStationStatusLabel(station.status)}
                    kind={
                      station.status === 'online'
                        ? 'success'
                        : station.status === 'busy'
                          ? 'warning'
                          : 'danger'
                    }
                    size="sm"
                  />
                  {station.queueLength > 0 && (
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      排隊 {station.queueLength} 份 · 約 {station.estimatedWaitMinutes} 分
                    </Text>
                  )}
                </View>
              </View>

              {/* 耗材條 */}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <SupplyBar label="碳粉" value={station.tonerLevel} icon="water-outline" />
                <SupplyBar label="紙張" value={station.paperLevel} icon="document-outline" />
              </View>

              {/* 功能標籤 */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {station.colorModes.includes('color') && (
                  <Pill text="彩色" kind="accent" size="sm" icon="color-palette" />
                )}
                {station.paperSizes.includes('A3') && <Pill text="A3" size="sm" />}
                {station.supportsCloud && (
                  <Pill text="雲端" kind="accent" size="sm" icon="cloud-outline" />
                )}
                {station.supportsScan && <Pill text="掃描" size="sm" icon="scan-outline" />}
                {station.capabilities.includes('duplex') && (
                  <Pill text="雙面" size="sm" icon="copy-outline" />
                )}
                {station.capabilities.includes('staple') && (
                  <Pill text="裝訂" size="sm" icon="attach-outline" />
                )}
              </View>

              {/* 操作按鈕 */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  text="選擇此機器"
                  kind={station.status === 'offline' ? 'secondary' : 'primary'}
                  size="small"
                  disabled={station.status === 'offline' || station.status === 'maintenance'}
                  onPress={() => {
                    setSelectedStation(station);
                    setSelectedTab('home');
                  }}
                  style={{ flex: 1 }}
                />
                <Pressable
                  onPress={() => handleARNav(station)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: theme.colors.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="navigate-outline" size={20} color={theme.colors.accent} />
                </Pressable>
              </View>
            </View>
          </Pressable>
        </AnimatedCard>
      ))}
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB 2: 紀錄 — 列印歷史與點數消費
  // ══════════════════════════════════════════════════
  const renderHistory = () => (
    <View style={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 點數摘要 */}
      <AnimatedCard>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View
            style={{
              flex: 1,
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 28, fontWeight: '800' }}>
              {cardBalance}
            </Text>
            <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4 }}>目前點數</Text>
            <View
              style={{
                marginTop: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: theme.radius.full,
                backgroundColor: `${theme.colors.accent}20`,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 10, fontWeight: '600' }}>
                ≈ 可印 {Math.floor(cardBalance / 1)} 頁 A4
              </Text>
            </View>
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
              {totalPrintedPages}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
              本學期已印
            </Text>
            <View
              style={{
                marginTop: 8,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 10, fontWeight: '600' }}>
                {Math.ceil(totalPrintedPages * PRINT_SERVICE_INFO.pointValue)} 元
              </Text>
            </View>
          </View>
        </View>
      </AnimatedCard>

      {/* 角色額度 */}
      <AnimatedCard title="免費列印額度" subtitle="依身份別" delay={60}>
        <View style={{ gap: 8 }}>
          {PRINT_QUOTAS.map((q) => (
            <View
              key={q.role}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                {q.description.split('每學期')[0]}
              </Text>
              <Text
                style={{
                  color: q.semesterFreePages > 0 ? theme.colors.accent : theme.colors.muted,
                  fontWeight: '700',
                }}
              >
                {q.semesterFreePages > 0 ? `${q.semesterFreePages} 頁/學期` : '需購卡'}
              </Text>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 列印紀錄 */}
      <AnimatedCard title="列印紀錄" delay={120}>
        {jobs.length === 0 ? (
          <EmptyState
            title="尚無列印紀錄"
            subtitle="開始你的第一次列印吧！"
            actionText="前往列印"
            onAction={() => setSelectedTab('home')}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {jobs.map((job) => (
              <View
                key={job.id}
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
                      backgroundColor: `${getJobStatusColor(job.status)}15`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="document" size={20} color={getJobStatusColor(job.status)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }} numberOfLines={1}>
                      {job.fileName}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                      {job.pages} 頁 × {job.copies} 份 · {formatDateTime(new Date(job.createdAt))}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Pill
                      text={getJobStatusLabel(job.status)}
                      kind={
                        job.status === 'completed'
                          ? 'success'
                          : job.status === 'failed'
                            ? 'danger'
                            : 'default'
                      }
                      size="sm"
                    />
                    <Text
                      style={{
                        color: theme.colors.accent,
                        fontWeight: '700',
                        fontSize: 13,
                        marginTop: 4,
                      }}
                    >
                      ${job.cost}
                    </Text>
                  </View>
                </View>
                {job.status === 'pending' && (
                  <Button
                    text="取消列印"
                    kind="danger"
                    size="small"
                    onPress={() => handleCancelJob(job.id)}
                  />
                )}
              </View>
            ))}
          </View>
        )}
      </AnimatedCard>
    </View>
  );

  // ══════════════════════════════════════════════════
  // TAB 3: 環保 — 積分系統 + 綠色習慣
  // ══════════════════════════════════════════════════
  const renderEco = () => (
    <View style={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
      {/* 目前等級 */}
      <AnimatedCard>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: `${currentEcoLevel.color}20`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={currentEcoLevel.icon as any} size={36} color={currentEcoLevel.color} />
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '800' }}>
            {currentEcoLevel.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
            Lv.{currentEcoLevel.level} · {ecoPoints} 積分
          </Text>
          <Text style={{ color: currentEcoLevel.color, fontSize: 12, fontWeight: '600' }}>
            獎勵：{currentEcoLevel.perk}
          </Text>

          {/* 升級進度條 */}
          {nextLevel && (
            <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  距離 {nextLevel.name}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  {ecoPoints}/{nextLevel.minPoints}
                </Text>
              </View>
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.colors.surface2,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: currentEcoLevel.color,
                    width: `${Math.min(100, (ecoPoints / nextLevel.minPoints) * 100)}%`,
                  }}
                />
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: 'center' }}>
                再 {nextLevel.minPoints - ecoPoints} 積分即可升級！
              </Text>
            </View>
          )}
        </View>
      </AnimatedCard>

      {/* 等級一覽 */}
      <AnimatedCard title="環保等級" delay={60}>
        <View style={{ gap: 10 }}>
          {ECO_LEVELS.map((level) => {
            const isActive = currentEcoLevel.level >= level.level;
            return (
              <View
                key={level.level}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  backgroundColor: isActive ? `${level.color}12` : theme.colors.surface2,
                  opacity: isActive ? 1 : 0.6,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: `${level.color}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={level.icon as any} size={20} color={level.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                    Lv.{level.level} {level.name}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                    {level.minPoints} 積分 · {level.perk}
                  </Text>
                </View>
                {isActive && <Ionicons name="checkmark-circle" size={20} color={level.color} />}
              </View>
            );
          })}
        </View>
      </AnimatedCard>

      {/* 怎麼賺積分 */}
      <AnimatedCard title="如何賺取積分" delay={120}>
        <View style={{ gap: 10 }}>
          {ECO_ACTIONS.map((action) => (
            <View
              key={action.id}
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
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: theme.colors.successSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={action.icon as any} size={20} color={theme.colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{action.action}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
                  {action.description}
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: theme.radius.full,
                  backgroundColor: theme.colors.successSoft,
                }}
              >
                <Text style={{ color: theme.colors.success, fontWeight: '800', fontSize: 13 }}>
                  +{action.points}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 省紙統計 */}
      <AnimatedCard title="你的環保成就" delay={180}>
        <View
          style={{
            padding: 16,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.successSoft,
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Ionicons name="earth" size={40} color={theme.colors.success} />
          <Text style={{ color: theme.colors.success, fontSize: 16, fontWeight: '800' }}>
            已節省 {Math.floor(totalPrintedPages * 0.3)} 張紙
          </Text>
          <Text style={{ color: theme.colors.success, fontSize: 12 }}>
            相當於保護了 {(totalPrintedPages * 0.3 * 0.005).toFixed(2)} 棵樹 🌳
          </Text>
        </View>
      </AnimatedCard>
    </View>
  );

  // ── 取消列印 ──
  const handleCancelJob = (jobId: string) => {
    Alert.alert('取消列印', '確定要取消此列印工作嗎？', [
      { text: '否', style: 'cancel' },
      {
        text: '是',
        style: 'destructive',
        onPress: async () => {
          try {
            await ds.cancelPrintJob(jobId, school?.id);
            setJobs(jobs.map((j) => (j.id === jobId ? { ...j, status: 'cancelled' as const } : j)));
          } catch (err: any) {
            Alert.alert('取消失敗', err?.message ?? '請稍後再試');
          }
        },
      },
    ]);
  };

  // ══════════════════════════════════════════════════
  // FAQ Modal
  // ══════════════════════════════════════════════════
  const renderFAQModal = () => (
    <Modal visible={showFAQ} animationType="slide" transparent>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlay,
          justifyContent: 'flex-end',
        }}
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
              常見問題
            </Text>
            <Pressable onPress={() => setShowFAQ(false)}>
              <Ionicons name="close" size={24} color={theme.colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={{ padding: 20 }}>
            <View style={{ gap: 10, paddingBottom: 20 }}>
              {PRINT_FAQS.map((faq, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => setExpandedFAQ(expandedFAQ === idx ? null : idx)}
                  style={{
                    padding: 14,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons
                      name="help-circle"
                      size={20}
                      color={expandedFAQ === idx ? theme.colors.accent : theme.colors.muted}
                    />
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontWeight: '700',
                        flex: 1,
                        fontSize: 14,
                      }}
                    >
                      {faq.question}
                    </Text>
                    <Ionicons
                      name={expandedFAQ === idx ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={theme.colors.muted}
                    />
                  </View>
                  {expandedFAQ === idx && (
                    <Text
                      style={{
                        color: theme.colors.muted,
                        fontSize: 13,
                        marginTop: 10,
                        lineHeight: 20,
                        paddingLeft: 30,
                      }}
                    >
                      {faq.answer}
                    </Text>
                  )}
                </Pressable>
              ))}

              {/* 聯絡資訊 */}
              <View
                style={{
                  marginTop: 10,
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                }}
              >
                <Text style={{ color: theme.colors.accent, fontWeight: '700', marginBottom: 8 }}>
                  還有問題？
                </Text>
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="call-outline" size={14} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                      {PRINT_SERVICE_INFO.contactPhone}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="mail-outline" size={14} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                      {PRINT_SERVICE_INFO.contactEmail}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="time-outline" size={14} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                      {PRINT_SERVICE_INFO.serviceHours}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ══════════════════════════════════════════════════
  // 機器詳情 Modal
  // ══════════════════════════════════════════════════
  const renderStationDetailModal = () => {
    if (!selectedStation) return null;
    return (
      <Modal visible={showStationDetail} animationType="slide" transparent>
        <View
          style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }}
        >
          <View
            style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '80%',
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
                {selectedStation.name}
              </Text>
              <Pressable onPress={() => setShowStationDetail(false)}>
                <Ionicons name="close" size={24} color={theme.colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={{ gap: 16, paddingBottom: 20 }}>
                {/* 基本資訊 */}
                <View style={{ gap: 10 }}>
                  <InfoRow
                    icon="location-outline"
                    label="位置"
                    value={`${selectedStation.building} ${selectedStation.location}`}
                  />
                  <InfoRow icon="print-outline" label="機型" value={selectedStation.model} />
                  <InfoRow
                    icon="albums-outline"
                    label="類型"
                    value={getMachineTypeLabel(selectedStation.type)}
                  />
                  <InfoRow
                    icon="ellipse"
                    label="狀態"
                    value={getStationStatusLabel(selectedStation.status)}
                    valueColor={getStationStatusColor(selectedStation.status)}
                  />
                </View>

                {/* 耗材 */}
                <View style={{ gap: 8 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 4 }}>
                    耗材狀態
                  </Text>
                  <SupplyBar label="碳粉" value={selectedStation.tonerLevel} icon="water-outline" />
                  <SupplyBar
                    label="紙張"
                    value={selectedStation.paperLevel}
                    icon="document-outline"
                  />
                </View>

                {/* 支援功能 */}
                <View style={{ gap: 8 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: 4 }}>
                    支援功能
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {selectedStation.paperSizes.map((s) => (
                      <Pill key={s} text={s} size="sm" />
                    ))}
                    {selectedStation.colorModes.includes('color') && (
                      <Pill text="彩色" kind="accent" size="sm" />
                    )}
                    {selectedStation.supportsCloud && (
                      <Pill text="雲端列印" kind="accent" size="sm" icon="cloud-outline" />
                    )}
                    {selectedStation.supportsScan && (
                      <Pill text="掃描" size="sm" icon="scan-outline" />
                    )}
                    {selectedStation.capabilities.includes('duplex') && (
                      <Pill text="雙面" size="sm" />
                    )}
                    {selectedStation.capabilities.includes('staple') && (
                      <Pill text="裝訂" size="sm" />
                    )}
                    {selectedStation.capabilities.includes('scan_to_email') && (
                      <Pill text="掃描至 Email" size="sm" />
                    )}
                    {selectedStation.capabilities.includes('scan_to_usb') && (
                      <Pill text="掃描至 USB" size="sm" />
                    )}
                  </View>
                </View>

                {/* 操作按鈕 */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button
                    text="選擇此機器"
                    kind="primary"
                    disabled={
                      selectedStation.status === 'offline' ||
                      selectedStation.status === 'maintenance'
                    }
                    onPress={() => {
                      setShowStationDetail(false);
                      setSelectedTab('home');
                    }}
                    style={{ flex: 1 }}
                  />
                  <Button
                    text="AR 導航"
                    kind="secondary"
                    icon="navigate-outline"
                    onPress={() => {
                      setShowStationDetail(false);
                      handleARNav(selectedStation);
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
  // Main Render
  // ══════════════════════════════════════════════════
  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        <ScrollView
          style={{ flex: 1, marginTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          {selectedTab === 'home' && renderHome()}
          {selectedTab === 'machines' && renderMachines()}
          {selectedTab === 'history' && renderHistory()}
          {selectedTab === 'eco' && renderEco()}
        </ScrollView>
      </View>

      {renderFAQModal()}
      {renderStationDetailModal()}
    </Screen>
  );
}

// ══════════════════════════════════════════════════
// 子元件
// ══════════════════════════════════════════════════

/** Toggle 開關 */
function ToggleSwitch({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      style={{
        width: 50,
        height: 28,
        borderRadius: 14,
        backgroundColor: value ? theme.colors.accent : theme.colors.border,
        justifyContent: 'center',
        padding: 2,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#fff',
          alignSelf: value ? 'flex-end' : 'flex-start',
        }}
      />
    </Pressable>
  );
}

/** 迷你耗材條（推薦卡片用） */
function MiniBar({ label, value }: { label: string; value: number }) {
  const color = value > 50 ? theme.colors.success : value > 20 ? '#F59E0B' : theme.colors.danger;
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{label}</Text>
        <Text style={{ color, fontSize: 10, fontWeight: '600' }}>{value}%</Text>
      </View>
      <View style={{ height: 3, borderRadius: 2, backgroundColor: theme.colors.surface2 }}>
        <View style={{ height: 3, borderRadius: 2, backgroundColor: color, width: `${value}%` }} />
      </View>
    </View>
  );
}

/** 耗材進度條（機器詳情用） */
function SupplyBar({ label, value, icon }: { label: string; value: number; icon: string }) {
  const color = value > 50 ? theme.colors.success : value > 20 ? '#F59E0B' : theme.colors.danger;
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon as any} size={12} color={theme.colors.muted} />
        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{label}</Text>
        <Text style={{ color, fontSize: 11, fontWeight: '700', marginLeft: 'auto' }}>{value}%</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.colors.surface2 }}>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: color, width: `${value}%` }} />
      </View>
    </View>
  );
}

/** 統計 Chip */
function StatChip({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'center',
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{count}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** 資訊列 */
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
      <Text style={{ color: theme.colors.muted, fontSize: 13, width: 50 }}>{label}</Text>
      <Text
        style={{ color: valueColor ?? theme.colors.text, fontWeight: '600', fontSize: 13, flex: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}

// ── 列印工作狀態 helper ──
function getJobStatusLabel(status: PrintJob['status']): string {
  const m: Record<string, string> = {
    pending: '等待中',
    printing: '列印中',
    completed: '已完成',
    failed: '失敗',
    cancelled: '已取消',
  };
  return m[status] ?? status;
}

function getJobStatusColor(status: PrintJob['status']): string {
  const m: Record<string, string> = {
    pending: theme.colors.muted,
    printing: '#F59E0B',
    completed: theme.colors.success,
    failed: theme.colors.danger,
    cancelled: theme.colors.muted,
  };
  return m[status] ?? theme.colors.muted;
}
