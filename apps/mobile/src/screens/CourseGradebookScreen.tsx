/* eslint-disable */
import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { CourseGradebookData, CourseSpace } from "../data";
import { Button, Card, ErrorState, LoadingState, Pill, Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { canManageCourse, formatDateTime } from "../services/courseWorkspace";

export function CourseGradebookScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const routeGroupName = props?.route?.params?.groupName as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const {
    items: memberships,
    loading: membershipsLoading,
    error: membershipsError,
  } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [ds, auth.user?.uid, school.id]
  );

  const {
    items: gradebookRows,
    loading: gradebookLoading,
    error: gradebookError,
    reload: reloadGradebook,
  } = useAsyncList<CourseGradebookData>(
    async () => {
      if (!routeGroupId) return [];
      const gradebook = await ds.getCourseGradebook(routeGroupId);
      return gradebook ? [gradebook] : [];
    },
    [ds, routeGroupId]
  );

  const selectedMembership = memberships.find((membership) => membership.groupId === routeGroupId) ?? null;
  const selectedCourseName = routeGroupName ?? selectedMembership?.name ?? "課內成績簿";
  const isTeacher = canManageCourse(selectedMembership?.role);
  const gradebook = gradebookRows[0];

  const visibleRows = useMemo(() => {
    if (!gradebook) return [];
    if (isTeacher) return gradebook.rows;
    return gradebook.rows.filter((row) => row.uid === auth.user?.uid);
  }, [auth.user?.uid, gradebook, isTeacher]);

  if (!auth.user) {
    return (
      <Screen>
        <Card title="課內成績簿" subtitle="登入後即可查看課程內評分與總成績">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            這裡承接每門課的評分進度、各作業分解與期末總分，不再只有總成績查詢。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (membershipsLoading || (routeGroupId ? gradebookLoading : false)) {
    return <LoadingState title="課內成績簿" subtitle="整理課程成績中..." rows={4} />;
  }

  const combinedError = membershipsError ?? gradebookError;
  if (combinedError) {
    return (
      <ErrorState
        title="課內成績簿"
        subtitle="讀取成績簿失敗"
        hint={combinedError}
        actionText="重試"
        onAction={reloadGradebook}
      />
    );
  }

  if (!routeGroupId) {
    return (
      <Screen noPadding>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        >
          <Card title="課內成績簿" subtitle="每門課一份正式 gradebook">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              從這裡進入特定課程的成績簿，查看各作業評分、期末總分與發布狀態。
            </Text>
          </Card>

          {memberships.map((membership) => (
            <Card
              key={membership.groupId}
              title={membership.name}
              subtitle={canManageCourse(membership.role) ? "教師成績簿" : "我的課內成績"}
              onPress={() =>
                nav?.navigate?.("CourseGradebook", {
                  groupId: membership.groupId,
                  groupName: membership.name,
                })
              }
            >
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pill text={canManageCourse(membership.role) ? "教師視角" : "學生視角"} kind="accent" />
                <Pill text="正式 gradebook" kind="success" />
              </View>
            </Card>
          ))}
        </ScrollView>
      </Screen>
    );
  }

  if (!gradebook) {
    return <ErrorState title="課內成績簿" subtitle="找不到課程成績資料" />;
  }

  const gradedRows = gradebook.rows.filter((row) => row.finalScore !== null);
  const classAverage =
    gradedRows.length > 0
      ? Math.round((gradedRows.reduce((sum, row) => sum + (row.finalScore ?? 0), 0) / gradedRows.length) * 10) / 10
      : null;

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title={`${selectedCourseName} 成績簿`} subtitle={isTeacher ? "教師可查看整班成績與各作業分解" : "查看這門課的評分進度與期末總分"}>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${gradebook.assignments.length} 項評分項目`} kind="accent" />
            <Pill text={`${visibleRows.length} 位${isTeacher ? "學生" : "我的成績"}`} kind="default" />
            <Pill
              text={gradebook.finalScoresPublished ? "期末總分已發布" : "期末總分未發布"}
              kind={gradebook.finalScoresPublished ? "success" : "warning"}
            />
            {classAverage !== null ? <Pill text={`班平均 ${classAverage}`} kind="default" /> : null}
          </View>
        </Card>

        {isTeacher ? (
          <Card title="教師操作" subtitle="期末總分的計算與發布仍沿用課程作業頁的權重邏輯">
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                當各作業評分完成後，可到作業頁執行期末成績發布。成績簿會自動同步顯示最終結果。
              </Text>
              <Button
                text="前往作業與期末發布"
                kind="primary"
                onPress={() =>
                  nav?.navigate?.("收件匣", {
                    screen: "GroupAssignments",
                    params: { groupId: routeGroupId },
                  })
                }
              />
            </View>
          </Card>
        ) : null}

        <Card title="評分項目" subtitle={`最後發布：${formatDateTime(gradebook.finalScoresPublishedAt, "尚未發布")}`}>
          <View style={{ gap: 10 }}>
            {gradebook.assignments.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                這門課目前還沒有可計算的評分項目。先在作業或測驗中心建立評量即可開始累積成績。
              </Text>
            ) : (
              gradebook.assignments.map((assignment) => (
                <View
                  key={assignment.id}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }}>{assignment.title}</Text>
                    <Pill text={`${assignment.weight}%`} kind="accent" />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill text={`截止 ${formatDateTime(assignment.dueAt, "未設定")}`} kind="default" />
                    {assignment.averageScore !== null ? <Pill text={`平均 ${assignment.averageScore}`} kind="default" /> : null}
                    <Pill text={assignment.gradesPublished ? "已發布" : "未發布"} kind={assignment.gradesPublished ? "success" : "warning"} />
                  </View>
                </View>
              ))
            )}
          </View>
        </Card>

        {visibleRows.map((row) => (
          <Card
            key={row.uid}
            title={isTeacher ? row.displayName : "我的課程成績"}
            subtitle={row.department ?? (isTeacher ? `UID ${row.uid.slice(0, 8)}` : undefined)}
          >
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pill text={`總分 ${row.finalScore ?? "-"}`} kind={row.finalScore !== null ? "accent" : "muted"} />
              <Pill text={`評分進度 ${row.gradedAssignments}/${row.totalAssignments}`} kind="default" />
              <Pill
                text={row.result === "passed" ? "通過" : row.result === "failed" ? "未通過" : "尚未完成"}
                kind={row.result === "passed" ? "success" : row.result === "failed" ? "danger" : "warning"}
              />
            </View>

            <View style={{ gap: 8, marginTop: 12 }}>
              {row.assignmentBreakdown.map((entry) => (
                <View
                  key={`${row.uid}-${entry.assignmentId}`}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }}>{entry.title}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontWeight: "700" }}>
                      {entry.grade ?? "-"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill text={`${entry.weight}%`} kind="default" />
                    <Pill text={`繳交 ${formatDateTime(entry.submittedAt, "未繳交")}`} kind="default" />
                    {entry.isLate ? <Pill text="遲交" kind="warning" /> : null}
                  </View>
                  {entry.feedback ? (
                    <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>回饋：{entry.feedback}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
