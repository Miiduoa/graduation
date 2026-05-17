/**
 * Student Risk Screen — 系所主任的學生風險清單
 *
 * 用 studentRiskEngine 對示範學生群計算風險分，分四檔顯示。
 * 每個學生卡片展開可看：因子拆解 + 建議動作。
 * 「發提醒」按鈕 emit bulk_reminder_sent → 該學生 inbox 進件。
 */
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';
import {
  rankStudentsByRisk,
  TIER_LABEL,
  type StudentRiskInput,
  type StudentRiskResult,
  type RiskTier,
} from '../services/studentRiskEngine';
import { emitBulkReminder } from '../services/roleEventBus';
import { DEMO_COURSES } from '../data/demoCoursesMock';

/**
 * Demo students — 在 demo 資料圍繞下生成 8 位學生的 risk 輸入。
 * 真實版會從 Firestore 抓 enrollments + attendances + grades + interaction_history。
 */
function buildDemoStudentRiskInputs(): StudentRiskInput[] {
  return [
    { uid: 'demo_student_kuchih', name: '顧晉瑋', attendanceRate: 0.88, missingHomeworkRate: 0.1, averageScore: 72, aiAcceptRate: 0.65, enrolledCourseCount: 5 },
    { uid: 'student_aming', name: '王阿明', attendanceRate: 0.3, missingHomeworkRate: 0.7, averageScore: 35, aiAcceptRate: 0.1, enrolledCourseCount: 5 },
    { uid: 'student_xiaohua', name: '陳小華', attendanceRate: 0.5, missingHomeworkRate: 0.4, averageScore: 50, aiAcceptRate: 0.3, enrolledCourseCount: 5 },
    { uid: 'student_xiaomei', name: '李小美', attendanceRate: 0.95, missingHomeworkRate: 0.0, averageScore: 92, aiAcceptRate: 0.85, enrolledCourseCount: 5 },
    { uid: 'student_ajie', name: '張阿傑', attendanceRate: 0.7, missingHomeworkRate: 0.2, averageScore: 65, aiAcceptRate: 0.4, enrolledCourseCount: 5 },
    { uid: 'student_yijun', name: '林怡君', attendanceRate: 0.4, missingHomeworkRate: 0.5, averageScore: 45, aiAcceptRate: 0.2, enrolledCourseCount: 5 },
    { uid: 'student_jialing', name: '黃佳玲', attendanceRate: 0.85, missingHomeworkRate: 0.15, averageScore: 78, aiAcceptRate: 0.7, enrolledCourseCount: 5 },
    { uid: 'student_guanyu', name: '吳冠宇', attendanceRate: 0.6, missingHomeworkRate: 0.3, averageScore: 58, aiAcceptRate: 0.4, enrolledCourseCount: 5 },
  ];
}

const TIER_COLOR: Record<RiskTier, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
};

export default function StudentRiskScreen() {
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const [filter, setFilter] = useState<RiskTier | 'all'>('all');
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  const ranked: StudentRiskResult[] = useMemo(() => rankStudentsByRisk(buildDemoStudentRiskInputs()), []);
  const filtered = useMemo(
    () => (filter === 'all' ? ranked : ranked.filter((r) => r.tier === filter)),
    [ranked, filter],
  );

  const counts = useMemo(() => {
    const c: Record<RiskTier, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of ranked) c[r.tier] += 1;
    return c;
  }, [ranked]);

  const sendReminder = async (r: StudentRiskResult) => {
    try {
      await emitBulkReminder({
        actorUid: auth.user?.uid ?? 'demo_admin_huang',
        actorName: auth.profile?.displayName ?? '系所',
        targetUids: [r.uid],
        courseId: DEMO_COURSES[0]?.id ?? 'general',
        courseName: '系所關懷',
        payload: {
          homeworkTitle: `來自系上的關懷訊息給 ${r.name}`,
          count: 1,
        },
      });
      Alert.alert('關懷訊息已送出', `已通知 ${r.name}。\n（會出現在他的 inbox）`);
    } catch (e) {
      Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    }
  };

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
          eyebrow="🏛 系所 · 學生風險清單"
          title={`${counts.critical + counts.high} 位需要關注`}
          summary="從出席、缺繳、成績、AI 互動四維算出風險分；點任一學生看因子拆解 + 建議動作。"
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="🔴 緊急" value={counts.critical} tone={counts.critical > 0 ? 'danger' : undefined} />
          <CockpitMetricChip label="🟠 高風險" value={counts.high} tone={counts.high > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="🟡 中等" value={counts.medium} />
          <CockpitMetricChip label="🟢 健康" value={counts.low} tone="success" />
        </CockpitMetricRow>

        {/* 篩選 */}
        <View style={{ flexDirection: 'row', gap: theme.space.xs, marginBottom: theme.space.md, flexWrap: 'wrap' }}>
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map((t) => {
            const active = t === filter;
            const label = t === 'all' ? '全部' : TIER_LABEL[t];
            return (
              <Pressable
                key={t}
                onPress={() => setFilter(t)}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.space.sm + 2,
                  paddingVertical: theme.space.xs + 2,
                  borderRadius: theme.radius.full,
                  backgroundColor: active ? theme.colors.text : theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? theme.colors.text : theme.colors.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: active ? theme.colors.bg : theme.colors.text, fontSize: 12, fontWeight: '600' }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <Text style={{ color: theme.colors.muted, fontSize: 13, padding: theme.space.lg, textAlign: 'center' }}>
            目前沒有這個風險檔的學生。
          </Text>
        ) : (
          filtered.map((r) => {
            const open = expandedUid === r.uid;
            const color = TIER_COLOR[r.tier];
            return (
              <View
                key={r.uid}
                style={{
                  marginBottom: theme.space.sm,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: color,
                  overflow: 'hidden',
                }}
              >
                <Pressable
                  onPress={() => setExpandedUid(open ? null : r.uid)}
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
                      {r.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                      {TIER_LABEL[r.tier]} · 風險分 {r.score}
                    </Text>
                  </View>
                  <View
                    style={{
                      paddingHorizontal: theme.space.sm + 2,
                      paddingVertical: theme.space.xs + 2,
                      borderRadius: theme.radius.full,
                      backgroundColor: color + '20',
                    }}
                  >
                    <Text style={{ color, fontSize: 16, fontWeight: '800' }}>{r.score}</Text>
                  </View>
                </Pressable>

                {open && (
                  <View style={{ paddingHorizontal: theme.space.md, paddingBottom: theme.space.md }}>
                    {/* 因子拆解 */}
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: theme.space.xs }}>
                      風險來源
                    </Text>
                    {r.contributors.map((c, i) => (
                      <View
                        key={i}
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <Text style={{ fontSize: 13, color: theme.colors.text, flex: 1 }}>
                          {c.factor}：{c.note}
                        </Text>
                        <Text style={{ fontSize: 13, color: theme.colors.muted, fontWeight: '600' }}>
                          +{c.contribution} 分
                        </Text>
                      </View>
                    ))}

                    {/* 建議動作 */}
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: theme.space.sm, marginBottom: theme.space.xs }}>
                      AI 建議
                    </Text>
                    {r.suggestedActions.map((a, i) => (
                      <Text key={i} style={{ fontSize: 13, color: theme.colors.text, lineHeight: 18 }}>
                        • {a}
                      </Text>
                    ))}

                    {/* 動作 */}
                    {(r.tier === 'critical' || r.tier === 'high') && (
                      <Pressable
                        onPress={() => sendReminder(r)}
                        style={({ pressed }) => ({
                          marginTop: theme.space.sm,
                          paddingVertical: theme.space.sm,
                          borderRadius: theme.radius.md,
                          backgroundColor: color,
                          alignItems: 'center',
                          flexDirection: 'row',
                          justifyContent: 'center',
                          gap: 6,
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Ionicons name="heart" size={14} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                          發關懷訊息給 {r.name}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}

        <Text
          style={{
            marginTop: theme.space.md,
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            textAlign: 'center',
            lineHeight: theme.typography.caption.lineHeight + 4,
          }}
        >
          風險分純為內部參考，不取代與學生本人的對話。{'\n'}
          發出的關懷訊息會出現在該學生 inbox。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
