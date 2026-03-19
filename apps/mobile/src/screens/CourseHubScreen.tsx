import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { collection, getDocs, limit, query, where } from "firebase/firestore";

import { Card, ErrorState, LoadingState, Pill, Screen, SectionTitle } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { getDb } from "../firebase";
import { useAsyncList } from "../hooks/useAsyncList";

type CourseMembership = {
  id: string;
  groupId: string;
  name: string;
  type?: string;
  role?: string;
  unreadCount?: number;
  status?: string;
};

type CourseSummary = {
  groupId: string;
  assignmentCount: number;
  dueSoonCount: number;
  quizCount: number;
  moduleCount: number;
  activeSessionId: string | null;
  unreadCount: number;
  latestDueAt: Date | null;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    return value.toDate();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDue(date: Date | null): string {
  if (!date) return "未設定截止";
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const db = getDb();

  const {
    items: memberships,
    loading: membershipsLoading,
    error: membershipsError,
    reload: reloadMemberships,
  } = useAsyncList<CourseMembership>(
    async () => {
      if (!auth.user) return [];
      const snap = await getDocs(collection(db, "users", auth.user.uid, "groups"));
      return snap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
        .filter((row: any) => row.schoolId === school.id && row.status === "active" && row.type === "course");
    },
    [db, auth.user?.uid, school.id]
  );

  const {
    items: summaries,
    loading: summariesLoading,
    error: summariesError,
    reload: reloadSummaries,
  } = useAsyncList<CourseSummary>(
    async () => {
      if (!auth.user || memberships.length === 0) return [];

      return Promise.all(
        memberships.map(async (membership) => {
          const groupId = membership.groupId;
          const [assignmentSnap, moduleSnap, liveSnap] = await Promise.all([
            getDocs(collection(db, "groups", groupId, "assignments")).catch(() => null),
            getDocs(collection(db, "groups", groupId, "modules")).catch(() => null),
            getDocs(
              query(
                collection(db, "groups", groupId, "liveSessions"),
                where("active", "==", true),
                limit(1)
              )
            ).catch(() => null),
          ]);

          const assignments = assignmentSnap?.docs.map((doc) => doc.data() as any) ?? [];
          const now = Date.now();
          const sevenDaysLater = now + 7 * 24 * 60 * 60 * 1000;

          const dueDates = assignments
            .map((assignment) => toDate(assignment.dueAt))
            .filter((date): date is Date => !!date)
            .sort((a, b) => a.getTime() - b.getTime());

          const dueSoonCount = dueDates.filter((date) => {
            const time = date.getTime();
            return time >= now && time <= sevenDaysLater;
          }).length;

          const quizCount = assignments.filter((assignment) =>
            assignment.type === "quiz" || assignment.type === "exam"
          ).length;

          return {
            groupId,
            assignmentCount: assignments.length,
            dueSoonCount,
            quizCount,
            moduleCount: moduleSnap?.size ?? 0,
            activeSessionId: liveSnap?.empty ? null : liveSnap?.docs[0]?.id ?? null,
            unreadCount: membership.unreadCount ?? 0,
            latestDueAt: dueDates[0] ?? null,
          };
        })
      );
    },
    [db, auth.user?.uid, memberships.map((membership) => membership.groupId).join("|")]
  );

  const selectedMembership = routeGroupId
    ? memberships.find((membership) => membership.groupId === routeGroupId) ?? null
    : null;

  const selectedRows = routeGroupId && selectedMembership ? [selectedMembership] : memberships;

  const summaryMap = useMemo(() => {
    return Object.fromEntries(summaries.map((summary) => [summary.groupId, summary]));
  }, [summaries]);

  const totalDueSoon = summaries.reduce((sum, summary) => sum + summary.dueSoonCount, 0);
  const totalQuizCount = summaries.reduce((sum, summary) => sum + summary.quizCount, 0);
  const activeSessions = summaries.filter((summary) => summary.activeSessionId).length;

  if (!auth.user) {
    return (
      <Screen>
        <Card title="課程中樞" subtitle="登入後即可使用完整 LMS 功能">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            TronClass 類功能要成立，課程、作業、測驗、點名與成績都必須跟你的身份綁在一起。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (membershipsLoading || summariesLoading) {
    return <LoadingState title="課程中樞" subtitle="整理課程空間中..." rows={4} />;
  }

  const combinedError = membershipsError ?? summariesError;
  if (combinedError) {
    return (
      <ErrorState
        title="課程中樞"
        subtitle="讀取課程資料失敗"
        hint={combinedError}
        actionText="重試"
        onAction={() => {
          reloadMemberships();
          reloadSummaries();
        }}
      />
    );
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title="課程中樞" subtitle="把課程空間、教材、作業、測驗、點名與分析接成同一條主流程">
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
              下一步要把正式課程空間資料模型建立起來，讓群組不再只是討論區，而是完整課程主頁。
            </Text>
          </Card>
        ) : null}

        {selectedRows.map((membership) => {
          const summary = summaryMap[membership.groupId];
          const courseName = membership.name || "未命名課程";

          return (
            <Card
              key={membership.groupId}
              title={courseName}
              subtitle={`課程空間 · ${summary?.assignmentCount ?? 0} 項作業 / ${summary?.quizCount ?? 0} 項評量`}
            >
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pill text={`${summary?.moduleCount ?? 0} 個教材單元`} kind="default" />
                <Pill text={`${summary?.dueSoonCount ?? 0} 項近期待辦`} kind={summary?.dueSoonCount ? "warning" : "success"} />
                {summary?.unreadCount ? <Pill text={`${summary.unreadCount} 則未讀`} kind="accent" /> : null}
                {summary?.activeSessionId ? <Pill text="課堂互動進行中" kind="danger" /> : null}
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
                    最近截止：{formatDue(summary?.latestDueAt ?? null)}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
                  這裡會逐步取代目前分散在群組、作業、成績與課堂互動頁的入口，成為真正的 TronClass 類課程主頁。
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                <ActionChip
                  icon="newspaper-outline"
                  label="課程動態"
                  tint={theme.colors.accent}
                  onPress={() => nav?.navigate?.("訊息", { screen: "GroupDetail", params: { groupId: membership.groupId } })}
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
                    nav?.navigate?.("訊息", {
                      screen: "GroupAssignments",
                      params: { groupId: membership.groupId },
                    })
                  }
                />
                <ActionChip
                  icon="help-circle-outline"
                  label="測驗"
                  tint="#7C3AED"
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
                {summary?.activeSessionId ? (
                  <ActionChip
                    icon="pulse-outline"
                    label="課堂"
                    tint="#059669"
                    onPress={() =>
                      nav?.navigate?.("Classroom", {
                        groupId: membership.groupId,
                        sessionId: summary.activeSessionId,
                        isTeacher: membership.role === "owner" || membership.role === "instructor",
                      })
                    }
                  />
                ) : null}
                <ActionChip
                  icon="stats-chart-outline"
                  label="成績"
                  tint="#0EA5E9"
                  onPress={() => nav?.navigate?.("Grades")}
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
        <Card subtitle="這一層現在是主幹入口，不再只是零散功能集合">
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>目前已接入的主模組</Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              課程空間、教材單元入口、作業入口、測驗入口、點名入口、成績頁、學習分析與課堂互動已被放進同一條課程主流程。
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
