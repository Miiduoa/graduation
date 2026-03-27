/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import type { ClubEvent, InboxTask, MenuItem } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { usePermissions } from "../hooks/usePermissions";
import { getStreakStorageKey, refreshUserStreak, useAmbientCues } from "../features/engagement";
import { useSchedule } from "../state/schedule";
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

console.log("[debug][TodayScreen] module loaded");

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

function getDateString(): string {
  const now = new Date();
  const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 ${weekdays[now.getDay()]}`;
}

function StreakBadge({ days }: { days: number }) {
  if (days < 2) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.streakSoft,
        borderWidth: 1,
        borderColor: `${theme.colors.streak}30`,
      }}
    >
      <Ionicons name="flame" size={12} color={theme.colors.streak} />
      <Text style={{ color: theme.colors.streak, fontSize: 11, fontWeight: "700" }}>
        {days} 天
      </Text>
    </View>
  );
}

function CourseTimelineItem(props: {
  name: string;
  teacher?: string;
  location?: string;
  time?: string;
  isNow?: boolean;
  isDone?: boolean;
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
        gap: theme.space.md,
        opacity: pressed ? 0.85 : 1,
        paddingVertical: theme.space.sm,
      })}
    >
      <View style={{ alignItems: "center", width: 18, paddingTop: 4 }}>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: props.isDone ? theme.colors.muted : statusColor,
            borderWidth: props.isNow ? 2 : 0,
            borderColor: props.isNow ? theme.colors.success : "transparent",
          }}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: props.isDone ? theme.colors.muted : theme.colors.text,
            fontSize: 14,
            fontWeight: "600",
            textDecorationLine: props.isDone ? "line-through" : "none",
          }}
        >
          {props.name}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 1 }}>
          {[props.time, props.teacher, props.location].filter(Boolean).join("  ·  ")}
        </Text>
      </View>

      {props.isNow && (
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.successSoft,
          }}
        >
          <Text style={{ color: theme.colors.success, fontSize: 10, fontWeight: "700" }}>進行中</Text>
        </View>
      )}
    </Pressable>
  );
}

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
        gap: theme.space.md,
        paddingVertical: theme.space.sm,
        paddingHorizontal: theme.space.xs,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: urgencyColor,
          marginTop: 1,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "500" }} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 1 }}>
          {props.label}{props.dueAt ? `  ·  ${props.dueAt}` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: theme.colors.muted,
        fontSize: theme.typography.overline.fontSize,
        fontWeight: theme.typography.overline.fontWeight ?? "700",
        letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
        textTransform: "uppercase",
        marginBottom: theme.space.sm,
      }}
    >
      {children}
    </Text>
  );
}

export function TodayScreen(props: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = props?.navigation as any;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const schedule = useSchedule();
  const streakStorageKey = useMemo(
    () => getStreakStorageKey(auth.user?.uid ?? null, school.id),
    [auth.user?.uid, school.id]
  );

  const [streakDays, setStreakDays] = useState<number>(0);
  const streakPulse = useRef(new Animated.Value(1)).current;

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

  // Hero Action — 最重要的下一步（注意瓶頸理論）
  const nextAction = useMemo(() => {
    if (!auth.user) return null;
    return rankedInboxItems[0] ?? null;
  }, [auth.user, rankedInboxItems]);

  const nextCourse = useMemo(() => getNextCourse(schedule.courses), [schedule.courses]);
  const todayCourses = useMemo(() => getTodayCourses(schedule.courses), [schedule.courses]);

  // 今日截止任務（Zeigarnik Effect）
  const dueTodayTasks = useMemo(() => {
    const today = new Date();
    return inboxTasks
      .filter((t) => {
        if (!t.dueAt) return false;
        // Manually parse here (避免直接呼叫可能不是 Date/不是可呼叫 getTime 的值)
        const raw = t.dueAt as unknown;
        let d: Date | null = null;
        if (raw instanceof Date) {
          const gt = (raw as { getTime?: unknown }).getTime;
          if (typeof gt !== "function") {
            // #region agent log
            console.warn("[debug][TodayScreen][dueTodayTasks] raw is Date instance but getTime is not callable", {
              hypothesisId: "H1_dueTodayTasks_direct_getTime_call",
              typeofGetTime: typeof gt,
            });
            // #endregion
            return false;
          }
          const tms = gt.call(raw);
          if (typeof tms === "number" && !isNaN(tms)) {
            d = raw as Date;
          }
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

  useEffect(() => {
    const update = async () => {
      try {
        const { streak, didChange } = await refreshUserStreak(streakStorageKey);
        setStreakDays(streak.currentStreak);

        if (!didChange) {
          return;
        }

        try {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {
          // ignore haptics failures (e.g. platform)
        }
        streakPulse.setValue(1);
        Animated.sequence([
          Animated.timing(streakPulse, { toValue: 1.12, duration: 220, useNativeDriver: true }),
          Animated.timing(streakPulse, { toValue: 1.0, duration: 220, useNativeDriver: true }),
        ]).start();
      } catch {
        // ignore
      }
    };

    update();
  }, [streakPulse, streakStorageKey]);

  const urgentTasks = useMemo(() =>
    rankedInboxItems.slice(0, 3),
    [rankedInboxItems]
  );

  const handleNextActionPress = () => {
    if (!nextAction) return;
    if (nextAction.kind === "live" && nextAction.sessionId) {
      nav?.navigate?.("課程", {
        screen: "Classroom",
        params: { groupId: nextAction.groupId, sessionId: nextAction.sessionId, isTeacher: teachingMode },
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
    nav?.navigate?.("收件匣", {
      screen: "GroupDetail",
      params: { groupId: nextAction.groupId },
    });
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
      title: "公車班次",
      description: "查看回家班車或夜間校園公車時刻",
      meta: "交通",
      tint: theme.colors.calm,
      onPress: () => nav?.navigate?.("校園", { screen: "BusSchedule" }),
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
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.xs,
          paddingHorizontal: theme.space.lg,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + theme.space.xs,
          gap: theme.space.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: theme.space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 13, fontWeight: "500" }}>
              {getDateString()}
            </Text>
            <Animated.View style={{ transform: [{ scale: streakPulse }] }}>
              <StreakBadge days={streakDays} />
            </Animated.View>
          </View>

          <View style={{ gap: theme.space.xs }}>
            <Text style={{
              color: theme.colors.text,
              fontSize: theme.typography.display.fontSize,
              fontWeight: theme.typography.display.fontWeight ?? "800",
              letterSpacing: theme.typography.display.letterSpacing,
            }}>
              {getGreeting()}，{displayName ?? roleFallbackName}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 14, lineHeight: 21 }}>
              {totalToday > 0 ? completionText : roleCopy.hint}
            </Text>
          </View>

          {totalToday > 0 && (
            <View style={{ gap: theme.space.sm }}>
              <View
                style={{
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.border,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    borderRadius: 2,
                    backgroundColor:
                      highPressureCount === 0
                        ? theme.colors.growth
                        : highPressureCount === totalToday
                          ? theme.colors.urgent
                          : theme.colors.warning,
                    width: `${
                      highPressureCount === 0
                        ? 100
                        : Math.max((highPressureCount / totalToday) * 100, 12)
                    }%`,
                  }}
                />
              </View>
            </View>
          )}
        </View>

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
              onPress={() => nav?.navigate?.("課程", { screen: "CoursesHome" })}
            />
          )
        )}

        {ambientCue ? (
          <AmbientCueCard
            signalType={ambientCue.signalType}
            headline={ambientCue.headline}
            body={ambientCue.body}
            metric={ambientCue.metric}
            actionLabel={ambientCue.ctaLabel}
            onPress={() => openAmbientCue(ambientCue, nav)}
            onDismiss={() => {
              void dismissAmbientCue(ambientCue);
            }}
          />
        ) : null}

        {todayCourses.length > 0 && (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.space.lg,
              gap: 0,
            }}
          >
            <SectionLabel>今日課程</SectionLabel>
            <View>
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
                  <View key={course.id ?? i}>
                    <CourseTimelineItem
                      name={course.name}
                      teacher={course.teacher ?? course.instructor}
                      location={course.location}
                      time={course.startTime ?? course.schedule?.[0]?.startTime}
                      isNow={isNow}
                      isDone={isDone}
                      onPress={() => nav?.navigate?.("課程", { screen: "CourseHub" })}
                    />
                    {i < todayCourses.length - 1 && (
                      <View
                        style={{
                          height: 1,
                          backgroundColor: theme.colors.border,
                          marginLeft: 30,
                        }}
                      />
                    )}
                  </View>
                );
              })}
            </View>
            {nextCourse && (
              <Pressable
                onPress={() => nav?.navigate?.("課程", { screen: "CourseSchedule" })}
                style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>查看完整課表</Text>
                <Ionicons name="arrow-forward" size={12} color={theme.colors.accent} />
              </Pressable>
            )}
          </View>
        )}

        {auth.user && urgentTasks.length > 0 && (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.xl,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.space.lg,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <SectionLabel>待處理事項</SectionLabel>
              {inboxTasks.length > 3 && (
                <Pressable onPress={() => nav?.navigate?.("收件匣", { screen: "Inbox" })}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                    全部 {inboxTasks.length} 件
                  </Text>
                </Pressable>
              )}
            </View>
            {urgentTasks.map((task, i) => (
              <View key={task.groupId + i}>
                <InboxTaskRow
                  title={task.title}
                  label={task.kind === "live" ? "課堂" : task.kind === "assignment" ? "作業" : "群組"}
                  dueAt={task.dueAt ? formatDueWindow(task.dueAt) : undefined}
                  urgency={task.urgency}
                  onPress={() => {
                    if (task.kind === "live" && task.sessionId) {
                      nav?.navigate?.("課程", {
                        screen: "Classroom",
                        params: { groupId: task.groupId, sessionId: task.sessionId, isTeacher: teachingMode },
                      });
                    } else if (task.assignmentId) {
                      nav?.navigate?.("收件匣", { screen: "AssignmentDetail", params: { groupId: task.groupId, assignmentId: task.assignmentId } });
                    } else {
                      nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: task.groupId } });
                    }
                  }}
                />
                {i < urgentTasks.length - 1 && (
                  <View style={{ height: 1, backgroundColor: theme.colors.border }} />
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ gap: theme.space.md }}>
          <SectionLabel>Quick Links</SectionLabel>

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
            title="Map"
            description="Find routes and locations"
            meta="Campus"
            tint={theme.colors.accent}
            onPress={() => nav?.navigate?.("校園", { screen: "Map" })}
          />
        </View>
      </ScrollView>
    </View>
  );
}
