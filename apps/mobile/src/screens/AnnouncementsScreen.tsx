/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { ScrollView, Text, View, Pressable, Platform, RefreshControl, FlatList, Alert, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useSearchDebounce } from "../hooks/useDebounce";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { usePermissions } from "../hooks/usePermissions";
import { Card, Pill, LoadingState, EmptyState, ErrorState, SearchBar, Button } from "../ui/components";
import { OfflineDataNotice } from "../ui/OfflineBanner";
import { useSchool } from "../state/school";
import { useDemo } from "../state/demo";
import { useSearchHistory, POPULAR_SEARCHES } from "../state/searchHistory";
import { useToast } from "../ui/Toast";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { formatDateTime } from "../utils/format";

type Announcement = {
  id: string;
  title: string;
  body: string;
  source?: string;
  publishedAt: unknown;
};

type AnnouncementView = "all" | "important" | "today";

function isImportantAnnouncement(a: Announcement): boolean {
  const hay = `${a.title} ${a.body}`.toLowerCase();
  return hay.includes("重要") || hay.includes("緊急") || hay.includes("停課") || hay.includes("異動");
}

const ICON_MAP: Record<string, { name: string; bg: string; color: string }> = {
  important: { name: "alert-circle", bg: "rgba(239,68,68,0.15)", color: "#EF4444" },
  general: { name: "megaphone", bg: "rgba(99,102,241,0.15)", color: "#6366F1" },
};

function getAnnouncementIcon(a: Announcement) {
  if (isImportantAnnouncement(a)) return ICON_MAP.important;
  return ICON_MAP.general;
}

export function AnnouncementsScreen(props: any) {
  const navigation = useNavigation();
  const nav = props?.navigation ?? navigation;
  const insets = useSafeAreaInsets();
  const { school } = useSchool();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { isOffline, isOnline } = useNetworkStatus();
  const { can } = usePermissions();
  const canPublish = can("announcements.create");

  const demo = useDemo();
  const searchHistory = useSearchHistory();

  const [q, setQ] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number | undefined>(undefined);
  const [activeView, setActiveView] = useState<AnnouncementView>("all");
  
  const { debouncedValue: debouncedQuery, isSearching } = useSearchDebounce(q, 300);

  const ds = useDataSource();

  const handleRefreshError = useCallback((error: string) => {
    toastRef.current.show({
      message: `更新失敗：${error}`,
      type: "error",
      duration: 3000,
      action: {
        text: "重試",
        onPress: () => refresh(),
      },
    });
  }, []);

  const { 
    items: raw, 
    error: loadError, 
    loading: loadLoading, 
    refreshing,
    reload,
    refresh 
  } = useAsyncList<Announcement>(
    () => ds.listAnnouncements(school.id),
    [ds, school.id],
    { keepPreviousData: true, onRefreshError: handleRefreshError }
  );
  
  useEffect(() => {
    if (!loadLoading && raw.length > 0) {
      setLastFetchTime(Date.now());
    }
  }, [loadLoading, raw.length]);

  const isLoading = demo.mode === "loading" || (demo.mode === "normal" && loadLoading && raw.length === 0);
  const error =
    demo.mode === "error"
      ? "(demo) 網路錯誤或權限不足"
      : demo.mode === "normal"
        ? loadError
        : null;

  const handleRefresh = useCallback(async () => {
    if (demo.mode !== "normal") return;
    if (isOffline) {
      toastRef.current.show({
        message: "目前處於離線模式，無法更新",
        type: "warning",
        duration: 2000,
      });
      return;
    }
    await refresh();
  }, [demo.mode, refresh, isOffline]);

  const items = useMemo(() => {
    const baseItems = demo.mode === "empty" ? [] : raw;
    const filteredByView = baseItems.filter((a) => {
      if (activeView === "important") return isImportantAnnouncement(a);
      if (activeView === "today") {
        const published = new Date(String(a.publishedAt));
        if (Number.isNaN(published.getTime())) return false;
        const now = new Date();
        return (
          published.getFullYear() === now.getFullYear() &&
          published.getMonth() === now.getMonth() &&
          published.getDate() === now.getDate()
        );
      }
      return true;
    });

    if (!debouncedQuery.trim()) return filteredByView;
    const needle = debouncedQuery.trim().toLowerCase();
    return filteredByView.filter((a) => {
      const hay = `${a.title}\n${a.body}\n${a.source ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [demo.mode, debouncedQuery, raw, activeView]);

  const stats = useMemo(() => {
    const baseItems = demo.mode === "empty" ? [] : raw;
    const today = new Date();
    const todayCount = baseItems.filter((a) => {
      const published = new Date(String(a.publishedAt));
      if (Number.isNaN(published.getTime())) return false;
      return (
        published.getFullYear() === today.getFullYear() &&
        published.getMonth() === today.getMonth() &&
        published.getDate() === today.getDate()
      );
    }).length;
    const importantCount = baseItems.filter(isImportantAnnouncement).length;
    return {
      total: baseItems.length,
      today: todayCount,
      important: importantCount,
    };
  }, [demo.mode, raw]);

  const handleSearch = (query: string) => {
    setQ(query);
    setShowSuggestions(false);
    if (query.trim()) {
      searchHistory.addSearch(query, "announcement");
    }
  };

  const recentSearches = searchHistory.recentSearches("announcement", 5);
  const popularSearches = POPULAR_SEARCHES.announcement;

  const viewFilters: { key: AnnouncementView; label: string; icon: string }[] = [
    { key: "all", label: "全部公告", icon: "list" },
    { key: "important", label: "重要優先", icon: "alert-circle" },
    { key: "today", label: "今天發布", icon: "today" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {isLoading ? (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <LoadingState title="公告" subtitle="載入中..." rows={3} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, paddingTop: insets.top }}>
          <ErrorState
            title="公告"
            subtitle="讀取公告失敗"
            hint={error}
            actionText="重試"
            onAction={() => {
              demo.setMode("normal");
              reload();
            }}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View
            style={{
              paddingTop: insets.top + 12,
              paddingBottom: 20,
              paddingHorizontal: 20,
              backgroundColor: theme.colors.bg,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text
                style={{
                  fontSize: 34,
                  fontWeight: "800",
                  color: theme.colors.text,
                  letterSpacing: -1,
                }}
              >
                公告
              </Text>
              {/* 只有教師/主管/管理員看得到「發佈公告」按鈕 */}
              {canPublish && (
                <Pressable
                  onPress={() =>
                    Alert.alert("發佈公告", "請至管理後台或課程中樞發佈公告。", [{ text: "確定" }])
                  }
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: theme.colors.accent,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    opacity: pressed ? 0.8 : 1,
                  })}
                  accessibilityLabel="發佈新公告"
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>發佈</Text>
                </Pressable>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  alignItems: "center",
                  minWidth: 64,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.accent, fontSize: 20, fontWeight: "800" }}>{stats.total}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>全部</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  alignItems: "center",
                  minWidth: 64,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.danger, fontSize: 20, fontWeight: "800" }}>{stats.important}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>重要</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  alignItems: "center",
                  minWidth: 64,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.success, fontSize: 20, fontWeight: "800" }}>{stats.today}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>今日</Text>
              </View>
              {isOffline && (
                <View
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.warningSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "transparent",
                  }}
                >
                  <Ionicons name="cloud-offline" size={18} color={theme.colors.warning} />
                  <Text style={{ color: theme.colors.warning, fontSize: 11, marginTop: 2 }}>離線</Text>
                </View>
              )}
            </View>
          </View>

          <View style={{ flex: 1, paddingHorizontal: 16, gap: 12 }}>
            {isOffline && lastFetchTime && (
              <OfflineDataNotice cachedAt={lastFetchTime} />
            )}

            <View style={{ marginTop: 4 }}>
              <SearchBar
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setShowSuggestions(v.length === 0);
                }}
                placeholder="搜尋公告（標題/內文/來源）"
                onFocus={() => setShowSuggestions(q.length === 0)}
                onSubmit={() => handleSearch(q)}
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            >
              {viewFilters.map((f) => {
                const isActive = activeView === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setActiveView(f.key)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: theme.radius.full,
                      backgroundColor: isActive ? theme.colors.accent : theme.colors.surface,
                      borderWidth: isActive ? 0 : 1,
                      borderColor: theme.colors.border,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    })}
                  >
                    <Ionicons
                      name={f.icon as any}
                      size={14}
                      color={isActive ? "#fff" : theme.colors.muted}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: isActive ? "#fff" : theme.colors.textSecondary,
                      }}
                    >
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {showSuggestions && (recentSearches.length > 0 || popularSearches.length > 0) ? (
              <View
                style={{
                  padding: theme.space.lg,
                  borderRadius: theme.radius.xl,
                  backgroundColor: theme.colors.surface,
                  borderLeftWidth: 4,
                  borderLeftColor: theme.colors.accent,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  gap: theme.space.md,
                  ...softShadowStyle(theme.shadows.soft),
                }}
              >
                {recentSearches.length > 0 ? (
                  <View style={{ marginBottom: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="time" size={15} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: theme.typography.label.fontSize }}>
                          最近搜尋
                        </Text>
                      </View>
                      <Pressable onPress={() => {
                        Alert.alert(
                          "清除搜尋紀錄",
                          "確定要清除所有搜尋紀錄嗎？",
                          [
                            { text: "取消", style: "cancel" },
                            { text: "清除", style: "destructive", onPress: () => searchHistory.clearHistory() },
                          ]
                        );
                      }}>
                        <Text style={{ color: theme.colors.accent, fontSize: theme.typography.bodySmall.fontSize, fontWeight: "600" }}>清除</Text>
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {recentSearches.map((item) => (
                        <Pressable
                          key={item.timestamp}
                          onPress={() => handleSearch(item.query)}
                          style={({ pressed }) => ({
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: theme.radius.full,
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                          })}
                        >
                          <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.text, fontSize: theme.typography.bodySmall.fontSize }}>{item.query}</Text>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation?.();
                              searchHistory.removeSearch(item.timestamp);
                            }}
                            hitSlop={8}
                          >
                            <Ionicons name="close" size={14} color={theme.colors.muted} />
                          </Pressable>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Ionicons name="trending-up" size={15} color={theme.colors.success} />
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: theme.typography.label.fontSize }}>
                      熱門搜尋
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {popularSearches.map((term) => (
                      <Pressable
                        key={term}
                        onPress={() => handleSearch(term)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.accentSoft,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                        })}
                      >
                        <Ionicons name="trending-up" size={14} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.accent, fontSize: theme.typography.bodySmall.fontSize, fontWeight: "600" }}>{term}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            {items.length === 0 && q.trim() ? (
              <EmptyState
                title="找不到符合的公告"
                subtitle="請換個關鍵字或清除搜尋"
                hint="你也可以試試熱門搜尋關鍵字"
                actionText="清除搜尋"
                onAction={() => setQ("")}
                icon="search-outline"
                variant="search"
              />
            ) : items.length === 0 ? (
              <EmptyState
                title="沒有公告"
                subtitle="目前沒有公告內容"
                hint="下拉刷新或切換學校試試。"
                actionText="重新載入"
                onAction={reload}
                icon="newspaper-outline"
              />
            ) : (
              <>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: theme.colors.muted, fontSize: theme.typography.bodySmall.fontSize }}>
                    {`結果：${items.length}`}
                  </Text>
                  {(refreshing || isSearching) && (
                    <Text style={{ color: theme.colors.accent, fontSize: theme.typography.bodySmall.fontSize, fontWeight: "600" }}>
                      {isSearching ? "搜尋中..." : "更新中..."}
                    </Text>
                  )}
                </View>
                <FlatList
                  data={items}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={handleRefresh}
                      tintColor={theme.colors.accent}
                      colors={[theme.colors.accent]}
                    />
                  }
                  renderItem={({ item: a }) => {
                    const isImportant = isImportantAnnouncement(a);
                    const iconInfo = getAnnouncementIcon(a);
                    const accentColor = isImportant ? theme.colors.danger : theme.colors.accent;

                    const goDetail = () => {
                      try {
                        if (nav && typeof nav.navigate === "function") {
                          nav.navigate("公告詳情", { id: a.id });
                        } else {
                          toastRef.current.show({
                            message: "導航暫時無法使用，請稍後再試",
                            type: "warning",
                            duration: 2000,
                          });
                        }
                      } catch (error) {
                        toastRef.current.show({
                          message: "開啟詳情失敗",
                          type: "error",
                          duration: 2000,
                        });
                      }
                    };

                    return (
                      <Pressable
                        onPress={goDetail}
                        style={({ pressed }) => ({
                          borderRadius: theme.radius.lg,
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                        })}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={`查看公告：${a.title}`}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            padding: theme.space.lg,
                            borderRadius: theme.radius.lg,
                            backgroundColor: theme.colors.surface,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            borderLeftWidth: 4,
                            borderLeftColor: accentColor,
                            gap: 12,
                            ...softShadowStyle(theme.shadows.soft),
                          }}
                        >
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 12,
                              backgroundColor: iconInfo.bg,
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 2,
                            }}
                          >
                            <Ionicons name={iconInfo.name as any} size={20} color={iconInfo.color} />
                          </View>

                          <View style={{ flex: 1, gap: 6 }}>
                            <Text
                              style={{
                                fontSize: 16,
                                fontWeight: "700",
                                lineHeight: 22,
                                color: theme.colors.text,
                              }}
                              numberOfLines={2}
                            >
                              {a.title}
                            </Text>
                            <Text
                              style={{
                                color: theme.colors.muted,
                                fontSize: 12,
                                lineHeight: 16,
                              }}
                            >
                              {formatDateTime(a.publishedAt) + (a.source ? ` · ${a.source}` : "")}
                            </Text>
                            <View pointerEvents={Platform.OS === "web" ? "none" : "auto"}>
                              <Text
                                style={{
                                  color: theme.colors.textSecondary,
                                  fontSize: theme.typography.bodySmall.fontSize,
                                  lineHeight: theme.typography.bodySmall.lineHeight,
                                  marginTop: 2,
                                }}
                                numberOfLines={2}
                              >
                                {a.body}
                              </Text>
                            </View>
                          </View>

                          <View style={{ justifyContent: "center" }}>
                            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                          </View>
                        </View>
                      </Pressable>
                    );
                  }}
                />
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
