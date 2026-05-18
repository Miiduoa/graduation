/* eslint-disable */
/**
 * 📊 學業深度分析 — Academic Insights Screen
 *
 * 整合 academicInsightsEngine 的所有分析結果：
 *   1. GPA 趨勢圖（含預測）
 *   2. 風險評估儀表
 *   3. 課程難度貝氏分析
 *   4. 學術檔案（強弱項）
 *   5. 學期歷史摘要
 *   6. 個人化學習建議
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Animated,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useThemeMode } from '../state/theme';
import {
  getFullAcademicInsights,
  type FullAcademicInsights,
  type GpaPrediction,
  type GpaTrend,
  type CourseDifficulty,
  type RiskAssessment,
  type RiskLevel,
  type RiskFactor,
  type StudyRecommendation,
  type SemesterSummary,
  type AcademicProfile,
} from '../services/academicInsightsEngine';
import { earnXP } from '../services/gamificationEngine';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Helpers ─────────────────────────────────────────────

const riskColor = (level: RiskLevel) => {
  switch (level) {
    case 'safe':
      return theme.colors.success;
    case 'watch':
      return theme.colors.warning;
    case 'warning':
      return '#FF9500';
    case 'critical':
      return theme.colors.danger;
  }
};

const riskLabel = (level: RiskLevel) => {
  switch (level) {
    case 'safe':
      return '低風險';
    case 'watch':
      return '中風險';
    case 'warning':
      return '高風險';
    case 'critical':
      return '警戒';
  }
};

const statusColor = (s: 'good' | 'warning' | 'danger') => {
  switch (s) {
    case 'good':
      return theme.colors.success;
    case 'warning':
      return theme.colors.warning;
    case 'danger':
      return theme.colors.danger;
  }
};

const recTypeColor = (t: string) => {
  switch (t) {
    case 'urgent':
      return theme.colors.danger;
    case 'priority':
      return '#FF9500';
    case 'strategy':
      return theme.colors.accent;
    case 'balance':
      return theme.colors.success;
    case 'opportunity':
      return theme.colors.social ?? theme.colors.accent;
    default:
      return theme.colors.accent;
  }
};

const recTypeLabel = (t: string) => {
  switch (t) {
    case 'urgent':
      return '緊急';
    case 'priority':
      return '優先';
    case 'strategy':
      return '策略';
    case 'balance':
      return '平衡';
    case 'opportunity':
      return '機會';
    default:
      return t;
  }
};

const perfIcon = (p: 'above' | 'at' | 'below') => {
  switch (p) {
    case 'above':
      return { name: 'arrow-up', color: theme.colors.success };
    case 'at':
      return { name: 'remove', color: theme.colors.textSecondary };
    case 'below':
      return { name: 'arrow-down', color: theme.colors.danger };
  }
};

// ─── Main Screen ─────────────────────────────────────────

export function AcademicInsightsScreen() {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<FullAcademicInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedSemester, setExpandedSemester] = useState<string | null>(null);
  const [diffSort, setDiffSort] = useState<'difficulty' | 'deviation'>('difficulty');
  const riskAnim = useRef(new Animated.Value(0)).current;
  const xpEarned = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await getFullAcademicInsights();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setData(result);
      if (result && !xpEarned.current) {
        xpEarned.current = true;
        earnXP('check_grades').catch(() => {});
      }
    } catch (e) {
      console.warn('[AcademicInsights] load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data?.riskAssessment) {
      Animated.spring(riskAnim, {
        toValue: data.riskAssessment.riskScore,
        useNativeDriver: false,
        tension: 40,
        friction: 8,
      }).start();
    }
  }, [data?.riskAssessment]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: theme.space.md }}>
          分析學業數據中...
        </Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: 'center',
          alignItems: 'center',
          padding: theme.space.xl,
        }}
      >
        <Ionicons name="school-outline" size={64} color={theme.colors.textSecondary} />
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 18,
            fontWeight: '700',
            marginTop: theme.space.lg,
            textAlign: 'center',
          }}
        >
          尚無成績資料
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 14,
            marginTop: theme.space.sm,
            textAlign: 'center',
          }}
        >
          登入 E 校園並同步成績後即可查看學業分析
        </Text>
      </View>
    );
  }

  const {
    gpaPrediction,
    courseDifficulty,
    riskAssessment,
    recommendations,
    semesterSummaries,
    academicProfile,
  } = data;

  const sortedCourses = [...courseDifficulty].sort((a, b) =>
    diffSort === 'difficulty'
      ? b.difficultyRating - a.difficultyRating
      : Math.abs(b.deviation) - Math.abs(a.deviation),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 32,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
          <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}>
            學業分析
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 4 }}>
            AI 深度分析你的學習表現
          </Text>
        </View>

        <GpaTrendChart prediction={gpaPrediction} />
        <RiskGauge assessment={riskAssessment} animValue={riskAnim} />
        <ProfileCard profile={academicProfile} />

        {/* Course Difficulty */}
        <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.space.md,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>
              課程難度分析
            </Text>
            <Pressable
              onPress={() => setDiffSort(diffSort === 'difficulty' ? 'deviation' : 'difficulty')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="swap-vertical" size={16} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                {diffSort === 'difficulty' ? '按難度' : '按偏差'}
              </Text>
            </Pressable>
          </View>
          {sortedCourses.slice(0, 8).map((c, i) => (
            <CourseDifficultyCard key={i} course={c} />
          ))}
        </View>

        {/* Semester History */}
        <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 18,
              fontWeight: '700',
              marginBottom: theme.space.md,
            }}
          >
            學期歷史
          </Text>
          {semesterSummaries.map((s) => (
            <SemesterCard
              key={s.semester}
              summary={s}
              expanded={expandedSemester === s.semester}
              onToggle={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setExpandedSemester(expandedSemester === s.semester ? null : s.semester);
              }}
            />
          ))}
        </View>

        {/* Recommendations */}
        <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 18,
              fontWeight: '700',
              marginBottom: theme.space.md,
            }}
          >
            學習建議
          </Text>
          {recommendations.map((r, i) => (
            <RecommendationCard key={i} rec={r} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── GPA Trend Chart ────────────────────────────────────

function GpaTrendChart({ prediction }: { prediction: GpaPrediction }) {
  const { trends, predictedNext, confidence, direction, analysis } = prediction;
  const chartW = SCREEN_W - theme.space.lg * 2 - 32;
  const chartH = 160;
  const maxGpa = Math.max(...trends.map((t) => t.gpa), predictedNext, 4.3);
  const minGpa = Math.min(...trends.map((t) => t.gpa), predictedNext) * 0.9;
  const range = maxGpa - minGpa || 1;

  const getY = (gpa: number) => chartH - ((gpa - minGpa) / range) * chartH;
  const stepX = trends.length > 1 ? chartW / (trends.length - 1) : chartW / 2;

  const dirIcon =
    direction === 'improving'
      ? 'trending-up'
      : direction === 'declining'
        ? 'trending-down'
        : 'remove';
  const dirColor =
    direction === 'improving'
      ? theme.colors.success
      : direction === 'declining'
        ? theme.colors.danger
        : theme.colors.warning;
  const dirLabel =
    direction === 'improving' ? '上升趨勢' : direction === 'declining' ? '下降趨勢' : '持平';

  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.space.md,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>GPA 趨勢</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={dirIcon as any} size={18} color={dirColor} />
          <Text style={{ color: dirColor, fontSize: 13, fontWeight: '600' }}>{dirLabel}</Text>
          <View
            style={{
              backgroundColor: theme.colors.accentSoft,
              borderRadius: theme.radius.sm,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: '600' }}>
              信心 {Math.round(confidence * 100)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Chart Area */}
      <View style={{ height: chartH, marginBottom: theme.space.sm }}>
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
          <View
            key={frac}
            style={{
              position: 'absolute',
              top: chartH * frac,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: theme.colors.border,
              opacity: 0.3,
            }}
          />
        ))}

        {trends.map((t, i) => {
          if (i === 0) return null;
          const prev = trends[i - 1];
          const x1 = (i - 1) * stepX;
          const y1 = getY(prev.gpa);
          const x2 = i * stepX;
          const y2 = getY(t.gpa);
          const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
          const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
          const isPredicted = t.predicted;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: x1,
                top: y1,
                width: length,
                height: 2.5,
                backgroundColor: isPredicted ? theme.colors.accent : theme.colors.success,
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: 'left center',
                opacity: isPredicted ? 0.6 : 1,
              }}
            />
          );
        })}

        {trends.map((t, i) => (
          <View key={i} style={{ position: 'absolute', left: i * stepX - 6, top: getY(t.gpa) - 6 }}>
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: t.predicted ? theme.colors.accent : theme.colors.success,
                borderWidth: 2,
                borderColor: theme.colors.surface,
                opacity: t.predicted ? 0.7 : 1,
              }}
            />
            <Text
              style={{
                position: 'absolute',
                top: -16,
                left: -8,
                width: 28,
                textAlign: 'center',
                color: t.predicted ? theme.colors.accent : theme.colors.text,
                fontSize: 9,
                fontWeight: '600',
              }}
            >
              {t.gpa.toFixed(1)}
            </Text>
          </View>
        ))}
      </View>

      {/* X-axis */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {trends.map((t, i) => (
          <Text
            key={i}
            style={{
              color: t.predicted ? theme.colors.accent : theme.colors.textSecondary,
              fontSize: 9,
              fontWeight: t.predicted ? '600' : '400',
            }}
          >
            {t.semester}
            {t.predicted ? '(預)' : ''}
          </Text>
        ))}
      </View>

      {/* Predicted */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginTop: theme.space.md,
          backgroundColor: theme.colors.accentSoft,
          borderRadius: theme.radius.md,
          padding: theme.space.sm,
        }}
      >
        <Ionicons name="analytics" size={18} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
          預測下學期 GPA:{' '}
          <Text style={{ fontWeight: '700', color: theme.colors.accent }}>
            {predictedNext.toFixed(2)}
          </Text>
        </Text>
      </View>

      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 12,
          marginTop: theme.space.sm,
          lineHeight: 18,
        }}
      >
        {analysis}
      </Text>
    </View>
  );
}

// ─── Risk Gauge ─────────────────────────────────────────

function RiskGauge({
  assessment,
  animValue,
}: {
  assessment: RiskAssessment;
  animValue: Animated.Value;
}) {
  const { overallRisk, riskScore, factors, suggestions } = assessment;
  const color = riskColor(overallRisk);
  const gaugeSize = 120;

  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 18,
          fontWeight: '700',
          marginBottom: theme.space.md,
        }}
      >
        學業風險評估
      </Text>

      <View style={{ alignItems: 'center', marginBottom: theme.space.lg }}>
        <View
          style={{
            width: gaugeSize,
            height: gaugeSize,
            borderRadius: gaugeSize / 2,
            borderWidth: 8,
            borderColor: theme.colors.border,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Animated.View
            style={{
              position: 'absolute',
              width: gaugeSize,
              height: gaugeSize,
              borderRadius: gaugeSize / 2,
              borderWidth: 8,
              borderColor: color,
              borderTopColor: 'transparent',
              borderRightColor: 'transparent',
              transform: [
                {
                  rotate: animValue.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0deg', '360deg'],
                  }),
                },
              ],
            }}
          />
          <Text style={{ color, fontSize: 32, fontWeight: '700' }}>{riskScore}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>/100</Text>
        </View>
        <View
          style={{
            backgroundColor: color + '20',
            borderRadius: theme.radius.sm,
            paddingHorizontal: 12,
            paddingVertical: 4,
            marginTop: theme.space.sm,
          }}
        >
          <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{riskLabel(overallRisk)}</Text>
        </View>
      </View>

      <Text
        style={{
          color: theme.colors.text,
          fontSize: 15,
          fontWeight: '600',
          marginBottom: theme.space.sm,
        }}
      >
        風險因子
      </Text>
      {factors.map((f, i) => (
        <View key={i} style={{ marginBottom: theme.space.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
              {f.name}
            </Text>
            <Text style={{ color: statusColor(f.status), fontSize: 12, fontWeight: '600' }}>
              {f.score.toFixed(0)} · {(f.weight * 100).toFixed(0)}%
            </Text>
          </View>
          <View style={{ height: 6, backgroundColor: theme.colors.border, borderRadius: 3 }}>
            <View
              style={{
                height: 6,
                width: `${Math.min(f.score, 100)}%` as any,
                backgroundColor: statusColor(f.status),
                borderRadius: 3,
              }}
            />
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }}>
            {f.detail}
          </Text>
        </View>
      ))}

      {suggestions.length > 0 && (
        <View style={{ marginTop: theme.space.sm }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 15,
              fontWeight: '600',
              marginBottom: theme.space.sm,
            }}
          >
            改善建議
          </Text>
          {suggestions.map((s, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}
            >
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={theme.colors.success}
                style={{ marginTop: 1 }}
              />
              <Text
                style={{ color: theme.colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 19 }}
              >
                {s}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Profile Card ───────────────────────────────────────

function ProfileCard({ profile }: { profile: AcademicProfile }) {
  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 18,
          fontWeight: '700',
          marginBottom: theme.space.md,
        }}
      >
        學術檔案
      </Text>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-around',
          marginBottom: theme.space.lg,
        }}
      >
        {[
          { label: '平均分數', value: profile.averageScore.toFixed(1), icon: 'analytics-outline' },
          { label: '總學分', value: `${profile.totalCreditsEarned}`, icon: 'ribbon-outline' },
          { label: '學期數', value: `${profile.semesterCount}`, icon: 'calendar-outline' },
        ].map((s) => (
          <View key={s.label} style={{ alignItems: 'center' }}>
            <Ionicons name={s.icon as any} size={22} color={theme.colors.accent} />
            <Text
              style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700', marginTop: 4 }}
            >
              {s.value}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{s.label}</Text>
          </View>
        ))}
      </View>

      <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>
        擅長領域
      </Text>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: theme.space.md }}
      >
        {profile.strongCategories.length > 0 ? (
          profile.strongCategories.map((c) => (
            <View
              key={c}
              style={{
                backgroundColor: theme.colors.successSoft ?? theme.colors.success + '20',
                borderRadius: theme.radius.sm,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '600' }}>
                {c}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>尚無足夠數據</Text>
        )}
      </View>

      <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>
        需加強領域
      </Text>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: theme.space.md }}
      >
        {profile.weakCategories.length > 0 ? (
          profile.weakCategories.map((c) => (
            <View
              key={c}
              style={{
                backgroundColor: theme.colors.dangerSoft ?? theme.colors.danger + '20',
                borderRadius: theme.radius.sm,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: '600' }}>
                {c}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>目前表現均衡</Text>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: theme.colors.accentSoft,
          borderRadius: theme.radius.md,
          padding: theme.space.sm,
        }}
      >
        <Ionicons name="speedometer-outline" size={18} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.text, fontSize: 13 }}>
          偏好難度:{' '}
          <Text style={{ fontWeight: '700', color: theme.colors.accent }}>
            {profile.preferredDifficulty}
          </Text>
        </Text>
      </View>
    </View>
  );
}

// ─── Course Difficulty Card ─────────────────────────────

function CourseDifficultyCard({ course }: { course: CourseDifficulty }) {
  const perf = perfIcon(course.performance);
  const stars = Math.round(course.difficultyRating);

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.space.md,
        marginBottom: theme.space.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <View style={{ flex: 1, marginRight: theme.space.sm }}>
          <Text
            style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}
            numberOfLines={1}
          >
            {course.courseName}
          </Text>
          <View
            style={{
              backgroundColor: theme.colors.accentSoft,
              borderRadius: 4,
              paddingHorizontal: 6,
              paddingVertical: 1,
              alignSelf: 'flex-start',
              marginTop: 3,
            }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 10 }}>{course.category}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={perf.name as any} size={16} color={perf.color} />
          <Text style={{ color: perf.color, fontSize: 13, fontWeight: '700' }}>
            {course.deviation > 0 ? '+' : ''}
            {course.deviation.toFixed(1)}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            實際 <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{course.score}</Text>
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            預期{' '}
            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
              {course.expectedScore.toFixed(1)}
            </Text>
          </Text>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Ionicons
              key={s}
              name={s <= stars ? 'star' : 'star-outline'}
              size={12}
              color={s <= stars ? '#FBBF24' : theme.colors.border}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Semester Card ──────────────────────────────────────

function SemesterCard({
  summary,
  expanded,
  onToggle,
}: {
  summary: SemesterSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gpaColor =
    summary.gpa >= 3.7
      ? theme.colors.success
      : summary.gpa >= 3.0
        ? theme.colors.accent
        : summary.gpa >= 2.0
          ? theme.colors.warning
          : theme.colors.danger;

  return (
    <Pressable
      onPress={onToggle}
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.space.md,
        marginBottom: theme.space.sm,
        borderWidth: 1,
        borderColor: expanded ? theme.colors.accent : theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="calendar" size={18} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
            {summary.semester}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              backgroundColor: gpaColor + '20',
              borderRadius: theme.radius.sm,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: gpaColor, fontSize: 14, fontWeight: '700' }}>
              GPA {summary.gpa.toFixed(2)}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.colors.textSecondary}
          />
        </View>
      </View>

      {expanded && (
        <View style={{ marginTop: theme.space.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
              平均:{' '}
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                {summary.avgScore.toFixed(1)}
              </Text>
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
              課程:{' '}
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                {summary.courseCount}
              </Text>
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
              學分:{' '}
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>
                {summary.totalCredits}
              </Text>
            </Text>
            {summary.rankPercentile != null && (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
                前{' '}
                <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>
                  {summary.rankPercentile}%
                </Text>
              </Text>
            )}
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              backgroundColor: theme.colors.bg,
              borderRadius: theme.radius.sm,
              padding: theme.space.sm,
              marginTop: 4,
            }}
          >
            <View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>最佳</Text>
              <Text style={{ color: theme.colors.success, fontSize: 13, fontWeight: '600' }}>
                {summary.bestCourse.name} ({summary.bestCourse.score})
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>最弱</Text>
              <Text style={{ color: theme.colors.danger, fontSize: 13, fontWeight: '600' }}>
                {summary.worstCourse.name} ({summary.worstCourse.score})
              </Text>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ─── Recommendation Card ────────────────────────────────

function RecommendationCard({ rec }: { rec: StudyRecommendation }) {
  const color = recTypeColor(rec.type);
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.space.md,
        marginBottom: theme.space.sm,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 4,
        borderLeftColor: color,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Ionicons name={rec.icon as any} size={20} color={color} />
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 }}>
          {rec.title}
        </Text>
        <View
          style={{
            backgroundColor: color + '20',
            borderRadius: theme.radius.sm,
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color, fontSize: 10, fontWeight: '600' }}>{recTypeLabel(rec.type)}</Text>
        </View>
      </View>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }}>
        {rec.description}
      </Text>
      {rec.relatedCourse && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
          <Ionicons name="book-outline" size={12} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 12 }}>{rec.relatedCourse}</Text>
        </View>
      )}
    </View>
  );
}
