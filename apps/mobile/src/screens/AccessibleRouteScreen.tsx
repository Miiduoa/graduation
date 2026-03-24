/* eslint-disable */
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { View, Text, Pressable, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, SearchBar, Button, AnimatedCard, Pill, SegmentedControl } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAsyncStorage } from "../hooks/useStorage";
import { useDataSource } from "../hooks/useDataSource";
import { useSchool } from "../state/school";

type RouteType = "wheelchair" | "elevator" | "ramp" | "all";

type AccessibilityFeature = {
  id: string;
  name: string;
  type: "elevator" | "ramp" | "accessible_restroom" | "tactile_path" | "auto_door";
  building: string;
  floor: string;
  description: string;
};

// Fallback features when none are available
const FALLBACK_FEATURES: AccessibilityFeature[] = [];

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

// Generate generic route steps based on destination
function generateRouteSteps(destination: string): RouteStep[] {
  return [
    { id: "1", instruction: "從出發點開始", distance: 0, accessibilityNote: "起點" },
    { id: "2", instruction: `前往 ${destination}`, distance: 100, accessibilityNote: "無障礙路線" },
    { id: "3", instruction: "抵達目的地", distance: 0, accessibilityNote: `已到達 ${destination}` },
  ];
}

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
  const { school } = useSchool();
  const ds = useDataSource();

  const [searchQuery, setSearchQuery] = useState(destination);
  const [selectedTab, setSelectedTab] = useState<number>(0);
  const [routePreference, setRoutePreference] = useState<RouteType>("all");
  const [showRoute, setShowRoute] = useState(false);
  const [loadedFeatures, setLoadedFeatures] = useState<AccessibilityFeature[]>([]);
  const [savedRoutes, setSavedRoutes] = useAsyncStorage<SavedRoute[]>("accessible_route_favorites", {
    defaultValue: [],
  });

  // Load POIs with accessible facilities from DataSource
  useEffect(() => {
    let active = true;
    const loadAccessiblePOIs = async () => {
      if (!school?.id) {
        setLoadedFeatures([]);
        return;
      }
      try {
        const pois = await ds.listPois(school.id);
        if (!active) return;

        const features: AccessibilityFeature[] = [];
        pois.forEach((poi, poiIdx) => {
          if (poi.accessible && poi.facilities) {
            const facilities = Array.isArray(poi.facilities) ? poi.facilities : [poi.facilities];
            facilities.forEach((facility: any, facIdx: number) => {
              features.push({
                id: `${poi.id}:${facIdx}`,
                name: facility.name || `${poi.name} 無障礙設施`,
                type: facility.type || "elevator",
                building: poi.name || "未知建築",
                floor: facility.floor || "1F",
                description: facility.description || "無障礙設施",
              });
            });
          }
        });
        setLoadedFeatures(features.length > 0 ? features : FALLBACK_FEATURES);
      } catch (error) {
        console.warn("Failed to load accessible POIs:", error);
        setLoadedFeatures(FALLBACK_FEATURES);
      }
    };
    loadAccessiblePOIs();
    return () => {
      active = false;
    };
  }, [school?.id, ds]);

  const TABS = ["路線規劃", "設施地圖"];
  const ROUTE_TYPES: { key: RouteType; label: string; icon: string }[] = [
    { key: "all", label: "所有設施", icon: "apps" },
    { key: "wheelchair", label: "輪椅適用", icon: "accessibility" },
    { key: "elevator", label: "電梯優先", icon: "arrow-up-circle" },
    { key: "ramp", label: "坡道優先", icon: "trending-up" },
  ];

  const filteredFeatures = useMemo(() => {
    let features = loadedFeatures;
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
  }, [loadedFeatures, searchQuery, routePreference]);

  const routeSteps = useMemo(() => {
    return searchQuery ? generateRouteSteps(searchQuery) : [];
  }, [searchQuery]);

  const totalDistance = useMemo(() => {
    return routeSteps.reduce((sum, step) => sum + step.distance, 0);
  }, [routeSteps]);

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
                  {routeSteps.map((step, idx) => (
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
                              idx === routeSteps.length - 1
                                ? theme.colors.success
                                : theme.colors.accent,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {idx === routeSteps.length - 1 ? (
                            <Ionicons name="flag" size={14} color="#fff" />
                          ) : (
                            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>
                              {idx + 1}
                            </Text>
                          )}
                        </View>
                        {idx < routeSteps.length - 1 && (
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
