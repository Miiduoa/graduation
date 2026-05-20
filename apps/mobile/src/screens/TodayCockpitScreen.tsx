/**
 * Today Cockpit — 極簡焦點版（v3，統一設計系統）
 *
 * 全部用 theme tokens（colors / space / radius / typography），
 * 不再 hardcoded 顏色。所有 cockpit 共用同一視覺語言。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  planStudy,
  homeworkToPlannerTask,
  examToPlannerTask,
  predictCurrent,
  dueToday as mistakesDueToday,
  type PlannerTask,
  type PredictorItem,
  type MistakeEntry,
  type PrioritizedTask,
} from '@campus/shared';

import {
  getDemoCoursesForUid,
  getDemoHomeworksByCourse,
  getDemoExamsByCourse,
  getDemoScoreItemsByCourse,
} from '../data/demoCoursesMock';
import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { getScopedStorageKey } from '../services/scopedStorage';
import { loadPersistedValue } from '../services/persistedStorage';
import {
  loadVisibleRoleEventInbox,
  subscribeAllRoleEvents,
  type RoleEvent,
} from '../services/roleEventBus';
import { aiSummarizeStudentInbox } from '../services/aiOrchestrator';

const STUDENT_TEACHER_INBOX_KINDS = new Set([
  'grade_published',
  'bulk_reminder_sent',
  'feedback_drafted',
  'attendance_session_opened',
  'announcement_posted',
  'homework_published',
  'peer_review_assigned',
]);
import { safeNavigate } from '../utils/safeNavigate';
import { recommendMerchantsForStudent } from '../data/demoMerchants';
import { simulateStudentOrderFood } from '../services/demoActionSimulator';
import { getStudentLifeQuickFacts } from '../data/demoUserStories';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
  CockpitToolChip,
} from '../ui/cockpitShell';
import { AgentSummaryBanner } from '../components/AgentSummaryBanner';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MISTAKE_STORAGE_KEY_BASE = 'mistake_repertoire_v1';

function urgencyLabel(u: PrioritizedTask['urgency']): string {
  switch (u) {
    case 'overdue': return '已逾期';
    case 'urgent': return '今天到';
    case 'soon': return '3 天內';
    case 'later': return '本週';
    default: return '';
  }
}

export default function TodayCockpitScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  const mistakeStorageKey = useMemo(
    () => getScopedStorageKey(MISTAKE_STORAGE_KEY_BASE, { uid: auth.user?.uid ?? 'demo', schoolId: auth.profile?.schoolId ?? null }),
    [auth.user?.uid, auth.profile?.schoolId],
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now] = useState(new Date().toISOString());
  const [openSection, setOpenSection] = useState<null | 'grades' | 'tasks' | 'mistakes' | 'fromTeacher' | 'dining'>(null);
  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? null : k);
  };

  // 依當前 demo 角色篩選課程（教師/TA/餐廳/校友/訪客不該看到全部課程）
  const visibleCourses = useMemo(
    () => getDemoCoursesForUid(auth.user?.uid),
    [auth.user?.uid],
  );

  const plannerTasks: PlannerTask[] = useMemo(() => {
    const arr: PlannerTask[] = [];
    for (const c of visibleCourses) {
      for (const hw of getDemoHomeworksByCourse(c.id)) {
        arr.push(homeworkToPlannerTask({
          id: hw.id, courseId: hw.courseId, courseName: c.name,
          title: hw.title, dueAt: hw.dueAt, submitted: hw.submitted, totalScore: hw.totalScore,
        }));
      }
      for (const e of getDemoExamsByCourse(c.id)) {
        arr.push(examToPlannerTask({
          id: e.id, courseId: e.courseId, courseName: c.name,
          title: e.title, startAt: e.startAt, isPractice: e.isPractice,
          submitted: e.submitted, totalScore: e.totalScore,
        }));
      }
    }
    return arr;
  }, [visibleCourses]);

  const studyPlan = useMemo(() => planStudy(plannerTasks, { now }), [plannerTasks, now]);
  const nextTask = studyPlan.prioritized[0];

  const grades = useMemo(() => visibleCourses.map((c) => {
    const items = getDemoScoreItemsByCourse(c.id);
    const pred = predictCurrent(items.map((s): PredictorItem => ({
      id: String(s.id), title: s.name, weight: s.weight,
      maxScore: s.totalScore, score: s.studentScore, graded: s.studentScore !== null,
    })));
    return { id: c.id, name: c.name, iconEmoji: c.iconEmoji, likely: pred.likelyCase, letter: pred.letterGrade };
  }), [visibleCourses]);

  const [mistakes, setMistakes] = useState<MistakeEntry[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const parsed = await loadPersistedValue<MistakeEntry[]>({
          storageKey: mistakeStorageKey,
          fallback: [],
          deserialize: (raw) => {
            const value = JSON.parse(raw);
            return Array.isArray(value) ? value : [];
          },
        });
        setMistakes(parsed);
      } catch { /* swallow */ } finally { setLoading(false); }
    })();
  }, [mistakeStorageKey]);
  const mistakesDue = useMemo(() => mistakesDueToday(mistakes, now), [mistakes, now]);

  const [roleEvents, setRoleEvents] = useState<RoleEvent<unknown>[]>([]);
  useEffect(() => {
    if (!auth.user?.uid) return;
    let mounted = true;
    loadVisibleRoleEventInbox({ uid: auth.user.uid, role: auth.profile?.role }).then((e) => {
      if (mounted) setRoleEvents(e);
    });
    const unsub = subscribeAllRoleEvents(() => {
      loadVisibleRoleEventInbox({ uid: auth.user!.uid, role: auth.profile?.role }).then((e) => {
        if (mounted) setRoleEvents(e);
      });
    });
    return () => { mounted = false; unsub(); };
  }, [auth.profile?.role, auth.user?.uid]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  }, []);

  const greeting = useMemo(() => {
    const h = new Date(now).getHours();
    if (h < 12) return '早安';
    if (h < 18) return '午安';
    return '晚安';
  }, [now]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const atRiskCount = grades.filter((g) => g.likely !== null && g.likely < 70).length;
  const teacherRoleEvents = roleEvents.filter((event) => STUDENT_TEACHER_INBOX_KINDS.has(event.kind));
  const unreadFromTeacher = teacherRoleEvents.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: tabBarBottomPad,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={`${greeting}，${auth.profile?.displayName?.split('（')[0] ?? '同學'}`}
          title={
            studyPlan.overdueTasks.length > 0
              ? `先處理 ${studyPlan.overdueTasks.length} 件逾期`
              : nextTask
                ? '接下來只做這一件'
                : '今天沒事，好好休息'
          }
          summary={(() => {
            const inboxSummary = aiSummarizeStudentInbox(teacherRoleEvents);
            if (inboxSummary.recommendedAction) {
              return `🤖 ${inboxSummary.recommendedAction}。${studyPlan.summary}`;
            }
            return `✨ ${studyPlan.summary}`;
          })()}
        />

        {/* 🤖 AI Agent 摘要 banner — 點進 AIAgentConsole */}
        <AgentSummaryBanner cockpitLabel="學生 Today" />

        {/* 焦點 CTA */}
        {nextTask && (
          <Pressable
            onPress={() =>
              safeNavigate(navigation, 'CourseModules', {
                groupId: String(nextTask.courseId),
                groupName: nextTask.courseName,
              }, { fallbackMessage: `${nextTask.courseName}\n${nextTask.title}` })
            }
            style={({ pressed }) => ({
              padding: theme.space.lg,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accent,
              opacity: pressed ? 0.85 : 1,
              marginBottom: theme.space.lg,
              borderWidth: 1,
              borderColor: theme.colors.accent,
            })}
          >
            <Text style={{
              color: theme.colors.onAccent, opacity: 0.74,
              fontSize: theme.typography.labelSmall.fontSize,
              fontWeight: '700',
            }}>
              AI 排定 · {nextTask.courseName} · {urgencyLabel(nextTask.urgency)}
            </Text>
            <Text
              style={{
                color: theme.colors.onAccent,
                fontSize: theme.typography.h2.fontSize,
                lineHeight: theme.typography.h2.lineHeight,
                fontWeight: '700',
                marginTop: theme.space.xs,
              }}
              numberOfLines={2}
            >
              {nextTask.title}
            </Text>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: theme.space.md,
            }}>
              <Text style={{
                color: theme.colors.onAccent,
                opacity: 0.74,
                fontSize: theme.typography.bodySmall.fontSize,
              }}>
                預估 {Math.round(nextTask.estimatedMinutes)} 分鐘
              </Text>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: theme.space.sm + 2,
                paddingVertical: theme.space.xs + 4,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
              }}>
                <Ionicons name="play" size={12} color={theme.colors.accent} />
                <Text style={{
                  color: theme.colors.accent,
                  fontSize: theme.typography.bodySmall.fontSize,
                  fontWeight: '700',
                }}>開始</Text>
              </View>
            </View>
          </Pressable>
        )}

        <CockpitMetricRow>
          <CockpitMetricChip label="待辦" value={studyPlan.prioritized.length} />
          <CockpitMetricChip label="風險課" value={atRiskCount} tone={atRiskCount > 0 ? 'danger' : undefined} />
          <CockpitMetricChip label="錯題複習" value={mistakesDue.length} />
        </CockpitMetricRow>

        {/* 校園生活速覽 — 整合宿舍/圖書/印表/餐廳餘額/運動/社團 */}
        {(() => {
          const facts = auth.user?.uid ? getStudentLifeQuickFacts(auth.user.uid) : [];
          if (facts.length === 0) return null;
          return (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: theme.space.xs + 2,
                marginTop: theme.space.sm + 2,
                marginBottom: theme.space.sm,
              }}
            >
              {facts.map((f, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    paddingHorizontal: theme.space.sm + 2,
                    paddingVertical: theme.space.xs + 2,
                    borderRadius: theme.radius.full,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: f.tone === 'warn'
                      ? theme.colors.warning
                      : f.tone === 'danger'
                        ? theme.colors.danger
                        : theme.colors.border,
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{f.icon}</Text>
                  <Text style={{
                    fontSize: 11,
                    color: theme.colors.muted,
                    fontWeight: '500',
                  }}>
                    {f.label}
                  </Text>
                  <Text style={{
                    fontSize: 12,
                    color: f.tone === 'warn'
                      ? theme.colors.warning
                      : f.tone === 'danger'
                        ? theme.colors.danger
                        : theme.colors.text,
                    fontWeight: '700',
                  }}>
                    {f.value}
                  </Text>
                </View>
              ))}
            </View>
          );
        })()}

        {/* 摺疊 sections */}
        <View style={{ marginTop: theme.space.sm }}>
          <CockpitSection
            label="📋 待辦清單"
            count={studyPlan.prioritized.length}
            open={openSection === 'tasks'}
            onToggle={() => toggle('tasks')}
          >
            {studyPlan.prioritized.slice(0, 6).map((t) => (
              <CockpitRow
                key={t.id}
                title={t.title}
                subtitle={`${t.courseName} · ${urgencyLabel(t.urgency)}`}
                tone={t.urgency === 'overdue' ? 'danger' : t.urgency === 'urgent' ? 'warn' : undefined}
                onPress={() =>
                  safeNavigate(navigation, 'CourseModules', {
                    groupId: String(t.courseId),
                    groupName: t.courseName,
                  }, { fallbackMessage: `${t.courseName}\n${t.title}` })
                }
              />
            ))}
          </CockpitSection>

          <CockpitSection
            label="📊 各課預估"
            count={grades.length}
            open={openSection === 'grades'}
            onToggle={() => toggle('grades')}
          >
            {grades.map((g) => (
              <CockpitRow
                key={g.id}
                icon={g.iconEmoji}
                title={g.name}
                subtitle={`預估 ${g.likely ?? '—'}%${g.letter ? ` · ${g.letter}` : ''}`}
                tone={g.likely !== null && g.likely < 70 ? 'warn' : undefined}
                onPress={() =>
                  safeNavigate(navigation, 'CourseScores', {
                    groupId: String(g.id),
                    groupName: g.name,
                  }, { fallbackMessage: `${g.name} 預估 ${g.likely ?? '—'}%` })
                }
              />
            ))}
          </CockpitSection>

          {mistakesDue.length > 0 && (
            <CockpitSection
              label="🧠 錯題複習"
              count={mistakesDue.length}
              open={openSection === 'mistakes'}
              onToggle={() => toggle('mistakes')}
            >
              <CockpitRow
                title="開始今日複習"
                subtitle={`${mistakesDue.length} 題依間隔重複排程`}
                onPress={() => safeNavigate(navigation, 'MistakeRepertoire', undefined, { fallbackMessage: '即將跳到錯題本' })}
              />
            </CockpitSection>
          )}

          {/* 🍱 AI 訂餐推薦 — 依時段推薦 + 一鍵下訂 demo */}
          <CockpitSection
            label="🍱 下一餐 AI 建議"
            count={(() => {
              const hour = new Date().getHours();
              return recommendMerchantsForStudent({ hour }).slice(0, 3).length;
            })()}
            open={openSection === 'dining'}
            onToggle={() => toggle('dining')}
          >
            {recommendMerchantsForStudent({ hour: new Date().getHours() })
              .slice(0, 3)
              .map((rec) => (
                <CockpitRow
                  key={rec.merchantId}
                  icon={rec.emoji}
                  title={rec.merchantName}
                  subtitle={`${rec.reason} · 約等 ${rec.estimatedWaitMinutes} 分`}
                  tone={rec.score >= 80 ? 'success' : rec.estimatedWaitMinutes > 15 ? 'warn' : undefined}
                  onPress={() => {
                    Alert.alert(
                      `${rec.emoji} ${rec.merchantName}`,
                      `AI 推薦分數：${rec.score}/100\n${rec.reason}\n預估等候：${rec.estimatedWaitMinutes} 分鐘\n\n要一鍵示範下訂單嗎？\n（demo：會通知餐廳端）`,
                      [
                        { text: '看菜單', onPress: () => safeNavigate(navigation, '校園生活', { tab: 'cafeteria' } as any, { fallbackMessage: '校園生活即將開放' }) },
                        {
                          text: '下訂 demo',
                          onPress: async () => {
                            if (!auth.user) return;
                            try {
                              await simulateStudentOrderFood({
                                studentUid: auth.user.uid,
                                studentName: auth.profile?.displayName ?? '我',
                                merchantId: rec.merchantId,
                                merchantName: rec.merchantName,
                                items: 'demo 套餐 ×1',
                                total: 80,
                              });
                              Alert.alert('✅ 訂單已送出', `${rec.merchantName} 已收到訂單，可去餐廳 cockpit 看推進`);
                            } catch (e) {
                              Alert.alert('下訂失敗', String((e as Error)?.message ?? e));
                            }
                          },
                        },
                        { text: '取消', style: 'cancel' },
                      ],
                    );
                  }}
                />
              ))}
          </CockpitSection>

          {unreadFromTeacher > 0 && (
            <CockpitSection
              label="📥 來自老師"
              count={unreadFromTeacher}
              open={openSection === 'fromTeacher'}
              onToggle={() => toggle('fromTeacher')}
            >
              {teacherRoleEvents.slice(0, 5).map((evt) => {
                const meta = (() => {
                  switch (evt.kind) {
                    case 'grade_published': return { emoji: '📊', label: '新成績' };
                    case 'feedback_drafted': return { emoji: '✏️', label: '老師評語' };
                    case 'bulk_reminder_sent': return { emoji: '⏰', label: '作業提醒' };
                    case 'attendance_session_opened': return { emoji: '✅', label: '點名中' };
                    default: return { emoji: '🔔', label: '通知' };
                  }
                })();
                const preview = (() => {
                  const p = evt.payload as any;
                  if (evt.kind === 'feedback_drafted') return p.homeworkTitle;
                  if (evt.kind === 'bulk_reminder_sent') return p.homeworkTitle;
                  if (evt.kind === 'grade_published') return `${p.itemTitle} ${p.score}/${p.totalScore}`;
                  return JSON.stringify(p).slice(0, 30);
                })();
                return (
                  <CockpitRow
                    key={evt.id}
                    icon={meta.emoji}
                    title={meta.label}
                    subtitle={`${evt.courseName} · ${preview}`}
                  />
                );
              })}
            </CockpitSection>
          )}
        </View>

        {/* 工具入口 */}
        <View style={{
          marginTop: theme.space.lg,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.space.xs + 2,
        }}>
          <CockpitToolChip
            icon="bulb-outline"
            label="AI 學伴"
            onPress={() =>
              safeNavigate(navigation, 'AICourseAdvisor', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="hardware-chip-outline"
            label="AI 觀察台"
            onPress={() =>
              safeNavigate(navigation, 'AIAgentObservatory', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="mail-outline"
            label="收件匣"
            onPress={() =>
              safeNavigate(navigation, 'StudentInbox', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="paw-outline"
            label="校園精靈"
            onPress={() =>
              safeNavigate(navigation, 'Companion', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="star-outline"
            label="學習星圖"
            onPress={() =>
              safeNavigate(navigation, 'Constellation', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="leaf-outline"
            label="學習花園"
            onPress={() =>
              safeNavigate(navigation, 'CampusGarden', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="trophy-outline"
            label="我的成就"
            onPress={() =>
              safeNavigate(navigation, 'Achievements', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="calendar-outline"
            label="本月回顧"
            onPress={() =>
              safeNavigate(navigation, 'MonthlySummary', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="bag-outline"
            label="我的訂單"
            onPress={() =>
              safeNavigate(navigation, 'StudentOrders', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="document-text-outline"
            label="請假 / 報修"
            onPress={() =>
              safeNavigate(navigation, 'LifeRequests', undefined, {})
            }
          />
          <CockpitToolChip
            icon="stats-chart-outline"
            label="成績試算"
            onPress={() =>
              safeNavigate(navigation, 'GradeWhatIf', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="timer-outline"
            label="番茄專注"
            onPress={() =>
              safeNavigate(navigation, 'PomodoroSession', undefined, {
              })
            }
          />
          <CockpitToolChip
            icon="library-outline"
            label="錯題本"
            onPress={() =>
              safeNavigate(navigation, 'MistakeRepertoire', undefined, {
              })
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
