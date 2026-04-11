/* eslint-disable */
import React, { useMemo, useState, useCallback } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
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
import { tcLogin } from "../services/tronClassClient";
import { refreshTCCourses } from "../services/puDataCache";

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

  // TronClass 登入狀態
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [tcPassword, setTcPassword] = useState("");
  const [tcLoggingIn, setTcLoggingIn] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const studentId = auth.profile?.studentId ?? "";

  const handleTCLogin = useCallback(async () => {
    if (!studentId || !tcPassword) {
      Alert.alert("提示", "請輸入密碼");
      return;
    }
    setTcLoggingIn(true);
    setTcError(null);
    try {
      const result = await tcLogin(studentId, tcPassword);
      if (result.success) {
        setShowLoginForm(false);
        setTcPassword("");
        setTcError(null);
        // 登入成功後刷新課程
        await refreshTCCourses();
        reload();
      } else {
        setTcError(result.error ?? "登入失敗");
      }
    } catch (err) {
      setTcError("連線失敗，請檢查網路");
    } finally {
      setTcLoggingIn(false);
    }
  }, [studentId, tcPassword, reload]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshTCCourses();
      reload();
    } catch { /* ignore */ }
    setRefreshing(false);
  }, [reload]);

  const selectedMembership = useMemo(
    () =>
      routeGroupId
        ? courseSpaces.find((membership) => membership.groupId === routeGroupId) ?? null
        : null,
    [routeGroupId, courseSpaces]
  );

  const selectedRows = useMemo(
    () => (routeGroupId && selectedMembership ? [selectedMembership] : courseSpaces),
    [routeGroupId, selectedMembership, courseSpaces]
  );

  const { totalDueSoon, totalQuizCount, activeSessions } = useMemo(() => {
    let dueSoon = 0;
    let quiz = 0;
    let active = 0;

    for (const summary of courseSpaces) {
      dueSoon += summary.dueSoonCount;
      quiz += summary.quizCount;
      if (summary.activeSessionId) active += 1;
    }

    return {
      totalDueSoon: dueSoon,
      totalQuizCount: quiz,
      activeSessions: active,
    };
  }, [courseSpaces]);
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

  // 如果錯誤是 TronClass session 過期，不顯示 ErrorState，
  // 而是顯示空狀態 + TronClass 登入表單
  const isTCSessionError = error && (
    error.includes("TronClass session") ||
    error.includes("TronClass 代理") ||
    error.includes("重新登入")
  );

  if (error && !isTCSessionError) {
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* 統計摘要 */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {[
            { icon: "book-outline" as const, count: selectedRows.length, label: "課程" },
            { icon: "document-text-outline" as const, count: totalDueSoon, label: "待交" },
            { icon: "help-circle-outline" as const, count: totalQuizCount, label: "測驗" },
          ].map((stat) => (
            <View
              key={stat.label}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Ionicons name={stat.icon} size={20} color={theme.colors.muted} />
              <Text style={{ fontSize: 22, fontWeight: "800", color: stat.count > 0 ? theme.colors.accent : theme.colors.text, marginTop: 4 }}>
                {stat.count}
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>{stat.label}</Text>
            </View>
          ))}
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

        {/* 空狀態：TronClass 登入 */}
        {(selectedRows.length === 0 || isTCSessionError) ? (
          <View style={{ alignItems: "center", paddingVertical: 30, gap: 12 }}>
            <Ionicons name="school-outline" size={48} color={theme.colors.accent} style={{ opacity: 0.5 }} />
            <Text style={{ fontSize: 17, fontWeight: "700", color: theme.colors.text }}>尚未取得課程資料</Text>
            <Text style={{ color: theme.colors.muted, textAlign: "center", lineHeight: 20 }}>
              TronClass 連線已過期，請重新連線以載入課程。
            </Text>

            {!showLoginForm ? (
              <View style={{ gap: 10, marginTop: 8, alignItems: "center" }}>
                <Pressable
                  onPress={handleRefresh}
                  style={({ pressed }) => ({
                    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 22,
                    backgroundColor: theme.colors.accent, opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>重新載入</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowLoginForm(true)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 22,
                    borderWidth: 1.5, borderColor: theme.colors.accent, opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 15 }}>重新連線 TronClass</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{
                width: "100%", padding: 16, borderRadius: 14,
                backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, gap: 12,
              }}>
                <Text style={{ fontWeight: "700", fontSize: 15, color: theme.colors.text }}>重新連線 TronClass</Text>
                {studentId ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>學號：{studentId}</Text>
                ) : null}
                <TextInput
                  placeholder="輸入密碼（校務系統密碼）"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                  value={tcPassword}
                  onChangeText={setTcPassword}
                  editable={!tcLoggingIn}
                  autoCapitalize="none"
                  style={{
                    borderWidth: 1, borderColor: tcError ? "#DC2626" : theme.colors.border,
                    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
                    fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.bg,
                  }}
                />
                {tcError ? (
                  <Text style={{ color: "#DC2626", fontSize: 13 }}>{tcError}</Text>
                ) : null}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 4 }}>
                  <Pressable onPress={() => { setShowLoginForm(false); setTcError(null); }}>
                    <Text style={{ color: theme.colors.muted, fontSize: 15, paddingVertical: 8 }}>取消</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleTCLogin}
                    disabled={tcLoggingIn}
                    style={({ pressed }) => ({
                      paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20,
                      backgroundColor: theme.colors.accent, opacity: (pressed || tcLoggingIn) ? 0.7 : 1,
                    })}
                  >
                    {tcLoggingIn ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>連線</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
          </View>
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
