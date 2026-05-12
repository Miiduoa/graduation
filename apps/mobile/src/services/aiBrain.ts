/**
 * AI Brain Hub — 統一 AI 入口（Think · Act · Learn · Perceive）
 * ═══════════════════════════════════════════════════════════════════════
 * 整個 App 對 AI 的單一存取點：
 *  - Perceive：透過 AIAmbientAwareness 訂閱即時 app/使用者資料（aiRealtimeSync 加 Firestore 推送）
 *  - Think：呼叫 aiLocalAgent / agentReasoningEngine，產生計畫與草稿
 *  - Act：透過 aiActionCoordinator 編排工具呼叫，含風險閘門
 *  - Learn：所有結果回灌 aiContinualLearning，更新 AgentMemory + LearnedSkills
 *
 * Brain 是 singleton；UI 只需呼叫 `getAIBrain()` 或 `useAIBrain()`。
 */

import type { DataSource } from '../data/source';
import type { CampusActorRole, AssistantChoiceMenu } from '../data';
import {
  getAIAmbientAwarenessSnapshot,
  refreshAIAmbientAwareness,
  subscribeAIAmbientAwareness,
  type AIAmbientAwarenessSnapshot,
} from './aiAppContext';
import { startRealtimeSync, stopRealtimeSync } from './aiRealtimeSync';
import {
  initLearningForUser,
  subscribeLearning,
  observeInteraction,
  recordFeedback,
  recordToolOutcome,
  inferPreferencesFromHistory,
  getSnapshot as getLearningSnapshotInternal,
  clearLearningForUser,
  type FeedbackPayload,
  type LearningInteraction,
  type LearningSnapshot,
} from './aiContinualLearning';
import {
  buildActionPlan,
  classifyRisk,
  executePlan,
  registerPendingPlan,
  consumePendingPlan,
  dismissPendingPlan as dismissPendingPlanInternal,
  listPendingPlans,
  subscribePendingPlans,
  type ActionExecutionContext,
  type ActionExecutionReport,
  type ActionPlan,
  type ActionRisk,
  type ActionStep,
} from './aiActionCoordinator';
import {
  startProactiveThinker,
  stopProactiveThinker,
  subscribeProactiveInsights,
  getProactiveInsights,
  dismissInsight as dismissInsightInternal,
  runOnce as runProactiveOnce,
  type BrainInsight,
} from './aiProactiveThinker';
import {
  autonomousQuery,
  type AgentQueryResult,
  type ConversationTurn,
} from './aiLocalAgent';

// ─── Types ────────────────────────────────────────────────────────────

export interface BrainContext {
  userId: string | null;
  schoolId: string | null;
  role?: CampusActorRole;
  dataSource: DataSource | null;
  isOnline?: boolean;
}

export interface BrainSnapshot {
  context: BrainContext;
  ambient: AIAmbientAwarenessSnapshot;
  learning: LearningSnapshot | null;
  insights: BrainInsight[];
  lastUpdatedAt: number;
}

export interface AskOptions {
  history?: ConversationTurn[];
  modelInference?: (prompt: string) => Promise<string>;
  /** 為這個 ask 紀錄為 learnedSkill 的種子訊息 */
  userMessage?: string;
  /** 上一輪 AI 回覆的可點選清單 — 供「第 N 個」等指代解析使用 */
  lastChoiceMenu?: AssistantChoiceMenu;
}

export interface AskResult {
  agent: AgentQueryResult;
  plan?: ActionPlan;
  /** 高風險動作會塞到這裡，等使用者確認後再呼叫 confirmPendingPlan */
  pendingPlanId?: string;
}

export type BrainListener = (snapshot: BrainSnapshot) => void;

// ─── Singleton state ─────────────────────────────────────────────────

let context: BrainContext = {
  userId: null,
  schoolId: null,
  role: undefined,
  dataSource: null,
  isOnline: undefined,
};
let learning: LearningSnapshot | null = null;
let insights: BrainInsight[] = [];
let started = false;
let lastUpdatedAt = 0;
const listeners = new Set<BrainListener>();
let unsubscribeAmbient: (() => void) | null = null;
let unsubscribeLearning: (() => void) | null = null;
let unsubscribeInsights: (() => void) | null = null;
let unsubscribeRealtime: (() => void) | null = null;

function notifyAll(): void {
  const snapshot = getSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (e) {
      console.warn('[AIBrain] listener failed:', e);
    }
  }
}

function getSnapshot(): BrainSnapshot {
  return {
    context: { ...context },
    ambient: getAIAmbientAwarenessSnapshot(),
    learning,
    insights,
    lastUpdatedAt,
  };
}

// ─── Public Brain API ────────────────────────────────────────────────

export const aiBrain = {
  /** 取得當前快照，UI 可直接讀（建議用 useAIBrain hook） */
  getSnapshot,

  /** 訂閱所有狀態變化 */
  subscribe(listener: BrainListener): () => void {
    listeners.add(listener);
    listener(getSnapshot());
    return () => {
      listeners.delete(listener);
    };
  },

  /** 啟動 Brain（在 useAIBrain 內呼叫；多次呼叫只生效一次） */
  async start(initialContext: BrainContext): Promise<void> {
    if (started) {
      await this.updateContext(initialContext);
      return;
    }
    started = true;
    context = { ...initialContext };
    lastUpdatedAt = Date.now();

    unsubscribeAmbient = subscribeAIAmbientAwareness(() => {
      lastUpdatedAt = Date.now();
      notifyAll();
    });

    if (context.userId) {
      try {
        learning = await initLearningForUser(context.userId);
      } catch (e) {
        console.warn('[AIBrain] learning init failed:', e);
      }
      try {
        const { initActiveLearning } = await import('./aiActiveLearning');
        await initActiveLearning(context.userId);
      } catch (e) {
        console.warn('[AIBrain] active learning init failed:', e);
      }
    }
    unsubscribeLearning = subscribeLearning((snap) => {
      learning = snap;
      lastUpdatedAt = Date.now();
      notifyAll();
    });

    unsubscribeInsights = subscribeProactiveInsights((next) => {
      insights = next;
      lastUpdatedAt = Date.now();
      notifyAll();
    });
    insights = getProactiveInsights();

    if (context.dataSource) {
      unsubscribeRealtime = startRealtimeSync({
        userId: context.userId,
        schoolId: context.schoolId,
        dataSource: context.dataSource,
      });

      try {
        await refreshAIAmbientAwareness({
          dataSource: context.dataSource,
          userId: context.userId,
          schoolId: context.schoolId,
          reason: 'startup',
          force: true,
        });
      } catch (e) {
        console.warn('[AIBrain] initial ambient refresh failed:', e);
      }
    }

    startProactiveThinker({ runImmediately: true });

    // 動作模式 → 偏好推斷（背景定時更新）
    setTimeout(() => {
      try {
        inferPreferencesFromHistory();
      } catch (e) {
        console.warn('[AIBrain] inferPreferences failed:', e);
      }
    }, 8_000);

    notifyAll();
  },

  /** 更新使用者/學校切換 */
  async updateContext(next: Partial<BrainContext>): Promise<void> {
    const previousUserId = context.userId;
    context = { ...context, ...next };
    lastUpdatedAt = Date.now();

    if (next.userId && next.userId !== previousUserId) {
      if (previousUserId && previousUserId !== next.userId) {
        // 切換使用者：清空舊資料聽眾
      }
      try {
        learning = await initLearningForUser(next.userId);
      } catch (e) {
        console.warn('[AIBrain] learning re-init failed:', e);
      }
      try {
        const { initActiveLearning } = await import('./aiActiveLearning');
        await initActiveLearning(next.userId);
      } catch (e) {
        console.warn('[AIBrain] active learning re-init failed:', e);
      }
    }

    if (context.dataSource) {
      if (unsubscribeRealtime) unsubscribeRealtime();
      unsubscribeRealtime = startRealtimeSync({
        userId: context.userId,
        schoolId: context.schoolId,
        dataSource: context.dataSource,
      });
    }

    notifyAll();
  },

  /** 完全停止 Brain（登出時可用） */
  async stop(): Promise<void> {
    if (!started) return;
    started = false;
    if (unsubscribeAmbient) unsubscribeAmbient();
    if (unsubscribeLearning) unsubscribeLearning();
    if (unsubscribeInsights) unsubscribeInsights();
    if (unsubscribeRealtime) unsubscribeRealtime();
    stopRealtimeSync();
    stopProactiveThinker();
    unsubscribeAmbient = null;
    unsubscribeLearning = null;
    unsubscribeInsights = null;
    unsubscribeRealtime = null;
  },

  /** 強制刷新環境感知 */
  async refresh(reason = 'manual'): Promise<void> {
    if (!context.dataSource) return;
    await refreshAIAmbientAwareness({
      dataSource: context.dataSource,
      userId: context.userId,
      schoolId: context.schoolId,
      reason,
      force: true,
    });
    lastUpdatedAt = Date.now();
  },

  /** 重新跑一次主動思考 */
  async rethink(): Promise<BrainInsight[]> {
    return await runProactiveOnce('manual');
  },

  /** 丟掉一張洞察卡片 */
  dismissInsight(id: string): void {
    dismissInsightInternal(id);
  },

  /**
   * 統一 ask：規劃 → 執行（讀取自動跑、寫入需確認）
   * 注意：本方法只跑 autonomousQuery（不需要 LLM 也能用）；
   * AIChatScreen 已有完整 LLM 對話，本方法只是另一個入口。
   */
  async ask(message: string, opts: AskOptions = {}): Promise<AskResult> {
    if (!context.schoolId) {
      throw new Error('AIBrain: schoolId 尚未設定');
    }
    const inference: (p: string) => Promise<string> =
      opts.modelInference ?? (async () => '');
    const agent = await autonomousQuery(
      message,
      {
        userId: context.userId ?? undefined,
        schoolId: context.schoolId,
        role: context.role,
        lastChoiceMenu: opts.lastChoiceMenu,
        isOnline: context.isOnline,
      },
      inference,
      opts.history,
    );

    // 觀察互動（即使沒呼叫工具也要記）
    observeInteraction({
      kind: 'observation',
      userMessage: message,
      summary: agent.contextText?.slice(0, 200),
    });

    // 若 agent 已執行寫入動作，從 executedActions 萃取一個 plan，便於 UI 展示步驟
    if (agent.executedActions.length > 0) {
      const steps: Omit<ActionStep, 'id' | 'risk'>[] = agent.executedActions.map((entry) => ({
        tool: entry.tool,
        args: {},
        description: entry.reason,
        autoExecutable: true,
      }));
      const plan = buildActionPlan({ goal: message.slice(0, 64), steps, userMessage: message });
      return { agent, plan };
    }

    // 若 agent 提出了未能直接執行（缺資訊）的動作，提示為待確認
    if (agent.failedActions.length > 0) {
      const steps: Omit<ActionStep, 'id' | 'risk'>[] = agent.failedActions.map((fa) => ({
        tool: fa.tool,
        args: {},
        description: `需要使用者補充：${fa.missingInfo}`,
        autoExecutable: false,
      }));
      const plan = buildActionPlan({
        goal: message.slice(0, 64),
        steps,
        userMessage: message,
      });
      registerPendingPlan(plan);
      return { agent, plan, pendingPlanId: plan.id };
    }

    return { agent };
  },

  /** 直接接受外部組好的計畫（例如 Smart Action 卡片觸發） */
  async runPlan(
    plan: ActionPlan,
    opts: { userConfirmed?: boolean; onStep?: ActionExecutionContext['lastChoiceMenu'] } = {},
  ): Promise<ActionExecutionReport> {
    if (!context.schoolId) {
      throw new Error('AIBrain: schoolId 尚未設定');
    }
    return await executePlan(plan, {
      userId: context.userId ?? undefined,
      schoolId: context.schoolId,
      role: context.role,
      isOnline: context.isOnline,
      userConfirmed: opts.userConfirmed,
    });
  },

  /** 規劃一個高層意圖（單一目標 → 多步驟） */
  proposePlan(input: {
    goal: string;
    steps: Omit<ActionStep, 'id' | 'risk'>[];
    userMessage?: string;
  }): ActionPlan {
    const plan = buildActionPlan(input);
    if (plan.requiresConfirmation) registerPendingPlan(plan);
    return plan;
  },

  /** 使用者確認後執行高風險計畫 */
  async confirmPendingPlan(planId: string): Promise<ActionExecutionReport | null> {
    const plan = consumePendingPlan(planId);
    if (!plan) return null;
    return await this.runPlan(plan, { userConfirmed: true });
  },

  /** 使用者拒絕高風險計畫（從佇列移除） */
  dismissPendingPlan(planId: string): void {
    dismissPendingPlanInternal(planId);
  },

  /** 取得目前所有待確認計畫 */
  listPendingPlans(): ActionPlan[] {
    return listPendingPlans();
  },

  /** 訂閱待確認計畫變化（給全域 ConfirmModal 用） */
  subscribePendingPlans(cb: (plans: ActionPlan[]) => void): () => void {
    return subscribePendingPlans(cb);
  },

  /** UI/其他模組對 AI 的回饋 */
  feedback(payload: FeedbackPayload): void {
    recordFeedback(payload);
  },

  /** 通用觀察事件（讓任何 Screen 都能 push 學習素材） */
  observe(interaction: LearningInteraction): void {
    observeInteraction(interaction);
  },

  /** 回報工具執行結果（給外部執行器使用） */
  reportToolOutcome(
    tool: string,
    args: Record<string, unknown>,
    outcome: 'success' | 'failure',
    error?: string,
    userMessage?: string,
  ): void {
    recordToolOutcome(tool, args, outcome, error, userMessage);
  },

  /** 工具風險分類 */
  classifyToolRisk(tool: string) {
    return classifyRisk(tool);
  },

  /** 取得目前對使用者的「理解」摘要（給 UI 顯示用） */
  describeUnderstanding(): string {
    const snapshot = getSnapshot();
    const parts: string[] = [];
    const lc = snapshot.learning;
    if (lc) {
      const prefs = lc.memory.preferences;
      if (prefs.preferredCafeteria) parts.push(`常去 ${prefs.preferredCafeteria}`);
      if (prefs.foodPreferences.length > 0)
        parts.push(`飲食偏好：${prefs.foodPreferences.slice(0, 3).join('、')}`);
      if (prefs.allergens.length > 0)
        parts.push(`過敏：${prefs.allergens.slice(0, 3).join('、')}`);
      if (lc.memory.learnedFacts.length > 0)
        parts.push(`已學 ${lc.memory.learnedFacts.length} 條事實`);
    }
    const ambient = snapshot.ambient.runtimeData;
    const upcoming = (ambient.calendarEvents ?? []).length;
    if (upcoming > 0) parts.push(`未來 14 天 ${upcoming} 場活動`);
    const unread = (ambient.notifications ?? []).filter(
      (n) => !(n as { read?: boolean; readAt?: unknown }).read && !(n as { readAt?: unknown }).readAt,
    ).length;
    if (unread > 0) parts.push(`${unread} 則未讀通知`);
    const activeOrders = (ambient.orders ?? []).filter(
      (o) => !/completed|cancelled|refunded/i.test(String((o as { status?: unknown }).status ?? '')),
    ).length;
    if (activeOrders > 0) parts.push(`${activeOrders} 張進行中訂單`);
    if (snapshot.insights.length > 0) parts.push(`${snapshot.insights.length} 條洞察待看`);
    return parts.length > 0 ? parts.join('；') : '初始化中，正在熟悉你的使用情境…';
  },

  /** 取得當前學習快照（給 ai.ts prompt 注入） */
  getLearningSnapshot(): LearningSnapshot | null {
    return getLearningSnapshotInternal();
  },

  /** 清掉某使用者的學習資料（登出/重置時可用） */
  async forgetUser(userId: string): Promise<void> {
    await clearLearningForUser(userId);
    try {
      const { clearActiveLearning } = await import('./aiActiveLearning');
      await clearActiveLearning(userId);
    } catch (e) {
      console.warn('[AIBrain] forget active learning failed:', e);
    }
  },

  /**
   * 使用者教會 AI 一個詞的意義（主動學習）。
   *   brain.teach('午餐', { meaning: '用餐時段≈12:00', itemName: '川福美食｜酸辣粉' })
   */
  async teach(
    term: string,
    payload: {
      meaning: string;
      itemName?: string;
      aliases?: string[];
    },
  ): Promise<void> {
    const { linkConceptToMeaning } = await import('./aiActiveLearning');
    linkConceptToMeaning(term, { ...payload, source: 'user_clarified', confidence: 1 });
  },

  /** 取得目前未理解的詞，給 UI 主動反問使用者 */
  async getOpenUnknowns(limit?: number) {
    const { listOpenUnknowns } = await import('./aiActiveLearning');
    return listOpenUnknowns(limit);
  },

  /** 取得已學會的概念清單 */
  async listLearnedConcepts() {
    const { listConcepts } = await import('./aiActiveLearning');
    return listConcepts();
  },
};

export function getAIBrain() {
  return aiBrain;
}

// 重新匯出主要型別，方便外部使用
export type {
  ActionExecutionContext,
  ActionExecutionReport,
  ActionPlan,
  ActionRisk,
  ActionStep,
  BrainInsight,
  LearningInteraction,
  LearningSnapshot,
  FeedbackPayload,
  AssistantChoiceMenu,
};
