import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import type { CourseSpace, Quiz } from "../data";
import { Button, Card, ErrorState, LoadingState, Pill, Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { canManageCourse, formatDateTime, parseDateTimeInput, toDate } from "../services/courseWorkspace";

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

export function QuizCenterScreen(props: any) {
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
  const [dueAtText, setDueAtText] = useState("");
  const [durationText, setDurationText] = useState("20");
  const [questionCountText, setQuestionCountText] = useState("10");
  const [pointsText, setPointsText] = useState("100");
  const [weightText, setWeightText] = useState("10");
  const [quizType, setQuizType] = useState<"quiz" | "exam">("quiz");

  const { items: memberships, loading: membershipsLoading, error: membershipsError } = useAsyncList<CourseSpace>(
    async () => {
      if (!auth.user) return [];
      return ds.listCourseSpaces(auth.user.uid, school.id);
    },
    [ds, auth.user?.uid, school.id]
  );

  const {
    items: quizzes,
    loading: quizzesLoading,
    error: quizzesError,
    reload: reloadQuizzes,
  } = useAsyncList<Quiz>(
    async () => {
      if (!auth.user) return [];
      return ds.listQuizzes(auth.user.uid, routeGroupId, school.id);
    },
    [ds, auth.user?.uid, routeGroupId, school.id, memberships.map((membership) => membership.groupId).join("|")]
  );

  const selectedMembership = memberships.find((membership) => membership.groupId === routeGroupId) ?? null;
  const selectedCourseName = routeGroupName ?? selectedMembership?.name ?? "測驗中心";
  const canEditCourse = canManageCourse(selectedMembership?.role);

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

  const onCreateQuiz = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!routeGroupId || !auth.user) {
      setErr("缺少課程或登入狀態");
      return;
    }
    if (!canEditCourse) {
      setErr("你沒有權限建立評量");
      return;
    }
    if (!title.trim()) {
      setErr("請輸入評量標題");
      return;
    }

    const dueAt = dueAtText.trim() ? parseDateTimeInput(dueAtText) : null;
    if (dueAtText.trim() && !dueAt) {
      setErr("時間格式需為 YYYY-MM-DD HH:mm，例如 2026-03-25 09:00");
      return;
    }

    const durationMinutes = Number(durationText.trim());
    const questionCount = Number(questionCountText.trim());
    const points = Number(pointsText.trim());
    const weight = Number(weightText.trim());

    if (![durationMinutes, questionCount, points, weight].every(Number.isFinite)) {
      setErr("題數、時長、滿分與權重都需為數字");
      return;
    }
    if (durationMinutes <= 0 || questionCount <= 0 || points <= 0 || weight <= 0) {
      setErr("題數、時長、滿分與權重都需大於 0");
      return;
    }

    setSaving(true);
    try {
      await ds.createQuiz({
        courseSpaceId: routeGroupId,
        title,
        description,
        dueAt,
        type: quizType,
        questionCount,
        durationMinutes,
        points,
        weight,
        createdBy: auth.user.uid,
        createdByEmail: auth.user.email ?? null,
        schoolId: school.id,
      });
      setTitle("");
      setDescription("");
      setDueAtText("");
      setDurationText("20");
      setQuestionCountText("10");
      setPointsText("100");
      setWeightText("10");
      setSuccessMsg("評量已建立，已同步到課程作業流程");
      reloadQuizzes();
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "建立評量失敗");
    } finally {
      setSaving(false);
    }
  };

  if (!auth.user) {
    return (
      <Screen>
        <Card title="測驗中心" subtitle="登入後即可查看測驗與考試">
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            這裡會承接測驗、考試、題庫與自動評量流程，成為正式 LMS 評量入口。
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
        <Card title={routeGroupId ? `${selectedCourseName} 測驗中心` : "測驗中心"} subtitle="把 quiz / exam 提升成正式評量入口">
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Pill text={`${quizCount} 項測驗`} kind="accent" />
            <Pill text={`${examCount} 項考試`} kind="warning" />
            <Pill text={`${publishedCount} 項已發布成績`} kind={publishedCount > 0 ? "success" : "muted"} />
            {routeGroupId && canEditCourse ? <Pill text="教師可直接建立評量" kind="success" /> : null}
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

        {routeGroupId && canEditCourse ? (
          <Card title="建立評量" subtitle="建立後會同步寫入 quizzes 與 assignments，保留既有繳交流程">
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setQuizType("quiz")}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: quizType === "quiz" ? theme.colors.accent : theme.colors.border,
                    backgroundColor: quizType === "quiz" ? theme.colors.accentSoft : theme.colors.surface2,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: quizType === "quiz" ? theme.colors.accent : theme.colors.text, fontWeight: "700" }}>
                    測驗
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setQuizType("exam")}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: quizType === "exam" ? theme.colors.warning : theme.colors.border,
                    backgroundColor: quizType === "exam" ? theme.colors.warningSoft : theme.colors.surface2,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: quizType === "exam" ? theme.colors.warning : theme.colors.text, fontWeight: "700" }}>
                    考試
                  </Text>
                </Pressable>
              </View>

              <Field label="評量標題" value={title} onChangeText={setTitle} placeholder="例如：第 3 章小考" />
              <Field
                label="評量說明"
                value={description}
                onChangeText={setDescription}
                placeholder="輸入評量範圍、作答規則與注意事項"
                multiline
              />
              <Field
                label="截止 / 開始時間"
                value={dueAtText}
                onChangeText={setDueAtText}
                placeholder="2026-03-25 09:00"
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field label="題數" value={questionCountText} onChangeText={setQuestionCountText} placeholder="10" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="時長(分)" value={durationText} onChangeText={setDurationText} placeholder="20" />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field label="滿分" value={pointsText} onChangeText={setPointsText} placeholder="100" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="權重(%)" value={weightText} onChangeText={setWeightText} placeholder="10" />
                </View>
              </View>
              <Button text={saving ? "建立中..." : "建立評量"} kind="primary" disabled={saving} onPress={onCreateQuiz} />
            </View>
          </Card>
        ) : null}

        <Card title="近期評量" subtitle={`${upcoming.length} 項待進行`}>
          <View style={{ gap: 10 }}>
            {upcoming.length === 0 ? (
              <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
                目前沒有即將到來的 quiz / exam。你現在已可從這裡直接建立正式評量資料。
              </Text>
            ) : (
              upcoming.map((item) => (
                <Pressable
                  key={`${item.groupId}-${item.id}`}
                  onPress={() =>
                    nav?.navigate?.("訊息", {
                      screen: "AssignmentDetail",
                      params: { groupId: item.groupId, assignmentId: item.assignmentId },
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
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pill text={`時間：${formatDateTime(toDate(item.dueAt), "未設定")}`} kind="default" />
                    {item.questionCount ? <Pill text={`${item.questionCount} 題`} kind="default" /> : null}
                    {item.durationMinutes ? <Pill text={`${item.durationMinutes} 分鐘`} kind="default" /> : null}
                    {item.source === "quiz" ? <Pill text="正式 quizzes 模型" kind="success" /> : null}
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </Card>

        <Card title="評量能力" subtitle="正式資料模型已接上，後續可持續擴充">
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pill text="題庫" kind="default" />
              <Pill text="題型管理" kind="default" />
              <Pill text="隨機抽題" kind="default" />
              <Pill text="自動批改" kind="default" />
              <Pill text="測驗報表" kind="default" />
            </View>
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              這一版已先把正式 `quizzes` 資料接進主流程，之後再向下擴充題庫與答題引擎，不需要再重做入口層。
            </Text>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
