import React, { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CourseSpace, InboxTask } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import {
  ActionableInboxRow,
  CompletionState,
  ContextStrip,
  TimelineCard,
} from "../ui/campusOs";
import { formatDueWindow, isTeachingRole, resolveRoleMode, toInboxItem } from "../utils/campusOs";

export function InboxScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const teachingMode = isTeachingRole(auth.profile?.role);

  const {
    items: courseSpaces,
    loading: membershipsLoading,
    refresh: refreshMemberships,
    refreshing: membershipsRefreshing,
  } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const {
    items: inboxTasks,
    loading: inboxLoading,
    refresh: refreshInbox,
    refreshing: inboxRefreshing,
  } = useAsyncList<InboxTask>(
    async () => {
      if (!auth.user) return [];
      return ds.listInboxTasks(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const inboxItems = useMemo(
    () => inboxTasks.map(toInboxItem).sort((a, b) => a.priority - b.priority),
    [inboxTasks]
  );

  const liveCount = inboxItems.filter((item) => item.kind === "live").length;
  const dueCount = inboxItems.filter((item) => item.kind === "assignment" || item.kind === "quiz").length;
  const unreadCount = courseSpaces.reduce((sum, membership) => sum + (membership.unreadCount ?? 0), 0);

  const openItem = (item: (typeof inboxItems)[number]) => {
    if (item.kind === "live" && item.sessionId) {
      nav?.navigate?.("課程", {
        screen: "Classroom",
        params: { groupId: item.groupId, sessionId: item.sessionId, isTeacher: teachingMode },
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={membershipsRefreshing || inboxRefreshing}
            onRefresh={async () => {
              await Promise.all([refreshMemberships(), refreshInbox()]);
            }}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
          gap: 14,
        }}
      >
        <ContextStrip
          eyebrow="收件匣"
          title={teachingMode ? "先看哪門課需要你介入" : "先看為什麼重要，再決定要不要做"}
          description={
            teachingMode
              ? "這裡不是單純通知列表。會優先整理待批改、待發布、課堂進行中與需要你回應的課程動態。"
              : "這裡不是純通知列表。每筆項目都會告訴你現在該不該做、拖著會有什麼影響、按下去會直接做什麼。"
          }
        />

        {!auth.user ? (
          <CompletionState
            title="登入後才會出現可執行的收件匣"
            description="收件匣會把課程更新、作業、評量、課堂與訊息整合成單一工作台。"
            actionLabel="前往登入"
            onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })}
          />
        ) : null}

        {auth.user ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>當前節奏</Text>
            <TimelineCard
              icon="pulse-outline"
              title={liveCount > 0 ? `${liveCount} 堂課正在進行` : "目前沒有進行中的課堂"}
              description={
                liveCount > 0
                  ? teachingMode
                    ? "若你正在授課，先進課堂確認簽到、互動與學生提問。"
                    : "若你現在在教室附近，先處理課堂與簽到，不要被其他資訊打斷。"
                  : teachingMode
                    ? "這表示你可以先處理待批改、待發布與課務安排。"
                    : "這表示你可以先處理截止、未讀與課程異動。"
              }
              meta={membershipsLoading || inboxLoading ? "整理中" : "課堂"}
              hint="當課堂開始時，它應該自動成為最前面的決策。"
              tint={liveCount > 0 ? theme.colors.urgent : theme.colors.calm}
              onPress={() => nav?.navigate?.("課程", { screen: "Attendance" })}
            />
            <TimelineCard
              icon={teachingMode ? "construct-outline" : "mail-unread-outline"}
              title={
                teachingMode
                  ? `${unreadCount} 則課程動態，${dueCount} 件待處理課務`
                  : `${unreadCount} 則課程未讀，${dueCount} 件近期待辦`
              }
              description={
                teachingMode
                  ? "先看真正會改變課堂節奏的事，像是待批改、待發布與學生提問。"
                  : "先看真正會改變下一步的更新，而不是被所有提醒同時轟炸。"
              }
              meta={inboxItems[0]?.dueAt ? formatDueWindow(new Date(inboxItems[0].dueAt)) : "已排序"}
              hint="收件匣會把任務壓力和可完成性一起考慮。"
              tint={theme.colors.warning}
            />
          </View>
        ) : null}

        {auth.user && inboxItems.length === 0 ? (
          teachingMode ? (
            <CompletionState
              title={roleMode === "admin" ? "目前沒有需要你立刻介入的校務事項" : "目前沒有待批改或待發布的課務"}
              description={
                roleMode === "admin"
                  ? "可以前往管理控制台檢查公告、活動與成員權限狀態。"
                  : "這表示目前教學節奏穩定。你可以回到課程中樞整理教材、檢查點名或安排下次上課。"
              }
              actionLabel={roleMode === "admin" ? "打開管理台" : "打開課程中樞"}
              onPress={() =>
                roleMode === "admin"
                  ? nav?.navigate?.("我的", { screen: "AdminDashboard" })
                  : nav?.navigate?.("課程", { screen: "CourseHub" })
              }
            />
          ) : (
            <CompletionState
              title="今天沒有需要你立刻介入的事項"
              description="這不是空白，而是代表你的當前節奏穩定。你可以回到 Today 或課程做更主動的安排。"
              actionLabel="打開課程"
              onPress={() => nav?.navigate?.("課程", { screen: "CourseHub" })}
            />
          )
        ) : null}

        {auth.user && inboxItems.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>可直接處理的項目</Text>
            {inboxItems.slice(0, 8).map((item) => (
              <ActionableInboxRow
                key={item.id}
                icon={
                  item.kind === "live"
                    ? "pulse-outline"
                    : item.kind === "assignment"
                      ? "document-text-outline"
                      : item.kind === "quiz"
                        ? "help-circle-outline"
                        : "mail-outline"
                }
                title={`${item.title} · ${item.groupName}`}
                reason={item.reason ?? "這個項目需要你確認下一步"}
                consequence={item.consequence ?? "後續可能變成更高壓的處理"}
                nextStep={item.nextStep ?? "先打開內容"}
                urgency={item.urgency}
                actionLabel={item.actionLabel}
                onPress={() => openItem(item)}
              />
            ))}
          </View>
        ) : null}

        {auth.user ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>其他入口</Text>
            <TimelineCard
              icon="grid-outline"
              title="課程中樞"
              description="課程、教材、評量、點名與分析的主入口"
              meta={`${courseSpaces.length} 門課`}
              onPress={() => nav?.navigate?.("課程", { screen: "CourseHub" })}
            />
            <TimelineCard
              icon="people-outline"
              title="群組與課程動態"
              description="需要回到貼文、Q&A 或討論時再進這裡"
              meta="交流"
              tint={theme.colors.roleTeacher}
              onPress={() => nav?.navigate?.("Groups")}
            />
            <TimelineCard
              icon="chatbubble-outline"
              title="私訊"
              description="一對一溝通留在這裡，不和 Today 混在一起"
              meta="訊息"
              tint={theme.colors.calm}
              onPress={() => nav?.navigate?.("Dms")}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
