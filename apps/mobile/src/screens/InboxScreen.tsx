/* eslint-disable */
import React, { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { CourseSpace, InboxTask } from "../data";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAmbientCues } from "../features/engagement";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import {
  ActionableInboxRow,
  AmbientCueCard,
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
  const ambientRole = roleMode === "guest" ? "guest" : roleMode;

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
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: ambientRole,
    surface: "inbox",
    limit: 1,
  });

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
      nav?.navigate?.("收件匣", {
        screen: "AssignmentDetail",
        params: { groupId: item.groupId, assignmentId: item.assignmentId },
      });
      return;
    }

    nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: item.groupId } });
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
        <View style={{ gap: theme.space.xs }}>
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: theme.typography.overline.fontSize,
              fontWeight: theme.typography.overline.fontWeight ?? '700',
              letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
              textTransform: 'uppercase',
            }}
          >
            收件匣
          </Text>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.display.fontSize,
              fontWeight: theme.typography.display.fontWeight ?? '800',
              letterSpacing: theme.typography.display.letterSpacing,
            }}
          >
            任務
          </Text>
        </View>

        {!auth.user ? (
          <CompletionState
            title="登入後才會出現可執行的收件匣"
            description="收件匣會把課程更新、作業、評量、課堂與訊息整合成單一工作台。"
            actionLabel="前往登入"
            onPress={() => nav?.navigate?.("我的", { screen: "SSOLogin" })}
          />
        ) : null}

        {auth.user && inboxItems.length === 0 ? (
          <CompletionState
            title="目前沒有待辦項目"
            description="一切就緒，你可以回到課程或探索其他功能。"
            actionLabel="打開課程"
            onPress={() => nav?.navigate?.("課程", { screen: "CourseHub" })}
          />
        ) : null}

        {auth.user && ambientCue ? (
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

        {auth.user && inboxItems.length > 0 ? (
          <View style={{ gap: theme.space.md }}>
            <View style={{ gap: theme.space.md }}>
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

            <View style={{ gap: theme.space.md, marginTop: theme.space.lg }}>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontSize: theme.typography.overline.fontSize,
                  fontWeight: theme.typography.overline.fontWeight ?? '700',
                  letterSpacing: theme.typography.overline.letterSpacing ?? 1.5,
                  textTransform: 'uppercase',
                }}
              >
                快速存取
              </Text>
              <Pressable
                onPress={() => nav?.navigate?.("課程", { screen: "CourseHub" })}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                  課程中樞
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                  {courseSpaces.length} 門課
                </Text>
              </Pressable>
              <Pressable
                onPress={() => nav?.navigate?.("Dms")}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.md,
                  paddingVertical: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.82 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                  私訊
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 4 }}>
                  一對一溝通
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
