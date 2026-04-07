/* eslint-disable */
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { CourseSpace } from "../data";
import { ErrorState, LoadingState, Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { tcLogin } from "../services/tronClassClient";
import { refreshTCCourses } from "../services/puDataCache";

// ─── Course Card ──────────────────────────────────────────

function CourseCard(props: {
  course: CourseSpace;
  onPress?: () => void;
}) {
  const { course } = props;
  const hasDueSoon = course.dueSoonCount > 0;
  const hasAssignments = (course.assignmentCount ?? 0) > 0;

  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Course Name + Arrow */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: theme.colors.text,
              lineHeight: 22,
            }}
            numberOfLines={2}
          >
            {course.name || "未命名課程"}
          </Text>
          {course.description ? (
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.muted,
                marginTop: 4,
              }}
              numberOfLines={1}
            >
              {course.description}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: `${theme.colors.accent}12`,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
          }}
        >
          <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
        </View>
      </View>

      {/* Stats Row */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        {hasAssignments ? (
          <StatBadge
            icon="document-text-outline"
            text={`${course.assignmentCount} 項作業`}
            color="#F97316"
          />
        ) : null}
        {hasDueSoon ? (
          <StatBadge
            icon="alarm-outline"
            text={`${course.dueSoonCount} 項即將截止`}
            color="#DC2626"
          />
        ) : null}
        {(course.quizCount ?? 0) > 0 ? (
          <StatBadge
            icon="help-circle-outline"
            text={`${course.quizCount} 項測驗`}
            color={theme.colors.info}
          />
        ) : null}
        {course.memberCount ? (
          <StatBadge
            icon="people-outline"
            text={`${course.memberCount} 人`}
            color={theme.colors.muted}
          />
        ) : null}
      </View>

      {/* Due soon highlight */}
      {hasDueSoon && course.latestDueAt ? (
        <View
          style={{
            marginTop: 12,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: "#FEF2F2",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="time-outline" size={14} color="#DC2626" />
          <Text style={{ fontSize: 13, color: "#DC2626", fontWeight: "600" }}>
            最近截止：{formatDueDate(course.latestDueAt)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function StatBadge(props: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  color: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={props.icon} size={13} color={props.color} />
      <Text style={{ fontSize: 12, color: props.color, fontWeight: "600" }}>{props.text}</Text>
    </View>
  );
}

function formatDueDate(date: Date | null): string {
  if (!date) return "未設定";
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (diff < 0) return "已過期";
  if (hours < 1) return "不到 1 小時";
  if (hours < 24) return `${hours} 小時後`;
  if (days < 7) return `${days} 天後`;
  return date.toLocaleDateString("zh-TW", { month: "short", day: "numeric" });
}

// ─── Summary Header ──────────────────────────────────────

function SummaryHeader(props: {
  courseCount: number;
  dueSoonCount: number;
  quizCount: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        paddingHorizontal: 4,
      }}
    >
      <SummaryChip
        icon="book-outline"
        label="課程"
        value={String(props.courseCount)}
        color={theme.colors.accent}
      />
      <SummaryChip
        icon="alarm-outline"
        label="待交"
        value={String(props.dueSoonCount)}
        color={props.dueSoonCount > 0 ? "#DC2626" : theme.colors.muted}
      />
      <SummaryChip
        icon="help-circle-outline"
        label="測驗"
        value={String(props.quizCount)}
        color={props.quizCount > 0 ? theme.colors.info : theme.colors.muted}
      />
    </View>
  );
}

function SummaryChip(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.surface,
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
        gap: 4,
      }}
    >
      <Ionicons name={props.icon} size={20} color={props.color} />
      <Text style={{ fontSize: 22, fontWeight: "800", color: props.color }}>{props.value}</Text>
      <Text style={{ fontSize: 11, color: theme.colors.muted, fontWeight: "600" }}>{props.label}</Text>
    </View>
  );
}

// ─── Empty State ──────────────────────────────────────────

function EmptyState(props: { onRetry?: () => void; studentId?: string | null }) {
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleReLogin = async () => {
    if (!password.trim() || !props.studentId) return;
    setLoginLoading(true);
    setLoginError(null);
    try {
      const result = await tcLogin(props.studentId, password.trim());
      if (result.success) {
        // 重新登入成功 → 刷新課程
        await refreshTCCourses();
        setShowLogin(false);
        setPassword("");
        props.onRetry?.();
      } else {
        setLoginError(result.error ?? "登入失敗，請確認密碼");
      }
    } catch (err) {
      setLoginError("連線失敗，請稍後再試");
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 40,
        paddingHorizontal: 24,
        gap: 16,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: `${theme.colors.accent}12`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="school-outline" size={28} color={theme.colors.accent} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: "700", color: theme.colors.text, textAlign: "center" }}>
        尚未取得課程資料
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: theme.colors.muted,
          textAlign: "center",
          lineHeight: 22,
        }}
      >
        TronClass 連線已過期，請重新連線以載入課程。
      </Text>

      {!showLogin ? (
        <View style={{ gap: 10, alignItems: "center", width: "100%" }}>
          {props.onRetry ? (
            <Pressable
              onPress={props.onRetry}
              style={({ pressed }) => ({
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: 999,
                backgroundColor: theme.colors.accent,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>重新載入</Text>
            </Pressable>
          ) : null}
          {props.studentId ? (
            <Pressable
              onPress={() => setShowLogin(true)}
              style={({ pressed }) => ({
                paddingHorizontal: 24,
                paddingVertical: 12,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: theme.colors.accent,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 14 }}>
                重新連線 TronClass
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View
          style={{
            width: "100%",
            backgroundColor: theme.colors.surface,
            borderRadius: 16,
            padding: 20,
            borderWidth: 1,
            borderColor: theme.colors.border,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.text }}>
            重新連線 TronClass
          </Text>
          <Text style={{ fontSize: 13, color: theme.colors.muted, lineHeight: 20 }}>
            學號：{props.studentId}
          </Text>
          <TextInput
            placeholder="請輸入靜宜密碼"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            style={{
              borderWidth: 1,
              borderColor: loginError ? "#DC2626" : theme.colors.border,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontSize: 15,
              color: theme.colors.text,
              backgroundColor: "#FAFAFA",
            }}
            onSubmitEditing={handleReLogin}
            editable={!loginLoading}
          />
          {loginError ? (
            <Text style={{ fontSize: 13, color: "#DC2626" }}>{loginError}</Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, justifyContent: "flex-end" }}>
            <Pressable
              onPress={() => { setShowLogin(false); setLoginError(null); setPassword(""); }}
              disabled={loginLoading}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 999,
                opacity: pressed || loginLoading ? 0.5 : 1,
              })}
            >
              <Text style={{ color: theme.colors.muted, fontWeight: "600", fontSize: 14 }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={handleReLogin}
              disabled={loginLoading || !password.trim()}
              style={({ pressed }) => ({
                paddingHorizontal: 20,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: theme.colors.accent,
                opacity: pressed || loginLoading || !password.trim() ? 0.6 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              })}
            >
              {loginLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : null}
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                {loginLoading ? "連線中..." : "連線"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────

export function CourseHubScreen(props: any) {
  const nav = props?.navigation;
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

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const totalDueSoon = useMemo(
    () => courseSpaces.reduce((sum, c) => sum + c.dueSoonCount, 0),
    [courseSpaces]
  );
  const totalQuizCount = useMemo(
    () => courseSpaces.reduce((sum, c) => sum + c.quizCount, 0),
    [courseSpaces]
  );

  // Sort: courses with due-soon items first, then by name
  const sortedCourses = useMemo(
    () =>
      [...courseSpaces].sort((a, b) => {
        if (a.dueSoonCount > 0 && b.dueSoonCount === 0) return -1;
        if (a.dueSoonCount === 0 && b.dueSoonCount > 0) return 1;
        return (a.name ?? "").localeCompare(b.name ?? "", "zh-TW");
      }),
    [courseSpaces]
  );

  if (!auth.user) {
    return (
      <Screen>
        <EmptyState studentId={null} />
      </Screen>
    );
  }

  if (loading && courseSpaces.length === 0) {
    return <LoadingState title="我的課程" subtitle="正在載入 TronClass 課程..." rows={4} />;
  }

  if (error && courseSpaces.length === 0) {
    return (
      <ErrorState
        title="我的課程"
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
        contentContainerStyle={{
          gap: 14,
          padding: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Summary */}
        <SummaryHeader
          courseCount={sortedCourses.length}
          dueSoonCount={totalDueSoon}
          quizCount={totalQuizCount}
        />

        {/* Empty state */}
        {sortedCourses.length === 0 ? (
          <EmptyState onRetry={reload} studentId={auth.profile?.studentId ?? null} />
        ) : null}

        {/* Course List */}
        {sortedCourses.map((course) => (
          <CourseCard
            key={course.groupId}
            course={course}
            onPress={() => {
              nav?.navigate?.("CourseModules", {
                groupId: course.groupId,
                groupName: course.name,
              });
            }}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
