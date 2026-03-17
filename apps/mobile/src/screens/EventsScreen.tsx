import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { ScrollView, Text, View, Pressable, FlatList, RefreshControl, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useDebounce } from "../hooks/useDebounce";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { Card, Pill, LoadingState, EmptyState, ErrorState, SearchBar, SegmentedControl, FilterChips, StatusBadge, SortButton } from "../ui/components";
import { OfflineDataNotice } from "../ui/OfflineBanner";
import { useSchool } from "../state/school";
import { useDemo } from "../state/demo";
import { useFavorites } from "../state/favorites";
import { useToast } from "../ui/Toast";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, shadowStyle } from "../ui/theme";
import { formatDateTime, toDate, formatRelativeTime } from "../utils/format";

type ClubEvent = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: unknown;
  endsAt?: unknown;
  capacity?: number;
  registeredCount?: number;
};

type TimeFilter = "all" | "today" | "week" | "month" | "past";
type SortOption = "date_asc" | "date_desc" | "name";
type ViewMode = "list" | "card";

const TIME_FILTERS = [
  { key: "all", label: "全部" },
  { key: "today", label: "今天" },
  { key: "week", label: "本週" },
  { key: "month", label: "本月" },
  { key: "past", label: "已結束" },
];

const SORT_OPTIONS = [
  { key: "date_asc", label: "時間由近到遠" },
  { key: "date_desc", label: "時間由遠到近" },
  { key: "name", label: "名稱 A-Z" },
];

function getEventStatus(startsAt: any, endsAt: any): "upcoming" | "ongoing" | "ended" {
  const now = new Date();
  const start = toDate(startsAt);
  const end = toDate(endsAt);
  
  if (!start) {
    if (end && now > end) return "ended";
    return "upcoming";
  }
  
  if (now < start) return "upcoming";
  if (end && now > end) return "ended";
  if (now >= start) return "ongoing";
  return "upcoming";
}

function isEventFull(capacity: number | undefined, registeredCount: number | undefined): boolean {
  if (capacity === undefined || capacity === null) return false;
  if (capacity === 0) return true;
  return (registeredCount ?? 0) >= capacity;
}

function hasAvailableSpots(capacity: number | undefined, registeredCount: number | undefined): boolean {
  if (capacity === undefined || capacity === null) return true;
  if (capacity === 0) return false;
  return (registeredCount ?? 0) < capacity;
}

function isInTimeRange(date: Date | null, filter: TimeFilter): boolean {
  if (!date) return filter === "all";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  switch (filter) {
    case "all":
      return true;
    case "today":
      return date >= today && date < tomorrow;
    case "week":
      return date >= today && date < weekEnd;
    case "month":
      return date >= today && date <= monthEnd;
    case "past":
      return date < now;
    default:
      return true;
  }
}

const STATUS_COLORS: Record<string, string> = {
  ongoing: "#22C55E",
  upcoming: "#F59E0B",
  ended: "#71717A",
};

const CARD_BANNER_GRADIENTS: Record<string, [string, string]> = {
  ongoing: ["#22C55E", "#16A34A"],
  upcoming: ["#6366F1", "#818CF8"],
  ended: ["#71717A", "#52525B"],
};

export function EventsScreen(props: any) {
  const { school } = useSchool();
  const navigation = useNavigation();
  const nav = props?.navigation ?? navigation;
  const fav = useFavorites();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { isOffline } = useNetworkStatus();
  const insets = useSafeAreaInsets();

  const demo = useDemo();

  const [q, setQ] = useState("");
  const [lastFetchTime, setLastFetchTime] = useState<number | undefined>(undefined);
  const debouncedQuery = useDebounce(q, 300);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("date_asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

  const ds = useDataSource();

  const refreshRef = React.useRef<(() => Promise<void>) | null>(null);

  const handleRefreshError = useCallback((error: string) => {
    toastRef.current.show({
      message: `更新失敗：${error}`,
      type: "error",
      duration: 4000,
      action: {
        text: "重試",
        onPress: () => {
          if (refreshRef.current) {
            refreshRef.current();
          }
        },
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
  } = useAsyncList<ClubEvent>(
    () => ds.listEvents(school.id),
    [ds, school.id],
    { keepPreviousData: true, onRefreshError: handleRefreshError }
  );

  React.useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!loadLoading && raw.length > 0) {
      setLastFetchTime(Date.now());
    }
  }, [loadLoading, raw.length]);

  const isLoading = demo.mode === "loading" || (demo.mode === "normal" && loadLoading && raw.length === 0);
  const error = demo.mode === "error" ? "(demo) 讀取活動失敗" : demo.mode === "normal" ? loadError : null;

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

  const locationOptions = useMemo(() => {
    const locations = new Set<string>();
    raw.forEach((e) => {
      if (e.location) locations.add(e.location);
    });
    return Array.from(locations).map((l) => ({ key: l, label: l, icon: "location-outline" }));
  }, [raw]);

  const stats = useMemo(() => {
    const now = new Date();
    const base = demo.mode === "empty" ? [] : raw;
    let upcoming = 0;
    let ongoing = 0;
    let today = 0;

    base.forEach((e) => {
      const status = getEventStatus(e.startsAt, e.endsAt);
      if (status === "upcoming") upcoming++;
      if (status === "ongoing") ongoing++;

      const startDate = toDate(e.startsAt);
      if (startDate) {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
        if (startDate >= todayStart && startDate < todayEnd) today++;
      }
    });

    return { upcoming, ongoing, today, total: base.length };
  }, [demo.mode, raw]);

  const items = useMemo(() => {
    let base = demo.mode === "empty" ? [] : [...raw];

    if (debouncedQuery.trim()) {
      const needle = debouncedQuery.trim().toLowerCase();
      base = base.filter((e) => {
        const hay = `${e.title}\n${e.description}\n${e.location ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
    }

    if (timeFilter !== "all") {
      if (timeFilter === "past") {
        base = base.filter((e) => getEventStatus(e.startsAt, e.endsAt) === "ended");
      } else {
        base = base.filter((e) => {
          const startDate = toDate(e.startsAt);
          return isInTimeRange(startDate, timeFilter) && getEventStatus(e.startsAt, e.endsAt) !== "ended";
        });
      }
    }

    if (selectedLocations.length > 0) {
      base = base.filter((e) => e.location && selectedLocations.includes(e.location));
    }

    if (showFavoritesOnly) {
      base = base.filter((e) => fav.isFavorite("event", e.id));
    }

    if (showAvailableOnly) {
      base = base.filter((e) => {
        const status = getEventStatus(e.startsAt, e.endsAt);
        if (status === "ended") return false;
        return hasAvailableSpots(e.capacity, e.registeredCount);
      });
    }

    switch (sortBy) {
      case "date_asc":
        base.sort((a, b) => {
          const aDate = toDate(a.startsAt)?.getTime() ?? 0;
          const bDate = toDate(b.startsAt)?.getTime() ?? 0;
          return aDate - bDate;
        });
        break;
      case "date_desc":
        base.sort((a, b) => {
          const aDate = toDate(a.startsAt)?.getTime() ?? 0;
          const bDate = toDate(b.startsAt)?.getTime() ?? 0;
          return bDate - aDate;
        });
        break;
      case "name":
        base.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", "zh-TW"));
        break;
    }

    return base;
  }, [demo.mode, debouncedQuery, raw, timeFilter, selectedLocations, sortBy, showFavoritesOnly, showAvailableOnly, fav]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedLocations.length > 0) count++;
    if (showFavoritesOnly) count++;
    if (showAvailableOnly) count++;
    if (timeFilter !== "all") count++;
    return count;
  }, [selectedLocations, showFavoritesOnly, showAvailableOnly, timeFilter]);

  const clearFilters = () => {
    setSelectedLocations([]);
    setShowFavoritesOnly(false);
    setShowAvailableOnly(false);
    setTimeFilter("all");
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <LinearGradient
        colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + 8,
          paddingBottom: 20,
          paddingHorizontal: theme.space.lg,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
        }}
      >
        <Text
          style={{
            color: "#fff",
            fontSize: 28,
            fontWeight: "900",
            letterSpacing: -0.5,
            marginBottom: 16,
          }}
        >
          活動
        </Text>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-around",
            gap: 10,
          }}
        >
          <View
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 10,
              borderRadius: theme.radius.lg,
              backgroundColor: "rgba(255,255,255,0.18)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22 }}>{stats.today}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600", marginTop: 2 }}>今日</Text>
          </View>
          <View
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 10,
              borderRadius: theme.radius.lg,
              backgroundColor: "rgba(255,255,255,0.18)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22 }}>{stats.ongoing}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600", marginTop: 2 }}>進行中</Text>
          </View>
          <View
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 10,
              borderRadius: theme.radius.lg,
              backgroundColor: "rgba(255,255,255,0.18)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22 }}>{stats.upcoming}</Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600", marginTop: 2 }}>即將開始</Text>
          </View>
        </View>
      </LinearGradient>

      {isLoading ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg }}>
          <LoadingState title="活動" subtitle="載入中..." rows={3} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg }}>
          <ErrorState
            title="活動"
            subtitle="讀取活動失敗"
            hint={error}
            actionText="重試"
            onAction={() => {
              demo.setMode("normal");
              reload();
            }}
          />
        </View>
      ) : (
        <View style={{ flex: 1, gap: theme.space.md, paddingHorizontal: theme.space.lg, paddingTop: theme.space.md }}>
          {isOffline && lastFetchTime && (
            <OfflineDataNotice cachedAt={lastFetchTime} />
          )}

          <SearchBar value={q} onChange={setQ} placeholder="搜尋活動（標題/描述/地點）" />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {TIME_FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setTimeFilter(f.key as TimeFilter)}
                style={({ pressed }) => ({
                  paddingHorizontal: 18,
                  paddingVertical: 10,
                  borderRadius: theme.radius.full,
                  borderWidth: timeFilter === f.key ? 0 : 1,
                  borderColor: theme.colors.border,
                  backgroundColor: timeFilter === f.key ? theme.colors.accent : theme.colors.surface,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  ...shadowStyle(theme.shadows.sm),
                })}
              >
                <Text
                  style={{
                    color: timeFilter === f.key ? "#fff" : theme.colors.muted,
                    fontWeight: "700",
                    fontSize: theme.typography.bodySmall.fontSize,
                  }}
                >
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable
              onPress={() => setShowFilters(!showFilters)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: activeFilterCount > 0 ? theme.colors.accent : theme.colors.border,
                backgroundColor: activeFilterCount > 0 ? theme.colors.accentSoft : theme.colors.surface,
                transform: [{ scale: pressed ? 0.97 : 1 }],
                ...shadowStyle(theme.shadows.sm),
              })}
            >
              <Ionicons name="options" size={16} color={activeFilterCount > 0 ? theme.colors.accent : theme.colors.muted} />
              <Text
                style={{
                  color: activeFilterCount > 0 ? theme.colors.accent : theme.colors.textSecondary,
                  fontWeight: "600",
                  fontSize: theme.typography.bodySmall.fontSize,
                }}
              >
                更多篩選{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Text>
            </Pressable>

            <SortButton options={SORT_OPTIONS} selected={sortBy} onChange={(k) => setSortBy(k as SortOption)} />

            <View style={{ flex: 1 }} />

            <Pressable
              onPress={() => setViewMode(viewMode === "list" ? "card" : "list")}
              style={({ pressed }) => ({
                padding: 10,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                transform: [{ scale: pressed ? 0.97 : 1 }],
                ...shadowStyle(theme.shadows.sm),
              })}
            >
              <Ionicons name={viewMode === "list" ? "albums-outline" : "list-outline"} size={18} color={theme.colors.muted} />
            </Pressable>
          </View>

          {showFilters && (
            <View
              style={{
                padding: theme.space.lg,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                gap: 14,
                ...shadowStyle(theme.shadows.sm),
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontWeight: "700",
                    fontSize: theme.typography.h3.fontSize,
                  }}
                >
                  進階篩選
                </Text>
                {activeFilterCount > 0 && (
                  <Pressable onPress={clearFilters}>
                    <Text style={{ color: theme.colors.accent, fontSize: theme.typography.bodySmall.fontSize }}>清除全部</Text>
                  </Pressable>
                )}
              </View>

              {locationOptions.length > 0 && (
                <View>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.labelSmall.fontSize, marginBottom: 8 }}>活動地點</Text>
                  <FilterChips options={locationOptions} selected={selectedLocations} onChange={setSelectedLocations} multiple />
                </View>
              )}

              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={() => setShowFavoritesOnly(!showFavoritesOnly)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: theme.radius.xs,
                      borderWidth: 2,
                      borderColor: showFavoritesOnly ? theme.colors.accent : theme.colors.border,
                      backgroundColor: showFavoritesOnly ? theme.colors.accent : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {showFavoritesOnly && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={{ color: theme.colors.text, fontSize: theme.typography.label.fontSize }}>只顯示收藏的活動</Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowAvailableOnly(!showAvailableOnly)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: theme.radius.xs,
                      borderWidth: 2,
                      borderColor: showAvailableOnly ? theme.colors.accent : theme.colors.border,
                      backgroundColor: showAvailableOnly ? theme.colors.accent : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {showAvailableOnly && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                  <Text style={{ color: theme.colors.text, fontSize: theme.typography.label.fontSize }}>只顯示可報名的活動</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted, fontSize: theme.typography.bodySmall.fontSize }}>
              {`找到 ${items.length} 場活動`}
            </Text>
            {refreshing && (
              <Text style={{ color: theme.colors.accent, fontSize: theme.typography.bodySmall.fontSize }}>更新中...</Text>
            )}
          </View>

          {items.length === 0 ? (
            <EmptyState
              title={
                debouncedQuery.trim() && (activeFilterCount > 0)
                  ? `找不到「${debouncedQuery}」相關的活動`
                  : debouncedQuery.trim()
                    ? `找不到「${debouncedQuery}」相關的活動`
                    : activeFilterCount > 0
                      ? "目前篩選條件下沒有活動"
                      : "沒有活動"
              }
              subtitle={
                debouncedQuery.trim() || activeFilterCount > 0
                  ? "請換個關鍵字或調整篩選條件"
                  : "目前沒有活動"
              }
              hint="下拉刷新或切換學校試試。"
              actionText={activeFilterCount > 0 || debouncedQuery.trim() ? "清除篩選" : "重新載入"}
              onAction={
                activeFilterCount > 0 || debouncedQuery.trim()
                  ? () => {
                      clearFilters();
                      setQ("");
                    }
                  : reload
              }
              icon={debouncedQuery.trim() ? "search-outline" : activeFilterCount > 0 ? "filter-outline" : "calendar-outline"}
              variant={debouncedQuery.trim() ? "search" : activeFilterCount > 0 ? "filter" : "default"}
            />
          ) : (
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
              renderItem={({ item: e }) => {
                const goDetail = () => {
                  try {
                    if (nav && typeof nav.navigate === "function") {
                      nav.navigate("EventDetail", { id: e.id });
                    } else {
                      toastRef.current.show({
                        message: "導航暫時無法使用",
                        type: "warning",
                        duration: 2000,
                      });
                    }
                  } catch (error) {
                    toastRef.current.show({
                      message: "開啟活動詳情失敗",
                      type: "error",
                      duration: 2000,
                    });
                  }
                };
                const range = `${formatDateTime(e.startsAt)} ~ ${formatDateTime(e.endsAt)}`;
                const isFav = fav.isFavorite("event", e.id);
                const status = getEventStatus(e.startsAt, e.endsAt);
                const startDate = toDate(e.startsAt);
                const statusColor = STATUS_COLORS[status];
                const bannerGradient = CARD_BANNER_GRADIENTS[status];

                if (viewMode === "card") {
                  return (
                    <Pressable
                      key={e.id}
                      onPress={goDetail}
                      style={({ pressed }) => ({
                        borderRadius: theme.radius.lg,
                        overflow: "hidden",
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      })}
                    >
                      <View
                        style={{
                          borderRadius: theme.radius.lg,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surface,
                          overflow: "hidden",
                          ...shadowStyle(theme.shadows.md),
                        }}
                      >
                        <LinearGradient
                          colors={bannerGradient}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={{
                            height: 100,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="calendar" size={40} color="rgba(255,255,255,0.85)" />
                          {status === "ongoing" && (
                            <View
                              style={{
                                position: "absolute",
                                top: 10,
                                right: 10,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                                borderRadius: theme.radius.full,
                                backgroundColor: "rgba(255,255,255,0.25)",
                              }}
                            >
                              <Text style={{ color: "#fff", fontSize: theme.typography.caption.fontSize, fontWeight: "700" }}>進行中</Text>
                            </View>
                          )}
                          {status === "upcoming" && (
                            <View
                              style={{
                                position: "absolute",
                                top: 10,
                                right: 10,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                                borderRadius: theme.radius.full,
                                backgroundColor: "rgba(255,255,255,0.25)",
                              }}
                            >
                              <Text style={{ color: "#fff", fontSize: theme.typography.caption.fontSize, fontWeight: "700" }}>即將開始</Text>
                            </View>
                          )}
                          {status === "ended" && (
                            <View
                              style={{
                                position: "absolute",
                                top: 10,
                                right: 10,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                                borderRadius: theme.radius.full,
                                backgroundColor: "rgba(0,0,0,0.25)",
                              }}
                            >
                              <Text style={{ color: "#fff", fontSize: theme.typography.caption.fontSize, fontWeight: "700" }}>已結束</Text>
                            </View>
                          )}
                          {isFav && (
                            <View style={{ position: "absolute", top: 10, left: 10 }}>
                              <Ionicons name="heart" size={22} color="#fff" />
                            </View>
                          )}
                        </LinearGradient>
                        <View style={{ padding: theme.space.md, gap: 8 }}>
                          <Text
                            style={{
                              color: theme.colors.text,
                              fontWeight: "800",
                              fontSize: theme.typography.h3.fontSize,
                              lineHeight: theme.typography.h3.lineHeight,
                            }}
                            numberOfLines={2}
                          >
                            {e.title}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
                            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.labelSmall.fontSize }}>
                              {startDate ? formatRelativeTime(startDate) : formatDateTime(e.startsAt)}
                            </Text>
                          </View>
                          {e.location && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
                              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.labelSmall.fontSize }}>
                                {e.location}
                              </Text>
                            </View>
                          )}
                          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                            {e.capacity ? (
                              <Pill
                                text={`${e.registeredCount ?? 0}/${e.capacity} 人`}
                                kind={(e.registeredCount ?? 0) >= e.capacity ? "danger" : "accent"}
                                size="sm"
                              />
                            ) : (
                              <Pill text={e.registeredCount ? `${e.registeredCount} 人報名` : "不限人數"} size="sm" />
                            )}
                          </View>
                        </View>
                      </View>
                    </Pressable>
                  );
                }

                return (
                  <Pressable
                    onPress={goDetail}
                    style={({ pressed }) => ({
                      borderRadius: theme.radius.lg,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    })}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`查看活動：${e.title}`}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        borderRadius: theme.radius.lg,
                        backgroundColor: theme.colors.surface,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        overflow: "hidden",
                        ...shadowStyle(theme.shadows.md),
                      }}
                    >
                      <View
                        style={{
                          width: 5,
                          backgroundColor: statusColor,
                        }}
                      />
                      <View style={{ flex: 1, padding: theme.space.lg, gap: 10 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 5,
                              backgroundColor: statusColor,
                            }}
                          />
                          <Text
                            style={{
                              flex: 1,
                              fontSize: theme.typography.h3.fontSize,
                              fontWeight: "800",
                              lineHeight: theme.typography.h3.lineHeight,
                              letterSpacing: theme.typography.h3.letterSpacing,
                              color: theme.colors.text,
                            }}
                            numberOfLines={2}
                          >
                            {e.title}
                          </Text>
                          {isFav && <Ionicons name="heart" size={16} color={theme.colors.danger} />}
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name="time-outline" size={13} color={theme.colors.muted} />
                          <Text
                            style={{
                              color: theme.colors.textSecondary,
                              fontSize: theme.typography.bodySmall.fontSize,
                              lineHeight: theme.typography.bodySmall.lineHeight,
                            }}
                          >
                            {range}
                          </Text>
                        </View>

                        {e.location && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Ionicons name="location-outline" size={13} color={theme.colors.muted} />
                            <Text
                              style={{
                                color: theme.colors.textSecondary,
                                fontSize: theme.typography.bodySmall.fontSize,
                              }}
                            >
                              {e.location}
                            </Text>
                          </View>
                        )}

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          {status === "ongoing" && (
                            <View
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 3,
                                borderRadius: theme.radius.full,
                                backgroundColor: theme.colors.successSoft,
                              }}
                            >
                              <Text style={{ color: theme.colors.success, fontSize: theme.typography.caption.fontSize, fontWeight: "700" }}>
                                進行中
                              </Text>
                            </View>
                          )}
                          {status === "upcoming" && startDate && (
                            <View
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 3,
                                borderRadius: theme.radius.full,
                                backgroundColor: theme.colors.warningSoft,
                              }}
                            >
                              <Text style={{ color: theme.colors.warning, fontSize: theme.typography.caption.fontSize, fontWeight: "700" }}>
                                {formatRelativeTime(startDate)}
                              </Text>
                            </View>
                          )}
                          {status === "ended" && (
                            <View
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 3,
                                borderRadius: theme.radius.full,
                                backgroundColor: theme.colors.disabledBg,
                              }}
                            >
                              <Text style={{ color: theme.colors.muted, fontSize: theme.typography.caption.fontSize, fontWeight: "700" }}>
                                已結束
                              </Text>
                            </View>
                          )}
                        </View>

                        {e.description ? (
                          <Text
                            style={{
                              color: theme.colors.textSecondary,
                              fontSize: theme.typography.body.fontSize,
                              lineHeight: theme.typography.body.lineHeight,
                            }}
                            numberOfLines={2}
                          >
                            {e.description}
                          </Text>
                        ) : null}

                        <View style={{ marginTop: 4, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          {e.capacity ? (
                            <Pill
                              text={`${e.registeredCount ?? 0}/${e.capacity} 人報名`}
                              kind={(e.registeredCount ?? 0) >= e.capacity ? "danger" : "accent"}
                              size="sm"
                            />
                          ) : (
                            <Pill text={e.registeredCount ? `${e.registeredCount} 人報名` : "名額不限"} kind="accent" size="sm" />
                          )}
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}
