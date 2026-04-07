/* eslint-disable */
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
import { useAmbientCues } from "../features/engagement";
import { AmbientCueCard } from "../ui/campusOs";
import { getFreshnessState, resolveRoleMode } from "../utils/campusOs";

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

function SocialSnippet(props: {
  memberCount?: number;
  activeCount?: number;
  completedCount?: number;
  completionRate?: number;
  updatedAt?: Date | null;
  onOpenGroup?: () => void;
}) {
  const activeCount = props.activeCount ?? 0;
  const completedCount = props.completedCount ?? 0;
  const distinctUserCount = Math.max(activeCount, completedCount);
  const isFresh = props.updatedAt ? getFreshnessState(props.updatedAt) !== "stale" : false;

  if (!isFresh || distinctUserCount < 3 || (props.memberCount ?? 0) < 3) {
    return null;
  }

  const avatarCount = Math.min(props.memberCount ?? 0, 4);
  const anonymousMarkers = Array.from({ length: avatarCount }, (_, index) => index);
  const primaryLabel =
    activeCount >= 3
      ? `${activeCount} 位同學最近有互動`
      : `已有 ${completedCount} 位同學完成近期作業`;
  const secondaryLabel =
    completedCount >= 3
      ? `這門課的近期完成節奏已經形成${props.completionRate ? ` · ${props.completionRate}% 已跟上` : ""}`
      : "這門課最近有人先完成，現在跟上比較不容易累積壓力";

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
            {primaryLabel}
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
          {anonymousMarkers.map((marker, index) => (
            <View
              key={marker}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: theme.colors.surface2,
                borderWidth: 2,
                borderColor: theme.colors.bg,
                alignItems: "center",
                justifyContent: "center",
                marginLeft: index === 0 ? 0 : -6,
                zIndex: avatarCount - index,
              }}
            >
              <Ionicons name="person" size={12} color={theme.colors.muted} />
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 12, color: theme.colors.muted, flex: 1 }}>
          {secondaryLabel}
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
              width: `${Math.min(props.completionRate ?? Math.round((completedCount / Math.max(props.memberCount ?? 1, 1)) * 100), 100)}%`,
              height: "100%",
              borderRadius: 2,
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
        <Text style={{ fontSize: 10, color: theme.colors.muted, fontWeight: "600" }}>
          {props.completionRate ?? Math.round((completedCount / Math.max(props.memberCount ?? 1, 1)) * 100)}% 完成率
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
  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);

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
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: roleMode === "guest" ? "guest" : roleMode,
    surface: "courseHub",
    limit: 1,
  });

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
    if (isTCSessionError(error)) {
      return (
        <Screen>
          <Card title="TronClass 連線已過期" subtitle="需要重新登入才能載入課程資料">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              TronClass 的登入狀態已失效，請重新登入學校帳號以重新建立連線。
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable
                onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.accent,
                  alignItems: "center",
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>重新登入</Text>
              </Pressable>
              <Pressable
                onPress={reload}
                style={({ pressed }) => ({
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  alignItems: "center",
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>重試</Text>
              </Pressable>
            </View>
          </Card>
        </Screen>
      );
    }
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

        {selectedRows.length === 0 ? (
          <Card title="尚未找到課程空間" subtitle="目前沒有可用的 course group">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              如果你已有課程，可能是 TronClass 連線已過期。嘗試重新登入學校帳號，或確認課程已加入課表。
            </Text>
            <Pressable
              onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })}
              style={({ pressed }) => ({
                marginTop: 12,
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: "center",
                alignSelf: "flex-start",
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 13 }}>重新登入</Text>
            </Pressable>
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
                memberCount={membership.memberCount}
                activeCount={membership.activeLearnerCount}
                completedCount={membership.completedAssignmentCount}
                completionRate={membership.completionRate}
                updatedAt={membership.socialProofUpdatedAt}
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
