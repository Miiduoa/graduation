/* eslint-disable */
/**
 * 🧠 智慧儀表板 — Smart Dashboard Screen
 *
 * Campus One 的核心差異化頁面：
 * 整合所有引擎的個人化洞察，一目瞭然。
 *
 * 佈局：
 *   1. 頂部 — 個人化問候 + 今日摘要
 *   2. GPA 趨勢圖 — 互動折線圖 + 預測
 *   3. 學業風險儀表 — 圓形進度條
 *   4. 智慧建議卡片 — 可操作的建議
 *   5. 校園脈動迷你卡 — 即時人潮
 *   6. 連續打卡 + XP — 遊戲化動態
 *   7. 學伴配對快捷入口
 */
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Animated,
  Dimensions,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import type { NextBestAction, PulseAggregate, StudentRiskSnapshot } from '../data';
import { useDataSource } from '../hooks/useDataSource';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import {
  buildNavigationTarget,
  navigateToCourseHome,
  navigateToCourseScreen,
  navigateToTarget,
} from '../utils/courseNavigation';

// Engines
import {
  getFullAcademicInsights,
  type FullAcademicInsights,
  type GpaTrend,
  type StudyRecommendation,
  type RiskLevel,
} from '../services/academicInsightsEngine';
import {
  getCampusPulseSnapshot,
  type CampusPulseSnapshot,
  type PulseLocation,
  submitCrowdReport,
  type CrowdLevel,
} from '../services/campusPulseEngine';
import {
  getGamificationState,
  dailyCheckIn,
  earnXP,
  type GamificationState,
} from '../services/gamificationEngine';
import {
  getScheduleOptimization,
  type ScheduleOptimization,
} from '../services/courseRecommendationEngine';
import { getAttendanceCourses, type AttendanceCourse } from '../services/smartAttendanceEngine';
import {
  tcFetchCourses,
  tcFetchAttendance,
  tcFetchProfile,
  hasTCSession,
  type TCCourse,
  type TCAttendance,
} from '../services/tronClassClient';
import { campusEventBus } from '../services/campusEventBus';
import { getDeadlines, type Deadline } from '../services/smartCalendarEngine';
import { getAnyCachedTCTodos, seedCachedTCCourses, seedCachedTCAttendance } from '../services/puDataCache';
import { BrainInsightCards } from '../components/BrainInsightCards';
import { HeaderAvatarButton } from '../components/HeaderAvatarButton';
import { aiOverlay } from '../app/useAIOverlay';
import type { BrainInsight } from '../services/aiBrain';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Sub-components ─────────────────────────────────────

/** 頂部問候 + 摘要 */
function GreetingHeader({
  displayName,
  gamification,
  streak,
}: {
  displayName: string;
  gamification: GamificationState | null;
  streak: number;
}) {
  const hour = new Date().getHours();
  let greeting: string;
  let greetingIcon: string;
  if (hour < 6) {
    greeting = '夜深了';
    greetingIcon = 'moon-outline';
  } else if (hour < 12) {
    greeting = '早安';
    greetingIcon = 'sunny-outline';
  } else if (hour < 18) {
    greeting = '午安';
    greetingIcon = 'partly-sunny-outline';
  } else {
    greeting = '晚安';
    greetingIcon = 'moon-outline';
  }

  return (
    <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.md,
          marginBottom: theme.space.sm,
        }}
      >
        <HeaderAvatarButton />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          <Ionicons name={greetingIcon as any} size={18} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{greeting}</Text>
        </View>
      </View>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 28,
          fontWeight: '800',
          marginTop: theme.space.xs,
          letterSpacing: -0.5,
        }}
      >
        {displayName}
      </Text>
      {gamification && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            marginTop: theme.space.sm,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: theme.colors.achievementSoft,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: theme.radius.full,
            }}
          >
            <Ionicons
              name={gamification.levelInfo.icon as any}
              size={14}
              color={gamification.levelInfo.color}
            />
            <Text style={{ color: gamification.levelInfo.color, fontSize: 12, fontWeight: '700' }}>
              Lv.{gamification.level} {gamification.levelInfo.title}
            </Text>
          </View>
          {streak > 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: theme.colors.streakSoft,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: theme.radius.full,
              }}
            >
              <Ionicons name="flame" size={14} color={theme.colors.streak} />
              <Text style={{ color: theme.colors.streak, fontSize: 12, fontWeight: '700' }}>
                {streak} 天
              </Text>
            </View>
          )}
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {gamification.totalXP.toLocaleString()} XP
          </Text>
        </View>
      )}
    </View>
  );
}

/** XP 進度條 */
function XPProgressBar({ gamification }: { gamification: GamificationState }) {
  const progress = gamification.xpProgress;
  const animatedWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(animatedWidth, {
      toValue: progress,
      friction: 8,
      tension: 40,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: theme.space.sm,
        }}
      >
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
          下一級：Lv.{gamification.level + 1}
        </Text>
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>
          還需 {gamification.xpToNextLevel} XP
        </Text>
      </View>
      <View
        style={{
          height: 8,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.full,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            height: '100%',
            borderRadius: theme.radius.full,
            overflow: 'hidden',
            width: animatedWidth.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          }}
        >
          <LinearGradient
            colors={[theme.colors.accent, '#7C3AED', '#A855F7'] as [string, string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </View>
  );
}

/** GPA 趨勢迷你圖 */
function GpaTrendChart({
  trends,
  prediction,
}: {
  trends: GpaTrend[];
  prediction: { current: number; predicted: number; trend: string; confidence: number };
}) {
  if (trends.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - theme.space.lg * 2 - theme.space.md * 2;
  const chartHeight = 120;
  const maxGpa = 4.0;
  const minGpa = Math.max(0, Math.min(...trends.map((t) => t.gpa)) - 0.5);
  const range = maxGpa - minGpa;

  const points = trends.map((t, i) => ({
    x: (i / Math.max(trends.length - 1, 1)) * chartWidth,
    y: chartHeight - ((t.gpa - minGpa) / range) * chartHeight,
    gpa: t.gpa,
    semester: t.semester,
  }));

  // SVG-like path using absolute positioning
  const trendColor =
    prediction.trend === 'improving'
      ? theme.colors.success
      : prediction.trend === 'declining'
        ? theme.colors.danger
        : theme.colors.accent;

  return (
    <LinearGradient
      colors={[`${trendColor}10`, theme.colors.surface] as [string, string]}
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        borderRadius: theme.radius.lg,
        padding: theme.space.md,
        borderWidth: 1,
        borderColor: `${trendColor}25`,
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
        <View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>GPA 趨勢</Text>
          <Text style={{ color: theme.colors.text, fontSize: 24, fontWeight: '800' }}>
            {prediction.current.toFixed(2)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor:
                prediction.trend === 'improving'
                  ? theme.colors.successSoft
                  : prediction.trend === 'declining'
                    ? theme.colors.dangerSoft
                    : theme.colors.infoSoft,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: theme.radius.full,
            }}
          >
            <Ionicons
              name={
                prediction.trend === 'improving'
                  ? 'trending-up'
                  : prediction.trend === 'declining'
                    ? 'trending-down'
                    : ('remove-outline' as any)
              }
              size={14}
              color={trendColor}
            />
            <Text style={{ color: trendColor, fontSize: 11, fontWeight: '700' }}>
              {prediction.trend === 'improving'
                ? '上升中'
                : prediction.trend === 'declining'
                  ? '下降中'
                  : '穩定'}
            </Text>
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            預測 {prediction.predicted.toFixed(2)} (信心 {Math.round(prediction.confidence * 100)}%)
          </Text>
        </View>
      </View>

      {/* Simple chart visualization */}
      <View style={{ height: chartHeight, position: 'relative' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <View
            key={pct}
            style={{
              position: 'absolute',
              top: pct * chartHeight,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: theme.colors.border,
              opacity: 0.5,
            }}
          />
        ))}

        {/* Data points */}
        {points.map((point, i) => (
          <View key={i} style={{ position: 'absolute', left: point.x - 6, top: point.y - 6 }}>
            <View
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: i === points.length - 1 ? trendColor : theme.colors.accent,
                borderWidth: 2,
                borderColor: theme.colors.surface,
                ...theme.shadows.sm,
              }}
            />
            {/* Label for last point */}
            {i === points.length - 1 && (
              <Text
                style={{
                  position: 'absolute',
                  top: -18,
                  left: -10,
                  color: trendColor,
                  fontSize: 11,
                  fontWeight: '700',
                }}
              >
                {point.gpa.toFixed(1)}
              </Text>
            )}
          </View>
        ))}

        {/* Connecting lines (simplified) */}
        {points.length > 1 &&
          points.map((point, i) => {
            if (i === 0) return null;
            const prev = points[i - 1];
            const dx = point.x - prev.x;
            const dy = point.y - prev.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            return (
              <View
                key={`line_${i}`}
                style={{
                  position: 'absolute',
                  left: prev.x,
                  top: prev.y,
                  width: length,
                  height: 2,
                  backgroundColor: theme.colors.accent,
                  opacity: 0.6,
                  transform: [{ rotate: `${angle}deg` }],
                  transformOrigin: 'left center',
                }}
              />
            );
          })}
      </View>

      {/* Semester labels */}
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs }}
      >
        {trends.length <= 6 ? (
          trends.map((t) => (
            <Text key={t.semester} style={{ color: theme.colors.muted, fontSize: 10 }}>
              {t.semester}
            </Text>
          ))
        ) : (
          <>
            <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{trends[0]?.semester}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
              {trends[trends.length - 1]?.semester}
            </Text>
          </>
        )}
      </View>
    </LinearGradient>
  );
}

/** 學業風險卡 */
function RiskAssessmentCard({
  level,
  score,
  factors,
}: {
  level: RiskLevel;
  score: number;
  factors: { category: string; description: string; severity: number; icon: string }[];
}) {
  const config: Record<RiskLevel, { color: string; bg: string; label: string; icon: string }> = {
    safe: {
      color: theme.colors.success,
      bg: theme.colors.successSoft,
      label: '狀態良好',
      icon: 'shield-checkmark',
    },
    watch: {
      color: theme.colors.calm,
      bg: theme.colors.calmSoft,
      label: '注意觀察',
      icon: 'eye-outline',
    },
    warning: {
      color: theme.colors.warning,
      bg: theme.colors.warningSoft,
      label: '需要改善',
      icon: 'warning-outline',
    },
    critical: {
      color: theme.colors.danger,
      bg: theme.colors.dangerSoft,
      label: '嚴重警告',
      icon: 'alert-circle',
    },
  };

  const c = config[level];

  return (
    <LinearGradient
      colors={[`${c.color}12`, theme.colors.surface] as [string, string]}
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        borderRadius: theme.radius.lg,
        padding: theme.space.md,
        borderWidth: 1,
        borderColor: `${c.color}25`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>學業健康度</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <View
              style={{
                backgroundColor: c.bg,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: theme.radius.full,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Ionicons name={c.icon as any} size={14} color={c.color} />
              <Text style={{ color: c.color, fontSize: 13, fontWeight: '700' }}>{c.label}</Text>
            </View>
          </View>
        </View>

        {/* Circular progress */}
        <View style={{ width: 56, height: 56, justifyContent: 'center', alignItems: 'center' }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              borderWidth: 4,
              borderColor: theme.colors.surface2,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                position: 'absolute',
                width: 56,
                height: 56,
                borderRadius: 28,
                borderWidth: 4,
                borderColor: c.color,
                borderTopColor: 'transparent',
                borderRightColor: score > 25 ? c.color : 'transparent',
                borderBottomColor: score > 50 ? c.color : 'transparent',
                borderLeftColor: score > 75 ? c.color : 'transparent',
                transform: [{ rotate: '-45deg' }],
              }}
            />
            <Text style={{ color: c.color, fontSize: 16, fontWeight: '800' }}>{100 - score}</Text>
          </View>
        </View>
      </View>

      {factors.length > 0 && (
        <View style={{ marginTop: theme.space.md }}>
          {factors.slice(0, 3).map((f, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: i > 0 ? 6 : 0,
              }}
            >
              <Ionicons name={f.icon as any} size={14} color={theme.colors.textSecondary} />
              <Text
                style={{ color: theme.colors.textSecondary, fontSize: 12, flex: 1 }}
                numberOfLines={1}
              >
                {f.description}
              </Text>
              <View
                style={{
                  width: 40,
                  height: 4,
                  backgroundColor: theme.colors.surface2,
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${f.severity * 100}%`,
                    height: '100%',
                    backgroundColor:
                      f.severity > 0.6
                        ? theme.colors.danger
                        : f.severity > 0.3
                          ? theme.colors.warning
                          : theme.colors.success,
                    borderRadius: 2,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

/** 智慧建議卡片 */
function RecommendationCards({
  recommendations,
  onPress,
}: {
  recommendations: StudyRecommendation[];
  onPress?: (rec: StudyRecommendation) => void;
}) {
  if (recommendations.length === 0) return null;

  const typeConfig: Record<string, { color: string; bg: string }> = {
    warning: { color: theme.colors.danger, bg: theme.colors.dangerSoft },
    priority: { color: theme.colors.warning, bg: theme.colors.warningSoft },
    strategy: { color: theme.colors.accent, bg: theme.colors.accentSoft },
    balance: { color: theme.colors.calm, bg: theme.colors.calmSoft },
    opportunity: { color: theme.colors.success, bg: theme.colors.successSoft },
  };

  return (
    <View style={{ marginBottom: theme.space.lg }}>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 16,
          fontWeight: '700',
          paddingHorizontal: theme.space.lg,
          marginBottom: theme.space.md,
        }}
      >
        智慧建議
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.space.lg, gap: theme.space.sm }}
      >
        {recommendations.slice(0, 5).map((rec, i) => {
          const config = typeConfig[rec.type] ?? typeConfig.strategy;
          return (
            <Pressable
              key={i}
              onPress={() => onPress?.(rec)}
              style={({ pressed }) => ({
                width: 220,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                padding: theme.space.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: config.bg,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons name={rec.icon as any} size={16} color={config.color} />
                </View>
                <Text
                  style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 }}
                  numberOfLines={1}
                >
                  {rec.title}
                </Text>
              </View>
              <Text
                style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}
                numberOfLines={3}
              >
                {rec.description}
              </Text>
              <Text style={{ color: config.color, fontSize: 11, fontWeight: '600', marginTop: 8 }}>
                {rec.actionable}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** 校園脈動迷你卡 */
function CampusPulseMini({
  pulse,
  onReportPress,
}: {
  pulse: CampusPulseSnapshot | null;
  onReportPress?: () => void;
}) {
  if (!pulse) return null;

  const levelEmoji = ['', '🟢', '🟡', '🟠', '🔴', '🔴'];
  const levelText = ['', '空閒', '一般', '人多', '擁擠', '爆滿'];

  // Show top 4 locations
  const topLocations = pulse.locations
    .sort((a, b) => b.reportCount24h - a.reportCount24h || b.currentLevel - a.currentLevel)
    .slice(0, 4);

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
            校園脈動
          </Text>
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.success }}
          />
          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>即時</Text>
        </View>
        <Pressable
          onPress={onReportPress}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: theme.colors.accentSoft,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: theme.radius.full,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="add-circle-outline" size={14} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600' }}>回報</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
        {topLocations.map((loc) => (
          <View
            key={loc.id}
            style={{
              width: (SCREEN_WIDTH - theme.space.lg * 2 - theme.space.sm) / 2 - 1,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              padding: theme.space.sm,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Ionicons name={loc.icon as any} size={14} color={theme.colors.textSecondary} />
              <Text
                style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600', flex: 1 }}
                numberOfLines={1}
              >
                {loc.name}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14 }}>{levelEmoji[loc.currentLevel]}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
                {levelText[loc.currentLevel]}
              </Text>
              {loc.trend !== 'stable' && (
                <Ionicons
                  name={loc.trend === 'rising' ? 'arrow-up' : ('arrow-down' as any)}
                  size={10}
                  color={loc.trend === 'rising' ? theme.colors.danger : theme.colors.success}
                />
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Insights */}
      {pulse.insights.length > 0 && (
        <View
          style={{
            marginTop: theme.space.sm,
            backgroundColor: theme.colors.infoSoft,
            borderRadius: theme.radius.md,
            padding: theme.space.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Ionicons name={pulse.insights[0].icon as any} size={16} color={theme.colors.info} />
          <Text style={{ color: theme.colors.info, fontSize: 12, flex: 1 }}>
            {pulse.insights[0].description}
          </Text>
        </View>
      )}
    </View>
  );
}

/** 畢業進度條 */
function GraduationProgressCard({ optimization }: { optimization: ScheduleOptimization | null }) {
  if (!optimization) return null;

  const gaps = optimization.graduationGaps;
  const totalRequired = gaps.reduce((s, g) => s + g.required, 0);
  const totalEarned = gaps.reduce((s, g) => s + g.earned, 0);
  const overallProgress = totalRequired > 0 ? totalEarned / totalRequired : 0;

  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.space.sm,
        }}
      >
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>畢業學分進度</Text>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
          {totalEarned}/{totalRequired} 學分
        </Text>
      </View>
      <View
        style={{
          height: 10,
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.radius.full,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.min(overallProgress * 100, 100)}%`,
            height: '100%',
            borderRadius: theme.radius.full,
            backgroundColor:
              overallProgress >= 0.9
                ? theme.colors.success
                : overallProgress >= 0.6
                  ? theme.colors.accent
                  : theme.colors.warning,
          }}
        />
      </View>
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
        {Math.round(overallProgress * 100)}% 完成 · {optimization.nextSemesterPlan.strategy}
      </Text>

      {/* Category breakdown */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: theme.space.sm }}>
        {gaps
          .filter((g) => g.remaining > 0)
          .slice(0, 4)
          .map((gap) => {
            const urgencyColor =
              gap.urgency === 'critical'
                ? theme.colors.danger
                : gap.urgency === 'high'
                  ? theme.colors.warning
                  : gap.urgency === 'medium'
                    ? theme.colors.calm
                    : theme.colors.success;
            return (
              <View
                key={gap.category}
                style={{
                  backgroundColor: theme.colors.surface2,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: theme.radius.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <View
                  style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: urgencyColor }}
                />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 10 }}>
                  {gap.category} 還差 {gap.remaining}
                </Text>
              </View>
            );
          })}
      </View>
    </View>
  );
}

/** 成就速覽 */
function AchievementPreview({
  gamification,
  onPress,
}: {
  gamification: GamificationState;
  onPress?: () => void;
}) {
  const recentUnlocked = gamification.achievements
    .filter((a) => a.unlockedAt)
    .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))
    .slice(0, 4);

  const rarityColor: Record<string, string> = {
    common: theme.colors.muted,
    rare: theme.colors.accent,
    epic: theme.colors.social,
    legendary: theme.colors.achievement,
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.space.sm,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>成就</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
          {gamification.unlockedCount}/{gamification.totalCount} 已解鎖
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.md }}>
        {recentUnlocked.map((ach) => (
          <View key={ach.id} style={{ alignItems: 'center', gap: 4 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.colors.surface2,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 2,
                borderColor: rarityColor[ach.rarity] ?? theme.colors.muted,
              }}
            >
              <Ionicons
                name={ach.icon as any}
                size={20}
                color={rarityColor[ach.rarity] ?? theme.colors.muted}
              />
            </View>
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: 9, textAlign: 'center' }}
              numberOfLines={1}
            >
              {ach.title}
            </Text>
          </View>
        ))}
        {recentUnlocked.length === 0 && (
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>完成任務解鎖成就！</Text>
        )}
      </View>
    </Pressable>
  );
}

/** 每週挑戰 */
function WeeklyChallenges({ challenges }: { challenges: GamificationState['weeklyChallenges'] }) {
  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      <Text
        style={{
          color: theme.colors.text,
          fontSize: 16,
          fontWeight: '700',
          marginBottom: theme.space.md,
        }}
      >
        本週挑戰
      </Text>
      {challenges.map((ch) => {
        const progress = ch.target > 0 ? ch.current / ch.target : 0;
        return (
          <View
            key={ch.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.md,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.md,
              padding: theme.space.sm,
              marginBottom: 6,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.colors.accentSoft,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons name={ch.icon as any} size={18} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                {ch.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <View
                  style={{
                    flex: 1,
                    height: 4,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(progress * 100, 100)}%`,
                      height: '100%',
                      backgroundColor: ch.completed ? theme.colors.success : theme.colors.accent,
                      borderRadius: 2,
                    }}
                  />
                </View>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                  {ch.current}/{ch.target}
                </Text>
              </View>
            </View>
            <Text style={{ color: theme.colors.achievement, fontSize: 11, fontWeight: '700' }}>
              +{ch.xpReward} XP
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function urgencyColor(urgency: NextBestAction['urgency']) {
  switch (urgency) {
    case 'critical':
      return theme.colors.danger;
    case 'high':
      return theme.colors.warning;
    case 'medium':
      return theme.colors.accent;
    case 'low':
    default:
      return theme.colors.calm;
  }
}

function AgentActionCenter(props: {
  actions: NextBestAction[];
  risk: StudentRiskSnapshot | null;
  onOpenAction: (action: NextBestAction) => void;
  onOpenAI: () => void;
}) {
  const primary = props.actions[0] ?? null;
  const secondary = props.actions.slice(1, 4);
  const color = primary ? urgencyColor(primary.urgency) : theme.colors.accent;

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: theme.space.md,
        }}
      >
        <View>
          <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800' }}>
            行動中樞
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            Today 只保留最該做的下一步
          </Text>
        </View>
        {props.risk ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: theme.radius.full,
              backgroundColor: `${urgencyColor(props.risk.level === 'critical' ? 'critical' : props.risk.level === 'warning' ? 'high' : 'medium')}18`,
            }}
          >
            <Text
              style={{
                color: urgencyColor(
                  props.risk.level === 'critical'
                    ? 'critical'
                    : props.risk.level === 'warning'
                      ? 'high'
                      : 'medium',
                ),
                fontSize: 11,
                fontWeight: '800',
              }}
            >
              風險 {props.risk.score}
            </Text>
          </View>
        ) : null}
      </View>

      {primary ? (
        <Pressable
          onPress={() => props.onOpenAction(primary)}
          style={({ pressed }) => ({
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: theme.space.md,
            borderWidth: 1,
            borderColor: `${color}55`,
            opacity: pressed ? 0.82 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md }}>
            <LinearGradient
              colors={[`${color}25`, `${color}0A`] as [string, string]}
              style={{
                width: 42,
                height: 42,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={primary.requiresConfirmation ? 'shield-checkmark-outline' : 'flash-outline'}
                size={22}
                color={color}
              />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}>
                {primary.title}
              </Text>
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 13,
                  lineHeight: 20,
                  marginTop: 4,
                }}
              >
                {primary.description}
              </Text>
              <Text style={{ color, fontSize: 12, fontWeight: '700', marginTop: 8 }}>
                {primary.reason}
              </Text>
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: theme.space.md,
            }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 12 }} numberOfLines={1}>
              {primary.nextStep}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={{ color, fontSize: 13, fontWeight: '800' }}>{primary.actionLabel}</Text>
              <Ionicons name="chevron-forward" size={14} color={color} />
            </View>
          </View>
        </Pressable>
      ) : (
        <Pressable
          onPress={props.onOpenAI}
          style={({ pressed }) => ({
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: theme.space.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}>
            今天沒有高壓待辦
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 13,
              lineHeight: 20,
              marginTop: 4,
            }}
          >
            可以讓 AI 依課程、校園脈動與畢業進度生成今日計畫。
          </Text>
        </Pressable>
      )}

      {secondary.length > 0 ? (
        <View style={{ marginTop: theme.space.sm, gap: 8 }}>
          {secondary.map((action) => (
            <Pressable
              key={action.id}
              onPress={() => props.onOpenAction(action)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: theme.space.sm,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: urgencyColor(action.urgency),
                }}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}
                  numberOfLines={1}
                >
                  {action.title}
                </Text>
                <Text
                  style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {action.nextStep}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={props.onOpenAI}
        style={({ pressed }) => ({
          marginTop: theme.space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
          padding: theme.space.sm,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          opacity: pressed ? 0.78 : 1,
        })}
      >
        <LinearGradient
          colors={[`${theme.colors.accent}18`, `${theme.colors.accent}08`] as [string, string]}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: theme.radius.md,
          }}
        />
        <LinearGradient
          colors={[`${theme.colors.accent}30`, `${theme.colors.accent}12`] as [string, string]}
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="sparkles-outline" size={14} color={theme.colors.accent} />
        </LinearGradient>
        <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: '800', flex: 1 }}>
          AI 可依授權資料拆作業、排讀書順序與建立提醒草稿
        </Text>
        <Ionicons name="arrow-forward" size={14} color={theme.colors.accent} />
      </Pressable>
    </View>
  );
}

function CloudPulseStrip(props: { aggregates: PulseAggregate[]; onReportPress: () => void }) {
  if (props.aggregates.length === 0) return null;

  const sorted = [...props.aggregates]
    .sort((a, b) => b.confidence - a.confidence || b.reportCount24h - a.reportCount24h)
    .slice(0, 3);

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: theme.space.sm,
        }}
      >
        <View>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}>
            校園脈動資料層
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            匿名匯總，不儲存個人軌跡
          </Text>
        </View>
        <Pressable
          onPress={props.onReportPress}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.accentSoft,
          }}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '800' }}>回報</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        {sorted.map((aggregate) => {
          const color =
            aggregate.currentLevel >= 4
              ? theme.colors.danger
              : aggregate.currentLevel === 3
                ? theme.colors.warning
                : theme.colors.success;
          return (
            <View
              key={aggregate.id}
              style={{
                flex: 1,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                padding: theme.space.sm,
              }}
            >
              <Text
                style={{ color: theme.colors.text, fontSize: 12, fontWeight: '800' }}
                numberOfLines={1}
              >
                {aggregate.locationName}
              </Text>
              <Text style={{ color, fontSize: 18, fontWeight: '900', marginTop: 6 }}>
                {aggregate.currentLevel}/5
              </Text>
              <Text
                style={{ color: theme.colors.muted, fontSize: 10, marginTop: 2 }}
                numberOfLines={1}
              >
                {aggregate.bestTimeToVisit ?? '持續收集中'} ·{' '}
                {Math.round(aggregate.confidence * 100)}%
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function formatRiskLabel(risk: StudentRiskSnapshot | null) {
  if (!risk) return '同步中';
  if (risk.level === 'critical') return '立即處理';
  if (risk.level === 'warning') return '需要注意';
  if (risk.level === 'watch') return '觀察中';
  return '穩定';
}

function averagePulseConfidence(aggregates: PulseAggregate[]) {
  if (aggregates.length === 0) return 0;
  return Math.round(
    (aggregates.reduce((sum, aggregate) => sum + aggregate.confidence, 0) / aggregates.length) *
      100,
  );
}

type AgentModeKey = 'route' | 'study' | 'admin';

const AGENT_MODES: Array<{
  key: AgentModeKey;
  label: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  prompt: string;
}> = [
  {
    key: 'route',
    label: '上課路線',
    title: '課前導航與校園狀態',
    icon: 'navigate-outline',
    color: theme.colors.info,
    prompt: '請依我的下一堂課、教室位置、校園人潮與待辦，產生現在到上課前的最佳路線與提醒。',
  },
  {
    key: 'study',
    label: '作業衝刺',
    title: '拆解作業與讀書節奏',
    icon: 'timer-outline',
    color: theme.colors.warning,
    prompt: '請依我的作業、測驗、成績趨勢與可用時間，把今天最重要的作業拆成可執行步驟。',
  },
  {
    key: 'admin',
    label: '行政處理',
    title: '請假、訊息與校務草稿',
    icon: 'document-lock-outline',
    color: theme.colors.social,
    prompt: '請依我的課程與校務情境，協助建立需要本人確認的行政或訊息草稿，不要直接送出。',
  },
];

function AgentModeDock(props: {
  selected: AgentModeKey;
  onSelect: (mode: AgentModeKey) => void;
  onStart: (mode: AgentModeKey) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: theme.space.lg, gap: 8, paddingBottom: 4 }}
      style={{ marginBottom: theme.space.md }}
    >
      {AGENT_MODES.map((mode) => {
        const active = mode.key === props.selected;
        return (
          <Pressable
            key={mode.key}
            onPress={() => {
              props.onSelect(mode.key);
              props.onStart(mode.key);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 20,
              backgroundColor: active ? `${mode.color}18` : theme.colors.surface,
              borderWidth: 1,
              borderColor: active ? `${mode.color}44` : theme.colors.border,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <Ionicons name={mode.icon} size={15} color={active ? mode.color : theme.colors.muted} />
            <Text
              style={{
                color: active ? mode.color : theme.colors.textSecondary,
                fontSize: 13,
                fontWeight: '700',
              }}
            >
              {mode.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function AgentOSHero(props: {
  displayName: string;
  gamification: GamificationState | null;
  actions: NextBestAction[];
  risk: StudentRiskSnapshot | null;
  aggregates: PulseAggregate[];
  onOpenAction: (action: NextBestAction) => void;
  onOpenAI: () => void;
  onOpenPulse: () => void;
}) {
  const primary = props.actions[0] ?? null;
  const heroColor = primary ? urgencyColor(primary.urgency) : theme.colors.accent;
  const hour = new Date().getHours();
  let greeting: string;
  let greetIcon: string;
  if (hour < 6) {
    greeting = '夜深了';
    greetIcon = 'moon-outline';
  } else if (hour < 12) {
    greeting = '早安';
    greetIcon = 'sunny-outline';
  } else if (hour < 18) {
    greeting = '午安';
    greetIcon = 'partly-sunny-outline';
  } else {
    greeting = '晚安';
    greetIcon = 'moon-outline';
  }

  return (
    <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.md }}>
      {/* Greeting */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Ionicons name={greetIcon as any} size={18} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{greeting}</Text>
      </View>
      <Text
        style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}
      >
        {props.displayName}
      </Text>

      {/* Level + Streak badges */}
      {props.gamification && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <LinearGradient
            colors={
              [
                `${props.gamification.levelInfo.color}20`,
                `${props.gamification.levelInfo.color}08`,
              ] as [string, string]
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 20,
            }}
          >
            <Ionicons
              name={props.gamification.levelInfo.icon as any}
              size={13}
              color={props.gamification.levelInfo.color}
            />
            <Text
              style={{ color: props.gamification.levelInfo.color, fontSize: 12, fontWeight: '700' }}
            >
              Lv.{props.gamification.level}
            </Text>
          </LinearGradient>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {props.gamification.totalXP.toLocaleString()} XP
          </Text>
        </View>
      )}

      {/* Main Action Card */}
      <Pressable
        onPress={() => (primary ? props.onOpenAction(primary) : props.onOpenAI())}
        style={({ pressed }) => ({
          marginTop: 20,
          borderRadius: 20,
          overflow: 'hidden',
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <LinearGradient
          colors={['#1A0A3E', '#0D1B3E'] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#2D1B69' }}
        >
          {/* Decorative circle */}
          <View
            style={{
              position: 'absolute',
              right: -20,
              top: -20,
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: `${heroColor}12`,
            }}
          />

          <Text
            style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', lineHeight: 28 }}
            numberOfLines={2}
          >
            {primary ? primary.title : '校園代理已就緒'}
          </Text>
          <Text
            style={{ color: '#A8B7CC', fontSize: 13, lineHeight: 20, marginTop: 6 }}
            numberOfLines={2}
          >
            {primary ? primary.reason : '依課程、地點與校園脈動生成今日計畫'}
          </Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <LinearGradient
              colors={[heroColor, `${heroColor}BB`] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
              }}
            >
              <Ionicons name="flash" size={16} color="#FFF" />
              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '800' }}>
                {primary?.actionLabel ?? '生成今日計畫'}
              </Text>
            </LinearGradient>
            <Pressable
              onPress={props.onOpenAI}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: '#0E1B2D',
                borderWidth: 1,
                borderColor: '#253A58',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#D9E8FF" />
            </Pressable>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function GraphLine(props: { x1: number; y1: number; x2: number; y2: number; color: string }) {
  const length = Math.hypot(props.x2 - props.x1, props.y2 - props.y1);
  const angle = Math.atan2(props.y2 - props.y1, props.x2 - props.x1) * (180 / Math.PI);
  return (
    <View
      style={{
        position: 'absolute',
        left: (props.x1 + props.x2) / 2 - length / 2,
        top: (props.y1 + props.y2) / 2,
        width: length,
        height: 1.5,
        borderRadius: 1,
        backgroundColor: props.color,
        transform: [{ rotateZ: `${angle}deg` }],
      }}
    />
  );
}

function TwinNode(props: {
  x: number;
  y: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  color: string;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: props.x,
        top: props.y,
        width: 100,
        padding: 10,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: `${props.color}33`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={props.icon} size={14} color={props.color} />
        <Text
          style={{ color: theme.colors.text, fontSize: 11, fontWeight: '900' }}
          numberOfLines={1}
        >
          {props.title}
        </Text>
      </View>
      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 5 }} numberOfLines={1}>
        {props.value}
      </Text>
    </View>
  );
}

function CampusTwinPanel(props: {
  actions: NextBestAction[];
  risk: StudentRiskSnapshot | null;
  aggregates: PulseAggregate[];
  onOpenPulse: () => void;
}) {
  const panelWidth = SCREEN_WIDTH - theme.space.lg * 2;
  const centerX = panelWidth / 2 - 50;
  const rightX = Math.max(panelWidth - 116, 196);
  const topPulse = [...props.aggregates].sort((a, b) => b.currentLevel - a.currentLevel)[0] ?? null;
  const courseRefs = props.actions
    .flatMap((action) => action.evidenceRefs)
    .filter((ref) => ref.type === 'course').length;
  const actionCount = props.actions.length;

  const isDarkTwin = theme.mode === 'dark';
  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <View>
          <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '900' }}>
            Campus Twin
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
            課程、地點、風險與動作即時關聯
          </Text>
        </View>
        <Pressable
          onPress={props.onOpenPulse}
          style={({ pressed }) => ({
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 12,
            overflow: 'hidden',
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <LinearGradient
            colors={[`${theme.colors.success}25`, `${theme.colors.success}10`] as [string, string]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12 }}
          />
          <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '900' }}>
            Live Pulse
          </Text>
        </Pressable>
      </View>

      <LinearGradient
        colors={
          isDarkTwin
            ? ([`${theme.colors.accent}12`, `${theme.colors.surface}`, theme.colors.surface] as [
                string,
                string,
                string,
              ])
            : ([theme.colors.surface, theme.colors.surface, theme.colors.surface] as [
                string,
                string,
                string,
              ])
        }
        style={{
          height: 268,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: isDarkTwin ? `${theme.colors.accent}30` : theme.colors.border,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: centerX + 31,
            top: 102,
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: `${theme.colors.accent}15`,
          }}
        />
        <GraphLine x1={72} y1={64} x2={centerX + 50} y2={122} color={`${theme.colors.accent}55`} />
        <GraphLine
          x1={rightX + 50}
          y1={66}
          x2={centerX + 50}
          y2={122}
          color={`${theme.colors.success}55`}
        />
        <GraphLine
          x1={78}
          y1={198}
          x2={centerX + 50}
          y2={122}
          color={`${theme.colors.warning}55`}
        />
        <GraphLine
          x1={rightX + 48}
          y1={202}
          x2={centerX + 50}
          y2={122}
          color={`${theme.colors.social}55`}
        />

        <TwinNode
          x={14}
          y={26}
          icon="school-outline"
          title="課程"
          value={`${courseRefs || actionCount} 個關聯`}
          color={theme.colors.info}
        />
        <TwinNode
          x={rightX}
          y={28}
          icon="location-outline"
          title="地點"
          value={topPulse?.locationName ?? '待同步'}
          color={theme.colors.success}
        />
        <TwinNode
          x={centerX}
          y={100}
          icon="sparkles-outline"
          title="AI Agent"
          value={`${actionCount} 個下一步`}
          color={theme.colors.accent}
        />
        <TwinNode
          x={16}
          y={174}
          icon="analytics-outline"
          title="風險"
          value={props.risk ? `${props.risk.score} 分` : '計算中'}
          color={theme.colors.warning}
        />
        <TwinNode
          x={rightX}
          y={176}
          icon="lock-closed-outline"
          title="確認閘"
          value={`${props.actions.filter((a) => a.requiresConfirmation).length} 個動作`}
          color={theme.colors.social}
        />

        <View
          style={{
            position: 'absolute',
            left: 14,
            right: 14,
            bottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Ionicons name="shield-checkmark" size={15} color={theme.colors.success} />
          <Text
            style={{ flex: 1, color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16 }}
          >
            個人資料只用於本人排序；校園脈動只進匿名匯總。
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
}

function AutopilotMissionRail(props: {
  actions: NextBestAction[];
  risk: StudentRiskSnapshot | null;
  aggregates: PulseAggregate[];
  onOpenAction: (action: NextBestAction) => void;
  onOpenAI: () => void;
}) {
  const topAction = props.actions[0] ?? null;
  const crowded = [...props.aggregates].sort((a, b) => b.currentLevel - a.currentLevel)[0] ?? null;
  const missions = [
    topAction
      ? {
          id: 'action',
          title: topAction.title,
          detail: topAction.nextStep,
          icon: topAction.requiresConfirmation
            ? ('shield-checkmark-outline' as const)
            : ('flash-outline' as const),
          color: urgencyColor(topAction.urgency),
          onPress: () => props.onOpenAction(topAction),
        }
      : {
          id: 'action',
          title: '生成今日任務',
          detail: '依課程、地點與收件匣建立路線',
          icon: 'sparkles-outline' as const,
          color: theme.colors.accent,
          onPress: props.onOpenAI,
        },
    {
      id: 'campus',
      title: crowded ? `${crowded.locationName} 時段判斷` : '校園空間判斷',
      detail: crowded?.bestTimeToVisit ? `建議 ${crowded.bestTimeToVisit}` : '等待匿名樣本提高信心',
      icon: 'map-outline' as const,
      color: theme.colors.success,
      onPress: props.onOpenAI,
    },
    {
      id: 'risk',
      title: props.risk?.summary ?? '學習風險掃描',
      detail: props.risk
        ? `${props.risk.recommendedActions.length} 個可執行建議`
        : '讀取作業、出席與成績趨勢',
      icon: 'pulse-outline' as const,
      color: theme.colors.warning,
      onPress: props.onOpenAI,
    },
  ];

  return (
    <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.xl }}>
      <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800', marginBottom: 14 }}>
        今日待辦
      </Text>
      <View
        style={{
          borderRadius: 16,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        }}
      >
        {missions.map((mission, index) => (
          <Pressable
            key={mission.id}
            onPress={mission.onPress}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 16,
              paddingHorizontal: 16,
              borderBottomWidth: index < missions.length - 1 ? 1 : 0,
              borderBottomColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <LinearGradient
              colors={[`${mission.color}20`, `${mission.color}08`] as [string, string]}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={mission.icon} size={18} color={mission.color} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}
                numberOfLines={1}
              >
                {mission.title}
              </Text>
              <Text
                style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}
                numberOfLines={1}
              >
                {mission.detail}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DataMoatPanel(props: {
  actions: NextBestAction[];
  risk: StudentRiskSnapshot | null;
  aggregates: PulseAggregate[];
}) {
  const pulseConfidence = averagePulseConfidence(props.aggregates);
  const confirmedActions = props.actions.filter((action) => action.requiresConfirmation).length;
  const evidenceCount = new Set(
    props.actions.flatMap((action) => action.evidenceRefs.map((ref) => `${ref.type}:${ref.id}`)),
  ).size;
  const rows = [
    {
      label: '授權校務資料',
      value: Math.min(100, 42 + evidenceCount * 9),
      color: theme.colors.info,
    },
    { label: '匿名校園脈動', value: Math.max(18, pulseConfidence), color: theme.colors.success },
    { label: '動作確認閘', value: confirmedActions > 0 ? 92 : 68, color: theme.colors.warning },
    {
      label: '風險推理',
      value: props.risk ? Math.min(96, 52 + props.risk.signals.length * 14) : 36,
      color: theme.colors.social,
    },
  ];

  return (
    <View
      style={{
        marginHorizontal: theme.space.lg,
        marginBottom: theme.space.lg,
        padding: theme.space.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <LinearGradient
          colors={[`${theme.colors.accent}30`, `${theme.colors.accent}10`] as [string, string]}
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="layers-outline" size={16} color={theme.colors.accent} />
        </LinearGradient>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '900' }}>
          資料閉環狀態
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        {rows.map((row) => (
          <View key={row.label}>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
                {row.label}
              </Text>
              <Text style={{ color: row.color, fontSize: 12, fontWeight: '900' }}>
                {row.value}%
              </Text>
            </View>
            <View
              style={{
                height: 7,
                borderRadius: 4,
                backgroundColor: theme.colors.surface2,
                overflow: 'hidden',
              }}
            >
              <LinearGradient
                colors={[row.color, `${row.color}BB`] as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: `${row.value}%`, height: '100%', borderRadius: 4 }}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────

export function SmartDashboardScreen(props: any) {
  const nav = props?.navigation;
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [insights, setInsights] = useState<FullAcademicInsights | null>(null);
  const [pulse, setPulse] = useState<CampusPulseSnapshot | null>(null);
  const [nextActions, setNextActions] = useState<NextBestAction[]>([]);
  const [riskSnapshots, setRiskSnapshots] = useState<StudentRiskSnapshot[]>([]);
  const [pulseAggregates, setPulseAggregates] = useState<PulseAggregate[]>([]);
  const [gamification, setGamification] = useState<GamificationState | null>(null);
  const [optimization, setOptimization] = useState<ScheduleOptimization | null>(null);
  const [agentMode, setAgentMode] = useState<AgentModeKey>('route');
  const [tcCourses, setTcCourses] = useState<TCCourse[]>([]);
  const [tcAttendance, setTcAttendance] = useState<TCAttendance[]>([]);
  const [attendanceCourses, setAttendanceCourses] = useState<AttendanceCourse[]>([]);
  const [hasTronClass, setHasTronClass] = useState(false);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [pendingTodos, setPendingTodos] = useState(0);
  const [aiBriefing, setAiBriefing] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayName = useMemo(
    () => auth.profile?.displayName ?? auth.user?.email?.split('@')[0] ?? '同學',
    [auth.profile?.displayName, auth.user?.email],
  );

  /** AI 分析使用者資料，生成個人化每日簡報 */
  const generateAIBriefing = useCallback(
    (
      insightsData: FullAcademicInsights | null,
      deadlinesData: Deadline[],
      todosCount: number,
      attendanceData: TCAttendance[],
      coursesData: TCCourse[],
    ) => {
      const parts: string[] = [];
      const now = new Date();
      const hour = now.getHours();

      // 1. 出席風險分析
      const lowAttendance = attendanceData.filter((a) => a.rate < 70);
      if (lowAttendance.length > 0) {
        parts.push(
          `⚠️ ${lowAttendance.length} 門課出席率低於 70%，建議優先處理出席問題，部分課程可能影響學期成績。`,
        );
      } else if (attendanceData.length > 0) {
        const avgRate = Math.round(
          attendanceData.reduce((s, a) => s + a.rate, 0) / attendanceData.length,
        );
        if (avgRate >= 90) {
          parts.push(`✅ 出席率 ${avgRate}%，保持得很好！`);
        }
      }

      // 2. 截止日緊急分析
      const urgentDeadlines = deadlinesData.filter((d) => d.remainingHours < 48 && !d.completed);
      const upcomingDeadlines = deadlinesData.filter(
        (d) => d.remainingHours >= 48 && d.remainingHours < 168 && !d.completed,
      );
      if (urgentDeadlines.length > 0) {
        const names = urgentDeadlines.slice(0, 3).map((d) => d.title).join('、');
        parts.push(
          `🔴 ${urgentDeadlines.length} 項作業/考試即將到期（48 小時內）：${names}。建議立即處理。`,
        );
      } else if (upcomingDeadlines.length > 0) {
        parts.push(
          `📋 本週有 ${upcomingDeadlines.length} 項待辦，時間充裕但建議提早規劃。`,
        );
      }

      // 3. GPA 趨勢分析
      if (insightsData) {
        const { trend, currentGpa, predictedNextGpa } = insightsData.gpaPrediction;
        if (trend === 'declining' && currentGpa > 0) {
          parts.push(
            `📉 GPA 呈下降趨勢（目前 ${currentGpa.toFixed(2)}），AI 預測下學期 ${predictedNextGpa.toFixed(2)}。建議加強弱勢科目的複習。`,
          );
        } else if (trend === 'improving' && currentGpa > 0) {
          parts.push(
            `📈 GPA 穩步提升中（${currentGpa.toFixed(2)} → 預測 ${predictedNextGpa.toFixed(2)}），繼續保持！`,
          );
        }

        // 4. 風險評估
        if (insightsData.riskAssessment.level === 'critical' || insightsData.riskAssessment.level === 'warning') {
          parts.push(
            `🚨 學業風險：高。主要風險因素：${insightsData.riskAssessment.factors.slice(0, 2).join('、')}。`,
          );
        }

        // 5. AI 推薦
        const topRec = insightsData.recommendations[0];
        if (topRec) {
          parts.push(`💡 AI 建議：${topRec.title} — ${topRec.description}`);
        }
      }

      // 6. 今日課程提醒
      const today = now.getDay();
      if (hour < 18 && coursesData.length > 0) {
        parts.push(`📚 今天有 ${coursesData.length} 門課程，記得準時上課。`);
      }

      if (parts.length === 0) {
        parts.push('目前沒有需要特別注意的事項，保持學習節奏！');
      }

      setAiBriefing(parts.join('\n\n'));
    },
    [],
  );

  const loadData = useCallback(async () => {
    try {
      const [insightsData, pulseData, gamData, optData, actionData, riskData, aggregateData] =
        await Promise.allSettled([
          getFullAcademicInsights(),
          getCampusPulseSnapshot(),
          getGamificationState(displayName, auth.profile?.department ?? ''),
          getScheduleOptimization(),
          auth.user
            ? ds.listNextBestActions(auth.user.uid, school.id)
            : Promise.resolve([] as NextBestAction[]),
          auth.user
            ? ds.listRiskSnapshots(auth.user.uid, school.id)
            : Promise.resolve([] as StudentRiskSnapshot[]),
          ds.listPulseAggregates(school.id),
        ]);

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

      setInsights(insightsData.status === 'fulfilled' ? insightsData.value : null);
      setPulse(pulseData.status === 'fulfilled' ? pulseData.value : null);
      setGamification(gamData.status === 'fulfilled' ? gamData.value : null);
      setOptimization(optData.status === 'fulfilled' ? optData.value : null);
      setNextActions(actionData.status === 'fulfilled' ? actionData.value : []);
      setRiskSnapshots(riskData.status === 'fulfilled' ? riskData.value : []);
      setPulseAggregates(aggregateData.status === 'fulfilled' ? aggregateData.value : []);

      // Load TronClass real data
      let tcCrs: TCCourse[] = [];
      let tcAtt: TCAttendance[] = [];
      try {
        const hasTC = await hasTCSession();
        setHasTronClass(hasTC);
        if (hasTC) {
          const [courses, attendance, attCourses] = await Promise.allSettled([
            tcFetchCourses('ongoing'),
            tcFetchAttendance(),
            getAttendanceCourses(),
          ]);
          if (courses.status === 'fulfilled') { tcCrs = courses.value; setTcCourses(tcCrs); seedCachedTCCourses(tcCrs).catch(() => {}); }
          if (attendance.status === 'fulfilled') { tcAtt = attendance.value; setTcAttendance(tcAtt); seedCachedTCAttendance(tcAtt).catch(() => {}); }
          if (attCourses.status === 'fulfilled') setAttendanceCourses(attCourses.value);
        }
      } catch {
        /* TronClass optional */
      }

      // Load deadlines + todos for AI briefing
      let dlData: Deadline[] = [];
      let todosCount = 0;
      try {
        dlData = await getDeadlines();
        setDeadlines(dlData);
        const todos = await getAnyCachedTCTodos();
        todosCount = todos?.filter((t) => t.status !== 'submitted' && t.status !== 'graded').length ?? 0;
        setPendingTodos(todosCount);
      } catch {}

      // Generate AI briefing from real data
      generateAIBriefing(
        insightsData.status === 'fulfilled' ? insightsData.value : null,
        dlData,
        todosCount,
        tcAtt,
        tcCrs,
      );

      // Auto daily check-in
      if (gamData.status === 'fulfilled') {
        try {
          await dailyCheckIn();
          await earnXP('daily_login');
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error('[SmartDashboard] loadData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [auth.profile?.department, auth.user?.uid, displayName, ds, school.id, generateAIBriefing]);

  // ─── Event Bus 即時監聽 — 點名/成績/作業等事件自動刷新 ───
  useEffect(() => {
    const unsubs = [
      campusEventBus.on('attendance:checked_in', () => loadData()),
      campusEventBus.on('session:ended', () => loadData()),
      campusEventBus.on('grade:updated', () => loadData()),
      campusEventBus.on('assignment:submitted', () => loadData()),
      campusEventBus.on('xp:earned', () => {
        // XP 變動時只刷新 gamification state（輕量）
        getGamificationState(displayName, auth.profile?.department ?? '').then((g) =>
          setGamification(g),
        ).catch(() => {});
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [loadData, displayName, auth.profile?.department]);

  // ─── 定時輪詢 — 每 60 秒靜默刷新關鍵資料 ───
  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      // 靜默刷新（不觸發 loading indicator）
      Promise.allSettled([
        getDeadlines().then((dl) => setDeadlines(dl)),
        getAnyCachedTCTodos().then((todos) => {
          setPendingTodos(todos?.filter((t) => t.status !== 'submitted' && t.status !== 'graded').length ?? 0);
        }),
        getAttendanceCourses().then((c) => setAttendanceCourses(c)),
      ]).catch(() => {});
    }, 60_000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const openAgentAction = useCallback(
    (action: NextBestAction) => {
      const target = action.actionTarget;
      if (!target) {
        aiOverlay.open({ mode: 'chat', prompt: action.title, source: 'smart_dashboard' });
        return;
      }

      if (target.tab) {
        navigateToTarget(
          nav,
          buildNavigationTarget(auth.profile?.role, target.tab, target.screen, target.params),
        );
        return;
      }

      if (target.screen) {
        nav?.navigate?.(target.screen, target.params);
      }
    },
    [auth.profile?.role, nav],
  );

  const openAI = useCallback(() => {
    aiOverlay.open({ mode: 'chat', source: 'smart_dashboard_open_ai' });
  }, []);

  const startAgentMode = useCallback(
    (modeKey: AgentModeKey) => {
      const mode = AGENT_MODES.find((item) => item.key === modeKey) ?? AGENT_MODES[0];
      aiOverlay.open({ mode: 'chat', prompt: mode.prompt, source: 'agent_mode' });
    },
    [],
  );

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
        <Text
          style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: theme.space.md }}
        >
          分析學業數據中...
        </Text>
      </View>
    );
  }

  const isDark = theme.mode === 'dark';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 40,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        {/* Gradient Header Area */}
        <LinearGradient
          colors={
            isDark
              ? (['#1A0A3E', '#0F0820', theme.colors.bg] as [string, string, string])
              : (['#EDE9FE', '#F0EBFF', theme.colors.bg] as [string, string, string])
          }
          style={{
            paddingTop: insets.top + theme.space.lg,
            paddingBottom: 20,
          }}
        >
          <AgentOSHero
            displayName={displayName}
            gamification={gamification}
            actions={nextActions}
            risk={riskSnapshots[0] ?? null}
            aggregates={pulseAggregates}
            onOpenAction={openAgentAction}
            onOpenAI={openAI}
            onOpenPulse={() => nav?.navigate?.('校園')}
          />

          <AgentModeDock selected={agentMode} onSelect={setAgentMode} onStart={startAgentMode} />
        </LinearGradient>

        {/* 2. XP Progress */}
        {gamification && <XPProgressBar gamification={gamification} />}

        {/* ── AI 智慧日報 ── */}
        {aiBriefing && (
          <View
            style={{
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.lg,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space.md,
              borderWidth: 1,
              borderColor: theme.colors.accent + '30',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                marginBottom: theme.space.md,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: theme.colors.accent + '20',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Ionicons name={'sparkles' as any} size={16} color={theme.colors.accent} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700', flex: 1 }}>
                AI 今日分析
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                即時更新
              </Text>
            </View>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              {aiBriefing}
            </Text>
          </View>
        )}

        {/* ── AI Brain 即時洞察卡片 ── */}
        <BrainInsightCards
          maxVisible={3}
          onActionPress={(insight: BrainInsight) => {
            aiOverlay.open({
              mode: 'chat',
              prompt: insight.actionSuggestion ?? insight.title,
              source: 'dashboard_insight_action',
            });
          }}
          onCardPress={(insight: BrainInsight) => {
            aiOverlay.open({
              mode: 'chat',
              prompt: insight.title,
              source: 'dashboard_insight_card',
            });
          }}
        />

        {/* ── 緊急截止日提醒 ── */}
        {deadlines.filter((d) => !d.completed && d.remainingHours < 72).length > 0 && (
          <View
            style={{
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.lg,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                marginBottom: theme.space.sm,
              }}
            >
              <Ionicons name={'alarm-outline' as any} size={16} color={theme.colors.danger} />
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                即將截止
              </Text>
              {pendingTodos > 0 && (
                <View
                  style={{
                    backgroundColor: theme.colors.danger,
                    borderRadius: 10,
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {pendingTodos}
                  </Text>
                </View>
              )}
            </View>
            {deadlines
              .filter((d) => !d.completed && d.remainingHours < 72)
              .sort((a, b) => a.remainingHours - b.remainingHours)
              .slice(0, 5)
              .map((dl) => {
                const isUrgent = dl.remainingHours < 24;
                const badgeColor = isUrgent ? theme.colors.danger : theme.colors.warning;
                const hoursText =
                  dl.remainingHours < 1
                    ? '不到 1 小時'
                    : dl.remainingHours < 24
                      ? `${Math.round(dl.remainingHours)} 小時`
                      : `${Math.round(dl.remainingHours / 24)} 天`;
                return (
                  <View
                    key={dl.id}
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radius.md,
                      padding: theme.space.sm,
                      marginBottom: 6,
                      borderWidth: 1,
                      borderColor: isUrgent ? theme.colors.danger + '40' : theme.colors.border,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.space.sm,
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: badgeColor,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}
                        numberOfLines={1}
                      >
                        {dl.title}
                      </Text>
                      {dl.courseName ? (
                        <Text
                          style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}
                          numberOfLines={1}
                        >
                          {dl.courseName}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={{
                        backgroundColor: badgeColor + '20',
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: theme.radius.sm,
                      }}
                    >
                      <Text style={{ color: badgeColor, fontSize: 11, fontWeight: '600' }}>
                        {hoursText}
                      </Text>
                    </View>
                  </View>
                );
              })}
          </View>
        )}

        {/* Quick Actions — 簡潔任務區 */}
        <AutopilotMissionRail
          actions={nextActions}
          risk={riskSnapshots[0] ?? null}
          aggregates={pulseAggregates}
          onOpenAction={openAgentAction}
          onOpenAI={openAI}
        />

        {/* 3. GPA Trend */}
        {insights && (
          <GpaTrendChart
            trends={insights.gpaPrediction.historicalTrends}
            prediction={{
              current: insights.gpaPrediction.currentGpa,
              predicted: insights.gpaPrediction.predictedNextGpa,
              trend: insights.gpaPrediction.trend,
              confidence: insights.gpaPrediction.confidence,
            }}
          />
        )}

        {/* 4. Risk Assessment */}
        {insights && (
          <RiskAssessmentCard
            level={insights.riskAssessment.level}
            score={insights.riskAssessment.score}
            factors={insights.riskAssessment.factors}
          />
        )}

        {/* 5. Graduation Progress */}
        <GraduationProgressCard optimization={optimization} />

        {/* 6. Smart Recommendations */}
        {insights && (
          <RecommendationCards
            recommendations={insights.recommendations}
            onPress={(rec) => {
              if (rec.relatedCourse) {
                navigateToCourseHome(nav, auth.profile?.role);
              }
            }}
          />
        )}

        {/* 7. Campus Pulse */}
        <CloudPulseStrip
          aggregates={pulseAggregates}
          onReportPress={() => nav?.navigate?.('校園')}
        />

        {pulseAggregates.length === 0 ? (
          <CampusPulseMini pulse={pulse} onReportPress={() => nav?.navigate?.('校園')} />
        ) : null}

        {/* 8. Weekly Challenges */}
        {gamification && <WeeklyChallenges challenges={gamification.weeklyChallenges} />}

        {/* 9. Achievements */}
        {gamification && (
          <AchievementPreview
            gamification={gamification}
            onPress={() => nav?.navigate?.('我的', { screen: 'Achievements' })}
          />
        )}

        {/* 10. TronClass 真實出席摘要 */}
        {hasTronClass && tcAttendance.length > 0 && (
          <Pressable
            onPress={() => navigateToCourseScreen(nav, auth.profile?.role, 'Attendance')}
            style={({ pressed }) => ({
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.lg,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space.md,
              borderWidth: 1,
              borderColor: theme.colors.accent + '40',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                marginBottom: theme.space.md,
              }}
            >
              <Ionicons name={'qr-code-outline' as any} size={20} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700', flex: 1 }}>
                出席概況
              </Text>
              <Text style={{ color: theme.colors.accent, fontSize: 12 }}>查看全部 →</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: theme.colors.accent, fontSize: 22, fontWeight: '800' }}>
                  {tcCourses.length}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>本學期課程</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: theme.colors.success, fontSize: 22, fontWeight: '800' }}>
                  {tcAttendance.length > 0
                    ? Math.round(
                        tcAttendance.reduce((sum, a) => sum + a.rate, 0) / tcAttendance.length,
                      )
                    : 0}
                  %
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>平均出席率</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: theme.colors.danger, fontSize: 22, fontWeight: '800' }}>
                  {tcAttendance.reduce((sum, a) => sum + a.absent, 0)}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>總缺席次數</Text>
              </View>
            </View>
            {tcAttendance.filter((a) => a.rate < 70).length > 0 && (
              <View
                style={{
                  marginTop: theme.space.md,
                  padding: theme.space.sm,
                  backgroundColor: theme.colors.danger + '15',
                  borderRadius: theme.radius.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space.sm,
                }}
              >
                <Ionicons name={'warning' as any} size={14} color={theme.colors.danger} />
                <Text
                  style={{ color: theme.colors.danger, fontSize: 12, fontWeight: '600', flex: 1 }}
                >
                  {tcAttendance.filter((a) => a.rate < 70).length} 門課出席率低於 70%，請注意！
                </Text>
              </View>
            )}
          </Pressable>
        )}

        {/* 11. Quick Actions */}
        <View style={{ marginHorizontal: theme.space.lg, marginBottom: theme.space.lg }}>
          <Text
            style={{
              color: theme.colors.text,
              fontSize: 16,
              fontWeight: '700',
              marginBottom: theme.space.md,
            }}
          >
            快速入口
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' }}>
            {[
              {
                icon: 'chatbubbles-outline',
                label: 'AI 助理',
                nav: () => aiOverlay.open({ mode: 'chat', source: 'dashboard_shortcut' }),
              },
              {
                icon: 'chatbubble-ellipses-outline',
                label: '校園社群',
                nav: () => nav?.navigate?.('CampusSocialScreen'),
              },
              {
                icon: 'qr-code-outline',
                label: '智慧點名',
                nav: () => navigateToCourseScreen(nav, auth.profile?.role, 'Attendance'),
              },
              {
                icon: 'school-outline',
                label: '選課顧問',
                nav: () => navigateToCourseScreen(nav, auth.profile?.role, 'AICourseAdvisor'),
              },
              {
                icon: 'calendar-outline',
                label: '智慧行事曆',
                nav: () =>
                  navigateToCourseScreen(nav, auth.profile?.role, 'CoursesHome', {
                    initialTab: 'calendar',
                  }),
              },
              {
                icon: 'trophy-outline',
                label: '成就',
                nav: () => nav?.navigate?.('我的', { screen: 'Achievements' }),
              },
            ].map((item) => (
              <Pressable
                key={item.label}
                onPress={item.nav}
                style={({ pressed }) => ({
                  width: '31%' as any,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.md,
                  padding: theme.space.sm,
                  alignItems: 'center',
                  gap: 4,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  opacity: pressed ? 0.7 : 1,
                  marginBottom: theme.space.sm,
                })}
              >
                <Ionicons name={item.icon as any} size={20} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 10 }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
