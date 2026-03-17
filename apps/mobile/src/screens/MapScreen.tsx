import React, { useCallback, useMemo, useState, useRef } from "react";
import { FlatList, ScrollView, Text, Pressable, View, Linking, Platform, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useDebounce } from "../hooks/useDebounce";
import { Pill, Button, LoadingState, EmptyState, ErrorState, SearchBar } from "../ui/components";
import { useSchool } from "../state/school";
import { useDemo } from "../state/demo";
import { useToast } from "../ui/Toast";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, shadowStyle } from "../ui/theme";

type Poi = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  lat?: number;
  lng?: number;
};

const UNCATEGORIZED = "未分類";

function isValidCoordinate(lat?: number, lng?: number): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

type ViewMode = "list" | "grid";

const CATEGORY_ICON_MAP: Record<string, string> = {
  "教學": "school-outline",
  "行政": "business-outline",
  "生活": "cafe-outline",
  "運動": "fitness-outline",
  "圖書": "library-outline",
  "宿舍": "home-outline",
  "停車": "car-outline",
  "醫療": "medkit-outline",
};

const CATEGORY_COLORS = [
  { bg: theme.colors.accentSoft, fg: theme.colors.accent },
  { bg: theme.colors.successSoft, fg: theme.colors.success },
  { bg: theme.colors.warningSoft, fg: theme.colors.warning },
  { bg: theme.colors.infoSoft, fg: theme.colors.info },
  { bg: theme.colors.dangerSoft, fg: theme.colors.danger },
];

function getCategoryColor(index: number) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

function getCategoryIcon(cat: string): string {
  for (const [key, icon] of Object.entries(CATEGORY_ICON_MAP)) {
    if (cat.includes(key)) return icon;
  }
  return "location-outline";
}

type MapAppOption = {
  name: string;
  icon: string;
  getUrl: (lat: number, lng: number, label: string) => string;
  checkUrl: string;
};

const MAP_APPS: Record<string, MapAppOption[]> = {
  ios: [
    {
      name: "Apple 地圖",
      icon: "map",
      getUrl: (lat, lng, label) => `maps:0,0?q=${encodeURIComponent(label)}@${lat},${lng}`,
      checkUrl: "maps://",
    },
    {
      name: "Google 地圖",
      icon: "logo-google",
      getUrl: (lat, lng, label) => `comgooglemaps://?q=${lat},${lng}&label=${encodeURIComponent(label)}`,
      checkUrl: "comgooglemaps://",
    },
  ],
  android: [
    {
      name: "Google 地圖",
      icon: "logo-google",
      getUrl: (lat, lng, label) => `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`,
      checkUrl: "geo:",
    },
  ],
  web: [],
};

async function getAvailableMapApps(): Promise<MapAppOption[]> {
  const platformApps = MAP_APPS[Platform.OS] || [];
  const available: MapAppOption[] = [];

  for (const app of platformApps) {
    try {
      const canOpen = await Linking.canOpenURL(app.checkUrl);
      if (canOpen) {
        available.push(app);
      }
    } catch {
      // App not available
    }
  }

  return available;
}

async function openInMaps(lat: number, lng: number, name: string) {
  const label = name;
  const webFallback = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodeURIComponent(name)}`;

  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    Alert.alert("無效的座標", "地點座標資料有誤，無法開啟導航");
    return;
  }

  const availableApps = await getAvailableMapApps();

  if (availableApps.length === 0) {
    try {
      await Linking.openURL(webFallback);
    } catch {
      Alert.alert("無法開啟地圖", "開啟地圖時發生錯誤，請稍後再試");
    }
    return;
  }

  if (availableApps.length === 1) {
    try {
      await Linking.openURL(availableApps[0].getUrl(lat, lng, label));
    } catch {
      try {
        await Linking.openURL(webFallback);
      } catch {
        Alert.alert("無法開啟地圖", "開啟地圖時發生錯誤，請稍後再試");
      }
    }
    return;
  }

  const options = [
    ...availableApps.map((app) => app.name),
    "網頁版 Google 地圖",
    "取消",
  ];

  Alert.alert(
    "選擇地圖應用程式",
    `導航至: ${name}`,
    options.map((title, index) => ({
      text: title,
      style: title === "取消" ? "cancel" : "default",
      onPress: async () => {
        if (title === "取消") return;
        
        try {
          if (title === "網頁版 Google 地圖") {
            await Linking.openURL(webFallback);
          } else {
            const app = availableApps[index];
            await Linking.openURL(app.getUrl(lat, lng, label));
          }
        } catch {
          try {
            await Linking.openURL(webFallback);
          } catch {
            Alert.alert("無法開啟地圖", "開啟地圖時發生錯誤，請稍後再試");
          }
        }
      },
    }))
  );
}

export function MapScreen(props: any) {
  const { school } = useSchool();
  const navigation = useNavigation();
  const nav = props?.navigation ?? navigation;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const insets = useSafeAreaInsets();

  const demo = useDemo();

  const [q, setQ] = useState("");
  const debouncedQuery = useDebounce(q, 300);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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
  const { items: raw, error: loadError, loading: loadLoading, refreshing, reload, refresh } = useAsyncList<Poi>(
    () => ds.listPois(school.id),
    [ds, school.id],
    { keepPreviousData: true, onRefreshError: handleRefreshError }
  );

  const isLoading = demo.mode === "loading" || (demo.mode === "normal" && loadLoading && raw.length === 0);
  const error = demo.mode === "error" ? "(demo) 讀取點位失敗" : demo.mode === "normal" ? loadError : null;

  const handleRefresh = useCallback(async () => {
    if (demo.mode !== "normal") return;
    await refresh();
  }, [demo.mode, refresh]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    let hasUncategorized = false;
    for (const p of raw) {
      if (p.category && p.category.trim()) {
        cats.add(p.category);
      } else {
        hasUncategorized = true;
      }
    }
    const sortedCats = Array.from(cats).sort();
    if (hasUncategorized) {
      sortedCats.push(UNCATEGORIZED);
    }
    return sortedCats;
  }, [raw]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getCategoryColor>>();
    categories.forEach((c, i) => map.set(c, getCategoryColor(i)));
    return map;
  }, [categories]);

  const stats = useMemo(() => {
    const base = demo.mode === "empty" ? [] : raw;
    const validCoords = base.filter((p) => isValidCoordinate(p.lat, p.lng)).length;
    const uncategorized = base.filter((p) => !p.category || !p.category.trim()).length;
    return {
      total: base.length,
      validCoords,
      uncategorized,
    };
  }, [demo.mode, raw]);

  const items = useMemo(() => {
    let base = demo.mode === "empty" ? [] : raw;

    if (selectedCategory) {
      if (selectedCategory === UNCATEGORIZED) {
        base = base.filter((p) => !p.category || !p.category.trim());
      } else {
        base = base.filter((p) => p.category === selectedCategory);
      }
    }

    if (!debouncedQuery.trim()) return base;
    const needle = debouncedQuery.trim().toLowerCase();
    return base.filter((p) => {
      const hay = `${p.name}\n${p.description ?? ""}\n${p.category ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [demo.mode, debouncedQuery, raw, selectedCategory]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {isLoading ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg, paddingTop: insets.top + theme.space.md }}>
          <LoadingState title="地圖" subtitle="載入中..." rows={3} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg, paddingTop: insets.top + theme.space.md }}>
          <ErrorState
            title="地圖"
            subtitle="讀取點位失敗"
            hint={error}
            actionText="重試"
            onAction={() => {
              demo.setMode("normal");
              reload();
            }}
          />
        </View>
      ) : items.length === 0 && !q.trim() && !selectedCategory ? (
        <View style={{ flex: 1, paddingHorizontal: theme.space.lg, paddingTop: insets.top + theme.space.md }}>
          <EmptyState 
            title="沒有點位" 
            subtitle="目前沒有點位" 
            hint="你可以切換學校或稍後再試。"
            actionText="重新載入"
            onAction={reload}
            icon="location-outline"
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <LinearGradient
            colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              paddingTop: insets.top + 12,
              paddingBottom: 16,
              paddingHorizontal: theme.space.lg,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: "rgba(255,255,255,0.2)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="map" size={22} color="#fff" />
                </View>
                <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff", letterSpacing: -0.5 }}>
                  地圖
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{
                  backgroundColor: "rgba(255,255,255,0.2)",
                  borderRadius: theme.radius.full,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
                    {`${stats.total} 點位`}
                  </Text>
                </View>
                <View style={{
                  backgroundColor: "rgba(255,255,255,0.2)",
                  borderRadius: theme.radius.full,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
                    {`${stats.validCoords} 可導航`}
                  </Text>
                </View>
              </View>
            </View>

            {categories.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingTop: 14, paddingBottom: 2 }}
              >
                <Pressable
                  onPress={() => setSelectedCategory(null)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: theme.radius.full,
                    backgroundColor: !selectedCategory ? "#fff" : "rgba(255,255,255,0.15)",
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <Text
                    style={{
                      color: !selectedCategory ? theme.colors.accent : "#fff",
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    全部
                  </Text>
                </Pressable>
                {categories.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setSelectedCategory(cat)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 14,
                      paddingVertical: 7,
                      borderRadius: theme.radius.full,
                      backgroundColor: selectedCategory === cat ? "#fff" : "rgba(255,255,255,0.15)",
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <Text
                      style={{
                        color: selectedCategory === cat ? theme.colors.accent : "#fff",
                        fontWeight: "700",
                        fontSize: 13,
                      }}
                    >
                      {cat}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </LinearGradient>

          <View style={{ paddingHorizontal: theme.space.lg, paddingTop: theme.space.md, gap: theme.space.md, flex: 1 }}>
            <SearchBar value={q} onChange={setQ} placeholder="搜尋點位（名稱/分類/描述）" />

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall }}>
                {`結果：${items.length}`}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall }}>
                  {selectedCategory ? `分類：${selectedCategory}` : "分類：全部"}
                </Text>
                <Pressable
                  onPress={() => setViewMode(viewMode === "list" ? "grid" : "list")}
                  style={({ pressed }) => ({
                    padding: 8,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <Ionicons name={viewMode === "list" ? "grid-outline" : "list-outline"} size={16} color={theme.colors.textSecondary} />
                </Pressable>
              </View>
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
                  title={
                    debouncedQuery.trim() && selectedCategory
                      ? `在「${selectedCategory}」中找不到結果`
                      : debouncedQuery.trim()
                        ? "找不到相關點位"
                        : selectedCategory
                          ? `「${selectedCategory}」無點位`
                          : "沒有點位資料"
                  }
                  subtitle={
                    debouncedQuery.trim() || selectedCategory
                      ? "請嘗試其他搜尋條件"
                      : "目前沒有可顯示的點位"
                  }
                  actionText={selectedCategory || debouncedQuery.trim() ? "清除篩選" : undefined}
                  onAction={
                    selectedCategory || debouncedQuery.trim()
                      ? () => {
                          setSelectedCategory(null);
                          setQ("");
                        }
                      : undefined
                  }
                />
              }
              renderItem={({ item: p }) => {
                const goDetail = () => {
                  try {
                    if (nav && typeof nav.navigate === "function") {
                      nav.navigate("PoiDetail", { id: p.id });
                    } else {
                      toastRef.current.show({
                        message: "導航暫時無法使用",
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
                
                const displayCategory = p.category?.trim() || UNCATEGORIZED;
                const catColor = categoryColorMap.get(displayCategory) ?? CATEGORY_COLORS[0];

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
                        borderLeftColor: catColor.fg,
                        padding: theme.space.lg,
                        gap: 10,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                        ...shadowStyle(theme.shadows.sm),
                      })}
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={`查看點位：${p.name}`}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: theme.radius.md,
                            backgroundColor: catColor.bg,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name={getCategoryIcon(displayCategory) as any} size={20} color={catColor.fg} />
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
                            {p.name}
                          </Text>
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall, marginTop: 2 }}>
                            {displayCategory}
                          </Text>
                        </View>
                        {isValidCoordinate(p.lat, p.lng) && (
                          <Pressable
                            onPress={() => openInMaps(p.lat!, p.lng!, p.name)}
                            hitSlop={8}
                            style={({ pressed }) => ({
                              width: 36, height: 36,
                              borderRadius: theme.radius.full,
                              backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                              alignItems: "center",
                              justifyContent: "center",
                            })}
                          >
                            <Ionicons name="navigate-outline" size={16} color={theme.colors.accent} />
                          </Pressable>
                        )}
                      </View>
                      {p.description ? (
                        <Text
                          style={{ color: theme.colors.textSecondary, ...theme.typography.bodySmall, lineHeight: 20 }}
                          numberOfLines={2}
                        >
                          {p.description}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <View style={{
                          backgroundColor: catColor.bg,
                          borderRadius: theme.radius.full,
                          paddingHorizontal: 10,
                          paddingVertical: 3,
                        }}>
                          <Text style={{ color: catColor.fg, fontSize: 12, fontWeight: "700" }}>
                            {displayCategory}
                          </Text>
                        </View>
                        {isValidCoordinate(p.lat, p.lng) && (
                          <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                            {p.lat!.toFixed(4)}, {p.lng!.toFixed(4)}
                          </Text>
                        )}
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
                      padding: 14,
                      borderRadius: theme.radius.lg,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderTopWidth: 3,
                      borderTopColor: catColor.fg,
                      backgroundColor: theme.colors.surface,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      ...shadowStyle(theme.shadows.sm),
                    })}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={`查看點位：${p.name}`}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: theme.radius.md,
                        backgroundColor: catColor.bg,
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 10,
                      }}
                    >
                      <Ionicons name={getCategoryIcon(displayCategory) as any} size={20} color={catColor.fg} />
                    </View>
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontWeight: theme.typography.label.fontWeight,
                        fontSize: theme.typography.label.fontSize,
                        letterSpacing: theme.typography.label.letterSpacing,
                      }}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                      <View style={{
                        width: 6, height: 6,
                        borderRadius: 3,
                        backgroundColor: catColor.fg,
                      }} />
                      <Text
                        style={{
                          color: theme.colors.textSecondary,
                          ...theme.typography.caption,
                        }}
                        numberOfLines={1}
                      >
                        {displayCategory}
                      </Text>
                    </View>
                    {isValidCoordinate(p.lat, p.lng) && (
                      <Pressable
                        onPress={() => openInMaps(p.lat!, p.lng!, p.name)}
                        style={({ pressed }) => ({
                          marginTop: 10,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: theme.radius.full,
                          backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          alignSelf: "flex-start",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                        })}
                      >
                        <Ionicons name="navigate-outline" size={12} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.accent, ...theme.typography.caption, fontWeight: "600" }}>導航</Text>
                      </Pressable>
                    )}
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
