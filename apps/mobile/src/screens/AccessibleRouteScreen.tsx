import React, { useState, useMemo, useCallback } from "react";
import { View, Text, Pressable, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, SearchBar, Button, AnimatedCard, Pill, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAsyncStorage } from "../hooks/useStorage";

type RouteType = "wheelchair" | "elevator" | "ramp" | "all";

type AccessibilityFeature = {
  id: string;
  name: string;
  type: "elevator" | "ramp" | "accessible_restroom" | "tactile_path" | "auto_door";
  building: string;
  floor: string;
  description: string;
};

const MOCK_FEATURES: AccessibilityFeature[] = [
  { id: "1", name: "行政大樓電梯", type: "elevator", building: "行政大樓", floor: "1F-6F", description: "可容納輪椅，設有點字按鈕及語音報層" },
  { id: "2", name: "圖書館無障礙坡道", type: "ramp", building: "圖書館", floor: "1F", description: "主入口右側，坡度符合法規" },
  { id: "3", name: "工程館無障礙廁所", type: "accessible_restroom", building: "工程館", floor: "1F, 3F, 5F", description: "設有扶手、緊急求助鈴" },
  { id: "4", name: "導盲磚路徑 A", type: "tactile_path", building: "校園主幹道", floor: "戶外", description: "從大門延伸至圖書館" },
  { id: "5", name: "學生活動中心自動門", type: "auto_door", building: "學生活動中心", floor: "1F", description: "感應式自動門，輪椅友善" },
  { id: "6", name: "理學院電梯", type: "elevator", building: "理學院", floor: "1F-8F", description: "寬敞空間，設有低位按鈕" },
  { id: "7", name: "餐廳無障礙入口", type: "ramp", building: "學生餐廳", floor: "1F", description: "側門設有緩坡及扶手" },
];

type RouteStep = {
  id: string;
  instruction: string;
  distance: number;
  accessibilityNote?: string;
  feature?: string;
};

type SavedRoute = {
  id: string;
  destination: string;
  preference: RouteType;
  savedAt: string;
};

const MOCK_ROUTE: RouteStep[] = [
  { id: "1", instruction: "從大門出發", distance: 0, accessibilityNote: "平坦道路" },
  { id: "2", instruction: "沿導盲磚直走 100 公尺", distance: 100, feature: "導盲磚路徑" },
  { id: "3", instruction: "左轉進入行政大樓", distance: 20, accessibilityNote: "自動門入口" },
  { id: "4", instruction: "搭乘電梯至 3 樓", distance: 0, feature: "無障礙電梯", accessibilityNote: "電梯按鈕高度適宜" },
  { id: "5", instruction: "出電梯右轉走 30 公尺", distance: 30 },
  { id: "6", instruction: "抵達目的地", distance: 0, accessibilityNote: "301 教室" },
];

function getFeatureIcon(type: AccessibilityFeature["type"]): string {
  switch (type) {
    case "elevator": return "arrow-up-circle";
    case "ramp": return "trending-up";
    case "accessible_restroom": return "accessibility";
    case "tactile_path": return "walk";
    case "auto_door": return "enter";
    default: return "help-circle";
  }
}

function getFeatureColor(type: AccessibilityFeature["type"]): string {
  switch (type) {
    case "elevator": return theme.colors.accent;
    case "ramp": return theme.colors.success;
    case "accessible_restroom": return "#8B5CF6";
    case "tactile_path": return "#F59E0B";
    case "auto_door": return "#EC4899";
    default: return theme.colors.muted;
  }
}

function getFeatureLabel(type: AccessibilityFeature["type"]): string {
  switch (type) {
    case "elevator": return "電梯";
    case "ramp": return "坡道";
    case "accessible_restroom": return "無障礙廁所";
    case "tactile_path": return "導盲磚";
    case "auto_door": return "自動門";
    default: return "設施";
  }
}

export function AccessibleRouteScreen(props: any) {
  const nav = props?.navigation;
  const destination = props?.route?.params?.destination ?? "";

  const [searchQuery, setSearchQuery] = useState(destination);
  const [selectedTab, setSelectedTab] = useState<number>(0);
  const [routePreference, setRoutePreference] = useState<RouteType>("all");
  const [showRoute, setShowRoute] = useState(false);
  const [savedRoutes, setSavedRoutes] = useAsyncStorage<SavedRoute[]>("accessible_route_favorites", {
    defaultValue: [],
  });

  const TABS = ["路線規劃", "設施地圖"];
  const ROUTE_TYPES: { key: RouteType; label: string; icon: string }[] = [
    { key: "all", label: "所有設施", icon: "apps" },
    { key: "wheelchair", label: "輪椅適用", icon: "accessibility" },
    { key: "elevator", label: "電梯優先", icon: "arrow-up-circle" },
    { key: "ramp", label: "坡道優先", icon: "trending-up" },
  ];

  const filteredFeatures = useMemo(() => {
    let features = MOCK_FEATURES;
    if (searchQuery) {
      features = features.filter((f) =>
        f.name.includes(searchQuery) ||
        f.building.includes(searchQuery) ||
        f.description.includes(searchQuery)
      );
    }
    if (routePreference === "elevator") {
      features = features.filter((f) => f.type === "elevator");
    } else if (routePreference === "ramp") {
      features = features.filter((f) => f.type === "ramp");
    } else if (routePreference === "wheelchair") {
      features = features.filter((f) => ["elevator", "ramp", "auto_door"].includes(f.type));
    }
    return features;
  }, [searchQuery, routePreference]);

  const totalDistance = useMemo(() => {
    return MOCK_ROUTE.reduce((sum, step) => sum + step.distance, 0);
  }, []);

  const recentSavedRoutes = useMemo(() => {
    return [...savedRoutes]
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      .slice(0, 5);
  }, [savedRoutes]);

  const handleStartNavigation = () => {
    if (!searchQuery) {
      Alert.alert("請輸入目的地", "請輸入或選擇您要前往的目的地");
      return;
    }
    setShowRoute(true);
  };

  const handleUseARNavigation = () => {
    nav?.navigate?.("ARNavigation", { destination: searchQuery || "目的地" });
  };

  const handleSaveRoute = useCallback(async () => {
    const destinationName = searchQuery.trim();
    if (!destinationName) {
      Alert.alert("請輸入目的地", "先輸入目的地後才能儲存路線");
      return;
    }

    const savedAt = new Date().toISOString();
    await setSavedRoutes((prev) => {
      const next = prev.filter(
        (route) => !(route.destination === destinationName && route.preference === routePreference)
      );
      return [
        {
          id: `${destinationName}-${routePreference}`,
          destination: destinationName,
          preference: routePreference,
          savedAt,
        },
        ...next,
      ].slice(0, 20);
    });

    Alert.alert("已儲存", `已將「${destinationName}」加入常用無障礙路線`);
  }, [routePreference, searchQuery, setSavedRoutes]);

  const handleLoadSavedRoute = useCallback((route: SavedRoute) => {
    setSelectedTab(0);
    setSearchQuery(route.destination);
    setRoutePreference(route.preference);
    setShowRoute(true);
  }, []);

  const handleDeleteSavedRoute = useCallback(async (routeId: string) => {
    await setSavedRoutes((prev) => prev.filter((route) => route.id !== routeId));
  }, [setSavedRoutes]);

  const handleFeaturePress = (feature: AccessibilityFeature) => {
    Alert.alert(
      feature.name,
      `位置：${feature.building} ${feature.floor}\n\n${feature.description}`,
      [
        { text: "關閉" },
        { text: "導航至此", onPress: () => setSearchQuery(feature.building) },
      ]
    );
  };

  return (
    <Screen>
      <View style={{ flex: 1, gap: 12 }}>
        <SegmentedControl options={TABS} selected={selectedTab} onChange={setSelectedTab} />

        {selectedTab === 0 ? (
          <>
            <AnimatedCard title="無障礙路線規劃" subtitle="為行動不便者提供最佳路線">
              <View style={{ gap: 16 }}>
                <SearchBar
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="輸入目的地（教室、建築物）"
                />

                <View>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>路線偏好</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {ROUTE_TYPES.map((rt) => (
                        <Pressable
                          key={rt.key}
                          onPress={() => setRoutePreference(rt.key)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            borderRadius: theme.radius.full,
                            backgroundColor: routePreference === rt.key ? theme.colors.accent : theme.colors.surface2,
                            gap: 6,
                          }}
                        >
                          <Ionicons
                            name={rt.icon as any}
                            size={16}
                            color={routePreference === rt.key ? "#fff" : theme.colors.muted}
                          />
                          <Text
                            style={{
                              color: routePreference === rt.key ? "#fff" : theme.colors.text,
                              fontSize: 13,
                              fontWeight: "600",
                            }}
                          >
                            {rt.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                <Button text="規劃路線" kind="primary" onPress={handleStartNavigation} />
              </View>
            </AnimatedCard>

            {recentSavedRoutes.length > 0 && (
              <AnimatedCard title="已儲存路線" subtitle="快速載入常用目的地" delay={50}>
                <View style={{ gap: 10 }}>
                  {recentSavedRoutes.map((route) => (
                    <View
                      key={route.id}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        padding: 12,
                        gap: 8,
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{route.destination}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                            偏好：{ROUTE_TYPES.find((item) => item.key === route.preference)?.label ?? "所有設施"}
                          </Text>
                        </View>
                        <Pressable onPress={() => handleDeleteSavedRoute(route.id)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={18} color={theme.colors.muted} />
                        </Pressable>
                      </View>
                      <Button text="套用此路線" onPress={() => handleLoadSavedRoute(route)} />
                    </View>
                  ))}
                </View>
              </AnimatedCard>
            )}

            {showRoute && (
              <AnimatedCard title="建議路線" subtitle={`總距離 ${totalDistance}m · 約 5 分鐘`} delay={100}>
                <View style={{ gap: 8 }}>
                  {MOCK_ROUTE.map((step, idx) => (
                    <View
                      key={step.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <View style={{ alignItems: "center" }}>
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor:
                              idx === MOCK_ROUTE.length - 1
                                ? theme.colors.success
                                : theme.colors.accent,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {idx === MOCK_ROUTE.length - 1 ? (
                            <Ionicons name="flag" size={14} color="#fff" />
                          ) : (
                            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
                              {idx + 1}
                            </Text>
                          )}
                        </View>
                        {idx < MOCK_ROUTE.length - 1 && (
                          <View
                            style={{
                              width: 2,
                              height: 40,
                              backgroundColor: theme.colors.border,
                              marginTop: 4,
                            }}
                          />
                        )}
                      </View>
                      <View style={{ flex: 1, paddingBottom: 12 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                          {step.instruction}
                        </Text>
                        {step.feature && (
                          <Pill
                            label={step.feature}
                            selected
                            style={{ marginTop: 6, alignSelf: "flex-start" }}
                          />
                        )}
                        {step.accessibilityNote && (
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                            ♿ {step.accessibilityNote}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>

                <View style={{ marginTop: 16, gap: 10 }}>
                  <Button text="開始 AR 導航" kind="primary" onPress={handleUseARNavigation} />
                  <Button text="儲存此路線" onPress={handleSaveRoute} />
                </View>
              </AnimatedCard>
            )}
          </>
        ) : (
          <>
            <View style={{ marginBottom: 4 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {ROUTE_TYPES.map((rt) => (
                    <Pressable
                      key={rt.key}
                      onPress={() => setRoutePreference(rt.key)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: theme.radius.full,
                        backgroundColor: routePreference === rt.key ? theme.colors.accent : theme.colors.surface2,
                        gap: 6,
                      }}
                    >
                      <Ionicons
                        name={rt.icon as any}
                        size={14}
                        color={routePreference === rt.key ? "#fff" : theme.colors.muted}
                      />
                      <Text
                        style={{
                          color: routePreference === rt.key ? "#fff" : theme.colors.text,
                          fontSize: 12,
                          fontWeight: "600",
                        }}
                      >
                        {rt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>

            <AnimatedCard title="校園無障礙設施" subtitle={`共 ${filteredFeatures.length} 項設施`}>
              <SearchBar
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜尋設施或建築物"
              />
            </AnimatedCard>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 8, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
                {filteredFeatures.map((feature, idx) => (
                  <AnimatedCard key={feature.id} delay={idx * 50}>
                    <Pressable
                      onPress={() => handleFeaturePress(feature)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          backgroundColor: `${getFeatureColor(feature.type)}20`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={getFeatureIcon(feature.type) as any}
                          size={24}
                          color={getFeatureColor(feature.type)}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                            {feature.name}
                          </Text>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              borderRadius: theme.radius.full,
                              backgroundColor: `${getFeatureColor(feature.type)}20`,
                            }}
                          >
                            <Text
                              style={{
                                color: getFeatureColor(feature.type),
                                fontSize: 10,
                                fontWeight: "600",
                              }}
                            >
                              {getFeatureLabel(feature.type)}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {feature.building} · {feature.floor}
                        </Text>
                        <Text
                          style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}
                          numberOfLines={2}
                        >
                          {feature.description}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                    </Pressable>
                  </AnimatedCard>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </View>
    </Screen>
  );
}
