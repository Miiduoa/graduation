/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
/**
 * 靜宜大學失物招領 — 商業級 AI 智慧配對生態圈
 *
 * Tabs:
 *  1. 首頁 — 智慧推薦 + 統計 + 快速操作
 *  2. 遺失 — 所有遺失文列表 + 搜尋 + 分類篩選
 *  3. 拾獲 — 所有拾獲文列表
 *  4. AI 配對 — 我的配對結果 + 匹配引擎說明
 *  5. 信譽 — 個人信譽積分 + 排行 + 歷史
 *  6. 地圖 — 校園遺失熱點 + 保管點
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ScrollView, Text, View, Pressable, RefreshControl, Alert,
  Dimensions, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen, AnimatedCard, Button, Pill, SegmentedControl,
  EmptyState, ProgressRing,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { formatRelativeTime } from "../utils/format";
import { analytics } from "../services/analytics";

import {
  // 分類
  ITEM_CATEGORIES, getCategoryInfo, type LostItemCategory, type CategoryInfo,
  // 地點
  CAMPUS_LOCATIONS, getHotspotLocations, type CampusLocation,
  // 貼文
  type LostFoundPost, type PostType, type PostStatus,
  getPostStatusLabel, getPostStatusColor, getPostStatusIcon,
  type ContactMethod, type HandoverMethod,
  // 角色
  type LostFoundRole, type LFFeature, ROLE_LF_CONFIG, hasLFFeature,
  // 互動
  LF_ROLE_INTERACTIONS,
  // AI 配對
  calculateMatchScore, type MatchResult,
  // 信譽
  REPUTATION_ACTIONS, REPUTATION_LEVELS, getReputationLevel,
  type ReputationAction, type ReputationLevel,
  // 保管
  CUSTODY_POLICY, type CustodyRecord, type CustodyStatus,
  // 通知
  LF_NOTIFICATION_TYPES,
  // 智慧推薦
  getSmartLFSuggestions, type LFSuggestion,
  // 模擬資料
  simulateLFStats, simulateRecentPosts, simulateMyReputation,
} from "../data/puLostFoundData";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// ═══════════════════════════════════════════════════
// Tab 定義
// ═══════════════════════════════════════════════════

type LFTab = "home" | "lost" | "found" | "match" | "reputation" | "map";

const TABS: { key: LFTab; label: string }[] = [
  { key: "home", label: "首頁" },
  { key: "lost", label: "遺失" },
  { key: "found", label: "拾獲" },
  { key: "match", label: "AI配對" },
  { key: "reputation", label: "信譽" },
  { key: "map", label: "地圖" },
];

// ═══════════════════════════════════════════════════
// 主畫面
// ═══════════════════════════════════════════════════

export function LostFoundScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();

  // Tab
  const [tab, setTab] = useState<LFTab>("home");

  // 資料
  const [refreshing, setRefreshing] = useState(false);
  const [posts, setPosts] = useState<LostFoundPost[]>([]);
  const [stats, setStats] = useState(simulateLFStats());
  const [myRep, setMyRep] = useState(simulateMyReputation());
  const [suggestions, setSuggestions] = useState<LFSuggestion[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<LostItemCategory | null>(null);
  const [showOnlyOpen, setShowOnlyOpen] = useState(true);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [showCustodyInfo, setShowCustodyInfo] = useState(false);

  useEffect(() => {
    analytics.logScreenView("LostFound");
    loadData();
  }, [school?.id]);

  const loadData = useCallback(() => {
    const allPosts = simulateRecentPosts();
    setPosts(allPosts);
    setStats(simulateLFStats());
    setMyRep(simulateMyReputation());
    setSuggestions(getSmartLFSuggestions());

    // AI 配對 demo — 把 lost 和 found 交叉比對
    const lostPosts = allPosts.filter(p => p.type === "lost" && p.status === "open");
    const foundPosts = allPosts.filter(p => p.type === "found" && (p.status === "open" || p.status === "matching"));
    const results: MatchResult[] = [];
    for (const lp of lostPosts) {
      for (const fp of foundPosts) {
        const r = calculateMatchScore(lp, fp);
        if (r.score >= 30) results.push(r);
      }
    }
    results.sort((a, b) => b.score - a.score);
    setMatchResults(results);
  }, [school?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    loadData();
    setRefreshing(false);
  }, [loadData]);

  // 篩選
  const filteredPosts = useMemo(() => {
    const typeFilter: PostType | null = tab === "lost" ? "lost" : tab === "found" ? "found" : null;
    return posts.filter((p) => {
      if (typeFilter && p.type !== typeFilter) return false;
      if (selectedCategory && p.category !== selectedCategory) return false;
      if (showOnlyOpen && p.status !== "open" && p.status !== "matching") return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [posts, tab, selectedCategory, showOnlyOpen, searchQuery]);

  const handlePostNew = (type: PostType) => {
    if (!auth.user) {
      Alert.alert("請先登入", "需要登入才能發布失物招領資訊", [
        { text: "取消", style: "cancel" },
        { text: "前往登入", onPress: () => nav?.navigate?.("MeHome") },
      ]);
      return;
    }
    nav?.navigate?.("LostFoundPost", { type });
  };

  // ═════════════════════════════════════════════════
  // Quick Actions
  // ═════════════════════════════════════════════════

  const QUICK_ACTIONS = [
    { key: "post_lost", label: "我遺失了", icon: "alert-circle-outline", color: "#EF4444" },
    { key: "post_found", label: "我拾獲了", icon: "hand-right-outline", color: "#10B981" },
    { key: "ai_match", label: "AI配對", icon: "sparkles-outline", color: "#F59E0B" },
    { key: "hotspot", label: "熱點地圖", icon: "map-outline", color: "#8B5CF6" },
    { key: "my_rep", label: "我的信譽", icon: "ribbon-outline", color: "#EC4899" },
    { key: "custody", label: "保管查詢", icon: "archive-outline", color: "#0D9488" },
  ];

  const handleQuickAction = (key: string) => {
    switch (key) {
      case "post_lost": handlePostNew("lost"); break;
      case "post_found": handlePostNew("found"); break;
      case "ai_match": setTab("match"); break;
      case "hotspot": setTab("map"); break;
      case "my_rep": setTab("reputation"); break;
      case "custody": setShowCustodyInfo(true); break;
    }
  };

  // ═════════════════════════════════════════════════
  // renderHome
  // ═════════════════════════════════════════════════

  const renderHome = () => (
    <>
      {/* ── 智慧提醒 ── */}
      {suggestions.length > 0 && (
        <AnimatedCard>
          <View style={{ gap: 8 }}>
            {suggestions.map((s, i) => (
              <Pressable
                key={i}
                onPress={() => s.action === "hotspot" ? setTab("map") : s.action === "ai_match" ? setTab("match") : null}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  padding: 10, borderRadius: theme.radius.md, backgroundColor: `${s.color}12`,
                }}
              >
                <Ionicons name={s.icon as any} size={18} color={s.color} />
                <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>{s.text}</Text>
                {s.action && <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />}
              </Pressable>
            ))}
          </View>
        </AnimatedCard>
      )}

      {/* ── 本月統計 ── */}
      <AnimatedCard title="本月統計" subtitle={`歸還率 ${Math.round(stats.returnRate * 100)}%`} delay={50}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[
            { label: "遺失", value: stats.totalLostThisMonth, color: "#EF4444" },
            { label: "拾獲", value: stats.totalFoundThisMonth, color: "#10B981" },
            { label: "歸還", value: stats.returnedThisMonth, color: "#3B82F6" },
            { label: "警衛室", value: stats.pendingAtGuard, color: "#F59E0B" },
          ].map((s) => (
            <View
              key={s.label}
              style={{
                flex: 1, padding: 12, borderRadius: theme.radius.md,
                backgroundColor: `${s.color}12`, alignItems: "center",
              }}
            >
              <Text style={{ color: s.color, fontWeight: "900", fontSize: 22 }}>{s.value}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* 平均歸還天數 */}
        <View style={{
          flexDirection: "row", alignItems: "center", justifyContent: "center",
          gap: 8, marginTop: 10, padding: 8, borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface2,
        }}>
          <Ionicons name="time-outline" size={14} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>
            平均歸還 {stats.avgReturnDays} 天
          </Text>
        </View>
      </AnimatedCard>

      {/* ── 快速操作 ── */}
      <AnimatedCard title="快速操作" delay={100}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {QUICK_ACTIONS.map((qa) => (
            <Pressable
              key={qa.key}
              onPress={() => handleQuickAction(qa.key)}
              style={({ pressed }) => ({
                width: (SCREEN_WIDTH - 64) / 3 - 7,
                paddingVertical: 14, alignItems: "center",
                borderRadius: theme.radius.md,
                backgroundColor: pressed ? `${qa.color}20` : `${qa.color}10`,
                gap: 6,
              })}
            >
              <Ionicons name={qa.icon as any} size={22} color={qa.color} />
              <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: "600" }}>{qa.label}</Text>
            </Pressable>
          ))}
        </View>
      </AnimatedCard>

      {/* ── 熱門遺失分類 ── */}
      <AnimatedCard title="常見遺失物" subtitle="歸還率排名" delay={150}>
        <View style={{ gap: 6 }}>
          {stats.topCategories.slice(0, 5).map(({ category, count }) => {
            const info = getCategoryInfo(category);
            return (
              <Pressable
                key={category}
                onPress={() => { setSelectedCategory(category); setTab("lost"); }}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
                }}
              >
                <View style={{
                  width: 34, height: 34, borderRadius: 10,
                  backgroundColor: `${info.color}20`, alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name={info.icon as any} size={16} color={info.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{info.label}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    本月 {count} 件 · 歸還率 {Math.round(info.returnRate * 100)}%
                  </Text>
                </View>
                <View style={{
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                  backgroundColor: `${info.color}15`,
                }}>
                  <Text style={{ color: info.color, fontSize: 11, fontWeight: "700" }}>
                    ~{info.avgReturnDays}天
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </AnimatedCard>

      {/* ── 最新動態 ── */}
      <AnimatedCard title="最新動態" subtitle={`${posts.length} 筆`} delay={200}>
        <View style={{ gap: 10 }}>
          {posts.slice(0, 4).map((p) => renderPostCard(p))}
        </View>
        {posts.length > 4 && (
          <Pressable onPress={() => setTab("lost")} style={{ alignItems: "center", marginTop: 10 }}>
            <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>查看全部 →</Text>
          </Pressable>
        )}
      </AnimatedCard>

      {/* ── 保管政策 ── */}
      <AnimatedCard title="物品保管流程" subtitle="超時自動轉交" delay={250}>
        <View style={{ gap: 6 }}>
          {[
            { loc: "警衛室/系辦/圖書館", days: CUSTODY_POLICY.guardHoldDays, icon: "shield-outline", color: "#059669" },
            { loc: "宿舍服務台", days: CUSTODY_POLICY.dormHoldDays, icon: "home-outline", color: "#EC4899" },
            { loc: "學務處（最終）", days: CUSTODY_POLICY.affairsHoldDays, icon: "people-outline", color: "#7C3AED" },
          ].map((step, i) => (
            <View key={i} style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
            }}>
              <View style={{
                width: 32, height: 32, borderRadius: 10,
                backgroundColor: `${step.color}15`, alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons name={step.icon as any} size={16} color={step.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{step.loc}</Text>
              </View>
              <Text style={{ color: step.color, fontWeight: "700", fontSize: 13 }}>保管 {step.days} 天</Text>
              {i < 2 && <Ionicons name="arrow-forward" size={14} color={theme.colors.muted} />}
            </View>
          ))}
          <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 }}>
            合計最長 {CUSTODY_POLICY.totalMaxDays} 天。{CUSTODY_POLICY.disposalMethod}
          </Text>
        </View>
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // renderPostCard (共用)
  // ═════════════════════════════════════════════════

  const renderPostCard = (p: LostFoundPost) => {
    const catInfo = getCategoryInfo(p.category);
    const statusColor = getPostStatusColor(p.status);
    const statusLabel = getPostStatusLabel(p.status);
    const statusIcon = getPostStatusIcon(p.status);

    return (
      <Pressable
        key={p.id}
        onPress={() => nav?.navigate?.("LostFoundDetail", { id: p.id })}
        style={({ pressed }) => ({
          padding: 14, borderRadius: theme.radius.lg,
          backgroundColor: pressed ? theme.colors.border : theme.colors.surface2,
          borderWidth: 1, borderColor: theme.colors.border,
        })}
      >
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{
            width: 52, height: 52, borderRadius: 14,
            backgroundColor: `${catInfo.color}18`, alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name={catInfo.icon as any} size={24} color={catInfo.color} />
          </View>

          <View style={{ flex: 1 }}>
            {/* 類型 + 狀態 */}
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={{
                paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4,
                backgroundColor: p.type === "lost" ? "#EF444420" : "#10B98120",
              }}>
                <Text style={{
                  color: p.type === "lost" ? "#EF4444" : "#10B981",
                  fontSize: 10, fontWeight: "700",
                }}>
                  {p.type === "lost" ? "遺失" : "拾獲"}
                </Text>
              </View>
              <View style={{
                paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4,
                backgroundColor: `${statusColor}18`,
              }}>
                <Text style={{ color: statusColor, fontSize: 10, fontWeight: "600" }}>{statusLabel}</Text>
              </View>
              {p.matchScore && p.matchScore >= 50 && (
                <View style={{
                  flexDirection: "row", alignItems: "center", gap: 2,
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                  backgroundColor: "#F59E0B18",
                }}>
                  <Ionicons name="sparkles" size={10} color="#F59E0B" />
                  <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "600" }}>{p.matchScore}%</Text>
                </View>
              )}
            </View>

            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14, marginTop: 5 }} numberOfLines={1}>
              {p.title}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
              {p.description}
            </Text>

            {/* 特徵標籤 */}
            {p.characteristics.length > 0 && (
              <View style={{ flexDirection: "row", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                {p.characteristics.slice(0, 3).map((c, idx) => (
                  <View key={idx} style={{
                    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                    backgroundColor: theme.colors.bg,
                  }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{c.key}:{c.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* 地點 + 時間 + 瀏覽數 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Ionicons name="location-outline" size={12} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  {CAMPUS_LOCATIONS.find(l => l.id === p.locationId)?.name ?? p.locationId}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Ionicons name="time-outline" size={12} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  {formatRelativeTime(new Date(p.createdAt))}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Ionicons name="eye-outline" size={12} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{p.viewCount}</Text>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  // ═════════════════════════════════════════════════
  // renderPostList (遺失 / 拾獲共用)
  // ═════════════════════════════════════════════════

  const renderPostList = () => {
    const typeLabel = tab === "lost" ? "遺失" : "拾獲";
    return (
      <>
        {/* 分類快篩 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}>
            <Pressable
              onPress={() => setShowOnlyOpen(!showOnlyOpen)}
              style={{
                flexDirection: "row", alignItems: "center", gap: 4,
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
                backgroundColor: showOnlyOpen ? theme.colors.accentSoft : theme.colors.surface2,
                borderWidth: 1, borderColor: showOnlyOpen ? theme.colors.accent : theme.colors.border,
              }}
            >
              <Ionicons
                name={showOnlyOpen ? "checkmark-circle" : "ellipse-outline"}
                size={14} color={showOnlyOpen ? theme.colors.accent : theme.colors.muted}
              />
              <Text style={{
                color: showOnlyOpen ? theme.colors.accent : theme.colors.muted,
                fontWeight: "600", fontSize: 12,
              }}>進行中</Text>
            </Pressable>

            {ITEM_CATEGORIES.slice(0, 10).map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 4,
                  paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
                  backgroundColor: selectedCategory === cat.id ? `${cat.color}20` : theme.colors.surface2,
                  borderWidth: 1, borderColor: selectedCategory === cat.id ? cat.color : theme.colors.border,
                }}
              >
                <Ionicons name={cat.icon as any} size={13} color={selectedCategory === cat.id ? cat.color : theme.colors.muted} />
                <Text style={{
                  color: selectedCategory === cat.id ? cat.color : theme.colors.muted,
                  fontWeight: "600", fontSize: 12,
                }}>{cat.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {/* 搜尋 */}
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 8,
          padding: 10, borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border,
        }}>
          <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
          <Text
            style={{ flex: 1, color: searchQuery ? theme.colors.text : theme.colors.muted, fontSize: 14 }}
            // 注意：真實實作用 TextInput，這裡為 demo 展示
            onPress={() => {
              Alert.prompt?.("搜尋", "輸入關鍵字", (text: string) => setSearchQuery(text));
            }}
          >
            {searchQuery || `搜尋${typeLabel}物品...`}
          </Text>
          {searchQuery !== "" && (
            <Pressable onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>

        {/* 列表 */}
        <AnimatedCard title={`${typeLabel}列表`} subtitle={`${filteredPosts.length} 筆`}>
          {filteredPosts.length === 0 ? (
            <EmptyState
              title={`沒有${typeLabel}紀錄`}
              subtitle={searchQuery || selectedCategory ? "試試調整搜尋條件" : `目前沒有${typeLabel}中的物品`}
              icon="search-outline"
            />
          ) : (
            <View style={{ gap: 10 }}>
              {filteredPosts.map((p) => renderPostCard(p))}
            </View>
          )}
        </AnimatedCard>

        {/* 發布按鈕 */}
        <AnimatedCard delay={100}>
          <Button
            text={tab === "lost" ? "我遺失了物品" : "我拾獲了物品"}
            kind="primary"
            onPress={() => handlePostNew(tab === "lost" ? "lost" : "found")}
          />
        </AnimatedCard>
      </>
    );
  };

  // ═════════════════════════════════════════════════
  // renderMatch — AI 配對
  // ═════════════════════════════════════════════════

  const renderMatch = () => (
    <>
      {/* AI 引擎說明 */}
      <AnimatedCard title="AI 智慧配對引擎" subtitle="四維匹配演算法">
        <View style={{ gap: 6 }}>
          {[
            { dim: "類別匹配", weight: "30%", icon: "grid-outline", color: "#3B82F6", desc: "物品分類是否相同/相近" },
            { dim: "地點匹配", weight: "25%", icon: "location-outline", color: "#10B981", desc: "遺失與拾獲地點距離" },
            { dim: "時間匹配", weight: "25%", icon: "time-outline", color: "#F59E0B", desc: "遺失與拾獲時間差距" },
            { dim: "特徵匹配", weight: "20%", icon: "finger-print-outline", color: "#8B5CF6", desc: "顏色/品牌/型號/特殊標記" },
          ].map((d) => (
            <View key={d.dim} style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
            }}>
              <View style={{
                width: 34, height: 34, borderRadius: 10,
                backgroundColor: `${d.color}18`, alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons name={d.icon as any} size={16} color={d.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{d.dim}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{d.desc}</Text>
              </View>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                backgroundColor: `${d.color}15`,
              }}>
                <Text style={{ color: d.color, fontWeight: "700", fontSize: 12 }}>{d.weight}</Text>
              </View>
            </View>
          ))}
        </View>
      </AnimatedCard>

      {/* 配對結果 */}
      <AnimatedCard title="配對結果" subtitle={`${matchResults.length} 組潛在匹配`} delay={100}>
        {matchResults.length === 0 ? (
          <EmptyState
            title="暫無配對"
            subtitle="發布遺失文後，系統會自動比對所有拾獲文"
            icon="sparkles-outline"
          />
        ) : (
          <View style={{ gap: 10 }}>
            {matchResults.map((mr, i) => {
              const lostPost = posts.find(p => p.id === mr.lostPostId);
              const foundPost = posts.find(p => p.id === mr.foundPostId);
              if (!lostPost || !foundPost) return null;

              const confidenceColor = mr.confidence === "high" ? "#10B981" : mr.confidence === "medium" ? "#F59E0B" : "#9CA3AF";

              return (
                <View key={i} style={{
                  padding: 12, borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border,
                }}>
                  {/* 匹配分數 */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="sparkles" size={16} color="#F59E0B" />
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                        匹配度 {mr.score}%
                      </Text>
                    </View>
                    <View style={{
                      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                      backgroundColor: `${confidenceColor}18`,
                    }}>
                      <Text style={{ color: confidenceColor, fontSize: 11, fontWeight: "600" }}>
                        {mr.confidence === "high" ? "高度匹配" : mr.confidence === "medium" ? "可能匹配" : "僅供參考"}
                      </Text>
                    </View>
                  </View>

                  {/* 遺失 ↔ 拾獲 */}
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <View style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: "#EF444410" }}>
                      <Text style={{ color: "#EF4444", fontSize: 10, fontWeight: "600" }}>遺失</Text>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600", marginTop: 2 }} numberOfLines={1}>
                        {lostPost.title}
                      </Text>
                    </View>
                    <Ionicons name="swap-horizontal" size={18} color={theme.colors.muted} />
                    <View style={{ flex: 1, padding: 8, borderRadius: 8, backgroundColor: "#10B98110" }}>
                      <Text style={{ color: "#10B981", fontSize: 10, fontWeight: "600" }}>拾獲</Text>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600", marginTop: 2 }} numberOfLines={1}>
                        {foundPost.title}
                      </Text>
                    </View>
                  </View>

                  {/* 分數細項 */}
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                    {[
                      { label: "類別", score: mr.breakdown.categoryMatch, max: 30, color: "#3B82F6" },
                      { label: "地點", score: mr.breakdown.locationMatch, max: 25, color: "#10B981" },
                      { label: "時間", score: mr.breakdown.timeMatch, max: 25, color: "#F59E0B" },
                      { label: "特徵", score: mr.breakdown.featureMatch, max: 20, color: "#8B5CF6" },
                    ].map((d) => (
                      <View key={d.label} style={{ flex: 1, alignItems: "center" }}>
                        <View style={{
                          width: "100%", height: 4, borderRadius: 2, backgroundColor: theme.colors.border, overflow: "hidden",
                        }}>
                          <View style={{
                            width: `${(d.score / d.max) * 100}%`, height: "100%",
                            borderRadius: 2, backgroundColor: d.color,
                          }} />
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 9, marginTop: 3 }}>
                          {d.label} {d.score}/{d.max}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* 建議動作 */}
                  <View style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "center",
                    gap: 6, marginTop: 10, padding: 8, borderRadius: 8,
                    backgroundColor: `${confidenceColor}10`,
                  }}>
                    <Ionicons name="bulb-outline" size={14} color={confidenceColor} />
                    <Text style={{ color: confidenceColor, fontSize: 12, fontWeight: "600" }}>
                      {mr.suggestedAction}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </AnimatedCard>

      {/* 如何提高配對率 */}
      <AnimatedCard title="提高配對率小技巧" delay={150}>
        <View style={{ gap: 6 }}>
          {[
            { tip: "詳細描述物品特徵（顏色、品牌、型號）", icon: "create-outline" },
            { tip: "標記精確遺失位置（例如：3F 靠窗座位）", icon: "pin-outline" },
            { tip: "回憶大約遺失/拾獲時間", icon: "time-outline" },
            { tip: "上傳物品照片（即使模糊也有幫助）", icon: "camera-outline" },
          ].map((t, i) => (
            <View key={i} style={{
              flexDirection: "row", alignItems: "center", gap: 8,
              padding: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
            }}>
              <Ionicons name={t.icon as any} size={16} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 12 }}>{t.tip}</Text>
            </View>
          ))}
        </View>
      </AnimatedCard>
    </>
  );

  // ═════════════════════════════════════════════════
  // renderReputation — 信譽系統
  // ═════════════════════════════════════════════════

  const renderReputation = () => {
    const currentLevel = myRep.level;
    const nextLevel = REPUTATION_LEVELS.find(l => l.minPoints > myRep.totalPoints);
    const progressToNext = nextLevel
      ? (myRep.totalPoints - currentLevel.minPoints) / (nextLevel.minPoints - currentLevel.minPoints)
      : 1;

    return (
      <>
        {/* 個人信譽卡 */}
        <AnimatedCard>
          <View style={{ alignItems: "center", gap: 8 }}>
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: `${currentLevel.color}20`,
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 28 }}>{currentLevel.badge}</Text>
            </View>
            <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>
              {currentLevel.name}
            </Text>
            <Text style={{ color: currentLevel.color, fontWeight: "700", fontSize: 24 }}>
              {myRep.totalPoints} 分
            </Text>

            {/* 進度條 */}
            {nextLevel && (
              <View style={{ width: "100%", gap: 4 }}>
                <View style={{
                  flexDirection: "row", justifyContent: "space-between",
                }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>Lv.{currentLevel.level}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>Lv.{nextLevel.level} ({nextLevel.minPoints}分)</Text>
                </View>
                <View style={{
                  width: "100%", height: 8, borderRadius: 4,
                  backgroundColor: theme.colors.border, overflow: "hidden",
                }}>
                  <View style={{
                    width: `${Math.min(progressToNext * 100, 100)}%`, height: "100%",
                    borderRadius: 4, backgroundColor: currentLevel.color,
                  }} />
                </View>
              </View>
            )}

            {/* 成就數據 */}
            <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
              {[
                { label: "已歸還", value: myRep.returnedCount, icon: "checkmark-circle" },
                { label: "發布拾獲", value: myRep.foundPostCount, icon: "add-circle" },
                { label: "收到感謝", value: myRep.thankReceived, icon: "heart" },
              ].map((s) => (
                <View key={s.label} style={{ alignItems: "center" }}>
                  <Ionicons name={s.icon as any} size={18} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16, marginTop: 2 }}>{s.value}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </AnimatedCard>

        {/* 等級制度 */}
        <AnimatedCard title="等級制度" subtitle="拾金不昧的力量" delay={50}>
          <View style={{ gap: 6 }}>
            {REPUTATION_LEVELS.map((lv) => {
              const isActive = myRep.totalPoints >= lv.minPoints;
              const isCurrent = lv.level === currentLevel.level;
              return (
                <View key={lv.level} style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  padding: 10, borderRadius: theme.radius.md,
                  backgroundColor: isCurrent ? `${lv.color}15` : theme.colors.surface2,
                  borderWidth: isCurrent ? 1 : 0, borderColor: lv.color,
                  opacity: isActive ? 1 : 0.5,
                }}>
                  <Text style={{ fontSize: 20 }}>{lv.badge}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                      Lv.{lv.level} {lv.name}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{lv.perk}</Text>
                  </View>
                  <Text style={{ color: lv.color, fontWeight: "700", fontSize: 12 }}>{lv.minPoints}分</Text>
                </View>
              );
            })}
          </View>
        </AnimatedCard>

        {/* 積分方式 */}
        <AnimatedCard title="如何獲得積分" delay={100}>
          <View style={{ gap: 6 }}>
            {REPUTATION_ACTIONS.map((action) => (
              <View key={action.id} style={{
                flexDirection: "row", alignItems: "center", gap: 10,
                padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
              }}>
                <Ionicons name={action.icon as any} size={18} color={action.color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{action.label}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{action.description}</Text>
                </View>
                <Text style={{ color: "#10B981", fontWeight: "800", fontSize: 14 }}>+{action.points}</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* 積分歷史 */}
        <AnimatedCard title="我的積分歷史" delay={150}>
          {myRep.history.length === 0 ? (
            <EmptyState title="還沒有紀錄" subtitle="拾獲物品並歸還就能獲得積分" icon="ribbon-outline" />
          ) : (
            <View style={{ gap: 6 }}>
              {myRep.history.map((h, i) => {
                const action = REPUTATION_ACTIONS.find(a => a.id === h.actionId);
                return (
                  <View key={i} style={{
                    flexDirection: "row", alignItems: "center", gap: 10,
                    padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
                  }}>
                    <Ionicons name={(action?.icon ?? "add") as any} size={16} color={action?.color ?? theme.colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>{h.note}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{h.date}</Text>
                    </View>
                    <Text style={{ color: "#10B981", fontWeight: "700", fontSize: 13 }}>+{h.points}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </AnimatedCard>
      </>
    );
  };

  // ═════════════════════════════════════════════════
  // renderMap — 校園遺失熱點
  // ═════════════════════════════════════════════════

  const renderMap = () => {
    const hotspots = getHotspotLocations();
    const allSorted = [...CAMPUS_LOCATIONS].sort((a, b) => b.lostCount - a.lostCount);

    return (
      <>
        {/* 熱點排名 */}
        <AnimatedCard title="遺失熱點" subtitle="歷史遺失次數排名">
          <View style={{ gap: 6 }}>
            {hotspots.map((loc, i) => (
              <View key={loc.id} style={{
                flexDirection: "row", alignItems: "center", gap: 10,
                padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
              }}>
                <View style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: i < 3 ? "#EF444420" : theme.colors.bg,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{
                    color: i < 3 ? "#EF4444" : theme.colors.muted,
                    fontWeight: "800", fontSize: 12,
                  }}>
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{loc.name}</Text>
                  {loc.area && (
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{loc.area}</Text>
                  )}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 13 }}>{loc.lostCount}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 9 }}>次</Text>
                </View>
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* 全校地點 */}
        <AnimatedCard title="全校遺失統計" subtitle="依建築分類" delay={100}>
          <View style={{ gap: 6 }}>
            {allSorted.map((loc) => {
              const maxCount = allSorted[0].lostCount;
              const pct = loc.lostCount / maxCount;
              return (
                <View key={loc.id} style={{
                  flexDirection: "row", alignItems: "center", gap: 8,
                  padding: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
                      {loc.name}
                    </Text>
                  </View>
                  <View style={{
                    width: 100, height: 6, borderRadius: 3,
                    backgroundColor: theme.colors.border, overflow: "hidden",
                  }}>
                    <View style={{
                      width: `${pct * 100}%`, height: "100%", borderRadius: 3,
                      backgroundColor: loc.isHotspot ? "#EF4444" : theme.colors.accent,
                    }} />
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, width: 30, textAlign: "right" }}>
                    {loc.lostCount}
                  </Text>
                </View>
              );
            })}
          </View>
        </AnimatedCard>

        {/* 保管點 */}
        <AnimatedCard title="物品保管點" subtitle="校內可認領地點" delay={150}>
          <View style={{ gap: 6 }}>
            {[
              { name: "校門口警衛室", icon: "shield-outline", color: "#059669", desc: "24h 可認領，攜帶證件", items: stats.pendingAtGuard },
              { name: "學務處生活輔導組", icon: "people-outline", color: "#7C3AED", desc: "行政大樓 1F，週一至週五", items: stats.pendingAtAffairs },
              { name: "蓋夏圖書館櫃檯", icon: "library-outline", color: "#0D9488", desc: "開館時間可認領", items: 3 },
              { name: "各系辦公室", icon: "business-outline", color: "#F59E0B", desc: "上班時間洽詢", items: null },
              { name: "宿舍服務台", icon: "home-outline", color: "#EC4899", desc: "限住宿生", items: 2 },
            ].map((pt) => (
              <View key={pt.name} style={{
                flexDirection: "row", alignItems: "center", gap: 10,
                padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
              }}>
                <View style={{
                  width: 34, height: 34, borderRadius: 10,
                  backgroundColor: `${pt.color}15`, alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name={pt.icon as any} size={16} color={pt.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{pt.name}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{pt.desc}</Text>
                </View>
                {pt.items !== null && (
                  <View style={{
                    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                    backgroundColor: `${pt.color}15`,
                  }}>
                    <Text style={{ color: pt.color, fontWeight: "700", fontSize: 12 }}>{pt.items} 件</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </AnimatedCard>

        {/* 預防建議 */}
        <AnimatedCard title="防遺失小技巧" delay={200}>
          <View style={{ gap: 6 }}>
            {[
              "離開座位前用「口袋拍拍」法：手機、錢包、鑰匙、學生證",
              "在圖書館和餐廳使用防盜掛鉤或手機架",
              "水壺/雨傘貼上個人化貼紙或綁吊飾，方便辨識",
              "高價值物品（筆電）隨身攜帶或放入鎖櫃",
              "開啟 APP 「熱點提醒」功能，進入熱區自動提醒",
            ].map((tip, i) => (
              <View key={i} style={{
                flexDirection: "row", gap: 8, padding: 8,
                borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2,
              }}>
                <Ionicons name="bulb-outline" size={14} color="#F59E0B" style={{ marginTop: 1 }} />
                <Text style={{ color: theme.colors.text, fontSize: 12, flex: 1, lineHeight: 18 }}>{tip}</Text>
              </View>
            ))}
          </View>
        </AnimatedCard>
      </>
    );
  };

  // ═════════════════════════════════════════════════
  // Main Render
  // ═════════════════════════════════════════════════

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />
        }
      >
        {/* Header */}
        <AnimatedCard title="失物招領" subtitle="AI 智慧配對生態圈">
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button text="我遺失了" kind="primary" onPress={() => handlePostNew("lost")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button text="我拾獲了" onPress={() => handlePostNew("found")} />
            </View>
          </View>
        </AnimatedCard>

        {/* Tab Bar */}
        <SegmentedControl
          options={TABS}
          selected={tab}
          onChange={(k) => {
            setTab(k as LFTab);
            setSelectedCategory(null);
            setSearchQuery("");
          }}
        />

        {/* Tab Content */}
        {tab === "home" && renderHome()}
        {(tab === "lost" || tab === "found") && renderPostList()}
        {tab === "match" && renderMatch()}
        {tab === "reputation" && renderReputation()}
        {tab === "map" && renderMap()}
      </ScrollView>
    </Screen>
  );
}
