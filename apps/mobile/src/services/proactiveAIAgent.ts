/**
 * Proactive AI Agent — APP 的主動 AI 引擎
 *
 * 設計：AI 不只回答問題，更要 **主動觀察** 學生 / 老師 / 主任 / 餐廳的當下狀態，
 * 然後 push 出建議 / 預執行動作。
 *
 * 觸發點：
 *  - APP foreground（每次回到 APP）
 *  - 每 N 分鐘 background tick
 *  - 任一 RoleEvent emit 後
 *  - 任一手動 `runProactiveScan()`
 *
 * 輸出：`ProactiveSuggestion[]` — UI 可以選擇 surface / push notif / inbox 進件 / 自動執行。
 *
 * 純函式 + AsyncStorage 友善。LLM 是可選的（fallback rule-based）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  planNotifications,
  planStudy,
  predictCurrent,
  homeworkToPlannerTask,
  examToPlannerTask,
  dueToday as mistakesDueToday,
  type PlannerTask,
  type PredictorItem,
  type MistakeEntry,
} from '@campus/shared';
import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoExamsByCourse,
  getDemoScoreItemsByCourse,
  getDemoAttendanceByCourse,
} from '../data/demoCoursesMock';
import { getScopedStorageKey } from './scopedStorage';
import { loadVisibleRoleEventInbox } from './roleEventBus';
import {
  aiSummarizeStudentInbox,
  aiVendorNextAction,
  aiDepartmentHealthScore,
} from './aiOrchestrator';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type SuggestionKind =
  | 'urgent_action'        // 立刻做：開點名、3h 內到期
  | 'study_plan'           // 今日番茄鐘
  | 'grade_alert'          // 風險課程預警
  | 'mistake_practice'     // 錯題該複習了
  | 'companion_check'      // 校園精靈互動提醒
  | 'teacher_action'       // 老師：批改 / 紅旗
  | 'vendor_action'        // 餐廳：訂單堆積
  | 'department_action'    // 主任：教學評鑑
  | 'inbox_followup'       // 來自老師的事件後續
  | 'celebrate';           // 慶祝完成 milestone

export type SuggestionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'positive';

export interface ProactiveSuggestion {
  id: string;
  kind: SuggestionKind;
  severity: SuggestionSeverity;
  /** 顯示給 user 的 title */
  title: string;
  /** 顯示給 user 的 body */
  body: string;
  /** emoji 圖示 */
  emoji: string;
  /** 點擊後跳轉的 deep link (route?param=value) */
  deepLink?: string;
  /** 預執行的 tool name + args（AI 可自動執行的情況） */
  preExecute?: {
    toolName: string;
    args: Record<string, unknown>;
  };
  /** AI 信心分 0-100 */
  confidence: number;
  /** 推送時間 (ISO)；null 表示立即 */
  scheduledAt: string | null;
  /** 對應角色 */
  role: 'student' | 'teacher' | 'ta' | 'department' | 'vendor';
}

export interface ProactiveScanInput {
  /** 使用者 uid */
  uid: string;
  /** 使用者角色 */
  role: 'student' | 'teacher' | 'ta' | 'department' | 'vendor';
  /** 學校 id */
  schoolId?: string | null;
  /** 當下時間（測試可注入） */
  now?: string;
  /** 上一次掃過後已推過的 suggestion，避免重複 */
  recentlyPushed?: Array<{ id: string; pushedAt: string }>;
}

export interface ProactiveScanOutput {
  suggestions: ProactiveSuggestion[];
  /** AI 信心最高的一條，給 hero banner 用 */
  topSuggestion: ProactiveSuggestion | null;
  /** 掃描花的毫秒 */
  elapsedMs: number;
  /** 掃描到的 signal 數量 */
  signalCount: number;
}

// ─────────────────────────────────────────────────────────
// Storage helpers — 記錄已推過的 suggestion 避免重複
// ─────────────────────────────────────────────────────────

const PROACTIVE_HISTORY_BASE = 'proactive_ai_history_v1';

export async function loadProactiveHistory(
  uid: string,
): Promise<Array<{ id: string; pushedAt: string }>> {
  try {
    const key = getScopedStorageKey(PROACTIVE_HISTORY_BASE, { uid });
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveProactiveHistory(
  uid: string,
  suggestion: ProactiveSuggestion,
): Promise<void> {
  try {
    const key = getScopedStorageKey(PROACTIVE_HISTORY_BASE, { uid });
    const arr = await loadProactiveHistory(uid);
    arr.unshift({ id: suggestion.id, pushedAt: new Date().toISOString() });
    // 限制 100 筆
    await AsyncStorage.setItem(key, JSON.stringify(arr.slice(0, 100)));
  } catch {
    /* swallow */
  }
}

function isDedupe(
  suggId: string,
  history: Array<{ id: string; pushedAt: string }>,
  now: string,
  windowHours: number = 4,
): boolean {
  for (const h of history) {
    if (h.id === suggId) {
      const ageHours = (new Date(now).getTime() - new Date(h.pushedAt).getTime()) / 3_600_000;
      if (ageHours < windowHours) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────
// Per-role scanner
// ─────────────────────────────────────────────────────────

async function scanForStudent(input: ProactiveScanInput): Promise<ProactiveSuggestion[]> {
  const now = input.now ?? new Date().toISOString();
  const out: ProactiveSuggestion[] = [];

  // 1. 構建 PlannerTasks → planStudy
  const tasks: PlannerTask[] = [];
  for (const c of DEMO_COURSES) {
    for (const hw of getDemoHomeworksByCourse(c.id)) {
      tasks.push(homeworkToPlannerTask({
        id: hw.id, courseId: hw.courseId, courseName: c.name,
        title: hw.title, dueAt: hw.dueAt, submitted: hw.submitted, totalScore: hw.totalScore,
      }));
    }
    for (const e of getDemoExamsByCourse(c.id)) {
      tasks.push(examToPlannerTask({
        id: e.id, courseId: e.courseId, courseName: c.name,
        title: e.title, startAt: e.startAt, isPractice: e.isPractice,
        submitted: e.submitted, totalScore: e.totalScore,
      }));
    }
  }
  const plan = planStudy(tasks, { now });

  // 2. 通知層的 critical/high
  const allHomeworks = DEMO_COURSES.flatMap((c) =>
    getDemoHomeworksByCourse(c.id).map((hw) => ({
      id: hw.id, courseId: hw.courseId, courseName: c.name,
      title: hw.title, dueAt: hw.dueAt, submitted: hw.submitted,
    })),
  );
  const allExams = DEMO_COURSES.flatMap((c) =>
    getDemoExamsByCourse(c.id).map((e) => ({
      id: e.id, courseId: e.courseId, courseName: c.name,
      title: e.title, startAt: e.startAt, submitted: e.submitted,
    })),
  );
  const notifs = planNotifications({ now, homeworks: allHomeworks, exams: allExams });

  for (const n of notifs.filter((x) => x.severity === 'critical' || x.severity === 'high').slice(0, 3)) {
    out.push({
      id: `student_urgent_${n.id}`,
      kind: 'urgent_action',
      severity: n.severity as SuggestionSeverity,
      title: n.title,
      body: n.body,
      emoji: n.emoji,
      deepLink: n.deepLink,
      confidence: 90,
      scheduledAt: n.scheduledAt,
      role: 'student',
    });
  }

  // 3. 風險課程（預估 < 70）
  for (const c of DEMO_COURSES) {
    const items = getDemoScoreItemsByCourse(c.id);
    const pred = predictCurrent(items.map((s): PredictorItem => ({
      id: String(s.id), title: s.name, weight: s.weight,
      maxScore: s.totalScore, score: s.studentScore, graded: s.studentScore !== null,
    })));
    if (pred.likelyCase !== null && pred.likelyCase < 70) {
      out.push({
        id: `student_risk_${c.id}`,
        kind: 'grade_alert',
        severity: pred.likelyCase < 60 ? 'critical' : 'high',
        title: `${c.iconEmoji} ${c.name} 預估僅 ${pred.likelyCase}%`,
        body: 'AI 建議：開試算頁試試把剩下項目拉到 80 分，看總分能拉多高',
        emoji: '🚨',
        deepLink: `GradeWhatIf?courseId=${c.id}`,
        confidence: 80,
        scheduledAt: null,
        role: 'student',
      });
    }
  }

  // 4. 錯題本該複習了
  try {
    const mistakeKey = getScopedStorageKey('mistake_repertoire_v1', { uid: input.uid, schoolId: input.schoolId ?? null });
    const raw = await AsyncStorage.getItem(mistakeKey);
    const list: MistakeEntry[] = raw ? JSON.parse(raw) : [];
    const due = mistakesDueToday(list, now);
    if (due.length >= 3) {
      out.push({
        id: 'student_mistakes_due',
        kind: 'mistake_practice',
        severity: 'medium',
        title: `🧠 ${due.length} 題錯題該複習了`,
        body: 'AI 按 Leitner 演算法判斷今天該回顧這些題；花 10 分鐘吸收率會明顯上升',
        emoji: '🧠',
        deepLink: 'MistakeRepertoire',
        confidence: 75,
        scheduledAt: null,
        role: 'student',
      });
    }
  } catch { /* swallow */ }

  // 5. 來自老師的 inbox 摘要
  try {
    const events = await loadVisibleRoleEventInbox({ uid: input.uid, role: input.role });
    const inboxSummary = aiSummarizeStudentInbox(events);
    if (inboxSummary.recommendedAction) {
      out.push({
        id: 'student_inbox_summary',
        kind: 'inbox_followup',
        severity: inboxSummary.priorityCount >= 5 ? 'high' : 'medium',
        title: '📥 來自老師的新動態',
        body: inboxSummary.recommendedAction,
        emoji: '📥',
        deepLink: 'TodayHome',
        confidence: 85,
        scheduledAt: null,
        role: 'student',
      });
    }
  } catch { /* swallow */ }

  // 6. 慶祝：今天沒有 overdue + 完成 pomodoro
  if (plan.overdueTasks.length === 0 && plan.prioritized.length > 0 && plan.pomodoros.length >= 4) {
    out.push({
      id: `student_celebrate_${now.slice(0, 10)}`,
      kind: 'celebrate',
      severity: 'positive',
      title: '✨ 今天節奏不錯',
      body: 'AI：沒有逾期、安排了番茄鐘。完成 1 個就先慶祝一下，再開始下一個',
      emoji: '✨',
      confidence: 60,
      scheduledAt: null,
      role: 'student',
    });
  }

  // 7. 預執行：今天 study plan 建議排程
  if (plan.pomodoros.length > 0) {
    out.push({
      id: `student_plan_${now.slice(0, 10)}`,
      kind: 'study_plan',
      severity: 'medium',
      title: `📋 AI 已產出今日番茄鐘排程`,
      body: plan.summary,
      emoji: '📋',
      deepLink: 'TodayHome',
      confidence: 70,
      scheduledAt: null,
      role: 'student',
    });
  }

  return out;
}

async function scanForTeacher(input: ProactiveScanInput): Promise<ProactiveSuggestion[]> {
  const out: ProactiveSuggestion[] = [];
  let totalPending = 0;
  const flagged: string[] = [];

  for (const c of DEMO_COURSES) {
    const hws = getDemoHomeworksByCourse(c.id);
    const pending = hws.filter((h) => h.submitted && !h.graded).length;
    totalPending += pending;
    const items = getDemoScoreItemsByCourse(c.id);
    const pred = predictCurrent(items.map((s): PredictorItem => ({
      id: String(s.id), title: s.name, weight: s.weight,
      maxScore: s.totalScore, score: s.studentScore, graded: s.studentScore !== null,
    })));
    if (pred.likelyCase !== null && pred.likelyCase < 70) flagged.push(c.name);
  }

  if (totalPending >= 5) {
    out.push({
      id: 'teacher_pending_grading',
      kind: 'teacher_action',
      severity: 'high',
      title: `📝 待批改累積 ${totalPending} 份`,
      body: 'AI 建議：先批改作業堆最多那門課。可呼叫 AI 起草評語節省時間',
      emoji: '📝',
      deepLink: 'TeacherCockpit',
      confidence: 85,
      scheduledAt: null,
      role: 'teacher',
    });
  }
  if (flagged.length > 0) {
    out.push({
      id: 'teacher_flagged_classes',
      kind: 'teacher_action',
      severity: 'high',
      title: `🚩 ${flagged.length} 門課班級平均偏低`,
      body: `${flagged.join('、')}。AI 建議：開啟教學評鑑頁查趨勢`,
      emoji: '🚩',
      deepLink: 'TeacherCockpit',
      confidence: 80,
      scheduledAt: null,
      role: 'teacher',
    });
  }
  return out;
}

async function scanForDepartment(input: ProactiveScanInput): Promise<ProactiveSuggestion[]> {
  const ai = aiDepartmentHealthScore();
  const out: ProactiveSuggestion[] = [];
  if (ai.score < 70) {
    out.push({
      id: 'dept_health_low',
      kind: 'department_action',
      severity: 'high',
      title: `🏛 系所健康度 ${ai.score}%`,
      body: ai.suggestions[0] ?? '建議檢視風險課程',
      emoji: '🏛',
      deepLink: 'TodayHome',
      confidence: 80,
      scheduledAt: null,
      role: 'department',
    });
  }
  if (ai.topRisks.length > 0) {
    out.push({
      id: 'dept_top_risk',
      kind: 'department_action',
      severity: 'medium',
      title: `⚠️ ${ai.topRisks.length} 項風險警示`,
      body: ai.topRisks.slice(0, 2).join('；'),
      emoji: '⚠️',
      deepLink: 'TodayHome',
      confidence: 75,
      scheduledAt: null,
      role: 'department',
    });
  }
  return out;
}

async function scanForVendor(input: ProactiveScanInput): Promise<ProactiveSuggestion[]> {
  // 依該 vendor 員工綁定的每個店家分別 scan，再聚合 top suggestions
  const { DEMO_MERCHANTS, DEMO_MERCHANT_ORDERS, getDemoOrdersByMerchant } = await import('../data/demoMerchants');
  const out: ProactiveSuggestion[] = [];

  // demo: demo_cafeteria 員工 → 3 個店家
  const merchantIds = input.uid === 'demo_cafeteria'
    ? ['merchant_cafe_a', 'merchant_coffee_b', 'merchant_noodle_f']
    : DEMO_MERCHANTS.slice(0, 2).map((m) => m.id);

  for (const merchantId of merchantIds) {
    const m = DEMO_MERCHANTS.find((x) => x.id === merchantId);
    if (!m) continue;
    const orders = getDemoOrdersByMerchant(merchantId);
    const pending = orders.filter((o) => o.status === 'pending').length;
    const processing = orders.filter((o) => o.status === 'processing').length;
    const ready = orders.filter((o) => o.status === 'ready').length;
    const oldest = orders
      .filter((o) => o.status === 'pending')
      .reduce((mx, o) => {
        const mins = (Date.now() - new Date(o.orderedAt).getTime()) / 60_000;
        return Math.max(mx, mins);
      }, 0);
    const ai = aiVendorNextAction({
      pendingOrders: pending,
      processingOrders: processing,
      readyOrders: ready,
      oldestPendingMinutes: Math.round(oldest),
      isOpen: m.isOpen,
      category: m.category as any,
      todayRevenue: m.todayRevenue,
      todayServed: m.todayServedCount,
    });
    out.push({
      id: `vendor_next_action_${merchantId}`,
      kind: 'vendor_action',
      severity: ai.severity,
      title: `${m.emoji} ${m.name}`,
      body: ai.action,
      emoji: m.emoji,
      deepLink: 'TodayHome',
      confidence: 70,
      scheduledAt: null,
      role: 'vendor',
    });
  }

  return out;
}

async function scanForTA(input: ProactiveScanInput): Promise<ProactiveSuggestion[]> {
  // 助教看待批改 + 學生提問
  let pendingGrading = 0;
  for (const c of DEMO_COURSES) {
    pendingGrading += getDemoHomeworksByCourse(c.id).filter((h) => h.submitted && !h.graded).length;
  }
  const out: ProactiveSuggestion[] = [];
  if (pendingGrading >= 3) {
    out.push({
      id: 'ta_pending_grading',
      kind: 'teacher_action',
      severity: 'medium',
      title: `✍️ 老師指派 ${pendingGrading} 份待批改`,
      body: 'AI 建議：早上頭腦清楚，先處理批改任務',
      emoji: '✍️',
      deepLink: 'TodayHome',
      confidence: 75,
      scheduledAt: null,
      role: 'ta',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// Main: runProactiveScan
// ─────────────────────────────────────────────────────────

export async function runProactiveScan(input: ProactiveScanInput): Promise<ProactiveScanOutput> {
  const start = Date.now();
  const now = input.now ?? new Date().toISOString();

  let suggestions: ProactiveSuggestion[] = [];
  switch (input.role) {
    case 'student':
      suggestions = await scanForStudent(input);
      break;
    case 'teacher':
      suggestions = await scanForTeacher(input);
      break;
    case 'ta':
      suggestions = await scanForTA(input);
      break;
    case 'department':
      suggestions = await scanForDepartment(input);
      break;
    case 'vendor':
      suggestions = await scanForVendor(input);
      break;
  }

  // 去重：與 recentlyPushed 比對
  const history = input.recentlyPushed ?? [];
  const fresh = suggestions.filter((s) => !isDedupe(s.id, history, now));

  // 排序：severity > confidence
  const sevOrder: Record<SuggestionSeverity, number> = {
    critical: 0, high: 1, medium: 2, low: 3, positive: 4,
  };
  fresh.sort((a, b) => {
    const sd = sevOrder[a.severity] - sevOrder[b.severity];
    if (sd !== 0) return sd;
    return b.confidence - a.confidence;
  });

  return {
    suggestions: fresh,
    topSuggestion: fresh[0] ?? null,
    elapsedMs: Date.now() - start,
    signalCount: suggestions.length,
  };
}

// ─────────────────────────────────────────────────────────
// React-friendly：自動 schedule scan
// ─────────────────────────────────────────────────────────

let SCAN_INTERVAL_HANDLE: ReturnType<typeof setInterval> | null = null;

export function startProactiveBackgroundLoop(opts: {
  uid: string;
  role: ProactiveScanInput['role'];
  schoolId?: string | null;
  intervalMinutes?: number;
  onSuggestion?: (s: ProactiveSuggestion) => void;
}): () => void {
  const interval = (opts.intervalMinutes ?? 15) * 60_000;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const history = await loadProactiveHistory(opts.uid);
      const result = await runProactiveScan({
        uid: opts.uid,
        role: opts.role,
        schoolId: opts.schoolId,
        recentlyPushed: history,
      });
      if (result.topSuggestion && opts.onSuggestion) {
        opts.onSuggestion(result.topSuggestion);
        await saveProactiveHistory(opts.uid, result.topSuggestion);
      }
    } catch {
      /* swallow */
    }
  }

  // 立即跑一次 + interval
  tick();
  SCAN_INTERVAL_HANDLE = setInterval(tick, interval);

  return () => {
    stopped = true;
    if (SCAN_INTERVAL_HANDLE) {
      clearInterval(SCAN_INTERVAL_HANDLE);
      SCAN_INTERVAL_HANDLE = null;
    }
  };
}
