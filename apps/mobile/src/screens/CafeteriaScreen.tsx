import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { FlatList, Pressable, Text, View, RefreshControl, ListRenderItem } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useDebounce } from "../hooks/useDebounce";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { Pill, LoadingState, EmptyState, ErrorState, SearchBar, FilterChips, SortButton } from "../ui/components";
import { OfflineDataNotice } from "../ui/OfflineBanner";
import { useSchool } from "../state/school";
import { useDemo } from "../state/demo";
import { useFavorites } from "../state/favorites";
import { useToast } from "../ui/Toast";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import { formatDateTime } from "../utils/format";

type MenuItem = {
  id: string;
  name?: string;
  cafeteria?: string;
  price?: number | null;
  availableOn?: unknown;
};

type SortOption = "default" | "price_asc" | "price_desc" | "name";
type ViewMode = "list" | "grid";

const PRICE_RANGES = [
  { key: "all", label: "全部" },
  { key: "under50", label: "$50以下", icon: "pricetag-outline" },
  { key: "50to100", label: "$50-100", icon: "pricetag-outline" },
  { key: "over100", label: "$100以上", icon: "pricetag-outline" },
];

const SORT_OPTIONS = [
  { key: "default", label: "預設排序" },
  { key: "price_asc", label: "價格低到高" },
  { key: "price_desc", label: "價格高到低" },
  { key: "name", label: "名稱 A-Z" },
];

const CATEGORY_COLORS = [
  { bg: theme.colors.accentSoft, fg: theme.colors.accent, border: theme.colors.accent },
  { bg: theme.colors.successSoft, fg: theme.colors.success, border: theme.colors.success },
  { bg: theme.colors.warningSoft, fg: theme.colors.warning, border: theme.colors.warning },
  { bg: theme.colors.infoSoft, fg: theme.colors.info, border: theme.colors.info },
  { bg: theme.colors.dangerSoft, fg: theme.colors.danger, border: theme.colors.danger },
];

function getCafeteriaColor(index: number) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

export function CafeteriaScreen(props: any) {
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
  const debouncedQuery = useDebounce(q, 300);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCafeterias, setSelectedCafeterias] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>("default");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number | undefined>(undefined);

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

  const ds = useDataSource();
  const { items: raw, error: loadError, loading: loadLoading, refreshing, reload, refresh } = useAsyncList<MenuItem>(
    () => ds.listMenus(school.id),
    [ds, school.id],
    { keepPreviousData: true, onRefreshError: handleRefreshError }
  );

  const isLoading = demo.mode === "loading" || (demo.mode === "normal" && loadLoading && raw.length === 0);
  const error = demo.mode === "error" ? "(demo) 讀取菜單失敗" : demo.mode === "normal" ? loadError : null;

  useEffect(() => {
    if (!loadLoading && raw.length > 0) {
      setLastFetchTime(Date.now());
    }
  }, [loadLoading, raw.length]);

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

  const cafeteriaOptions = useMemo(() => {
    const cafeterias = new Set<string>();
    raw.forEach((m) => {
      if (m.cafeteria) cafeterias.add(m.cafeteria);
    });
    return Array.from(cafeterias).map((c) => ({ key: c, label: c, icon: "restaurant-outline" }));
  }, [raw]);

  const cafeteriaColorMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getCafeteriaColor>>();
    cafeteriaOptions.forEach((c, i) => map.set(c.key, getCafeteriaColor(i)));
    return map;
  }, [cafeteriaOptions]);

  const items = useMemo(() => {
    let base = demo.mode === "empty" ? [] : [...raw];

    if (debouncedQuery.trim()) {
      const needle = debouncedQuery.trim().toLowerCase();
      base = base.filter((m) => {
        const hay = `${m.name ?? ""}\n${m.cafeteria ?? ""}\n${formatDateTime(m.availableOn)}`.toLowerCase();
        return hay.includes(needle);
      });
    }

    if (selectedCafeterias.length > 0) {
      base = base.filter((m) => selectedCafeterias.includes(m.cafeteria));
    }

    if (priceRange.length > 0 && !priceRange.includes("all")) {
      base = base.filter((m) => {
        if (m.price == null) {
          return false;
        }
        const price = m.price;
        return priceRange.some((range) => {
          if (range === "under50") return price < 50;
          if (range === "50to100") return price >= 50 && price <= 100;
          if (range === "over100") return price > 100;
          return true;
        });
      });
    }

    if (showFavoritesOnly) {
      base = base.filter((m) => fav.isFavorite("menu", m.id));
    }

    switch (sortBy) {
      case "price_asc":
        base.sort((a, b) => {
          const priceA = a.price ?? Infinity;
          const priceB = b.price ?? Infinity;
          return priceA - priceB;
        });
        break;
      case "price_desc":
        base.sort((a, b) => {
          const priceA = a.price ?? -Infinity;
          const priceB = b.price ?? -Infinity;
          return priceB - priceA;
        });
        break;
      case "name":
        base.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "zh-TW"));
        break;
    }

    return base;
  }, [demo.mode, debouncedQuery, raw, selectedCafeterias, priceRange, sortBy, showFavoritesOnly, fav]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCafeterias.length > 0) count++;
    if (priceRange.length > 0 && !priceRange.includes("all")) count++;
    if (showFavoritesOnly) count++;
    return count;
  }, [selectedCafeterias, priceRange, showFavoritesOnly]);

  const clearFilters = () => {
    setSelectedCafeterias([]);
    setPriceRange([]);
    setShowFavoritesOnly(false);
    setSortBy("default");
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {isLoading ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg, paddingTop: insets.top + theme.space.md }}>
          <LoadingState title="餐廳" subtitle="載入中..." rows={3} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg, paddingTop: insets.top + theme.space.md }}>
          <ErrorState
            title="餐廳"
            subtitle="讀取菜單失敗"
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
              paddingHorizontal: theme.space.lg,
              backgroundColor: theme.colors.bg,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="restaurant" size={22} color={theme.colors.accent} />
                </View>
                <Text style={{ fontSize: 34, fontWeight: "800", color: theme.colors.text, letterSpacing: -1 }}>
                  餐廳
                </Text>
              </View>
              {raw.length > 0 && (
                <View style={{
                  backgroundColor: theme.colors.accentSoft,
                  borderRadius: theme.radius.full,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}>
                  <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 13 }}>
                    {`${items.length} 項餐點`}
                  </Text>
                </View>
              )}
            </View>

            {cafeteriaOptions.length > 0 && (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                {cafeteriaOptions.slice(0, 3).map((c) => (
                  <View key={c.key} style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.full,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600" }}>
                      {c.label}
                    </Text>
                  </View>
                ))}
                {cafeteriaOptions.length > 3 && (
                  <View style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.full,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "600" }}>
                      +{cafeteriaOptions.length - 3}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {isOffline && lastFetchTime && (
            <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm }}>
              <OfflineDataNotice cachedAt={lastFetchTime} />
            </View>
          )}

          <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, gap: theme.space.md, flex: 1 }}>
            <SearchBar value={q} onChange={setQ} placeholder="搜尋餐點（名稱/餐廳/日期）" />

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
                  backgroundColor: activeFilterCount > 0
                    ? theme.colors.accentSoft
                    : theme.colors.surface,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  ...softShadowStyle(theme.shadows.soft),
                })}
              >
                <Ionicons name="filter" size={16} color={activeFilterCount > 0 ? theme.colors.accent : theme.colors.textSecondary} />
                <Text
                  style={{
                    color: activeFilterCount > 0 ? theme.colors.accent : theme.colors.text,
                    fontWeight: "600",
                    fontSize: theme.typography.bodySmall.fontSize,
                  }}
                >
                  篩選{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </Text>
              </Pressable>

              <SortButton options={SORT_OPTIONS} selected={sortBy} onChange={(k) => setSortBy(k as SortOption)} />

              <View style={{ flex: 1 }} />

              <Pressable
                onPress={() => setViewMode(viewMode === "list" ? "grid" : "list")}
                style={({ pressed }) => ({
                  padding: 10,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  ...softShadowStyle(theme.shadows.soft),
                })}
              >
                <Ionicons name={viewMode === "list" ? "grid-outline" : "list-outline"} size={18} color={theme.colors.textSecondary} />
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
                  gap: 16,
                  ...softShadowStyle(theme.shadows.soft),
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.typography.h3.fontSize,
                      fontWeight: theme.typography.h3.fontWeight ?? "600",
                    }}
                  >
                    篩選條件
                  </Text>
                  {activeFilterCount > 0 && (
                    <Pressable onPress={clearFilters} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                      <Text style={{ color: theme.colors.accent, ...theme.typography.bodySmall, fontWeight: "600" }}>清除全部</Text>
                    </Pressable>
                  )}
                </View>

                <View>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.labelSmall, marginBottom: 8 }}>價格區間</Text>
                  <FilterChips options={PRICE_RANGES} selected={priceRange} onChange={setPriceRange} multiple />
                </View>

                {cafeteriaOptions.length > 0 && (
                  <View>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.labelSmall, marginBottom: 8 }}>餐廳</Text>
                    <FilterChips options={cafeteriaOptions} selected={selectedCafeterias} onChange={setSelectedCafeterias} multiple />
                  </View>
                )}

                <View>
                  <Pressable
                    onPress={() => setShowFavoritesOnly(!showFavoritesOnly)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      opacity: pressed ? 0.8 : 1,
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
                    <Text style={{ color: theme.colors.text, ...theme.typography.body }}>只顯示收藏的餐點</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall }}>
                {`找到 ${items.length} 項餐點`}
              </Text>
              {items.length > 0 && sortBy !== "default" && (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall }}>
                  已按{SORT_OPTIONS.find((o) => o.key === sortBy)?.label}排序
                </Text>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => {
                  if (nav && typeof nav.navigate === "function") {
                    const defaultCafeteria = cafeteriaOptions.length > 0 ? cafeteriaOptions[0].key : undefined;
                    nav.navigate("Ordering", { cafeteria: defaultCafeteria });
                  }
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: theme.colors.accent,
                  gap: 10,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  ...softShadowStyle(theme.shadows.soft),
                })}
                accessibilityRole="button"
                accessibilityLabel="前往線上點餐"
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="cart" size={18} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontWeight: theme.typography.label.fontWeight,
                      fontSize: theme.typography.label.fontSize,
                    }}
                  >
                    線上點餐
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                    預訂餐點
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
              </Pressable>

              <Pressable
                onPress={() => {
                  if (nav && typeof nav.navigate === "function") {
                    nav.navigate("MenuSubscription");
                  }
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: theme.colors.success,
                  gap: 10,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  ...softShadowStyle(theme.shadows.soft),
                })}
                accessibilityRole="button"
                accessibilityLabel="前往菜單訂閱"
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.successSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="notifications" size={18} color={theme.colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontWeight: theme.typography.label.fontWeight,
                      fontSize: theme.typography.label.fontSize,
                    }}
                  >
                    菜單訂閱
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                    每日推播
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
              </Pressable>
            </View>

            <FlatList
              key={viewMode}
              data={items}
              keyExtractor={(item) => item.id}
              numColumns={viewMode === "grid" ? 2 : 1}
              contentContainerStyle={{ 
                gap: viewMode === "grid" ? 12 : 10,
                paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
                flexGrow: items.length === 0 ? 1 : undefined,
              }}
              columnWrapperStyle={viewMode === "grid" ? { gap: 12 } : undefined}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={theme.colors.accent}
                  colors={[theme.colors.accent]}
                />
              }
              ListEmptyComponent={
                <EmptyState
                  title={q.trim() || activeFilterCount > 0 ? "找不到符合的餐點" : "沒有菜單"}
                  subtitle={q.trim() || activeFilterCount > 0 ? "請換個關鍵字或調整篩選條件" : "目前沒有菜單"}
                  hint="你可以切換學校或稍後再試。"
                  actionText={activeFilterCount > 0 ? "清除篩選" : undefined}
                  onAction={activeFilterCount > 0 ? clearFilters : undefined}
                />
              }
              renderItem={({ item: m }) => {
                const goDetail = () => {
                  try {
                    if (nav && typeof nav.navigate === "function") {
                      nav.navigate("MenuDetail", { id: m.id });
                    } else {
                      toastRef.current.show({
                        message: "導航暫時無法使用",
                        type: "warning",
                        duration: 2000,
                      });
                    }
                  } catch (error) {
                    toastRef.current.show({
                      message: "開啟餐點詳情失敗",
                      type: "error",
                      duration: 2000,
                    });
                  }
                };
                const isFav = fav.isFavorite("menu", m.id);
                const cafColor = cafeteriaColorMap.get(m.cafeteria ?? "") ?? CATEGORY_COLORS[0];

                if (viewMode === "list") {
                  return (
                    <Pressable
                      onPress={goDetail}
                      style={({ pressed }) => ({
                        borderRadius: theme.radius.lg,
                        backgroundColor: theme.colors.surface,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderLeftWidth: 4,
                        borderLeftColor: cafColor.fg,
                        padding: theme.space.lg,
                        gap: 10,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                        ...softShadowStyle(theme.shadows.soft),
                      })}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`查看餐點：${m.name}`}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: theme.radius.md,
                            backgroundColor: cafColor.bg,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="restaurant" size={20} color={cafColor.fg} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: theme.colors.text,
                              fontSize: theme.typography.h3.fontSize,
                              fontWeight: theme.typography.h3.fontWeight ?? "600",
                              letterSpacing: theme.typography.h3.letterSpacing,
                            }}
                            numberOfLines={1}
                          >
                            {m.name ?? m.cafeteria ?? "餐點"}
                          </Text>
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall, marginTop: 2 }}>
                            {`${formatDateTime(m.availableOn)}${m.cafeteria ? `｜${m.cafeteria}` : ""}`}
                          </Text>
                        </View>
                        {isFav && (
                          <Ionicons name="heart" size={18} color={theme.colors.danger} />
                        )}
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <View style={{
                          backgroundColor: cafColor.bg,
                          borderRadius: theme.radius.full,
                          paddingHorizontal: 10,
                          paddingVertical: 3,
                        }}>
                          <Text style={{ color: cafColor.fg, fontSize: 12, fontWeight: "700" }}>
                            {m.price != null ? `$${m.price}` : "價格未定"}
                          </Text>
                        </View>
                        {m.cafeteria && (
                          <View style={{
                            backgroundColor: theme.colors.surface,
                            borderRadius: theme.radius.full,
                            borderWidth: 1,
                            borderColor: cafColor.border,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                          }}>
                            <Text style={{ color: cafColor.fg, fontSize: 11, fontWeight: "600" }}>
                              {m.cafeteria}
                            </Text>
                          </View>
                        )}
                        {isFav && <Pill text="已收藏" kind="danger" size="sm" />}
                      </View>
                    </Pressable>
                  );
                }

                return (
                  <Pressable
                    onPress={goDetail}
                    style={({ pressed }) => ({
                      flex: 1,
                      maxWidth: "50%",
                      borderRadius: theme.radius.lg,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderTopWidth: 3,
                      borderTopColor: cafColor.fg,
                      backgroundColor: theme.colors.surface,
                      padding: 14,
                      gap: 8,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      ...softShadowStyle(theme.shadows.soft),
                    })}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`查看餐點：${m.name}`}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: theme.radius.md,
                          backgroundColor: cafColor.bg,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="restaurant" size={22} color={cafColor.fg} />
                      </View>
                      {isFav && <Ionicons name="heart" size={18} color={theme.colors.danger} />}
                    </View>
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontWeight: theme.typography.label.fontWeight,
                        fontSize: theme.typography.label.fontSize,
                      }}
                      numberOfLines={2}
                    >
                      {m.name ?? m.cafeteria ?? "餐點"}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }} numberOfLines={1}>
                      {m.cafeteria ?? ""}
                    </Text>
                    <Text
                      style={{
                        color: cafColor.fg,
                        fontWeight: "900",
                        fontSize: theme.typography.h2.fontSize,
                        letterSpacing: theme.typography.h2.letterSpacing,
                      }}
                    >
                      {m.price != null ? `$${m.price}` : "價格未定"}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}
