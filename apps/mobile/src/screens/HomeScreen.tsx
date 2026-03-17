import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme, shadowStyle } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useThemeMode } from "../state/theme";
import { useNotifications } from "../state/notifications";
import { useDataSource } from "../hooks/useDataSource";
import { useSchedule } from "../state/schedule";
import { formatRelativeTime, toDate } from "../utils/format";

const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const MONTHS_SHORT = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

const PERIODS: Record<number, { start: string; end: string }> = {
  1: { start: "08:10", end: "09:00" },
  2: { start: "09:10", end: "10:00" },
  3: { start: "10:10", end: "11:00" },
  4: { start: "11:10", end: "12:00" },
  5: { start: "12:10", end: "13:00" },
  6: { start: "13:10", end: "14:00" },
  7: { start: "14:10", end: "15:00" },
  8: { start: "15:10", end: "16:00" },
  9: { start: "16:10", end: "17:00" },
  10: { start: "17:10", end: "18:00" },
  11: { start: "18:30", end: "19:20" },
  12: { start: "19:25", end: "20:15" },
  13: { start: "20:20", end: "21:10" },
};

function getGreeting(hour: number): string {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早安";
  if (hour < 14) return "午安";
  if (hour < 18) return "下午好";
  return "晚安";
}

function periodToMinutes(period: number): number {
  const time = PERIODS[period];
  if (!time) return 0;
  const [hour, minute] = time.start.split(":").map(Number);
  return hour * 60 + minute;
}

function periodEndToMinutes(period: number): number {
  const time = PERIODS[period];
  if (!time) return 0;
  const [hour, minute] = time.end.split(":").map(Number);
  return hour * 60 + minute;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function getProgressPercent(startPeriod: number, endPeriod: number): number {
  const start = periodToMinutes(startPeriod);
  const end = periodEndToMinutes(endPeriod);
  const now = nowMinutes();
  if (now < start || now > end || end <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 100);
}

function formatCountdown(startPeriod: number): string {
  const minutesLeft = periodToMinutes(startPeriod) - nowMinutes();
  if (minutesLeft <= 0) return "現在可以直接前往";
  if (minutesLeft < 60) return `${minutesLeft} 分鐘後開始`;
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  return minutes > 0 ? `${hours} 小時 ${minutes} 分後開始` : `${hours} 小時後開始`;
}

function cardBorderColor() {
  return theme.mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.82)";
}

function cardGradient(tint?: string): [string, string, ...string[]] {
  if (theme.mode === "dark") {
    return [theme.colors.surfaceElevated, tint ?? "rgba(255,255,255,0.04)"];
  }
  return ["rgba(255,255,255,0.97)", tint ?? "rgba(236,242,250,0.84)"];
}

function SoftPanel(props: {
  children: React.ReactNode;
  tint?: string;
  style?: any;
  padding?: number;
}) {
  return (
    <View style={[{ borderRadius: 30 }, shadowStyle(theme.shadows.md), props.style]}>
      <LinearGradient
        colors={cardGradient(props.tint)}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 30,
          borderWidth: 1,
          borderColor: cardBorderColor(),
          overflow: "hidden",
          padding: props.padding ?? 20,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 18,
            right: 18,
            height: 1,
            backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.92)",
          }}
        />
        {props.children}
      </LinearGradient>
    </View>
  );
}

function SectionHeading(props: { eyebrow: string; title: string; onMore?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
      <View style={{ gap: 3 }}>
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.8,
            textTransform: "uppercase",
          }}
        >
          {props.eyebrow}
        </Text>
        <Text style={{ color: theme.colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.6 }}>
          {props.title}
        </Text>
      </View>
      {props.onMore ? (
        <Pressable
          onPress={props.onMore}
          style={({ pressed }) => ({
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: theme.radius.full,
            borderWidth: 1,
            borderColor: cardBorderColor(),
            backgroundColor: theme.colors.surfaceElevated,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>更多</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SnapshotTile(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 100,
        borderRadius: 22,
        padding: 14,
        backgroundColor: theme.colors.surfaceElevated,
        borderWidth: 1,
        borderColor: cardBorderColor(),
        opacity: pressed ? 0.8 : 1,
        ...shadowStyle(theme.shadows.sm),
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: props.tint,
          marginBottom: 14,
        }}
      >
        <Ionicons name={props.icon} size={18} color={theme.colors.text} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.4 }}>
        {props.value}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{props.label}</Text>
    </Pressable>
  );
}

function QuickActionTile(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 24,
        paddingHorizontal: 14,
        paddingVertical: 16,
        backgroundColor: theme.colors.surfaceElevated,
        borderWidth: 1,
        borderColor: cardBorderColor(),
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${props.color}18`,
          marginBottom: 14,
        }}
      >
        <Ionicons name={props.icon} size={22} color={props.color} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "700" }}>{props.label}</Text>
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4, lineHeight: 16 }}>{props.hint}</Text>
    </Pressable>
  );
}

function FocusClassCard({ courses, nav }: { courses: any[]; nav: any }) {
  const today = new Date().getDay();
  const now = nowMinutes();

  const todayCourses = useMemo(
    () =>
      courses
        .filter((course) => course.dayOfWeek === today)
        .sort((a, b) => periodToMinutes(a.startPeriod) - periodToMinutes(b.startPeriod)),
    [courses, today]
  );

  const currentCourse = todayCourses.find((course) => {
    const start = periodToMinutes(course.startPeriod);
    const end = periodEndToMinutes(course.endPeriod ?? course.startPeriod);
    return now >= start && now <= end;
  });

  const nextCourse = !currentCourse
    ? todayCourses.find((course) => periodToMinutes(course.startPeriod) > now)
    : null;

  const displayCourse = currentCourse ?? nextCourse;

  if (!displayCourse) {
    return (
      <Pressable onPress={() => nav?.navigate?.("課業", { screen: "CourseSchedule" })}>
        {({ pressed }) => (
          <SoftPanel tint={theme.colors.successSoft} style={{ opacity: pressed ? 0.84 : 1 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" }}>
                  Today Clear
                </Text>
                <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, marginTop: 8 }}>
                  今天課程已完成
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 8 }}>
                  把空下來的時間拿去看公告、安排作業，或直接打開完整週課表。
                </Text>
              </View>
              <View
                style={{
                  width: 62,
                  height: 62,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.successSoft,
                }}
              >
                <Ionicons name="checkmark-circle" size={30} color={theme.colors.success} />
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 20, gap: 8 }}>
              <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "700" }}>查看完整週課表</Text>
              <Ionicons name="arrow-forward" size={14} color={theme.colors.accent} />
            </View>
          </SoftPanel>
        )}
      </Pressable>
    );
  }

  const courseColor = displayCourse.color ?? theme.colors.accent;
  const periodInfo = PERIODS[displayCourse.startPeriod];
  const periodEndInfo = PERIODS[displayCourse.endPeriod ?? displayCourse.startPeriod];
  const isOngoing = Boolean(currentCourse);
  const progress = isOngoing
    ? getProgressPercent(displayCourse.startPeriod, displayCourse.endPeriod ?? displayCourse.startPeriod)
    : 0;

  return (
    <Pressable onPress={() => nav?.navigate?.("課業", { screen: "CourseSchedule" })}>
      {({ pressed }) => (
        <SoftPanel tint={`${courseColor}18`} style={{ opacity: pressed ? 0.86 : 1 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: theme.radius.full,
                  backgroundColor: `${courseColor}18`,
                  marginBottom: 14,
                }}
              >
                <Text style={{ color: courseColor, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" }}>
                  {isOngoing ? "正在上課" : "下一堂課"}
                </Text>
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 }} numberOfLines={1}>
                {displayCourse.name}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 6 }} numberOfLines={1}>
                {displayCourse.teacher || "未提供授課教師"}
              </Text>
            </View>
            <View
              style={{
                width: 68,
                borderRadius: 22,
                paddingVertical: 12,
                paddingHorizontal: 10,
                alignItems: "center",
                backgroundColor: theme.colors.surfaceElevated,
                borderWidth: 1,
                borderColor: cardBorderColor(),
              }}
            >
              <Text style={{ color: courseColor, fontSize: 12, fontWeight: "700" }}>第</Text>
              <Text style={{ color: theme.colors.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.6 }}>
                {displayCourse.startPeriod}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{displayCourse.endPeriod ?? displayCourse.startPeriod} 節</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surfaceElevated,
                borderWidth: 1,
                borderColor: cardBorderColor(),
              }}
            >
              <Ionicons name="time-outline" size={14} color={courseColor} />
              <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>
                {periodInfo?.start ?? "--"}
                {periodEndInfo ? ` - ${periodEndInfo.end}` : ""}
              </Text>
            </View>
            {displayCourse.location ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  borderRadius: theme.radius.full,
                  backgroundColor: theme.colors.surfaceElevated,
                  borderWidth: 1,
                  borderColor: cardBorderColor(),
                }}
              >
                <Ionicons name="location-outline" size={14} color={courseColor} />
                <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>{displayCourse.location}</Text>
              </View>
            ) : null}
          </View>

          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 18 }}>
            {isOngoing ? `目前課程進度 ${progress}%` : formatCountdown(displayCourse.startPeriod)}
          </Text>

          <View
            style={{
              height: 8,
              borderRadius: 999,
              backgroundColor: theme.colors.surface2,
              overflow: "hidden",
              marginTop: 8,
            }}
          >
            <View
              style={{
                width: `${isOngoing ? progress : 24}%`,
                height: 8,
                borderRadius: 999,
                backgroundColor: courseColor,
                opacity: isOngoing ? 1 : 0.35,
              }}
            />
          </View>
        </SoftPanel>
      )}
    </Pressable>
  );
}

function TodayTimelineCard({ courses, nav }: { courses: any[]; nav: any }) {
  const today = new Date().getDay();
  const now = nowMinutes();

  const remaining = useMemo(
    () =>
      courses
        .filter((course) => course.dayOfWeek === today)
        .filter((course) => periodEndToMinutes(course.endPeriod ?? course.startPeriod) > now)
        .sort((a, b) => periodToMinutes(a.startPeriod) - periodToMinutes(b.startPeriod)),
    [courses, today, now]
  );

  if (remaining.length === 0) return null;

  return (
    <SoftPanel tint={theme.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(226,234,245,0.7)"}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <View>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700" }}>今天行程軸線</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>接下來還有 {remaining.length} 個校園節點</Text>
        </View>
        <Pressable onPress={() => nav?.navigate?.("課業", { screen: "CourseSchedule" })}>
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "700" }}>全部課表</Text>
        </Pressable>
      </View>

      <View style={{ gap: 12 }}>
        {remaining.slice(0, 4).map((course) => {
          const isOngoing =
            now >= periodToMinutes(course.startPeriod) &&
            now <= periodEndToMinutes(course.endPeriod ?? course.startPeriod);
          const accent = course.color ?? theme.colors.accent;

          return (
            <View
              key={course.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                paddingVertical: 4,
              }}
            >
              <View style={{ alignItems: "center", width: 52 }}>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "700" }}>
                  {PERIODS[course.startPeriod]?.start ?? "--"}
                </Text>
                <View style={{ width: 2, flex: 1, minHeight: 26, marginTop: 8, backgroundColor: `${accent}25` }} />
              </View>
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  backgroundColor: theme.colors.surfaceElevated,
                  borderWidth: 1,
                  borderColor: isOngoing ? `${accent}35` : cardBorderColor(),
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: isOngoing ? "800" : "700" }} numberOfLines={1}>
                      {course.name}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>
                      {course.location || "未提供地點"}
                    </Text>
                  </View>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: theme.radius.full,
                      backgroundColor: isOngoing ? `${accent}18` : theme.colors.surface2,
                    }}
                  >
                    <Text style={{ color: isOngoing ? accent : theme.colors.muted, fontSize: 11, fontWeight: "700" }}>
                      {isOngoing ? "進行中" : "待開始"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </SoftPanel>
  );
}

function AnnouncementCard({ item, onPress }: { item: any; onPress: () => void }) {
  const publishedAt = toDate(item.publishedAt);

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <SoftPanel tint="rgba(255,149,0,0.08)" style={{ opacity: pressed ? 0.82 : 1 }} padding={18}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.warningSoft,
              }}
            >
              <Ionicons name="megaphone-outline" size={20} color={theme.colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                {item.source ? (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.full, backgroundColor: theme.colors.surface2 }}>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontWeight: "700" }}>{item.source}</Text>
                  </View>
                ) : null}
                {publishedAt ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{formatRelativeTime(publishedAt)}</Text>
                ) : null}
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700", lineHeight: 21 }} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </View>
        </SoftPanel>
      )}
    </Pressable>
  );
}

function EventCard({ item, onPress }: { item: any; onPress: () => void }) {
  const startDate = toDate(item.startsAt);

  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <SoftPanel tint="rgba(52,199,89,0.08)" style={{ opacity: pressed ? 0.82 : 1 }} padding={18}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.successSoft,
              }}
            >
              <Text style={{ color: theme.colors.success, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>
                {startDate ? startDate.getDate() : "?"}
              </Text>
              <Text style={{ color: theme.colors.success, fontSize: 10, fontWeight: "700", marginTop: 1 }}>
                {startDate ? MONTHS_SHORT[startDate.getMonth()] : ""}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: "700" }} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6 }} numberOfLines={2}>
                {startDate ? formatRelativeTime(startDate) : "時間未提供"}
                {item.location ? ` · ${item.location}` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </View>
        </SoftPanel>
      )}
    </Pressable>
  );
}

function LoginPromptCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <SoftPanel tint={theme.colors.accentSoft} style={{ opacity: pressed ? 0.82 : 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.accentSoft,
              }}
            >
              <Ionicons name="person-outline" size={22} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>登入以解鎖個人化內容</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 5 }}>
                同步課表、通知、校務功能與你的常用入口。
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={18} color={theme.colors.accent} />
          </View>
        </SoftPanel>
      )}
    </Pressable>
  );
}

export function HomeScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const notifs = useNotifications();
  const ds = useDataSource();
  useThemeMode();

  const { courses } = useSchedule();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const displayName = auth.profile?.displayName?.split(" ")[0] ?? (auth.user ? "同學" : "訪客");

  const loadData = async (isRefresh = false) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    if (isRefresh) setRefreshing(true);

    try {
      const [announcementData, eventData] = await Promise.all([
        ds.listAnnouncements(school.id),
        ds.listEvents(school.id),
      ]);

      if (!abortRef.current?.signal.aborted) {
        const currentTime = new Date();
        setAnnouncements(announcementData.slice(0, 3));
        setEvents(
          eventData
            .filter((event) => {
              const startDate = toDate(event.startsAt);
              return startDate && startDate > currentTime;
            })
            .sort((a, b) => (toDate(a.startsAt)?.getTime() ?? 0) - (toDate(b.startsAt)?.getTime() ?? 0))
            .slice(0, 3)
        );
      }
    } catch {
      // ignore fetch failures on the dashboard
    } finally {
      if (!abortRef.current?.signal.aborted) setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => abortRef.current?.abort();
  }, [ds, school.id]);

  const todayCourseCount = useMemo(() => {
    const today = new Date().getDay();
    return courses.filter((course) => course.dayOfWeek === today).length;
  }, [courses]);

  const quickActionsRow1 = [
    { icon: "search-outline" as const, label: "搜尋", hint: "全站資料", color: "#5AC8FA", onPress: () => nav?.navigate?.("我的", { screen: "GlobalSearch" }) },
    { icon: "bus-outline" as const, label: "公車", hint: "即時班次", color: "#34C759", onPress: () => nav?.navigate?.("地圖", { screen: "BusSchedule" }) },
    { icon: "restaurant-outline" as const, label: "餐廳", hint: "今天吃什麼", color: "#FF9500", onPress: () => nav?.navigate?.("餐廳總覽") },
  ];
  const quickActionsRow2 = [
    { icon: "qr-code-outline" as const, label: "QR 碼", hint: "出示身份", color: "#5B8CFF", onPress: () => nav?.navigate?.("我的", { screen: "QRCode" }) },
    { icon: "library-outline" as const, label: "圖書館", hint: "借閱與空位", color: "#667EEA", onPress: () => nav?.navigate?.("我的", { screen: "Library" }) },
    { icon: "sparkles-outline" as const, label: "AI 助理", hint: "課業問答", color: "#FF6B9A", onPress: () => nav?.navigate?.("課業", { screen: "AIChat" }) },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
        <LinearGradient
          colors={[`${theme.colors.accent}22`, "rgba(255,255,255,0)"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: -80,
            right: -40,
            width: 280,
            height: 280,
            borderRadius: 140,
          }}
        />
        <LinearGradient
          colors={["rgba(255,255,255,0.72)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: 90,
            left: -70,
            width: 220,
            height: 220,
            borderRadius: 110,
          }}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING, paddingHorizontal: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} tintColor={theme.colors.accent} />}
      >
        <View style={{ paddingTop: insets.top + 12, paddingBottom: 28 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: theme.radius.full,
                  backgroundColor: theme.colors.surfaceElevated,
                  borderWidth: 1,
                  borderColor: cardBorderColor(),
                  ...shadowStyle(theme.shadows.sm),
                }}
              >
                <Ionicons name="sparkles-outline" size={14} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" }}>
                  {WEEKDAYS[now.getDay()]} · {now.getMonth() + 1} 月 {now.getDate()} 日
                </Text>
              </View>

              <Text style={{ color: theme.colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -1, marginTop: 18 }}>
                {greeting}
              </Text>
              <Text style={{ color: theme.colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -1, marginTop: -3 }}>
                {displayName}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 12, maxWidth: 280 }}>
                {school.name} 的今日重點已整理完成，先看課程與最新校園資訊。
              </Text>
            </View>

            <Pressable
              onPress={() => nav?.navigate?.("我的", { screen: "Notifications" })}
              style={({ pressed }) => ({
                width: 52,
                height: 52,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.surfaceElevated,
                borderWidth: 1,
                borderColor: cardBorderColor(),
                transform: [{ scale: pressed ? 0.94 : 1 }],
                ...shadowStyle(theme.shadows.sm),
              })}
            >
              <Ionicons name="notifications-outline" size={22} color={theme.colors.text} />
              {notifs.unreadCount > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.danger,
                  }}
                >
                  <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "800" }}>
                    {notifs.unreadCount > 9 ? "9+" : notifs.unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 22 }}>
            <SnapshotTile
              icon="school-outline"
              label="今日課程"
              value={`${todayCourseCount}`}
              tint={`${theme.colors.accent}18`}
              onPress={() => nav?.navigate?.("課業", { screen: "CourseSchedule" })}
            />
            <SnapshotTile
              icon="megaphone-outline"
              label="最新公告"
              value={`${announcements.length}`}
              tint={theme.colors.warningSoft}
              onPress={() => nav?.navigate?.("公告總覽")}
            />
            <SnapshotTile
              icon="notifications-outline"
              label="未讀通知"
              value={`${notifs.unreadCount}`}
              tint={theme.colors.dangerSoft}
              onPress={() => nav?.navigate?.("我的", { screen: "Notifications" })}
            />
          </View>
        </View>

        <View style={{ gap: 24 }}>
          <View>
            <SectionHeading eyebrow="Daily Brief" title="今日焦點" />
            <FocusClassCard courses={courses} nav={nav} />
          </View>

          <View>
            <SectionHeading eyebrow="Shortcuts" title="快速入口" />
            <SoftPanel tint="rgba(226,234,245,0.76)" padding={16}>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {quickActionsRow1.map((action) => (
                    <QuickActionTile key={action.label} {...action} />
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {quickActionsRow2.map((action) => (
                    <QuickActionTile key={action.label} {...action} />
                  ))}
                </View>
              </View>
            </SoftPanel>
          </View>

          <View>
            <SectionHeading eyebrow="Timeline" title="今日節奏" onMore={() => nav?.navigate?.("課業", { screen: "CourseSchedule" })} />
            <TodayTimelineCard courses={courses} nav={nav} />
          </View>

          {announcements.length > 0 ? (
            <View>
              <SectionHeading eyebrow="News" title="最新公告" onMore={() => nav?.navigate?.("公告總覽")} />
              <View style={{ gap: 12 }}>
                {announcements.map((announcement) => (
                  <AnnouncementCard
                    key={announcement.id}
                    item={announcement}
                    onPress={() => nav?.navigate?.("公告詳情", { id: announcement.id })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {events.length > 0 ? (
            <View>
              <SectionHeading eyebrow="Upcoming" title="近期活動" onMore={() => nav?.navigate?.("活動總覽")} />
              <View style={{ gap: 12 }}>
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    item={event}
                    onPress={() => nav?.navigate?.("活動詳情", { id: event.id })}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {!auth.user ? <LoginPromptCard onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
