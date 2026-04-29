/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList, ScrollView, Text, Pressable, View, Linking, Platform,
  Alert, Dimensions, Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useDebounce } from "../hooks/useDebounce";
import { useGeolocation } from "../hooks/useGeolocation";
import { SearchBar, EmptyState } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, softShadowStyle } from "../ui/theme";
import {
  CAMPUS_POIS, CAMPUS_BOUNDS, CAMPUS_PATH_NODES,
  CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_COLORS as CAT_COLORS,
  searchCampusPois, getCampusPoi, findShortestPath, pathToNavigationSteps,
  type CampusPoi, type CampusPoiCategory,
} from "../data/puCampusData";

// ─── Helpers ─────────────────────────────────────────
function haverDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDist(m: number) { return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`; }
function fmtWalk(m: number) { const min = Math.ceil(m / 80); return min < 1 ? "< 1 分" : `${min} 分`; }

const { width: SW } = Dimensions.get("window");

// ─── Smart intent search ─────────────────────────────
// 使用者輸入「吃」「飯」→ 餐廳；「印」→ 列印；「書」→ 圖書館
const INTENT_MAP: Array<{ keywords: string[]; categories: CampusPoiCategory[] }> = [
  { keywords: ["吃", "飯", "餐", "食", "肚子餓", "午餐", "晚餐", "早餐", "便當"], categories: ["cafeteria", "convenience"] },
  { keywords: ["印", "列印", "影印", "print"], categories: ["convenience", "other"] },
  { keywords: ["書", "圖書", "自習", "K書", "讀書", "library"], categories: ["library"] },
  { keywords: ["運動", "跑步", "籃球", "游泳", "健身", "球場"], categories: ["sports"] },
  { keywords: ["停車", "車", "機車", "parking"], categories: ["parking"] },
  { keywords: ["宿舍", "回家", "寢室"], categories: ["dormitory"] },
  { keywords: ["ATM", "錢", "提款"], categories: ["convenience"] },
  { keywords: ["醫", "看病", "不舒服", "諮商", "護理"], categories: ["medical"] },
  { keywords: ["教室", "上課", "教學"], categories: ["academic"] },
  { keywords: ["行政", "辦公", "註冊", "教務"], categories: ["admin"] },
  { keywords: ["門", "入口", "公車", "站牌"], categories: ["gate"] },
];

function smartSearch(query: string, userLat: number | null, userLng: number | null): CampusPoi[] {
  const q = query.trim();
  if (!q) return [];

  // 1. Try intent matching first
  for (const intent of INTENT_MAP) {
    if (intent.keywords.some((kw) => q.includes(kw))) {
      let results = CAMPUS_POIS.filter((p) => intent.categories.includes(p.category));
      if (userLat !== null && userLng !== null) {
        results.sort((a, b) => haverDist(userLat, userLng, a.lat, a.lng) - haverDist(userLat, userLng, b.lat, b.lng));
      }
      return results;
    }
  }

  // 2. Normal text search
  return searchCampusPois(q);
}

// ─── Time-aware smart suggestions ────────────────────
type SmartSuggestion = {
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  action: "navigate_category" | "navigate_poi";
  payload: string; // category or poi id
};

function getSmartSuggestions(hour: number, userLat: number | null, userLng: number | null): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = [];

  // Find nearest of each category
  const findNearest = (cats: CampusPoiCategory[]): CampusPoi | null => {
    if (userLat === null || userLng === null) return null;
    const pois = CAMPUS_POIS.filter((p) => cats.includes(p.category));
    if (pois.length === 0) return null;
    return pois.reduce((nearest, p) =>
      haverDist(userLat, userLng, p.lat, p.lng) < haverDist(userLat, userLng, nearest.lat, nearest.lng) ? p : nearest
    );
  };

  if (hour >= 6 && hour < 12) {
    // Morning — class time
    suggestions.push({
      icon: "school-outline", title: "去上課", subtitle: "找到最近的教學大樓",
      color: "#2563EB", action: "navigate_category", payload: "academic",
    });
    const nearestCafe = findNearest(["cafeteria"]);
    if (nearestCafe) {
      suggestions.push({
        icon: "cafe-outline", title: "早餐", subtitle: `${nearestCafe.name} · ${userLat ? fmtDist(haverDist(userLat!, userLng!, nearestCafe.lat, nearestCafe.lng)) : ""}`,
        color: "#DC2626", action: "navigate_poi", payload: nearestCafe.id,
      });
    }
  } else if (hour >= 11 && hour < 14) {
    // Lunch
    suggestions.push({
      icon: "restaurant-outline", title: "找吃的", subtitle: "查看餐廳人潮 · 最近的先",
      color: "#DC2626", action: "navigate_category", payload: "cafeteria",
    });
    const nearest7 = getCampusPoi("pu-7eleven");
    if (nearest7) {
      suggestions.push({
        icon: "storefront-outline", title: "便利商店", subtitle: nearest7.name,
        color: "#0891B2", action: "navigate_poi", payload: nearest7.id,
      });
    }
  } else if (hour >= 14 && hour < 18) {
    // Afternoon
    suggestions.push({
      icon: "school-outline", title: "下午課", subtitle: "找教室",
      color: "#2563EB", action: "navigate_category", payload: "academic",
    });
    suggestions.push({
      icon: "library-outline", title: "去圖書館", subtitle: "自習、借書",
      color: "#059669", action: "navigate_poi", payload: "pu-library",
    });
  } else if (hour >= 18 && hour < 22) {
    // Evening
    suggestions.push({
      icon: "library-outline", title: "晚自習", subtitle: "蓋夏圖書館開到 22:00",
      color: "#059669", action: "navigate_poi", payload: "pu-library",
    });
    suggestions.push({
      icon: "home-outline", title: "回宿舍", subtitle: "帶你走最近的路",
      color: "#D97706", action: "navigate_category", payload: "dormitory",
    });
  } else {
    // Late night
    suggestions.push({
      icon: "storefront-outline", title: "7-ELEVEN", subtitle: "24 小時 · ATM",
      color: "#0891B2", action: "navigate_poi", payload: "pu-7eleven",
    });
    suggestions.push({
      icon: "home-outline", title: "回宿舍", subtitle: "夜間路線",
      color: "#D97706", action: "navigate_category", payload: "dormitory",
    });
  }

  // Always add a transport suggestion
  suggestions.push({
    icon: "bus-outline", title: "公車站", subtitle: "靜宜大學站",
    color: "#3B82F6", action: "navigate_poi", payload: "pu-bus-stop",
  });

  return suggestions.slice(0, 4);
}

// ─── Quick scenario buttons ──────────────────────────
const QUICK_SCENARIOS: Array<{
  icon: string; label: string; color: string;
  filter: (pois: CampusPoi[]) => CampusPoi[];
}> = [
  {
    icon: "school", label: "上課", color: "#2563EB",
    filter: (p) => p.filter((x) => x.category === "academic"),
  },
  {
    icon: "restaurant", label: "吃飯", color: "#DC2626",
    filter: (p) => p.filter((x) => x.category === "cafeteria" || x.category === "convenience"),
  },
  {
    icon: "home", label: "宿舍", color: "#D97706",
    filter: (p) => p.filter((x) => x.category === "dormitory"),
  },
  {
    icon: "library", label: "圖書館", color: "#059669",
    filter: (p) => p.filter((x) => x.category === "library"),
  },
  {
    icon: "fitness", label: "運動", color: "#16A34A",
    filter: (p) => p.filter((x) => x.category === "sports"),
  },
  {
    icon: "medkit", label: "醫療", color: "#DC2626",
    filter: (p) => p.filter((x) => x.category === "medical"),
  },
];

// ─── Map App Launcher ────────────────────────────────
async function openExtMap(lat: number, lng: number, name: string) {
  const web = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (Platform.OS === "ios") {
    try { if (await Linking.canOpenURL("maps://")) { await Linking.openURL(`maps:0,0?q=${encodeURIComponent(name)}@${lat},${lng}`); return; } } catch {}
  }
  if (Platform.OS === "android") {
    try { await Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`); return; } catch {}
  }
  try { await Linking.openURL(web); } catch { Alert.alert("無法開啟地圖"); }
}

// ─── Mini Map View ───────────────────────────────────
function MiniMap({
  pois, selectedId, onSelect, userLat, userLng,
}: {
  pois: CampusPoi[]; selectedId: string | null;
  onSelect: (poi: CampusPoi) => void; userLat: number | null; userLng: number | null;
}) {
  const W = SW - 32, H = 220, pad = 16;
  const { north, south, east, west } = CAMPUS_BOUNDS;
  const toXY = (lat: number, lng: number) => ({
    x: pad + ((lng - west) / (east - west)) * (W - pad * 2),
    y: pad + ((north - lat) / (north - south)) * (H - pad * 2),
  });

  return (
    <View style={{
      width: W, height: H, borderRadius: 16,
      backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border,
      overflow: "hidden", position: "relative",
    }}>
      {/* Path lines */}
      {CAMPUS_PATH_NODES.map((n) =>
        n.connectedTo.map((tid) => {
          const t = CAMPUS_PATH_NODES.find((x) => x.id === tid);
          if (!t || n.id > tid) return null;
          const a = toXY(n.lat, n.lng), b = toXY(t.lat, t.lng);
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          const ang = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
          return <View key={`${n.id}-${tid}`} style={{
            position: "absolute", left: a.x, top: a.y, width: len, height: 1.5,
            backgroundColor: `${theme.colors.accent}18`, transform: [{ rotate: `${ang}deg` }], transformOrigin: "left center",
          }} />;
        })
      )}
      {/* User */}
      {userLat !== null && userLng !== null && (() => {
        const p = toXY(userLat, userLng);
        if (p.x < -8 || p.x > W + 8 || p.y < -8 || p.y > H + 8) return null;
        return <View style={{
          position: "absolute", left: p.x - 7, top: p.y - 7, width: 14, height: 14,
          borderRadius: 7, backgroundColor: "#3B82F6", borderWidth: 2.5, borderColor: "#fff", zIndex: 999,
        }} />;
      })()}
      {/* POI dots */}
      {pois.map((poi) => {
        const p = toXY(poi.lat, poi.lng);
        const sel = poi.id === selectedId;
        const c = CAT_COLORS[poi.category] ?? "#6B7280";
        const sz = sel ? 14 : 7;
        return (
          <Pressable key={poi.id} onPress={() => onSelect(poi)} hitSlop={14} style={{
            position: "absolute", left: p.x - sz / 2, top: p.y - sz / 2,
            width: sz, height: sz, borderRadius: sz / 2,
            backgroundColor: c, borderWidth: sel ? 2 : 0.5, borderColor: sel ? "#fff" : `${c}60`,
            zIndex: sel ? 100 : 10,
          }} />
        );
      })}
      {/* Selected label */}
      {selectedId && (() => {
        const poi = pois.find((x) => x.id === selectedId);
        if (!poi) return null;
        const p = toXY(poi.lat, poi.lng);
        return <View style={{
          position: "absolute",
          left: Math.max(2, Math.min(p.x - 40, W - 84)),
          top: Math.max(2, p.y - 26),
          backgroundColor: "rgba(0,0,0,0.85)", paddingHorizontal: 7, paddingVertical: 2.5,
          borderRadius: 5, zIndex: 200,
        }}>
          <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }} numberOfLines={1}>{poi.name}</Text>
        </View>;
      })()}
      <View style={{ position: "absolute", top: 5, right: 6 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 7, fontWeight: "700" }}>N ↑</Text>
      </View>
    </View>
  );
}

// ─── Route Preview Modal ─────────────────────────────
function RouteModal({
  visible, onClose, steps, totalDist, destName, onStartAR,
}: {
  visible: boolean; onClose: () => void;
  steps: ReturnType<typeof pathToNavigationSteps>;
  totalDist: number; destName: string; onStartAR: () => void;
}) {
  const dIcon = (d: string) => d.includes("left") ? "arrow-back" : d.includes("right") ? "arrow-forward" : d === "destination" ? "flag" : "arrow-up";
  const dColor = (d: string) => d === "destination" ? theme.colors.success : d.includes("left") || d.includes("right") ? "#F59E0B" : theme.colors.accent;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View style={{ backgroundColor: theme.colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "75%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 18 }}>路線規劃</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }}>
                {destName} · {fmtDist(totalDist)} · 步行 {fmtWalk(totalDist)}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close-circle" size={26} color={theme.colors.muted} />
            </Pressable>
          </View>
          {/* Start AR button */}
          <Pressable
            onPress={onStartAR}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              paddingVertical: 14, borderRadius: theme.radius.lg, marginBottom: 12,
              backgroundColor: pressed ? theme.colors.accent : `${theme.colors.accent}15`,
              borderWidth: 1, borderColor: `${theme.colors.accent}40`,
            })}
          >
            <Ionicons name="camera" size={20} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent, fontWeight: "800", fontSize: 15 }}>開啟 AR 實景導航</Text>
          </Pressable>
          <FlatList
            data={steps}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ gap: 6, paddingBottom: 20 }}
            renderItem={({ item, index }) => (
              <View style={{
                flexDirection: "row", alignItems: "center", padding: 12,
                borderRadius: 12, backgroundColor: theme.colors.surface,
                borderWidth: 1, borderColor: theme.colors.border, gap: 10,
              }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: `${dColor(item.direction)}12`, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={dIcon(item.direction) as any} size={15} color={dColor(item.direction)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{item.instruction}</Text>
                  {item.distance > 0 && <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>{fmtDist(item.distance)}</Text>}
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "700" }}>{index + 1}</Text>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════
// MapScreen — 智慧校園導航
// ═════════════════════════════════════════════════════
export function MapScreen(props: Record<string, unknown>) {
  const navigation = useNavigation();
  const nav = (props?.navigation ?? navigation) as any;

  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 200);
  const [showMap, setShowMap] = useState(true);
  const [activeScenario, setActiveScenario] = useState<number | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [routePreview, setRoutePreview] = useState<{
    steps: ReturnType<typeof pathToNavigationSteps>; totalDist: number; name: string;
  } | null>(null);

  const geo = useGeolocation({ enableHighAccuracy: true, distanceInterval: 10, timeInterval: 5000, autoStart: true });
  const uLat = typeof geo.latitude === "number" ? geo.latitude : null;
  const uLng = typeof geo.longitude === "number" ? geo.longitude : null;
  const hour = new Date().getHours();

  // ── Smart suggestions ──
  const suggestions = useMemo(() => getSmartSuggestions(hour, uLat, uLng), [hour, uLat, uLng]);

  // ── Filter & sort ──
  const filtered = useMemo(() => {
    // Active scenario filter
    if (activeScenario !== null) {
      let pois = QUICK_SCENARIOS[activeScenario].filter(CAMPUS_POIS);
      if (uLat !== null && uLng !== null) pois.sort((a, b) => haverDist(uLat, uLng, a.lat, a.lng) - haverDist(uLat, uLng, b.lat, b.lng));
      return pois;
    }
    // Search query
    if (debouncedQ.trim()) {
      let pois = smartSearch(debouncedQ.trim(), uLat, uLng);
      if (uLat !== null && uLng !== null) pois.sort((a, b) => haverDist(uLat, uLng, a.lat, a.lng) - haverDist(uLat, uLng, b.lat, b.lng));
      return pois;
    }
    // Default: all by distance
    let pois = [...CAMPUS_POIS];
    if (uLat !== null && uLng !== null) pois.sort((a, b) => haverDist(uLat, uLng, a.lat, a.lng) - haverDist(uLat, uLng, b.lat, b.lng));
    else pois.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    return pois;
  }, [debouncedQ, activeScenario, uLat, uLng]);

  const selectedPoi = useMemo(() => selectedPoiId ? getCampusPoi(selectedPoiId) ?? null : null, [selectedPoiId]);
  const selectedDist = useMemo(() => {
    if (!selectedPoi || uLat === null || uLng === null) return null;
    return haverDist(uLat, uLng, selectedPoi.lat, selectedPoi.lng);
  }, [selectedPoi, uLat, uLng]);

  // ── Handlers ──
  const goToPoi = useCallback((poi: CampusPoi) => {
    setSelectedPoiId(poi.id);
  }, []);

  /** 核心動作：一鍵開啟 AR 導航（不跳外部地圖） */
  const handleGoNow = useCallback((poi: CampusPoi) => {
    nav.navigate("ARNavigation", {
      destination: poi.name,
      destinationId: poi.id,
      destinationLat: poi.lat,
      destinationLng: poi.lng,
    });
  }, [nav]);

  /** 路線預覽（次要動作，展示 A* 路網步驟） */
  const handleShowRoute = useCallback((poi: CampusPoi) => {
    if (uLat === null || uLng === null) {
      Alert.alert("需要定位", "開啟 GPS 後才能規劃路線。你也可以直接使用 AR 導航。");
      return;
    }
    const path = findShortestPath(uLat, uLng, poi.lat, poi.lng);
    const steps = pathToNavigationSteps(path, poi.name);
    setRoutePreview({ steps, totalDist: steps.reduce((s, st) => s + st.distance, 0), name: poi.name });
  }, [uLat, uLng]);

  /** 智慧推薦卡片點擊 */
  const handleSuggestion = useCallback((sg: SmartSuggestion) => {
    if (sg.action === "navigate_poi") {
      const poi = getCampusPoi(sg.payload);
      if (poi) handleGoNow(poi); // 直接 AR 導航
    } else {
      const cat = sg.payload as CampusPoiCategory;
      const idx = QUICK_SCENARIOS.findIndex((s) => s.filter(CAMPUS_POIS).some((p) => p.category === cat));
      if (idx >= 0) {
        setActiveScenario(idx);
        setQ("");
      }
    }
  }, [handleGoNow]);

  const getDist = useCallback((poi: CampusPoi) => {
    if (uLat === null || uLng === null) return null;
    return haverDist(uLat, uLng, poi.lat, poi.lng);
  }, [uLat, uLng]);

  // ── List header ──
  const listHeader = useMemo(() => (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      {/* Search bar */}
      <SearchBar
        value={q}
        onChange={(v) => { setQ(v); setActiveScenario(null); }}
        placeholder="想去哪？試試「吃飯」「圖書館」「印東西」..."
      />

      {/* Smart suggestions — time-aware cards */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {suggestions.map((sg, i) => (
          <Pressable
            key={i}
            onPress={() => handleSuggestion(sg)}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 8,
              paddingHorizontal: 14, paddingVertical: 10,
              borderRadius: 14, backgroundColor: `${sg.color}10`,
              borderWidth: 1, borderColor: `${sg.color}25`,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <View style={{
              width: 30, height: 30, borderRadius: 9,
              backgroundColor: `${sg.color}18`, alignItems: "center", justifyContent: "center",
            }}>
              <Ionicons name={sg.icon as any} size={16} color={sg.color} />
            </View>
            <View>
              <Text style={{ color: sg.color, fontWeight: "700", fontSize: 13 }}>{sg.title}</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }} numberOfLines={1}>{sg.subtitle}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Quick scenario buttons */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {QUICK_SCENARIOS.map((sc, i) => {
          const active = activeScenario === i;
          return (
            <Pressable
              key={i}
              onPress={() => { setActiveScenario(active ? null : i); setQ(""); }}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 4,
                paddingHorizontal: 12, paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: active ? `${sc.color}20` : theme.colors.surface,
                borderWidth: 1, borderColor: active ? `${sc.color}50` : theme.colors.border,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <Ionicons name={sc.icon as any} size={14} color={active ? sc.color : theme.colors.muted} />
              <Text style={{ color: active ? sc.color : theme.colors.textSecondary, fontWeight: "600", fontSize: 12 }}>
                {sc.label}
              </Text>
            </Pressable>
          );
        })}
        {activeScenario !== null && (
          <Pressable onPress={() => setActiveScenario(null)} style={{ justifyContent: "center", paddingHorizontal: 8 }}>
            <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: "600" }}>全部</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Map */}
      {showMap && (
        <MiniMap
          pois={filtered}
          selectedId={selectedPoiId}
          onSelect={goToPoi}
          userLat={uLat}
          userLng={uLng}
        />
      )}

      {/* Count + toggle */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
          {filtered.length} 個地點{uLat !== null ? " · 由近到遠" : ""}
          {activeScenario !== null ? ` · ${QUICK_SCENARIOS[activeScenario].label}` : ""}
        </Text>
        <Pressable onPress={() => setShowMap(!showMap)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name={showMap ? "eye-off-outline" : "map-outline"} size={14} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>{showMap ? "隱藏地圖" : "顯示地圖"}</Text>
        </Pressable>
      </View>
    </View>
  ), [q, suggestions, activeScenario, showMap, filtered, selectedPoiId, uLat, uLng]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {/* Scrollable list — map is inside ListHeader so everything scrolls together */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={{
          paddingHorizontal: theme.space.lg,
          paddingTop: 8,
          gap: 8,
          paddingBottom: selectedPoi ? TAB_BAR_CONTENT_BOTTOM_PADDING + 100 : TAB_BAR_CONTENT_BOTTOM_PADDING,
          flexGrow: filtered.length === 0 ? 1 : undefined,
        }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            title={debouncedQ.trim() ? "找不到相關地點" : "沒有符合的地點"}
            subtitle={debouncedQ.trim() ? `試試其他關鍵字，例如「吃飯」「圖書館」` : "清除篩選試試"}
            actionText={activeScenario !== null || debouncedQ.trim() ? "清除" : undefined}
            onAction={() => { setActiveScenario(null); setQ(""); }}
          />
        }
        renderItem={({ item: poi }) => {
          const c = CAT_COLORS[poi.category] ?? "#6B7280";
          const dist = getDist(poi);
          const sel = poi.id === selectedPoiId;

          return (
            <Pressable
              onPress={() => goToPoi(poi)}
              style={({ pressed }) => ({
                borderRadius: 14,
                backgroundColor: sel ? `${c}08` : theme.colors.surface,
                borderWidth: 1, borderColor: sel ? `${c}35` : theme.colors.border,
                borderLeftWidth: 4, borderLeftColor: c,
                paddingVertical: 12, paddingHorizontal: 14,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{
                  width: 34, height: 34, borderRadius: 9,
                  backgroundColor: `${c}12`, alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name={CATEGORY_ICONS[poi.category] as any} size={17} color={c} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                    {poi.name}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                    {CATEGORY_LABELS[poi.category]}
                    {poi.floor !== "地面" && poi.floor !== "戶外" && poi.floor !== "平面" ? ` · ${poi.floor}` : ""}
                    {poi.accessible ? " · 無障礙" : ""}
                  </Text>
                </View>
                {dist !== null && (
                  <View style={{ alignItems: "flex-end", marginRight: 4 }}>
                    <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 13 }}>{fmtDist(dist)}</Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{fmtWalk(dist)}</Text>
                  </View>
                )}
                {/* One-tap GO button */}
                <Pressable
                  onPress={() => handleGoNow(poi)}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: pressed ? theme.colors.accent : `${theme.colors.accent}12`,
                    alignItems: "center", justifyContent: "center",
                    borderWidth: 1, borderColor: `${theme.colors.accent}30`,
                  })}
                >
                  <Ionicons name="navigate" size={16} color={theme.colors.accent} />
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      {/* ── Floating selected card ── */}
      {selectedPoi && (
        <View style={{
          position: "absolute", left: 16, right: 16,
          bottom: TAB_BAR_CONTENT_BOTTOM_PADDING - 12,
        }}>
          <View style={{
            backgroundColor: theme.colors.surface, borderRadius: 18,
            padding: 14, gap: 10,
            borderWidth: 1, borderColor: theme.colors.border,
            ...softShadowStyle(theme.shadows.soft),
          }}>
            {/* Info row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: `${CAT_COLORS[selectedPoi.category]}12`,
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons name={CATEGORY_ICONS[selectedPoi.category] as any} size={20} color={CAT_COLORS[selectedPoi.category]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{selectedPoi.name}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                  {selectedPoi.description}
                </Text>
              </View>
              {selectedDist !== null && (
                <View style={{
                  backgroundColor: theme.colors.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
                }}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>{fmtDist(selectedDist)}</Text>
                </View>
              )}
              <Pressable onPress={() => setSelectedPoiId(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={theme.colors.muted} />
              </Pressable>
            </View>
            {/* Actions row — AR 導航為主角 */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              {/* 主按鈕：AR 導航 */}
              <Pressable
                onPress={() => handleGoNow(selectedPoi)}
                style={({ pressed }) => ({
                  flex: 3, paddingVertical: 13, borderRadius: 14,
                  backgroundColor: pressed ? `${theme.colors.accent}DD` : theme.colors.accent,
                  flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                })}
              >
                <Ionicons name="camera" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>AR 帶我去</Text>
              </Pressable>
              {/* 次要：路線預覽 */}
              <Pressable
                onPress={() => handleShowRoute(selectedPoi)}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 13, borderRadius: 14,
                  backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                  borderWidth: 1, borderColor: theme.colors.border,
                  alignItems: "center", justifyContent: "center",
                })}
              >
                <Ionicons name="map-outline" size={17} color={theme.colors.textSecondary} />
              </Pressable>
              {/* 詳情 */}
              <Pressable
                onPress={() => nav.navigate("PoiDetail", { id: selectedPoi.id })}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: 13, borderRadius: 14,
                  backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface,
                  borderWidth: 1, borderColor: theme.colors.border,
                  alignItems: "center", justifyContent: "center",
                })}
              >
                <Ionicons name="information-circle-outline" size={17} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Route modal */}
      {routePreview && (
        <RouteModal
          visible
          onClose={() => setRoutePreview(null)}
          steps={routePreview.steps}
          totalDist={routePreview.totalDist}
          destName={routePreview.name}
          onStartAR={() => {
            setRoutePreview(null);
            const poi = CAMPUS_POIS.find((p) => p.name === routePreview.name);
            if (poi) handleGoNow(poi);
          }}
        />
      )}
    </View>
  );
}
