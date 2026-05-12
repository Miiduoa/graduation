/**
 * useAIBrain — React Hook for AI Brain Hub
 * ═══════════════════════════════════════════════════════════════════════
 * 任何畫面都可以呼叫此 hook 拿到 AI 的當下「理解」與動作能力。
 *
 *   const brain = useAIBrain();
 *   brain.snapshot           // 即時資料 + 學習狀態 + 洞察
 *   brain.describe()         // 一句話：AI 目前知道你什麼
 *   brain.ask(message)       // 自主規劃 + 執行
 *   brain.observe({ ... })   // 把任何使用者互動回灌學習
 *   brain.proposePlan(...)   // 建立一個動作計畫
 *   brain.confirmPendingPlan(planId)  // 使用者確認後執行
 *   brain.feedback({ positive: true }) // 對 AI 建議回饋
 *
 * 同時負責 Brain 生命週期（在 AppNavigation 內掛一次即可）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  aiBrain,
  type AskOptions,
  type AskResult,
  type BrainSnapshot,
} from '../services/aiBrain';
import type {
  ActionExecutionReport,
  ActionPlan,
  ActionStep,
  BrainInsight,
  LearningInteraction,
  LearningSnapshot,
  FeedbackPayload,
} from '../services/aiBrain';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useDataSource } from '../hooks/useDataSource';
import type { CampusActorRole } from '../data';

export interface UseAIBrainResult {
  snapshot: BrainSnapshot;
  insights: BrainInsight[];
  learning: LearningSnapshot | null;
  ready: boolean;
  /** 給 UI 顯示「AI 目前理解你什麼」 */
  describe: () => string;
  /** 統一 ask 入口 */
  ask: (message: string, opts?: AskOptions) => Promise<AskResult>;
  /** 規劃多步驟動作 */
  proposePlan: (input: {
    goal: string;
    steps: Omit<ActionStep, 'id' | 'risk'>[];
    userMessage?: string;
  }) => ActionPlan;
  /** 使用者確認後執行高風險 plan */
  confirmPendingPlan: (planId: string) => Promise<ActionExecutionReport | null>;
  /** 不經過 plan、直接執行（高風險自動 gate） */
  runPlan: (plan: ActionPlan, opts?: { userConfirmed?: boolean }) => Promise<ActionExecutionReport>;
  /** 強制刷新 ambient 資料 */
  refresh: (reason?: string) => Promise<void>;
  /** 強制跑一次主動思考 */
  rethink: () => Promise<BrainInsight[]>;
  /** 丟掉一張洞察卡片 */
  dismissInsight: (id: string) => void;
  /** 任何 Screen 都能 push 學習素材 */
  observe: (interaction: LearningInteraction) => void;
  /** 回饋 AI 建議 */
  feedback: (payload: FeedbackPayload) => void;
  /** 工具風險分類 */
  classifyToolRisk: typeof aiBrain.classifyToolRisk;
}

const SUPPORTED_ROLES: ReadonlySet<CampusActorRole> = new Set([
  'student',
  'teacher',
  'staff',
  'department',
  'department_head',
  'admin',
  'school',
  'vendor',
]);

function normalizeRole(role: unknown): CampusActorRole | undefined {
  if (typeof role !== 'string') return undefined;
  if (SUPPORTED_ROLES.has(role as CampusActorRole)) return role as CampusActorRole;
  if (role === 'departmentAdmin') return 'department_head';
  if (role === 'faculty') return 'teacher';
  if (role === 'shopOwner') return 'vendor';
  return undefined;
}

export function useAIBrain(): UseAIBrainResult {
  const auth = useAuth();
  const { school } = useSchool();
  const dataSource = useDataSource();
  const [snapshot, setSnapshot] = useState<BrainSnapshot>(() => aiBrain.getSnapshot());

  useEffect(() => {
    const unsubscribe = aiBrain.subscribe((next) => setSnapshot(next));
    return unsubscribe;
  }, []);

  // 啟動 / 同步 context
  useEffect(() => {
    const role = normalizeRole(auth.profile?.role);
    const ctx = {
      userId: auth.user?.uid ?? null,
      schoolId: school?.id ?? null,
      role,
      dataSource,
    };
    void aiBrain.start(ctx);
  }, [auth.user?.uid, auth.profile?.role, school?.id, dataSource]);

  // 登出時停止
  useEffect(() => {
    return () => {
      // 不在 unmount 時停止：Brain 為 singleton；只在 user/school 切換時 updateContext
    };
  }, []);

  const ready = useMemo(() => Boolean(snapshot.context.userId), [snapshot.context.userId]);

  const describe = useCallback(() => aiBrain.describeUnderstanding(), []);
  const ask = useCallback(
    (message: string, opts?: AskOptions) => aiBrain.ask(message, opts),
    [],
  );
  const proposePlan = useCallback(
    (input: { goal: string; steps: Omit<ActionStep, 'id' | 'risk'>[]; userMessage?: string }) =>
      aiBrain.proposePlan(input),
    [],
  );
  const confirmPendingPlan = useCallback(
    (id: string) => aiBrain.confirmPendingPlan(id),
    [],
  );
  const runPlan = useCallback(
    (plan: ActionPlan, opts?: { userConfirmed?: boolean }) => aiBrain.runPlan(plan, opts),
    [],
  );
  const refresh = useCallback((reason?: string) => aiBrain.refresh(reason), []);
  const rethink = useCallback(() => aiBrain.rethink(), []);
  const dismissInsight = useCallback((id: string) => aiBrain.dismissInsight(id), []);
  const observe = useCallback(
    (interaction: LearningInteraction) => aiBrain.observe(interaction),
    [],
  );
  const feedback = useCallback((payload: FeedbackPayload) => aiBrain.feedback(payload), []);
  const classifyToolRisk = useCallback(
    (tool: string) => aiBrain.classifyToolRisk(tool),
    [],
  );

  return {
    snapshot,
    insights: snapshot.insights,
    learning: snapshot.learning,
    ready,
    describe,
    ask,
    proposePlan,
    confirmPendingPlan,
    runPlan,
    refresh,
    rethink,
    dismissInsight,
    observe,
    feedback,
    classifyToolRisk,
  };
}

/**
 * usePendingActionPlans — 訂閱目前所有「需要使用者確認」的 plan
 * 通常用於 App root 上的全域 ConfirmModal，會接收到全部 pending plans。
 */
export function usePendingActionPlans(): {
  pendingPlans: ActionPlan[];
  confirm: (planId: string) => Promise<unknown>;
  dismiss: (planId: string) => void;
} {
  const [pendingPlans, setPendingPlans] = useState<ActionPlan[]>(() =>
    aiBrain.listPendingPlans(),
  );
  useEffect(() => {
    const unsubscribe = aiBrain.subscribePendingPlans(setPendingPlans);
    return unsubscribe;
  }, []);
  const confirm = useCallback((id: string) => aiBrain.confirmPendingPlan(id), []);
  const dismiss = useCallback((id: string) => aiBrain.dismissPendingPlan(id), []);
  return { pendingPlans, confirm, dismiss };
}

/**
 * 在 App root 掛一次的 lifecycle 版本（無回傳值）。
 * 使用 useAIBrain 即可，這個是給只想「啟動 Brain」但不在意 snapshot 的場景。
 */
export function useAIBrainLifecycle(): void {
  useAIBrain();
}
