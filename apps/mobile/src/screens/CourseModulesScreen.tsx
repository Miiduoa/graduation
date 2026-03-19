import React, { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { CourseModule, CourseSpace } from "../data";
import { Button, Card, ErrorState, LoadingState, Pill, Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { canManageCourse } from "../services/courseWorkspace";

function ModuleRow(props: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  onPress?: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      style={({ pressed }) => ({
        gap: 10,
        padding: 14,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed && props.onPress ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
        {props.onPress ? <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} /> : null}
      </View>
      {props.footer}
    </Pressable>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.colors.muted}
        multiline={props.multiline}
        style={{
          minHeight: props.multiline ? 88 : undefined,
          paddingHorizontal: 12,
          paddingVertical: props.multiline ? 12 : 10,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          color: theme.colors.text,
          textAlignVertical: props.multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

export function CourseModulesScreen(props: any) {
  const nav = props?.navigation;
  const routeGroupId = props?.route?.params?.groupId as string | undefined;
  const routeGroupName = props?.route?.params?.groupName as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weekText, setWeekText] = useState("");
  const [orderText, setOrderText] = useState("");
  const [durationText, setDurationText] = useState("");
  const [resourceLabel, setResourceLabel] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");

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
    items: modules,
    loading: modulesLoading,
    error: modulesError,
    reload: reloadModules,
  } = useAsyncList<CourseModule>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseModules(auth.user.uid, routeGroupId, school.id);
    },
    [ds, auth.user?.uid, routeGroupId, school.id, memberships.map((membership) => membership.groupId).join("|")]
  );

  const selectedMembership = memberships.find((membership) => membership.groupId === routeGroupId) ?? null;
  const selectedCourseName = routeGroupName ?? selectedMembership?.name ?? "教材單元";
  const canEditCourse = canManageCourse(selectedMembership?.role);

  const moduleCountByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of modules) {
      map[row.groupId] = (map[row.groupId] ?? 0) + 1;
    }
    return map;
  }, [modules]);

  const onCreateModule = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!routeGroupId || !auth.user) {
      setErr("缺少課程或登入狀態");
      return;
    }
    if (!canEditCourse) {
      setErr("你沒有權限建立教材單元");
      return;
    }
    if (!title.trim()) {
      setErr("請輸入單元標題");
      return;
    }

    const week = weekText.trim() ? Number(weekText.trim()) : undefined;
    const order = orderText.trim() ? Number(orderText.trim()) : undefined;
    const estimatedMinutes = durationText.trim() ? Number(durationText.trim()) : undefined;

    if ((weekText.trim() && !Number.isFinite(week)) || (orderText.trim() && !Number.isFinite(order))) {
      setErr("週次與排序需為數字");
      return;
    }
    if (durationText.trim() && (!Number.isFinite(estimatedMinutes) || estimatedMinutes! <= 0)) {
      setErr("預估時間需為正數分鐘");
      return;
    }
    if (resourceUrl.trim() && !/^https?:\/\//.test(resourceUrl.trim())) {
      setErr("教材連結需以 http:// 或 https:// 開頭");
      return;
    }

    setSaving(true);
    try {
      await ds.createCourseModule({
        courseSpaceId: routeGroupId,
        title,
        description,
        week,
        order,
        estimatedMinutes,
        resourceLabel,
        resourceUrl,
        createdBy: auth.user.uid,
        createdByEmail: auth.user.email ?? null,
        schoolId: school.id,
      });
      setTitle("");
      setDescription("");
      setWeekText("");
      setOrderText("");
      setDurationText("");
      setResourceLabel("");
      setResourceUrl("");
      setSuccessMsg("教材單元已建立");
      reloadModules();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "建立教材單元失敗");
    } finally {
      setSaving(false);
    }
  };

  if (!auth.user) {
    return (
      <Screen>
        <Card title="教材單元" subtitle="登入後即可看到課程教材與學習內容">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            教材模組會承接每週內容、附件、影片與外部資源，成為正式 LMS 的學習骨架。
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
            {routeGroupId && canEditCourse ? <Pill text="教師可直接新增模組" kind="success" /> : null}
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

        {routeGroupId && canEditCourse ? (
          <Card title="建立教材模組" subtitle="教師可直接新增週次、教材連結與學習時長">
            <View style={{ gap: 10 }}>
              <Field label="單元標題" value={title} onChangeText={setTitle} placeholder="例如：第 5 週｜排序與搜尋" />
              <Field
                label="單元說明"
                value={description}
                onChangeText={setDescription}
                placeholder="輸入本週學習重點、作業提醒或預習要求"
                multiline
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field label="週次" value={weekText} onChangeText={setWeekText} placeholder="5" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="排序" value={orderText} onChangeText={setOrderText} placeholder="5" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="時長(分)" value={durationText} onChangeText={setDurationText} placeholder="45" />
                </View>
              </View>
              <Field label="資源名稱" value={resourceLabel} onChangeText={setResourceLabel} placeholder="例如：本週投影片" />
              <Field
                label="資源連結"
                value={resourceUrl}
                onChangeText={setResourceUrl}
                placeholder="https://..."
              />
              <Button text={saving ? "建立中..." : "建立教材模組"} kind="primary" disabled={saving} onPress={onCreateModule} />
            </View>
          </Card>
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
                      subtitle={module.description || "已建立教材模組，可持續擴充檔案、影片與外部資源"}
                      icon="book-outline"
                      tint="#2563EB"
                      onPress={
                        module.resourceUrl
                          ? () => Linking.openURL(module.resourceUrl!)
                          : undefined
                      }
                      footer={
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          {module.week ? <Pill text={`第 ${module.week} 週`} kind="default" /> : null}
                          {module.estimatedMinutes ? <Pill text={`${module.estimatedMinutes} 分鐘`} kind="default" /> : null}
                          {module.resourceUrl ? (
                            <Pill text={module.resourceLabel || "外部教材"} kind="accent" />
                          ) : null}
                          {module.published ? <Pill text="已發布" kind="success" /> : null}
                        </View>
                      }
                    />
                  ))}
                </View>
              </Card>
            ) : (
              <Card title="這門課尚未建立教材模組" subtitle="現在已可直接建立正式 modules 資料">
                <View style={{ gap: 10 }}>
                  <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                    目前這個入口已接上正式 `modules` collection，不再只是設計骨架。教師可先建立週次與教材連結，後續再擴充檔案與影音。
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill text="單元教材" kind="accent" />
                    <Pill text="外部連結" kind="default" />
                    <Pill text="週次節奏" kind="default" />
                    <Pill text="學習時長" kind="default" />
                  </View>
                </View>
              </Card>
            )}

            <Card title="目前可沿用的課程資產" subtitle="把既有課程頁內容逐步搬進教材模組">
              <View style={{ gap: 10 }}>
                <ModuleRow
                  title="課程動態與公告"
                  subtitle="沿用現有課程群組的公告、貼文與 Q&A"
                  icon="newspaper-outline"
                  tint={theme.colors.accent}
                  onPress={() => nav?.navigate?.("訊息", { screen: "GroupDetail", params: { groupId: routeGroupId } })}
                />
                <ModuleRow
                  title="作業與評量"
                  subtitle="把單元內容與作業、測驗對應起來，形成完整學習節奏"
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
