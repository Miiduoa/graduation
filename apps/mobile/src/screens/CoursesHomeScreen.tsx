/* eslint-disable */
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
import { ContextStrip, RoleCtaCard, TimelineCard } from "../ui/campusOs";
import { formatDueWindow, isTeachingRole, resolveRoleMode, roleSummary } from "../utils/campusOs";

export function CoursesHomeScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const roleMode = resolveRoleMode(auth.profile?.role, !!auth.user);
  const roleCopy = roleSummary(roleMode);
  const teachingMode = isTeachingRole(auth.profile?.role);

  const {
    items: courseSpaces,
    loading,
    refreshing,
    refresh,
  } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const { items: inboxTasks } = useAsyncList<InboxTask>(
    async () => {
      if (!auth.user) return [];
      return ds.listInboxTasks(auth.user.uid, school.id);
    },
    [auth.user?.uid, ds, school.id]
  );

  const activeCourse = courseSpaces[0] ?? null;
  const dueSoon = useMemo(
    () => inboxTasks.filter((task) => task.kind === "assignment" || task.kind === "quiz").slice(0, 3),
    [inboxTasks]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
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
          eyebrow="課程"
          title={teachingMode ? "教學主流程" : "課程主流程"}
          description={`${roleCopy.hint}。每門課都從同一個骨架進入：總覽、教材、作業、測驗、點名、討論、成績、課堂、分析。`}
        />

        <RoleCtaCard
          icon={teachingMode ? "construct-outline" : "school-outline"}
          roleLabel={teachingMode ? "教師骨架" : "學生骨架"}
          title={teachingMode ? "從課程空間開始管理一整堂課" : "從課程空間開始完成整條學習路徑"}
          description={
            teachingMode
              ? "不要再先建群組再補內容。直接進課程中樞整理教材、評量、點名與課堂互動。"
              : "不要跨頁找教材、作業和課堂互動。先進課程中樞，之後每一步都沿同一條路往下。"
          }
          tone={teachingMode ? "teacher" : "student"}
          actionLabel={teachingMode ? "打開課程中樞" : "進入課程中樞"}
          onPress={() => nav?.navigate?.("CourseHub")}
        />

        <View style={{ gap: 10 }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>目前最值得先處理</Text>
          <TimelineCard
            icon="layers-outline"
            title={activeCourse ? activeCourse.name : "尚未建立課程節奏"}
            description={
              activeCourse
                ? `${activeCourse.moduleCount} 個教材單元 · ${activeCourse.assignmentCount} 項作業 · ${activeCourse.quizCount} 項評量`
                : "登入後會自動整理你的課程空間，讓課程、教材與評量進同一個入口。"
            }
            meta={activeCourse ? `${courseSpaces.length} 門課` : loading ? "整理中" : "待登入"}
            hint="先進入課程中樞，再從單一骨架切到教材、測驗、點名與成績。"
            tint={theme.colors.roleTeacher}
            onPress={() =>
              nav?.navigate?.("CourseHub", activeCourse ? { groupId: activeCourse.groupId } : undefined)
            }
          />
          <TimelineCard
            icon="checkmark-done-outline"
            title={dueSoon.length > 0 ? `${dueSoon.length} 件課務即將到期` : "近期沒有高壓課務"}
            description={
              dueSoon[0]
                ? `${dueSoon[0].groupName} · ${dueSoon[0].title}`
                : "這表示你可以把注意力放在教材整理、下次上課或課堂互動。"
            }
            meta={dueSoon[0]?.dueAt ? formatDueWindow(new Date(dueSoon[0].dueAt)) : "節奏穩定"}
            hint="把 deadline 從分散頁面拉回課程主流程，降低遺漏風險。"
            tint={dueSoon.length > 0 ? theme.colors.warning : theme.colors.growth}
            onPress={() => nav?.navigate?.("收件匣")}
          />
          <TimelineCard
            icon="stats-chart-outline"
            title={teachingMode ? "用分析找到最需要介入的課" : "用分析找出最危險的課"}
            description={
              teachingMode
                ? "先看哪門課教材不足、互動偏低或評量節奏不清。"
                : "先看哪門課最容易晚交、最需要優先整理。"
            }
            meta="分析"
            hint="分析不是另一個孤立頁面，而是課程決策的下一步。"
            tint={theme.colors.calm}
            onPress={() => nav?.navigate?.("LearningAnalytics")}
          />
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "800" }}>課程骨架入口</Text>
          <TimelineCard
            icon="albums-outline"
            title="教材單元"
            description="把單元、教材、檔案與外部資源放進統一結構。"
            meta="教材"
            onPress={() => nav?.navigate?.("CourseModules")}
          />
          <TimelineCard
            icon="help-circle-outline"
            title="測驗與評量"
            description="測驗、作業和成績要被看成同一條評量流程，而不是各自分散。"
            meta="評量"
            tint={theme.colors.achievement}
            onPress={() => nav?.navigate?.("QuizCenter")}
          />
          <TimelineCard
            icon="pulse-outline"
            title="課堂與點名"
            description="上課前後最需要的入口應該就在課程主流程裡。"
            meta="課中"
            tint={theme.colors.urgent}
            onPress={() => nav?.navigate?.("Attendance")}
          />
        </View>
      </ScrollView>
    </View>
  );
}
