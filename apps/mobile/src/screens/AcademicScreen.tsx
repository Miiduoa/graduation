import React, { useMemo } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchedule } from "../state/schedule";
import { useThemeMode } from "../state/theme";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const WEEKDAYS_FULL = ["日", "一", "二", "三", "四", "五", "六"];

const PERIODS: Record<number, { start: string; end: string }> = {
  1:  { start: "08:10", end: "09:00" },
  2:  { start: "09:10", end: "10:00" },
  3:  { start: "10:10", end: "11:00" },
  4:  { start: "11:10", end: "12:00" },
  5:  { start: "12:10", end: "13:00" },
  6:  { start: "13:10", end: "14:00" },
  7:  { start: "14:10", end: "15:00" },
  8:  { start: "15:10", end: "16:00" },
  9:  { start: "16:10", end: "17:00" },
  10: { start: "17:10", end: "18:00" },
  11: { start: "18:30", end: "19:20" },
  12: { start: "19:25", end: "20:15" },
  13: { start: "20:20", end: "21:10" },
};

function periodToMinutes(p: number): number {
  const t = PERIODS[p];
  if (!t) return 0;
  const [h, m] = t.start.split(":").map(Number);
  return h * 60 + m;
}

function periodEndToMinutes(p: number): number {
  const t = PERIODS[p];
  if (!t) return 0;
  const [h, m] = t.end.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// ─── 子元件 ─────────────────────────────────────────────────────────────────

function ToolCard({ icon, title, subtitle, color, onPress, badge }: {
  icon: string; title: string; subtitle: string; color: string;
  onPress: () => void; badge?: string | number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        padding: 18,
        borderRadius: 20,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 12,
        transform: [{ scale: pressed ? 0.95 : 1 }],
        minHeight: 108,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{
          width: 44, height: 44, borderRadius: 14,
          backgroundColor: `${color}15`,
          alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name={icon as any} size={21} color={color} />
        </View>
        {badge !== undefined && (
          <View style={{
            paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
            backgroundColor: `${color}18`,
          }}>
            <Text style={{ color, fontSize: 10, fontWeight: "700" }}>{badge}</Text>
          </View>
        )}
      </View>
      <View>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>{title}</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function WeekDayStrip({ courses }: { courses: any[] }) {
  const todayIndex = new Date().getDay();
  const weekDays = [1, 2, 3, 4, 5];

  return (
    <View style={{
      flexDirection: "row",
      gap: 6,
      marginBottom: 22,
      padding: 14,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      borderWidth: 1, borderColor: theme.colors.border,
    }}>
      {weekDays.map((day) => {
        const count = courses.filter((c) => c.dayOfWeek === day).length;
        const isToday = day === todayIndex;
        const hasCourses = count > 0;
        return (
          <View key={day} style={{ flex: 1, alignItems: "center", gap: 5 }}>
            <Text style={{
              fontSize: 10, fontWeight: "700", letterSpacing: 0.3,
              color: isToday ? theme.colors.accent : theme.colors.muted,
              textTransform: "uppercase",
            }}>
              {WEEKDAYS_FULL[day]}
            </Text>
            <View style={{
              width: 34, height: 34, borderRadius: 11,
              backgroundColor: isToday
                ? theme.colors.accent
                : hasCourses
                  ? `${theme.colors.accent}15`
                  : "transparent",
              borderWidth: 1.5,
              borderColor: isToday
                ? theme.colors.accent
                : hasCourses
                  ? `${theme.colors.accent}35`
                  : theme.colors.border,
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{
                fontSize: 14, fontWeight: "800",
                color: isToday ? "#fff" : hasCourses ? theme.colors.accent : theme.colors.muted,
              }}>
                {count}
              </Text>
            </View>
            {isToday && (
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.colors.accent }} />
            )}
            {!isToday && <View style={{ width: 5, height: 5 }} />}
          </View>
        );
      })}
    </View>
  );
}

function CourseTimelineCard({ course }: { course: any }) {
  const now = nowMinutes();
  const startMin = periodToMinutes(course.startPeriod);
  const endMin = periodEndToMinutes(course.endPeriod ?? course.startPeriod);
  const isOngoing = now >= startMin && now <= endMin;
  const isEnded = now > endMin;

  const periodStart = PERIODS[course.startPeriod];
  const periodEnd = PERIODS[course.endPeriod ?? course.startPeriod];
  const progress = isOngoing ? Math.round(((now - startMin) / (endMin - startMin)) * 100) : 0;
  const courseColor = course.color ?? theme.colors.accent;

  return (
    <View style={{
      flexDirection: "row",
      borderRadius: 18,
      backgroundColor: isOngoing
        ? `${courseColor}10`
        : theme.colors.surface,
      borderWidth: isOngoing ? 1.5 : 1,
      borderColor: isOngoing ? courseColor : theme.colors.border,
      overflow: "hidden",
      marginBottom: 8,
      opacity: isEnded ? 0.5 : 1,
    }}>
      {/* Left time column */}
      <View style={{
        width: 56,
        paddingVertical: 14,
        paddingLeft: 14,
        alignItems: "flex-start",
        justifyContent: "center",
      }}>
        <Text style={{ color: isOngoing ? courseColor : theme.colors.muted, fontSize: 11, fontWeight: "700" }}>
          {periodStart?.start ?? "--"}
        </Text>
        <View style={{ width: 1, height: 12, backgroundColor: isOngoing ? `${courseColor}40` : theme.colors.border, marginVertical: 3, marginLeft: 14 }} />
        <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "500" }}>
          {periodEnd?.end ?? "--"}
        </Text>
      </View>

      {/* Color indicator */}
      <View style={{ width: 4, backgroundColor: courseColor, opacity: isEnded ? 0.4 : 1 }} />

      {/* Main content */}
      <View style={{ flex: 1, padding: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ flex: 1, gap: 3 }}>
            {isOngoing && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 }}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: courseColor }} />
                <Text style={{ fontSize: 10, fontWeight: "700", color: courseColor }}>正在進行</Text>
              </View>
            )}
            <Text style={{
              color: theme.colors.text, fontWeight: "700", fontSize: 14, lineHeight: 20,
            }} numberOfLines={1}>
              {course.name}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
              {course.teacher && (
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{course.teacher}</Text>
              )}
              {course.location && (
                <>
                  <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: theme.colors.border }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Ionicons name="location-outline" size={11} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{course.location}</Text>
                  </View>
                </>
              )}
            </View>
          </View>
          {course.credits && (
            <View style={{
              paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7,
              backgroundColor: `${courseColor}15`,
            }}>
              <Text style={{ color: courseColor, fontSize: 10, fontWeight: "700" }}>{course.credits} 學分</Text>
            </View>
          )}
        </View>

        {/* Progress bar for ongoing course */}
        {isOngoing && (
          <View style={{ marginTop: 10 }}>
            <View style={{
              height: 4, borderRadius: 2,
              backgroundColor: `${courseColor}25`,
              overflow: "hidden",
            }}>
              <View style={{
                height: 4, borderRadius: 2,
                backgroundColor: courseColor,
                width: `${progress}%`,
              }} />
            </View>
            <Text style={{ color: `${courseColor}BB`, fontSize: 10, fontWeight: "600", marginTop: 4 }}>
              課程進度 {progress}%
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function TodayScheduleSection({ courses, nav }: { courses: any[]; nav: any }) {
  const today = new Date().getDay();
  const todayCourses = useMemo(
    () => courses
      .filter((c) => c.dayOfWeek === today)
      .sort((a, b) => a.startPeriod - b.startPeriod),
    [courses, today]
  );

  if (todayCourses.length === 0) {
    return (
      <View style={{
        padding: 20, borderRadius: 18,
        backgroundColor: theme.colors.surface,
        borderWidth: 1, borderColor: theme.colors.border,
        flexDirection: "row", alignItems: "center", gap: 14,
        marginBottom: 22,
      }}>
        <View style={{
          width: 44, height: 44, borderRadius: 14,
          backgroundColor: `${theme.colors.success}12`,
          alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>今天沒有課 🎉</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 2 }}>好好休息或自習吧！</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 22 }}>
      {todayCourses.map((c) => (
        <CourseTimelineCard key={c.id} course={c} />
      ))}
      <Pressable
        onPress={() => nav?.navigate?.("AddCourse")}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", justifyContent: "center",
          gap: 6, paddingVertical: 10,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="add-circle-outline" size={16} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>新增課程</Text>
      </Pressable>
    </View>
  );
}

function AssignmentsPreview({ nav }: { nav: any }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{
            width: 26, height: 26, borderRadius: 8,
            backgroundColor: "#EF444415",
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="document-text-outline" size={14} color="#EF4444" />
          </View>
          <Text style={{ fontSize: 17, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.3 }}>
            作業 & 截止
          </Text>
        </View>
        <Pressable onPress={() => nav?.navigate?.("GroupAssignments")} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 2 })}>
          <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>更多</Text>
          <Ionicons name="chevron-forward" size={13} color={theme.colors.accent} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => nav?.navigate?.("訊息", { screen: "Groups" })}
        style={({ pressed }) => ({
          flexDirection: "row", alignItems: "center", gap: 14,
          padding: 16, borderRadius: 16,
          backgroundColor: theme.colors.surface,
          borderWidth: 1, borderColor: theme.colors.border,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Ionicons name="checkmark-circle-outline" size={22} color={theme.colors.success} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 14 }}>目前沒有即將截止的作業</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>前往社群查看群組作業</Text>
        </View>
        <Ionicons name="chevron-forward" size={15} color={theme.colors.muted} />
      </Pressable>
    </View>
  );
}

// ─── 主畫面 ──────────────────────────────────────────────────────────────────

export function AcademicScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { courses } = useSchedule();
  useThemeMode();

  const isDark = theme.mode === "dark";
  const totalCredits = useMemo(
    () => courses.reduce((sum, c) => sum + (c.credits ?? 0), 0),
    [courses]
  );

  const today = new Date().getDay();
  const todayCourseCount = useMemo(
    () => courses.filter((c) => c.dayOfWeek === today).length,
    [courses, today]
  );
  const ongoingCourse = useMemo(() => {
    const now = nowMinutes();
    return courses.find((c) => {
      if (c.dayOfWeek !== today) return false;
      const start = periodToMinutes(c.startPeriod);
      const end = periodEndToMinutes(c.endPeriod ?? c.startPeriod);
      return now >= start && now <= end;
    });
  }, [courses, today]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* ─── Header ─── */}
        <View
          style={{
            paddingTop: insets.top + 12,
            paddingBottom: 22,
            paddingHorizontal: 20,
            backgroundColor: theme.colors.bg,
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.3 }}>學習中心</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4, marginBottom: 16 }}>
            <Text style={{ color: theme.colors.text, fontSize: 34, fontWeight: "800", letterSpacing: -1 }}>
              課業
            </Text>
            <Pressable
              onPress={() => nav?.navigate?.("CourseSchedule")}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "center", gap: 6,
                paddingHorizontal: 14, paddingVertical: 8,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.colors.accentSoft,
                borderWidth: 1,
                borderColor: "transparent",
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <Ionicons name="calendar-outline" size={15} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 13 }}>週課表</Text>
            </Pressable>
          </View>

          {/* 統計摘要 */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{
              flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
              padding: 12, borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surface,
              borderWidth: 1, borderColor: theme.colors.border,
            }}>
              <Ionicons name="layers-outline" size={15} color="#8B5CF6" />
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 13 }}>
                {courses.length} 門課程
              </Text>
            </View>
            <View style={{
              flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
              padding: 12, borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surface,
              borderWidth: 1, borderColor: theme.colors.border,
            }}>
              <Ionicons name="star-outline" size={15} color="#F59E0B" />
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 13 }}>
                {totalCredits} 學分
              </Text>
            </View>
            {ongoingCourse && (
              <View style={{
                flex: 1.2, flexDirection: "row", alignItems: "center", gap: 6,
                padding: 12, borderRadius: theme.radius.sm,
                backgroundColor: `${ongoingCourse.color ?? theme.colors.accent}15`,
                borderWidth: 1, borderColor: `${ongoingCourse.color ?? theme.colors.accent}30`,
              }}>
                <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: ongoingCourse.color ?? theme.colors.accent }} />
                <Text style={{ color: ongoingCourse.color ?? theme.colors.accent, fontWeight: "700", fontSize: 11 }} numberOfLines={1}>
                  上課中
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, marginTop: 4 }}>
          {/* ─── 本週課表概覽 ─── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${theme.colors.accent}15`, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="grid-outline" size={14} color={theme.colors.accent} />
              </View>
              <Text style={{ fontSize: 17, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.3 }}>
                本週課表
              </Text>
            </View>
            <Pressable
              onPress={() => nav?.navigate?.("CourseSchedule")}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: "row", alignItems: "center", gap: 2 })}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>完整</Text>
              <Ionicons name="chevron-forward" size={13} color={theme.colors.accent} />
            </Pressable>
          </View>
          <WeekDayStrip courses={courses} />

          {/* ─── 今日課程 (時間軸) ─── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: "#10B98115", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="today-outline" size={14} color="#10B981" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.3 }}>
                今日課程
              </Text>
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{todayCourseCount} 堂</Text>
          </View>
          <TodayScheduleSection courses={courses} nav={nav} />

          {/* ─── 作業 & 截止提醒 ─── */}
          <AssignmentsPreview nav={nav} />

          {/* ─── 學習工具：成績、行事曆、學分、群組 ─── */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <View style={{
              width: 26, height: 26, borderRadius: 8,
              backgroundColor: `${theme.colors.accent}15`,
              alignItems: "center", justifyContent: "center",
            }}>
              <Ionicons name="construct-outline" size={14} color={theme.colors.accent} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.3 }}>
              學習工具
            </Text>
          </View>
          <View style={{ gap: 12, marginBottom: 22 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <ToolCard
                icon="bar-chart-outline"
                title="成績查詢"
                subtitle="查看各科成績"
                color="#10B981"
                onPress={() => nav?.navigate?.("Grades")}
              />
              <ToolCard
                icon="today-outline"
                title="行事曆"
                subtitle="重要日程一覽"
                color="#F59E0B"
                onPress={() => nav?.navigate?.("Calendar")}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <ToolCard
                icon="calculator-outline"
                title="學分審核"
                subtitle="確認畢業學分"
                color="#EF4444"
                onPress={() => nav?.navigate?.("CreditAuditStack")}
              />
              <ToolCard
                icon="people-outline"
                title="學習群組"
                subtitle="查看作業與討論"
                color="#3B82F6"
                onPress={() => nav?.navigate?.("訊息", { screen: "Groups" })}
              />
            </View>
          </View>

          {/* ─── AI 助理 Banner ─── */}
          <Pressable
            onPress={() => nav?.navigate?.("AICourseAdvisor")}
            style={({ pressed }) => ({
              borderRadius: 22,
              overflow: "hidden",
              transform: [{ scale: pressed ? 0.97 : 1 }],
              marginBottom: 16,
            })}
          >
            <View style={{
              padding: 20, borderRadius: theme.radius.md,
              backgroundColor: "#8B5CF6",
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={{
                  width: 52, height: 52, borderRadius: 18,
                  backgroundColor: "rgba(255,255,255,0.2)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="sparkles" size={26} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17 }}>AI 選課 & 課業助理</Text>
                  <Text style={{ color: "rgba(255,255,255,0.78)", fontSize: 13, marginTop: 3 }}>
                    智能推薦選課、解答課業問題
                  </Text>
                </View>
                <View style={{
                  width: 34, height: 34, borderRadius: 11,
                  backgroundColor: "rgba(255,255,255,0.2)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Ionicons name="arrow-forward" size={17} color="#fff" />
                </View>
              </View>
            </View>
          </Pressable>

          {/* ─── AI Chat 入口 ─── */}
          <Pressable
            onPress={() => nav?.navigate?.("AIChat")}
            style={({ pressed }) => ({
              flexDirection: "row", alignItems: "center", gap: 12,
              padding: 16, borderRadius: 18,
              backgroundColor: theme.colors.surface,
              borderWidth: 1, borderColor: theme.colors.border,
              opacity: pressed ? 0.8 : 1,
              marginBottom: 8,
            })}
          >
            <View style={{
              width: 38, height: 38, borderRadius: 12,
              backgroundColor: "#8B5CF615",
              alignItems: "center", justifyContent: "center",
            }}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#8B5CF6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>AI 校園助理</Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 1 }}>問課業、查資料、解答疑惑</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>

          {/* ─── 未登入提示 ─── */}
          {!auth.user && (
            <View style={{
              padding: 16, borderRadius: 16,
              backgroundColor: `${theme.colors.warning}10`,
              borderWidth: 1, borderColor: `${theme.colors.warning}25`,
              flexDirection: "row", alignItems: "center", gap: 12,
              marginTop: 8,
            }}>
              <Ionicons name="information-circle-outline" size={20} color={theme.colors.warning} />
              <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
                登入後可同步課表、成績與作業截止提醒
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
