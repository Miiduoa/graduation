/* eslint-disable */
/**
 * 🎓 智慧選課顧問 — Course Advisor Screen
 *
 * 整合 courseRecommendationEngine：
 *   1. 畢業學分缺口分析
 *   2. 課表衝堂偵測
 *   3. 課業負載分析
 *   4. AI 選課推薦
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  Platform,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../ui/theme";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { useThemeMode } from "../state/theme";
import {
  getScheduleOptimization,
  type ScheduleOptimization,
  type GraduationGap,
  type ScheduleConflict,
  type WorkloadAnalysis,
  type CourseRecommendation,
} from "../services/courseRecommendationEngine";
import { earnXP } from "../services/gamificationEngine";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_W } = Dimensions.get("window");

// ─── Main Screen ─────────────────────────────────────────

export function CourseAdvisorScreen() {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ScheduleOptimization | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"gaps" | "workload" | "recommend">("gaps");

  const load = useCallback(async () => {
    try {
      const result = await getScheduleOptimization();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setData(result);
      earnXP("plan_schedule").catch(() => {});
    } catch (e) {
      console.warn("[CourseAdvisor] load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: theme.space.md }}>分析選課資料中...</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center", alignItems: "center", padding: theme.space.xl }}>
        <Ionicons name="school-outline" size={64} color={theme.colors.textSecondary} />
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700", marginTop: theme.space.lg, textAlign: "center" }}>
          尚無課程資料
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: theme.space.sm, textAlign: "center" }}>
          登入並同步課表後即可使用選課顧問
        </Text>
      </View>
    );
  }

  const graduationGaps = data.graduationGaps ?? data.gaps ?? [];
  const conflicts = data.conflicts ?? [];
  const workload = data.workloadAnalysis ?? data.workload;
  const recommendations = data.recommendations ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.md }}>
          <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "800" }}>選課顧問</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 4 }}>
            AI 幫你規劃最佳選課策略
          </Text>
        </View>

        {/* Tab Switcher */}
        <View style={{
          flexDirection: "row",
          marginHorizontal: theme.space.lg,
          marginBottom: theme.space.lg,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          padding: 3,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}>
          {[
            { key: "gaps" as const, label: "畢業缺口", icon: "school-outline" },
            { key: "workload" as const, label: "負載分析", icon: "bar-chart-outline" },
            { key: "recommend" as const, label: "推薦選課", icon: "bulb-outline" },
          ].map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setActiveTab(tab.key);
              }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                paddingVertical: 10,
                borderRadius: theme.radius.sm,
                backgroundColor: activeTab === tab.key ? theme.colors.accent : "transparent",
              }}
            >
              <Ionicons
                name={tab.icon as any}
                size={16}
                color={activeTab === tab.key ? "#fff" : theme.colors.textSecondary}
              />
              <Text style={{
                color: activeTab === tab.key ? "#fff" : theme.colors.textSecondary,
                fontSize: 13,
                fontWeight: activeTab === tab.key ? "700" : "500",
              }}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Conflicts (always visible if any) */}
        {conflicts.length > 0 && (
          <ConflictSection conflicts={conflicts} />
        )}

        {/* Tab Content */}
        {activeTab === "gaps" && <GraduationGapSection gaps={graduationGaps} />}
        {activeTab === "workload" && <WorkloadSection workload={workload} />}
        {activeTab === "recommend" && <RecommendationSection recommendations={recommendations} />}
      </ScrollView>
    </View>
  );
}

// ─── Graduation Gap Section ─────────────────────────────

function GraduationGapSection({ gaps }: { gaps: GraduationGap[] }) {
  const totalRequired = gaps.reduce((s, g) => s + g.required, 0);
  const totalEarned = gaps.reduce((s, g) => s + g.earned, 0);
  const totalRemaining = gaps.reduce((s, g) => s + g.remaining, 0);
  const overallProgress = totalRequired > 0 ? totalEarned / totalRequired : 0;

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      {/* Overall Progress */}
      <View style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.lg,
        marginBottom: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.space.md }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700" }}>畢業學分進度</Text>
          <Text style={{ color: theme.colors.accent, fontSize: 15, fontWeight: "700" }}>
            {totalEarned}/{totalRequired}
          </Text>
        </View>

        {/* Big progress bar */}
        <View style={{ height: 12, backgroundColor: theme.colors.border, borderRadius: 6, marginBottom: theme.space.sm }}>
          <View style={{
            height: 12,
            width: `${Math.min(overallProgress * 100, 100)}%` as any,
            backgroundColor: overallProgress >= 0.9 ? theme.colors.success : overallProgress >= 0.6 ? theme.colors.accent : theme.colors.warning,
            borderRadius: 6,
          }} />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            已修 {totalEarned} 學分
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            還需 {totalRemaining} 學分
          </Text>
        </View>

        {/* Quick stats */}
        <View style={{ flexDirection: "row", justifyContent: "space-around", marginTop: theme.space.lg }}>
          {[
            { label: "完成度", value: `${(overallProgress * 100).toFixed(0)}%`, color: theme.colors.accent },
            { label: "缺口分類", value: `${gaps.filter((g) => g.remaining > 0).length}`, color: theme.colors.warning },
            { label: "已完成", value: `${gaps.filter((g) => g.remaining <= 0).length}`, color: theme.colors.success },
          ].map((s) => (
            <View key={s.label} style={{ alignItems: "center" }}>
              <Text style={{ color: s.color, fontSize: 22, fontWeight: "800" }}>{s.value}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Category breakdown */}
      {gaps.map((gap, i) => (
        <GapCard key={i} gap={gap} />
      ))}
    </View>
  );
}

function GapCard({ gap }: { gap: GraduationGap }) {
  const progress = gap.required > 0 ? gap.earned / gap.required : 1;
  const done = gap.remaining <= 0;
  const barColor = done ? theme.colors.success : progress >= 0.7 ? theme.colors.accent : theme.colors.warning;

  return (
    <View style={{
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      padding: theme.space.md,
      marginBottom: theme.space.sm,
      borderWidth: 1,
      borderColor: done ? theme.colors.success + "40" : theme.colors.border,
    }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {done && <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />}
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: "600" }}>{gap.category}</Text>
        </View>
        <Text style={{ color: done ? theme.colors.success : theme.colors.text, fontSize: 13, fontWeight: "700" }}>
          {gap.earned}/{gap.required}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: theme.colors.border, borderRadius: 3 }}>
        <View style={{
          height: 6,
          width: `${Math.min(progress * 100, 100)}%` as any,
          backgroundColor: barColor,
          borderRadius: 3,
        }} />
      </View>
      {!done && (
        <Text style={{ color: theme.colors.warning, fontSize: 11, marginTop: 4 }}>
          還需修 {gap.remaining} 學分
        </Text>
      )}
    </View>
  );
}

// ─── Conflict Section ───────────────────────────────────

function ConflictSection({ conflicts }: { conflicts: ScheduleConflict[] }) {
  return (
    <View style={{
      marginHorizontal: theme.space.lg,
      marginBottom: theme.space.lg,
      backgroundColor: theme.colors.dangerSoft ?? (theme.colors.danger + "15"),
      borderRadius: theme.radius.lg,
      padding: theme.space.lg,
      borderWidth: 1,
      borderColor: theme.colors.danger + "40",
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: theme.space.md }}>
        <Ionicons name="warning" size={20} color={theme.colors.danger} />
        <Text style={{ color: theme.colors.danger, fontSize: 16, fontWeight: "700" }}>
          衝堂警告 ({conflicts.length})
        </Text>
      </View>
      {conflicts.map((c, i) => (
        <View key={i} style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          padding: theme.space.sm,
          marginBottom: i < conflicts.length - 1 ? theme.space.sm : 0,
          borderWidth: 1,
          borderColor: theme.colors.danger + "30",
        }}>
          <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "600" }}>
            {c.courseA || c.course1} vs {c.courseB || c.course2}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            {c.description || c.details || `週${c.day}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Workload Section ───────────────────────────────────

function WorkloadSection({ workload }: { workload: WorkloadAnalysis }) {
  const balanceColor =
    workload.balanceScore >= 80 ? theme.colors.success :
    workload.balanceScore >= 60 ? theme.colors.accent :
    workload.balanceScore >= 40 ? theme.colors.warning :
    theme.colors.danger;

  const dayNames = ["日", "一", "二", "三", "四", "五", "六"];

  // heavyDays/lightDays are {day, hours}[]
  const allDays = [...(workload.heavyDays || []), ...(workload.lightDays || [])].sort((a, b) => a.day - b.day);
  const heavyDayNums = new Set((workload.heavyDays || []).map((d) => d.day));

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      {/* Balance Score */}
      <View style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.lg,
        marginBottom: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
      }}>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700", marginBottom: theme.space.md }}>
          課業負載平衡度
        </Text>

        <View style={{
          width: 100,
          height: 100,
          borderRadius: 50,
          borderWidth: 8,
          borderColor: balanceColor + "30",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: theme.space.md,
        }}>
          <Text style={{ color: balanceColor, fontSize: 28, fontWeight: "800" }}>{workload.balanceScore}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 10 }}>/ 100</Text>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-around", width: "100%" }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>{workload.totalCredits}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>總學分</Text>
          </View>
          <View style={{ alignItems: "center" }}>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>{workload.gapHours}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>空堂小時</Text>
          </View>
        </View>
      </View>

      {/* Daily breakdown */}
      {allDays.length > 0 && (
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.space.lg,
          marginBottom: theme.space.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700", marginBottom: theme.space.md }}>
            每日課程分佈
          </Text>
          {allDays.map((day, i) => {
            const isHeavy = heavyDayNums.has(day.day);
            const maxHours = Math.max(...allDays.map((d) => d.hours), 1);
            const barW = (day.hours / maxHours) * 100;
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 }}>
                <Text style={{
                  color: isHeavy ? theme.colors.danger : theme.colors.text,
                  fontSize: 13,
                  fontWeight: "600",
                  width: 24,
                }}>
                  {dayNames[day.day] ?? day.day}
                </Text>
                <View style={{ flex: 1, height: 16, backgroundColor: theme.colors.border, borderRadius: 4 }}>
                  <View style={{
                    height: 16,
                    width: `${barW}%` as any,
                    backgroundColor: isHeavy ? theme.colors.danger : theme.colors.accent,
                    borderRadius: 4,
                  }} />
                </View>
                <Text style={{
                  color: isHeavy ? theme.colors.danger : theme.colors.textSecondary,
                  fontSize: 12,
                  fontWeight: "600",
                  width: 36,
                  textAlign: "right",
                }}>
                  {day.hours}h
                </Text>
                {isHeavy && <Ionicons name="warning" size={14} color={theme.colors.danger} />}
              </View>
            );
          })}
        </View>
      )}

      {/* Suggestions */}
      {(workload.suggestions?.length > 0 || workload.suggestion) && (
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.space.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: theme.space.md }}>
            <Ionicons name="bulb-outline" size={20} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>建議</Text>
          </View>
          {(workload.suggestions || [workload.suggestion]).filter(Boolean).map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
              <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} style={{ marginTop: 1 }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 19 }}>{s}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Recommendation Section ─────────────────────────────

function RecommendationSection({ recommendations }: { recommendations: CourseRecommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <View style={{ marginHorizontal: theme.space.lg, alignItems: "center", paddingVertical: theme.space.xl }}>
        <Ionicons name="checkmark-done-circle" size={48} color={theme.colors.success} />
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "600", marginTop: theme.space.md }}>
          目前無推薦課程
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: theme.space.sm, textAlign: "center" }}>
          你的選課規劃看起來很完善
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      {recommendations.map((rec, i) => (
        <View key={i} style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.space.lg,
          marginBottom: theme.space.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: theme.space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "700" }}>{rec.courseName}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>{rec.courseCode}</Text>
            </View>
            <View style={{
              backgroundColor: theme.colors.accentSoft,
              borderRadius: theme.radius.sm,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}>
              <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "700" }}>
                {(rec.confidenceScore * 100).toFixed(0)}分
              </Text>
            </View>
          </View>

          {/* Reason */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Ionicons name="checkmark" size={14} color={theme.colors.success} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, flex: 1 }}>{rec.reason}</Text>
          </View>

          {/* Meta info */}
          <View style={{ flexDirection: "row", gap: 12, marginTop: theme.space.sm }}>
            {rec.category && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="folder-outline" size={12} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{rec.category}</Text>
              </View>
            )}
            {rec.credits != null && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="school-outline" size={12} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{rec.credits} 學分</Text>
              </View>
            )}
            {rec.predictedGrade != null && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="analytics-outline" size={12} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "600" }}>
                  預測 {rec.predictedGrade.toFixed(0)} 分
                </Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
