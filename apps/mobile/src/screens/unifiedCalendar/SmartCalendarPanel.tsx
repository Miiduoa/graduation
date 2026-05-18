/* eslint-disable */
/**
 * 📅 智慧行事曆 — Smart Calendar Screen
 *
 * 統一整合課表 + 截止日 + AI 讀書計劃 + 番茄鐘
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme';
import { useAuth } from '../../state/auth';
import { navigateFromInboxTask } from '../../services/inboxActions';
import { isTeachingRole } from '../../utils/campusOs';
import type { InboxTask } from '../../data/types';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useThemeMode } from '../../state/theme';
import {
  getCalendarData,
  getDeadlines,
  generateStudyPlan,
  startPomodoro,
  completePomodoro,
  completeDeadline,
  syncCourseSchedule,
  type CalendarEvent,
  type Deadline,
  type StudyPlan,
  type PomodoroSession,
  type PomodoroStats,
  type WeekView,
} from '../../services/smartCalendarEngine';
import { earnXP } from '../../services/gamificationEngine';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_W } = Dimensions.get('window');
const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

// ─── Main Screen ─────────────────────────────────────────

export function SmartCalendarPanel({
  embedded,
  onJumpToScheduleTab,
}: {
  embedded?: boolean;
  /** 嵌入於「課程→行事曆」時：引導使用者回到「課表」分頁開啟教室／校園地圖動線 */
  onJumpToScheduleTab?: () => void;
} = {}) {
  useThemeMode();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<any>();
  const auth = useAuth();
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [studyPlans, setStudyPlans] = useState<StudyPlan[]>([]);
  const [pomodoroStats, setPomodoroStats] = useState<PomodoroStats | null>(null);
  const [weekView, setWeekView] = useState<WeekView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'deadlines' | 'plan' | 'pomodoro'>('deadlines');
  const [pomodoroActive, setPomodoroActive] = useState(false);
  const [pomodoroRemaining, setPomodoroRemaining] = useState(25 * 60);
  const [currentSession, setCurrentSession] = useState<PomodoroSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getCalendarData();
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setDeadlines(data.deadlines);
      setStudyPlans(data.studyPlans);
      setPomodoroStats(data.pomodoroStats);
      setWeekView(data.weekView);
    } catch (e) {
      console.warn('[SmartCalendar] load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const openDeadlineInLearn = useCallback(
    (d: Deadline) => {
      if (!d.groupId || !d.assignmentId) return;
      const kind: InboxTask['kind'] =
        d.type === 'quiz' || d.type === 'exam' ? 'quiz' : 'assignment';
      const task: InboxTask = {
        id: d.id,
        kind,
        groupId: d.groupId,
        groupName: d.courseName ?? '課程',
        title: d.title,
        subtitle: d.courseCode ? `課號 ${d.courseCode}` : '',
        assignmentId: d.assignmentId,
        priority: 50,
        dueAt: new Date(d.dueAt),
      };
      const navigated = navigateFromInboxTask(nav, task, {
        role: auth.profile?.role,
        isTeachingRole: isTeachingRole(auth.profile?.role),
      });
      if (!navigated) {
        nav?.navigate?.('訊息', {
          screen: 'AssignmentDetail',
          params: { groupId: d.groupId, assignmentId: d.assignmentId },
        });
      }
    },
    [nav, auth.profile?.role],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // Pomodoro timer
  const startTimer = useCallback(async () => {
    const session = await startPomodoro({ duration: 25, subject: deadlines[0]?.courseName });
    setCurrentSession(session);
    setPomodoroActive(true);
    setPomodoroRemaining(25 * 60);

    timerRef.current = setInterval(() => {
      setPomodoroRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setPomodoroActive(false);
          completePomodoro(session.id).then(() => {
            earnXP('study_session').catch(() => {});
            load();
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [deadlines, load]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPomodoroActive(false);
    if (currentSession) {
      completePomodoro(currentSession.id).then(() => load());
    }
  }, [currentSession, load]);

  const handleCompleteDeadline = useCallback(async (id: string) => {
    await completeDeadline(id);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDeadlines((prev) => prev.filter((d) => d.id !== id));
    earnXP('submit_assignment').catch(() => {});
  }, []);

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
          載入行事曆...
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: embedded ? 8 : insets.top + 16,
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
        {/* Header — 嵌入模式隱藏 */}
        {!embedded && (
          <View style={{ paddingHorizontal: theme.space.lg, marginBottom: theme.space.md }}>
            <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: '800' }}>
              智慧行事曆
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: 4 }}>
              AI 幫你管理時間，專注學習
            </Text>
          </View>
        )}

        {embedded && onJumpToScheduleTab ? (
          <Pressable
            onPress={onJumpToScheduleTab}
            style={{
              marginHorizontal: theme.space.lg,
              marginBottom: theme.space.md,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Ionicons name="map-outline" size={22} color={theme.colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>
                要看教室在哪？前往「課表」分頁
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                點課程後可開啟校園地圖導航（口試 Golden Path）
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
          </Pressable>
        ) : null}

        {/* Week Summary */}
        {weekView && <WeekSummaryCard weekView={weekView} />}

        {/* Tab Switcher */}
        <View
          style={{
            flexDirection: 'row',
            marginHorizontal: theme.space.lg,
            marginBottom: theme.space.lg,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.md,
            padding: 3,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          {[
            { key: 'deadlines' as const, label: '截止日', icon: 'alert-circle-outline' },
            { key: 'plan' as const, label: '讀書計劃', icon: 'book-outline' },
            { key: 'pomodoro' as const, label: '番茄鐘', icon: 'timer-outline' },
          ].map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setActiveTab(tab.key);
              }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                paddingVertical: 10,
                borderRadius: theme.radius.sm,
                backgroundColor: activeTab === tab.key ? theme.colors.accent : 'transparent',
              }}
            >
              <Ionicons
                name={tab.icon as any}
                size={16}
                color={activeTab === tab.key ? '#fff' : theme.colors.textSecondary}
              />
              <Text
                style={{
                  color: activeTab === tab.key ? '#fff' : theme.colors.textSecondary,
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? '700' : '500',
                }}
              >
                {tab.label}
              </Text>
              {tab.key === 'deadlines' && deadlines.length > 0 && (
                <View
                  style={{
                    backgroundColor: activeTab === tab.key ? '#fff' : theme.colors.danger,
                    borderRadius: 8,
                    minWidth: 16,
                    height: 16,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginLeft: 2,
                  }}
                >
                  <Text
                    style={{
                      color: activeTab === tab.key ? theme.colors.accent : '#fff',
                      fontSize: 10,
                      fontWeight: '700',
                    }}
                  >
                    {deadlines.length}
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === 'deadlines' && (
          <DeadlineSection
            deadlines={deadlines}
            onComplete={handleCompleteDeadline}
            onOpenDeadline={openDeadlineInLearn}
          />
        )}
        {activeTab === 'plan' && (
          <StudyPlanSection
            plans={studyPlans}
            onRegenerate={async () => {
              const plans = await generateStudyPlan();
              setStudyPlans(plans);
            }}
          />
        )}
        {activeTab === 'pomodoro' && (
          <PomodoroSection
            stats={pomodoroStats}
            active={pomodoroActive}
            remaining={pomodoroRemaining}
            onStart={startTimer}
            onStop={stopTimer}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Week Summary ───────────────────────────────────────

function WeekSummaryCard({ weekView }: { weekView: WeekView }) {
  const { weekSummary, days } = weekView;

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
          fontSize: 16,
          fontWeight: '700',
          marginBottom: theme.space.md,
        }}
      >
        本週概覽
      </Text>

      {/* Day bars */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: theme.space.md,
        }}
      >
        {days.map((day, i) => {
          const maxMin = Math.max(...days.map((d) => d.classMinutes + d.studyMinutes), 1);
          const total = day.classMinutes + day.studyMinutes;
          const barH = Math.max(4, (total / maxMin) * 60);
          return (
            <View key={i} style={{ alignItems: 'center', flex: 1 }}>
              <View style={{ height: 60, justifyContent: 'flex-end', marginBottom: 4 }}>
                <View
                  style={{
                    width: 20,
                    height: barH,
                    borderRadius: 4,
                    backgroundColor: day.isToday ? theme.colors.accent : theme.colors.border,
                    overflow: 'hidden',
                  }}
                >
                  {day.classMinutes > 0 && (
                    <View
                      style={{
                        height: `${(day.classMinutes / total) * 100}%` as any,
                        backgroundColor: day.isToday ? theme.colors.accent : '#007AFF',
                      }}
                    />
                  )}
                </View>
              </View>
              <Text
                style={{
                  color: day.isToday ? theme.colors.accent : theme.colors.textSecondary,
                  fontSize: 11,
                  fontWeight: day.isToday ? '700' : '400',
                }}
              >
                {DAY_LABELS[day.dayOfWeek]}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        {[
          { label: '上課', value: `${weekSummary.totalClassHours}h`, color: '#007AFF' },
          { label: '自習', value: `${weekSummary.totalStudyHours}h`, color: '#34C759' },
          { label: '待辦', value: `${weekSummary.upcomingDeadlines}`, color: '#FF3B30' },
        ].map((s) => (
          <View key={s.label} style={{ alignItems: 'center' }}>
            <Text style={{ color: s.color, fontSize: 18, fontWeight: '800' }}>{s.value}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Deadlines ──────────────────────────────────────────

function DeadlineSection({
  deadlines,
  onComplete,
  onOpenDeadline,
}: {
  deadlines: Deadline[];
  onComplete: (id: string) => void;
  onOpenDeadline?: (d: Deadline) => void;
}) {
  if (deadlines.length === 0) {
    return (
      <View
        style={{
          alignItems: 'center',
          paddingVertical: theme.space.xxl,
          paddingHorizontal: theme.space.xl,
        }}
      >
        <Ionicons name="checkmark-done-circle" size={48} color={theme.colors.success} />
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 16,
            fontWeight: '600',
            marginTop: theme.space.md,
          }}
        >
          沒有待完成的截止日
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginHorizontal: theme.space.lg }}>
      {deadlines.map((d) => {
        const urgent = d.urgencyScore >= 7;
        const hoursLeft = Math.max(0, Math.round(d.remainingHours));
        const timeLabel = hoursLeft < 24 ? `${hoursLeft} 小時` : `${Math.round(hoursLeft / 24)} 天`;

        const hasLmsNav = !!(d.groupId && d.assignmentId);
        const openRow = () => {
          if (hasLmsNav) onOpenDeadline?.(d);
        };

        return (
          <View
            key={d.id}
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space.lg,
              marginBottom: theme.space.sm,
              borderWidth: 1,
              borderColor: urgent ? d.color + '40' : theme.colors.border,
              borderLeftWidth: 4,
              borderLeftColor: d.color,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <Pressable
                onPress={openRow}
                disabled={!hasLmsNav}
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: !hasLmsNav ? 0.85 : pressed ? 0.92 : 1,
                })}
              >
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                  {d.title}
                </Text>
                {d.courseName ? (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {d.courseName}
                  </Text>
                ) : null}
                {hasLmsNav ? (
                  <Text style={{ color: theme.colors.accent, fontSize: 11, marginTop: 4 }}>
                    點一下開啟繳交／測驗
                  </Text>
                ) : null}
              </Pressable>
              <Pressable
                onPress={() => onComplete(d.id)}
                style={({ pressed }) => ({
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  borderWidth: 2,
                  borderColor: theme.colors.success,
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Ionicons name="checkmark" size={16} color={theme.colors.success} />
              </Pressable>
            </View>

            <Pressable onPress={openRow} disabled={!hasLmsNav}>
              <View style={{ flexDirection: 'row', gap: theme.space.md, marginTop: theme.space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color={urgent ? d.color : theme.colors.textSecondary}
                  />
                  <Text
                    style={{
                      color: urgent ? d.color : theme.colors.textSecondary,
                      fontSize: 12,
                      fontWeight: urgent ? '700' : '400',
                    }}
                  >
                    剩 {timeLabel}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="hourglass-outline" size={14} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                    預估 {d.estimatedHours}h
                  </Text>
                </View>
                {/* Urgency bar */}
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <View style={{ height: 4, backgroundColor: theme.colors.border, borderRadius: 2 }}>
                    <View
                      style={{
                        height: 4,
                        width: `${d.urgencyScore * 10}%` as any,
                        backgroundColor: d.color,
                        borderRadius: 2,
                      }}
                    />
                  </View>
                </View>
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ─── Study Plan ─────────────────────────────────────────

function StudyPlanSection({
  plans,
  onRegenerate,
}: {
  plans: StudyPlan[];
  onRegenerate: () => void;
}) {
  const dayLabels = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  const grouped = new Map<number, StudyPlan[]>();
  for (const plan of plans) {
    const existing = grouped.get(plan.dayOfWeek) || [];
    existing.push(plan);
    grouped.set(plan.dayOfWeek, existing);
  }

  return (
    <View style={{ marginHorizontal: theme.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.space.md,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700' }}>
          AI 讀書計劃
        </Text>
        <Pressable
          onPress={onRegenerate}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Ionicons name="refresh" size={16} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.accent, fontSize: 12 }}>重新排程</Text>
        </Pressable>
      </View>

      {plans.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: theme.space.xl }}>
          <Ionicons name="calendar-outline" size={48} color={theme.colors.textSecondary} />
          <Text
            style={{ color: theme.colors.textSecondary, fontSize: 14, marginTop: theme.space.md }}
          >
            尚無讀書計劃，點擊上方重新排程
          </Text>
        </View>
      ) : (
        Array.from(grouped.entries())
          .sort(([a], [b]) => a - b)
          .map(([day, dayPlans]) => (
            <View key={day} style={{ marginBottom: theme.space.md }}>
              <Text
                style={{
                  color: theme.colors.accent,
                  fontSize: 14,
                  fontWeight: '700',
                  marginBottom: theme.space.sm,
                }}
              >
                {dayLabels[day]}
              </Text>
              {dayPlans.map((plan) => (
                <View
                  key={plan.id}
                  style={{
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.md,
                    padding: theme.space.md,
                    marginBottom: theme.space.xs,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderLeftWidth: 3,
                    borderLeftColor: '#34C759',
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>
                      {plan.courseName}
                    </Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                      {plan.startHour}:00 - {plan.endHour}:00
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {plan.description}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 10,
                      marginTop: 4,
                      fontStyle: 'italic',
                    }}
                  >
                    AI: {plan.aiReason}
                  </Text>
                </View>
              ))}
            </View>
          ))
      )}
    </View>
  );
}

// ─── Pomodoro ───────────────────────────────────────────

function PomodoroSection({
  stats,
  active,
  remaining,
  onStart,
  onStop,
}: {
  stats: PomodoroStats | null;
  active: boolean;
  remaining: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const progress = 1 - remaining / (25 * 60);

  return (
    <View style={{ marginHorizontal: theme.space.lg }}>
      {/* Timer */}
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.space.xl,
          marginBottom: theme.space.lg,
          borderWidth: 1,
          borderColor: active ? theme.colors.accent + '50' : theme.colors.border,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 160,
            height: 160,
            borderRadius: 80,
            borderWidth: 8,
            borderColor: active ? theme.colors.accent + '30' : theme.colors.border,
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {active && (
            <View
              style={{
                position: 'absolute',
                width: 160,
                height: 160,
                borderRadius: 80,
                borderWidth: 8,
                borderColor: theme.colors.accent,
                borderTopColor: 'transparent',
                borderRightColor: 'transparent',
                transform: [{ rotate: `${progress * 360}deg` }],
              }}
            />
          )}
          <Text
            style={{
              color: active ? theme.colors.accent : theme.colors.text,
              fontSize: 42,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}
          >
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
            {active ? '專注中...' : '準備開始'}
          </Text>
        </View>

        <Pressable
          onPress={active ? onStop : onStart}
          style={({ pressed }) => ({
            backgroundColor: active ? theme.colors.danger : theme.colors.accent,
            borderRadius: theme.radius.full,
            paddingHorizontal: 32,
            paddingVertical: 14,
            marginTop: theme.space.lg,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            {active ? '停止' : '開始專注 25 分鐘'}
          </Text>
        </Pressable>
      </View>

      {/* Stats */}
      {stats && (
        <View
          style={{
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
              fontSize: 16,
              fontWeight: '700',
              marginBottom: theme.space.md,
            }}
          >
            番茄鐘統計
          </Text>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              marginBottom: theme.space.lg,
            }}
          >
            {[
              {
                label: '今日',
                value: `${stats.todaySessions}`,
                sub: `${stats.todayMinutes}分鐘`,
                color: theme.colors.accent,
              },
              {
                label: '本週',
                value: `${stats.weekSessions}`,
                sub: `${stats.weekMinutes}分鐘`,
                color: '#007AFF',
              },
              { label: '連續', value: `${stats.streak}天`, sub: '', color: '#FF9500' },
            ].map((s) => (
              <View key={s.label} style={{ alignItems: 'center' }}>
                <Text style={{ color: s.color, fontSize: 22, fontWeight: '800' }}>{s.value}</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{s.label}</Text>
                {s.sub && <Text style={{ color: theme.colors.muted, fontSize: 10 }}>{s.sub}</Text>}
              </View>
            ))}
          </View>

          {stats.subjectBreakdown.length > 0 && (
            <View>
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 14,
                  fontWeight: '600',
                  marginBottom: theme.space.sm,
                }}
              >
                科目分佈
              </Text>
              {stats.subjectBreakdown.slice(0, 5).map((s, i) => {
                const maxMin = stats.subjectBreakdown[0]?.minutes || 1;
                return (
                  <View
                    key={i}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}
                  >
                    <Text
                      style={{ color: theme.colors.text, fontSize: 12, width: 80 }}
                      numberOfLines={1}
                    >
                      {s.subject}
                    </Text>
                    <View
                      style={{
                        flex: 1,
                        height: 8,
                        backgroundColor: theme.colors.border,
                        borderRadius: 4,
                      }}
                    >
                      <View
                        style={{
                          height: 8,
                          width: `${(s.minutes / maxMin) * 100}%` as any,
                          backgroundColor: theme.colors.accent,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: 11,
                        width: 40,
                        textAlign: 'right',
                      }}
                    >
                      {s.minutes}m
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
