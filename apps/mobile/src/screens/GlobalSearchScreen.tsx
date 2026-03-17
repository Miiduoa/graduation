import React, { useState, useMemo, useCallback } from "react";
import { ScrollView, Text, View, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Pill, AnimatedCard, SegmentedControl, EmptyListPlaceholder } from "../ui/components";
import { useSchool } from "../state/school";
import { useSearchHistory, POPULAR_SEARCHES } from "../state/searchHistory";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, shadowStyle } from "../ui/theme";
import { formatDateTime, toDate, formatRelativeTime } from "../utils/format";

type SearchCategory = "all" | "announcements" | "events" | "pois" | "menus";

const CATEGORY_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "announcements", label: "公告" },
  { key: "events", label: "活動" },
  { key: "pois", label: "地點" },
  { key: "menus", label: "餐點" },
];

type SearchResult = {
  id: string;
  type: "announcement" | "event" | "poi" | "menu";
  title: string;
  subtitle: string;
  highlight?: string;
  data: any;
};

export function GlobalSearchScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const searchHistory = useSearchHistory();
  const ds = useDataSource();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [isFocused, setIsFocused] = useState(false);

  const { items: announcements } = useAsyncList<any>(() => ds.listAnnouncements(school.id), [ds, school.id]);
  const { items: events } = useAsyncList<any>(() => ds.listEvents(school.id), [ds, school.id]);
  const { items: pois } = useAsyncList<any>(() => ds.listPois(school.id), [ds, school.id]);
  const { items: menus } = useAsyncList<any>(() => ds.listMenus(school.id), [ds, school.id]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const allResults: SearchResult[] = [];

    if (category === "all" || category === "announcements") {
      announcements.forEach((a) => {
        const text = `${a.title ?? ""} ${a.body ?? ""} ${a.source ?? ""}`.toLowerCase();
        if (text.includes(q)) {
          allResults.push({
            id: a.id,
            type: "announcement",
            title: a.title ?? "(無標題)",
            subtitle: a.source ? `${a.source} · ${formatDateTime(a.publishedAt)}` : formatDateTime(a.publishedAt),
            highlight: a.body?.substring(0, 100),
            data: a,
          });
        }
      });
    }

    if (category === "all" || category === "events") {
      events.forEach((e) => {
        const text = `${e.title ?? ""} ${e.description ?? ""} ${e.location ?? ""}`.toLowerCase();
        if (text.includes(q)) {
          allResults.push({
            id: e.id,
            type: "event",
            title: e.title ?? "(無標題)",
            subtitle: `${formatDateTime(e.startsAt)}${e.location ? ` · ${e.location}` : ""}`,
            highlight: e.description?.substring(0, 100),
            data: e,
          });
        }
      });
    }

    if (category === "all" || category === "pois") {
      pois.forEach((p) => {
        const text = `${p.name ?? ""} ${p.description ?? ""} ${p.category ?? ""}`.toLowerCase();
        if (text.includes(q)) {
          allResults.push({
            id: p.id,
            type: "poi",
            title: p.name ?? "(無名稱)",
            subtitle: p.category ?? "",
            highlight: p.description?.substring(0, 100),
            data: p,
          });
        }
      });
    }

    if (category === "all" || category === "menus") {
      menus.forEach((m) => {
        const text = `${m.name ?? ""} ${m.cafeteria ?? ""}`.toLowerCase();
        if (text.includes(q)) {
          allResults.push({
            id: m.id,
            type: "menu",
            title: m.name ?? m.cafeteria ?? "(無名稱)",
            subtitle: `${m.cafeteria ?? ""} · $${m.price ?? "-"}`,
            data: m,
          });
        }
      });
    }

    return allResults.slice(0, 50);
  }, [query, category, announcements, events, pois, menus]);

  const handleSearch = useCallback((q: string) => {
    if (q.trim()) {
      searchHistory.addSearch(q.trim(), "all");
    }
  }, [searchHistory]);

  const historyItems = searchHistory.recentSearches("all", 10);
  const popularItems = POPULAR_SEARCHES.all;

  const handleResultPress = (result: SearchResult) => {
    handleSearch(query);

    switch (result.type) {
      case "announcement":
        nav?.navigate?.("首頁", { screen: "公告詳情", params: { id: result.id } });
        break;
      case "event":
        nav?.navigate?.("首頁", { screen: "活動詳情", params: { id: result.id } });
        break;
      case "poi":
        nav?.navigate?.("地圖", { screen: "PoiDetail", params: { id: result.id } });
        break;
      case "menu":
        nav?.navigate?.("首頁", { screen: "MenuDetail", params: { id: result.id } });
        break;
    }
  };

  const handleHistoryPress = (term: string) => {
    setQuery(term);
    setIsFocused(false);
  };

  const getTypeIcon = (type: SearchResult["type"]): string => {
    switch (type) {
      case "announcement":
        return "megaphone-outline";
      case "event":
        return "calendar-outline";
      case "poi":
        return "location-outline";
      case "menu":
        return "restaurant-outline";
      default:
        return "search-outline";
    }
  };

  const getTypeColor = (type: SearchResult["type"]): string => {
    switch (type) {
      case "announcement":
        return theme.colors.accent;
      case "event":
        return theme.colors.success;
      case "poi":
        return "#F59E0B";
      case "menu":
        return "#EC4899";
      default:
        return theme.colors.muted;
    }
  };

  const getTypeLabel = (type: SearchResult["type"]): string => {
    switch (type) {
      case "announcement":
        return "公告";
      case "event":
        return "活動";
      case "poi":
        return "地點";
      case "menu":
        return "餐點";
      default:
        return "";
    }
  };

  const showHistory = isFocused && !query.trim() && (historyItems.length > 0 || popularItems.length > 0);

  return (
    <Screen>
      <View style={{ gap: 12, flex: 1 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            borderRadius: theme.radius.lg,
            borderWidth: 2,
            borderColor: isFocused ? theme.colors.accent : theme.colors.border,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: 16,
            gap: 10,
            ...shadowStyle(theme.shadows.sm),
          }}
        >
          <Ionicons name="search" size={20} color={isFocused ? theme.colors.accent : theme.colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜尋公告、活動、地點、餐點..."
            placeholderTextColor={theme.colors.muted}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onSubmitEditing={() => handleSearch(query)}
            returnKeyType="search"
            autoFocus
            style={{
              flex: 1,
              paddingVertical: 14,
              color: theme.colors.text,
              fontSize: 16,
            }}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery("")}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                padding: 4,
              })}
            >
              <Ionicons name="close-circle" size={20} color={theme.colors.muted} />
            </Pressable>
          )}
        </View>

        <SegmentedControl
          options={CATEGORY_OPTIONS}
          selected={category}
          onChange={(k) => setCategory(k as SearchCategory)}
        />

        {showHistory ? (
          <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
            {historyItems.length > 0 && (
              <AnimatedCard title="搜尋紀錄" subtitle="">
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "500" }}>最近搜尋</Text>
                  <Pressable
                    onPress={searchHistory.clearHistory}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>清除全部</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {historyItems.map((item, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => handleHistoryPress(item.query)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: theme.radius.full,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.surface,
                        transform: [{ scale: pressed ? 0.985 : 1 }],
                      })}
                    >
                      <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.text, fontSize: 13 }}>{item.query}</Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>
            )}

            {popularItems.length > 0 && (
              <AnimatedCard title="熱門搜尋" subtitle="" delay={100}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {popularItems.map((term, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => handleHistoryPress(term)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: theme.radius.full,
                        borderWidth: 1,
                        borderColor: theme.colors.accent,
                        backgroundColor: pressed ? theme.colors.accentSoft : theme.colors.accentSoft,
                        transform: [{ scale: pressed ? 0.985 : 1 }],
                      })}
                    >
                      <Ionicons name="trending-up" size={14} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>{term}</Text>
                    </Pressable>
                  ))}
                </View>
              </AnimatedCard>
            )}
          </ScrollView>
        ) : query.trim() ? (
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: "500" }}>
                找到 {results.length} 筆結果
              </Text>
            </View>

            {results.length === 0 ? (
              <EmptyListPlaceholder
                icon="search-outline"
                title="找不到結果"
                subtitle={`沒有符合「${query}」的內容`}
              />
            ) : (
              results.map((result) => (
                <Pressable
                  key={`${result.type}-${result.id}`}
                  onPress={() => handleResultPress(result)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    padding: 14,
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    gap: 12,
                    ...shadowStyle(theme.shadows.sm),
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  })}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: theme.radius.md,
                      backgroundColor: `${getTypeColor(result.type)}15`,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={getTypeIcon(result.type) as any}
                      size={22}
                      color={getTypeColor(result.type)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Pill text={getTypeLabel(result.type)} kind="accent" size="sm" />
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, letterSpacing: -0.1 }} numberOfLines={1}>
                      {result.title}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                      {result.subtitle}
                    </Text>
                    {result.highlight && (
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6, lineHeight: 18 }} numberOfLines={2}>
                        {result.highlight}...
                      </Text>
                    )}
                  </View>
                  <View style={{ justifyContent: "center" }}>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <View style={{
              width: 80,
              height: 80,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Ionicons name="search" size={36} color={theme.colors.accent} />
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 15 }}>輸入關鍵字開始搜尋</Text>
          </View>
        )}
      </View>
    </Screen>
  );
}
