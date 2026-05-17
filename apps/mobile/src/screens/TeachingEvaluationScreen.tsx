/**
 * Teaching Evaluation Screen — 系所教學評鑑（主任視角）
 *
 * 用 demo 課程資料聚合：
 *   - 平均分數
 *   - 出席率
 *   - 作業完成率
 *   - AI 健康度（綜合分）
 *
 * 每門課顯示一張卡，open 後展開 detail。
 * 動作：「深入分析」→ deep link 到 CourseGradebook（demo 中是該課的詳細）
 */
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
} from '../ui/cockpitShell';
import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoAttendanceByCourse,
  getDemoScoreItemsByCourse,
  type MockCourse,
} from '../data/demoCoursesMock';
import { safeNavigate } from '../utils/safeNavigate';

interface CourseEvaluation {
  course: MockCourse;
  avgScore: number;
  completionRate: number; // 作業完成率
  attendanceRate: number;
  /** AI 健康度（綜合分） */
  healthScore: number;
  /** 趨勢 vs 平均 */
  tone: 'success' | 'warn' | 'danger' | undefined;
}

function evaluateCourse(course: MockCourse): CourseEvaluation {
  const hws = getDemoHomeworksByCourse(course.id);
  const submitted = hws.filter((h) => h.submitted).length;
  const completionRate = hws.length === 0 ? 0 : submitted / hws.length;

  const items = getDemoScoreItemsByCourse(course.id);
  const graded = items.filter((s) => s.studentScore !== null);
  const avgScore =
    graded.length === 0
      ? 0
      : graded.reduce((a, b) => a + (b.studentScore! / b.totalScore) * 100, 0) / graded.length;

  const attendance = getDemoAttendanceByCourse(course.id);
  const presentCount = attendance.filter((a) => a.myStatus === 'present').length;
  const attendanceRate = attendance.length === 0 ? 0 : presentCount / attendance.length;

  // healthScore：60% 平均分 + 25% 完成率 + 15% 出席
  const healthScore = Math.round(
    avgScore * 0.6 + completionRate * 25 + attendanceRate * 15,
  );

  const tone: CourseEvaluation['tone'] =
    healthScore >= 75 ? 'success' : healthScore >= 60 ? undefined : healthScore >= 40 ? 'warn' : 'danger';

  return {
    course,
    avgScore: Math.round(avgScore),
    completionRate: Math.round(completionRate * 100),
    attendanceRate: Math.round(attendanceRate * 100),
    healthScore,
    tone,
  };
}

export default function TeachingEvaluationScreen() {
  const navigation = useNavigation<any>();
  const bottomPad = useTabBarContentBottomPadding();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const evaluations: CourseEvaluation[] = useMemo(
    () => DEMO_COURSES.map(evaluateCourse).sort((a, b) => a.healthScore - b.healthScore),
    [],
  );

  const overallHealth = useMemo(
    () => Math.round(evaluations.reduce((a, b) => a + b.healthScore, 0) / Math.max(1, evaluations.length)),
    [evaluations],
  );

  const atRiskCount = evaluations.filter((e) => e.tone === 'warn' || e.tone === 'danger').length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow="🏛 系所 · 教學評鑑"
          title={`系所平均健康度 ${overallHealth}`}
          summary={`本系 ${evaluations.length} 門課中有 ${atRiskCount} 門需要關注。AI 健康度 = 60% 平均分 + 25% 完成率 + 15% 出席。`}
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="課程數" value={evaluations.length} />
          <CockpitMetricChip label="需關注" value={atRiskCount} tone={atRiskCount > 0 ? 'warn' : 'success'} />
          <CockpitMetricChip label="平均分" value={Math.round(evaluations.reduce((a, b) => a + b.avgScore, 0) / evaluations.length)} />
          <CockpitMetricChip label="平均出席" value={`${Math.round(evaluations.reduce((a, b) => a + b.attendanceRate, 0) / evaluations.length)}%`} />
        </CockpitMetricRow>

        {evaluations.map((e) => {
          const open = expandedId === e.course.id;
          const color =
            e.tone === 'success'
              ? theme.colors.success
              : e.tone === 'warn'
                ? theme.colors.warning
                : e.tone === 'danger'
                  ? theme.colors.danger
                  : theme.colors.accent;
          return (
            <View
              key={e.course.id}
              style={{
                marginBottom: theme.space.sm,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                borderLeftWidth: 4,
                borderLeftColor: color,
              }}
            >
              <Pressable
                onPress={() => setExpandedId(open ? null : e.course.id)}
                style={({ pressed }) => ({
                  padding: theme.space.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.text }}>
                    {e.course.iconEmoji} {e.course.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                    {e.course.instructor} · 完成 {e.completionRate}% · 出席 {e.attendanceRate}% · 平均 {e.avgScore}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: theme.space.sm + 2,
                    paddingVertical: theme.space.xs + 2,
                    borderRadius: theme.radius.full,
                    backgroundColor: color + '22',
                  }}
                >
                  <Text style={{ color, fontSize: 16, fontWeight: '800' }}>{e.healthScore}</Text>
                </View>
              </Pressable>

              {open && (
                <View style={{ paddingHorizontal: theme.space.md, paddingBottom: theme.space.md }}>
                  <View style={{ marginBottom: theme.space.sm }}>
                    <Bar label="平均分數" value={e.avgScore} total={100} color={color} />
                    <Bar label="作業完成率" value={e.completionRate} total={100} color={color} />
                    <Bar label="出席率" value={e.attendanceRate} total={100} color={color} />
                  </View>
                  <Pressable
                    onPress={() =>
                      safeNavigate(navigation, 'CourseGradebook', {
                        groupId: String(e.course.id),
                        groupName: e.course.name,
                      }, { fallbackMessage: '即將跳到課程成績簿' })
                    }
                    style={({ pressed }) => ({
                      paddingVertical: theme.space.sm,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.text,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Ionicons name="analytics" size={14} color={theme.colors.bg} />
                    <Text style={{ color: theme.colors.bg, fontSize: 13, fontWeight: '700' }}>
                      深入分析
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        <Text
          style={{
            marginTop: theme.space.md,
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            textAlign: 'center',
            lineHeight: theme.typography.caption.lineHeight + 4,
          }}
        >
          評鑑分數僅作參考。正式版會考量同領域基準與學生背景。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.round((value / total) * 100);
  return (
    <View style={{ marginBottom: theme.space.xs + 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontSize: 12, color: theme.colors.muted }}>{label}</Text>
        <Text style={{ fontSize: 12, color: theme.colors.text, fontWeight: '600' }}>{value}{total === 100 ? '%' : ''}</Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
      </View>
    </View>
  );
}
