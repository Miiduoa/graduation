/* eslint-disable */
import React, { useMemo, useState, useCallback, useEffect } from "react";
import { ScrollView, Text, View, Pressable, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AuthGuard } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import { useSchool } from "../state/school";
import { hasDataSource, getDataSource } from "../data";
import type { Grade } from "../data/types";

// ─── E校園修別 → 顯示分類 ─────────────────────────────
type CreditCat = "required" | "elective" | "general" | "pe" | "service" | "other";

const CATEGORY_LABELS: Record<CreditCat, string> = {
  required: "必修",
  elective: "選修",
  general: "通識",
  pe: "體育",
  service: "服務學習",
  other: "其他",
};

const CATEGORY_COLORS: Record<CreditCat, string> = {
  required: "#f43f5e",
  elective: "#3b82f6",
  general: "#10b981",
  pe: "#f59e0b",
  service: "#8b5cf6",
  other: "#64748b",
};

/** 靜宜大學 128 學分畢業門檻（一般系所） */
const PU_GRAD_REQUIREMENTS: Record<CreditCat, number> = {
  required: 50,
  elective: 30,
  general: 28,
  pe: 0,      // 體育 0 學分但必修
  service: 0, // 服務學習 0 學分但必修
  other: 20,  // 自由選修
};
const PU_TOTAL_REQUIRED = 128;

function mapCourseType(courseType?: string): CreditCat {
  if (!courseType) return "other";
  const t = courseType.trim();
  if (t.includes("必修") || t === "Required" || t === "必") return "required";
  if (t.includes("選修") || t === "Elective" || t === "選") return "elective";
  if (t.includes("通識") || t.includes("博雅") || t.includes("核心") || t === "General") return "general";
  if (t.includes("體育") || t === "PE") return "pe";
  if (t.includes("服務") || t.includes("Service")) return "service";
  return "other";
}

function semesterLabel(sem: string): string {
  // "11401" → "114 學年 第1學期", "11402" → "114 學年 第2學期"
  if (sem.length >= 4) {
    const year = sem.substring(0, sem.length - 1);
    const term = sem.charAt(sem.length - 1);
    return `${year} 學年 第${term}學期`;
  }
  return sem;
}

function scoreDisplay(grade: Grade): string {
  const s = grade.grade ?? grade.score;
  if (s === undefined || s === null) return "-";
  if (typeof s === "string") return s;
  return String(Math.round(s * 10) / 10);
}

function isPassed(grade: Grade): boolean {
  const s = grade.grade ?? grade.score ?? 0;
  return s >= 60;
}

// ─── Component ──────────────────────────────────────────
export function CreditAuditScreen(props: any) {
  const auth = useAuth();
  const { school } = useSchool();
  const [grades, setGrades] = useState<Grade[]>([]);
  const [gpaData, setGpaData] = useState<{ gpa: number; totalCredits: number; totalPoints: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSem, setExpandedSem] = useState<string | null>(null);

  // ── 載入成績 ──
  useEffect(() => {
    if (!auth.user?.uid || !hasDataSource()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const ds = getDataSource();
    Promise.all([
      ds.listGrades(auth.user.uid, undefined, school.id).catch(() => [] as Grade[]),
      ds.getGPA(auth.user.uid, school.id).catch(() => ({ gpa: 0, totalCredits: 0, totalPoints: 0 })),
    ])
      .then(([g, gpa]) => {
        setGrades(g);
        setGpaData(gpa);
        setError(null);
      })
      .catch((e) => setError(e?.message || "載入失敗"))
      .finally(() => setLoading(false));
  }, [auth.user?.uid, school.id]);

  // ── 計算學分摘要 ──
  const creditSummary = useMemo(() => {
    const byCategory: Record<CreditCat, { earned: number; courses: number; required: number; passedCourses: number; failedCourses: number }> = {
      required: { earned: 0, courses: 0, required: PU_GRAD_REQUIREMENTS.required, passedCourses: 0, failedCourses: 0 },
      elective: { earned: 0, courses: 0, required: PU_GRAD_REQUIREMENTS.elective, passedCourses: 0, failedCourses: 0 },
      general: { earned: 0, courses: 0, required: PU_GRAD_REQUIREMENTS.general, passedCourses: 0, failedCourses: 0 },
      pe: { earned: 0, courses: 0, required: PU_GRAD_REQUIREMENTS.pe, passedCourses: 0, failedCourses: 0 },
      service: { earned: 0, courses: 0, required: PU_GRAD_REQUIREMENTS.service, passedCourses: 0, failedCourses: 0 },
      other: { earned: 0, courses: 0, required: PU_GRAD_REQUIREMENTS.other, passedCourses: 0, failedCourses: 0 },
    };

    let totalEarned = 0;
    let totalCourses = 0;
    let passedCount = 0;
    let failedCount = 0;

    for (const g of grades) {
      const cat = mapCourseType(g.courseType);
      const passed = isPassed(g);
      byCategory[cat].courses += 1;
      totalCourses += 1;

      if (passed) {
        byCategory[cat].earned += g.credits;
        byCategory[cat].passedCourses += 1;
        totalEarned += g.credits;
        passedCount += 1;
      } else {
        byCategory[cat].failedCourses += 1;
        failedCount += 1;
      }
    }

    return { byCategory, totalEarned, totalCourses, passedCount, failedCount };
  }, [grades]);

  // ── 按學期分組 ──
  const bySemester = useMemo(() => {
    const map = new Map<string, Grade[]>();
    for (const g of grades) {
      const sem = g.semester || "unknown";
      if (!map.has(sem)) map.set(sem, []);
      map.get(sem)!.push(g);
    }
    // 按學期碼排序（降序，新的在前）
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [grades]);

  // ── 重新載入 ──
  const handleReload = useCallback(async () => {
    if (!auth.user?.uid || !hasDataSource()) return;
    setLoading(true);
    try {
      const ds = getDataSource();
      const [g, gpa] = await Promise.all([
        ds.listGrades(auth.user.uid, undefined, school.id),
        ds.getGPA(auth.user.uid, school.id).catch(() => ({ gpa: 0, totalCredits: 0, totalPoints: 0 })),
      ]);
      setGrades(g);
      setGpaData(gpa);
    } catch (e: any) {
      setError(e?.message || "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid, school.id]);

  // ── Guards ──
  if (!auth.user) {
    return (
      <AuthGuard
        user={auth.user}
        onLogin={() => props?.navigation?.navigate?.("Me")}
        title="需要登入"
        description="請登入以使用學分試算功能。登入後可查看完整的修課紀錄、學分進度與畢業審查。"
      >
        <></>
      </AuthGuard>
    );
  }

  if (loading) return <LoadingState title="學分試算" subtitle="載入成績資料中..." rows={3} />;

  if (error) {
    return (
      <ErrorState title="學分試算" subtitle="載入失敗" hint={error}
        actionText="重試" onAction={handleReload} errorType="network" />
    );
  }

  if (grades.length === 0) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Card title="學分試算">
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 20 }}>
              <Ionicons name="school-outline" size={48} color={theme.colors.accent} style={{ opacity: 0.5 }} />
              <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.text }}>尚無成績資料</Text>
              <Text style={{ color: theme.colors.muted, textAlign: "center", lineHeight: 20 }}>
                請先在「我的」頁面登入 E校園帳號，系統會自動匯入您的完整成績紀錄。
              </Text>
              <Button text="重新整理" kind="primary" onPress={handleReload} />
            </View>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  const { byCategory, totalEarned, totalCourses, passedCount, failedCount } = creditSummary;
  const totalPct = Math.min(1, totalEarned / PU_TOTAL_REQUIRED);
  const remaining = Math.max(0, PU_TOTAL_REQUIRED - totalEarned);
  const satisfied = remaining <= 0;

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {/* ═══ 總學分進度 ═══ */}
        <Card title="畢業學分進度">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>畢業門檻 {PU_TOTAL_REQUIRED} 學分</Text>
            <Pill text={satisfied ? "已達標" : "未達標"} kind={satisfied ? "accent" : "default"} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 8 }}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 40 }}>{totalEarned}</Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 20, marginLeft: 4 }}>
              / {PU_TOTAL_REQUIRED}
            </Text>
          </View>
          <View style={{ marginTop: 10, height: 14, borderRadius: 7, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${Math.round(totalPct * 100)}%`, backgroundColor: satisfied ? "#10b981" : theme.colors.accent, borderRadius: 7 }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {remaining > 0 ? `還需 ${remaining} 學分` : "已達畢業學分要求"}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {totalCourses} 門課・通過 {passedCount}・未通過 {failedCount}
            </Text>
          </View>
        </Card>

        {/* ═══ GPA ═══ */}
        {gpaData && gpaData.totalCredits > 0 && (
          <Card title="GPA 總績點">
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 40 }}>
                {gpaData.gpa.toFixed(2)}
              </Text>
              <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 20, marginLeft: 4 }}>/ 4.00</Text>
            </View>
            <Text style={{ color: theme.colors.muted, marginTop: 6, fontSize: 13 }}>
              已修 {gpaData.totalCredits} 學分・加權總績點 {gpaData.totalPoints.toFixed(1)}
            </Text>
          </Card>
        )}

        {/* ═══ 分類進度 ═══ */}
        <Card title="各類學分進度">
          {(["required", "elective", "general", "pe", "service", "other"] as const).map((k) => {
            const b = byCategory[k];
            // 體育和服務學習看門數，其他看學分
            const isCountBased = k === "pe" || k === "service";
            const showVal = isCountBased ? b.passedCourses : b.earned;
            const reqVal = isCountBased ? (k === "pe" ? 4 : 2) : b.required;
            const pct = reqVal <= 0 ? 1 : Math.min(1, showVal / reqVal);
            const rem = Math.max(0, reqVal - showVal);
            const done = rem <= 0;

            return (
              <View key={k} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: CATEGORY_COLORS[k] }} />
                    <Text style={{ color: theme.colors.text, fontWeight: "800" }}>{CATEGORY_LABELS[k]}</Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>({b.courses} 門)</Text>
                  </View>
                  <Text style={{ color: done ? "#10b981" : theme.colors.muted, fontWeight: "600", fontSize: 13 }}>
                    {showVal}{isCountBased ? " 門" : ""}/{reqVal}{isCountBased ? " 門" : ""} {done ? "✓" : `(差${rem}${isCountBased ? "門" : ""})`}
                  </Text>
                </View>
                <View style={{ marginTop: 6, height: 8, borderRadius: 4, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
                  <View style={{ height: "100%", width: `${Math.round(pct * 100)}%`, backgroundColor: CATEGORY_COLORS[k], opacity: 0.85, borderRadius: 4 }} />
                </View>
                {/* 顯示通過/未通過明細 */}
                {b.failedCourses > 0 && (
                  <Text style={{ color: "#f43f5e", fontSize: 11, marginTop: 4 }}>
                    ⚠ 有 {b.failedCourses} 門未通過
                  </Text>
                )}
              </View>
            );
          })}
        </Card>

        {/* ═══ 各學期明細 ═══ */}
        <Card title="各學期成績明細" subtitle={`共 ${bySemester.length} 個學期`}>
          <View style={{ gap: 8 }}>
            {bySemester.map(([sem, semGrades]) => {
              const isExpanded = expandedSem === sem;
              const semCredits = semGrades.reduce((s, g) => s + (isPassed(g) ? g.credits : 0), 0);
              const semScores = semGrades
                .filter((g) => typeof (g.grade ?? g.score) === "number" && (g.grade ?? g.score ?? 0) > 0)
                .map((g) => ({ score: (g.grade ?? g.score ?? 0) as number, credits: g.credits }));
              const weightedAvg =
                semScores.length > 0
                  ? semScores.reduce((s, g) => s + g.score * g.credits, 0) /
                    semScores.reduce((s, g) => s + g.credits, 0)
                  : 0;

              return (
                <View key={sem}>
                  <Pressable
                    onPress={() => setExpandedSem(isExpanded ? null : sem)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: isExpanded ? theme.colors.surface2 : "transparent",
                      borderWidth: 1,
                      borderColor: isExpanded ? theme.colors.border : theme.colors.surface2,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                        {semesterLabel(sem)}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{semGrades.length} 門課</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>學分：{semCredits}</Text>
                        {weightedAvg > 0 && (
                          <Text style={{ color: weightedAvg >= 80 ? "#10b981" : weightedAvg >= 60 ? theme.colors.muted : "#f43f5e", fontSize: 12, fontWeight: "600" }}>
                            加權平均：{weightedAvg.toFixed(1)}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Ionicons
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={theme.colors.muted}
                    />
                  </Pressable>

                  {isExpanded && (
                    <View style={{ paddingHorizontal: 4, paddingTop: 4, gap: 6 }}>
                      {/* 表頭 */}
                      <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 6 }}>
                        <Text style={{ flex: 4, color: theme.colors.muted, fontSize: 11, fontWeight: "600" }}>科目</Text>
                        <Text style={{ flex: 1.5, color: theme.colors.muted, fontSize: 11, fontWeight: "600", textAlign: "center" }}>修別</Text>
                        <Text style={{ flex: 1, color: theme.colors.muted, fontSize: 11, fontWeight: "600", textAlign: "center" }}>學分</Text>
                        <Text style={{ flex: 1, color: theme.colors.muted, fontSize: 11, fontWeight: "600", textAlign: "center" }}>成績</Text>
                      </View>
                      {semGrades.map((g, i) => {
                        const passed = isPassed(g);
                        const cat = mapCourseType(g.courseType);
                        return (
                          <View
                            key={g.id || `${sem}-${i}`}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: theme.radius.sm,
                              backgroundColor: passed ? "transparent" : "rgba(244,63,94,0.05)",
                              borderBottomWidth: i < semGrades.length - 1 ? 1 : 0,
                              borderBottomColor: theme.colors.surface2,
                            }}
                          >
                            <View style={{ flex: 4 }}>
                              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "600" }} numberOfLines={2}>
                                {g.courseName}
                              </Text>
                              {g.courseClass && (
                                <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}>{g.courseClass}</Text>
                              )}
                            </View>
                            <View style={{ flex: 1.5, alignItems: "center" }}>
                              <View style={{
                                paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                                backgroundColor: CATEGORY_COLORS[cat] + "18",
                              }}>
                                <Text style={{ fontSize: 10, fontWeight: "700", color: CATEGORY_COLORS[cat] }}>
                                  {g.courseType || CATEGORY_LABELS[cat]}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 13, fontWeight: "600" }}>
                              {g.credits}
                            </Text>
                            <Text style={{
                              flex: 1, textAlign: "center", fontSize: 13, fontWeight: "700",
                              color: passed ? (((g.grade ?? g.score ?? 0) as number) >= 80 ? "#10b981" : theme.colors.text) : "#f43f5e",
                            }}>
                              {scoreDisplay(g)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </Card>

        {/* ═══ 缺口分析 ═══ */}
        {remaining > 0 && (
          <Card title="畢業缺口分析">
            <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 8 }}>
              距離畢業門檻 {PU_TOTAL_REQUIRED} 學分還差 {remaining} 學分，以下為各分類建議：
            </Text>
            {(["required", "elective", "general", "other"] as const)
              .filter((k) => {
                const rem = byCategory[k].required - byCategory[k].earned;
                return rem > 0;
              })
              .map((k) => {
                const rem = byCategory[k].required - byCategory[k].earned;
                return (
                  <View
                    key={k}
                    style={{
                      padding: 12, borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderLeftWidth: 3, borderLeftColor: CATEGORY_COLORS[k],
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 14 }}>
                      {CATEGORY_LABELS[k]}：還需 {rem} 學分
                    </Text>
                    <Text style={{ color: theme.colors.muted, marginTop: 4, fontSize: 12, lineHeight: 18 }}>
                      建議選修約 {Math.ceil(rem / 3)} 門課程來補足此分類的學分缺口。
                    </Text>
                  </View>
                );
              })}

            <View style={{ marginTop: 8 }}>
              <Button
                text="開啟 AI 選課助理"
                kind="primary"
                onPress={() => props?.navigation?.getParent?.()?.navigate?.("AICourseAdvisor")}
              />
            </View>
          </Card>
        )}

        {/* ═══ 底部操作 ═══ */}
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 4, paddingBottom: 8 }}>
          <Button text="重新整理" onPress={handleReload} />
        </View>
      </ScrollView>
    </Screen>
  );
}
