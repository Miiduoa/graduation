/**
 * CampusHubScreen — 校園 Tab 主畫面（整合版）
 *
 * 心理學架構：
 * - Spatial Cognition (Tolman): 以物理空間維度組織服務
 * - Wayfinding Theory: 地圖優先顯示，減少空間迷失感 (Spatial Anxiety)
 * - Context-Dependent Memory: 根據時間推薦最相關的服務
 * - Progressive Disclosure: 常用服務優先，完整列表摺疊
 * - Cognitive Map: 每個服務都錨定在物理空間概念中
 */
import React, { useMemo } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { BusRoute, MenuItem, Poi } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useSchool } from "../state/school";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { shadowStyle, theme } from "../ui/theme";

// ────────────────────────────────────────────────
// 時段偵測
// ────────────────────────────────────────────────
function getTimeSegment(): "morning" | "noon" | "afternoon" | "evening" | "night" {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return "morning";
  if (h >= 10 && h < 14) return "noon";
  if (h >= 14 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

// ────────────────────────────────────────────────
// 服務磚（Service Tile）
// ────────────────────────────────────────────────
function ServiceTile(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  badge?: string;
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: 14,
        borderRadius: theme.radius.lg,
        backgroundColor: props.highlight ? `${props.tint}10` : theme.colors.surface,
        borderWidth: 1,
        borderColor: props.highlight ? `${props.tint}30` : theme.colors.border,
        gap: 8,
        minWidth: 80,
        opacity: pressed ? 0.82 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 14,
          backgroundColor: `${props.tint}14`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={props.icon} size={20} color={props.tint} />
      </View>
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
          {props.label}
        </Text>
        {props.badge && (
          <Text style={{ color: theme.colors.muted, fontSize: 11 }} numberOfLines={1}>
            {props.badge}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ────────────────────────────────────────────────
// 地圖快速導覽卡
// ────────────────────────────────────────────────
function MapCard(props: { onPress: () => void; onARPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        borderRadius: theme.radius.xl,
        overflow: "hidden",
        opacity: pressed ? 0.9 : 1,
        ...shadowStyle(theme.shadows.md),
      })}
    >
      {/* 地圖背景（抽象表示） */}
      <View
        style={{
          height: 160,
          backgroundColor: theme.mode === "dark" ? "#1A2A3A" : "#E8F4FD",
          justifyContent: "center",
          alignItems: "center",
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", gap: 20, opacity: 0.3 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 60 + i * 20, height: 40 + i * 10, borderRadius: 8, backgroundColor: theme.colors.accent }} />
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="navigate" size={16} color="#fff" />
          </View>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>
            打開校園地圖
          </Text>
        </View>
      </View>

      {/* AR 導航按鈕 */}
      <Pressable
        onPress={props.onARPress}
        style={({ pressed }) => ({
          position: "absolute",
          bottom: 12,
          right: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
          ...shadowStyle(theme.shadows.sm),
        })}
      >
        <Ionicons name="glasses-outline" size={15} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>AR 導航</Text>
      </Pressable>
    </Pressable>
  );
}

// ────────────────────────────────────────────────
// 主元件
// ────────────────────────────────────────────────
export function CampusHubScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const { school } = useSchool();
  const ds = useDataSource();

  const segment = getTimeSegment();

  const { items: pois, refreshing, refresh } = useAsyncList<Poi>(
    async () => (await ds.listPois(school.id)).slice(0, 5),
    [ds, school.id]
  );

  const { items: routes } = useAsyncList<BusRoute>(
    async () => ds.listBusRoutes(school.id),
    [ds, school.id]
  );

  const { items: menus } = useAsyncList<MenuItem>(
    async () => (await ds.listMenus(school.id)).slice(0, 3),
    [ds, school.id]
  );

  // 情境服務推薦（Context-Dependent Memory）
  const contextualServices = useMemo(() => {
    const services = [];
    if (segment === "noon" || segment === "afternoon") {
      services.push({
        icon: "restaurant-outline" as const,
        title: "今日菜單",
        description: menus[0]
          ? `${menus[0].cafeteria ?? "學餐"} · ${menus[0].name}`
          : "查看今日午餐選項",
        tint: theme.colors.achievement,
        onPress: () => nav?.navigate?.("餐廳總覽"),
      });
    }
    if (segment === "morning" || segment === "evening" || segment === "night") {
      services.push({
        icon: "bus-outline" as const,
        title: `公車班次 · ${routes.length} 條路線`,
        description: "查看下班公車和到站時間",
        tint: theme.colors.fresh,
        onPress: () => nav?.navigate?.("BusSchedule"),
      });
    }
    services.push({
      icon: "library-outline" as const,
      title: "圖書館",
      description: "查詢座位、借閱記錄",
      tint: theme.colors.calm,
      onPress: () => nav?.navigate?.("Library"),
    });
    return services.slice(0, 2);
  }, [segment, routes, menus]);

  // 所有校園服務（Progressive Disclosure）
  const allServices = [
    { icon: "restaurant-outline" as const, label: "餐廳", tint: theme.colors.achievement, screen: "餐廳總覽" },
    { icon: "bus-outline" as const, label: "公車", tint: theme.colors.fresh, screen: "BusSchedule" },
    { icon: "library-outline" as const, label: "圖書館", tint: theme.colors.calm, screen: "Library" },
    { icon: "home-outline" as const, label: "宿舍", tint: theme.colors.growth, screen: "Dormitory" },
    { icon: "heart-outline" as const, label: "健康中心", tint: theme.colors.danger, screen: "Health" },
    { icon: "print-outline" as const, label: "列印", tint: theme.colors.social, screen: "PrintService" },
    { icon: "search-circle-outline" as const, label: "失物招領", tint: theme.colors.warning, screen: "LostFound" },
    { icon: "card-outline" as const, label: "校園支付", tint: theme.colors.streak, screen: "Payment" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 8,
          gap: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── 頁面標頭 ─── */}
        <View style={{ gap: 4 }}>
          <Text style={{
            color: theme.colors.muted,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: theme.typography.overline.fontWeight ?? "700",
            letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
            textTransform: "uppercase",
          }}>
            {school.name}
          </Text>
          <Text style={{
            color: theme.colors.text,
            fontSize: theme.typography.display.fontSize,
            fontWeight: theme.typography.display.fontWeight ?? "800",
            letterSpacing: theme.typography.display.letterSpacing,
          }}>
            校園
          </Text>
        </View>

        {/* ─── 地圖卡（Spatial Cognition 優先） ─── */}
        <MapCard
          onPress={() => nav?.navigate?.("Map")}
          onARPress={() => nav?.navigate?.("ARNavigation", { destinationId: "entrance" })}
        />

        {/* ─── 情境服務（Context-Dependent Memory） ─── */}
        <View style={{ gap: 10 }}>
          <Text style={{
            color: theme.colors.muted,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: theme.typography.overline.fontWeight ?? "700",
            letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
            textTransform: "uppercase",
          }}>
            現在推薦
          </Text>
          {contextualServices.map((svc, i) => (
            <Pressable
              key={i}
              onPress={svc.onPress}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                padding: 16,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.99 : 1 }],
                ...shadowStyle(theme.shadows.sm),
              })}
            >
              <View style={{ width: 42, height: 42, borderRadius: 15, backgroundColor: `${svc.tint}14`, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={svc.icon} size={20} color={svc.tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>{svc.title}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>{svc.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>

        {/* ─── 所有校園服務（Progressive Disclosure: 網格） ─── */}
        <View style={{ gap: 10 }}>
          <Text style={{
            color: theme.colors.muted,
            fontSize: theme.typography.overline.fontSize,
            fontWeight: theme.typography.overline.fontWeight ?? "700",
            letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
            textTransform: "uppercase",
          }}>
            所有服務
          </Text>
          {/* 每排 4 個 */}
          {[0, 1].map((row) => (
            <View key={row} style={{ flexDirection: "row", gap: 10 }}>
              {allServices.slice(row * 4, row * 4 + 4).map((svc) => (
                <ServiceTile
                  key={svc.label}
                  icon={svc.icon}
                  label={svc.label}
                  tint={svc.tint}
                  onPress={() => nav?.navigate?.(svc.screen)}
                />
              ))}
            </View>
          ))}
        </View>

        {/* ─── 無障礙路線（Inclusive Design） ─── */}
        <Pressable
          onPress={() => nav?.navigate?.("AccessibleRoute", { destination: "main" })}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            padding: 16,
            borderRadius: theme.radius.xl,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.85 : 1,
            ...shadowStyle(theme.shadows.sm),
          })}
        >
          <View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: theme.colors.infoSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="accessibility-outline" size={22} color={theme.colors.info} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }}>無障礙路線規劃</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>電梯、坡道和無障礙設施地圖</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={theme.colors.info} />
        </Pressable>
      </ScrollView>
    </View>
  );
}
