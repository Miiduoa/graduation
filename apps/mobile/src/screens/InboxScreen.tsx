import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CourseSpace, InboxTask } from "../data";
import { Card, ErrorState, ListItem, LoadingState, Pill } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { positiveDeadlineLabel, sortByFoggModel } from "../utils/positiveFrame";

export function InboxScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const insets = useSafeAreaInsets();

  const { items: courseSpaces, loading: membershipsLoading, error: membershipsError } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [ds, auth.user?.uid, school.id]
  );

  const { items: inboxItems, loading: inboxLoading, error: inboxError } = useAsyncList<InboxTask>(
    async () => {
      if (!auth.user) return [];
      return ds.listInboxTasks(auth.user.uid, school.id);
    },
    [ds, auth.user?.uid, school.id, courseSpaces.map((courseSpace) => courseSpace.groupId).join("|")]
  );

  const liveCount = inboxItems.filter((item) => item.kind === "live").length;
  const dueCount = inboxItems.filter((item) => item.kind === "assignment" || item.kind === "quiz").length;
  const unreadCount = courseSpaces.reduce((sum, membership) => sum + (membership.unreadCount ?? 0), 0);

  // Fogg Model 排序：緊迫度 × 預計完成時間 → 最佳先做任務排最前面
  const topItems = useMemo(
    () => sortByFoggModel(inboxItems.map((item) => ({
      ...item,
      dueAt: item.dueAt ? new Date(item.dueAt) : null,
    }))).slice(0, 8),
    [inboxItems]
  );

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

  const headerArea = (
    <View
      style={{
        paddingTop: insets.top + 12,
        paddingBottom: 16,
        paddingHorizontal: 20,
        backgroundColor: theme.colors.bg,
      }}
    >
      <Text style={{ fontSize: 28, fontWeight: "900", color: theme.colors.text }}>今日任務</Text>
      <Text style={{ fontSize: 13, color: theme.colors.muted, marginTop: 3 }}>
        {inboxItems.length > 0
          ? `${inboxItems.length} 件待處理 · 從最容易的開始`
          : "目前一切順利！"
        }
      </Text>
    </View>
  );

  if (!auth.user) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {headerArea}
        <View style={{ padding: 16 }}>
          <Card title="收件匣" subtitle="登入後即可收到可執行的課程任務">
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              這裡不是單純通知列表，而是 TronClass 類任務入口，會把作業、測驗、課堂互動與未讀課程更新整合起來。
            </Text>
          </Card>
        </View>
      </View>
    );
  }

  if (membershipsLoading || inboxLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {headerArea}
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <LoadingState title="收件匣" subtitle="彙整今日待辦中..." rows={4} />
        </View>
      </View>
    );
  }

  const combinedError = membershipsError ?? inboxError;
  if (combinedError) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {headerArea}
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <ErrorState title="收件匣" subtitle="讀取收件匣失敗" hint={combinedError} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      {headerArea}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* 正向摘要卡片：用「已完成」視角而非「待完成」視角 */}
        <Card title="今日進展" subtitle="">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {liveCount > 0 && (
              <Pill text={`${liveCount} 堂課正在進行`} kind="accent" />
            )}
            {dueCount === 0 ? (
              <Pill text="近期任務都已妥善安排 ✓" kind="success" />
            ) : (
              <Pill text={`${dueCount} 件可以完成`} kind="warning" />
            )}
            {unreadCount > 0 && (
              <Pill text={`${unreadCount} 則新訊息`} kind="accent" />
            )}
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

        {/* 任務列表：Fogg Model 排序 + 正向語言框架 */}
        <Card title="準備好開始了嗎？" subtitle={topItems.length > 0 ? "從最容易的開始，建立動力" : "今天一切都安排妥當"}>
          <View style={{ gap: 10 }}>
            {topItems.length === 0 ? (
              <View style={{ alignItems: "center", padding: 16, gap: 8 }}>
                <Ionicons name="checkmark-circle" size={40} color={theme.colors.growth} />
                <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, textAlign: "center" }}>
                  太棒了！今天的任務都完成了
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
                  繼續保持這樣的好習慣！
                </Text>
              </View>
            ) : (
              topItems.map((item) => {
                const dueFrame = item.dueAt
                  ? positiveDeadlineLabel(new Date(item.dueAt))
                  : null;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => openInboxItem(item as any)}
                    style={({ pressed }) => ({
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      padding: 16,
                      opacity: pressed ? 0.82 : 1,
                      gap: 8,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>{item.title}</Text>
                        <Text style={{ color: theme.colors.muted, marginTop: 3, fontSize: 12 }}>{item.groupName}</Text>
                      </View>
                      <Pill
                        text={
                          item.kind === "live" ? "課堂" :
                          item.kind === "quiz" ? "評量" :
                          item.kind === "assignment" ? "作業" : "動態"
                        }
                        kind={item.kind === "live" ? "accent" : "warning"}
                      />
                    </View>
                    {/* 正向截止日期框架 */}
                    {dueFrame && (
                      <View style={{
                        flexDirection: "row", alignItems: "center", gap: 6,
                        backgroundColor: `${theme.colors.calm}15`,
                        paddingHorizontal: 10, paddingVertical: 5,
                        borderRadius: 8,
                      }}>
                        <Ionicons name="time-outline" size={13} color={theme.colors.calm} />
                        <Text style={{ color: theme.colors.calm, fontSize: 12, fontWeight: "600" }}>
                          {dueFrame.label}
                        </Text>
                        {dueFrame.subLabel && (
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>· {dueFrame.subLabel}</Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}
