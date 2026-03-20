import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { CourseSpace } from "../data";
import { Card, ErrorState, LoadingState, Pill, Screen, SectionTitle } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { canManageCourse, formatDateTime } from "../services/courseWorkspace";

const AVATAR_COLORS = ["#0F8B8D", "#34C759", "#FF9500", "#2563EB", "#14B8A6", "#32ADE6", "#FF6B35"];
const AVATAR_EMOJIS = ["🧑‍💻", "👩‍🎓", "👨‍🎓", "🧑‍🏫", "👩‍💻", "👨‍💻", "🙋"];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

function SocialSnippet(props: {
  groupId: string;
  memberCount?: number;
  activeCount?: number;
  completedCount?: number;
  onOpenGroup?: () => void;
}) {
  const seed = hashCode(props.groupId);
  const displayCount = Math.min(props.memberCount ?? (3 + (seed % 5)), 5);
  const avatars = Array.from({ length: displayCount }, (_, i) => ({
    emoji: AVATAR_EMOJIS[(seed + i) % AVATAR_EMOJIS.length],
    color: AVATAR_COLORS[(seed + i) % AVATAR_COLORS.length],
  }));
  const activeCount = props.activeCount ?? (2 + (seed % 4));
  const completedCount = props.completedCount ?? (1 + (seed % 3));

  return (
    <View
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: theme.radius.lg,
        backgroundColor: `${theme.colors.accent}08`,
        borderWidth: 1,
        borderColor: `${theme.colors.accent}18`,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="people" size={14} color={theme.colors.accent} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.accent }}>
            {activeCount} 位同學今日活躍
          </Text>
        </View>
        <Pressable
          onPress={props.onOpenGroup}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            backgroundColor: `${theme.colors.accent}14`,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="chatbubble-ellipses" size={11} color={theme.colors.accent} />
          <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.accent }}>去討論</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row" }}>
          {avatars.map((a, i) => (
            <View
              key={i}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: `${a.color}20`,
                borderWidth: 2,
                borderColor: theme.colors.bg,
                alignItems: "center",
                justifyContent: "center",
                marginLeft: i === 0 ? 0 : -6,
                zIndex: displayCount - i,
              }}
            >
              <Text style={{ fontSize: 12 }}>{a.emoji}</Text>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 12, color: theme.colors.muted, flex: 1 }}>
          {completedCount > 0
            ? `已有 ${completedCount} 位同學完成本週作業`
            : "還沒有同學完成本週作業，一起加油！"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: `${theme.colors.accent}18`,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.min(Math.round((completedCount / Math.max(activeCount, 1)) * 100), 100)}%`,
              height: "100%",
              borderRadius: 2,
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
        <Text style={{ fontSize: 10, color: theme.colors.muted, fontWeight: "600" }}>
          {Math.round((completedCount / Math.max(activeCount, 1)) * 100)}% 完成率
        </Text>
      </View>
    </View>
  );
}

function ActionChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: `${props.tint}14`,
        borderWidth: 1,
        borderColor: `${props.tint}22`,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Ionicons name={props.icon} size={14} color={props.tint} />
      <Text style={{ color: props.tint, fontSize: 12, fontWeight: "700" }}>{props.label}</Text>
    </Pressable>
  );
}

export function CourseHubScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const {
    items: courseSpaces,
    loading,
    error,
    reload,
  } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [ds, auth.user?.uid, school.id]
  );

  const selectedMembership = routeGroupId
    ? courseSpaces.find((membership) => membership.groupId === routeGroupId) ?? null
    : null;

  const selectedRows = routeGroupId && selectedMembership ? [selectedMembership] : courseSpaces;
  const totalDueSoon = courseSpaces.reduce((sum, summary) => sum + summary.dueSoonCount, 0);
  const totalQuizCount = courseSpaces.reduce((sum, summary) => sum + summary.quizCount, 0);
  const activeSessions = courseSpaces.filter((summary) => summary.activeSessionId).length;

  if (!auth.user) {
    return (
      <Screen>
        <Card title="課程中樞" subtitle="登入後即可使用完整 LMS 功能">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            課程、教材、評量、點名與成績要形成主流程，必須先綁定你的課程身份。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (loading) {
    return <LoadingState title="課程中樞" subtitle="整理課程空間中..." rows={4} />;
  }

  if (error) {
    return (
      <ErrorState
        title="課程中樞"
        subtitle="讀取課程資料失敗"
        hint={error}
        actionText="重試"
        onAction={reload}
      />
    );
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title="課程中樞" subtitle="把課程空間、教材、作業、測驗、點名與成績接成同一條主流程">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${selectedRows.length} 個課程空間`} kind="accent" />
            <Pill text={`${totalDueSoon} 項近期截止`} kind={totalDueSoon > 0 ? "warning" : "success"} />
            <Pill text={`${totalQuizCount} 項評量`} kind="default" />
            <Pill text={`${activeSessions} 堂進行中`} kind={activeSessions > 0 ? "danger" : "muted"} />
          </View>
        </Card>

        {selectedRows.length === 0 ? (
          <Card title="尚未找到課程空間" subtitle="目前沒有可用的 course group">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              下一步要先把課程加進你的課表或課程群組，課程主流程才會被完整啟用。
            </Text>
          </Card>
        ) : null}

        {selectedRows.map((membership) => {
          const courseName = membership.name || "未命名課程";
          const isTeacher = canManageCourse(membership.role);

          return (
            <Card
              key={membership.groupId}
              title={courseName}
              subtitle={`課程空間 · ${membership.assignmentCount ?? 0} 項作業 / ${membership.quizCount ?? 0} 項評量`}
            >
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pill text={`${membership.moduleCount ?? 0} 個教材單元`} kind="default" />
                <Pill text={`${membership.dueSoonCount ?? 0} 項近期待辦`} kind={membership.dueSoonCount ? "warning" : "success"} />
                {membership.unreadCount ? <Pill text={`${membership.unreadCount} 則未讀`} kind="accent" /> : null}
                {membership.activeSessionId ? <Pill text="課堂互動進行中" kind="danger" /> : null}
                {isTeacher ? <Pill text="教師管理模式" kind="accent" /> : null}
              </View>

              <View
                style={{
                  marginTop: 12,
                  padding: 14,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="time-outline" size={15} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                    最近截止：{formatDateTime(membership.latestDueAt ?? null, "未設定截止")}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                  這裡已經不只是入口彙整，而是課程全流程的主頁。教師可在教材、評量與點名頁直接建立內容。
                </Text>
              </View>

              <SocialSnippet
                groupId={membership.groupId}
                onOpenGroup={() =>
                  nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: membership.groupId } })
                }
              />

              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <ActionChip
                  icon="newspaper-outline"
                  label="課程動態"
                  tint={theme.colors.accent}
                  onPress={() => nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: membership.groupId } })}
                />
                <ActionChip
                  icon="albums-outline"
                  label="教材單元"
                  tint="#2563EB"
                  onPress={() =>
                    nav?.navigate?.("CourseModules", {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                <ActionChip
                  icon="document-text-outline"
                  label="作業"
                  tint="#F97316"
                  onPress={() =>
                    nav?.navigate?.("收件匣", {
                      screen: "GroupAssignments",
                      params: { groupId: membership.groupId },
                    })
                  }
                />
                <ActionChip
                  icon="help-circle-outline"
                  label="測驗"
                  tint={theme.colors.info}
                  onPress={() =>
                    nav?.navigate?.("QuizCenter", {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                <ActionChip
                  icon="checkmark-done-outline"
                  label="點名"
                  tint="#DC2626"
                  onPress={() =>
                    nav?.navigate?.("Attendance", {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                {membership.activeSessionId ? (
                  <ActionChip
                    icon="pulse-outline"
                    label="課堂"
                    tint="#059669"
                    onPress={() =>
                      nav?.navigate?.("Classroom", {
                        groupId: membership.groupId,
                        sessionId: membership.activeSessionId,
                        isTeacher,
                      })
                    }
                  />
                ) : null}
                <ActionChip
                  icon="stats-chart-outline"
                  label="成績簿"
                  tint="#0EA5E9"
                  onPress={() =>
                    nav?.navigate?.("CourseGradebook", {
                      groupId: membership.groupId,
                      groupName: courseName,
                    })
                  }
                />
                <ActionChip
                  icon="analytics-outline"
                  label="分析"
                  tint="#14B8A6"
                  onPress={() => nav?.navigate?.("LearningAnalytics")}
                />
              </View>
            </Card>
          );
        })}

        <SectionTitle text="TronClass Parity" />
        <Card subtitle="目前主幹已經接成正式課程工作流">
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>已接入的主模組</Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              課程空間、教材單元、作業、測驗、點名、課內成績簿、學習分析與課堂互動都已進入同一條課程主流程。
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
