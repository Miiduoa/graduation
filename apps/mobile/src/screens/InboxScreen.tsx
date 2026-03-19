import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { collection, getDocs, limit, query, where } from "firebase/firestore";

import { Card, ErrorState, ListItem, LoadingState, Pill, Screen } from "../ui/components";
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
  unreadCount?: number;
};

type InboxItem = {
  id: string;
  kind: "live" | "assignment" | "quiz" | "group";
  groupId: string;
  groupName: string;
  title: string;
  subtitle: string;
  sessionId?: string;
  assignmentId?: string;
  priority: number;
  dueAt?: Date | null;
  unreadCount?: number;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function InboxScreen(props: any) {
  const nav = props?.navigation;
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

  const { items: inboxItems, loading: inboxLoading, error: inboxError } = useAsyncList<InboxItem>(
    async () => {
      if (!auth.user || memberships.length === 0) return [];

      const now = Date.now();
      const items = await Promise.all(
        memberships.map(async (membership) => {
          const groupItems: InboxItem[] = [];

          if ((membership.unreadCount ?? 0) > 0) {
            groupItems.push({
              id: `group-${membership.groupId}`,
              kind: "group",
              groupId: membership.groupId,
              groupName: membership.name,
              title: `${membership.name} 有未讀更新`,
              subtitle: `有 ${membership.unreadCount} 則未讀課程動態`,
              priority: 4,
              unreadCount: membership.unreadCount,
            });
          }

          const liveSnap = await getDocs(
            query(
              collection(db, "groups", membership.groupId, "liveSessions"),
              where("active", "==", true),
              limit(1)
            )
          ).catch(() => null);

          if (liveSnap && !liveSnap.empty) {
            const liveDoc = liveSnap.docs[0];
            groupItems.push({
              id: `live-${membership.groupId}-${liveDoc.id}`,
              kind: "live",
              groupId: membership.groupId,
              groupName: membership.name,
              title: `${membership.name} 課堂互動進行中`,
              subtitle: "可直接進入點名、投票與課堂提問",
              sessionId: liveDoc.id,
              priority: 0,
            });
          }

          const assignmentSnap = await getDocs(collection(db, "groups", membership.groupId, "assignments")).catch(() => null);
          const assignments = assignmentSnap?.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })) ?? [];

          for (const assignment of assignments) {
            const dueAt = toDate(assignment.dueAt);
            if (!dueAt) continue;
            const diff = dueAt.getTime() - now;
            if (diff < 0 || diff > 7 * 24 * 60 * 60 * 1000) continue;

            const kind = assignment.type === "quiz" || assignment.type === "exam" ? "quiz" : "assignment";
            const kindLabel = kind === "quiz" ? "評量" : "作業";

            groupItems.push({
              id: `${kind}-${membership.groupId}-${assignment.id}`,
              kind,
              groupId: membership.groupId,
              groupName: membership.name,
              title: `${assignment.title}`,
              subtitle: `${kindLabel}將於 ${dueAt.toLocaleString("zh-TW", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })} 截止`,
              assignmentId: assignment.id,
              priority: kind === "quiz" ? 2 : 1,
              dueAt,
            });
          }

          return groupItems;
        })
      );

      return items
        .flat()
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          const timeA = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const timeB = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return timeA - timeB;
        })
        .slice(0, 12);
    },
    [db, auth.user?.uid, memberships.map((membership) => membership.groupId).join("|")]
  );

  const liveCount = inboxItems.filter((item) => item.kind === "live").length;
  const dueCount = inboxItems.filter((item) => item.kind === "assignment" || item.kind === "quiz").length;
  const unreadCount = memberships.reduce((sum, membership) => sum + (membership.unreadCount ?? 0), 0);

  const topItems = useMemo(() => inboxItems.slice(0, 8), [inboxItems]);

  const openInboxItem = (item: InboxItem) => {
    if (item.kind === "live" && item.sessionId) {
      nav?.navigate?.("課業", {
        screen: "Classroom",
        params: { groupId: item.groupId, sessionId: item.sessionId, isTeacher: false },
      });
      return;
    }

    if ((item.kind === "assignment" || item.kind === "quiz") && item.assignmentId) {
      nav?.navigate?.("AssignmentDetail", {
        groupId: item.groupId,
        assignmentId: item.assignmentId,
      });
      return;
    }

    nav?.navigate?.("GroupDetail", { groupId: item.groupId });
  };

  if (!auth.user) {
    return (
      <Screen>
        <Card title="收件匣" subtitle="登入後即可收到可執行的課程任務">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            這裡不是單純通知列表，而是 TronClass 類任務入口，會把作業、測驗、課堂互動與未讀課程更新整合起來。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (membershipsLoading || inboxLoading) {
    return <LoadingState title="收件匣" subtitle="彙整今日待辦中..." rows={4} />;
  }

  const combinedError = membershipsError ?? inboxError;
  if (combinedError) {
    return <ErrorState title="收件匣" subtitle="讀取收件匣失敗" hint={combinedError} />;
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card title="收件匣" subtitle="把課程待辦變成可以直接處理的工作項目">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${liveCount} 堂進行中`} kind={liveCount > 0 ? "danger" : "muted"} />
            <Pill text={`${dueCount} 項近期待辦`} kind={dueCount > 0 ? "warning" : "success"} />
            <Pill text={`${unreadCount} 則未讀`} kind={unreadCount > 0 ? "accent" : "muted"} />
          </View>
        </Card>

        <Card title="快速入口" subtitle="課程任務與交流的主工作台">
          <ListItem
            title="課程中樞"
            subtitle="查看課程空間、教材、測驗、點名與分析"
            icon="grid-outline"
            onPress={() => nav?.navigate?.("課業", { screen: "CourseHub" })}
          />
          <ListItem
            title="群組動態"
            subtitle="查看課程公告、Q&A 與作業討論"
            icon="people-outline"
            onPress={() => nav?.navigate?.("Groups")}
          />
          <ListItem
            title="私訊"
            subtitle="打開課堂與同學之間的私訊"
            icon="chatbubble-outline"
            onPress={() => nav?.navigate?.("Dms")}
          />
          <ListItem
            title="通知"
            subtitle="查看跨模組推播與系統提醒"
            icon="notifications-outline"
            onPress={() => nav?.navigate?.("我的", { screen: "Notifications" })}
          />
        </Card>

        <Card title="優先處理" subtitle={topItems.length > 0 ? "由近到遠排序" : "目前沒有急迫項目"}>
          <View style={{ gap: 10 }}>
            {topItems.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                目前沒有需要立刻處理的課程任務。下一步可把更多成績異動、點名缺席與教材更新也納入這裡。
              </Text>
            ) : (
              topItems.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => openInboxItem(item)}
                  style={({ pressed }) => ({
                    borderRadius: theme.radius.lg,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    padding: 14,
                    opacity: pressed ? 0.82 : 1,
                    gap: 8,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.title}</Text>
                      <Text style={{ color: theme.colors.muted, marginTop: 4 }}>{item.groupName}</Text>
                    </View>
                    <Pill
                      text={
                        item.kind === "live"
                          ? "課堂"
                          : item.kind === "quiz"
                            ? "評量"
                            : item.kind === "assignment"
                              ? "作業"
                              : "未讀"
                      }
                      kind={
                        item.kind === "live"
                          ? "danger"
                          : item.kind === "group"
                            ? "accent"
                            : "warning"
                      }
                    />
                  </View>
                  <Text style={{ color: theme.colors.textSecondary }}>{item.subtitle}</Text>
                </Pressable>
              ))
            )}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
