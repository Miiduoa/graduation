/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ScrollView, Text, View, Pressable, Alert, RefreshControl, Share } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, AnimatedCard, Button, Pill, SegmentedControl, EmptyListPlaceholder, Spinner } from "../ui/components";
import { useAuth } from "../state/auth";
import { useSchedule } from "../state/schedule";
import { useSchool } from "../state/school";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { analytics } from "../services/analytics";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";

type ViewMode = "week" | "day" | "list";

type CourseSlot = {
  id: string;
  name: string;
  teacher: string;
  location: string;
  dayOfWeek: number;
  startPeriod: number;
  endPeriod: number;
  color: string;
  courseCode?: string;
  credits?: number;
};

type CampusPoi = {
  id: string;
  name: string;
  description?: string;
  building?: string;
};

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const WEEKDAYS_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const PERIODS = [
  { period: 1, time: "08:10-09:00" },
  { period: 2, time: "09:10-10:00" },
  { period: 3, time: "10:10-11:00" },
  { period: 4, time: "11:10-12:00" },
  { period: 5, time: "12:10-13:00" },
  { period: 6, time: "13:10-14:00" },
  { period: 7, time: "14:10-15:00" },
  { period: 8, time: "15:10-16:00" },
  { period: 9, time: "16:10-17:00" },
  { period: 10, time: "17:10-18:00" },
  { period: 11, time: "18:30-19:20" },
  { period: 12, time: "19:25-20:15" },
  { period: 13, time: "20:20-21:10" },
];

const COURSE_COLORS = [
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#3B82F6",
  "#EF4444",
  "#6366F1",
  "#14B8A6",
];

// 通用示範課表 — 僅在未登入時顯示，登入後會被使用者真實課表取代
// 使用靜宜大學建築代碼 (PH=主顧樓, AK=任垣樓, SF=方濟樓, SP=伯鐸樓, etc.)
const MOCK_COURSES: CourseSlot[] = [
  { id: "demo-1", name: "程式設計", teacher: "王老師", location: "PH303", dayOfWeek: 1, startPeriod: 2, endPeriod: 4, color: COURSE_COLORS[0], courseCode: "DEMO", credits: 3 },
  { id: "demo-2", name: "微積分", teacher: "李老師", location: "PH217", dayOfWeek: 2, startPeriod: 3, endPeriod: 4, color: COURSE_COLORS[1], courseCode: "DEMO", credits: 3 },
  { id: "demo-3", name: "英文(一)", teacher: "林老師", location: "SP201", dayOfWeek: 3, startPeriod: 2, endPeriod: 3, color: COURSE_COLORS[2], courseCode: "DEMO", credits: 2 },
  { id: "demo-4", name: "通識講座", teacher: "陳老師", location: "SF101", dayOfWeek: 4, startPeriod: 5, endPeriod: 6, color: COURSE_COLORS[3], courseCode: "DEMO", credits: 2 },
  { id: "demo-5", name: "體育", teacher: "體育室", location: "ST", dayOfWeek: 5, startPeriod: 3, endPeriod: 4, color: COURSE_COLORS[4], courseCode: "DEMO", credits: 0 },
];

function getCurrentPeriod(): number {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const time = hour * 60 + minute;

  for (let i = 0; i < PERIODS.length; i++) {
    const [start] = PERIODS[i].time.split("-");
    const [endHour, endMin] = start.split(":").map(Number);
    const periodStart = endHour * 60 + endMin;
    const periodEnd = periodStart + 50;
    if (time >= periodStart && time < periodEnd + 10) {
      return i + 1;
    }
  }
  return 0;
}

function timeToperiod(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute;
  
  for (let i = 0; i < PERIODS.length; i++) {
    const [start] = PERIODS[i].time.split("-");
    const [startHour, startMin] = start.split(":").map(Number);
    const periodStart = startHour * 60 + startMin;
    
    if (Math.abs(totalMinutes - periodStart) < 30) {
      return i + 1;
    }
  }
  
  if (totalMinutes < 8 * 60 + 10) return 1;
  if (totalMinutes > 21 * 60) return 13;
  
  return Math.floor((totalMinutes - 8 * 60) / 60) + 1;
}

function normalizeLocationText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[()（）【】[\]，,。．.]/g, " ")
    .replace(/\s+/g, "");
}

function stripRoomFromLocation(value: string): string {
  return value
    .replace(/\s+\d+[A-Za-z-]*$/u, "")
    .replace(/[A-Za-z]棟?\s*\d+$/u, "")
    .trim();
}

function findMatchingPoi(location: string, pois: CampusPoi[]): CampusPoi | null {
  const normalizedLocation = normalizeLocationText(location);
  const strippedLocation = normalizeLocationText(stripRoomFromLocation(location));

  if (!normalizedLocation) return null;

  let bestMatch: { poi: CampusPoi; score: number } | null = null;

  for (const poi of pois) {
    const candidates = [poi.name, poi.building, poi.description].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeLocationText(candidate);
      if (!normalizedCandidate) continue;

      let score = 0;
      if (normalizedCandidate === normalizedLocation) {
        score = 100;
      } else if (normalizedCandidate === strippedLocation) {
        score = 95;
      } else if (normalizedLocation.includes(normalizedCandidate)) {
        score = normalizedCandidate === normalizeLocationText(poi.name) ? 88 : 80;
      } else if (normalizedCandidate.includes(normalizedLocation)) {
        score = 76;
      } else if (strippedLocation && normalizedCandidate.includes(strippedLocation)) {
        score = 72;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { poi, score };
      }
    }
  }

  return bestMatch && bestMatch.score >= 70 ? bestMatch.poi : null;
}

export function CourseScheduleScreen(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const auth = useAuth();
  const schedule = useSchedule();
  const { school } = useSchool();
  const ds = useDataSource();
  const { items: campusPois } = useAsyncList<CampusPoi>(() => ds.listPois(school.id), [ds, school.id], {
    keepPreviousData: true,
  });

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() || 1);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    analytics.logScreenView("CourseSchedule");
  }, []);

  const courses = useMemo((): CourseSlot[] => {
    if (schedule.courses.length === 0) {
      return MOCK_COURSES;
    }
    
    return schedule.courses.flatMap((course, courseIndex) => {
      return course.schedule.map((sched, schedIndex) => ({
        id: `${course.id}_${schedIndex}`,
        name: course.name,
        teacher: course.instructor,
        location: sched.location || "待定",
        dayOfWeek: sched.dayOfWeek,
        startPeriod: timeToperiod(sched.startTime),
        endPeriod: timeToperiod(sched.endTime),
        color: COURSE_COLORS[courseIndex % COURSE_COLORS.length],
        courseCode: course.code,
        credits: course.credits,
      }));
    });
  }, [schedule.courses]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await schedule.refreshSchedule();
    } finally {
      setRefreshing(false);
    }
  }, [schedule]);

  const today = new Date().getDay();
  const currentPeriod = getCurrentPeriod();

  const totalCredits = useMemo(() => {
    return courses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
  }, [courses]);

  const todayCourses = useMemo(() => {
    return courses.filter((c) => c.dayOfWeek === today).sort((a, b) => a.startPeriod - b.startPeriod);
  }, [courses, today]);

  const nextCourse = useMemo(() => {
    if (today === 0 || today === 6) return null;
    return todayCourses.find((c) => c.startPeriod > currentPeriod) ?? null;
  }, [todayCourses, currentPeriod]);

  const handleCoursePress = (course: CourseSlot) => {
    const matchedPoi = findMatchingPoi(course.location, campusPois);
    Alert.alert(
      course.name,
      `授課教師：${course.teacher}\n地點：${course.location}\n時間：${WEEKDAYS[course.dayOfWeek]} 第 ${course.startPeriod}-${course.endPeriod} 節\n課程代碼：${course.courseCode ?? "-"}\n學分：${course.credits ?? "-"}${matchedPoi ? `\n對應地點：${matchedPoi.name}` : ""}`,
      [
        { text: "關閉" },
        { text: "前往教室", onPress: () => handleNavigateToCourseLocation(course) },
      ]
    );
  };

  const handleNavigateToCourseLocation = useCallback((course: CourseSlot) => {
    const location = course.location?.trim();
    if (!location || location === "待定") {
      Alert.alert("尚未設定教室", "這門課目前還沒有可導航的地點資訊");
      return;
    }

    const matchedPoi = findMatchingPoi(location, campusPois);
    const rootNavigation = nav?.getParent?.();

    if (matchedPoi) {
      if (rootNavigation?.navigate) {
        rootNavigation.navigate("校園", { screen: "PoiDetail", params: { id: matchedPoi.id } });
      } else {
        nav?.navigate?.("PoiDetail", { id: matchedPoi.id });
      }
      analytics.logEvent("course_location_navigation", {
        location,
        poi_id: matchedPoi.id,
        matched: true,
      });
      return;
    }

    Alert.alert(
      "找不到精確地點",
      `目前無法直接定位「${location}」，已可改為開啟校園地圖自行搜尋。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "開啟地圖",
          onPress: () => {
            if (rootNavigation?.navigate) {
              rootNavigation.navigate("校園", { screen: "Map" });
            }
            analytics.logEvent("course_location_navigation", {
              location,
              matched: false,
            });
          },
        },
      ]
    );
  }, [campusPois, nav]);

  const handleAddCourse = () => {
    nav?.navigate?.("AddCourse");
  };

  const renderWeekView = () => {
    const displayDays = [1, 2, 3, 4, 5];
    const displayPeriods = PERIODS.slice(0, 10);

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 50, height: 40, justifyContent: "center", alignItems: "center" }}>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>節次</Text>
            </View>
            {displayDays.map((day) => (
              <View
                key={day}
                style={{
                  width: 65,
                  height: 40,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: day === today ? theme.colors.accentSoft : "transparent",
                  borderRadius: theme.radius.sm,
                }}
              >
                <Text
                  style={{
                    color: day === today ? theme.colors.accent : theme.colors.text,
                    fontWeight: day === today ? "700" : "500",
                    fontSize: 13,
                  }}
                >
                  {WEEKDAYS_SHORT[day]}
                </Text>
              </View>
            ))}
          </View>

          {displayPeriods.map((p) => (
            <View key={p.period} style={{ flexDirection: "row", height: 50 }}>
              <View
                style={{
                  width: 50,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: p.period === currentPeriod ? `${theme.colors.accent}20` : "transparent",
                  borderRadius: theme.radius.sm,
                }}
              >
                <Text
                  style={{
                    color: p.period === currentPeriod ? theme.colors.accent : theme.colors.muted,
                    fontSize: 12,
                    fontWeight: p.period === currentPeriod ? "700" : "500",
                  }}
                >
                  {p.period}
                </Text>
              </View>
              {displayDays.map((day) => {
                const course = courses.find(
                  (c) => c.dayOfWeek === day && p.period >= c.startPeriod && p.period <= c.endPeriod
                );
                const isStart = course?.startPeriod === p.period;

                if (course && isStart) {
                  const height = (course.endPeriod - course.startPeriod + 1) * 50 - 4;
                  return (
                    <Pressable
                      key={`${day}-${p.period}`}
                      onPress={() => handleCoursePress(course)}
                      style={{
                        width: 63,
                        height,
                        marginHorizontal: 1,
                        padding: 4,
                        borderRadius: theme.radius.sm,
                        backgroundColor: course.color,
                        overflow: "hidden",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 10 }} numberOfLines={2}>
                        {course.name}
                      </Text>
                      <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                        {course.location}
                      </Text>
                    </Pressable>
                  );
                } else if (course) {
                  return <View key={`${day}-${p.period}`} style={{ width: 65 }} />;
                }

                return (
                  <View
                    key={`${day}-${p.period}`}
                    style={{
                      width: 63,
                      height: 46,
                      marginHorizontal: 1,
                      marginVertical: 2,
                      borderRadius: theme.radius.sm,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      borderStyle: "dashed",
                    }}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  const renderDayView = () => {
    const dayCourses = courses
      .filter((c) => c.dayOfWeek === selectedDay)
      .sort((a, b) => a.startPeriod - b.startPeriod);

    return (
      <View style={{ gap: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[1, 2, 3, 4, 5].map((day) => (
            <Pressable
              key={day}
              onPress={() => setSelectedDay(day)}
              style={({ pressed }) => ({
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selectedDay === day ? theme.colors.accent : theme.colors.border,
                backgroundColor:
                  selectedDay === day
                    ? theme.colors.accentSoft
                    : day === today
                      ? `${theme.colors.accent}10`
                      : pressed
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
              })}
            >
              <Text
                style={{
                  color: selectedDay === day ? theme.colors.accent : day === today ? theme.colors.accent : theme.colors.text,
                  fontWeight: selectedDay === day || day === today ? "700" : "500",
                  fontSize: 14,
                }}
              >
                {WEEKDAYS[day]}
                {day === today && " (今天)"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {dayCourses.length === 0 ? (
          <EmptyListPlaceholder
            icon="calendar-outline"
            title={`${WEEKDAYS[selectedDay]}沒有課程`}
            subtitle="享受你的休息時間吧！"
          />
        ) : (
          <View style={{ gap: 12 }}>
            {dayCourses.map((course) => (
              <Pressable
                key={course.id}
                onPress={() => handleCoursePress(course)}
                style={{
                  flexDirection: "row",
                  padding: 16,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: course.color,
                  gap: 14,
                }}
              >
                <View style={{ alignItems: "center", minWidth: 50 }}>
                  <Text style={{ color: course.color, fontWeight: "900", fontSize: 18 }}>
                    {course.startPeriod}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                    {PERIODS[course.startPeriod - 1]?.time.split("-")[0]}
                  </Text>
                  {course.endPeriod > course.startPeriod && (
                    <>
                      <Text style={{ color: theme.colors.muted, fontSize: 10 }}>~</Text>
                      <Text style={{ color: course.color, fontWeight: "700", fontSize: 14 }}>
                        {course.endPeriod}
                      </Text>
                    </>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>{course.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <Ionicons name="person-outline" size={12} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{course.teacher}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Ionicons name="location-outline" size={12} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{course.location}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderListView = () => {
    const groupedCourses = courses.reduce(
      (acc, course) => {
        if (!acc[course.dayOfWeek]) acc[course.dayOfWeek] = [];
        acc[course.dayOfWeek].push(course);
        return acc;
      },
      {} as Record<number, CourseSlot[]>
    );

    return (
      <View style={{ gap: 16 }}>
        {[1, 2, 3, 4, 5].map((day) => {
          const dayCourses = groupedCourses[day] ?? [];
          if (dayCourses.length === 0) return null;

          return (
            <View key={day}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Text style={{ color: day === today ? theme.colors.accent : theme.colors.text, fontWeight: "800", fontSize: 15 }}>
                  {WEEKDAYS[day]}
                </Text>
                {day === today && <Pill text="今天" kind="accent" />}
                <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border, marginLeft: 8 }} />
              </View>
              <View style={{ gap: 10 }}>
                {dayCourses
                  .sort((a, b) => a.startPeriod - b.startPeriod)
                  .map((course) => (
                    <Pressable
                      key={course.id}
                      onPress={() => handleCoursePress(course)}
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
                          backgroundColor: course.color,
                        }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{course.name}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          第 {course.startPeriod}-{course.endPeriod} 節 · {course.location}
                        </Text>
                      </View>
                      <Text style={{ color: course.color, fontWeight: "700", fontSize: 12 }}>
                        {course.credits ?? 0} 學分
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const handleShareSchedule = useCallback(async () => {
    try {
      const scheduleText = courses.map(c => 
        `${WEEKDAYS[c.dayOfWeek]} 第${c.startPeriod}-${c.endPeriod}節: ${c.name} (${c.location})`
      ).join("\n");
      
      await Share.share({
        message: `我的課表\n\n${scheduleText}\n\n總學分: ${totalCredits}`,
        title: "我的課表",
      });
      
      analytics.logShare("schedule", "schedule_export", "share");
    } catch (error) {
      console.error("Share failed:", error);
    }
  }, [courses, totalCredits]);

  const handleSyncFromSchool = useCallback(async () => {
    Alert.alert(
      "連接學校選課系統",
      "此功能需要連接到學校的選課系統來同步課程資料。確定要繼續嗎？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "連接",
          onPress: async () => {
            setRefreshing(true);
            await schedule.refreshSchedule();
            setRefreshing(false);
            Alert.alert("同步完成", "已從伺服器載入最新課程資料");
          },
        },
      ]
    );
  }, [schedule]);

  if (schedule.loading && !refreshing) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Spinner />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入課表中...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
<ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      >
        {nextCourse && today !== 0 && today !== 6 && (
          <AnimatedCard title="下一堂課" subtitle={`第 ${nextCourse.startPeriod} 節開始`}>
            <Pressable
              onPress={() => handleCoursePress(nextCourse)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 14,
                borderRadius: theme.radius.md,
                backgroundColor: `${nextCourse.color}15`,
                borderWidth: 1,
                borderColor: `${nextCourse.color}30`,
                gap: 14,
              }}
            >
              <View
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 25,
                  backgroundColor: nextCourse.color,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>{nextCourse.startPeriod}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>{nextCourse.name}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }}>
                  {nextCourse.location} · {nextCourse.teacher}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: nextCourse.color, fontWeight: "700", fontSize: 12 }}>
                  {PERIODS[nextCourse.startPeriod - 1]?.time.split("-")[0]}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>開始</Text>
              </View>
            </Pressable>
          </AnimatedCard>
        )}

        <View style={{ flexDirection: "row", justifyContent: "space-around", paddingVertical: 8 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{courses.length}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>課程數</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{totalCredits}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>總學分</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 24 }}>{todayCourses.length}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>今日課程</Text>
          </View>
        </View>

        <SegmentedControl
          options={[
            { key: "week", label: "週課表" },
            { key: "day", label: "日檢視" },
            { key: "list", label: "列表" },
          ]}
          selected={viewMode}
          onChange={(k) => setViewMode(k as ViewMode)}
        />

        <AnimatedCard
          title={
            viewMode === "week"
              ? "週課表"
              : viewMode === "day"
                ? `${WEEKDAYS[selectedDay]}課程`
                : "所有課程"
          }
          subtitle={viewMode === "week" ? "點擊課程查看詳情" : undefined}
          delay={100}
        >
          {viewMode === "week" && renderWeekView()}
          {viewMode === "day" && renderDayView()}
          {viewMode === "list" && renderListView()}
        </AnimatedCard>

        <AnimatedCard title="課表管理" subtitle="新增或匯入課程" delay={200}>
          <View style={{ gap: 10 }}>
            <Button text="新增課程" kind="primary" onPress={handleAddCourse} />
            <Button text="從學校系統同步" onPress={handleSyncFromSchool} />
            <Button text="分享課表" onPress={handleShareSchedule} />
            <Button 
              text="匯出到行事曆" 
              onPress={async () => {
                try {
                  const events = await schedule.exportToCalendar();
                  Alert.alert("匯出成功", `已準備 ${events.length} 個行事曆事件`);
                } catch (error) {
                  Alert.alert("匯出失敗", "無法匯出課表到行事曆");
                }
              }} 
            />
          </View>
        </AnimatedCard>

        {schedule.error && (
          <AnimatedCard title="錯誤" delay={250}>
            <Text style={{ color: theme.colors.error }}>{schedule.error}</Text>
            <Button 
              text="重試" 
              onPress={handleRefresh} 
              style={{ marginTop: 12 }}
            />
          </AnimatedCard>
        )}
      </ScrollView>
    </Screen>
  );
}
