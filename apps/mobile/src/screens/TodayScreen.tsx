/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
// UI v2 — gradient + glass redesign
import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";

import type { ClubEvent, InboxTask, MenuItem } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { usePermissions } from "../hooks/usePermissions";
import { getStreakStorageKey, refreshUserStreak, useAmbientCues } from "../features/engagement";
import { useSchedule } from "../state/schedule";
import { useNotifications } from "../state/notifications";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { shadowStyle, theme } from "../ui/theme";
import { HeroActionCard, TimelineCard, CompletionState, ConfidenceBadge, AmbientCueCard } from "../ui/campusOs";
import {
  formatDueWindow,
  getNextCourse,
  getTodayCourses,
  isTeachingRole,
  resolveRoleMode,
  roleSummary,
  toInboxItem,
} from "../utils/campusOs";
import { navigateToCourseHome, navigateToCourseScreen } from "../utils/courseNavigation";

console.log("[debug][TodayScreen] module loaded");

// ─── Design Tokens ──────────────────────────────────────
const HEADER_GRADIENT_LIGHT = ["#F0EBFF", "#FAF9FC", "#FAF9FC"] as const;
const HEADER_GRADIENT_DARK = ["#1A1040", "#0C0A13", "#0C0A13"] as const;
const CARD_BG_LIGHT = "rgba(255,255,255,0.72)";
const CARD_BG_DARK = "rgba(26,22,37,0.75)";
const GLASS_INTENSITY = Platform.OS === "ios" ? 40 : 0; // BlurView only works well on iOS

type TimeSegment = "morning" | "class" | "afternoon" | "evening" | "night";

function getTimeSegment(): TimeSegment {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 9) return "morning";
  if (hour >= 9 && hour < 13) return "class";
  if (hour >= 13 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早安";
  if (hour < 12) return "上午好";
  if (hour < 14) return "午安";
  if (hour < 18) return "下午好";
  if (hour < 22) return "晚安";
  return "夜深了";
}

function getGreetingEmoji(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "🌙";
  if (hour < 9) return "🌅";
  if (hour < 12) return "☀️";
  if (hour < 14) return "🍜";
  if (hour < 18) return "🌤";
  if (hour < 22) return "🌆";
  return "🌙";
}

function getDateString(): string {
  const now = new Date();
  const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 ${weekdays[now.getDay()]}`;
}

// ─── Glass Card Wrapper ─────────────────────────────────
function GlassCard({
  children,
  style,
  noPadding,
}: {
  children: React.ReactNode;
  style?: object;
  noPadding?: boolean;
}) {
  const isDark = theme.mode === "dark";
  const cardBg = isDark ? CARD_BG_DARK : CARD_BG_LIGHT;
  const padding = noPadding ? 0 : theme.space.lg;

  if (Platform.OS === "ios") {
    return (
      <View style={[{ borderRadius: 22, overflow: "hidden" }, style]}>
        <BlurView
          intensity={GLASS_INTENSITY}
          tint={isDark ? "dark" : "light"}
          style={{
            padding,
            borderRadius: 22,
            overflow: "hidden",
            backgroundColor: cardBg,
          }}
        >
          {children}
        </BlurView>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          backgroundColor: isDark ? theme.colors.surface : "#FFFFFF",
          borderRadius: 22,
          padding,
          ...shadowStyle(theme.shadows.md),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── Streak Badge (redesigned) ──────────────────────────
function StreakBadge({ days }: { days: number }) {
  if (days < 2) return null;
  return (
    <LinearGradient
      colors={["#FF6B35", "#FF8C42"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
      }}
    >
      <Ionicons name="flame" size={13} color="#FFF" />
      <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "800" }}>
        {days} 天
      </Text>
    </LinearGradient>
  );
}

// ─── Course Timeline Item (redesigned) ──────────────────
function CourseTimelineItem(props: {
  name: string;
  teacher?: string;
  location?: string;
  time?: string;
  isNow?: boolean;
  isDone?: boolean;
  isLast?: boolean;
  onPress?: () => void;
}) {
  const statusColor = props.isNow
    ? theme.colors.success
    : props.isDone
      ? theme.colors.muted
      : theme.colors.accent;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 14,
        opacity: pressed ? 0.85 : 1,
        paddingVertical: 12,
      })}
    >
      {/* Timeline spine */}
      <View style={{ alignItems: "center", width: 24 }}>
        <View
          style={{
            width: props.isNow ? 14 : 10,
            height: props.isNow ? 14 : 10,
            borderRadius: 7,
            backgroundColor: props.isNow ? statusColor : props.isDone ? `${theme.colors.muted}40` : `${statusColor}30`,
            borderWidth: props.isNow ? 3 : 0,
            borderColor: `${statusColor}40`,
            ...(props.isNow ? {
              shadowColor: statusColor,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.5,
              shadowRadius: 6,
              elevation: 4,
            } : {}),
          }}
        />
        {!props.isLast && (
          <View
            style={{
              width: 2,
              flex: 1,
              minHeight: 20,
              backgroundColor: `${theme.colors.border}80`,
              marginTop: 4,
              borderRadius: 1,
            }}
          />
        )}
      </View>

      <View style={{ flex: 1, paddingBottom: props.isLast ? 0 : 4 }}>
        <Text
          style={{
            color: props.isDone ? theme.colors.muted : theme.colors.text,
            fontSize: 15,
            fontWeight: "600",
            textDecorationLine: props.isDone ? "line-through" : "none",
          }}
        >
          {props.name}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 3, lineHeight: 18 }}>
          {[props.time, props.location, props.teacher].filter(Boolean).join("  ·  ")}
        </Text>
      </View>

      {props.isNow && (
        <LinearGradient
          colors={[theme.colors.success, "#34D399"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 12,
            marginTop: 2,
          }}
        >
          <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }}>NOW</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

// ─── Inbox Task Row (redesigned) ────────────────────────
function InboxTaskRow(props: {
  title: string;
  label: string;
  dueAt?: string;
  urgency: "critical" | "high" | "medium" | "low";
  onPress: () => void;
}) {
  const urgencyColor =
    props.urgency === "critical"
      ? theme.colors.urgent
      : props.urgency === "high"
        ? theme.colors.warning
        : props.urgency === "medium"
          ? theme.colors.accent
          : theme.colors.muted;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 4,
        opacity: pressed ? 0.75 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: `${urgencyColor}15`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={props.urgency === "critical" ? "alert-circle" : props.urgency === "high" ? "warning" : "document-text"}
          size={18}
          color={urgencyColor}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
          {props.label}{props.dueAt ? `  ·  ${props.dueAt}` : ""}
        </Text>
      </View>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: `${theme.colors.accent}10`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="chevron-forward" size={14} color={theme.colors.accent} />
      </View>
    </Pressable>
  );
}

// ─── Quick Action Chip (completely redesigned) ──────────
function QuickActionChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 72,
        alignItems: "center",
        paddingVertical: 16,
        paddingHorizontal: 4,
        borderRadius: 20,
        backgroundColor: `${props.tint}08`,
        gap: 8,
        opacity: pressed ? 0.7 : 1,
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${props.tint}25`, `${props.tint}10`]}
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={props.icon} size={22} color={props.tint} />
      </LinearGradient>
      <Text style={{ color: theme.colors.text, fontSize: 11, fontWeight: "700", letterSpacing: 0.2 }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

// ─── Section Header (redesigned) ────────────────────────
function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 18,
          fontWeight: "700",
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
      {action && onAction && (
        <Pressable onPress={onAction} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>{action}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.accent} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────
export function TodayScreen(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const schedule = useSchedule();
  const isDark = theme.mode === "dark";
  const streakStorageKey = useMemo(
    () => getStreakStorageKey(auth.user?.uid ?? null, school.id),
    [auth.user?.uid, school.id]
  );

  const [streakDays, setStreakDays] = useState<number>(0);
  const streakPulse = useRef(new Animated.Value(1)).current;
  const headerFade = useRef(new Animated.Value(0)).current;

  const notifs = useNotifications();
  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const roleCopy = roleSummary(roleMode);
  const teachingMode = isTeachingRole(auth.profile?.role);
  const ambientRole = roleMode === "guest" ? "guest" : roleMode;
  const segment = getTimeSegment();
  const displayName = auth.profile?.displayName?.split(" ")[0];
  const roleFallbackName =
    roleMode === "teacher" ? "老師" : roleMode === "admin" ? "主管" : roleMode === "guest" ? "你" : "同學";

  const { items: inboxTasks, loading: inboxLoading, refresh: refreshInbox, refreshing } = useAsyncList<InboxTask>(
    async () => {
      if (!auth.user) return [];
      return ds.listInboxTasks(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const { items: announcements } = useAsyncList(
    async () => (await ds.listAnnouncements(school.id)).slice(0, 2),
    [auth.user?.uid, ds, school.id]
  );

  const { items: events } = useAsyncList<ClubEvent>(
    async () => (await ds.listEvents(school.id)).slice(0, 2),
    [auth.user?.uid, ds, school.id]
  );

  const { items: menus } = useAsyncList<MenuItem>(
    async () => (await ds.listMenus(school.id)).slice(0, 3),
    [auth.user?.uid, ds, school.id]
  );
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: ambientRole,
    surface: "today",
    limit: 1,
  });

  const rankedInboxItems = useMemo(
    () => inboxTasks.map(toInboxItem).sort((a, b) => a.priority - b.priority),
    [inboxTasks]
  );

  const nextAction = useMemo(() => {
    if (!auth.user) return null;
    return rankedInboxItems[0] ?? null;
  }, [auth.user, rankedInboxItems]);

  const nextCourse = useMemo(() => getNextCourse(schedule.courses), [schedule.courses]);
  const todayCourses = useMemo(() => getTodayCourses(schedule.courses), [schedule.courses]);

  const dueTodayTasks = useMemo(() => {
    const today = new Date();
    return inboxTasks
      .filter((t) => {
        if (!t.dueAt) return false;
        const raw = t.dueAt as unknown;
        let d: Date | null = null;
        if (raw instanceof Date) {
          const gt = (raw as { getTime?: unknown }).getTime;
          if (typeof gt !== "function") return false;
          const tms = gt.call(raw);
          if (typeof tms === "number" && !isNaN(tms)) d = raw as Date;
        } else if (typeof (raw as { toDate?: unknown }).toDate === "function") {
          d = (raw as { toDate: () => Date }).toDate();
        } else if (typeof (raw as { _seconds?: unknown })._seconds === "number") {
          d = new Date((raw as { _seconds: number })._seconds * 1000);
        } else if (typeof (raw as { seconds?: unknown }).seconds === "number") {
          d = new Date((raw as { seconds: number }).seconds * 1000);
        } else if (typeof raw === "string" || typeof raw === "number") {
          d = new Date(raw as string | number);
        }
        const dGetTime = d ? (d as { getTime?: unknown }).getTime : undefined;
        if (!d || typeof dGetTime !== "function") return false;
        const dms = dGetTime.call(d);
        if (typeof dms !== "number" || isNaN(dms)) return false;
        return d.getFullYear() === today.getFullYear() &&
          d.getMonth() === today.getMonth() &&
          d.getDate() === today.getDate();
      })
      .map(toInboxItem)
      .slice(0, 3);
  }, [inboxTasks]);

  // Entrance animation
  useEffect(() => {
    Animated.timing(headerFade, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  useEffect(() => {
    const update = async () => {
      try {
        const { streak, didChange } = await refreshUserStreak(streakStorageKey);
        setStreakDays(streak.currentStreak);

        if (!didChange) return;

        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch { /* ignore */ }
        streakPulse.setValue(1);
        Animated.sequence([
          Animated.timing(streakPulse, { toValue: 1.15, duration: 200, useNativeDriver: true }),
          Animated.timing(streakPulse, { toValue: 1.0, duration: 200, useNativeDriver: true }),
        ]).start();
      } catch { /* ignore */ }
    };
    update();
  }, [streakPulse, streakStorageKey]);

  const urgentTasks = useMemo(() => rankedInboxItems.slice(0, 3), [rankedInboxItems]);

  const handleNextActionPress = () => {
    if (!nextAction) return;
    if (nextAction.kind === "live" && nextAction.sessionId) {
      navigateToCourseScreen(nav, auth.profile?.role, "Classroom", {
        groupId: nextAction.groupId,
        sessionId: nextAction.sessionId,
        isTeacher: teachingMode,
      });
      return;
    }
    if ((nextAction.kind === "assignment" || nextAction.kind === "quiz") && nextAction.assignmentId) {
      nav?.navigate?.("收件匣", {
        screen: "AssignmentDetail",
        params: { groupId: nextAction.groupId, assignmentId: nextAction.assignmentId },
      });
      return;
    }
    nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: nextAction.groupId } });
  };

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshInbox(), schedule.refreshSchedule()]);
  }, [refreshInbox, schedule.refreshSchedule]);

  const contextCard = useMemo(() => {
    if (segment === "morning") {
      return {
        icon: "newspaper-outline" as const,
        title: announcements[0]?.title ?? "今天的校園公告",
        description: announcements[0]?.body?.slice(0, 60) ?? "查看今日最新校園資訊與通知",
        meta: "早晨公告",
        tint: theme.colors.fresh,
        onPress: () => nav?.navigate?.("公告總覽"),
      };
    }
    if (segment === "class" || segment === "afternoon") {
      return {
        icon: "cafe-outline" as const,
        title: menus[0]?.name ?? "今日餐廳菜單",
        description: menus[0]
          ? `${menus[0].cafeteria ?? "學餐"}${menus[0].price ? ` · NT$${menus[0].price}` : ""}`
          : "查看今日午餐和下午茶選項",
        meta: "餐廳",
        tint: theme.colors.achievement,
        onPress: () => nav?.navigate?.("校園", { screen: "餐廳總覽" }),
      };
    }
    if (segment === "evening") {
      return {
        icon: "calendar-outline" as const,
        title: events[0]?.title ?? "近期校園活動",
        description: events[0]?.description?.slice(0, 60) ?? "探索今晚和週末的校園活動",
        meta: "活動",
        tint: theme.colors.social,
        onPress: () => nav?.navigate?.("活動總覽"),
      };
    }
    return {
      icon: "bus-outline" as const,
      title: "交通資訊",
      description: "公車即時到站、台鐵高鐵、YouBike",
      meta: "交通",
      tint: theme.colors.calm,
      onPress: () => nav?.navigate?.("校園", { screen: "TransportHub" }),
    };
  }, [segment, announcements, menus, events]);

  const highPressureCount = rankedInboxItems.filter(
    (item) => item.urgency === "critical" || item.urgency === "high"
  ).length;
  const totalToday = inboxTasks.length;
  const completionText =
    totalToday > 0
      ? highPressureCount > 0
        ? `${highPressureCount} 件高壓事項待處理`
        : `已整理 ${totalToday} 件事項`
      : "今天沒有需要你立刻處理的事項";

  const headerGradient = isDark ? HEADER_GRADIENT_DARK : HEADER_GRADIENT_LIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing || schedule.loading}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══ Hero Header with Gradient ═══ */}
        <LinearGradient
          colors={headerGradient as unknown as [string, string, ...string[]]}
          style={{
            paddingTop: insets.top + 12,
            paddingHorizontal: 20,
            paddingBottom: 28,
          }}
        >
          <Animated.View style={{ opacity: headerFade }}>
            {/* Top Bar: Date + Actions */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 14, fontWeight: "500", letterSpacing: 0.2 }}>
                {getDateString()}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Animated.View style={{ transform: [{ scale: streakPulse }] }}>
                  <StreakBadge days={streakDays} />
                </Animated.View>
                <Pressable
                  onPress={() => nav?.navigate?.("我的", { screen: "Notifications" })}
                  style={({ pressed }) => ({
                    width: 42,
                    height: 42,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(91,33,182,0.06)",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons name="notifications-outline" size={20} color={theme.colors.text} />
                  {notifs.unreadCount > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 8,
                        paddingHorizontal: 4,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: theme.colors.danger,
                      }}
                    >
                      <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>
                        {notifs.unreadCount > 9 ? "9+" : notifs.unreadCount}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Greeting */}
            <View style={{ gap: 6 }}>
              <Text style={{
                color: theme.colors.text,
                fontSize: 32,
                fontWeight: "800",
                letterSpacing: -0.8,
                lineHeight: 38,
              }}>
                {getGreeting()} {getGreetingEmoji()}
              </Text>
              <Text style={{
                color: theme.colors.text,
                fontSize: 22,
                fontWeight: "700",
                letterSpacing: -0.4,
                opacity: 0.85,
              }}>
                {displayName ?? roleFallbackName}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 4 }}>
                {totalToday > 0 ? completionText : roleCopy.hint}
              </Text>
            </View>

            {/* Progress bar */}
            {totalToday > 0 && (
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(91,33,182,0.08)",
                  overflow: "hidden",
                  marginTop: 16,
                }}
              >
                <LinearGradient
                  colors={
                    highPressureCount === 0
                      ? [theme.colors.growth, "#34D399"]
                      : highPressureCount === totalToday
                        ? [theme.colors.urgent, "#F87171"]
                        : [theme.colors.warning, "#FBBF24"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    width: `${highPressureCount === 0 ? 100 : Math.max((highPressureCount / totalToday) * 100, 12)}%`,
                  }}
                />
              </View>
            )}
          </Animated.View>
        </LinearGradient>

        {/* ═══ Main Content ═══ */}
        <View style={{ paddingHorizontal: 20, gap: 24, marginTop: -4 }}>

          {/* Hero Action Card */}
          {!auth.user ? (
            <HeroActionCard
              icon="school-outline"
              eyebrow="開始你的校園體驗"
              title="選學校，建立你的日常節奏"
              description="選好學校和身份後，Campus 會自動整理你的課程、截止日、公告和校園服務。"
              actionLabel="立即設定"
              onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })}
            />
          ) : nextAction ? (
            <HeroActionCard
              icon={nextAction.kind === "live" ? "pulse" : nextAction.kind === "group" ? "people" : "document-text"}
              eyebrow="下一步"
              title={nextAction.title}
              description={nextAction.reason}
              meta={nextAction.dueAt ? formatDueWindow(nextAction.dueAt) : undefined}
              tone={
                nextAction.urgency === "critical"
                  ? "danger"
                  : nextAction.urgency === "high"
                    ? "warning"
                    : "accent"
              }
              actionLabel={nextAction.actionLabel ?? "前往處理"}
              onPress={handleNextActionPress}
            />
          ) : (
            roleMode === "teacher" ? (
              <CompletionState
                title="目前沒有待批改或待發布的課務"
                description="可以回到教學中樞整理教材、檢查點名，或提前安排下一堂課。"
                actionLabel="打開教學中樞"
                onPress={() => nav?.navigate?.("教學", { screen: "TeachingHub" })}
              />
            ) : roleMode === "admin" ? (
              <CompletionState
                title="目前沒有需要立刻介入的校務事項"
                description="可以前往管理控制台檢查公告、活動與成員權限狀態。"
                actionLabel="打開管理台"
                onPress={() => nav?.navigate?.("管理", { screen: "AdminDashboard" })}
              />
            ) : (
              <CompletionState
                title="今天的主任務都完成了"
                description="目前沒有急需處理的事項。可以看看課程進度或規劃明天。"
                actionLabel="查看課程"
                onPress={() => navigateToCourseHome(nav, auth.profile?.role)}
              />
            )
          )}

          {/* Ambient Cue */}
          {ambientCue ? (
            <AmbientCueCard
              signalType={ambientCue.signalType}
              headline={ambientCue.headline}
              body={ambientCue.body}
              metric={ambientCue.metric}
              actionLabel={ambientCue.ctaLabel}
              onPress={() => openAmbientCue(ambientCue, nav)}
              onDismiss={() => { void dismissAmbientCue(ambientCue); }}
            />
          ) : null}

          {/* ═══ Today's Courses — Glass Card ═══ */}
          {todayCourses.length > 0 && (
            <View>
              <SectionHeader
                title="今日課程"
                action="完整課表"
                onAction={() => navigateToCourseScreen(nav, auth.profile?.role, "CourseSchedule")}
              />
              <GlassCard>
                {todayCourses.map((course, i) => {
                  const now = new Date();
                  const nowMinutes = now.getHours() * 60 + now.getMinutes();
                  const startMinutes = course.startTime ? parseInt(course.startTime.split(":")[0]) * 60 + parseInt(course.startTime.split(":")[1]) : 0;
                  const endMinutes = course.endTime ? parseInt(course.endTime.split(":")[0]) * 60 + parseInt(course.endTime.split(":")[1]) : 0;
                  const todayDayOfWeek = now.getDay();
                  const courseDayOfWeek = course.dayOfWeek ?? ((now.getDay() || 7) % 7);
                  const isNow = todayDayOfWeek === courseDayOfWeek && nowMinutes >= startMinutes && nowMinutes < endMinutes;
                  const isDone = todayDayOfWeek === courseDayOfWeek && nowMinutes >= endMinutes;
                  return (
                    <CourseTimelineItem
                      key={course.id ?? i}
                      name={course.name}
                      teacher={course.teacher ?? course.instructor}
                      location={course.location}
                      time={course.startTime ?? course.schedule?.[0]?.startTime}
                      isNow={isNow}
                      isDone={isDone}
                      isLast={i === todayCourses.length - 1}
                      onPress={() => navigateToCourseHome(nav, auth.profile?.role, { initialTab: "schedule" })}
                    />
                  );
                })}
              </GlassCard>
            </View>
          )}

          {/* ═══ Urgent Tasks — Glass Card ═══ */}
          {auth.user && urgentTasks.length > 0 && (
            <View>
              <SectionHeader
                title="待處理事項"
                action={inboxTasks.length > 3 ? `全部 ${inboxTasks.length} 件` : undefined}
                onAction={inboxTasks.length > 3 ? () => nav?.navigate?.("收件匣", { screen: "Inbox" }) : undefined}
              />
              <GlassCard>
                {urgentTasks.map((task, i) => (
                  <View key={task.groupId + i}>
                    <InboxTaskRow
                      title={task.title}
                      label={task.kind === "live" ? "課堂" : task.kind === "assignment" ? "作業" : "群組"}
                      dueAt={task.dueAt ? formatDueWindow(task.dueAt) : undefined}
                      urgency={task.urgency}
                      onPress={() => {
                        if (task.kind === "live" && task.sessionId) {
                          navigateToCourseScreen(nav, auth.profile?.role, "Classroom", {
                            groupId: task.groupId,
                            sessionId: task.sessionId,
                            isTeacher: teachingMode,
                          });
                        } else if (task.assignmentId) {
                          nav?.navigate?.("收件匣", { screen: "AssignmentDetail", params: { groupId: task.groupId, assignmentId: task.assignmentId } });
                        } else {
                          nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: task.groupId } });
                        }
                      }}
                    />
                    {i < urgentTasks.length - 1 && (
                      <View style={{ height: 1, backgroundColor: `${theme.colors.border}60`, marginLeft: 50 }} />
                    )}
                  </View>
                ))}
              </GlassCard>
            </View>
          )}

          {/* ═══ Quick Actions — Gradient Grid ═══ */}
          <View>
            <SectionHeader title="快速入口" />
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <QuickActionChip icon="sparkles-outline" label="AI 助理" tint="#7C3AED" onPress={() => nav?.navigate?.("AIChat")} />
                <QuickActionChip icon="search-outline" label="搜尋" tint="#6366F1" onPress={() => nav?.navigate?.("我的", { screen: "GlobalSearch" })} />
                <QuickActionChip icon="bus-outline" label="交通" tint="#10B981" onPress={() => nav?.navigate?.("校園", { screen: "TransportHub" })} />
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <QuickActionChip icon="restaurant-outline" label="餐廳" tint="#D4A843" onPress={() => nav?.navigate?.("校園", { screen: "餐廳總覽" })} />
                <QuickActionChip icon="qr-code-outline" label="QR 碼" tint="#5B21B6" onPress={() => nav?.navigate?.("我的", { screen: "QRCode" })} />
                <QuickActionChip icon="library-outline" label="圖書館" tint="#A78BFA" onPress={() => nav?.navigate?.("校園", { screen: "Library" })} />
              </View>
            </View>
          </View>

          {/* ═══ Contextual Links ═══ */}
          <View>
            <SectionHeader title="探索" />
            <View style={{ gap: 12 }}>
              <TimelineCard
                icon={contextCard.icon}
                title={contextCard.title}
                description={contextCard.description}
                meta={contextCard.meta}
                tint={contextCard.tint}
                onPress={contextCard.onPress}
              />
              <TimelineCard
                icon="navigate-circle-outline"
                title="校園地圖"
                description="教室位置、路線導覽、周邊服務"
                meta="Campus"
                tint={theme.colors.accent}
                onPress={() => nav?.navigate?.("校園", { screen: "Map" })}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
