/* eslint-disable */
import React, { useMemo, useState, useCallback, useEffect } from "react";
import { ScrollView, Text, View, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  PuCreditAuditPayload,
  PuGeneralEdDimension,
  PuSemesterGradeRecord,
} from "@campus/shared/src";
import { calculateCredits, type CreditCategory } from "@campus/shared/src/creditAudit";
import { mockCourses, mockGradRuleTemplateV1 } from "@campus/shared/src/mockData";
import {
  deleteCreditAuditEnrollment,
  listStoredEnrollments,
  upsertCreditAuditEnrollment,
  type StoredEnrollment,
} from "../features/academics";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AuthGuard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { useAsyncList } from "../hooks/useAsyncList";
import { hasDataSource, getDataSource } from "../data";
import { getAdapter, PUAdapter } from "../data/apiAdapters";
import { PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID } from "../data/schoolIds";
import type { Grade } from "../data/types";
import { getAnyCachedCreditAudit, getCachedCreditAudit } from "../services/puDataCache";

// Build marker — if you see this version in the UI, the new code is loaded
const CREDIT_AUDIT_CODE_VERSION = "v3.1-20260403";

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

function hasCampusCreditAuditData(audit: PuCreditAuditPayload | null): boolean {
  if (!audit) return false;

  // v2: check creditTotals OR semesterGrades (fallback if parsing failed)
  if ((audit as any).version === 2) {
    const ct = (audit as any).creditTotals;
    const hasCreditTotals = ct && (ct.subtotal != null || ct.required != null || ct.elective != null);
    const hasSemesterGrades = Array.isArray((audit as any).semesterGrades) && (audit as any).semesterGrades.length > 0;
    return hasCreditTotals || hasSemesterGrades;
  }

  // Legacy
  if (audit.total.earned != null || audit.total.required != null || audit.total.remaining != null) {
    return true;
  }

  return Object.values(audit.byCategory).some(
    (entry) => entry && (entry.earned != null || entry.required != null || entry.remaining != null),
  );
}

function toUiAuditResult(audit: PuCreditAuditPayload) {
  // ── v2 payload: use creditTotals directly ──
  if ((audit as any).version === 2) {
    const ct = (audit as any).creditTotals as {
      required: number | null; elective: number | null; externalElective: number | null;
      generalOld: number | null; generalNew: number | null; subtotal: number | null; minorDouble: number | null;
    };

    const reqEarned = ct.required ?? 0;
    const elecEarned = ct.elective ?? 0;
    const extElecEarned = ct.externalElective ?? 0;
    const genOldEarned = ct.generalOld ?? 0;
    const genNewEarned = ct.generalNew ?? 0;
    const generalEarned = genOldEarned + genNewEarned;

    // Primary: use subtotal from creditTotals
    // Fallback: sum individual categories
    // Last resort: compute from semesterGrades
    let totalEarned = ct.subtotal ?? (reqEarned + elecEarned + extElecEarned + generalEarned);

    // If totalEarned is 0 but we have semesterGrades, compute from grades
    if (totalEarned === 0 && Array.isArray((audit as any).semesterGrades)) {
      const semesters = (audit as any).semesterGrades as Array<{
        courses: Array<{ credits: number; score: number | string }>;
      }>;
      let gradeTotal = 0;
      for (const sem of semesters) {
        for (const c of sem.courses) {
          const scoreStr = String(c.score).toLowerCase();
          const score = typeof c.score === "number" ? c.score : parseFloat(scoreStr);
          const passed = !isNaN(score) && score >= 60;
          // "Pass", "通過", "通過(Pass)" all count
          const isPassText = scoreStr.includes("通過") || scoreStr === "pass";
          if (passed || isPassText) gradeTotal += c.credits;
        }
      }
      if (gradeTotal > 0) {
        totalEarned = gradeTotal;
        console.log(`[toUiAuditResult] Fallback: computed ${gradeTotal} credits from semesterGrades`);
      }
    }

    // 靜宜大學一般畢業學分為 128（各系略有不同，但 128 是最常見的）
    // TODO: 未來從系所資料動態取得
    const GRADUATION_CREDITS = 128;

    const byCategory = {
      required: { earned: reqEarned, required: 0, remaining: 0 },
      elective: { earned: elecEarned + extElecEarned, required: 0, remaining: 0 },
      general: { earned: generalEarned, required: 0, remaining: 0 },
      english: { earned: 0, required: 0, remaining: 0 },
      other: { earned: (ct.minorDouble ?? 0), required: 0, remaining: 0 },
    };

    const totalRemaining = Math.max(0, GRADUATION_CREDITS - totalEarned);

    return {
      total: {
        earned: totalEarned,
        required: GRADUATION_CREDITS,
        remaining: totalRemaining,
      },
      byCategory,
      satisfied: totalRemaining <= 0,
      missingCourseIds: [],
    };
  }

  // ── Legacy fallback ──
  const categories: CreditCategory[] = ["required", "elective", "general", "english", "other"];
  const byCategory = {
    required: { earned: 0, required: 0, remaining: 0 },
    elective: { earned: 0, required: 0, remaining: 0 },
    general: { earned: 0, required: 0, remaining: 0 },
    english: { earned: 0, required: 0, remaining: 0 },
    other: { earned: 0, required: 0, remaining: 0 },
  };

  for (const key of categories) {
    const entry = audit.byCategory[key];
    if (!entry) continue;

    const earned = entry.earned ?? 0;
    const required = entry.required ?? 0;
    const remaining = entry.remaining ?? Math.max(0, required - earned);
    byCategory[key] = { earned, required, remaining };
  }

  const totalEarned =
    audit.total.earned ??
    categories.reduce((sum, key) => sum + byCategory[key].earned, 0);
  const totalRequired =
    audit.total.required ??
    categories.reduce((sum, key) => sum + byCategory[key].required, 0);
  const totalRemaining =
    audit.total.remaining ??
    Math.max(0, totalRequired - totalEarned);

  return {
    total: {
      earned: totalEarned,
      required: totalRequired,
      remaining: totalRemaining,
    },
    byCategory,
    satisfied:
      totalRemaining <= 0 &&
      categories.every((key) => byCategory[key].remaining <= 0),
    missingCourseIds: [],
  };
}

/** 從分數推測學分分類 — 簡單分類（不完美，但有總比沒有好） */
function guessCreditCategory(courseName: string): CreditCategory {
  const n = courseName.toLowerCase();
  if (n.includes("英文") || n.includes("english")) return "english";
  if (n.includes("通識") || n.includes("博雅") || n.includes("核心")) return "general";
  // 預設歸類為選修，使用者可以手動修改
  return "elective";
}

export function CreditAuditScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [realGrades, setRealGrades] = useState<Grade[]>([]);
  const [gpaData, setGpaData] = useState<{ gpa: number; totalCredits: number; totalPoints: number } | null>(null);
  const [campusCreditAudit, setCampusCreditAudit] = useState<PuCreditAuditPayload | null>(null);

  const { items: userEnrollments, loading, error: loadError, reload } = useAsyncList<StoredEnrollment>(
    async () => {
      if (!auth.user) return [];
      try {
        return await listStoredEnrollments(auth.user.uid, school.id);
      } catch {
        // Firestore 未設定時不影響功能
        return [];
      }
    },
    [auth.user?.uid, school.id]
  );

  // 載入真實成績資料（從 PUAdapter 快取）
  useEffect(() => {
    if (!auth.user?.uid || !hasDataSource()) return;
    const ds = getDataSource();
    Promise.all([
      ds.listGrades(auth.user.uid, undefined, school.id).catch(() => [] as Grade[]),
      ds.getGPA(auth.user.uid, school.id).catch(() => ({ gpa: 0, totalCredits: 0, totalPoints: 0 })),
    ]).then(([grades, gpa]) => {
      const semesters = [...new Set(grades.map((g) => g.semester))];
      console.log(`[CreditAudit] Loaded ${grades.length} grades across ${semesters.length} semesters: [${semesters.join(", ")}]`);
      setRealGrades(grades);
      setGpaData(gpa);
    });
  }, [auth.user?.uid, school.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadCampusCreditAudit() {
      console.log(`[CreditAudit][${CREDIT_AUDIT_CODE_VERSION}] loadCampusCreditAudit starting`);

      if (!auth.user?.uid) {
        if (!cancelled) setCampusCreditAudit(null);
        return;
      }

      try {
        // ── Nuclear option: purge ANY old-format credit audit from AsyncStorage ──
        // This ensures stale pre-v2 data can never be displayed
        try {
          const rawCache = await AsyncStorage.getItem("@pu_cache:creditAudit");
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            const cachedData = parsed?.data;
            if (cachedData && !cachedData.version) {
              console.warn("[CreditAudit] PURGING old-format creditAudit cache from AsyncStorage");
              await AsyncStorage.removeItem("@pu_cache:creditAudit");
            }
          }
        } catch (purgeErr) {
          console.warn("[CreditAudit] Cache purge check failed:", purgeErr);
        }

        const cached =
          (await getCachedCreditAudit().catch(() => null)) ??
          (await getAnyCachedCreditAudit().catch(() => null));
        console.log("[CreditAudit] cached audit version:", (cached as any)?.version, "subtotal:", (cached as any)?.creditTotals?.subtotal, "semesterGrades:", (cached as any)?.semesterGrades?.length);
        if (!cancelled && cached && (cached as any).version === 2) {
          setCampusCreditAudit(cached);
        }

        const adapter = await getAdapter(PROVIDENCE_UNIVERSITY_INTERNAL_SCHOOL_ID);
        if (adapter instanceof PUAdapter) {
          const remoteAudit = await adapter.getCreditAudit();
          console.log("[CreditAudit] remote audit version:", (remoteAudit as any)?.version, "subtotal:", (remoteAudit as any)?.creditTotals?.subtotal, "semGrades:", (remoteAudit as any)?.semesterGrades?.length, "total.earned:", remoteAudit?.total?.earned);
          if (!cancelled && remoteAudit && (remoteAudit as any).version === 2) {
            setCampusCreditAudit(remoteAudit);
          } else if (!cancelled && remoteAudit) {
            // Old format data — reject it and log
            console.warn("[CreditAudit] Rejecting non-v2 remote audit data, version:", (remoteAudit as any)?.version);
          }
        }
      } catch (error) {
        console.warn("[CreditAudit] Failed to load campus credit audit:", error);
      }
    }

    void loadCampusCreditAudit();
    return () => {
      cancelled = true;
    };
  }, [auth.user?.uid, school.id]);

  const res = useMemo(() => {
    const coursesById: Record<string, any> = {};
    const enrollments: any[] = [];

    for (const c of mockCourses) {
      coursesById[c.id] = c;
    }

    // 1. 加入真實成績（從 e校園 抓取的）
    const seenRealCourses = new Set<string>();
    for (const grade of realGrades) {
      const courseId = grade.courseId || `real-${grade.id}`;
      const score = grade.grade ?? grade.score ?? 0;
      const passed = score >= 60;

      seenRealCourses.add(grade.courseName);
      coursesById[courseId] = {
        id: courseId,
        name: grade.courseName,
        credits: grade.credits,
        category: guessCreditCategory(grade.courseName),
        departmentId: "pu-real",
      };
      enrollments.push({
        id: courseId,
        uid: auth.user?.uid || "demo",
        courseId,
        status: passed ? "completed" : "in_progress",
        passed,
      });
    }

    // 2. 加入手動登錄的（避免重複）
    for (const e of userEnrollments) {
      if (seenRealCourses.has(e.courseName)) continue;
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
  }, [userEnrollments, realGrades, auth.user?.uid]);

  const effectiveRes = useMemo(() => {
    const hasData = hasCampusCreditAuditData(campusCreditAudit);
    if (hasData) {
      const uiResult = toUiAuditResult(campusCreditAudit!);
      console.log(`[CreditAudit] effectiveRes: using campus data (v=${(campusCreditAudit as any)?.version}), earned=${uiResult.total.earned}, required=${uiResult.total.required}`);
      return uiResult;
    }
    console.log(`[CreditAudit] effectiveRes: using calculated res, earned=${res.total.earned}, required=${res.total.required}`);
    return res;
  }, [campusCreditAudit, res]);

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
        await upsertCreditAuditEnrollment({
          uid: auth.user.uid,
          schoolId: school.id,
          course,
        });
        reload();
      },
    });
  }, [props?.navigation, auth.user, reload, school.id]);

  const handleOpenAdvisor = useCallback(() => {
    props?.navigation?.getParent?.()?.navigate?.("AICourseAdvisor");
  }, [props?.navigation]);

  const handleDeleteCourse = useCallback(
    async (enrollmentId: string) => {
      if (!auth.user) return;
      setDeleteLoading(enrollmentId);
      try {
        await deleteCreditAuditEnrollment({
          uid: auth.user.uid,
          schoolId: school.id,
          enrollmentId,
        });
        reload();
      } catch (e) {
        Alert.alert("錯誤", "刪除失敗");
      } finally {
        setDeleteLoading(null);
      }
    },
    [auth.user, reload, school.id]
  );

  const confirmDelete = (e: StoredEnrollment) => {
    Alert.alert("確認刪除", `確定要刪除「${e.courseName}」嗎？`, [
      { text: "取消", style: "cancel" },
      { text: "刪除", style: "destructive", onPress: () => handleDeleteCourse(e.id) },
    ]);
  };

  const totalPct =
    effectiveRes.total.required > 0
      ? Math.min(1, effectiveRes.total.earned / effectiveRes.total.required)
      : 1;

  const recommendedCourses = useMemo(() => {
    const existingCourseNames = new Set(
      userEnrollments.map((course) => course.courseName.trim()).filter(Boolean)
    );

    return (["required", "elective", "general", "english", "other"] as const)
      .flatMap((categoryKey) => {
        const remaining = effectiveRes.byCategory[categoryKey].remaining;
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
  }, [userEnrollments, effectiveRes.byCategory]);

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
            <Pill text={effectiveRes.satisfied ? "已達標" : "未達標"} kind={effectiveRes.satisfied ? "accent" : "default"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 8 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 36 }}>{effectiveRes.total.earned}</Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 18, marginLeft: 4 }}>
              / {effectiveRes.total.required}
            </Text>
          </View>
          <View
            style={{
              marginTop: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${Math.round(totalPct * 100)}%`,
                backgroundColor: effectiveRes.satisfied ? "#10b981" : theme.colors.accent,
              }}
            />
          </View>
          <Text style={{ color: theme.colors.muted, marginTop: 8 }}>
            {effectiveRes.total.remaining > 0 ? `還需 ${effectiveRes.total.remaining} 學分` : "已達畢業學分要求"}
          </Text>
          {hasCampusCreditAuditData(campusCreditAudit) ? (
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
              已載入 E 校園學分試算資料 (v{(campusCreditAudit as any)?.version ?? "?"})
            </Text>
          ) : realGrades.length > 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
              已自動載入 {realGrades.length} 門課程成績
            </Text>
          ) : null}
          <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2, opacity: 0.5 }}>
            {CREDIT_AUDIT_CODE_VERSION} | src={hasCampusCreditAuditData(campusCreditAudit) ? "campus" : "calc"}
          </Text>
        </Card>

        {gpaData && gpaData.totalCredits > 0 && (
          <Card title="GPA 績點">
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 36 }}>
                {gpaData.gpa.toFixed(2)}
              </Text>
              <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 18, marginLeft: 4 }}>
                / 4.00
              </Text>
            </View>
            <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
              已修 {gpaData.totalCredits} 學分・總績點 {gpaData.totalPoints.toFixed(1)}
            </Text>
          </Card>
        )}

        <Card title="分類進度">
          {(["required", "elective", "general", "english", "other"] as const)
            .filter((k) => {
              const b = effectiveRes.byCategory[k];
              // v2: hide categories with 0 earned and 0 required (not relevant)
              return b.earned > 0 || b.required > 0;
            })
            .map((k) => {
              const b = effectiveRes.byCategory[k];
              const hasRequirement = b.required > 0;
              const pct = hasRequirement ? Math.max(0, Math.min(1, b.earned / b.required)) : 1;
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
                    <Text style={{ color: "#10b981", fontWeight: "700" }}>
                      {b.earned} 學分{hasRequirement ? ` / ${b.required}` : ""}
                      {hasRequirement && !isSatisfied ? ` (缺${b.remaining})` : ""}
                    </Text>
                  </View>
                  {hasRequirement && (
                    <View
                      style={{
                        marginTop: 6,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: theme.colors.surface2,
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
                  )}
                </View>
              );
            })}
        </Card>

        {/* ── 學分累計明細 (from v2 comprehensive data) ── */}
        {campusCreditAudit && (campusCreditAudit as any).version === 2 && (
          <>
            <Card title="修習學分累計">
              {(() => {
                const ct = (campusCreditAudit as any).creditTotals;
                if (!ct) return null;
                const items = [
                  { label: "必修", value: ct.required },
                  { label: "選修", value: ct.elective },
                  { label: "外系選修", value: ct.externalElective },
                  { label: "通識（六大學群）", value: ct.generalOld },
                  { label: "通識（四大向度）", value: ct.generalNew },
                  { label: "輔雙", value: ct.minorDouble },
                ].filter(i => i.value != null);
                return (
                  <View style={{ gap: 6 }}>
                    {items.map((item, idx) => (
                      <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ color: theme.colors.text }}>{item.label}</Text>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{item.value} 學分</Text>
                      </View>
                    ))}
                    <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "800" }}>小計</Text>
                      <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 18 }}>{ct.subtotal ?? "—"} 學分</Text>
                    </View>
                  </View>
                );
              })()}
            </Card>

            {/* ── 通識向度修習情形 ── */}
            {((campusCreditAudit as any).generalEdDimensions?.length ?? 0) > 0 && (
              <Card title="通識向度修習情形">
                <View style={{ gap: 8 }}>
                  {((campusCreditAudit as any).generalEdDimensions as PuGeneralEdDimension[]).map((dim, idx) => {
                    const pct = dim.requiredCredits > 0
                      ? Math.min(1, dim.earnedCredits / dim.requiredCredits)
                      : dim.earnedCredits > 0 ? 1 : 0;
                    return (
                      <View key={idx}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{dim.dimension}</Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                            {dim.earnedCredits}/{dim.requiredCredits} 學分
                          </Text>
                        </View>
                        <View style={{ marginTop: 4, height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
                          <View style={{ height: "100%", width: `${Math.round(pct * 100)}%`, backgroundColor: "#10b981" }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* ── 必修尚缺科目 ── */}
            {((campusCreditAudit as any).missingRequiredCourses?.length ?? 0) > 0 && (
              <Card title="必修尚缺科目">
                <View style={{ gap: 6 }}>
                  {((campusCreditAudit as any).missingRequiredCourses as any[]).map((c, idx) => (
                    <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: theme.colors.text, flex: 1 }}>{c.courseName}</Text>
                      <Pill text={c.status} kind={c.status === "通過" ? "accent" : "default"} />
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {/* ── 修習中通識科目 ── */}
            {((campusCreditAudit as any).inProgressGeneralCourses?.length ?? 0) > 0 && (
              <Card title="修習中通識科目">
                <View style={{ gap: 6 }}>
                  {((campusCreditAudit as any).inProgressGeneralCourses as any[]).map((c, idx) => (
                    <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text }}>{c.courseName}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{c.courseGroup} · {c.credits} 學分</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {/* ── 歷年修課明細 (摘要) ── */}
            {((campusCreditAudit as any).semesterGrades?.length ?? 0) > 0 && (
              <Card title="歷年修課明細" subtitle={`共 ${((campusCreditAudit as any).semesterGrades as PuSemesterGradeRecord[]).length} 學期`}>
                <View style={{ gap: 10 }}>
                  {((campusCreditAudit as any).semesterGrades as PuSemesterGradeRecord[]).map((sem, idx) => {
                    const semYear = sem.semester.slice(0, -1);
                    const semNum = sem.semester.slice(-1);
                    return (
                      <View key={idx} style={{ padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{semYear} 學年第 {semNum} 學期</Text>
                          {sem.semesterAverage != null && (
                            <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>平均 {sem.semesterAverage}</Text>
                          )}
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {sem.courses.length} 門課程
                          {sem.classRanking ? ` · 班排 ${sem.classRanking}` : ""}
                          {sem.departmentRanking ? ` · 系排 ${sem.departmentRanking}` : ""}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* ── 學年排名 ── */}
            {((campusCreditAudit as any).academicYearRankings?.length ?? 0) > 0 && (
              <Card title="學年排名">
                <View style={{ gap: 6 }}>
                  {((campusCreditAudit as any).academicYearRankings as any[]).map((r, idx) => (
                    <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: theme.colors.text }}>{r.academicYear} 學年</Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                        班排 {r.classRanking ?? "—"} · 系排 {r.departmentRanking ?? "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {/* ── 其他狀態 ── */}
            <Card title="其他畢業條件">
              <View style={{ gap: 10 }}>
                <View>
                  <Text style={{ color: theme.colors.muted, fontWeight: "600", marginBottom: 2 }}>輔系/雙主修</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 13 }}>{(campusCreditAudit as any).minorDoubleMajorStatus}</Text>
                </View>
                <View>
                  <Text style={{ color: theme.colors.muted, fontWeight: "600", marginBottom: 2 }}>畢業條件</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 13 }}>{(campusCreditAudit as any).graduationConditionsStatus}</Text>
                </View>
                <View>
                  <Text style={{ color: theme.colors.muted, fontWeight: "600", marginBottom: 2 }}>學程</Text>
                  <Text style={{ color: theme.colors.text, fontSize: 13 }}>{(campusCreditAudit as any).programStatus}</Text>
                </View>
              </View>
            </Card>

            {/* ── 資料更新時間 ── */}
            {(campusCreditAudit as any).fetchedAt && (
              <Text style={{ color: theme.colors.muted, fontSize: 11, textAlign: "center", marginTop: 4 }}>
                資料更新時間：{new Date((campusCreditAudit as any).fetchedAt).toLocaleString("zh-TW")}
              </Text>
            )}
          </>
        )}

        <Card title="已登錄課程" subtitle={`共 ${realGrades.length + userEnrollments.length} 門課程（${realGrades.length} 門自動匯入）`}>
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
          {effectiveRes.total.remaining <= 0 ? (
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
                .filter((k) => effectiveRes.byCategory[k].remaining > 0)
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
                      {CATEGORY_LABELS[k]}：還需 {effectiveRes.byCategory[k].remaining} 學分
                    </Text>
                    <Text style={{ color: theme.colors.muted, marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                      建議下學期選修 {Math.ceil(effectiveRes.byCategory[k].remaining / 3)} 門相關課程。
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
