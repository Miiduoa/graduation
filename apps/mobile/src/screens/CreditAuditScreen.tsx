/* eslint-disable */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { ScrollView, Text, View, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Pill, Button, LoadingState, ErrorState, AuthGuard } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { hasDataSource, getDataSource } from '../data';
import type { Grade } from '../data/types';
import {
  type PUCreditCat,
  type DeptGradRequirement,
  PU_CATEGORY_LABELS,
  PU_CATEGORY_COLORS,
  PU_DEFAULT_REQUIREMENT,
  PU_DEPARTMENTS,
  matchDepartment,
  mapCourseTypeDetailed,
} from '../data/puGradRequirements';

// ─── Helpers ────────────────────────────────────────────

function semesterLabel(sem: string): string {
  if (sem.length >= 4) {
    const year = sem.substring(0, sem.length - 1);
    const term = sem.charAt(sem.length - 1);
    return `${year} 學年 第${term}學期`;
  }
  return sem;
}

function scoreDisplay(grade: Grade): string {
  const s = grade.grade ?? grade.score;
  if (s === undefined || s === null) return '-';
  if (typeof s === 'string') return s;
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
  const [gpaData, setGpaData] = useState<{
    gpa: number;
    totalCredits: number;
    totalPoints: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSem, setExpandedSem] = useState<string | null>(null);
  const [showDeptPicker, setShowDeptPicker] = useState(false);
  const [manualDeptId, setManualDeptId] = useState<string | null>(null);

  // ── 自動偵測系所 ──
  const detectedDept = useMemo(() => {
    const dept = auth.profile?.department;
    return matchDepartment(dept);
  }, [auth.profile?.department]);

  // 使用者手動選擇的系所 > 自動偵測
  const currentDept: DeptGradRequirement = useMemo(() => {
    if (manualDeptId) {
      const found = PU_DEPARTMENTS.find((d) => d.id === manualDeptId);
      if (found) return found;
    }
    return detectedDept;
  }, [manualDeptId, detectedDept]);

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
      ds
        .getGPA(auth.user.uid, school.id)
        .catch(() => ({ gpa: 0, totalCredits: 0, totalPoints: 0 })),
    ])
      .then(([g, gpa]) => {
        setGrades(g);
        setGpaData(gpa);
        setError(null);
      })
      .catch((e) => setError(e?.message || '載入失敗'))
      .finally(() => setLoading(false));
  }, [auth.user?.uid, school.id]);

  // ── 計算學分摘要（使用系所門檻） ──
  const creditSummary = useMemo(() => {
    const req = currentDept.credits;
    const byCategory: Record<
      PUCreditCat,
      {
        earned: number;
        courses: number;
        required: number;
        passedCourses: number;
        failedCourses: number;
      }
    > = {
      required: {
        earned: 0,
        courses: 0,
        required: req.required,
        passedCourses: 0,
        failedCourses: 0,
      },
      elective: {
        earned: 0,
        courses: 0,
        required: req.elective,
        passedCourses: 0,
        failedCourses: 0,
      },
      general: { earned: 0, courses: 0, required: req.general, passedCourses: 0, failedCourses: 0 },
      common: { earned: 0, courses: 0, required: req.common, passedCourses: 0, failedCourses: 0 },
      pe: { earned: 0, courses: 0, required: req.pe, passedCourses: 0, failedCourses: 0 },
      service: { earned: 0, courses: 0, required: req.service, passedCourses: 0, failedCourses: 0 },
      free: { earned: 0, courses: 0, required: req.free, passedCourses: 0, failedCourses: 0 },
    };

    let totalEarned = 0;
    let totalCourses = 0;
    let passedCount = 0;
    let failedCount = 0;

    for (const g of grades) {
      const cat = mapCourseTypeDetailed(g.courseType, g.courseName);
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
  }, [grades, currentDept]);

  // ── 按學期分組 ──
  const bySemester = useMemo(() => {
    const map = new Map<string, Grade[]>();
    for (const g of grades) {
      const sem = g.semester || 'unknown';
      if (!map.has(sem)) map.set(sem, []);
      map.get(sem)!.push(g);
    }
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
        ds
          .getGPA(auth.user.uid, school.id)
          .catch(() => ({ gpa: 0, totalCredits: 0, totalPoints: 0 })),
      ]);
      setGrades(g);
      setGpaData(gpa);
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [auth.user?.uid, school.id]);

  // ── Guards ──
  if (!auth.user) {
    return (
      <AuthGuard
        user={auth.user}
        onLogin={() => props?.navigation?.navigate?.('Me')}
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
      <ErrorState
        title="學分試算"
        subtitle="載入失敗"
        hint={error}
        actionText="重試"
        onAction={handleReload}
        errorType="network"
      />
    );
  }

  if (grades.length === 0) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Card title="學分試算">
            <View style={{ alignItems: 'center', gap: 12, paddingVertical: 20 }}>
              <Ionicons
                name="school-outline"
                size={48}
                color={theme.colors.accent}
                style={{ opacity: 0.5 }}
              />
              <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
                尚無成績資料
              </Text>
              <Text style={{ color: theme.colors.muted, textAlign: 'center', lineHeight: 20 }}>
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
  const totalRequired = currentDept.totalCredits;
  const totalPct = Math.min(1, totalEarned / totalRequired);
  const remaining = Math.max(0, totalRequired - totalEarned);
  const satisfied = remaining <= 0;

  // 學分類別顯示順序
  const categoryOrder: PUCreditCat[] = [
    'required',
    'elective',
    'general',
    'common',
    'pe',
    'service',
    'free',
  ];

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        {/* ═══ 系所資訊 ═══ */}
        <Card title="畢業門檻">
          <View style={{ gap: 10 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
                  {currentDept.name}
                </Text>
                {currentDept.college ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    {currentDept.college} · 畢業門檻 {totalRequired} 學分
                  </Text>
                ) : (
                  <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                    畢業門檻 {totalRequired} 學分
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => setShowDeptPicker(!showDeptPicker)}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>
                  {showDeptPicker ? '收合' : '切換系所'}
                </Text>
              </Pressable>
            </View>

            {detectedDept.id !== 'default' && !manualDeptId && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} />
                <Text style={{ color: theme.colors.success, fontSize: 11 }}>
                  已根據 E 校園資料自動偵測為「{detectedDept.shortName}」
                </Text>
              </View>
            )}

            {currentDept.notes && (
              <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16 }}>
                {currentDept.notes}
              </Text>
            )}

            {/* 系所選擇器 */}
            {showDeptPicker && (
              <View style={{ gap: 6, marginTop: 4 }}>
                {PU_DEPARTMENTS.map((dept) => {
                  const isActive = dept.id === currentDept.id;
                  return (
                    <Pressable
                      key={dept.id}
                      onPress={() => {
                        setManualDeptId(dept.id);
                        setShowDeptPicker(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: isActive ? theme.colors.accentSoft : theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: isActive ? theme.colors.accent : theme.colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                          {dept.name}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          {dept.college} · {dept.totalCredits} 學分
                        </Text>
                      </View>
                      {isActive && (
                        <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} />
                      )}
                    </Pressable>
                  );
                })}
                {/* 恢復自動偵測 */}
                {manualDeptId && (
                  <Pressable
                    onPress={() => {
                      setManualDeptId(null);
                      setShowDeptPicker(false);
                    }}
                    style={({ pressed }) => ({
                      padding: 10,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      alignItems: 'center',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 12 }}>
                      恢復自動偵測
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </Card>

        {/* ═══ 總學分進度 ═══ */}
        <Card title="畢業學分進度">
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              畢業門檻 {totalRequired} 學分
            </Text>
            <Pill text={satisfied ? '已達標' : '未達標'} kind={satisfied ? 'accent' : 'default'} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 40 }}>
              {totalEarned}
            </Text>
            <Text
              style={{ color: theme.colors.muted, fontWeight: '700', fontSize: 20, marginLeft: 4 }}
            >
              / {totalRequired}
            </Text>
          </View>
          <View
            style={{
              marginTop: 10,
              height: 14,
              borderRadius: 7,
              backgroundColor: theme.colors.surface2,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${Math.round(totalPct * 100)}%`,
                backgroundColor: satisfied ? '#34C759' : theme.colors.accent,
                borderRadius: 7,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {remaining > 0 ? `還需 ${remaining} 學分` : '已達畢業學分要求'}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
              {totalCourses} 門課・通過 {passedCount}・未通過 {failedCount}
            </Text>
          </View>
        </Card>

        {/* ═══ GPA ═══ */}
        {gpaData && gpaData.totalCredits > 0 && (
          <Card title="GPA 總績點">
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 40 }}>
                {gpaData.gpa.toFixed(2)}
              </Text>
              <Text
                style={{
                  color: theme.colors.muted,
                  fontWeight: '700',
                  fontSize: 20,
                  marginLeft: 4,
                }}
              >
                / 4.00
              </Text>
            </View>
            <Text style={{ color: theme.colors.muted, marginTop: 6, fontSize: 13 }}>
              已修 {gpaData.totalCredits} 學分・加權總績點 {gpaData.totalPoints.toFixed(1)}
            </Text>
          </Card>
        )}

        {/* ═══ 分類進度 ═══ */}
        <Card title="各類學分進度" subtitle={currentDept.shortName}>
          {categoryOrder.map((k) => {
            const b = byCategory[k];
            // 體育和服務學習看門數，其他看學分
            const isCountBased = k === 'pe' || k === 'service';
            const showVal = isCountBased ? b.passedCourses : b.earned;
            const reqVal = isCountBased
              ? k === 'pe'
                ? currentDept.peCoursesRequired
                : currentDept.serviceCoursesRequired
              : b.required;

            // 跳過無門檻且無修課的類別
            if (reqVal === 0 && b.courses === 0 && !isCountBased) return null;

            const pct = reqVal <= 0 ? (showVal > 0 ? 1 : 0) : Math.min(1, showVal / reqVal);
            const rem = Math.max(0, reqVal - showVal);
            const done = rem <= 0;

            return (
              <View key={k} style={{ marginBottom: 16 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: PU_CATEGORY_COLORS[k],
                      }}
                    />
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                      {PU_CATEGORY_LABELS[k]}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      ({b.courses} 門)
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: done ? '#34C759' : theme.colors.muted,
                      fontWeight: '600',
                      fontSize: 13,
                    }}
                  >
                    {showVal}
                    {isCountBased ? ' 門' : ''}/{reqVal}
                    {isCountBased ? ' 門' : ''}{' '}
                    {done ? '✓' : `(差${rem}${isCountBased ? '門' : ''})`}
                  </Text>
                </View>
                <View
                  style={{
                    marginTop: 6,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.colors.surface2,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      width: `${Math.round(pct * 100)}%`,
                      backgroundColor: PU_CATEGORY_COLORS[k],
                      opacity: 0.85,
                      borderRadius: 4,
                    }}
                  />
                </View>
                {b.failedCourses > 0 && (
                  <Text style={{ color: '#f43f5e', fontSize: 11, marginTop: 4 }}>
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
                .filter(
                  (g) => typeof (g.grade ?? g.score) === 'number' && (g.grade ?? g.score ?? 0) > 0,
                )
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
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: isExpanded ? theme.colors.surface2 : 'transparent',
                      borderWidth: 1,
                      borderColor: isExpanded ? theme.colors.border : theme.colors.surface2,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        {semesterLabel(sem)}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {semGrades.length} 門課
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          學分：{semCredits}
                        </Text>
                        {weightedAvg > 0 && (
                          <Text
                            style={{
                              color:
                                weightedAvg >= 80
                                  ? '#34C759'
                                  : weightedAvg >= 60
                                    ? theme.colors.muted
                                    : '#f43f5e',
                              fontSize: 12,
                              fontWeight: '600',
                            }}
                          >
                            加權平均：{weightedAvg.toFixed(1)}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={theme.colors.muted}
                    />
                  </Pressable>

                  {isExpanded && (
                    <View style={{ paddingHorizontal: 4, paddingTop: 4, gap: 6 }}>
                      <View
                        style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6 }}
                      >
                        <Text
                          style={{
                            flex: 4,
                            color: theme.colors.muted,
                            fontSize: 11,
                            fontWeight: '600',
                          }}
                        >
                          科目
                        </Text>
                        <Text
                          style={{
                            flex: 1.5,
                            color: theme.colors.muted,
                            fontSize: 11,
                            fontWeight: '600',
                            textAlign: 'center',
                          }}
                        >
                          分類
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            color: theme.colors.muted,
                            fontSize: 11,
                            fontWeight: '600',
                            textAlign: 'center',
                          }}
                        >
                          學分
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            color: theme.colors.muted,
                            fontSize: 11,
                            fontWeight: '600',
                            textAlign: 'center',
                          }}
                        >
                          成績
                        </Text>
                      </View>
                      {semGrades.map((g, i) => {
                        const passed = isPassed(g);
                        const cat = mapCourseTypeDetailed(g.courseType, g.courseName);
                        return (
                          <View
                            key={g.id || `${sem}-${i}`}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: theme.radius.sm,
                              backgroundColor: passed ? 'transparent' : 'rgba(244,63,94,0.05)',
                              borderBottomWidth: i < semGrades.length - 1 ? 1 : 0,
                              borderBottomColor: theme.colors.surface2,
                            }}
                          >
                            <View style={{ flex: 4 }}>
                              <Text
                                style={{
                                  color: theme.colors.text,
                                  fontSize: 13,
                                  fontWeight: '600',
                                }}
                                numberOfLines={2}
                              >
                                {g.courseName}
                              </Text>
                              {g.courseClass && (
                                <Text
                                  style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}
                                >
                                  {g.courseClass}
                                </Text>
                              )}
                            </View>
                            <View style={{ flex: 1.5, alignItems: 'center' }}>
                              <View
                                style={{
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                  backgroundColor: PU_CATEGORY_COLORS[cat] + '18',
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: PU_CATEGORY_COLORS[cat],
                                  }}
                                >
                                  {PU_CATEGORY_LABELS[cat]}
                                </Text>
                              </View>
                            </View>
                            <Text
                              style={{
                                flex: 1,
                                textAlign: 'center',
                                color: theme.colors.text,
                                fontSize: 13,
                                fontWeight: '600',
                              }}
                            >
                              {g.credits}
                            </Text>
                            <Text
                              style={{
                                flex: 1,
                                textAlign: 'center',
                                fontSize: 13,
                                fontWeight: '700',
                                color: passed
                                  ? ((g.grade ?? g.score ?? 0) as number) >= 80
                                    ? '#34C759'
                                    : theme.colors.text
                                  : '#f43f5e',
                              }}
                            >
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
            <Text
              style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 8 }}
            >
              {currentDept.shortName}畢業門檻 {totalRequired} 學分，目前已修 {totalEarned}{' '}
              學分，還差 {remaining} 學分。
            </Text>
            {categoryOrder
              .filter((k) => {
                if (k === 'pe' || k === 'service') return false; // 門數制另外處理
                const rem = byCategory[k].required - byCategory[k].earned;
                return rem > 0;
              })
              .map((k) => {
                const rem = byCategory[k].required - byCategory[k].earned;
                return (
                  <View
                    key={k}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderLeftWidth: 3,
                      borderLeftColor: PU_CATEGORY_COLORS[k],
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                      {PU_CATEGORY_LABELS[k]}：還需 {rem} 學分
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.muted,
                        marginTop: 4,
                        fontSize: 12,
                        lineHeight: 18,
                      }}
                    >
                      建議選修約 {Math.ceil(rem / 3)} 門課程來補足此分類的學分缺口。
                    </Text>
                  </View>
                );
              })}

            {/* 體育、服務學習門數缺口 */}
            {(() => {
              const peRem = Math.max(
                0,
                currentDept.peCoursesRequired - byCategory.pe.passedCourses,
              );
              const svcRem = Math.max(
                0,
                currentDept.serviceCoursesRequired - byCategory.service.passedCourses,
              );
              if (peRem <= 0 && svcRem <= 0) return null;
              return (
                <>
                  {peRem > 0 && (
                    <View
                      style={{
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderLeftWidth: 3,
                        borderLeftColor: PU_CATEGORY_COLORS.pe,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        體育：還需 {peRem} 門
                      </Text>
                    </View>
                  )}
                  {svcRem > 0 && (
                    <View
                      style={{
                        padding: 12,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderLeftWidth: 3,
                        borderLeftColor: PU_CATEGORY_COLORS.service,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        服務學習：還需 {svcRem} 門
                      </Text>
                    </View>
                  )}
                </>
              );
            })()}

            <View style={{ marginTop: 8 }}>
              <Button
                text="開啟 AI 選課助理"
                kind="primary"
                onPress={() => props?.navigation?.getParent?.()?.navigate?.('AICourseAdvisor')}
              />
            </View>
          </Card>
        )}

        {/* ═══ 底部操作 ═══ */}
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4, paddingBottom: 8 }}>
          <Button text="重新整理" onPress={handleReload} />
        </View>
      </ScrollView>
    </Screen>
  );
}
