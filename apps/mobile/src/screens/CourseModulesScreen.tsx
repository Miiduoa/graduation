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

type CourseModuleRow = {
  id: string;
  title?: string;
  description?: string;
  week?: number;
  order?: number;
  groupId: string;
};

function ModuleRow(props: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          backgroundColor: `${props.tint}16`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={props.icon} size={20} color={props.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{props.title}</Text>
        <Text style={{ color: theme.colors.muted, marginTop: 3, lineHeight: 20 }}>{props.subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
    </Pressable>
  );
}

export function CourseModulesScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const routeGroupName = props?.route?.params?.groupName as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const {
    items: memberships,
    loading: membershipsLoading,
    error: membershipsError,
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
    items: modules,
    loading: modulesLoading,
    error: modulesError,
  } = useAsyncList<CourseModuleRow>(
    async () => {
      const targetGroups = routeGroupId
        ? memberships.filter((membership) => membership.groupId === routeGroupId)
        : memberships;

      if (targetGroups.length === 0) return [];

      const rows = await Promise.all(
        targetGroups.map(async (membership) => {
          const snap = await getDocs(collection(db, "groups", membership.groupId, "modules")).catch(() => null);
          return (
            snap?.docs.map((doc) => ({
              id: doc.id,
              groupId: membership.groupId,
              ...(doc.data() as any),
            })) ?? []
          );
        })
      );

      return rows
        .flat()
        .sort((a, b) => (a.order ?? a.week ?? 999) - (b.order ?? b.week ?? 999));
    },
    [db, routeGroupId, memberships.map((membership) => membership.groupId).join("|")]
  );

  const selectedCourseName =
    routeGroupName ??
    memberships.find((membership) => membership.groupId === routeGroupId)?.name ??
    "教材單元";

  const moduleCountByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of modules) {
      map[row.groupId] = (map[row.groupId] ?? 0) + 1;
    }
    return map;
  }, [modules]);

  if (!auth.user) {
    return (
      <Screen>
        <Card title="教材單元" subtitle="登入後即可看到課程教材與學習內容">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            教材模組會成為 TronClass parity 中最關鍵的一層，後續會正式承接檔案、影片、外部連結與每週進度。
          </Text>
        </Card>
      </Screen>
    );
  }

  if (membershipsLoading || modulesLoading) {
    return <LoadingState title="教材單元" subtitle="整理教材模組中..." rows={4} />;
  }

  const combinedError = membershipsError ?? modulesError;
  if (combinedError) {
    return <ErrorState title="教材單元" subtitle="載入教材失敗" hint={combinedError} />;
  }

  return (
    <Screen noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <Card
          title={routeGroupId ? `${selectedCourseName} 教材單元` : "教材單元"}
          subtitle="教材、檔案、影片與學習內容的正式入口"
        >
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${modules.length} 個模組`} kind="accent" />
            <Pill text={routeGroupId ? selectedCourseName : `${memberships.length} 門課`} kind="default" />
          </View>
        </Card>

        {!routeGroupId ? (
          memberships.map((membership) => (
            <Card
              key={membership.groupId}
              title={membership.name}
              subtitle={`目前 ${moduleCountByGroup[membership.groupId] ?? 0} 個教材模組`}
            >
              <ModuleRow
                title="進入本課教材"
                subtitle="查看單元、教材、學習內容與課程節奏"
                icon="albums-outline"
                tint="#2563EB"
                onPress={() =>
                  nav?.navigate?.("CourseModules", {
                    groupId: membership.groupId,
                    groupName: membership.name,
                  })
                }
              />
            </Card>
          ))
        ) : null}

        {routeGroupId ? (
          <>
            {modules.length > 0 ? (
              <Card title="正式教材模組" subtitle="依週次與單元整理的內容">
                <View style={{ gap: 10 }}>
                  {modules.map((module) => (
                    <ModuleRow
                      key={module.id}
                      title={module.title || `第 ${module.week ?? module.order ?? "-"} 單元`}
                      subtitle={module.description || "已建立教材模組，後續可承接檔案、影片與外部資源"}
                      icon="book-outline"
                      tint="#2563EB"
                    />
                  ))}
                </View>
              </Card>
            ) : (
              <Card title="教材模組骨架已建立" subtitle="這門課還沒有正式 modules 資料">
                <View style={{ gap: 10 }}>
                  <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                    目前這個入口已接上課程空間，接下來應把教材資料正式存進 `modules / materials`，而不是再散落在公告、貼文或聊天裡。
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill text="單元教材" kind="accent" />
                    <Pill text="檔案附件" kind="default" />
                    <Pill text="影音學習" kind="default" />
                    <Pill text="外部連結" kind="default" />
                  </View>
                </View>
              </Card>
            )}

            <Card title="目前可沿用的課程資產" subtitle="把既有課程頁內容逐步搬進教材模組">
              <View style={{ gap: 10 }}>
                <ModuleRow
                  title="課程動態與公告"
                  subtitle="先沿用現有課程群組的公告、貼文與 Q&A"
                  icon="newspaper-outline"
                  tint={theme.colors.accent}
                  onPress={() => nav?.navigate?.("訊息", { screen: "GroupDetail", params: { groupId: routeGroupId } })}
                />
                <ModuleRow
                  title="作業與評量"
                  subtitle="把每一週教材與作業對應起來，形成完整學習節奏"
                  icon="document-text-outline"
                  tint="#F97316"
                  onPress={() =>
                    nav?.navigate?.("訊息", {
                      screen: "GroupAssignments",
                      params: { groupId: routeGroupId },
                    })
                  }
                />
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
