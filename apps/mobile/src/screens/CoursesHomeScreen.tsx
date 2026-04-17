/* eslint-disable */
import React, { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

function isTCSessionError(error: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes("tronclass") ||
    lower.includes("session") ||
    lower.includes("已失效") ||
    lower.includes("過期") ||
    lower.includes("重新登入") ||
    lower.includes("no tronclass backend session")
  );
}

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
    error: courseError,
    reload: courseReload,
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

        {courseError && isTCSessionError(courseError) && (
          <View
            style={{
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: '#FEF3C7',
              borderWidth: 1,
              borderColor: '#F59E0B33',
              gap: 8,
            }}
          >
            <Text style={{ color: '#92400E', fontSize: 13, fontWeight: '700' }}>
              TronClass 連線已過期
            </Text>
            <Text style={{ color: '#92400E', fontSize: 12, lineHeight: 18 }}>
              課程資料可能不完整，請重新登入學校帳號。
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: '#F59E0B',
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>重新登入</Text>
              </Pressable>
              <Pressable
                onPress={courseReload}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: '#FEF3C7',
                  borderWidth: 1,
                  borderColor: '#F59E0B55',
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text style={{ color: '#92400E', fontWeight: '700', fontSize: 12 }}>重試</Text>
              </Pressable>
            </View>
          </View>
        )}

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
            AI 工具
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
            <Pressable
              onPress={() => nav?.navigate?.("AIChat")}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
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
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: '#FF6B9A14',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="sparkles" size={16} color="#FF6B9A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>AI 助理</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>課業問答</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => nav?.navigate?.("AICourseAdvisor")}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
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
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: '#8B5CF614',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="school" size={16} color="#8B5CF6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>選課助理</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>AI 規劃</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
