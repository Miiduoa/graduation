import React, { useState, useEffect, useCallback, useRef } from "react";
import { ScrollView, Text, View, Pressable, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { Screen, AnimatedCard, Card, Pill, SegmentedControl, SectionHeader, StatusBadge, Skeleton } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncStorage } from "../hooks/useStorage";
import { analytics } from "../services/analytics";
import { cancelNotification, scheduleLocalNotification } from "../services/notifications";
import type { BusRoute as DataBusRoute, BusArrival, BusScheduleItem } from "../data/types";

type BusRoute = {
  id: string;
  name: string;
  color: string;
  description: string;
  stops: BusStop[];
  frequency: string;
  operatingHours: string;
  scheduleTimes: {
    weekday: string[];
    weekend: string[];
  };
};

type BusStop = {
  id: string;
  name: string;
  arrivalTime?: number;
  isCurrentLocation?: boolean;
};

type BusVehicle = {
  id: string;
  routeId: string;
  currentStopId: string;
  nextStopId: string;
  crowdLevel: "low" | "medium" | "high" | "full";
  eta: number;
  plateNumber: string;
};

type ScheduleDayType = "weekday" | "weekend";

type BusReminder = {
  routeId: string;
  routeName: string;
  stopId: string;
  stopName: string;
  vehicleId: string;
  plateNumber: string;
  eta: number;
  notificationId: string;
  scheduledFor: string;
  createdAt: string;
};

const MOCK_ROUTES: BusRoute[] = [
  {
    id: "route1",
    name: "校園環線",
    color: theme.colors.accent,
    description: "連接主要校區建築",
    frequency: "每 10 分鐘一班",
    operatingHours: "07:00 - 22:00",
    scheduleTimes: {
      weekday: ["07:00", "07:10", "07:20", "07:30", "07:40", "07:50", "08:00", "08:10", "08:20", "08:30", "08:40", "08:50", "09:00", "09:10"],
      weekend: ["08:00", "08:20", "08:40", "09:00", "09:20", "09:40", "10:00", "10:20"],
    },
    stops: [
      { id: "s1", name: "校門口", arrivalTime: 2 },
      { id: "s2", name: "圖書館", arrivalTime: 5 },
      { id: "s3", name: "學生活動中心", arrivalTime: 8, isCurrentLocation: true },
      { id: "s4", name: "工程館", arrivalTime: 12 },
      { id: "s5", name: "理學院", arrivalTime: 15 },
      { id: "s6", name: "體育館", arrivalTime: 18 },
      { id: "s7", name: "宿舍區", arrivalTime: 22 },
    ],
  },
  {
    id: "route2",
    name: "火車站接駁",
    color: theme.colors.success,
    description: "往返火車站與校園",
    frequency: "每 15 分鐘一班",
    operatingHours: "06:30 - 23:00",
    scheduleTimes: {
      weekday: ["06:30", "06:45", "07:00", "07:15", "07:30", "07:45", "08:00", "08:15", "08:30", "08:45", "09:00", "09:15"],
      weekend: ["08:00", "08:20", "08:40", "09:00", "09:20", "09:40", "10:00"],
    },
    stops: [
      { id: "s8", name: "火車站", arrivalTime: 0 },
      { id: "s9", name: "校門口", arrivalTime: 10 },
      { id: "s10", name: "圖書館", arrivalTime: 15 },
    ],
  },
  {
    id: "route3",
    name: "宿舍專車",
    color: "#F59E0B",
    description: "連接各宿舍區域",
    frequency: "每 20 分鐘一班",
    operatingHours: "07:00 - 00:00",
    scheduleTimes: {
      weekday: ["07:00", "07:20", "07:40", "08:00", "08:20", "08:40", "09:00", "09:20", "09:40", "10:00"],
      weekend: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"],
    },
    stops: [
      { id: "s11", name: "男一舍", arrivalTime: 3 },
      { id: "s12", name: "女一舍", arrivalTime: 7 },
      { id: "s13", name: "研究生宿舍", arrivalTime: 12 },
      { id: "s14", name: "圖書館", arrivalTime: 18 },
    ],
  },
];

const MOCK_VEHICLES: BusVehicle[] = [
  { id: "v1", routeId: "route1", currentStopId: "s2", nextStopId: "s3", crowdLevel: "medium", eta: 3, plateNumber: "ABC-1234" },
  { id: "v2", routeId: "route1", currentStopId: "s5", nextStopId: "s6", crowdLevel: "low", eta: 8, plateNumber: "ABC-5678" },
  { id: "v3", routeId: "route2", currentStopId: "s8", nextStopId: "s9", crowdLevel: "high", eta: 5, plateNumber: "DEF-1111" },
  { id: "v4", routeId: "route3", currentStopId: "s11", nextStopId: "s12", crowdLevel: "low", eta: 2, plateNumber: "GHI-2222" },
];

function getCrowdLevelInfo(level: BusVehicle["crowdLevel"]) {
  const configs = {
    low: { color: theme.colors.success, text: "人少", icon: "person-outline" },
    medium: { color: "#F59E0B", text: "適中", icon: "people-outline" },
    high: { color: theme.colors.danger, text: "擁擠", icon: "people" },
    full: { color: "#7C3AED", text: "客滿", icon: "alert-circle" },
  };
  return configs[level];
}

function formatOperatingHours(route: DataBusRoute): string {
  const source = route.operatingHours ?? route.schedule;

  if (typeof source === "string") {
    return source;
  }

  if (Array.isArray(source)) {
    const departures = source
      .map((item) => item.departureTime)
      .filter((time): time is string => typeof time === "string" && time.length > 0);

    if (departures.length >= 2) {
      return `${departures[0]} - ${departures[departures.length - 1]}`;
    }

    return departures[0] ?? "07:00 - 22:00";
  }

  if (source && typeof source === "object") {
    const weekday = Array.isArray(source.weekday) ? source.weekday : [];
    const weekend = Array.isArray(source.weekend) ? source.weekend : [];
    const times = [...weekday, ...weekend].filter((time): time is string => typeof time === "string" && time.length > 0);

    if (times.length >= 2) {
      return `${times[0]} - ${times[times.length - 1]}`;
    }

    return times[0] ?? "07:00 - 22:00";
  }

  return "07:00 - 22:00";
}

function normalizeTimeValue(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return trimmed;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function parseTimeToMinutes(raw: string): number | null {
  const normalized = normalizeTimeValue(raw);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function formatMinutesToTime(totalMinutes: number): string {
  const safe = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseFrequencyMinutes(frequency: string): number | null {
  const match = frequency.match(/(\d+)/);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function getOperatingRange(route: BusRoute): { start: number; end: number } {
  const parts = route.operatingHours.split("-");
  const start = parseTimeToMinutes(parts[0] ?? "") ?? 7 * 60;
  const end = parseTimeToMinutes(parts[1] ?? "") ?? 22 * 60;
  return end > start ? { start, end } : { start, end: start + 12 * 60 };
}

function buildFallbackScheduleTimes(route: BusRoute): { weekday: string[]; weekend: string[] } {
  const interval = parseFrequencyMinutes(route.frequency) ?? 15;
  const { start, end } = getOperatingRange(route);
  const weekday: string[] = [];
  const weekend: string[] = [];

  for (let mins = start; mins <= end; mins += interval) {
    const label = formatMinutesToTime(mins);
    weekday.push(label);
    if (weekday.length % 2 === 1) {
      weekend.push(label);
    }
  }

  return {
    weekday,
    weekend: weekend.length > 0 ? weekend : weekday.filter((_, index) => index % 2 === 0),
  };
}

function normalizeScheduleTimes(route: DataBusRoute): { weekday: string[]; weekend: string[] } {
  if (Array.isArray(route.schedule)) {
    const weekday = route.schedule
      .filter((item: BusScheduleItem) => !item.isWeekendOnly)
      .map((item: BusScheduleItem) => normalizeTimeValue(item.departureTime));
    const weekend = route.schedule
      .filter((item: BusScheduleItem) => !item.isWeekdayOnly)
      .map((item: BusScheduleItem) => normalizeTimeValue(item.departureTime));

    return {
      weekday: weekday.length > 0 ? weekday : weekend,
      weekend: weekend.length > 0 ? weekend : weekday,
    };
  }

  if (route.schedule && typeof route.schedule === "object") {
    const weekday = Array.isArray(route.schedule.weekday) ? route.schedule.weekday.map(normalizeTimeValue) : [];
    const weekend = Array.isArray(route.schedule.weekend) ? route.schedule.weekend.map(normalizeTimeValue) : [];
    return {
      weekday: weekday.length > 0 ? weekday : weekend,
      weekend: weekend.length > 0 ? weekend : weekday,
    };
  }

  return { weekday: [], weekend: [] };
}

export function BusScheduleScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const ds = useDataSource();
  
  const [selectedRoute, setSelectedRoute] = useState<string>("route1");
  const [viewMode, setViewMode] = useState<"realtime" | "schedule">("realtime");
  const [scheduleDayType, setScheduleDayType] = useState<ScheduleDayType>(
    new Date().getDay() === 0 || new Date().getDay() === 6 ? "weekend" : "weekday"
  );
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [vehicles, setVehicles] = useState<BusVehicle[]>([]);
  const [storedFavorites, setStoredFavorites] = useAsyncStorage<string[]>("bus_favorite_stops", {
    defaultValue: ["s3", "s2"],
  });
  const [storedReminders, setStoredReminders] = useAsyncStorage<BusReminder[]>("bus_reminders", {
    defaultValue: [],
  });
  const [favoriteStops, setFavoriteStops] = useState<string[]>(storedFavorites ?? ["s3", "s2"]);
  const [reminders, setReminders] = useState<BusReminder[]>(storedReminders ?? []);
  const [arrivalsMap, setArrivalsMap] = useState<Map<string, BusArrival[]>>(new Map());
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (storedFavorites) {
      setFavoriteStops(storedFavorites);
    }
  }, [storedFavorites]);

  useEffect(() => {
    setReminders(storedReminders ?? []);
  }, [storedReminders]);

  const loadArrivals = useCallback(async (stopIds: string[]) => {
    const map = new Map<string, BusArrival[]>();
    try {
      await Promise.all(
        stopIds.map(async (stopId) => {
          const arrivals = await ds.getBusArrivals(stopId);
          map.set(stopId, arrivals);
        })
      );
      setArrivalsMap(map);
    } catch (error) {
      console.warn("Failed to load arrivals:", error);
    }
    return map;
  }, [ds]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      analytics.logScreenView("BusSchedule");
      
      const dataRoutes = await ds.listBusRoutes(school.id);
      if (dataRoutes && dataRoutes.length > 0) {
        const converted: BusRoute[] = dataRoutes.map((r: DataBusRoute) => ({
          id: r.id,
          name: r.name,
          color: (r as any).color ?? theme.colors.accent,
          description: r.description ?? "",
          stops: (r.stops ?? []).map((s: any, idx: number) => ({
            id: s.id ?? `s${idx}`,
            name: s.name,
            arrivalTime: s.arrivalTime,
            isCurrentLocation: s.isCurrentLocation ?? false,
          })),
          frequency: (r as any).frequency ?? "每 10 分鐘一班",
          operatingHours: formatOperatingHours(r),
          scheduleTimes: normalizeScheduleTimes(r),
        }));
        setRoutes(converted);
        if (converted.length > 0) {
          setSelectedRoute(converted[0].id);
        }
        
        const allStopIds = converted.flatMap(r => r.stops.map(s => s.id));
        const latestArrivals = await loadArrivals(allStopIds);
        
        const vehiclesFromArrivals: BusVehicle[] = [];
        latestArrivals.forEach((arrivals, stopId) => {
          arrivals.forEach((arrival) => {
            const vehicleId = arrival.vehicleId ?? arrival.busId ?? `v-${arrival.routeId}-${stopId}`;
            if (!vehiclesFromArrivals.find(v => v.id === vehicleId)) {
              vehiclesFromArrivals.push({
                id: vehicleId,
                routeId: arrival.routeId,
                currentStopId: stopId,
                nextStopId: stopId,
                crowdLevel: arrival.isDelayed ? "high" : "medium",
                eta: typeof (arrival as any).estimatedMinutes === "number" 
                  ? (arrival as any).estimatedMinutes 
                  : Math.max(0, Math.round((new Date(arrival.estimatedArrival ?? Date.now()).getTime() - Date.now()) / 60000)),
                plateNumber: arrival.vehicleId ?? arrival.busId ?? "未知",
              });
            }
          });
        });
        
        setVehicles(vehiclesFromArrivals.length > 0 ? vehiclesFromArrivals : MOCK_VEHICLES);
      } else {
        setRoutes(MOCK_ROUTES);
        setVehicles(MOCK_VEHICLES);
      }
    } catch (error) {
      console.warn("Failed to load bus routes:", error);
      setRoutes(MOCK_ROUTES);
      setVehicles(MOCK_VEHICLES);
    } finally {
      setLoading(false);
    }
  }, [ds, school.id, loadArrivals]);

  useEffect(() => {
    loadData();
    
    refreshIntervalRef.current = setInterval(() => {
      if (routes.length > 0) {
        const allStopIds = routes.flatMap(r => r.stops.map(s => s.id));
        loadArrivals(allStopIds);
      }
    }, 30000);
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [loadData, routes, loadArrivals]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
    } catch (error) {
      console.warn("Failed to refresh:", error);
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const toggleFavoriteStop = (stopId: string) => {
    setFavoriteStops((prev) => {
      const newFavorites = prev.includes(stopId) ? prev.filter((id) => id !== stopId) : [...prev, stopId];
      setStoredFavorites(newFavorites);
      analytics.logEvent("bus_favorite_toggle", { stop_id: stopId, action: prev.includes(stopId) ? "remove" : "add" });
      return newFavorites;
    });
  };

  const handleCancelReminder = useCallback(async (reminder: BusReminder) => {
    try {
      await cancelNotification(reminder.notificationId);
    } catch (error) {
      console.warn("Failed to cancel bus reminder:", error);
    } finally {
      const nextReminders = reminders.filter((item) => item.notificationId !== reminder.notificationId);
      setReminders(nextReminders);
      await setStoredReminders(nextReminders);
      analytics.logEvent("bus_reminder_cancelled", {
        route_id: reminder.routeId,
        vehicle_id: reminder.vehicleId,
        stop_id: reminder.stopId,
      });
      Alert.alert("已取消", `${reminder.routeName} 到 ${reminder.stopName} 的提醒已取消`);
    }
  }, [reminders, setStoredReminders]);

  const handleScheduleReminder = useCallback(async (route: BusRoute, vehicle: BusVehicle) => {
    const nextStop = route.stops.find((stop) => stop.id === vehicle.nextStopId);
    if (!nextStop) {
      Alert.alert("無法設定提醒", "目前找不到此車輛的下一站資訊");
      return;
    }

    const triggerSeconds = Math.max(vehicle.eta * 60 - 60, 5);

    try {
      const notificationId = await scheduleLocalNotification(
        `${route.name} 即將到站`,
        `${vehicle.plateNumber} 即將抵達 ${nextStop.name}，請準備上車`,
        {
          type: "bus",
          routeId: route.id,
          stopId: nextStop.id,
          vehicleId: vehicle.id,
        },
        {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: triggerSeconds,
          repeats: false,
        }
      );

      const scheduledFor = new Date(Date.now() + triggerSeconds * 1000).toISOString();
      const nextReminder: BusReminder = {
        routeId: route.id,
        routeName: route.name,
        stopId: nextStop.id,
        stopName: nextStop.name,
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        eta: vehicle.eta,
        notificationId,
        scheduledFor,
        createdAt: new Date().toISOString(),
      };
      const filtered = reminders.filter(
        (item) =>
          !(
            item.routeId === nextReminder.routeId &&
            item.vehicleId === nextReminder.vehicleId &&
            item.stopId === nextReminder.stopId
          )
      );
      const nextReminders = [...filtered, nextReminder];

      setReminders(nextReminders);
      await setStoredReminders(nextReminders);
      analytics.logEvent("bus_reminder_set", { route_id: route.id, vehicle_id: vehicle.id, stop_id: nextStop.id });
      Alert.alert(
        "提醒已設定",
        `${route.name} (${vehicle.plateNumber}) 將在接近 ${nextStop.name} 前 1 分鐘通知你`
      );
    } catch (error) {
      console.warn("Failed to schedule bus reminder:", error);
      Alert.alert("設定失敗", "無法建立到站提醒，請確認通知權限已開啟");
    }
  }, [reminders, setStoredReminders]);

  const handleSetReminder = (route: BusRoute, vehicle: BusVehicle) => {
    const nextStop = route.stops.find((stop) => stop.id === vehicle.nextStopId);
    const existingReminder = reminders.find(
      (item) =>
        item.routeId === route.id &&
        item.vehicleId === vehicle.id &&
        item.stopId === vehicle.nextStopId
    );

    Alert.alert(
      existingReminder ? "已設定到站提醒" : "設定到站提醒",
      existingReminder
        ? `${route.name} (${vehicle.plateNumber}) 前往 ${existingReminder.stopName} 的提醒已排程於 ${new Date(existingReminder.scheduledFor).toLocaleTimeString()}`
        : `當 ${route.name} (${vehicle.plateNumber}) 即將抵達 ${nextStop?.name ?? "下一站"} 時通知您`,
      [
        { text: "取消", style: "cancel" },
        existingReminder
          ? {
              text: "取消提醒",
              style: "destructive",
              onPress: () => {
                void handleCancelReminder(existingReminder);
              },
            }
          : {
              text: "設定",
              onPress: () => {
                void handleScheduleReminder(route, vehicle);
              },
            },
      ]
    );
  };

  const currentRoute = routes.find((r) => r.id === selectedRoute);
  const routeVehicles = vehicles.filter((v) => v.routeId === selectedRoute);
  const scheduleTimes = currentRoute
    ? (currentRoute.scheduleTimes[scheduleDayType].length > 0
        ? currentRoute.scheduleTimes[scheduleDayType]
        : buildFallbackScheduleTimes(currentRoute)[scheduleDayType])
    : [];
  const visibleScheduleTimes = showFullSchedule ? scheduleTimes : scheduleTimes.slice(0, 10);

  useEffect(() => {
    setShowFullSchedule(false);
  }, [selectedRoute, scheduleDayType]);

  if (loading) {
    return (
      <Screen>
        <View style={{ gap: 16, paddingTop: 8 }}>
          <Skeleton height={60} borderRadius={theme.radius.md} />
          <Skeleton height={200} borderRadius={theme.radius.lg} />
          <Skeleton height={150} borderRadius={theme.radius.lg} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
      >
        <SegmentedControl
          options={[
            { key: "realtime", label: "即時動態" },
            { key: "schedule", label: "時刻表" },
          ]}
          selected={viewMode}
          onChange={(k) => setViewMode(k as "realtime" | "schedule")}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {routes.map((route) => (
            <Pressable
              key={route.id}
              onPress={() => setSelectedRoute(route.id)}
              style={({ pressed }) => ({
                paddingHorizontal: 18,
                paddingVertical: 12,
                borderRadius: theme.radius.lg,
                borderWidth: 2,
                borderColor: selectedRoute === route.id ? route.color : theme.colors.border,
                backgroundColor: selectedRoute === route.id ? `${route.color}15` : pressed ? "rgba(255,255,255,0.04)" : theme.colors.surface2,
                minWidth: 120,
                alignItems: "center",
              })}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: route.color,
                  marginBottom: 8,
                }}
              />
              <Text
                style={{
                  color: selectedRoute === route.id ? route.color : theme.colors.text,
                  fontWeight: "700",
                  fontSize: 14,
                }}
              >
                {route.name}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>{route.frequency}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {currentRoute && viewMode === "realtime" && (
          <>
            <AnimatedCard title="路線資訊" subtitle={currentRoute.description}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pill text={currentRoute.operatingHours} kind="accent" />
                <Pill text={currentRoute.frequency} />
              </View>
            </AnimatedCard>

            {routeVehicles.length > 0 && (
              <AnimatedCard title="即將到站" subtitle="點擊設定到站提醒" delay={100}>
                <View style={{ gap: 12 }}>
                  {routeVehicles.map((vehicle) => {
                    const crowdInfo = getCrowdLevelInfo(vehicle.crowdLevel);
                    const nextStop = currentRoute.stops.find((s) => s.id === vehicle.nextStopId);
                    const hasReminder = reminders.some(
                      (item) =>
                        item.routeId === currentRoute.id &&
                        item.vehicleId === vehicle.id &&
                        item.stopId === vehicle.nextStopId
                    );
                    return (
                      <Pressable
                        key={vehicle.id}
                        onPress={() => handleSetReminder(currentRoute, vehicle)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 14,
                          borderRadius: theme.radius.lg,
                          backgroundColor: pressed ? "rgba(255,255,255,0.06)" : theme.colors.surface2,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          gap: 14,
                        })}
                      >
                        <View
                          style={{
                            width: 50,
                            height: 50,
                            borderRadius: 25,
                            backgroundColor: theme.colors.accentSoft,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="bus" size={24} color={theme.colors.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                              {vehicle.plateNumber}
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 4,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                                borderRadius: 999,
                                backgroundColor: `${crowdInfo.color}20`,
                              }}
                            >
                              <Ionicons name={crowdInfo.icon as any} size={12} color={crowdInfo.color} />
                              <Text style={{ color: crowdInfo.color, fontSize: 11, fontWeight: "600" }}>
                                {crowdInfo.text}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                            下一站：{nextStop?.name ?? "未知"}
                          </Text>
                          {hasReminder && (
                            <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4, fontWeight: "600" }}>
                              已設定提醒
                            </Text>
                          )}
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>
                            {vehicle.eta}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>分鐘</Text>
                        </View>
                        <Ionicons
                          name={hasReminder ? "notifications" : "notifications-outline"}
                          size={20}
                          color={hasReminder ? theme.colors.accent : theme.colors.muted}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </AnimatedCard>
            )}

            <AnimatedCard title="站點列表" subtitle={`共 ${currentRoute.stops.length} 站`} delay={200}>
              <View style={{ position: "relative" }}>
                <View
                  style={{
                    position: "absolute",
                    left: 15,
                    top: 20,
                    bottom: 20,
                    width: 3,
                    backgroundColor: currentRoute.color,
                    opacity: 0.3,
                  }}
                />
                <View style={{ gap: 6 }}>
                  {currentRoute.stops.map((stop, idx) => {
                    const isFavorite = favoriteStops.includes(stop.id);
                    const hasVehicle = routeVehicles.some((v) => v.currentStopId === stop.id);
                    return (
                      <Pressable
                        key={stop.id}
                        onPress={() => toggleFavoriteStop(stop.id)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          borderRadius: theme.radius.md,
                          backgroundColor: pressed
                            ? "rgba(255,255,255,0.06)"
                            : stop.isCurrentLocation
                              ? theme.colors.accentSoft
                              : "transparent",
                          gap: 12,
                        })}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: hasVehicle ? currentRoute.color : theme.colors.surface2,
                            borderWidth: 3,
                            borderColor: currentRoute.color,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {hasVehicle && <Ionicons name="bus" size={12} color="#fff" />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{stop.name}</Text>
                            {stop.isCurrentLocation && (
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                  backgroundColor: theme.colors.accent,
                                }}
                              >
                                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>目前位置</Text>
                              </View>
                            )}
                          </View>
                          {stop.arrivalTime !== undefined && (
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              約 {stop.arrivalTime} 分鐘後到達
                            </Text>
                          )}
                        </View>
                        <Pressable onPress={() => toggleFavoriteStop(stop.id)}>
                          <Ionicons
                            name={isFavorite ? "star" : "star-outline"}
                            size={20}
                            color={isFavorite ? "#F59E0B" : theme.colors.muted}
                          />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </AnimatedCard>
          </>
        )}

        {currentRoute && viewMode === "schedule" && (
          <AnimatedCard title="發車時刻表" subtitle={`${currentRoute.name} - ${currentRoute.operatingHours}`}>
            <SegmentedControl
              options={[
                { key: "weekday", label: "平日" },
                { key: "weekend", label: "假日" },
              ]}
              selected={scheduleDayType}
              onChange={(value) => setScheduleDayType(value as ScheduleDayType)}
            />
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text style={{ flex: 1, color: theme.colors.muted, fontWeight: "600", fontSize: 13 }}>發車時間</Text>
                <Text style={{ flex: 1, color: theme.colors.muted, fontWeight: "600", fontSize: 13, textAlign: "center" }}>起點站</Text>
                <Text style={{ flex: 1, color: theme.colors.muted, fontWeight: "600", fontSize: 13, textAlign: "right" }}>終點站</Text>
              </View>
              {visibleScheduleTimes.map((time) => {
                const scheduleMinute = parseTimeToMinutes(time);
                const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
                const isNext = scheduleMinute !== null && scheduleMinute >= nowMinutes && !visibleScheduleTimes.some((other) => {
                  const otherMinutes = parseTimeToMinutes(other);
                  return other !== time && otherMinutes !== null && otherMinutes >= nowMinutes && otherMinutes < scheduleMinute;
                });
                return (
                  <View
                    key={time}
                    style={{
                      flexDirection: "row",
                      paddingVertical: 12,
                      paddingHorizontal: 8,
                      borderRadius: theme.radius.sm,
                      backgroundColor: isNext ? theme.colors.accentSoft : "transparent",
                    }}
                  >
                    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text
                        style={{
                          color: isNext ? theme.colors.accent : theme.colors.text,
                          fontWeight: isNext ? "700" : "500",
                          fontSize: 15,
                        }}
                      >
                        {time}
                      </Text>
                      {isNext && (
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 4,
                            backgroundColor: theme.colors.accent,
                          }}
                        >
                          <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>下一班</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ flex: 1, color: theme.colors.muted, fontSize: 13, textAlign: "center" }}>
                      {currentRoute.stops[0]?.name}
                    </Text>
                    <Text style={{ flex: 1, color: theme.colors.muted, fontSize: 13, textAlign: "right" }}>
                      {currentRoute.stops[currentRoute.stops.length - 1]?.name}
                    </Text>
                  </View>
                );
              })}
              {visibleScheduleTimes.length === 0 && (
                <View style={{ paddingVertical: 20, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.muted }}>目前沒有可用的時刻表資料</Text>
                </View>
              )}
            </View>
            {scheduleTimes.length > 10 && (
              <Pressable
                onPress={() => setShowFullSchedule((prev) => !prev)}
                style={{
                  marginTop: 12,
                  alignItems: "center",
                  paddingVertical: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>
                  {showFullSchedule ? "收合時刻表" : `查看完整時刻表（共 ${scheduleTimes.length} 班）`}
                </Text>
              </Pressable>
            )}
          </AnimatedCard>
        )}

        {favoriteStops.length > 0 && (
          <AnimatedCard title="我的常用站點" subtitle="快速查看常搭乘的站點" delay={300}>
            <View style={{ gap: 10 }}>
              {favoriteStops.map((stopId) => {
                const allStops = routes.flatMap((r) => r.stops.map((s) => ({ ...s, route: r })));
                const stop = allStops.find((s) => s.id === stopId);
                if (!stop) return null;
                const vehicle = vehicles.find((v) => v.routeId === stop.route.id);
                return (
                  <View
                    key={stopId}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 40,
                        borderRadius: 4,
                        backgroundColor: stop.route.color,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{stop.name}</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{stop.route.name}</Text>
                    </View>
                    {vehicle && (
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>{vehicle.eta} 分鐘</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>下一班</Text>
                      </View>
                    )}
                    <Ionicons name="star" size={18} color="#F59E0B" />
                  </View>
                );
              })}
            </View>
          </AnimatedCard>
        )}
      </ScrollView>
    </Screen>
  );
}
