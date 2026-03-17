import React, { useMemo, useState, useCallback } from "react";
import { ScrollView, Text, View, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { calculateCredits, type CreditCategory } from "@campus/shared/src/creditAudit";
import { mockCourses, mockGradRuleTemplateV1 } from "@campus/shared/src/mockData";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AuthGuard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { collection, doc, setDoc, deleteDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { useAsyncList } from "../hooks/useAsyncList";

type StoredEnrollment = {
  id: string;
  courseId: string;
  courseName: string;
  credits: number;
  category: CreditCategory;
  passed: boolean;
  status: "completed" | "in_progress" | "dropped";
  createdAt?: any;
};

const CATEGORY_LABELS: Record<CreditCategory, string> = {
  required: "必修",
  elective: "選修",
  general: "通識",
  english: "英文",
  other: "其他",
};

const CATEGORY_COLORS: Record<CreditCategory, string> = {
  required: "#f43f5e",
  elective: "#3b82f6",
  general: "#10b981",
  english: "#f59e0b",
  other: "#8b5cf6",
};

export function CreditAuditScreen(props: any) {
  const auth = useAuth();
  const db = getDb();
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  const { items: userEnrollments, loading, error: loadError, reload } = useAsyncList<StoredEnrollment>(
    async () => {
      if (!auth.user) return [];
      const ref = collection(db, "users", auth.user.uid, "enrollments");
      const snap = await getDocs(ref);
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
    },
    [db, auth.user?.uid]
  );

  const res = useMemo(() => {
    const coursesById: Record<string, any> = {};
    const enrollments: any[] = [];

    for (const c of mockCourses) {
      coursesById[c.id] = c;
    }

    for (const e of userEnrollments) {
      const courseId = e.courseId || `user-${e.id}`;
      coursesById[courseId] = {
        id: courseId,
        name: e.courseName,
        credits: e.credits,
        category: e.category,
        departmentId: "user-input",
      };
      enrollments.push({
        id: e.id,
        uid: auth.user?.uid || "demo",
        courseId,
        status: e.status,
        passed: e.passed,
      });
    }

    return calculateCredits({
      template: mockGradRuleTemplateV1,
      coursesById,
      enrollments,
    });
  }, [userEnrollments, auth.user?.uid]);

  const handleAddCourse = useCallback(() => {
    props?.navigation?.navigate?.("CreditAuditInput", {
      onAdded: async (course: {
        id: string;
        name: string;
        credits: number;
        category: CreditCategory;
        passed: boolean;
        grade?: string;
        semester?: string;
      }) => {
        if (!auth.user) return;
        const docRef = doc(db, "users", auth.user.uid, "enrollments", course.id);
        await setDoc(docRef, {
          courseId: course.id,
          courseName: course.name,
          credits: course.credits,
          category: course.category,
          passed: course.passed,
          grade: course.grade ?? null,
          semester: course.semester ?? null,
          status: "completed",
          source: "credit-audit-input",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        reload();
      },
    });
  }, [props?.navigation, auth.user, db, reload]);

  const handleOpenAdvisor = useCallback(() => {
    props?.navigation?.getParent?.()?.navigate?.("AICourseAdvisor");
  }, [props?.navigation]);

  const handleDeleteCourse = useCallback(
    async (enrollmentId: string) => {
      if (!auth.user) return;
      setDeleteLoading(enrollmentId);
      try {
        await deleteDoc(doc(db, "users", auth.user.uid, "enrollments", enrollmentId));
        reload();
      } catch (e) {
        Alert.alert("錯誤", "刪除失敗");
      } finally {
        setDeleteLoading(null);
      }
    },
    [auth.user, db, reload]
  );

  const confirmDelete = (e: StoredEnrollment) => {
    Alert.alert("確認刪除", `確定要刪除「${e.courseName}」嗎？`, [
      { text: "取消", style: "cancel" },
      { text: "刪除", style: "destructive", onPress: () => handleDeleteCourse(e.id) },
    ]);
  };

  const totalPct = res.total.required > 0 ? Math.min(1, res.total.earned / res.total.required) : 1;

  const recommendedCourses = useMemo(() => {
    const existingCourseNames = new Set(
      userEnrollments.map((course) => course.courseName.trim()).filter(Boolean)
    );

    return (["required", "elective", "general", "english", "other"] as const)
      .flatMap((categoryKey) => {
        const remaining = res.byCategory[categoryKey].remaining;
        if (remaining <= 0) return [];

        const requiredCount = Math.max(1, Math.ceil(remaining / 3));
        const matchedCourses = mockCourses
          .filter(
            (course) =>
              course.category === categoryKey &&
              !existingCourseNames.has(course.name)
          )
          .slice(0, requiredCount)
          .map((course) => ({
            id: course.id,
            code: course.code,
            name: course.name,
            credits: course.credits,
            category: categoryKey,
            summary: `可直接補足 ${CATEGORY_LABELS[categoryKey]} 學分缺口，優先度高。`,
          }));

        if (matchedCourses.length > 0) {
          return matchedCourses;
        }

        return [
          {
            id: `fallback-${categoryKey}`,
            code: CATEGORY_LABELS[categoryKey],
            name: `補足 ${CATEGORY_LABELS[categoryKey]} 學分`,
            credits: remaining,
            category: categoryKey,
            summary: `目前沒有對應的樣板課程，建議到 AI 選課助理或教務系統再查詢 ${CATEGORY_LABELS[categoryKey]} 課程。`,
          },
        ];
      })
      .slice(0, 6);
  }, [userEnrollments, res.byCategory]);

  if (!auth.user) {
    return (
      <AuthGuard
        user={auth.user}
        onLogin={() => props?.navigation?.navigate?.("Me")}
        title="需要登入"
        description="請登入以使用學分試算功能。登入後可以儲存您的修課紀錄並查看畢業進度。"
      >
        <></>
      </AuthGuard>
    );
  }

  if (loading) {
    return <LoadingState title="學分試算" subtitle="載入中..." rows={3} />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="學分試算"
        subtitle="載入修課紀錄失敗"
        hint={loadError}
        actionText="重試"
        onAction={reload}
        errorType="network"
      />
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Card title="總學分進度">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted }}>畢業門檻</Text>
            <Pill text={res.satisfied ? "已達標" : "未達標"} kind={res.satisfied ? "accent" : "default"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 8 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 36 }}>{res.total.earned}</Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 18, marginLeft: 4 }}>
              / {res.total.required}
            </Text>
          </View>
          <View
            style={{
              marginTop: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: theme.colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.round(totalPct * 100)}%`,
                backgroundColor: res.satisfied ? "#10b981" : theme.colors.accent,
              }}
            />
          </View>
          <Text style={{ color: theme.colors.muted, marginTop: 8 }}>
            {res.total.remaining > 0 ? `還需 ${res.total.remaining} 學分` : "已達畢業學分要求"}
          </Text>
        </Card>

        <Card title="分類進度">
          {(["required", "elective", "general", "english", "other"] as const).map((k) => {
            const b = res.byCategory[k];
            const pct = b.required <= 0 ? 1 : Math.max(0, Math.min(1, b.earned / b.required));
            const isSatisfied = b.remaining <= 0;

            return (
              <View key={k} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: CATEGORY_COLORS[k],
                      }}
                    />
                    <Text style={{ color: theme.colors.text, fontWeight: "800" }}>{CATEGORY_LABELS[k]}</Text>
                  </View>
                  <Text style={{ color: isSatisfied ? "#10b981" : theme.colors.muted }}>
                    {b.earned}/{b.required} {isSatisfied ? "✓" : `(缺${b.remaining})`}
                  </Text>
                </View>
                <View
                  style={{
                    marginTop: 6,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%",
                      width: `${Math.round(pct * 100)}%`,
                      backgroundColor: CATEGORY_COLORS[k],
                      opacity: 0.8,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </Card>

        <Card title="已登錄課程" subtitle={`共 ${userEnrollments.length} 門課程`}>
          {!auth.user ? (
            <Text style={{ color: theme.colors.muted }}>請先登入才能儲存修課紀錄。</Text>
          ) : userEnrollments.length === 0 ? (
            <Text style={{ color: theme.colors.muted }}>尚未登錄任何課程。點擊下方「新增課程」開始記錄。</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {userEnrollments.map((e) => (
                <View
                  key={e.id}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{e.courseName}</Text>
                        <Pill text={`${e.credits} 學分`} kind="accent" />
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: CATEGORY_COLORS[e.category],
                            }}
                          />
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                            {CATEGORY_LABELS[e.category]}
                          </Text>
                        </View>
                        <Text style={{ color: e.passed ? "#10b981" : "#f43f5e", fontSize: 12 }}>
                          {e.passed ? "已通過" : "未通過"}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => confirmDelete(e)}
                      disabled={deleteLoading === e.id}
                      style={{
                        padding: 8,
                        borderRadius: 999,
                        backgroundColor: "rgba(244,63,94,0.1)",
                      }}
                    >
                      <Ionicons
                        name={deleteLoading === e.id ? "hourglass-outline" : "trash-outline"}
                        size={18}
                        color="#f43f5e"
                      />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
            <Button text="新增課程" kind="primary" onPress={handleAddCourse} disabled={!auth.user} />
            <Button text="重新整理" onPress={reload} />
          </View>
        </Card>

        <Card title="AI 建議" subtitle="依據目前缺口推薦選課">
          {res.total.remaining <= 0 ? (
            <View
              style={{
                padding: 12,
                borderRadius: theme.radius.md,
                backgroundColor: "rgba(16,185,129,0.1)",
              }}
            >
              <Text style={{ color: "#10b981", fontWeight: "700" }}>恭喜！你已達到畢業學分要求。</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                建議先補足仍有缺口的分類，再交給 AI 選課助理依你的偏好安排修課節奏。
              </Text>
              {(["required", "elective", "general", "english", "other"] as const)
                .filter((k) => res.byCategory[k].remaining > 0)
                .map((k) => (
                  <View
                    key={k}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderLeftWidth: 3,
                      borderLeftColor: CATEGORY_COLORS[k],
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                      {CATEGORY_LABELS[k]}：還需 {res.byCategory[k].remaining} 學分
                    </Text>
                    <Text style={{ color: theme.colors.muted, marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                      建議下學期選修 {Math.ceil(res.byCategory[k].remaining / 3)} 門相關課程。
                    </Text>
                  </View>
                ))}

              {recommendedCourses.length > 0 ? (
                <View style={{ gap: 8, marginTop: 4 }}>
                  {recommendedCourses.map((course) => (
                    <View
                      key={course.id}
                      style={{
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                            {course.name}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                            {course.code} · {CATEGORY_LABELS[course.category]} · {course.credits} 學分
                          </Text>
                        </View>
                        <Pill text={`${course.credits} 學分`} kind="accent" />
                      </View>
                      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }}>
                        {course.summary}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <Button text="開啟 AI 選課助理" kind="primary" onPress={handleOpenAdvisor} />
                <Button text="新增課程" onPress={handleAddCourse} />
              </View>
            </View>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
