/* eslint-disable */
import React, { useState, useEffect, useCallback } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { useDataSource } from "../hooks/useDataSource";
import { useSchedule } from "../state/schedule";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAmbientCues } from "../features/engagement";
import { AmbientCueCard } from "../ui/campusOs";
import type { Course, Assignment, AttendanceSession } from "../data/types";

type CourseStats = {
  course: Course;
  pendingAssignmentCount: number;
  attendanceRate: number;
};

export function TeachingHubScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const ds = useDataSource();
  const { getDaySchedule } = useSchedule();

  const [refreshing, setRefreshing] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [todayClasses, setTodayClasses] = React.useState<Course[]>([]);
  const [courseStats, setCourseStats] = React.useState<CourseStats[]>([]);
  const [totalPendingAssignments, setTotalPendingAssignments] = React.useState(0);
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: schoolId ?? null,
    uid: user?.uid ?? null,
    role: "teacher",
    surface: "teachingHub",
    limit: 1,
  });

  // Load teacher's courses and stats
  const loadCoursesData = useCallback(async () => {
    if (!ds || !user?.uid || !schoolId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Get today's schedule classes
      const now = new Date();
      const dayScheduleEvents = getDaySchedule(now);
      const todayScheduleClasses = dayScheduleEvents
        .filter((event) => event.courseId && event.type === "class")
        .map((event) => ({
          courseId: event.courseId,
          courseName: event.title,
          location: event.location,
          startTime: event.startTime,
          endTime: event.endTime,
        }));

      // Get all courses for the teacher
      let allCourses: Course[] = [];
      try {
        allCourses = await ds.listCourses(schoolId);
      } catch (e) {
        console.warn("[TeachingHub] Failed to load courses:", e);
        allCourses = [];
      }

      // Get today's actual class objects
      const todayClassObjects = todayScheduleClasses
        .map((schedClass) => allCourses.find((c) => c.id === schedClass.courseId))
        .filter((c): c is Course => Boolean(c));

      setTodayClasses(todayClassObjects);

      // Load stats for all courses
      const statsPromises = allCourses.slice(0, 10).map(async (course) => {
        let pendingCount = 0;
        let attendanceRate = 0;

        // Try to get assignments
        try {
          const assignments = await ds.listAssignments(course.id);
          const assignmentsWithSubmissions = await Promise.all(
            assignments.map(async (assignment) => {
              try {
                const submissions = await ds.listSubmissions(assignment.id);
                const ungraded = submissions.filter((sub) => !sub.gradedAt);
                return ungraded.length;
              } catch {
                return 0;
              }
            })
          );
          pendingCount = assignmentsWithSubmissions.reduce((a, b) => a + b, 0);
        } catch (e) {
          console.warn(`[TeachingHub] Failed to load assignments for course ${course.id}:`, e);
          pendingCount = 0;
        }

        // Try to get attendance stats (groupId matches courseId in this system)
        try {
          const sessions = await ds.listAttendanceSessions(user.uid, undefined, schoolId);
          const courseSessions = sessions.filter((s) => s.groupId === course.id);
          if (courseSessions.length > 0) {
            // attendeeCount is total who attended; use ratio of active vs total sessions
            const sessionsWithAttendees = courseSessions.filter((s) => (s.attendeeCount ?? 0) > 0);
            attendanceRate = Math.round((sessionsWithAttendees.length / courseSessions.length) * 100);
          }
        } catch (e) {
          console.warn(`[TeachingHub] Failed to load attendance for course ${course.id}:`, e);
          attendanceRate = 0;
        }

        return {
          course,
          pendingAssignmentCount: pendingCount,
          attendanceRate,
        };
      });

      const stats = await Promise.all(statsPromises);
      setCourseStats(stats);

      // Calculate total pending assignments
      const total = stats.reduce((sum, stat) => sum + stat.pendingAssignmentCount, 0);
      setTotalPendingAssignments(total);
    } catch (e) {
      console.error("[TeachingHub] Failed to load data:", e);
    } finally {
      setLoading(false);
    }
  }, [ds, user?.uid, schoolId, getDaySchedule]);

  // Initial load
  useEffect(() => {
    loadCoursesData();
  }, [loadCoursesData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCoursesData();
    setRefreshing(false);
  }, [loadCoursesData]);

  const quickActions = [
    {
      label: "評分",
      icon: "checkmark-circle-outline" as const,
      onPress: () => {
        if (courseStats.length > 0) {
          nav?.navigate?.("CourseGradebook", { courseId: courseStats[0].course.id });
        } else {
          nav?.navigate?.("CourseGradebook");
        }
      },
      color: theme.colors.success,
    },
    {
      label: "發公告",
      icon: "megaphone-outline" as const,
      onPress: () => nav?.navigate?.("CourseHub"),
      color: theme.colors.accent,
    },
    {
      label: "出缺勤",
      icon: "clipboard-outline" as const,
      onPress: () => nav?.navigate?.("Attendance"),
      color: theme.colors.warning,
    },
  ];

  // Show loading state if DataSource is not available
  if (!ds) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ marginTop: 12, color: theme.colors.textSecondary }}>初始化中...</Text>
      </View>
    );
  }

  // Show loading spinner while loading
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 20,
        }}
      >
        {/* Header */}
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: theme.colors.text }}>教學主流程</Text>
          <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>管理課程、評分與互動</Text>
        </View>

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

        {/* Today's Classes */}
        {todayClasses.length > 0 ? (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 16,
              gap: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>今日課程</Text>
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                {todayClasses.length} {todayClasses.length === 1 ? "堂課" : "堂課"}
              </Text>
            </View>
            <View style={{ gap: 8 }}>
              {todayClasses.map((cls, i) => {
                const scheduleEntry = cls.schedule?.[0];
                const time = scheduleEntry
                  ? `${scheduleEntry.startTime} - ${scheduleEntry.endTime}`
                  : "時間未定";
                const room = scheduleEntry?.location || "教室未定";

                return (
                  <Pressable
                    key={i}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      gap: 12,
                      padding: 10,
                      backgroundColor: pressed ? theme.colors.surface2 : "transparent",
                      borderRadius: 8,
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <View style={{ justifyContent: "center" }}>
                      <Ionicons name="time-outline" size={16} color={theme.colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}>
                        {cls.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                        {time} • {room}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 16,
              gap: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: "center",
              justifyContent: "center",
              minHeight: 100,
            }}
          >
            <Ionicons name="calendar-outline" size={32} color={theme.colors.muted} />
            <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>今日無課程</Text>
          </View>
        )}

        {/* Assignments to Grade */}
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            padding: 16,
            gap: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>待批改作業</Text>
            <Text style={{ fontSize: 12, color: totalPendingAssignments > 0 ? theme.colors.danger : theme.colors.success }}>
              {totalPendingAssignments} 份{totalPendingAssignments === 0 ? "已批改" : "未批改"}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => ({
              padding: 10,
              backgroundColor: pressed ? theme.colors.surface2 : "transparent",
              borderRadius: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              opacity: pressed ? 0.8 : 1,
            })}
            onPress={() => {
              if (courseStats.length > 0) {
                nav?.navigate?.("CourseGradebook", { courseId: courseStats[0].course.id });
              } else {
                nav?.navigate?.("CourseGradebook");
              }
            }}
          >
            <Ionicons name="list-outline" size={16} color={theme.colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.text }}>查看所有未批改作業</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>
        </View>

        {/* Attendance Summary */}
        {courseStats.length > 0 && (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 16,
              gap: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>出缺勤統計</Text>
              <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>課程概覽</Text>
            </View>
            <View style={{ gap: 8 }}>
              {courseStats.slice(0, 3).map((stat, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 13, color: theme.colors.text }}>{stat.course.name}</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.success }}>
                      {stat.attendanceRate > 0 ? `${stat.attendanceRate}%` : "-"}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>出席率</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.text }}>快速入口</Text>
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "space-between" }}>
            {quickActions.map((action, i) => (
              <Pressable
                key={i}
                onPress={action.onPress}
                style={({ pressed }) => ({
                  flex: 1,
                  backgroundColor: theme.colors.surface,
                  borderRadius: 12,
                  padding: 16,
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Ionicons name={action.icon} size={28} color={action.color} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.text, textAlign: "center" }}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Empty State */}
        {courseStats.length === 0 && todayClasses.length === 0 && (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              padding: 24,
              gap: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="folder-open-outline" size={40} color={theme.colors.muted} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.text }}>尚未有任何課程</Text>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, textAlign: "center" }}>
              您目前沒有指派任何課程。請聯絡系統管理員以新增課程。
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
