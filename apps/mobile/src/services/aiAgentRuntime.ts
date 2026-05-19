/**
 * AI Agent Runtime — Plan → Execute → Verify 自動代理引擎
 *
 * 設計目標：讓 AI 真的「代理」5 角色完成跨服務、跨角色任務。
 *
 * 三段生命週期：
 *   1. plan(intent, role, context)  → ActionPlan（含多 step + risk + estimateMins）
 *   2. execute(plan)                → ExecutionResult（步驟逐一跑，emit RoleEvent）
 *   3. verify(result)               → VerifyOutcome（AI 自我審計是否成功）
 *
 * 三段 autonomy mode（可被 user 設定）：
 *   - "assistive"     ：AI 只 plan，所有 step 都要 user approve（最安全）
 *   - "collaborative" ：AI plan + 跑 low-risk step，high-risk 跳 confirm
 *   - "autonomous"    ：AI plan + 全部自動跑（含 high-risk，事後審計）
 *
 * 持久化：plans 寫到 AsyncStorage（per uid），重啟保留
 * 跨角色：每完成一個 plan 會 emit agent_plan_completed 事件
 *
 * 對應 docs：「AI Agent 代理完成所有事」是 v3 demo 主軸。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getScopedStorageKey } from './scopedStorage';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type AgentRole = 'student' | 'teacher' | 'ta' | 'department' | 'vendor';

/** Agent 自動程度 — 可被 user 設定 */
export type AutonomyMode = 'assistive' | 'collaborative' | 'autonomous';

/** Plan 風險級別 */
export type ActionRisk = 'low' | 'medium' | 'high';

/** Plan 生命週期狀態 */
export type PlanStatus =
  | 'planning'           // AI 正在規劃
  | 'awaiting_approval'  // 等使用者批准
  | 'executing'          // 執行中
  | 'verifying'          // AI 在 verify
  | 'done'               // 成功完成
  | 'failed'             // 失敗
  | 'rejected'           // 使用者拒絕
  | 'cancelled';         // 使用者取消

/** 單一 step 結果 */
export interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  output?: unknown;
  error?: string;
}

/** Action 單一步驟（給 plan 顯示用 + executor 跑） */
export interface ActionStep {
  id: string;
  /** 給 UI 看的描述 */
  description: string;
  /** 用哪個 simulator / service 函式（demo 用） */
  serviceCall?: string;
  /** 觸發 RoleEventBus 哪種事件 */
  emitEvent?: string;
  /** 預計幾秒 */
  estimateSeconds: number;
  /** 步驟風險 */
  risk: ActionRisk;
  /** 是否需要 user 額外 confirm（即使 autonomy=autonomous） */
  alwaysConfirm?: boolean;
  /** 給 executor 用的 payload */
  payload?: Record<string, unknown>;
}

/** Agent Plan 主資料結構 */
export interface ActionPlan {
  id: string;
  /** AI plan 的 intent，例如 "student.daily_arrange" */
  intent: string;
  /** 哪個角色觸發 */
  role: AgentRole;
  /** AI 給 plan 的標題（給 UI 看） */
  title: string;
  /** AI 給 plan 的一句話總結 */
  summary: string;
  /** AI 信心 0-100 */
  confidence: number;
  /** 整體風險（max of steps） */
  risk: ActionRisk;
  /** 估計總分鐘 */
  estimateMinutes: number;
  /** steps */
  steps: ActionStep[];
  /** 當前狀態 */
  status: PlanStatus;
  /** 創建時間 */
  createdAt: string;
  /** 開始執行時間 */
  startedAt?: string;
  /** 完成時間 */
  finishedAt?: string;
  /** 每 step 的執行結果 */
  results: StepResult[];
  /** Verify 結論 */
  verify?: VerifyOutcome;
  /** 為什麼被擋住 / 拒絕 */
  blockedReason?: string;
}

export interface VerifyOutcome {
  success: boolean;
  summary: string;
  /** 0-100 */
  confidence: number;
  /** 如果失敗，建議補救動作 */
  recommendations?: string[];
}

// ─────────────────────────────────────────────────────────
// Intent registry — 5 角色各自的 agent 任務
// ─────────────────────────────────────────────────────────

export interface IntentDefinition {
  intent: string;
  role: AgentRole;
  title: string;
  summary: string;
  /** plan factory — 根據 context 算 steps */
  planFactory: (ctx: PlanContext) => Omit<ActionPlan, 'id' | 'status' | 'createdAt' | 'results' | 'verify'>;
}

export interface PlanContext {
  uid: string;
  displayName?: string;
  now?: string;
  extra?: Record<string, unknown>;
}

const REGISTRY: IntentDefinition[] = [
  // ─── 學生 ───
  {
    intent: 'student.daily_arrange',
    role: 'student',
    title: '今日學習安排',
    summary: 'AI 代你排定今天的學習動作 + 午餐自動下單',
    planFactory: (ctx) => ({
      intent: 'student.daily_arrange',
      role: 'student',
      title: '🎓 今日學習自動安排',
      summary: 'AI 已分析你 5 門課的截止狀態，安排 3 個 25 分鐘 pomodoro + 自動為你預訂中午便當。',
      confidence: 85,
      risk: 'low',
      estimateMinutes: 90,
      steps: [
        { id: 's1', description: '掃描 5 門課截止 + 預估成績', serviceCall: 'planStudy', estimateSeconds: 2, risk: 'low' },
        { id: 's2', description: '排定 3 個 25 分鐘 pomodoro 區段', serviceCall: 'scheduler', estimateSeconds: 1, risk: 'low' },
        { id: 's3', description: '依照昨日喜好預訂中午便當', serviceCall: 'simulateStudentOrderFood', emitEvent: 'order_placed', estimateSeconds: 3, risk: 'medium', alwaysConfirm: true },
        { id: 's4', description: '把任務寫進 RoleEventBus inbox', emitEvent: 'agent_plan_completed', estimateSeconds: 1, risk: 'low' },
      ],
    }),
  },
  {
    intent: 'student.exam_prep',
    role: 'student',
    title: '考前自動複習',
    summary: 'AI 偵測 3 天內有考試 → 自動排複習 + 找錯題本 + 預約學伴',
    planFactory: (ctx) => ({
      intent: 'student.exam_prep',
      role: 'student',
      title: '🎓 期中考前複習自動安排',
      summary: 'AI 偵測 3 天後機器學習期中考 → 安排 5 場 50 分鐘複習、調出 12 題錯題、邀 2 位學伴。',
      confidence: 78,
      risk: 'low',
      estimateMinutes: 250,
      steps: [
        { id: 's1', description: '掃描未來 7 天考試 + 教材', estimateSeconds: 2, risk: 'low' },
        { id: 's2', description: '從錯題本撈出 12 題', estimateSeconds: 1, risk: 'low' },
        { id: 's3', description: '排定 5 場 50 分鐘複習區段', estimateSeconds: 1, risk: 'low' },
        { id: 's4', description: '邀 2 位學伴（aiStudyBuddyMatcher 推薦）', serviceCall: 'aiStudyBuddyMatcher', estimateSeconds: 2, risk: 'medium', alwaysConfirm: true },
      ],
    }),
  },

  // ─── 老師 ───
  {
    intent: 'teacher.bulk_feedback',
    role: 'teacher',
    title: '批量草擬評語 + 提醒缺繳',
    summary: 'AI 代你批改 5 份作業評語 + 對 3 位缺繳學生發提醒',
    planFactory: (ctx) => ({
      intent: 'teacher.bulk_feedback',
      role: 'teacher',
      title: '👨‍🏫 5 份評語批量草擬',
      summary: 'AI 已分析 5 份已繳作業 → 草擬個人化評語（含 aiPreReviewGrade 預判）+ 對 3 位缺繳學生發提醒。等你審計。',
      confidence: 82,
      risk: 'medium',
      estimateMinutes: 8,
      steps: [
        { id: 's1', description: '對 5 份作業跑 aiPreReviewGrade 預判', serviceCall: 'aiPreReviewGrade', estimateSeconds: 3, risk: 'low' },
        { id: 's2', description: '對每份用 draftFeedback 草擬評語', serviceCall: 'draftFeedback', estimateSeconds: 5, risk: 'medium' },
        { id: 's3', description: '對 3 位缺繳學生跑 aiForecastBulkReminder', serviceCall: 'aiForecastBulkReminder', estimateSeconds: 2, risk: 'low' },
        { id: 's4', description: '生成 5 條評語 + 3 條提醒，列入 awaiting_approval', estimateSeconds: 1, risk: 'high', alwaysConfirm: true },
        { id: 's5', description: '老師審計後 → emit feedback_drafted + bulk_reminder_sent', emitEvent: 'feedback_drafted', estimateSeconds: 2, risk: 'high' },
      ],
    }),
  },
  {
    intent: 'teacher.risk_student_outreach',
    role: 'teacher',
    title: '對風險學生主動關懷',
    summary: 'AI 識別 2 位連續缺繳學生 → 草擬個人化關懷訊息',
    planFactory: (ctx) => ({
      intent: 'teacher.risk_student_outreach',
      role: 'teacher',
      title: '👨‍🏫 紅旗學生關懷代理',
      summary: 'AI 偵測 2 位學生連續 3 份未繳 → 草擬個人化關懷訊息（避開 quiet hours）。',
      confidence: 88,
      risk: 'high',
      estimateMinutes: 5,
      steps: [
        { id: 's1', description: '掃 5 門課找出連續 3 份未繳的學生', estimateSeconds: 2, risk: 'low' },
        { id: 's2', description: '為每位學生跑 aiThinking.observeStudentState', serviceCall: 'aiThinking', estimateSeconds: 3, risk: 'low' },
        { id: 's3', description: '草擬個人化關懷訊息', estimateSeconds: 4, risk: 'medium' },
        { id: 's4', description: '檢查 dynamicQuietHours 是否擋住', serviceCall: 'dynamicQuietHours', estimateSeconds: 1, risk: 'low' },
        { id: 's5', description: '等老師批准 → 發送', estimateSeconds: 2, risk: 'high', alwaysConfirm: true },
      ],
    }),
  },

  // ─── TA 助教 ───
  {
    intent: 'ta.auto_reply_help',
    role: 'ta',
    title: '對學生求助自動草擬回覆',
    summary: 'AI 看到 2 條求助 → 從歷史回覆學一套 → 草擬',
    planFactory: (ctx) => ({
      intent: 'ta.auto_reply_help',
      role: 'ta',
      title: '🧑‍💼 學生求助自動草擬',
      summary: 'AI 偵測 2 條學生求助訊息 → 對照歷史已解決問題 → 草擬回覆。你只需審視即可送出。',
      confidence: 75,
      risk: 'medium',
      estimateMinutes: 3,
      steps: [
        { id: 's1', description: '掃 help_requested inbox', estimateSeconds: 1, risk: 'low' },
        { id: 's2', description: '對每條跑 aiSemanticReasoner.understand', serviceCall: 'aiSemanticReasoner', estimateSeconds: 2, risk: 'low' },
        { id: 's3', description: '搜索歷史已解決的同類問題', estimateSeconds: 2, risk: 'low' },
        { id: 's4', description: '草擬回覆 + 標示來源依據', estimateSeconds: 3, risk: 'medium' },
        { id: 's5', description: '送 awaiting_approval → 助教審視 → emit feedback_drafted', emitEvent: 'feedback_drafted', estimateSeconds: 1, risk: 'medium', alwaysConfirm: true },
      ],
    }),
  },

  // ─── 主任 ───
  {
    intent: 'department.risk_followup',
    role: 'department',
    title: '對風險課程任課老師主動聯繫',
    summary: 'AI 偵測 2 門課平均成績低於 70% → 草擬慰問信',
    planFactory: (ctx) => ({
      intent: 'department.risk_followup',
      role: 'department',
      title: '🏛 風險課程任課老師關懷',
      summary: 'AI 偵測本系 2 門課平均預估 < 70% → 草擬慰問信 + 教學資源連結。',
      confidence: 82,
      risk: 'medium',
      estimateMinutes: 4,
      steps: [
        { id: 's1', description: '掃所有課程取 aiDepartmentHealthScore.topRisks', serviceCall: 'aiDepartmentHealthScore', estimateSeconds: 2, risk: 'low' },
        { id: 's2', description: '對每門課找出任課老師 + 風險原因', estimateSeconds: 2, risk: 'low' },
        { id: 's3', description: '草擬個人化慰問信 + 附教學工坊連結', estimateSeconds: 3, risk: 'medium' },
        { id: 's4', description: '等主任批准 → 透過 inbox 發送', estimateSeconds: 2, risk: 'medium', alwaysConfirm: true },
      ],
    }),
  },
  {
    intent: 'department.weekly_broadcast',
    role: 'department',
    title: '本週系所重點自動產出',
    summary: 'AI 整理本週 inbox + 系所動態 → 草擬全系廣播',
    planFactory: (ctx) => ({
      intent: 'department.weekly_broadcast',
      role: 'department',
      title: '🏛 本週系所重點自動草擬',
      summary: 'AI 從本週全系 RoleEvent + 教務資訊歸納 5 個重點 → 草擬廣播稿。',
      confidence: 70,
      risk: 'high',
      estimateMinutes: 6,
      steps: [
        { id: 's1', description: '聚合本週全系 RoleEvent 統計', estimateSeconds: 2, risk: 'low' },
        { id: 's2', description: '提取 5 個重點主題（成績 / 出席 / 公告 / 活動 / 截止）', estimateSeconds: 3, risk: 'low' },
        { id: 's3', description: '草擬廣播稿（aiOrchestrator）', estimateSeconds: 4, risk: 'medium' },
        { id: 's4', description: '主任審計 → emit department_broadcast', emitEvent: 'department_broadcast', estimateSeconds: 2, risk: 'high', alwaysConfirm: true },
      ],
    }),
  },

  // ─── 餐廳 ───
  {
    intent: 'vendor.long_wait_notify',
    role: 'vendor',
    title: '對久候訂單自動通知',
    summary: 'AI 偵測 2 筆訂單已等 20 分鐘 → 自動發補時通知',
    planFactory: (ctx) => ({
      intent: 'vendor.long_wait_notify',
      role: 'vendor',
      title: '🍱 久候訂單自動補時通知',
      summary: 'AI 偵測 2 筆訂單已等 20 分鐘 → 自動發「再 5 分鐘」通知給學生 + 附 5% 折扣券。',
      confidence: 90,
      risk: 'low',
      estimateMinutes: 1,
      steps: [
        { id: 's1', description: '掃 orders state 找出 oldestPending > 20min', estimateSeconds: 1, risk: 'low' },
        { id: 's2', description: '對每筆 call aiVendorNextAction', serviceCall: 'aiVendorNextAction', estimateSeconds: 1, risk: 'low' },
        { id: 's3', description: '自動發補時通知 + 5% 折扣券', emitEvent: 'order_status_changed', estimateSeconds: 1, risk: 'low' },
        { id: 's4', description: '寫入 audit log', estimateSeconds: 0.5, risk: 'low' },
      ],
    }),
  },
  {
    intent: 'vendor.peak_prep',
    role: 'vendor',
    title: '尖峰時段預備提示',
    summary: 'AI 預測 30 分鐘內進尖峰 → 自動提示員工開始備料',
    planFactory: (ctx) => ({
      intent: 'vendor.peak_prep',
      role: 'vendor',
      title: '🍱 尖峰前自動提示備料',
      summary: 'AI（vendorPredictor）預測 30 分鐘內進尖峰、預估 22 單 → 自動推送員工備料 checklist。',
      confidence: 85,
      risk: 'low',
      estimateMinutes: 1,
      steps: [
        { id: 's1', description: '對歷史 hour-bucket 跑 vendorPredictor', serviceCall: 'vendorPredictor', estimateSeconds: 1, risk: 'low' },
        { id: 's2', description: '生成備料 checklist', estimateSeconds: 1, risk: 'low' },
        { id: 's3', description: '推送員工通知（不影響學生）', estimateSeconds: 1, risk: 'low' },
      ],
    }),
  },
];

// ─────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────

const PLAN_STORAGE_BASE = 'ai_agent_plans_v1';
const AUTONOMY_MODE_BASE = 'ai_agent_autonomy_mode_v1';

function planKey(uid: string, schoolId: string | null): string {
  return getScopedStorageKey(PLAN_STORAGE_BASE, { uid, schoolId });
}

function autonomyKey(uid: string, schoolId: string | null): string {
  return getScopedStorageKey(AUTONOMY_MODE_BASE, { uid, schoolId });
}

export async function loadAllPlans(uid: string, schoolId: string | null = null): Promise<ActionPlan[]> {
  try {
    const raw = await AsyncStorage.getItem(planKey(uid, schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function savePlan(uid: string, plan: ActionPlan, schoolId: string | null = null): Promise<void> {
  try {
    const all = await loadAllPlans(uid, schoolId);
    const idx = all.findIndex((p) => p.id === plan.id);
    if (idx >= 0) all[idx] = plan;
    else all.unshift(plan);
    // 最多保留 50 筆
    const trimmed = all.slice(0, 50);
    await AsyncStorage.setItem(planKey(uid, schoolId), JSON.stringify(trimmed));
  } catch {
    /* swallow */
  }
}

export async function loadAutonomyMode(uid: string, schoolId: string | null = null): Promise<AutonomyMode> {
  try {
    const raw = await AsyncStorage.getItem(autonomyKey(uid, schoolId));
    if (raw === 'assistive' || raw === 'collaborative' || raw === 'autonomous') return raw;
  } catch {
    /* swallow */
  }
  return 'collaborative'; // default
}

export async function saveAutonomyMode(uid: string, mode: AutonomyMode, schoolId: string | null = null): Promise<void> {
  try {
    await AsyncStorage.setItem(autonomyKey(uid, schoolId), mode);
  } catch {
    /* swallow */
  }
}

// ─────────────────────────────────────────────────────────
// Plan-Execute-Verify 引擎
// ─────────────────────────────────────────────────────────

/**
 * 1. Plan — 把 intent 變成 ActionPlan
 */
export function plan(intent: string, role: AgentRole, context: PlanContext): ActionPlan {
  const def = REGISTRY.find((i) => i.intent === intent && i.role === role);
  if (!def) {
    throw new Error(`No intent registered: ${role}/${intent}`);
  }
  const base = def.planFactory(context);
  const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const created: ActionPlan = {
    ...base,
    id,
    status: 'planning',
    createdAt: new Date().toISOString(),
    results: base.steps.map((s) => ({ stepId: s.id, status: 'pending' })),
  };
  return created;
}

/**
 * 2. 決定 plan 接下來該走 awaiting_approval 還是直接 executing
 *    依 autonomy mode + plan.risk + 任一 step.alwaysConfirm
 */
export function shouldRequireApproval(p: ActionPlan, mode: AutonomyMode): boolean {
  // assistive：永遠要 confirm
  if (mode === 'assistive') return true;
  // 任一 step 標 alwaysConfirm → 強制 confirm
  if (p.steps.some((s) => s.alwaysConfirm)) return true;
  // collaborative：high risk 要 confirm
  if (mode === 'collaborative' && p.risk === 'high') return true;
  // autonomous：全自動，但 high risk 仍會經 quiet hours / killSwitch 過濾
  return false;
}

/**
 * 3. 開始執行（單 step 模式 — 給 UI 一步步顯示動畫；也可一次跑完）
 *    回傳更新後的 plan（不持久化，由 caller 決定）
 */
export async function executeNextStep(p: ActionPlan): Promise<ActionPlan> {
  if (p.status === 'planning' || p.status === 'awaiting_approval') {
    p.status = 'executing';
    p.startedAt = p.startedAt ?? new Date().toISOString();
  }
  if (p.status !== 'executing') return p;

  // 找下一個 pending step
  const nextIdx = p.results.findIndex((r) => r.status === 'pending');
  if (nextIdx < 0) {
    // 全跑完，進 verify
    p.status = 'verifying';
    return p;
  }

  const step = p.steps[nextIdx];
  const result = p.results[nextIdx];
  result.status = 'running';
  result.startedAt = new Date().toISOString();

  // 模擬執行（demo 用 — 真實 wiring 要在 step.serviceCall 對應實際 service）
  await new Promise((res) => setTimeout(res, Math.max(100, step.estimateSeconds * 300)));

  // demo 模式一律成功；失敗 case 應透過 killSwitch / guardrail 觸發，不應該是隨機
  const ok = true;

  if (ok) {
    result.status = 'success';
    result.finishedAt = new Date().toISOString();
    result.output = `[demo] ${step.description} 完成`;
  } else {
    result.status = 'failed';
    result.finishedAt = new Date().toISOString();
    result.error = '示範用：模擬失敗，建議使用者介入';
    p.status = 'failed';
    p.finishedAt = result.finishedAt;
  }

  return p;
}

/**
 * 一鍵跑到底（所有 step 一次跑完 → verify）
 */
export async function executeAll(p: ActionPlan): Promise<ActionPlan> {
  while (
    p.status === 'planning' ||
    p.status === 'awaiting_approval' ||
    p.status === 'executing'
  ) {
    p = await executeNextStep(p);
    if (p.status === 'failed' || p.status === 'verifying') break;
  }
  if (p.status === 'verifying') {
    p = verify(p);
  }
  return p;
}

/**
 * 4. Verify — AI 自我審計
 */
export function verify(p: ActionPlan): ActionPlan {
  const total = p.steps.length;
  const ok = p.results.filter((r) => r.status === 'success').length;
  const failed = p.results.filter((r) => r.status === 'failed').length;
  const skipped = p.results.filter((r) => r.status === 'skipped').length;

  const successRate = total > 0 ? ok / total : 0;
  const success = failed === 0 && ok > 0;

  let summary: string;
  if (success) {
    summary = `✅ 全部 ${ok} 個步驟成功完成`;
  } else if (failed > 0) {
    summary = `⚠️ ${failed} 個步驟失敗，建議介入：${p.results.find((r) => r.status === 'failed')?.error ?? '查看 log'}`;
  } else {
    summary = `🟡 ${ok}/${total} 成功，${skipped} 個被跳過`;
  }

  p.verify = {
    success,
    summary,
    confidence: Math.round(successRate * 100),
    recommendations: success ? undefined : ['請手動處理失敗步驟', '或重試 plan'],
  };
  p.status = success ? 'done' : 'failed';
  p.finishedAt = new Date().toISOString();
  return p;
}

/**
 * 使用者批准 / 拒絕
 */
export function approve(p: ActionPlan): ActionPlan {
  if (p.status === 'awaiting_approval') {
    p.status = 'executing';
    p.startedAt = new Date().toISOString();
  }
  return p;
}

export function reject(p: ActionPlan, reason?: string): ActionPlan {
  p.status = 'rejected';
  p.finishedAt = new Date().toISOString();
  p.blockedReason = reason ?? '使用者拒絕';
  return p;
}

export function cancel(p: ActionPlan): ActionPlan {
  p.status = 'cancelled';
  p.finishedAt = new Date().toISOString();
  return p;
}

/**
 * Quiet hours / killSwitch 統合過濾 — autonomous mode 跑 step 前過
 */
export function isBlockedByGuardrail(p: ActionPlan, mode: AutonomyMode): { blocked: boolean; reason?: string } {
  if (mode !== 'autonomous') return { blocked: false };
  if (p.risk === 'high' && p.steps.some((s) => s.alwaysConfirm)) {
    return { blocked: true, reason: 'high-risk step requires confirm' };
  }
  // 取代呼叫 dynamicQuietHours（簡化）
  try {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 23 || hour < 6) return { blocked: true, reason: 'static_night quiet hours' };
  } catch {
    /* swallow */
  }
  return { blocked: false };
}

// ─────────────────────────────────────────────────────────
// 列出 registry — 給 UI 顯示「可由 AI Agent 代理的任務」
// ─────────────────────────────────────────────────────────

export function listAvailableIntents(role: AgentRole): IntentDefinition[] {
  return REGISTRY.filter((i) => i.role === role);
}

export function getAllRoleIntentCount(): Record<AgentRole, number> {
  return {
    student: REGISTRY.filter((i) => i.role === 'student').length,
    teacher: REGISTRY.filter((i) => i.role === 'teacher').length,
    ta: REGISTRY.filter((i) => i.role === 'ta').length,
    department: REGISTRY.filter((i) => i.role === 'department').length,
    vendor: REGISTRY.filter((i) => i.role === 'vendor').length,
  };
}

// ─────────────────────────────────────────────────────────
// 統計 — 用於 cockpit hero「AI 今日代你完成 N 件」
// ─────────────────────────────────────────────────────────

export interface AgentDailySummary {
  doneCount: number;
  pendingCount: number;
  awaitingApprovalCount: number;
  failedCount: number;
  lastDoneTitle?: string;
}

export function summarizeToday(plans: ActionPlan[]): AgentDailySummary {
  const today = new Date().toISOString().slice(0, 10);
  const todays = plans.filter((p) => p.createdAt.slice(0, 10) === today);

  const done = todays.filter((p) => p.status === 'done');
  const lastDone = done[0];

  return {
    doneCount: done.length,
    pendingCount: todays.filter((p) => p.status === 'planning' || p.status === 'executing' || p.status === 'verifying').length,
    awaitingApprovalCount: todays.filter((p) => p.status === 'awaiting_approval').length,
    failedCount: todays.filter((p) => p.status === 'failed').length,
    lastDoneTitle: lastDone?.title,
  };
}
