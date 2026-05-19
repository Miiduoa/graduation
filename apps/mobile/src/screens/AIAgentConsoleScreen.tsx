/**
 * AI Agent Console — AI 自動代理駕駛室
 *
 * 5 角色都共用這個 screen。從 cockpit hero 點進來。
 *
 * 上方：autonomy mode 三段切換（assistive / collaborative / autonomous）
 * 4 section：
 *   - 🟡 待你批准（awaiting_approval）
 *   - 🟢 執行中（executing / verifying）
 *   - ✅ 今日已完成（done）
 *   - ❌ 失敗 / 拒絕（failed / rejected）
 *
 * 底部：「+ 新增 AI 任務」依角色顯示可用 intents
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, Alert, LayoutAnimation, Platform, UIManager,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
} from '../ui/cockpitShell';
import {
  type ActionPlan,
  type AgentRole,
  type AutonomyMode,
  approve,
  cancel,
  executeAll,
  listAvailableIntents,
  loadAllPlans,
  loadAutonomyMode,
  plan,
  reject,
  savePlan,
  saveAutonomyMode,
  shouldRequireApproval,
  summarizeToday,
} from '../services/aiAgentRuntime';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function inferRoleFromUid(uid?: string | null): AgentRole {
  if (!uid) return 'student';
  if (uid.startsWith('demo_teacher')) return 'teacher';
  if (uid.startsWith('demo_ta')) return 'ta';
  if (uid.startsWith('demo_admin')) return 'department';
  if (uid.startsWith('demo_cafeteria') || uid.startsWith('demo_vendor')) return 'vendor';
  return 'student';
}

const STATUS_META: Record<string, { emoji: string; label: string; color: string }> = {
  planning: { emoji: '⚙️', label: '規劃中', color: theme.colors.muted },
  awaiting_approval: { emoji: '🟡', label: '待批准', color: theme.colors.warning },
  executing: { emoji: '🟢', label: '執行中', color: theme.colors.accent },
  verifying: { emoji: '🔍', label: 'AI 自我審計', color: theme.colors.accent },
  done: { emoji: '✅', label: '已完成', color: theme.colors.success },
  failed: { emoji: '❌', label: '失敗', color: theme.colors.danger },
  rejected: { emoji: '🚫', label: '已拒絕', color: theme.colors.muted },
  cancelled: { emoji: '⛔', label: '已取消', color: theme.colors.muted },
};

const MODE_META: Record<AutonomyMode, { label: string; desc: string; emoji: string }> = {
  assistive: { label: '完全詢問', desc: '每一步都問你', emoji: '🛡' },
  collaborative: { label: '協作模式', desc: '低風險自動、高風險詢問', emoji: '🤝' },
  autonomous: { label: '全自動', desc: '全部自動跑、事後審計', emoji: '🚀' },
};

export default function AIAgentConsoleScreen() {
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  const role: AgentRole = inferRoleFromUid(auth.user?.uid);

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<ActionPlan[]>([]);
  const [mode, setMode] = useState<AutonomyMode>('collaborative');
  const [openSection, setOpenSection] = useState<'awaiting' | 'executing' | 'done' | 'failed' | 'add'>('awaiting');

  const reload = useCallback(async () => {
    if (!auth.user?.uid) return;
    const [pl, md] = await Promise.all([
      loadAllPlans(auth.user.uid, auth.profile?.schoolId ?? null),
      loadAutonomyMode(auth.user.uid, auth.profile?.schoolId ?? null),
    ]);
    setPlans(pl);
    setMode(md);
    setLoading(false);
  }, [auth.user?.uid, auth.profile?.schoolId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? 'awaiting' : k);
  };

  const summary = useMemo(() => summarizeToday(plans), [plans]);
  const availableIntents = useMemo(() => listAvailableIntents(role), [role]);

  const updatePlan = useCallback(async (updated: ActionPlan) => {
    if (!auth.user?.uid) return;
    await savePlan(auth.user.uid, updated, auth.profile?.schoolId ?? null);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPlans((prev) => {
      const idx = prev.findIndex((p) => p.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [updated, ...prev];
    });
  }, [auth.user?.uid, auth.profile?.schoolId]);

  const handleAddIntent = useCallback(async (intent: string) => {
    if (!auth.user?.uid) return;
    try {
      const newPlan = plan(intent, role, {
        uid: auth.user.uid,
        displayName: auth.profile?.displayName ?? '',
      });
      // 依 autonomy mode 決定下一步
      if (shouldRequireApproval(newPlan, mode)) {
        newPlan.status = 'awaiting_approval';
        await updatePlan(newPlan);
        setOpenSection('awaiting');
        Alert.alert('🤖 AI 已準備好 plan', `「${newPlan.title}」\n\n等你批准後 AI 才會開始執行。`);
      } else {
        // 直接跑
        newPlan.status = 'executing';
        await updatePlan(newPlan);
        setOpenSection('executing');
        const done = await executeAll(newPlan);
        await updatePlan(done);
        Alert.alert(
          done.status === 'done' ? '✅ AI 已完成' : '⚠️ 執行未完成',
          `${done.title}\n\n${done.verify?.summary ?? ''}`,
        );
      }
    } catch (e) {
      Alert.alert('AI Agent 失敗', String(e));
    }
  }, [auth.user?.uid, auth.profile?.displayName, role, mode, updatePlan]);

  const handleApprove = useCallback(async (p: ActionPlan) => {
    const updated = approve({ ...p });
    await updatePlan(updated);
    const done = await executeAll(updated);
    await updatePlan(done);
    Alert.alert(
      done.status === 'done' ? '✅ AI 已完成' : '⚠️ 執行未完成',
      `${done.title}\n\n${done.verify?.summary ?? ''}`,
    );
  }, [updatePlan]);

  const handleReject = useCallback(async (p: ActionPlan) => {
    const updated = reject({ ...p }, '使用者覺得 plan 不合適');
    await updatePlan(updated);
  }, [updatePlan]);

  const handleSetMode = useCallback(async (m: AutonomyMode) => {
    if (!auth.user?.uid) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMode(m);
    await saveAutonomyMode(auth.user.uid, m, auth.profile?.schoolId ?? null);
  }, [auth.user?.uid, auth.profile?.schoolId]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const awaitingPlans = plans.filter((p) => p.status === 'awaiting_approval');
  const executingPlans = plans.filter((p) => p.status === 'executing' || p.status === 'verifying' || p.status === 'planning');
  const donePlans = plans.filter((p) => p.status === 'done').slice(0, 10);
  const failedPlans = plans.filter((p) => p.status === 'failed' || p.status === 'rejected' || p.status === 'cancelled').slice(0, 5);

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
          eyebrow={`AI Agent · ${role}`}
          title={summary.doneCount > 0 ? `今日已代你完成 ${summary.doneCount} 件` : '🤖 AI Agent 待命中'}
          summary={summary.lastDoneTitle ? `最近：${summary.lastDoneTitle}` : '從下方挑一個任務讓 AI 代你跑'}
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="✅ 完成" value={summary.doneCount} tone={summary.doneCount > 0 ? 'success' : undefined} />
          <CockpitMetricChip label="🟡 待批准" value={summary.awaitingApprovalCount} tone={summary.awaitingApprovalCount > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="🟢 執行中" value={summary.pendingCount} />
          <CockpitMetricChip label="❌ 失敗" value={summary.failedCount} tone={summary.failedCount > 0 ? 'danger' : undefined} />
        </CockpitMetricRow>

        {/* Autonomy Mode 三段 */}
        <View style={{ marginTop: theme.space.md, marginBottom: theme.space.sm }}>
          <Text style={{
            fontSize: theme.typography.labelSmall.fontSize,
            color: theme.colors.muted,
            fontWeight: '600',
            marginBottom: theme.space.xs,
          }}>
            自動程度設定（Autonomy Mode）
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space.xs + 2 }}>
            {(['assistive', 'collaborative', 'autonomous'] as AutonomyMode[]).map((m) => {
              const active = mode === m;
              const meta = MODE_META[m];
              return (
                <Pressable
                  key={m}
                  onPress={() => handleSetMode(m)}
                  style={({ pressed }) => ({
                    flex: 1,
                    padding: theme.space.sm,
                    borderRadius: theme.radius.md,
                    backgroundColor: active ? theme.colors.accent : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                    alignItems: 'center',
                  })}
                >
                  <Text style={{ fontSize: 22, marginBottom: 2 }}>{meta.emoji}</Text>
                  <Text style={{
                    color: active ? theme.colors.onAccent : theme.colors.text,
                    fontSize: theme.typography.labelSmall.fontSize,
                    fontWeight: '700',
                  }}>
                    {meta.label}
                  </Text>
                  <Text style={{
                    color: active ? theme.colors.onAccent : theme.colors.muted,
                    fontSize: 10,
                    marginTop: 2,
                    textAlign: 'center',
                  }}>
                    {meta.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ marginTop: theme.space.sm }}>
          {/* 待批准 */}
          {awaitingPlans.length > 0 && (
            <CockpitSection
              label="🟡 AI 已 plan 好，等你批准"
              count={awaitingPlans.length}
              open={openSection === 'awaiting'}
              onToggle={() => toggle('awaiting')}
            >
              {awaitingPlans.map((p) => <PlanCard key={p.id} plan={p} onApprove={() => handleApprove(p)} onReject={() => handleReject(p)} />)}
            </CockpitSection>
          )}

          {/* 執行中 */}
          {executingPlans.length > 0 && (
            <CockpitSection
              label="🟢 AI 執行中"
              count={executingPlans.length}
              open={openSection === 'executing'}
              onToggle={() => toggle('executing')}
            >
              {executingPlans.map((p) => <PlanCard key={p.id} plan={p} />)}
            </CockpitSection>
          )}

          {/* 已完成 */}
          <CockpitSection
            label="✅ 今日已完成"
            count={donePlans.length}
            open={openSection === 'done'}
            onToggle={() => toggle('done')}
          >
            {donePlans.length === 0 ? (
              <CockpitRow title="目前還沒有完成的任務" subtitle="從下方挑一個讓 AI 代你跑" />
            ) : (
              donePlans.map((p) => <PlanCard key={p.id} plan={p} />)
            )}
          </CockpitSection>

          {/* 失敗 / 拒絕 */}
          {failedPlans.length > 0 && (
            <CockpitSection
              label="❌ 失敗 / 已拒絕"
              count={failedPlans.length}
              open={openSection === 'failed'}
              onToggle={() => toggle('failed')}
            >
              {failedPlans.map((p) => <PlanCard key={p.id} plan={p} />)}
            </CockpitSection>
          )}

          {/* + 新增 AI 任務 */}
          <CockpitSection
            label="+ 新增 AI 代理任務"
            count={availableIntents.length}
            open={openSection === 'add'}
            onToggle={() => toggle('add')}
          >
            {availableIntents.length === 0 ? (
              <CockpitRow title="這個角色暫無可代理任務" />
            ) : (
              availableIntents.map((it) => (
                <CockpitRow
                  key={it.intent}
                  icon="🤖"
                  title={it.title}
                  subtitle={it.summary}
                  onPress={() => handleAddIntent(it.intent)}
                />
              ))
            )}
          </CockpitSection>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 單張 Plan 卡片 ──
function PlanCard(props: { plan: ActionPlan; onApprove?: () => void; onReject?: () => void }) {
  const { plan: p, onApprove, onReject } = props;
  const meta = STATUS_META[p.status] ?? STATUS_META.planning;
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((e) => !e);
      }}
      style={({ pressed }) => ({
        padding: theme.space.sm,
        marginVertical: theme.space.xs,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        borderLeftWidth: 4,
        borderLeftColor: meta.color,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Text style={{ fontSize: 18, marginRight: 6 }}>{meta.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{
              color: theme.colors.text,
              fontWeight: '700',
              fontSize: theme.typography.body.fontSize,
            }} numberOfLines={1}>
              {p.title}
            </Text>
            <Text style={{
              color: meta.color,
              fontSize: theme.typography.labelSmall.fontSize,
              fontWeight: '600',
              marginTop: 2,
            }}>
              {meta.label} · {p.steps.length} 步驟 · 預計 {p.estimateMinutes} 分鐘 · risk {p.risk}
            </Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.muted} />
      </View>

      <Text style={{
        color: theme.colors.text,
        fontSize: theme.typography.bodySmall.fontSize,
        marginTop: 4,
        lineHeight: 18,
      }} numberOfLines={expanded ? undefined : 2}>
        {p.summary}
      </Text>

      {expanded && (
        <View style={{ marginTop: theme.space.sm }}>
          {p.steps.map((s, idx) => {
            const result = p.results[idx];
            const sMeta = STATUS_META[result?.status === 'pending' ? 'planning' : (result?.status === 'success' ? 'done' : (result?.status === 'failed' ? 'failed' : 'executing'))];
            return (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 6 }}>
                <Text style={{ fontSize: 14 }}>{sMeta.emoji}</Text>
                <Text style={{
                  color: theme.colors.text,
                  fontSize: theme.typography.labelSmall.fontSize,
                  flex: 1,
                }} numberOfLines={2}>
                  {idx + 1}. {s.description}
                </Text>
                <Text style={{
                  color: theme.colors.muted,
                  fontSize: 10,
                }}>
                  {s.risk}
                </Text>
              </View>
            );
          })}

          {p.verify && (
            <View style={{
              marginTop: theme.space.sm,
              padding: theme.space.sm,
              borderRadius: theme.radius.sm,
              backgroundColor: p.verify.success ? '#D1FAE5' : '#FEE2E2',
            }}>
              <Text style={{
                color: p.verify.success ? theme.colors.success : theme.colors.danger,
                fontSize: theme.typography.labelSmall.fontSize,
                fontWeight: '700',
              }}>
                🔍 AI 自我審計（confidence {p.verify.confidence}%）
              </Text>
              <Text style={{
                color: theme.colors.text,
                fontSize: theme.typography.labelSmall.fontSize,
                marginTop: 4,
              }}>
                {p.verify.summary}
              </Text>
            </View>
          )}

          {p.status === 'awaiting_approval' && (
            <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginTop: theme.space.sm }}>
              <Pressable
                onPress={onReject}
                style={({ pressed }) => ({
                  flex: 1,
                  padding: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceMuted,
                  alignItems: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: theme.colors.danger, fontWeight: '600' }}>拒絕</Text>
              </Pressable>
              <Pressable
                onPress={onApprove}
                style={({ pressed }) => ({
                  flex: 2,
                  padding: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accent,
                  alignItems: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>✅ 批准 AI 開始執行</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}
