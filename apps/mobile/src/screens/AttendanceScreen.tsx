import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { AttendanceSession, CourseSpace } from "../data";
import { Button, Card, ErrorState, LoadingState, Pill, Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { canManageCourse, formatDateTime } from "../services/courseWorkspace";

export function AttendanceScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const routeGroupName = props?.route?.params?.groupName as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const { items: memberships, loading: membershipsLoading, error: membershipsError } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [ds, auth.user?.uid, school.id]
  );

  const {
    items: sessions,
    loading: sessionsLoading,
    error: sessionsError,
    reload: reloadSessions,
  } = useAsyncList<AttendanceSession>(
    async () => {
      if (!auth.user) return [];
      return ds.listAttendanceSessions(auth.user.uid, routeGroupId, school.id);
    },
    [ds, auth.user?.uid, routeGroupId, school.id, memberships.map((membership) => membership.groupId).join("|")]
  );

  const selectedMembership = memberships.find((membership) => membership.groupId === routeGroupId) ?? null;
  const selectedCourseName = routeGroupName ?? selectedMembership?.name ?? "點名中心";
  const canEditCourse = canManageCourse(selectedMembership?.role);
  const activeSessions = sessions.filter((session) => session.active);
  const completedSessions = sessions.filter((session) => !session.active);

  const onStartSession = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!routeGroupId) {
      setErr("請先進入特定課程後再啟動點名");
      return;
    }
    if (!canEditCourse) {
      setErr("你沒有權限啟動課堂點名");
      return;
    }

    setStarting(true);
    try {
      const result = await ds.startAttendanceSession({ courseSpaceId: routeGroupId });
      setSuccessMsg("課堂已啟動，學生現在可掃碼或加入簽到");
      reloadSessions();
      nav?.navigate?.("Classroom", {
        groupId: routeGroupId,
        sessionId: result.sessionId,
        isTeacher: true,
      });
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "啟動點名失敗");
    } finally {
      setStarting(false);
    }
  };

  if (!auth.user) {
    return (
      <Screen>
        <Card title="點名中心" subtitle="登入後即可查看課程點名與課堂簽到">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            這裡會承接課堂簽到、出席記錄與 QR 點名，成為正式 LMS 的點名中心。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (membershipsLoading || sessionsLoading) {
    return <LoadingState title="點名中心" subtitle="整理課堂點名資料中..." rows={4} />;
  }

  const combinedError = membershipsError ?? sessionsError;
  if (combinedError) {
    return <ErrorState title="點名中心" subtitle="讀取點名失敗" hint={combinedError} />;
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title={routeGroupId ? `${selectedCourseName} 點名中心` : "點名中心"} subtitle="把課堂簽到、即時互動與出席紀錄收斂成正式流程">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${activeSessions.length} 堂進行中`} kind={activeSessions.length > 0 ? "danger" : "muted"} />
            <Pill text={`${completedSessions.length} 筆近期課堂`} kind="default" />
            {routeGroupId && canEditCourse ? <Pill text="教師可直接啟動點名" kind="success" /> : null}
          </View>
        </Card>

        {err ? (
          <Card variant="filled">
            <Text style={{ color: theme.colors.danger }}>{err}</Text>
          </Card>
        ) : null}
        {successMsg ? (
          <Card variant="filled">
            <Text style={{ color: theme.colors.success }}>{successMsg}</Text>
          </Card>
        ) : null}

        {routeGroupId && canEditCourse ? (
          <Card title="教師控制台" subtitle="啟動一堂新的點名 / 即時互動課堂">
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                啟動後會同步建立 `liveSessions` 與正式 `attendanceSessions`。學生可用 QR Code 或一般加入方式完成簽到。
              </Text>
              <Button text={starting ? "啟動中..." : "開始本堂點名"} kind="primary" disabled={starting} onPress={onStartSession} />
            </View>
          </Card>
        ) : null}

        <Card title="進行中的課堂" subtitle="可直接進入 QR、互動與點名總覽">
          <View style={{ gap: 10 }}>
            {activeSessions.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                目前沒有進行中的課堂互動。當教師啟動點名後，這裡會即時顯示出席狀況。
              </Text>
            ) : (
              activeSessions.map((session) => (
                <Pressable
                  key={`${session.groupId}-${session.id}`}
                  onPress={() =>
                    nav?.navigate?.("Classroom", {
                      groupId: session.groupId,
                      sessionId: session.id,
                      isTeacher: canManageCourse(
                        memberships.find((membership) => membership.groupId === session.groupId)?.role
                      ),
                    })
                  }
                  style={({ pressed }) => ({
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    padding: 14,
                    opacity: pressed ? 0.8 : 1,
                    gap: 8,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{session.groupName}</Text>
                      <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
                        開始時間：{formatDateTime(session.startedAt, "時間未知")}
                      </Text>
                    </View>
                    <Pill text="進行中" kind="danger" />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill text={`簽到 ${session.attendeeCount ?? 0} 人`} kind="default" />
                    {session.source === "attendance" ? <Pill text="正式 attendanceSessions" kind="success" /> : null}
                    {session.attendanceMode ? <Pill text={session.attendanceMode} kind="default" /> : null}
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </Card>

        <Card title="近期課堂紀錄" subtitle="作為正式出席紀錄與補簽流程的基礎">
          <View style={{ gap: 10 }}>
            {completedSessions.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                尚無近期結束的課堂紀錄。現在系統已會優先讀取正式 `attendanceSessions` 資料。
              </Text>
            ) : (
              completedSessions.map((session) => (
                <View
                  key={`${session.groupId}-${session.id}`}
                  style={{
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    padding: 14,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }}>{session.groupName}</Text>
                    <Pill text="已結束" kind="muted" />
                  </View>
                  <Text style={{ color: theme.colors.muted }}>
                    課堂時間：{formatDateTime(session.startedAt, "時間未知")}
                  </Text>
                  <Text style={{ color: theme.colors.muted }}>
                    簽到人數：{session.attendeeCount ?? 0}
                  </Text>
                </View>
              ))
            )}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
