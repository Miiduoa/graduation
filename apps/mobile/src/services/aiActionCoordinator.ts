/**
 * AI Action Coordinator — 跨模組代理行動協調器
 * ═══════════════════════════════════════════════════════════════════════
 * 把 AI 規劃出的「一連串工具呼叫」當成一個事務（plan）執行：
 *  - 對每個步驟做風險分級（low / medium / high）
 *  - 高風險動作必須等使用者明確確認後才會執行
 *  - 步驟之間可宣告 dependsOn，前序失敗後序自動跳過
 *  - 所有結果回傳並交給 ContinualLearning 蒐集學習素材
 *
 * 不會直接呼叫 LLM，純粹編排已存在的工具執行器（aiToolRegistry / aiAgentTools）。
 */

import { executeToolStandard, getToolSpec } from './aiToolRegistry';
import { executeTool, type ToolCallResult } from './aiAgentTools';
import { recordToolOutcome } from './aiContinualLearning';
import type { CampusActorRole } from '../data';
import type { AssistantChoiceMenu } from '../data/types';

// ─── Types ────────────────────────────────────────────────────────────

export type ActionRisk = 'low' | 'medium' | 'high';
export type ActionStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'running'
  | 'success'
  | 'failure'
  | 'skipped'
  | 'cancelled';

export interface ActionStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** 對使用者可讀的描述 */
  description: string;
  risk?: ActionRisk;
  /** 必須等這些 step 都成功才能執行 */
  dependsOn?: string[];
  /** 是否可被自動執行（false 代表只產生草稿） */
  autoExecutable?: boolean;
  /** 額外標籤（categorize / module 來源） */
  tags?: string[];
}

export interface ActionPlan {
  id: string;
  goal: string;
  steps: ActionStep[];
  /** plan 整體風險：取所有 step 最高 */
  risk: ActionRisk;
  requiresConfirmation: boolean;
  createdAt: number;
  userMessage?: string;
}

export interface StepOutcome {
  step: ActionStep;
  status: ActionStatus;
  result?: ToolCallResult;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ActionExecutionReport {
  plan: ActionPlan;
  outcomes: StepOutcome[];
  startedAt: number;
  completedAt: number;
  allSuccess: boolean;
  cancelledReason?: string;
}

export interface ActionExecutionContext {
  userId?: string;
  schoolId: string;
  role?: CampusActorRole;
  isOnline?: boolean;
  lastChoiceMenu?: AssistantChoiceMenu;
  /** 使用者已確認可以執行高風險 step；預設 false */
  userConfirmed?: boolean;
}

// ─── Risk classification ──────────────────────────────────────────────

/** Tool → 風險基線；可被 step.risk 覆蓋 */
const TOOL_RISK_TABLE: Record<string, ActionRisk> = {
  // 讀取 / 查詢
  query_courses: 'low',
  query_grades: 'low',
  query_assignments: 'low',
  query_attendance: 'low',
  query_announcements: 'low',
  query_events: 'low',
  query_menus: 'low',
  query_library: 'low',
  query_bus: 'low',
  query_notifications: 'low',
  query_calendar: 'low',
  query_orders: 'low',
  query_dorm_info: 'low',
  query_health_records: 'low',
  query_student_info: 'low',
  analyze_credits: 'low',
  predict_gpa: 'low',
  comprehensive_analysis: 'low',
  daily_briefing: 'low',
  recommend_lunch: 'low',
  // 一般寫入
  set_reminder: 'medium',
  reserve_library_seat: 'medium',
  add_calendar_event: 'medium',
  register_event: 'medium',
  unregister_event: 'medium',
  report_repair: 'medium',
  print_file: 'medium',
  post_lost: 'medium',
  send_message: 'medium',
  // 高敏感 / 涉及金流或公開
  order_meal: 'high',
  book_health: 'high',
  request_leave: 'high',
  assignment_publish: 'high',
};

export function classifyRisk(tool: string, override?: ActionRisk): ActionRisk {
  if (override) return override;
  return TOOL_RISK_TABLE[tool] ?? 'medium';
}

export function buildActionPlan(input: {
  goal: string;
  steps: Omit<ActionStep, 'id' | 'risk'>[];
  userMessage?: string;
}): ActionPlan {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const enriched: ActionStep[] = input.steps.map((step, index) => ({
    ...step,
    id: `${planId}_s${index + 1}`,
    risk: classifyRisk(step.tool),
  }));
  const order: ActionRisk[] = ['low', 'medium', 'high'];
  const planRisk = enriched.reduce<ActionRisk>(
    (max, s) => (order.indexOf(s.risk ?? 'low') > order.indexOf(max) ? s.risk ?? 'low' : max),
    'low',
  );
  return {
    id: planId,
    goal: input.goal,
    steps: enriched,
    risk: planRisk,
    requiresConfirmation: planRisk !== 'low',
    createdAt: Date.now(),
    userMessage: input.userMessage,
  };
}

// ─── Execution ────────────────────────────────────────────────────────

export async function executePlan(
  plan: ActionPlan,
  ctx: ActionExecutionContext,
  onStep?: (outcome: StepOutcome) => void,
): Promise<ActionExecutionReport> {
  const startedAt = Date.now();

  if (plan.requiresConfirmation && !ctx.userConfirmed) {
    const outcomes: StepOutcome[] = plan.steps.map((step) => ({
      step,
      status: 'awaiting_confirmation' as const,
      startedAt,
    }));
    outcomes.forEach((outcome) => onStep?.(outcome));
    return {
      plan,
      outcomes,
      startedAt,
      completedAt: Date.now(),
      allSuccess: false,
      cancelledReason: '需要使用者確認後才能執行',
    };
  }

  const outcomes: StepOutcome[] = [];
  const stepSuccess = new Map<string, boolean>();

  for (const step of plan.steps) {
    const dependsOk = (step.dependsOn ?? []).every((dep) => stepSuccess.get(dep) === true);
    if (!dependsOk) {
      const outcome: StepOutcome = {
        step,
        status: 'skipped',
        startedAt: Date.now(),
        completedAt: Date.now(),
        error: '前序步驟未完成',
      };
      outcomes.push(outcome);
      onStep?.(outcome);
      continue;
    }

    if (step.autoExecutable === false) {
      const outcome: StepOutcome = {
        step,
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
      outcomes.push(outcome);
      onStep?.(outcome);
      continue;
    }

    const outcomeStart = Date.now();
    onStep?.({ step, status: 'running', startedAt: outcomeStart });

    try {
      const result = await runToolWithCtx(step.tool, step.args, ctx);
      const success = !!result.success;
      stepSuccess.set(step.id, success);
      const outcome: StepOutcome = {
        step,
        status: success ? 'success' : 'failure',
        startedAt: outcomeStart,
        completedAt: Date.now(),
        result,
        error: success ? undefined : result.error,
      };
      outcomes.push(outcome);
      onStep?.(outcome);
      try {
        recordToolOutcome(
          step.tool,
          step.args,
          success ? 'success' : 'failure',
          result.error,
          plan.userMessage,
        );
      } catch (e) {
        console.warn('[AIActionCoordinator] recordToolOutcome failed:', e);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome: StepOutcome = {
        step,
        status: 'failure',
        startedAt: outcomeStart,
        completedAt: Date.now(),
        error: message,
      };
      outcomes.push(outcome);
      onStep?.(outcome);
      stepSuccess.set(step.id, false);
      try {
        recordToolOutcome(step.tool, step.args, 'failure', message, plan.userMessage);
      } catch (e) {
        console.warn('[AIActionCoordinator] recordToolOutcome failed:', e);
      }
    }
  }

  const allSuccess = outcomes.every((o) => o.status === 'success');
  return {
    plan,
    outcomes,
    startedAt,
    completedAt: Date.now(),
    allSuccess,
  };
}

async function runToolWithCtx(
  tool: string,
  args: Record<string, unknown>,
  ctx: ActionExecutionContext,
): Promise<ToolCallResult> {
  const spec = getToolSpec(tool);
  if (spec) {
    const std = await executeToolStandard(tool, args as Record<string, string>, {
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      role: ctx.role,
      lastChoiceMenu: ctx.lastChoiceMenu,
      isOnline: ctx.isOnline,
    });
    return {
      success: std.success,
      summary: std.summary,
      data: std.data,
      error: std.error,
      isWrite: std.isWrite,
      choiceMenu: std.choiceMenu,
      learnedSkill: std.learnedSkill,
    } as ToolCallResult;
  }
  return await executeTool(tool, args as Record<string, string>, {
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    role: ctx.role,
  });
}

// ─── Pending plan registry (for UI confirmation flows) ────────────────

const pendingPlans = new Map<string, { plan: ActionPlan; createdAt: number }>();
const pendingListeners = new Set<(plans: ActionPlan[]) => void>();

function notifyPendingListeners(): void {
  const snapshot = listPendingPlans();
  for (const cb of pendingListeners) {
    try {
      cb(snapshot);
    } catch (err) {
      console.warn('[ActionCoordinator] pending listener threw:', err);
    }
  }
}

export function registerPendingPlan(plan: ActionPlan): void {
  pendingPlans.set(plan.id, { plan, createdAt: Date.now() });
  // 清掉太舊的（>15 分鐘）
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, entry] of pendingPlans) {
    if (entry.createdAt < cutoff) pendingPlans.delete(id);
  }
  notifyPendingListeners();
}

export function getPendingPlan(planId: string): ActionPlan | null {
  return pendingPlans.get(planId)?.plan ?? null;
}

export function consumePendingPlan(planId: string): ActionPlan | null {
  const entry = pendingPlans.get(planId);
  if (!entry) return null;
  pendingPlans.delete(planId);
  notifyPendingListeners();
  return entry.plan;
}

export function dismissPendingPlan(planId: string): void {
  if (pendingPlans.delete(planId)) {
    notifyPendingListeners();
  }
}

export function listPendingPlans(): ActionPlan[] {
  return [...pendingPlans.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((entry) => entry.plan);
}

export function subscribePendingPlans(cb: (plans: ActionPlan[]) => void): () => void {
  pendingListeners.add(cb);
  // 立即回傳目前狀態
  try {
    cb(listPendingPlans());
  } catch (err) {
    console.warn('[ActionCoordinator] initial pending listener threw:', err);
  }
  return () => {
    pendingListeners.delete(cb);
  };
}
