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
};

type QuizItem = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  description?: string;
  dueAt?: any;
  type: "quiz" | "exam";
  gradesPublished?: boolean;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDueText(value: any): string {
  const date = toDate(value);
  if (!date) return "未設定時間";
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function QuizCenterScreen(props: any) {
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

  const { items: quizzes, loading: quizzesLoading, error: quizzesError } = useAsyncList<QuizItem>(
    async () => {
      const targetGroups = routeGroupId
        ? memberships.filter((membership) => membership.groupId === routeGroupId)
        : memberships;

      if (targetGroups.length === 0) return [];

      const rows = await Promise.all(
        targetGroups.map(async (membership) => {
          const snap = await getDocs(collection(db, "groups", membership.groupId, "assignments")).catch(() => null);
          return (
            snap?.docs
              .map((doc) => ({ id: doc.id, groupId: membership.groupId, groupName: membership.name, ...(doc.data() as any) }))
              .filter((row: any) => row.type === "quiz" || row.type === "exam") ?? []
          );
        })
      );

      return rows
        .flat()
        .sort((a, b) => {
          const timeA = toDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const timeB = toDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return timeA - timeB;
        });
    },
    [db, routeGroupId, memberships.map((membership) => membership.groupId).join("|")]
  );

  const quizCount = quizzes.filter((item) => item.type === "quiz").length;
  const examCount = quizzes.filter((item) => item.type === "exam").length;
  const publishedCount = quizzes.filter((item) => item.gradesPublished).length;

  const upcoming = useMemo(() => {
    const now = Date.now();
    return quizzes.filter((item) => {
      const time = toDate(item.dueAt)?.getTime();
      return typeof time === "number" && time >= now;
    });
  }, [quizzes]);

  if (!auth.user) {
    return (
      <Screen>
        <Card title="測驗中心" subtitle="登入後即可查看測驗與考試">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            這裡會承接 TronClass 類的測驗、考試、題庫與自動評量流程。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (membershipsLoading || quizzesLoading) {
    return <LoadingState title="測驗中心" subtitle="整理評量資料中..." rows={4} />;
  }

  const combinedError = membershipsError ?? quizzesError;
  if (combinedError) {
    return <ErrorState title="測驗中心" subtitle="讀取測驗失敗" hint={combinedError} />;
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title="測驗中心" subtitle="把 quiz / exam 從作業分支提升成正式評量入口">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${quizCount} 項測驗`} kind="accent" />
            <Pill text={`${examCount} 項考試`} kind="warning" />
            <Pill text={`${publishedCount} 項已發布成績`} kind={publishedCount > 0 ? "success" : "muted"} />
          </View>
        </Card>

        <Card title="近期評量" subtitle={`${upcoming.length} 項待進行`}>
          <View style={{ gap: 10 }}>
            {upcoming.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                目前沒有即將到來的 quiz / exam。接下來要把正式 `quizzes / questionBanks` 資料模型補上，讓題庫、抽題與自動批改能獨立運作。
              </Text>
            ) : (
              upcoming.map((item) => (
                <Pressable
                  key={`${item.groupId}-${item.id}`}
                  onPress={() =>
                    nav?.navigate?.("訊息", {
                      screen: "AssignmentDetail",
                      params: { groupId: item.groupId, assignmentId: item.id },
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
                      <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.title}</Text>
                      <Text style={{ color: theme.colors.muted, marginTop: 4 }}>{item.groupName}</Text>
                    </View>
                    <Pill text={item.type === "quiz" ? "測驗" : "考試"} kind={item.type === "quiz" ? "accent" : "warning"} />
                  </View>
                  <Text style={{ color: theme.colors.textSecondary }}>截止 / 開始：{formatDueText(item.dueAt)}</Text>
                </Pressable>
              ))
            )}
          </View>
        </Card>

        <Card title="接下來一定要補的 TronClass 能力" subtitle="這一層已經有正式入口，但資料模型還要再補齊">
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pill text="題庫" kind="default" />
              <Pill text="題型管理" kind="default" />
              <Pill text="隨機抽題" kind="default" />
              <Pill text="自動批改" kind="default" />
              <Pill text="測驗報表" kind="default" />
            </View>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              這一版先把評量入口接上課程主流程，下一步應把 quiz 不再只依附於 assignment，而是升級成正式評量物件。
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
