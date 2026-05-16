/**
 * Department Dashboard — 系所主任 / 管理職今日駕駛艙（統一設計系統）
 */
import React, { useMemo, useState, useEffect } from 'react';
import { ScrollView, View, LayoutAnimation, Platform, UIManager, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { simulateDepartmentBroadcast } from '../services/demoActionSimulator';
import { subscribeAllRoleEvents, type RoleEvent } from '../services/roleEventBus';

import { predictCurrent, type PredictorItem } from '@campus/shared';
import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoScoreItemsByCourse,
  getDemoAttendanceByCourse,
} from '../data/demoCoursesMock';
import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
  CockpitToolChip,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';
import { safeNavigate } from '../utils/safeNavigate';
import { aiDepartmentHealthScore } from '../services/aiOrchestrator';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function DepartmentDashboardScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  const [openSection, setOpenSection] = useState<null | 'risk' | 'all' | 'load' | 'live'>('risk');
  const [recentEvents, setRecentEvents] = useState<RoleEvent<unknown>[]>([]);
  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? null : k);
  };

  // 主任端：監看全系動態（grade_published / homework_submitted / attendance_*）
  useEffect(() => {
    const unsub = subscribeAllRoleEvents((event) => {
      // 只收教學相關 events，不要 vendor / department_broadcast 自己回波
      if (event.kind === 'order_placed' || event.kind === 'order_status_changed') return;
      if (event.kind === 'department_broadcast' && event.actorUid === auth.user?.uid) return;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setRecentEvents((prev) => [event, ...prev].slice(0, 20));
    });
    return () => { unsub(); };
  }, [auth.user?.uid]);

  const courseStats = useMemo(() => {
    return DEMO_COURSES.map((c) => {
      const hws = getDemoHomeworksByCourse(c.id);
      const items = getDemoScoreItemsByCourse(c.id);
      const att = getDemoAttendanceByCourse(c.id);
      const predict = predictCurrent(
        items.map((s): PredictorItem => ({
          id: String(s.id),
          title: s.name,
          weight: s.weight,
          maxScore: s.totalScore,
          score: s.studentScore,
          graded: s.studentScore !== null,
        })),
      );
      const pendingGrade = hws.filter((h) => h.submitted && !h.graded).length;
      const present = att.filter((a) => a.myStatus === 'present').length;
      const total = att.length;
      const attRate = total > 0 ? (present / total) * 100 : 0;
      return {
        course: c,
        likely: predict.likelyCase,
        pendingGrade,
        attRate: Math.round(attRate),
        atRisk: predict.likelyCase !== null && predict.likelyCase < 70,
      };
    });
  }, []);

  const totalAtRisk = courseStats.filter((c) => c.atRisk).length;
  const totalPending = courseStats.reduce((s, c) => s + c.pendingGrade, 0);
  const avgAttendance = Math.round(
    courseStats.reduce((s, c) => s + c.attRate, 0) / Math.max(1, courseStats.length),
  );

  // AI 系所健康度 — 一次算好給 hero + topRisks section 共用
  const aiHealth = useMemo(() => aiDepartmentHealthScore(), []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: tabBarBottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={`午安，${auth.profile?.displayName?.split('（')[0] ?? '主任'}`}
          title="本系今日概況"
          summary={`🤖 系所健康度 ${aiHealth.score}%。${aiHealth.suggestions[0] ?? ''}`}
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="風險課程" value={totalAtRisk} tone={totalAtRisk > 0 ? 'danger' : 'success'} />
          <CockpitMetricChip label="待批改" value={totalPending} />
          <CockpitMetricChip label="平均出席" value={`${avgAttendance}%`} tone={avgAttendance >= 85 ? 'success' : 'warn'} />
          <CockpitMetricChip label="即時動態" value={recentEvents.length} tone={recentEvents.length > 0 ? 'warn' : undefined} />
        </CockpitMetricRow>

        {/* 即時動態 */}
        {recentEvents.length > 0 && (
          <View style={{ marginTop: theme.space.sm, marginBottom: theme.space.sm }}>
            <CockpitSection
              label="🔴 全系即時動態"
              count={recentEvents.length}
              open={openSection === 'live'}
              onToggle={() => toggle('live')}
            >
              {recentEvents.slice(0, 8).map((evt) => {
                const meta = (() => {
                  switch (evt.kind) {
                    case 'homework_submitted': return { emoji: '✍️', label: '繳交' };
                    case 'attendance_checked_in': return { emoji: '✅', label: '簽到' };
                    case 'attendance_session_opened': return { emoji: '🟢', label: '開點名' };
                    case 'grade_published': return { emoji: '📊', label: '公布成績' };
                    case 'bulk_reminder_sent': return { emoji: '⏰', label: '老師提醒' };
                    case 'feedback_drafted': return { emoji: '✏️', label: '評語' };
                    case 'department_broadcast': return { emoji: '📣', label: '系所公告' };
                    case 'help_requested': return { emoji: '🆘', label: '學生求助' };
                    default: return { emoji: '🔔', label: evt.kind };
                  }
                })();
                const ago = Math.max(0, Math.round((Date.now() - new Date(evt.occurredAt).getTime()) / 60_000));
                return (
                  <CockpitRow
                    key={evt.id}
                    icon={meta.emoji}
                    title={`${meta.label} · ${evt.courseName}`}
                    subtitle={`${evt.actorName} · ${ago < 1 ? '剛剛' : ago + ' 分鐘前'}`}
                  />
                );
              })}
            </CockpitSection>
          </View>
        )}

        <View style={{ marginTop: theme.space.sm }}>
          {/* AI 系所健康度 — topRisks + 建議全部繪出（之前 topRisks 算了沒用） */}
          {(aiHealth.topRisks.length > 0 || aiHealth.suggestions.length > 1) && (
            <CockpitSection
              label="🤖 AI 系所健康分析"
              count={aiHealth.topRisks.length}
              open={openSection === 'risk'}
              onToggle={() => toggle('risk')}
            >
              {aiHealth.topRisks.map((r, i) => (
                <CockpitRow
                  key={`risk_${i}`}
                  icon="🚩"
                  title={r}
                  tone="warn"
                />
              ))}
              {aiHealth.suggestions.map((s, i) => (
                <CockpitRow
                  key={`sug_${i}`}
                  icon="💡"
                  title={s}
                />
              ))}
            </CockpitSection>
          )}

          {totalAtRisk > 0 && (
            <CockpitSection
              label="🚩 風險課程"
              count={totalAtRisk}
              open={openSection === 'risk'}
              onToggle={() => toggle('risk')}
            >
              {courseStats
                .filter((c) => c.atRisk)
                .map((cs) => (
                  <CockpitRow
                    key={cs.course.id}
                    icon={cs.course.iconEmoji}
                    title={cs.course.name}
                    subtitle={`授課 ${cs.course.instructor} · 班級預估 ${cs.likely}%`}
                    tone="danger"
                    onPress={() =>
                      safeNavigate(navigation, 'CourseScores', {
                        groupId: String(cs.course.id),
                        groupName: cs.course.name,
                      }, { fallbackMessage: '即將跳到課程成績' })
                    }
                  />
                ))}
            </CockpitSection>
          )}

          <CockpitSection
            label="📚 課程一覽"
            count={courseStats.length}
            open={openSection === 'all'}
            onToggle={() => toggle('all')}
          >
            {courseStats.map((cs) => (
              <CockpitRow
                key={cs.course.id}
                icon={cs.course.iconEmoji}
                title={cs.course.name}
                subtitle={`${cs.course.instructor} · 待批 ${cs.pendingGrade} · 出席 ${cs.attRate}%`}
                tone={cs.atRisk ? 'warn' : undefined}
                onPress={() =>
                  navigation.navigate('CourseScores', {
                    groupId: String(cs.course.id),
                    groupName: cs.course.name,
                  })
                }
              />
            ))}
          </CockpitSection>

          <CockpitSection
            label="👨‍🏫 老師工作負載"
            count={courseStats.filter((cs) => cs.pendingGrade > 0).length}
            open={openSection === 'load'}
            onToggle={() => toggle('load')}
          >
            {courseStats
              .slice()
              .sort((a, b) => b.pendingGrade - a.pendingGrade)
              .slice(0, 5)
              .map((cs) => (
                <CockpitRow
                  key={cs.course.id}
                  title={cs.course.instructor}
                  subtitle={`${cs.course.name} · 待批改 ${cs.pendingGrade} 份`}
                  tone={cs.pendingGrade >= 5 ? 'warn' : undefined}
                />
              ))}
          </CockpitSection>
        </View>

        <View style={{
          marginTop: theme.space.lg,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.space.xs + 2,
        }}>
          <CockpitToolChip
            icon="stats-chart-outline"
            label="教學評鑑"
            onPress={() =>
              safeNavigate(navigation, 'LearningAnalytics', undefined, {
                fallbackMessage: '教學評鑑頁面即將推出',
              })
            }
          />
          <CockpitToolChip
            icon="megaphone-outline"
            label="一鍵廣播 demo"
            onPress={() => {
              Alert.alert(
                '一鍵系所廣播',
                '會發送一則 demo 廣播給所有學生 + 老師。要送嗎？',
                [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '送出',
                    onPress: async () => {
                      try {
                        await simulateDepartmentBroadcast({
                          adminUid: auth.user?.uid ?? 'demo_admin_huang',
                          adminName: auth.profile?.displayName ?? '黃主任',
                          title: '本系本週重要事項',
                          body: '提醒：5/20 期末退選截止；獎學金申請延長至 5/31；下學期選課單即將開放。',
                          audience: 'all',
                        });
                        Alert.alert('✅ 已廣播', '所有學生 + 老師會在 inbox 看到');
                      } catch (e) {
                        Alert.alert('廣播失敗', String(e));
                      }
                    },
                  },
                ],
              );
            }}
          />
          <CockpitToolChip
            icon="people-outline"
            label="學生 risk"
            onPress={() =>
              safeNavigate(navigation, 'LearningAnalytics', undefined, {
                fallbackMessage: '學生風險頁面即將推出',
              })
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
