/* eslint-disable */
import React, { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CourseSpace, InboxTask } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { ContextStrip, RoleCtaCard, TimelineCard } from "../ui/campusOs";
import { formatDueWindow, isTeachingRole, resolveRoleMode, roleSummary } from "../utils/campusOs";

export function CoursesHomeScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const teachingMode = isTeachingRole(auth.profile?.role);

  const {
    items: courseSpaces,
    loading,
    refreshing,
    refresh,
  } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const { items: inboxTasks } = useAsyncList<InboxTask>(
    async () => {
      if (!auth.user) return [];
      return ds.listInboxTasks(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const activeCourse = courseSpaces[0] ?? null;
  const dueSoon = useMemo(
    () => inboxTasks.filter((task) => task.kind === "assignment" || task.kind === "quiz").slice(0, 1),
    [inboxTasks]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.md,
          paddingHorizontal: theme.space.lg,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: theme.space.lg,
        }}
      >
        <View style={{ gap: theme.space.xs }}>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? '700',
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: 'uppercase',
            }}
          >
            課程
          </Text>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.display.fontSize,
              fontWeight: theme.typography.display.fontWeight ?? '800',
              letterSpacing: theme.typography.display.letterSpacing,
            }}
          >
            {teachingMode ? "教學" : "課程"}
          </Text>
        </View>

        <View style={{ gap: theme.space.md }}>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? '700',
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: 'uppercase',
            }}
          >
            快速存取
          </Text>
          <View style={{ gap: theme.space.sm, flexDirection: 'row', flexWrap: 'wrap' }}>
            <Pressable
              onPress={() => nav?.navigate?.("CourseHub")}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 100,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>課程</Text>
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.("CourseModules")}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 100,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>教材</Text>
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.("QuizCenter")}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 100,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>評量</Text>
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.("Attendance")}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 100,
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.sm,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>出勤</Text>
            </Pressable>
          </View>
        </View>

        {activeCourse && (
          <View style={{ gap: theme.space.md }}>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.typography.overline.fontSize,
                fontWeight: theme.typography.overline.fontWeight ?? '700',
                letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                textTransform: 'uppercase',
              }}
            >
              當前課程
            </Text>
            <Pressable
              onPress={() => nav?.navigate?.("CourseHub", { groupId: activeCourse.groupId })}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                {activeCourse.name}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                {courseSpaces.length} 門課
              </Text>
            </Pressable>
          </View>
        )}

        {dueSoon.length > 0 && (
          <View style={{ gap: theme.space.md }}>
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.typography.overline.fontSize,
                fontWeight: theme.typography.overline.fontWeight ?? '700',
                letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                textTransform: 'uppercase',
              }}
            >
              待辦
            </Text>
            <Pressable
              onPress={() => nav?.navigate?.("收件匣")}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.md,
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.82 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                {dueSoon[0].title}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                {dueSoon[0].groupName} · {formatDueWindow(dueSoon[0].dueAt)}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
