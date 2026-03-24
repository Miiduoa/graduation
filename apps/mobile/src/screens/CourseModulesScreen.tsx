/* eslint-disable */
import React, { useMemo, useState, useEffect } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { CourseModule, CourseSpace } from "../data";
import { Button, Card, ErrorState, LoadingState, Pill, Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { canManageCourse } from "../services/courseWorkspace";

type ContentType = "pdf" | "video" | "document" | "link" | "slide";
type CompletionStatus = "not_started" | "in_progress" | "completed";

interface ContentItem {
  id: string;
  type: ContentType;
  label: string;
  url?: string;
  duration?: number;
}

interface ModuleProgress {
  moduleId: string;
  status: CompletionStatus;
  completedAt?: string;
}

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

function getContentTypeIcon(type: ContentType): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "pdf":
      return "document-text-outline";
    case "video":
      return "play-circle-outline";
    case "document":
      return "document-outline";
    case "slide":
      return "easel-outline";
    case "link":
    default:
      return "open-outline";
  }
}

function getContentTypeLabel(type: ContentType): string {
  switch (type) {
    case "pdf":
      return "PDF";
    case "video":
      return "影片";
    case "document":
      return "文件";
    case "slide":
      return "投影片";
    case "link":
    default:
      return "連結";
  }
}

function ContentItemCard(props: {
  item: ContentItem;
  onPress?: () => void;
}) {
  const icon = getContentTypeIcon(props.item.type);
  const label = getContentTypeLabel(props.item.type);

  const iconColor =
    props.item.type === "video"
      ? theme.colors.danger
      : props.item.type === "pdf"
      ? theme.colors.accent
      : props.item.type === "slide"
      ? theme.colors.warning
      : theme.colors.info;

  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderRadius: theme.radius.md,
        backgroundColor: pressed && props.onPress ? theme.colors.surface3 : theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed && props.onPress ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: `${iconColor}16`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>
          {props.item.label}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
          {label}
          {props.item.duration ? ` • ${props.item.duration} 分` : ""}
        </Text>
      </View>
      {props.onPress ? <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} /> : null}
    </Pressable>
  );
}

function ProgressIndicator(props: { status: CompletionStatus; size?: number }) {
  const size = props.size ?? 20;
  if (props.status === "completed") {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.success,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="checkmark" size={size * 0.6} color="white" />
      </View>
    );
  } else if (props.status === "in_progress") {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: theme.colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: size * 0.4,
            height: size * 0.4,
            borderRadius: size * 0.2,
            backgroundColor: theme.colors.accent,
          }}
        />
      </View>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: theme.colors.border,
      }}
    />
  );
}

const DEMO_MODULES: CourseModule[] = [
  {
    id: "demo-1",
    groupId: "demo",
    groupName: "示例課程",
    title: "第 1 週｜課程介紹",
    description: "了解本學期課程目標、評分方式與教材結構",
    week: 1,
    order: 1,
    estimatedMinutes: 45,
    published: true,
    materials: [
      {
        id: "mat-1-1",
        moduleId: "demo-1",
        groupId: "demo",
        type: "file",
        label: "課程大綱與評分標準",
      },
      {
        id: "mat-1-2",
        moduleId: "demo-1",
        groupId: "demo",
        type: "video",
        label: "授課教授課程介紹影片",
      },
    ],
  },
  {
    id: "demo-2",
    groupId: "demo",
    groupName: "示例課程",
    title: "第 2 週｜基礎概念",
    description: "學習本課程的基礎概念與理論基礎",
    week: 2,
    order: 2,
    estimatedMinutes: 90,
    published: true,
    materials: [
      {
        id: "mat-2-1",
        moduleId: "demo-2",
        groupId: "demo",
        type: "file",
        label: "基礎概念投影片",
      },
      {
        id: "mat-2-2",
        moduleId: "demo-2",
        groupId: "demo",
        type: "document",
        label: "補充講義與筆記",
      },
    ],
  },
  {
    id: "demo-3",
    groupId: "demo",
    groupName: "示例課程",
    title: "第 3 週｜進階主題",
    description: "深入探討進階主題與實際應用",
    week: 3,
    order: 3,
    estimatedMinutes: 120,
    published: true,
    materials: [
      {
        id: "mat-3-1",
        moduleId: "demo-3",
        groupId: "demo",
        type: "video",
        label: "進階主題講解",
      },
      {
        id: "mat-3-2",
        moduleId: "demo-3",
        groupId: "demo",
        type: "file",
        label: "個案研究與實例分析",
      },
    ],
  },
  {
    id: "demo-4",
    groupId: "demo",
    groupName: "示例課程",
    title: "第 4 週｜實作練習",
    description: "動手做練習，應用學習的知識",
    week: 4,
    order: 4,
    estimatedMinutes: 60,
    published: true,
    materials: [
      {
        id: "mat-4-1",
        moduleId: "demo-4",
        groupId: "demo",
        type: "link",
        label: "線上實作環境",
        url: "https://example.com/practice",
      },
      {
        id: "mat-4-2",
        moduleId: "demo-4",
        groupId: "demo",
        type: "document",
        label: "練習題與解答",
      },
    ],
  },
];

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
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [moduleProgress, setModuleProgress] = useState<Record<string, ModuleProgress>>({});
  const [loadingProgress, setLoadingProgress] = useState(true);

  // Load progress from AsyncStorage
  useEffect(() => {
    const loadProgress = async () => {
      try {
        setLoadingProgress(true);
        const progressKey = `course_progress_${routeGroupId}`;
        const stored = await AsyncStorage.getItem(progressKey);
        if (stored) {
          setModuleProgress(JSON.parse(stored));
        }
      } catch (error) {
        console.error("Failed to load progress:", error);
      } finally {
        setLoadingProgress(false);
      }
    };

    if (routeGroupId) {
      loadProgress();
    }
  }, [routeGroupId]);

  const saveProgress = async (progress: Record<string, ModuleProgress>) => {
    try {
      const progressKey = `course_progress_${routeGroupId}`;
      await AsyncStorage.setItem(progressKey, JSON.stringify(progress));
    } catch (error) {
      console.error("Failed to save progress:", error);
    }
  };

  const toggleModuleCompletion = async (moduleId: string) => {
    const current = moduleProgress[moduleId];
    const newStatus: CompletionStatus =
      current?.status === "completed" ? "not_started" : "completed";

    const newProgress = {
      ...moduleProgress,
      [moduleId]: {
        moduleId,
        status: newStatus,
        completedAt: newStatus === "completed" ? new Date().toISOString() : undefined,
      },
    };

    setModuleProgress(newProgress);
    await saveProgress(newProgress);
  };

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
      const realModules = await ds.listCourseModules(auth.user.uid, routeGroupId, school.id);
      // Show demo data if no real modules
      if (realModules.length === 0 && !routeGroupId?.startsWith("real-")) {
        return DEMO_MODULES;
      }
      return realModules;
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

  const completionStats = useMemo(() => {
    if (!modules.length) return { completed: 0, total: 0, percentage: 0 };

    const completed = modules.filter((m) => moduleProgress[m.id]?.status === "completed").length;
    const total = modules.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, total, percentage };
  }, [modules, moduleProgress]);

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

  if (membershipsLoading || modulesLoading || loadingProgress) {
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
              <>
                {/* 進度概覽 */}
                <Card>
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
                        已完成 {completionStats.completed}/{completionStats.total} 單元
                      </Text>
                      <Text style={{ color: theme.colors.success, fontWeight: "700", fontSize: 14 }}>
                        {completionStats.percentage}%
                      </Text>
                    </View>
                    <View
                      style={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: theme.colors.surface3,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: "100%",
                          width: `${completionStats.percentage}%`,
                          backgroundColor: theme.colors.success,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                  </View>
                </Card>

                {/* 教材模組列表 */}
                <Card title="正式教材模組" subtitle="依週次與單元整理的內容">
                  <View style={{ gap: 10 }}>
                    {modules.map((module) => {
                      const isExpanded = expandedModuleId === module.id;
                      const progress = moduleProgress[module.id];
                      const status = progress?.status ?? "not_started";
                      const materials = (module.materials || []) as ContentItem[];

                      return (
                        <View key={module.id} style={{ gap: 8 }}>
                          <Pressable
                            onPress={() => setExpandedModuleId(isExpanded ? null : module.id)}
                            style={({ pressed }) => ({
                              gap: 10,
                              padding: 14,
                              borderRadius: theme.radius.lg,
                              backgroundColor: status === "completed" ? theme.colors.surface3 : theme.colors.surface2,
                              borderWidth: 1,
                              borderColor:
                                status === "completed" ? theme.colors.success : theme.colors.border,
                              opacity: pressed ? 0.8 : 1,
                            })}
                          >
                            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                              <Pressable
                                onPress={() => toggleModuleCompletion(module.id)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <ProgressIndicator status={status} size={24} />
                              </Pressable>

                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    color: theme.colors.text,
                                    fontWeight: "700",
                                    textDecorationLine:
                                      status === "completed" ? "line-through" : "none",
                                  }}
                                >
                                  {module.title || `第 ${module.week ?? module.order ?? "-"} 單元`}
                                </Text>
                                <Text
                                  style={{
                                    color: theme.colors.muted,
                                    marginTop: 3,
                                    lineHeight: 20,
                                    textDecorationLine:
                                      status === "completed" ? "line-through" : "none",
                                  }}
                                >
                                  {module.description || "教材模組"}
                                </Text>
                              </View>

                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                {status === "completed" && (
                                  <Ionicons name="checkmark-done" size={16} color={theme.colors.success} />
                                )}
                                <Ionicons
                                  name={isExpanded ? "chevron-up" : "chevron-down"}
                                  size={18}
                                  color={theme.colors.muted}
                                />
                              </View>
                            </View>

                            {/* 模組標籤 */}
                            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginLeft: 36 }}>
                              {module.week ? (
                                <Pill text={`第 ${module.week} 週`} kind="default" />
                              ) : null}
                              {module.estimatedMinutes ? (
                                <Pill
                                  text={`${module.estimatedMinutes} 分鐘`}
                                  kind="default"
                                />
                              ) : null}
                              {materials.length > 0 && (
                                <Pill
                                  text={`${materials.length} 項內容`}
                                  kind="accent"
                                />
                              )}
                              {module.published ? <Pill text="已發布" kind="success" /> : null}
                            </View>
                          </Pressable>

                          {/* 展開的內容項目 */}
                          {isExpanded && materials.length > 0 && (
                            <View style={{ gap: 8, paddingLeft: 36 }}>
                              {materials.map((item) => (
                                <ContentItemCard
                                  key={item.id}
                                  item={item}
                                  onPress={
                                    item.url
                                      ? () => {
                                          if (item.type === "video" || item.type === "link") {
                                            Linking.openURL(item.url!).catch((err) =>
                                              console.error("Failed to open URL:", err)
                                            );
                                          }
                                        }
                                      : undefined
                                  }
                                />
                              ))}
                            </View>
                          )}

                          {/* 展開但無內容 */}
                          {isExpanded && materials.length === 0 && module.resourceUrl && (
                            <View style={{ gap: 8, paddingLeft: 36 }}>
                              <ContentItemCard
                                item={{
                                  id: `${module.id}-legacy`,
                                  type: "link",
                                  label: module.resourceLabel || "外部教材",
                                  url: module.resourceUrl,
                                }}
                                onPress={() =>
                                  Linking.openURL(module.resourceUrl!).catch((err) =>
                                    console.error("Failed to open URL:", err)
                                  )
                                }
                              />
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </Card>
              </>
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
                  onPress={() => nav?.navigate?.("收件匣", { screen: "GroupDetail", params: { groupId: routeGroupId } })}
                />
                <ModuleRow
                  title="作業與評量"
                  subtitle="把單元內容與作業、測驗對應起來，形成完整學習節奏"
                  icon="document-text-outline"
                  tint="#F97316"
                  onPress={() =>
                    nav?.navigate?.("收件匣", {
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
