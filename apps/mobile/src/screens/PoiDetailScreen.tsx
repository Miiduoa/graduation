/* eslint-disable */
import React, { useMemo, useState, useEffect } from "react";
import { ScrollView, Text, View, Linking, Platform, Pressable, Alert, Share, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { findById, type CrowdLevel, type PoiCrowdReport, type PoiReportType, type PoiReview } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AnimatedCard, StatusBadge, InfoRow, FeatureHighlight, RatingStars, Avatar, SegmentedControl, Divider } from "../ui/components";
import { useFavorites } from "../state/favorites";
import { useAuth } from "../state/auth";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { formatRelativeTime, toDate } from "../utils/format";

type CrowdInfo = {
  level: CrowdLevel;
  count: number;
  trend: "increasing" | "decreasing" | "stable";
  peakHours: string[];
  lastUpdated: Date;
};

type NearbyFacility = {
  id: string;
  name: string;
  category: string;
  distance: number;
  lat: number;
  lng: number;
};

type AccessibilityInfo = {
  hasElevator: boolean;
  hasRamp: boolean;
  hasAccessibleRestroom: boolean;
  hasAccessibleParking: boolean;
  hasBrailleSigns: boolean;
  notes?: string;
};

type OperatingHours = {
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
};

const REVIEW_TAGS = ["環境好", "安靜", "設備新", "人多", "空調好", "WiFi快", "插座多", "乾淨", "難找"];

function openInMaps(lat: number, lng: number, name: string) {
  const label = encodeURIComponent(name);
  let url: string;

  if (Platform.OS === "ios") {
    url = `maps:0,0?q=${label}@${lat},${lng}`;
  } else if (Platform.OS === "android") {
    url = `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
  } else {
    url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  });
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function generateMockCrowdInfo(category: string): CrowdInfo {
  const hour = new Date().getHours();
  const isLunchTime = hour >= 11 && hour <= 13;
  const isClassTime = (hour >= 8 && hour <= 12) || (hour >= 13 && hour <= 17);

  let baseLevel: CrowdLevel = "low";
  let count = Math.floor(Math.random() * 20) + 5;

  if (category === "餐廳" || category === "美食") {
    baseLevel = isLunchTime ? "very_high" : "medium";
    count = isLunchTime ? Math.floor(Math.random() * 50) + 30 : Math.floor(Math.random() * 20) + 10;
  } else if (category === "圖書館" || category === "自習室") {
    baseLevel = isClassTime ? "high" : "medium";
    count = Math.floor(Math.random() * 100) + 20;
  } else if (category === "行政大樓") {
    baseLevel = isClassTime ? "medium" : "low";
    count = Math.floor(Math.random() * 30) + 5;
  }

  const trends: Array<"increasing" | "decreasing" | "stable"> = ["increasing", "decreasing", "stable"];
  const trend = trends[Math.floor(Math.random() * trends.length)];

  const peakHours = category === "餐廳" ? ["11:30-12:30", "17:30-18:30"] : ["10:00-12:00", "14:00-16:00"];

  return {
    level: baseLevel,
    count,
    trend,
    peakHours,
    lastUpdated: new Date(),
  };
}

const crowdLevelConfig = {
  low: { color: theme.colors.success, label: "人少", icon: "happy-outline" },
  medium: { color: "#F59E0B", label: "適中", icon: "people-outline" },
  high: { color: "#F97316", label: "擁擠", icon: "people" },
  very_high: { color: theme.colors.danger, label: "非常擁擠", icon: "alert-circle" },
};

const CROWD_LEVEL_SCORE: Record<CrowdLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

function getCrowdLevelFromScore(score: number): CrowdLevel {
  if (score < 1.5) return "low";
  if (score < 2.5) return "medium";
  if (score < 3.5) return "high";
  return "very_high";
}

function buildPeakHours(reports: PoiCrowdReport[]): string[] {
  const histogram = new Map<number, number>();
  for (const report of reports) {
    if (!report.createdAt) continue;
    const hour = toDate(report.createdAt).getHours();
    histogram.set(hour, (histogram.get(hour) ?? 0) + 1);
  }

  const ranked = Array.from(histogram.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([hour]) => `${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00`);

  return ranked.length > 0 ? ranked : ["10:00-11:00", "12:00-13:00"];
}

function estimateCrowdCount(level: CrowdLevel, reportCount: number): number {
  const baseByLevel: Record<CrowdLevel, number> = {
    low: 12,
    medium: 32,
    high: 68,
    very_high: 120,
  };

  return baseByLevel[level] + Math.max(reportCount - 1, 0) * 6;
}

function deriveCrowdInfoFromReports(reports: PoiCrowdReport[]): CrowdInfo | null {
  const withDate = reports
    .filter((report) => !!report.createdAt)
    .map((report) => ({ ...report, createdDate: toDate(report.createdAt) }))
    .sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());

  if (withDate.length === 0) return null;

  const now = Date.now();
  const recentWindow = withDate.filter((report) => now - report.createdDate.getTime() <= 2 * 60 * 60 * 1000);
  const effectiveReports = recentWindow.length > 0 ? recentWindow : withDate.slice(0, 12);
  const averageScore =
    effectiveReports.reduce((sum, report) => sum + CROWD_LEVEL_SCORE[report.level], 0) / effectiveReports.length;
  const level = getCrowdLevelFromScore(averageScore);

  const newestSlice = effectiveReports.slice(0, Math.min(3, effectiveReports.length));
  const olderSlice = effectiveReports.slice(Math.min(3, effectiveReports.length), Math.min(6, effectiveReports.length));
  const newestAverage =
    newestSlice.reduce((sum, report) => sum + CROWD_LEVEL_SCORE[report.level], 0) / newestSlice.length;
  const olderAverage =
    olderSlice.length > 0
      ? olderSlice.reduce((sum, report) => sum + CROWD_LEVEL_SCORE[report.level], 0) / olderSlice.length
      : newestAverage;

  let trend: CrowdInfo["trend"] = "stable";
  if (newestAverage - olderAverage >= 0.6) trend = "increasing";
  if (olderAverage - newestAverage >= 0.6) trend = "decreasing";

  return {
    level,
    count: estimateCrowdCount(level, effectiveReports.length),
    trend,
    peakHours: buildPeakHours(withDate),
    lastUpdated: withDate[0].createdDate,
  };
}

export function PoiDetailScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const id: string | undefined = props?.route?.params?.id;
  const fav = useFavorites();
  const auth = useAuth();

  const [crowdInfo, setCrowdInfo] = useState<CrowdInfo | null>(null);
  const [userRating, setUserRating] = useState(0);
  const [userComment, setUserComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportType, setReportType] = useState<PoiReportType>("wrong_info");
  const [reportDescription, setReportDescription] = useState("");

  const ds = useDataSource();
  const { items: raw, error: loadError, reload } = useAsyncList<any>(() => ds.listPois(school.id), [ds, school.id]);

  const item = useMemo(() => findById(raw, id), [raw, id]);

  const { items: reviews, loading: reviewsLoading, reload: reloadReviews } = useAsyncList<PoiReview>(
    () => (id ? ds.listPoiReviews(id, school.id) : Promise.resolve([])),
    [ds, id, school.id]
  );

  const { items: crowdReports, reload: reloadCrowdReports } = useAsyncList<PoiCrowdReport>(
    () => (id ? ds.listPoiCrowdReports(id, school.id) : Promise.resolve([])),
    [ds, id, school.id]
  );

  const myReview = useMemo(() => {
    if (!auth.user) return null;
    return reviews.find(r => r.uid === auth.user?.uid) ?? null;
  }, [reviews, auth.user?.uid]);

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 4.2 + Math.random() * 0.6; // Mock fallback
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  const popularTags = useMemo(() => {
    const tagCount: Record<string, number> = {};
    for (const r of reviews) {
      for (const tag of r.tags ?? []) {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }
    return Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);
  }, [reviews]);

  // Mock accessibility info
  const accessibilityInfo: AccessibilityInfo = useMemo(() => ({
    hasElevator: item?.category === "圖書館" || item?.category === "行政大樓" || Math.random() > 0.3,
    hasRamp: Math.random() > 0.2,
    hasAccessibleRestroom: Math.random() > 0.4,
    hasAccessibleParking: Math.random() > 0.5,
    hasBrailleSigns: item?.category === "圖書館" || Math.random() > 0.6,
    notes: item?.category === "圖書館" ? "一樓設有輪椅專用閱覽區" : undefined,
  }), [item?.category]);

  // Mock operating hours
  const operatingHours: OperatingHours = useMemo(() => {
    const isLibrary = item?.category === "圖書館";
    const isAdmin = item?.category === "行政大樓";
    return {
      monday: isLibrary ? "08:00-22:00" : isAdmin ? "08:00-17:00" : "全天開放",
      tuesday: isLibrary ? "08:00-22:00" : isAdmin ? "08:00-17:00" : "全天開放",
      wednesday: isLibrary ? "08:00-22:00" : isAdmin ? "08:00-17:00" : "全天開放",
      thursday: isLibrary ? "08:00-22:00" : isAdmin ? "08:00-17:00" : "全天開放",
      friday: isLibrary ? "08:00-22:00" : isAdmin ? "08:00-17:00" : "全天開放",
      saturday: isLibrary ? "09:00-17:00" : isAdmin ? "休息" : "全天開放",
      sunday: isLibrary ? "09:00-17:00" : isAdmin ? "休息" : "全天開放",
    };
  }, [item?.category]);

  const isOpenNow = useMemo(() => {
    const now = new Date();
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const today = dayNames[now.getDay()] as keyof OperatingHours;
    const hours = operatingHours[today];
    if (hours === "全天開放") return true;
    if (hours === "休息") return false;
    const [open, close] = hours.split("-");
    const [openH, openM] = open.split(":").map(Number);
    const [closeH, closeM] = close.split(":").map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const openMins = openH * 60 + openM;
    const closeMins = closeH * 60 + closeM;
    return nowMins >= openMins && nowMins <= closeMins;
  }, [operatingHours]);

  const nearbyFacilities = useMemo<NearbyFacility[]>(() => {
    if (!item) return [];
    const hasItemCoords = typeof item.lat === "number" && typeof item.lng === "number";
    if (!hasItemCoords) return [];
    return raw
      .filter((p) => p.id !== item.id && typeof p.lat === "number" && typeof p.lng === "number")
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        distance: calculateDistance(item.lat, item.lng, p.lat, p.lng),
        lat: p.lat,
        lng: p.lng,
      }))
      .filter((p) => p.distance < 500)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
  }, [raw, item]);

  useEffect(() => {
    if (item) {
      const derived = deriveCrowdInfoFromReports(crowdReports);
      if (derived) {
        setCrowdInfo(derived);
        return;
      }

      const info = generateMockCrowdInfo(item.category);
      setCrowdInfo(info);

      const interval = setInterval(() => {
        setCrowdInfo(generateMockCrowdInfo(item.category));
      }, 60000);

      return () => clearInterval(interval);
    }
  }, [item?.id, item?.category, crowdReports]);

  const handleShare = async () => {
    if (!item) return;
    const hasCoords = typeof item.lat === "number" && typeof item.lng === "number";
    const locationStr = hasCoords ? `位置：${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}\n\nGoogle Maps：https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}` : "";
    const message = `【${item.name}】\n\n${item.description}\n\n分類：${item.category}\n${locationStr}`;
    try {
      await Share.share({ message, title: item.name });
    } catch {}
  };

  const handleARNavigation = () => {
    nav?.navigate?.("ARNavigation", {
      destination: item?.name,
      destinationId: item?.id,
      destinationLat: typeof item?.lat === "number" ? item.lat : undefined,
      destinationLng: typeof item?.lng === "number" ? item.lng : undefined,
    });
  };

  const handleAccessibleRoute = () => {
    nav?.navigate?.("AccessibleRoute", { destination: item?.name });
  };

  const handleReportCrowd = () => {
    Alert.alert(
      "回報人潮",
      "目前這裡的人潮狀況如何？",
      [
        { text: "人很少", onPress: () => void submitCrowdReport("low") },
        { text: "適中", onPress: () => void submitCrowdReport("medium") },
        { text: "擁擠", onPress: () => void submitCrowdReport("high") },
        { text: "非常擁擠", onPress: () => void submitCrowdReport("very_high") },
        { text: "取消", style: "cancel" },
      ]
    );
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag].slice(0, 5)
    );
  };

  // Submit review
  const handleSubmitReview = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (userRating === 0) {
      setErr("請先選擇評分");
      return;
    }
    if (!id) return;

    setSubmittingReview(true);
    try {
      await ds.submitPoiReview({
        poiId: id,
        uid: auth.user.uid,
        schoolId: school.id,
        displayName: auth.profile?.displayName ?? null,
        avatarUrl: auth.profile?.avatarUrl ?? null,
        rating: userRating,
        comment: userComment,
        tags: selectedTags,
      });

      setShowReviewForm(false);
      setUserRating(0);
      setUserComment("");
      setSelectedTags([]);
      reloadReviews();
      setSuccessMsg("評價已送出，感謝你的回饋！");
    } catch (e: any) {
      setErr(e?.message ?? "送出評價失敗");
    } finally {
      setSubmittingReview(false);
    }
  };

  const submitCrowdReport = async (level: CrowdLevel) => {
    setErr(null);
    setSuccessMsg(null);

    if (!auth.user) {
      setErr("請先登入，才能回報即時人潮");
      return;
    }
    if (!id) return;

    try {
      await ds.submitPoiCrowdReport({
        poiId: id,
        uid: auth.user.uid,
        schoolId: school.id,
        level,
      });
      await reloadCrowdReports();
      setSuccessMsg(`已收到你的「${crowdLevelConfig[level].label}」回報，感謝協助更新現場資訊`);
    } catch (e: any) {
      setErr(e?.message ?? "送出人潮回報失敗");
    }
  };

  // Mark review as helpful
  const handleHelpful = async (reviewId: string, alreadyHelpful: boolean) => {
    if (!auth.user || !id) return;
    try {
      await ds.togglePoiReviewHelpful({
        poiId: id,
        reviewId,
        uid: auth.user.uid,
        schoolId: school.id,
        alreadyHelpful,
      });
      reloadReviews();
    } catch {}
  };

  // Submit report
  const handleSubmitReport = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!reportDescription.trim()) {
      setErr("請描述問題");
      return;
    }
    if (!id) return;

    try {
      await ds.submitPoiReport({
        poiId: id,
        uid: auth.user.uid,
        schoolId: school.id,
        email: auth.user.email ?? null,
        type: reportType,
        description: reportDescription,
      });

      setShowReportForm(false);
      setReportDescription("");
      setSuccessMsg("回報已送出，感謝你幫助改善資訊！");
    } catch (e: any) {
      setErr(e?.message ?? "送出回報失敗");
    }
  };

  const handleRating = (rating: number) => {
    setUserRating(rating);
    if (!showReviewForm) {
      setShowReviewForm(true);
    }
  };

  // 修正條件判斷順序：先檢查 loading 狀態，再檢查 error，最後檢查 item 是否存在
  const { loading: poisLoading } = { loading: raw.length === 0 && !loadError };
  
  if (loadError) {
    return <ErrorState title="點位" subtitle="讀取失敗" hint={loadError} actionText="重試" onAction={reload} />;
  }
  
  if (poisLoading) {
    return <LoadingState title="點位" subtitle="載入中..." rows={2} />;
  }
  
  // 如果資料已載入但找不到指定的 item，顯示 not found 錯誤
  if (!item && id) {
    return <ErrorState title="點位" subtitle="找不到此地點" hint={`ID: ${id} 不存在`} actionText="返回" onAction={() => nav?.goBack?.()} type="notFound" />;
  }
  
  if (!item) {
    return <LoadingState title="點位" subtitle="載入中..." rows={2} />;
  }

  const isFav = fav.isFavorite("poi", item.id);

  const getReportTypeLabel = (type: string) => {
    switch (type) {
      case "closed": return "已關閉";
      case "wrong_info": return "資訊錯誤";
      case "accessibility": return "無障礙問題";
      case "safety": return "安全問題";
      default: return "其他";
    }
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {/* Error/Success Messages */}
        {err && (
          <AnimatedCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.danger}15`, borderRadius: theme.radius.md }}>
              <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
              <Text style={{ flex: 1, color: theme.colors.danger }}>{err}</Text>
              <Pressable onPress={() => setErr(null)}>
                <Ionicons name="close" size={20} color={theme.colors.danger} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}
        {successMsg && (
          <AnimatedCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.success}15`, borderRadius: theme.radius.md }}>
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
              <Text style={{ flex: 1, color: theme.colors.success }}>{successMsg}</Text>
              <Pressable onPress={() => setSuccessMsg(null)}>
                <Ionicons name="close" size={20} color={theme.colors.success} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}

        {/* Main Info Card */}
        <AnimatedCard title={item.name} subtitle="">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <Pill text={item.category} kind="accent" />
            {isFav && <Pill text="已收藏" kind="accent" />}
            <StatusBadge
              status={isOpenNow ? "success" : "default"}
              label={isOpenNow ? "開放中" : "已關閉"}
            />
            {crowdInfo && (
              <StatusBadge
                status={crowdInfo.level === "low" ? "success" : crowdInfo.level === "very_high" ? "danger" : "warning"}
                label={crowdLevelConfig[crowdInfo.level].label}
              />
            )}
          </View>

          {/* Rating & Reviews Summary */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <RatingStars rating={avgRating} size={16} />
            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{avgRating.toFixed(1)}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>({reviews.length} 則評價)</Text>
          </View>

          {/* Popular Tags */}
          {popularTags.length > 0 && (
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {popularTags.map((tag) => (
                <View key={tag} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.colors.surface2, borderRadius: 12 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={{ color: theme.colors.text, lineHeight: 22 }}>{item.description}</Text>

          <View style={{ marginTop: 16, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button
              text={isFav ? "取消收藏" : "收藏"}
              kind={isFav ? "secondary" : "primary"}
              onPress={() => fav.toggleFavorite("poi", item.id)}
            />
            {typeof item.lat === "number" && typeof item.lng === "number" && (
              <Button text="導航" kind="primary" onPress={() => openInMaps(item.lat, item.lng, item.name)} />
            )}
            <Button text="分享" onPress={handleShare} />
          </View>
        </AnimatedCard>

        {/* Operating Hours */}
        <AnimatedCard title="營業時間" subtitle={isOpenNow ? "目前開放" : "目前休息"} delay={50}>
          <View style={{ gap: 8 }}>
            {Object.entries(operatingHours).map(([day, hours]) => {
              const dayLabels: Record<string, string> = {
                monday: "週一", tuesday: "週二", wednesday: "週三", thursday: "週四",
                friday: "週五", saturday: "週六", sunday: "週日"
              };
              const now = new Date();
              const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
              const isToday = dayNames[now.getDay()] === day;
              
              return (
                <View 
                  key={day} 
                  style={{ 
                    flexDirection: "row", 
                    justifyContent: "space-between", 
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    backgroundColor: isToday ? theme.colors.accentSoft : "transparent",
                    borderRadius: theme.radius.sm,
                  }}
                >
                  <Text style={{ color: isToday ? theme.colors.accent : theme.colors.text, fontWeight: isToday ? "700" : "400" }}>
                    {dayLabels[day]}
                  </Text>
                  <Text style={{ color: hours === "休息" ? theme.colors.danger : theme.colors.muted }}>
                    {hours}
                  </Text>
                </View>
              );
            })}
          </View>
        </AnimatedCard>

        {/* Accessibility Info */}
        <AnimatedCard title="無障礙設施" subtitle="查看可用設施" delay={75}>
          <View style={{ gap: 10 }}>
            {[
              { key: "hasElevator", icon: "arrow-up", label: "電梯", available: accessibilityInfo.hasElevator },
              { key: "hasRamp", icon: "trending-up", label: "無障礙坡道", available: accessibilityInfo.hasRamp },
              { key: "hasAccessibleRestroom", icon: "body", label: "無障礙廁所", available: accessibilityInfo.hasAccessibleRestroom },
              { key: "hasAccessibleParking", icon: "car", label: "無障礙停車位", available: accessibilityInfo.hasAccessibleParking },
              { key: "hasBrailleSigns", icon: "eye-off", label: "點字標示", available: accessibilityInfo.hasBrailleSigns },
            ].map((item) => (
              <View key={item.key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ 
                  width: 36, height: 36, borderRadius: 18, 
                  backgroundColor: item.available ? `${theme.colors.success}20` : theme.colors.surface2,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons 
                    name={item.icon as any} 
                    size={18} 
                    color={item.available ? theme.colors.success : theme.colors.muted} 
                  />
                </View>
                <Text style={{ flex: 1, color: theme.colors.text }}>{item.label}</Text>
                <Ionicons 
                  name={item.available ? "checkmark-circle" : "close-circle"} 
                  size={20} 
                  color={item.available ? theme.colors.success : theme.colors.muted} 
                />
              </View>
            ))}
          </View>
          {accessibilityInfo.notes && (
            <View style={{ marginTop: 12, padding: 10, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.sm }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{accessibilityInfo.notes}</Text>
            </View>
          )}
        </AnimatedCard>

        {crowdInfo && (
          <AnimatedCard
            title="即時人潮"
            subtitle={crowdReports.length > 0 ? `依據最近 ${crowdReports.length} 筆使用者回報` : "根據使用者回報與 AI 預測"}
            delay={100}
          >
            <View style={{ alignItems: "center", padding: 16 }}>
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: `${crowdLevelConfig[crowdInfo.level].color}20`,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <Ionicons
                  name={crowdLevelConfig[crowdInfo.level].icon as any}
                  size={36}
                  color={crowdLevelConfig[crowdInfo.level].color}
                />
              </View>
              <Text style={{ color: crowdLevelConfig[crowdInfo.level].color, fontWeight: "900", fontSize: 20 }}>
                {crowdLevelConfig[crowdInfo.level].label}
              </Text>
              <Text style={{ color: theme.colors.muted, marginTop: 4 }}>目前約 {crowdInfo.count} 人</Text>
              {crowdReports.length > 0 && (
                <Text style={{ color: theme.colors.muted, marginTop: 6, fontSize: 12 }}>
                  最近 2 小時內已有 {Math.min(crowdReports.length, 12)} 筆更新
                </Text>
              )}
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-around", marginTop: 12 }}>
              <View style={{ alignItems: "center" }}>
                <Ionicons
                  name={crowdInfo.trend === "increasing" ? "trending-up" : crowdInfo.trend === "decreasing" ? "trending-down" : "remove"}
                  size={24}
                  color={crowdInfo.trend === "increasing" ? theme.colors.danger : crowdInfo.trend === "decreasing" ? theme.colors.success : theme.colors.muted}
                />
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                  {crowdInfo.trend === "increasing" ? "人潮上升中" : crowdInfo.trend === "decreasing" ? "人潮下降中" : "人潮穩定"}
                </Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Ionicons name="time-outline" size={24} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                  尖峰：{crowdInfo.peakHours[0]}
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 16 }}>
              <Button text={auth.user ? "回報目前人潮" : "登入後可回報人潮"} onPress={handleReportCrowd} />
            </View>

            <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: "center", marginTop: 12 }}>
              最後更新：{crowdInfo.lastUpdated.toLocaleTimeString()}
            </Text>
          </AnimatedCard>
        )}

        <AnimatedCard title="導航選項" subtitle="選擇你偏好的導航方式" delay={200}>
          <View style={{ gap: 10 }}>
            {typeof item.lat === "number" && typeof item.lng === "number" && (
              <Pressable
                onPress={() => openInMaps(item.lat, item.lng, item.name)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: theme.colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Ionicons name="navigate" size={22} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>一般導航</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>使用系統地圖 App 導航</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </Pressable>
            )}

            <Pressable
              onPress={handleARNavigation}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: `${theme.colors.accent}10`,
                borderWidth: 1,
                borderColor: `${theme.colors.accent}30`,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: theme.colors.accentSoft,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 14,
                }}
              >
                <Ionicons name="camera" size={22} color={theme.colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700" }}>AR 實景導航</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>透過相機畫面顯示導航指示</Text>
              </View>
              <Pill text="新功能" kind="accent" />
            </Pressable>

            <Pressable
              onPress={handleAccessibleRoute}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: `${theme.colors.success}20`,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 14,
                }}
              >
                <Ionicons name="accessibility" size={22} color={theme.colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700" }}>無障礙路線</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>避開樓梯，優先使用電梯與坡道</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
            </Pressable>
          </View>
        </AnimatedCard>

        {nearbyFacilities.length > 0 && (
          <AnimatedCard title="附近設施" subtitle="500 公尺內" delay={300}>
            <View style={{ gap: 10 }}>
              {nearbyFacilities.map((facility) => (
                <Pressable
                  key={facility.id}
                  onPress={() => nav?.push?.("PoiDetail", { id: facility.id })}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: theme.colors.accentSoft,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Ionicons name="location" size={18} color={theme.colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{facility.name}</Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{facility.category}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
                      {facility.distance < 100 ? `${Math.round(facility.distance)}m` : `${(facility.distance / 1000).toFixed(1)}km`}
                    </Text>
                    <Pressable onPress={() => openInMaps(facility.lat, facility.lng, facility.name)}>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>導航</Text>
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </View>
          </AnimatedCard>
        )}

        {/* Reviews Section */}
        <AnimatedCard title={`評價 (${reviews.length})`} subtitle="幫助其他同學了解這個地點" delay={400}>
          {/* Write Review */}
          {!showReviewForm ? (
            <View style={{ marginBottom: 14 }}>
              {myReview ? (
                <View style={{ padding: 12, backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                    <Text style={{ color: theme.colors.success, fontSize: 13 }}>你已評價此地點</Text>
                  </View>
                </View>
              ) : (
                <View style={{ alignItems: "center", padding: 12 }}>
                  <Text style={{ color: theme.colors.muted, marginBottom: 10 }}>點擊星星評價</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Pressable key={star} onPress={() => handleRating(star)}>
                        <Ionicons 
                          name={star <= userRating ? "star" : "star-outline"} 
                          size={32} 
                          color="#F59E0B" 
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          ) : (
            <View style={{ gap: 14, marginBottom: 16, padding: 14, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md }}>
              {/* Rating */}
              <View style={{ alignItems: "center" }}>
                <Text style={{ color: theme.colors.muted, marginBottom: 10 }}>你的評分</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Pressable key={star} onPress={() => setUserRating(star)}>
                      <Ionicons 
                        name={star <= userRating ? "star" : "star-outline"} 
                        size={32} 
                        color="#F59E0B" 
                      />
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Tags */}
              <View>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>選擇標籤</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {REVIEW_TAGS.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <Pressable
                        key={tag}
                        onPress={() => toggleTag(tag)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 16,
                          backgroundColor: isSelected ? theme.colors.accent : theme.colors.surface,
                          borderWidth: 1,
                          borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                        }}
                      >
                        <Text style={{ color: isSelected ? "#fff" : theme.colors.text, fontSize: 12 }}>{tag}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Comment */}
              <TextInput
                value={userComment}
                onChangeText={setUserComment}
                placeholder="分享你對這個地點的看法..."
                placeholderTextColor={theme.colors.muted}
                multiline
                style={{
                  minHeight: 80,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  color: theme.colors.text,
                  textAlignVertical: "top",
                }}
              />

              {/* Buttons */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button 
                  text={submittingReview ? "送出中..." : "送出評價"} 
                  kind="primary" 
                  disabled={submittingReview || userRating === 0}
                  onPress={handleSubmitReview} 
                />
                <Button text="取消" onPress={() => { setShowReviewForm(false); setUserRating(0); setSelectedTags([]); setUserComment(""); }} />
              </View>
            </View>
          )}

          {/* Review List */}
          {reviews.length > 0 && (
            <View style={{ gap: 12, marginTop: 14 }}>
              <Divider text="用戶評價" />
              {reviews.slice(0, 5).map((review) => {
                const alreadyHelpful = auth.user && review.helpfulBy?.includes(auth.user.uid);
                return (
                  <View
                    key={review.id}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      {review.avatarUrl ? (
                        <Avatar name={review.displayName ?? "用戶"} size={32} imageUrl={review.avatarUrl} />
                      ) : (
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accentSoft, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
                            {(review.displayName ?? "用")[0]?.toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
                          {review.displayName ?? "匿名用戶"}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          {review.createdAt ? formatRelativeTime(toDate(review.createdAt)) : ""}
                        </Text>
                      </View>
                      <RatingStars rating={review.rating} size={12} />
                    </View>

                    {review.tags && review.tags.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                        {review.tags.map((tag) => (
                          <View key={tag} style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: theme.colors.surface, borderRadius: 8 }}>
                            <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {review.comment && (
                      <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{review.comment}</Text>
                    )}

                    <Pressable
                      onPress={() => auth.user && handleHelpful(review.id, !!alreadyHelpful)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 }}
                    >
                      <Ionicons 
                        name={alreadyHelpful ? "thumbs-up" : "thumbs-up-outline"} 
                        size={14} 
                        color={alreadyHelpful ? theme.colors.accent : theme.colors.muted} 
                      />
                      <Text style={{ color: alreadyHelpful ? theme.colors.accent : theme.colors.muted, fontSize: 12 }}>
                        有幫助{(review.helpful ?? 0) > 0 ? ` (${review.helpful})` : ""}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </AnimatedCard>

        {/* Report Issue */}
        <AnimatedCard title="回報問題" subtitle="幫助我們改善資訊" delay={450}>
          {!showReportForm ? (
            <Button text="回報此地點問題" kind="secondary" onPress={() => setShowReportForm(true)} />
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>問題類型</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["closed", "wrong_info", "accessibility", "safety", "other"] as const).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setReportType(type)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: theme.radius.sm,
                      backgroundColor: reportType === type ? theme.colors.accent : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: reportType === type ? theme.colors.accent : theme.colors.border,
                    }}
                  >
                    <Text style={{ color: reportType === type ? "#fff" : theme.colors.text, fontSize: 12 }}>
                      {getReportTypeLabel(type)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={reportDescription}
                onChangeText={setReportDescription}
                placeholder="請描述問題..."
                placeholderTextColor={theme.colors.muted}
                multiline
                style={{
                  minHeight: 80,
                  padding: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                  textAlignVertical: "top",
                }}
              />

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button text="送出回報" kind="primary" onPress={handleSubmitReport} />
                <Button text="取消" onPress={() => { setShowReportForm(false); setReportDescription(""); }} />
              </View>
            </View>
          )}
        </AnimatedCard>

        <AnimatedCard title="位置資訊" subtitle="座標詳情" delay={500}>
          <View style={{ gap: 4 }}>
            {typeof item.lat === "number" && (
              <InfoRow icon="location-outline" label="緯度" value={item.lat.toFixed(6)} />
            )}
            {typeof item.lng === "number" && (
              <InfoRow icon="location-outline" label="經度" value={item.lng.toFixed(6)} />
            )}
            <InfoRow icon="pricetag-outline" label="分類" value={item.category} />
          </View>
          {typeof item.lat === "number" && typeof item.lng === "number" && (
            <View style={{ marginTop: 12 }}>
              <Button
                text="在 Google Maps 開啟"
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`)}
              />
            </View>
          )}
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
