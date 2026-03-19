import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { collection, getDocs } from "firebase/firestore";

import { Card, ErrorState, LoadingState, Pill, Screen } from "../ui/components";
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
  status?: string;
  role?: string;
};

type SessionRow = {
  id: string;
  groupId: string;
  groupName: string;
  active: boolean;
  attendeeCount?: number;
  startedAt: Date | null;
  endedAt: Date | null;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSessionTime(date: Date | null): string {
  if (!date) return "時間未知";
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AttendanceScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const { items: memberships, loading: membershipsLoading, error: membershipsError } = useAsyncList<CourseMembership>(
    async () => {
      if (!auth.user) return [];
      const snap = await getDocs(collection(db, "users", auth.user.uid, "groups"));
      return snap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
        .filter((row: any) => row.schoolId === school.id && row.status === "active" && row.type === "course");
    },
    [db, auth.user?.uid, school.id]
  );

  const { items: sessions, loading: sessionsLoading, error: sessionsError } = useAsyncList<SessionRow>(
    async () => {
      const targetGroups = routeGroupId
        ? memberships.filter((membership) => membership.groupId === routeGroupId)
        : memberships;

      if (targetGroups.length === 0) return [];

      const rows = await Promise.all(
        targetGroups.map(async (membership) => {
          const snap = await getDocs(collection(db, "groups", membership.groupId, "liveSessions")).catch(() => null);
          return (
            snap?.docs.map((doc) => {
              const data = doc.data() as any;
              return {
                id: doc.id,
                groupId: membership.groupId,
                groupName: membership.name,
                active: !!data.active,
                attendeeCount: data.attendeeCount ?? 0,
                startedAt: toDate(data.startedAt),
                endedAt: toDate(data.endedAt),
              } satisfies SessionRow;
            }) ?? []
          );
        })
      );

      return rows
        .flat()
        .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
        .slice(0, 12);
    },
    [db, routeGroupId, memberships.map((membership) => membership.groupId).join("|")]
  );

  const activeSessions = sessions.filter((session) => session.active);
  const completedSessions = sessions.filter((session) => !session.active);
  const roleMap = Object.fromEntries(memberships.map((membership) => [membership.groupId, membership.role]));

  if (!auth.user) {
    return (
      <Screen>
        <Card title="點名中心" subtitle="登入後即可查看課程點名與課堂簽到">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            目前會先沿用 live session 作為課堂簽到入口，後續再補正式的 attendanceSessions / attendanceRecords。
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
        <Card title="點名中心" subtitle="把課堂簽到、即時互動與出席紀錄收斂成正式教學流程">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${activeSessions.length} 堂進行中`} kind={activeSessions.length > 0 ? "danger" : "muted"} />
            <Pill text={`${completedSessions.length} 筆近期課堂`} kind="default" />
          </View>
        </Card>

        <Card title="進行中的課堂" subtitle="可直接進入 QR / 互動 / 回饋">
          <View style={{ gap: 10 }}>
            {activeSessions.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                目前沒有進行中的課堂互動。這裡已經是正式的點名入口，接下來可把 `attendanceSessions` 與 `attendanceRecords` 接進來。
              </Text>
            ) : (
              activeSessions.map((session) => (
                <Pressable
                  key={`${session.groupId}-${session.id}`}
                  onPress={() =>
                    nav?.navigate?.("Classroom", {
                      groupId: session.groupId,
                      sessionId: session.id,
                      isTeacher:
                        roleMap[session.groupId] === "owner" || roleMap[session.groupId] === "instructor",
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
                        開始時間：{formatSessionTime(session.startedAt)}
                      </Text>
                    </View>
                    <Pill text="進行中" kind="danger" />
                  </View>
                  <Text style={{ color: theme.colors.textSecondary }}>
                    已回報 / 簽到人數：{session.attendeeCount ?? 0}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </Card>

        <Card title="近期課堂紀錄" subtitle="作為正式出席紀錄的過渡層">
          <View style={{ gap: 10 }}>
            {completedSessions.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                尚無近期結束的課堂紀錄。當正式 `attendanceRecords` 上線後，這裡會顯示學生出席、遲到與補簽資料。
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
                    課堂時間：{formatSessionTime(session.startedAt)}
                  </Text>
                  <Text style={{ color: theme.colors.muted }}>
                    回報人數：{session.attendeeCount ?? 0}
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
