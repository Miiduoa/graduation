/**
 * AI Agent Observatory — AI 大腦觀察台
 *
 * 把背景 AI 的「思考 / 學習 / 代理 / 自我反思」公開化，讓 user 看到 demo。
 *
 *  四大區塊：
 *  1. 🧠 思考鏈 — 觀察 → 推論 → 權衡 → 排序候選動作 + 解釋
 *  2. 🎯 代理建議 — proactiveAIAgent 最新一輪 scan 結果（top N）
 *  3. 📊 學習軌跡 — interaction history → preference profile + discovered patterns
 *  4. 🔁 自我反思 — selfReflect() 輸出 + 顯示哪些 pattern 已被 AI 吸收
 *
 *  操作：
 *  - 「立即跑一次掃描」按鈕 → runProactiveScan + show result
 *  - 「我接受 / 我拒絕」每個 suggestion → recordInteraction → 影響 preference profile
 *  - 「kill switch」 → 暫停 AI 自動動作
 *
 *  目的：對 demo / 口試清楚秀出 AI 真的在「思考 + 學習 + 突破自己」。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

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
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { safeNavigate } from '../utils/safeNavigate';
import {
  simulateTeacherGrade,
  simulateStudentSubmit,
  simulateTeacherOpenAttendance,
  simulateStudentOrderFood,
  simulateDepartmentBroadcast,
  simulateVendorAdvanceOrder,
  simulateFullGradingCycle,
} from '../services/demoActionSimulator';
import {
  runProactiveScan,
  type ProactiveSuggestion,
  type ProactiveScanInput,
} from '../services/proactiveAIAgent';
import {
  observeStudentState,
  inferConcerns,
  detectTradeoffs,
  rankActions,
  explainChain,
  type StateSignal,
  type Observation,
  type Concern,
} from '../services/aiThinking';
import {
  recordInteraction,
  loadInteractionHistory,
  computePreferenceProfile,
  discoverPatterns,
  selfReflect,
  type InteractionEvent,
} from '../services/aiLearning';
import {
  getKillSwitch,
  setKillSwitch,
  loadAuditLog,
  type AuditLogEntry,
} from '../services/aiSkillApplicator';
import { loadRoleEventInbox, type RoleEvent } from '../services/roleEventBus';

import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoScoreItemsByCourse,
} from '../data/demoCoursesMock';

// ─────────────────────────────────────────────────────────
// 從 demo data 建出真實 signal（供 AI 思考）
// ─────────────────────────────────────────────────────────
function buildDemoSignals(): StateSignal[] {
  const signals: StateSignal[] = [];
  const now = Date.now();

  for (const c of DEMO_COURSES) {
    const hws = getDemoHomeworksByCourse(c.id);
    const overdue = hws.filter((h) => !h.submitted && new Date(h.dueAt).getTime() < now).length;
    const dueSoon = hws.filter((h) => !h.submitted && new Date(h.dueAt).getTime() - now < 24 * 3600_000).length;
    const items = getDemoScoreItemsByCourse(c.id);
    const graded = items.filter((s) => s.studentScore !== null);
    const avg = graded.length > 0
      ? graded.reduce((a, b) => a + (b.studentScore! / b.totalScore) * 100, 0) / graded.length
      : null;

    if (overdue > 0) {
      signals.push({
        domain: 'homework',
        fact: `${c.name} 已逾期 ${overdue} 份作業`,
        weight: 80,
        payload: { courseId: c.id, overdue },
      });
    }
    if (dueSoon > 0) {
      signals.push({
        domain: 'homework',
        fact: `${c.name} 24h 內到期 ${dueSoon} 份`,
        weight: 60,
        payload: { courseId: c.id, dueSoon },
      });
    }
    if (avg !== null && avg < 70) {
      signals.push({
        domain: 'grade',
        fact: `${c.name} 目前平均 ${Math.round(avg)}% 偏低`,
        weight: 70,
        payload: { courseId: c.id, avg },
      });
    }
  }

  return signals;
}

export default function AIAgentObservatoryScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const profile = auth.profile;
  const bottomPad = useTabBarContentBottomPadding();

  const [loading, setLoading] = useState(false);
  const [openSection, setOpenSection] = useState<
    'thinking' | 'suggestions' | 'learning' | 'reflect' | 'audit' | 'events' | null
  >('thinking');
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [recentEvents, setRecentEvents] = useState<RoleEvent<unknown>[]>([]);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [explanation, setExplanation] = useState<string>('');
  const [history, setHistory] = useState<InteractionEvent[]>([]);
  const [killSwitchOn, setKillSwitchOnLocal] = useState(false);

  const toggle = (k: typeof openSection) => setOpenSection(openSection === k ? null : k);

  // ── 思考 + 推論 ──
  const runThinking = useCallback(() => {
    const signals = buildDemoSignals();
    const obs = observeStudentState(signals);
    const con = inferConcerns(obs);
    setObservations(obs);
    setConcerns(con);

    // 候選 action 對齊 CandidateAction 介面
    const candidates = [
      {
        id: 'submit_overdue',
        description: '立刻補交逾期作業',
        benefit: 80,
        cost: 60,
        urgency: 90,
        domain: 'homework',
      },
      {
        id: 'short_break_then_focus',
        description: '先短休 + 番茄專注',
        benefit: 55,
        cost: 30,
        urgency: 50,
        domain: 'self_care',
      },
      {
        id: 'defer_or_accept_zero',
        description: '推遲 / 接受 0 分',
        benefit: 0,
        cost: 0,
        urgency: 10,
        domain: 'homework',
      },
    ];
    const chain = explainChain({ signals, candidates });
    setExplanation(chain.narrative.join('\n\n'));
  }, []);

  // ── proactive scan ──
  const runScan = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const role = (profile?.role === 'teacher'
        ? 'teacher'
        : profile?.role === 'admin'
          ? 'department'
          : profile?.role === 'staff'
            ? uid.startsWith('demo_cafeteria') ? 'vendor' : 'ta'
            : 'student') as ProactiveScanInput['role'];

      const result = await runProactiveScan({
        uid,
        role,
        schoolId: profile?.schoolId ?? null,
      });
      setSuggestions(result.suggestions);
    } catch (e) {
      Alert.alert('掃描失敗', String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [uid, profile?.role, profile?.schoolId]);

  // ── load learning history ──
  const reloadHistory = useCallback(async () => {
    if (!uid) return;
    const h = await loadInteractionHistory(uid);
    setHistory(h);
    const ks = await getKillSwitch(uid);
    setKillSwitchOnLocal(ks);
    // 同步載入 audit log + 跨角色事件流
    const [log, events] = await Promise.all([
      loadAuditLog(uid).catch(() => [] as AuditLogEntry[]),
      loadRoleEventInbox(uid).catch(() => [] as RoleEvent<unknown>[]),
    ]);
    setAuditLog(log.slice(0, 20));
    setRecentEvents(events.slice(0, 15));
  }, [uid]);

  useEffect(() => {
    runThinking();
    runScan();
    reloadHistory();
  }, [runThinking, runScan, reloadHistory]);

  // ── 執行建議的實際動作（依 suggestion kind 跳對應 screen / emit event）──
  const executeSuggestion = async (s: ProactiveSuggestion) => {
    if (!uid) return;
    try {
      switch (s.kind) {
        case 'urgent_action':
          // 緊急動作可能是繳交作業 / 開點名 / 期限近 — 依 deepLink 或 fallback
          if (s.deepLink?.includes('Attendance')) {
            safeNavigate(navigation, 'AttendanceMultiMethod', undefined, {
              fallbackMessage: '即將跳到智慧簽到',
            });
          } else {
            safeNavigate(navigation, 'CoursesHome', undefined, {
              fallbackMessage: '即將跳到課程列表',
            });
          }
          break;
        case 'mistake_practice':
          safeNavigate(navigation, 'MistakeRepertoire', undefined, {
            fallbackMessage: '即將跳到錯題本',
          });
          break;
        case 'grade_alert':
          safeNavigate(navigation, 'GradeWhatIf', undefined, {
            fallbackMessage: '即將跳到成績試算',
          });
          break;
        case 'teacher_action':
          safeNavigate(navigation, 'TeacherCockpit', undefined, {
            fallbackMessage: '即將跳到教師駕駛艙',
          });
          break;
        case 'vendor_action':
          safeNavigate(navigation, 'TodayHome', undefined, {
            fallbackMessage: '即將跳到 vendor 駕駛艙',
          });
          break;
        case 'department_action':
          safeNavigate(navigation, 'DepartmentDashboard', undefined, {
            fallbackMessage: '即將跳到系所儀表板',
          });
          break;
        case 'study_plan':
          safeNavigate(navigation, 'PomodoroSession', undefined, {
          });
          break;
        case 'inbox_followup':
          safeNavigate(navigation, 'Inbox', undefined, {
            fallbackMessage: '即將跳到 inbox',
          });
          break;
        case 'companion_check':
        case 'celebrate':
        default:
          Alert.alert(s.title, s.body);
      }
    } catch (e) {
      Alert.alert('執行失敗', String(e));
    }
  };

  // ── 我接受 / 我拒絕 一條 suggestion ──
  const reactToSuggestion = async (s: ProactiveSuggestion, reaction: 'accepted' | 'dismissed') => {
    if (!uid) return;
    try {
      const now = new Date();
      await recordInteraction(uid, {
        suggestionId: s.id,
        kind: s.kind,
        hour: now.getHours(),
        dayOfWeek: now.getDay(),
        reaction,
        deltaMs: 0,
      });
      await reloadHistory();
      if (reaction === 'accepted') {
        // 立刻執行對應動作
        await executeSuggestion(s);
      }
    } catch (e) {
      Alert.alert('紀錄失敗', String(e));
    }
  };

  // ── 一鍵示範跨角色串聯：學生繳交 → 老師批改 → 學生看到評語 ──
  const runDemoCycle = async () => {
    if (!uid) return;
    try {
      const result = await simulateFullGradingCycle({
        studentUid: 'demo_student_kuchih',
        studentName: '顧晉瑋',
        teacherUid: 'demo_teacher_chang',
        teacherName: '張怡君',
        courseId: DEMO_COURSES[0].id,
        courseName: DEMO_COURSES[0].name,
        homeworkId: 1,
        homeworkTitle: 'Demo 作業',
        score: 88,
        totalScore: 100,
        feedbackPreview: '整體表現不錯，可在資料一致性處再加強。',
      });
      Alert.alert('✅ 跨角色 demo 完成', result.steps.join('\n\n'));
    } catch (e) {
      Alert.alert('demo 失敗', String((e as Error)?.message ?? e));
    }
  };

  // ── kill switch ──
  const toggleKillSwitch = async () => {
    if (!uid) return;
    const next = !killSwitchOn;
    await setKillSwitch(uid, next);
    setKillSwitchOnLocal(next);
    Alert.alert(
      next ? '🔒 AI 自動行動已停用' : '🤖 AI 自動行動已啟用',
      next ? '只會給建議，不會自動執行' : 'AI 可在 guardrails 內代理動作',
    );
  };

  const profilePref = useMemo(() => computePreferenceProfile(history), [history]);
  const patterns = useMemo(() => discoverPatterns(history), [history]);
  const reflection = useMemo(() => selfReflect(history), [history]);

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
          eyebrow={`AI 觀察台 · ${profile?.role ?? 'guest'}`}
          title="🤖 AI 大腦在做什麼"
          summary="思考 → 推論 → 排序 → 行動 → 學習。每個環節都看得到，並且你可以給回饋。"
        />

        <CockpitMetricRow>
          <CockpitMetricChip
            label="觀察"
            value={observations.length}
            tone={observations.some((o) => o.severity === 'critical') ? 'danger' : undefined}
          />
          <CockpitMetricChip
            label="建議"
            value={suggestions.length}
            tone={suggestions.length > 5 ? 'warn' : undefined}
          />
          <CockpitMetricChip label="學習" value={history.length} />
          <CockpitMetricChip label="模式" value={patterns.length} tone={patterns.length >= 2 ? 'success' : undefined} />
        </CockpitMetricRow>
        <CockpitMetricRow>
          <CockpitMetricChip
            label="自律"
            value={auditLog.filter((a) => a.decision === 'blocked').length}
            tone={auditLog.some((a) => a.decision === 'blocked') ? 'success' : undefined}
          />
          <CockpitMetricChip
            label="自動"
            value={auditLog.filter((a) => a.decision === 'auto_pushed').length}
          />
          <CockpitMetricChip
            label="先問"
            value={auditLog.filter((a) => a.decision === 'asked_user').length}
          />
          <CockpitMetricChip
            label="跨角色"
            value={recentEvents.length}
            tone={recentEvents.length > 0 ? 'success' : undefined}
          />
        </CockpitMetricRow>

        {/* Kill switch */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            marginBottom: theme.space.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600', color: theme.colors.text, fontSize: 14 }}>
              {killSwitchOn ? '🔒 AI 自動行動：關閉' : '🤖 AI 自動行動：啟用'}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
              關閉後 AI 只給建議、不自動代理
            </Text>
          </View>
          <Switch value={killSwitchOn} onValueChange={toggleKillSwitch} />
        </View>

        {/* 立即掃描 + 一鍵 demo 跨角色 */}
        <View style={{ flexDirection: 'row', gap: theme.space.sm, marginBottom: theme.space.lg }}>
          <Pressable
            onPress={async () => {
              runThinking();
              await runScan();
            }}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.space.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.text,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {loading
              ? <ActivityIndicator color={theme.colors.bg} />
              : <Ionicons name="refresh" size={16} color={theme.colors.bg} />}
            <Text style={{ color: theme.colors.bg, fontWeight: '700', fontSize: 14 }}>
              重跑 AI 掃描
            </Text>
          </Pressable>
          <Pressable
            onPress={runDemoCycle}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.space.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="git-network-outline" size={16} color={theme.colors.onAccent} />
            <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>
              跨角色 demo
            </Text>
          </Pressable>
        </View>

        <View>
          {/* 1. 思考鏈 */}
          <CockpitSection
            label="🧠 思考鏈（observation → concern → 動作排序）"
            count={observations.length}
            open={openSection === 'thinking'}
            onToggle={() => toggle('thinking')}
          >
            {observations.length === 0 ? (
              <CockpitRow title="目前沒觀察到值得處理的 signal" subtitle="一切平靜" tone="success" />
            ) : (
              observations.map((o, i) => (
                <CockpitRow
                  key={`obs_${i}`}
                  icon={o.severity === 'critical' ? '🔴' : o.severity === 'high' ? '🟠' : '🟡'}
                  title={o.pattern}
                  subtitle={`涉及：${o.domains.join(', ')}`}
                  tone={o.severity === 'critical' ? 'danger' : o.severity === 'high' ? 'warn' : undefined}
                />
              ))
            )}
            {concerns.length > 0 && (
              <View
                style={{
                  marginTop: theme.space.sm,
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.warning,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                  AI 推論
                </Text>
                {concerns.map((c, i) => (
                  <Text key={`con_${i}`} style={{ fontSize: 13, color: theme.colors.text, lineHeight: 18 }}>
                    • {c.inference} ({c.confidence}% 信心)
                  </Text>
                ))}
              </View>
            )}
            {!!explanation && (
              <View
                style={{
                  marginTop: theme.space.sm,
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                  🪜 思考鏈
                </Text>
                <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 19 }}>
                  {explanation}
                </Text>
              </View>
            )}
          </CockpitSection>

          {/* 2. 代理建議 */}
          <CockpitSection
            label="🎯 主動建議（proactive scan）"
            count={suggestions.length}
            open={openSection === 'suggestions'}
            onToggle={() => toggle('suggestions')}
          >
            {suggestions.length === 0 ? (
              <CockpitRow title="目前 AI 沒有新建議" subtitle="代理 daemon 在 15 分鐘後會再掃" />
            ) : (
              suggestions.slice(0, 8).map((s) => (
                <View key={s.id}>
                  <CockpitRow
                    icon={s.emoji}
                    title={s.title}
                    subtitle={s.body}
                    tone={s.severity === 'critical' ? 'danger' : s.severity === 'high' ? 'warn' : s.severity === 'positive' ? 'success' : undefined}
                  />
                  <View style={{ flexDirection: 'row', gap: theme.space.xs, marginTop: 4, marginBottom: theme.space.sm }}>
                    <Pressable
                      onPress={() => reactToSuggestion(s, 'accepted')}
                      style={({ pressed }) => ({
                        paddingHorizontal: theme.space.sm + 2,
                        paddingVertical: theme.space.xs + 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.success + '20',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '700' }}>
                        ✓ 採納
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => reactToSuggestion(s, 'dismissed')}
                      style={({ pressed }) => ({
                        paddingHorizontal: theme.space.sm + 2,
                        paddingVertical: theme.space.xs + 2,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.surface,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: theme.colors.border,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>
                        🙅 不要
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </CockpitSection>

          {/* 3. 學習軌跡 */}
          <CockpitSection
            label="📊 學習軌跡（從你的反應學）"
            count={history.length}
            open={openSection === 'learning'}
            onToggle={() => toggle('learning')}
          >
            {history.length === 0 ? (
              <CockpitRow title="尚無互動紀錄" subtitle="去上方建議按「採納/不要」開始教 AI" />
            ) : (
              <>
                <CockpitRow
                  icon="📅"
                  title="偏好時段"
                  subtitle={(() => {
                    const best = Object.entries(profilePref.byHourBucket)
                      .filter(([, v]) => v.samples >= 2)
                      .sort((a, b) => b[1].acceptRate - a[1].acceptRate)[0];
                    return best
                      ? `${best[0]} 點時段採納率 ${Math.round(best[1].acceptRate * 100)}%`
                      : '還在觀察中';
                  })()}
                />
                <CockpitRow
                  icon="🎯"
                  title="採納率"
                  subtitle={`${Math.round(profilePref.overall.acceptRate * 100)}% (${profilePref.overall.accepted}/${profilePref.overall.samples})`}
                  tone={profilePref.overall.acceptRate > 0.6 ? 'success' : profilePref.overall.acceptRate < 0.3 ? 'warn' : undefined}
                />
                {patterns.length > 0 && (
                  <View
                    style={{
                      marginTop: theme.space.sm,
                      padding: theme.space.md,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface,
                      borderLeftWidth: 3,
                      borderLeftColor: theme.colors.accent,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                      🪄 AI 發現的 pattern
                    </Text>
                    {patterns.map((p, i) => (
                      <Text key={i} style={{ fontSize: 13, color: theme.colors.text, lineHeight: 18 }}>
                        • {p.pattern} · {p.ruleChange}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            )}
          </CockpitSection>

          {/* 5. Guardrail 審計（自律證明）*/}
          <CockpitSection
            label="🛡 Guardrail 審計（AI 為什麼這次有/沒推）"
            count={auditLog.length}
            open={openSection === 'audit'}
            onToggle={() => toggle('audit')}
          >
            {auditLog.length === 0 ? (
              <CockpitRow
                title="尚無自動行動紀錄"
                subtitle="AI 每次決定要不要主動推送，都會留下審計軌跡"
              />
            ) : (
              auditLog.slice(0, 12).map((entry, idx) => {
                const tone =
                  entry.decision === 'blocked'
                    ? 'warn'
                    : entry.decision === 'auto_pushed'
                      ? 'success'
                      : undefined;
                const icon =
                  entry.decision === 'blocked'
                    ? '🛑'
                    : entry.decision === 'auto_pushed'
                      ? '✅'
                      : '❓';
                const decisionLabel =
                  entry.decision === 'blocked'
                    ? '擋下'
                    : entry.decision === 'auto_pushed'
                      ? '自動推送'
                      : '先問使用者';
                return (
                  <CockpitRow
                    key={`audit_${idx}`}
                    icon={icon}
                    title={`${decisionLabel}：${entry.kind}`}
                    subtitle={`${entry.explanation} · 信心 ${entry.baseConfidence}→${entry.adjustedConfidence}%`}
                    tone={tone}
                  />
                );
              })
            )}
            {auditLog.length > 0 && (
              <View
                style={{
                  marginTop: theme.space.sm,
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.success,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                  7 條 Guardrail 守則
                </Text>
                <Text style={{ fontSize: 12, color: theme.colors.text, lineHeight: 17 }}>
                  G1 每日推播上限 8 · G2 信心 ≥ 60 才 apply · G3 高影響先問{'\n'}
                  G4 4h 內不重推 · G5 22-08 安靜時段 · G6 連 3 拒煞車 · G7 一鍵急停
                </Text>
              </View>
            )}
          </CockpitSection>

          {/* 6. 跨角色事件流 */}
          <CockpitSection
            label="🔗 跨角色事件流（即時聯動）"
            count={recentEvents.length}
            open={openSection === 'events'}
            onToggle={() => toggle('events')}
          >
            {recentEvents.length === 0 ? (
              <CockpitRow
                title="尚未收到跨角色事件"
                subtitle="老師批改、餐廳備餐進度、系所公告會即時推到這裡"
              />
            ) : (
              recentEvents.slice(0, 10).map((e) => {
                const kindIcon: Record<string, string> = {
                  grade_published: '📊',
                  bulk_reminder_sent: '📣',
                  feedback_drafted: '💬',
                  attendance_session_opened: '✋',
                  announcement_posted: '📢',
                  homework_published: '📝',
                  peer_review_assigned: '🔁',
                  homework_submitted: '📥',
                  attendance_checked_in: '✅',
                  discussion_posted: '💭',
                  help_requested: '🆘',
                  order_placed: '🍱',
                  order_status_changed: '🔔',
                  department_broadcast: '🏛',
                };
                const dt = new Date(e.occurredAt);
                const diffMin = Math.max(0, Math.round((Date.now() - dt.getTime()) / 60000));
                const ago = diffMin < 60
                  ? `${diffMin} 分鐘前`
                  : diffMin < 1440
                    ? `${Math.floor(diffMin / 60)} 小時前`
                    : `${Math.floor(diffMin / 1440)} 天前`;
                return (
                  <CockpitRow
                    key={e.id}
                    icon={kindIcon[e.kind] ?? '·'}
                    title={`${e.actorName ?? e.actorUid} · ${e.kind}`}
                    subtitle={`${e.courseName} · ${ago}`}
                  />
                );
              })
            )}
          </CockpitSection>

          {/* 4. 自我反思 */}
          <CockpitSection
            label="🔁 自我反思（突破自己）"
            open={openSection === 'reflect'}
            onToggle={() => toggle('reflect')}
          >
            {reflection.totalInteractions === 0 ? (
              <CockpitRow title="尚未產生反思" subtitle="累積 10+ 互動後 AI 會總結並調整自己" />
            ) : (
              <View
                style={{
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                  marginBottom: theme.space.sm,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>
                  AI 自我評估
                </Text>
                <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 19 }}>
                  累積 {reflection.totalInteractions} 次互動，整體採納率 {Math.round(reflection.acceptRate * 100)}%。
                </Text>
                <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: theme.space.sm, marginBottom: 4 }}>
                  下一輪調整
                </Text>
                <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 19 }}>
                  • {reflection.selfAdjustment}
                </Text>
                {reflection.topPatterns.length > 0 && (
                  <>
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: theme.space.sm, marginBottom: 4 }}>
                      AI 學到的 top patterns
                    </Text>
                    {reflection.topPatterns.map((p, i) => (
                      <Text key={i} style={{ fontSize: 12, color: theme.colors.text, lineHeight: 17 }}>
                        • {p.pattern}（信心 {p.confidence}%）
                      </Text>
                    ))}
                  </>
                )}
              </View>
            )}
          </CockpitSection>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
