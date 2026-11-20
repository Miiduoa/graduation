/**
 * Study Planner — 跨課智慧排程引擎（TronClass 沒有）
 *
 * 把學生「今天/本週所有的待辦」根據 deadline、預估時長、重要度、課表空檔
 * 整合排出建議的執行序列：
 *  - 今天要做什麼（建議排序）
 *  - 一段時間內每個 25 分鐘番茄鐘該做什麼
 *  - 預警「再不做來不及」的項目
 *
 * 完全純函式，無 I/O 依賴。在 mobile / cloud / web 共用。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type TaskKind = 'homework' | 'exam' | 'quiz' | 'reading' | 'project' | 'peer_review' | 'discussion';

export interface PlannerTask {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  kind: TaskKind;
  /** ISO 8601 截止；null 表示沒有死線（例如教材複習） */
  dueAt: string | null;
  /** 預估完成需要的分鐘數 */
  estimatedMinutes: number;
  /** 0-100 重要度（影響成績權重 → 高 = 重要） */
  importance: number;
  /** 已完成多少（0-1） */
  progress?: number;
  /** 已繳交 / 已通過 → 排除 */
  done?: boolean;
}

export interface FreeSlot {
  /** ISO start */
  start: string;
  /** ISO end */
  end: string;
  /** 'between_classes' / 'evening' / 'early_morning' ... 用於 UI 顯示 */
  label?: string;
}

export interface PlannerOptions {
  /** 'now' 計算當下時間 (ISO)；測試可注入固定值 */
  now?: string;
  /** 番茄鐘長度，預設 25 分鐘 */
  pomodoroMinutes?: number;
  /** 連續 N 個番茄鐘後需要長休息 */
  longBreakAfter?: number;
  /** 學生自評每日可投入學習分鐘數，預設 240 (4 小時) */
  dailyBudgetMinutes?: number;
}

export interface PrioritizedTask extends PlannerTask {
  /** 內部計分，數值越大越優先 */
  priorityScore: number;
  /** 距離 deadline 還有多少小時；null 表示沒有死線 */
  hoursUntilDue: number | null;
  /** 'overdue' | 'urgent' | 'soon' | 'later' */
  urgency: 'overdue' | 'urgent' | 'soon' | 'later' | 'no_deadline';
  /** AI 解釋為什麼排這個位置 */
  reason: string;
}

export interface PomodoroSlot {
  /** 序號，從 1 開始 */
  index: number;
  /** 0-indexed 起始分鐘（相對於 now） */
  startMinute: number;
  /** 結束分鐘（不含休息） */
  endMinute: number;
  /** 接下來休息幾分鐘 (5 短休 / 15 長休) */
  breakMinutes: number;
  /** 這個番茄鐘建議做哪個 task（taskId） */
  taskId: string;
  /** 顯示用：course + title */
  label: string;
}

export interface PlannerOutput {
  /** 今日建議優先序（已排好） */
  prioritized: PrioritizedTask[];
  /** 番茄鐘排程 */
  pomodoros: PomodoroSlot[];
  /** 已超過 deadline 的任務 (需要展示「先求補交」) */
  overdueTasks: PrioritizedTask[];
  /** 一句話 AI 總結建議 */
  summary: string;
  /** 投入時間總計（分鐘） */
  totalEstimatedMinutes: number;
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function hoursBetween(fromIso: string, toIso: string | null): number | null {
  if (!toIso) return null;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / (1000 * 60 * 60);
}

function classifyUrgency(hoursLeft: number | null): PrioritizedTask['urgency'] {
  if (hoursLeft === null) return 'no_deadline';
  if (hoursLeft < 0) return 'overdue';
  if (hoursLeft <= 24) return 'urgent';
  if (hoursLeft <= 72) return 'soon';
  return 'later';
}

/**
 * 計算優先分數
 *  - importance (0-100)：直接加
 *  - urgency: overdue +400, urgent +200, soon +80, later +20
 *  - 預估時長：超過 120 分鐘的給負分（避免大任務硬塞）
 *  - 進度：50% 以上的給加分（推完它比開新的好）
 */
function priorityScore(task: PlannerTask, hoursLeft: number | null): number {
  let score = task.importance;
  if (hoursLeft === null) {
    score += 5; // 沒死線的稍微 deprioritize
  } else if (hoursLeft < 0) {
    score += 400; // 過期了一定要先處理
  } else if (hoursLeft <= 24) {
    score += 200;
  } else if (hoursLeft <= 72) {
    score += 80;
  } else {
    score += 20;
  }

  if (task.estimatedMinutes > 120) score -= 15;
  if ((task.progress ?? 0) >= 0.5) score += 25;

  return Math.round(score);
}

function explainReason(t: PlannerTask, urgency: PrioritizedTask['urgency'], hoursLeft: number | null): string {
  switch (urgency) {
    case 'overdue':
      return `已逾期 ${Math.abs(Math.round(hoursLeft ?? 0))} 小時，先設法補交或請假`;
    case 'urgent':
      return `${Math.round(hoursLeft ?? 0)} 小時內到期，優先處理`;
    case 'soon':
      return `${Math.round((hoursLeft ?? 0) / 24)} 天內到期，今天投入一段時間`;
    case 'later':
      return `還有 ${Math.round((hoursLeft ?? 0) / 24)} 天，可以分散處理`;
    default:
      return t.kind === 'reading'
        ? '無死線複習，今天有空再翻'
        : '建議列入週計畫';
  }
}

// ─────────────────────────────────────────────────────────
// Main: planStudy
// ─────────────────────────────────────────────────────────

export function planStudy(tasks: PlannerTask[], options: PlannerOptions = {}): PlannerOutput {
  const now = options.now ?? new Date().toISOString();
  const pomodoroMinutes = options.pomodoroMinutes ?? 25;
  const longBreakAfter = options.longBreakAfter ?? 4;
  const dailyBudget = options.dailyBudgetMinutes ?? 240;

  // 1. 過濾已完成
  const active = tasks.filter((t) => !t.done);

  // 2. 計算優先序
  const prioritized: PrioritizedTask[] = active
    .map((t) => {
      const hoursLeft = hoursBetween(now, t.dueAt);
      const urgency = classifyUrgency(hoursLeft);
      return {
        ...t,
        hoursUntilDue: hoursLeft,
        urgency,
        priorityScore: priorityScore(t, hoursLeft),
        reason: explainReason(t, urgency, hoursLeft),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);

  // 3. 抓出 overdue 單獨呈現
  const overdueTasks = prioritized.filter((p) => p.urgency === 'overdue');

  // 4. 番茄鐘排程：在 dailyBudget 內依優先序填入
  const pomodoros: PomodoroSlot[] = [];
  let cursorMinute = 0;
  let pomoIdx = 0;
  const remainingPerTask = new Map<string, number>();
  for (const t of prioritized) {
    // overdue 任務先排「修補」一段時間（25 分鐘）；
    // 其他依 estimatedMinutes × (1 - progress) 投入
    const remain = t.urgency === 'overdue'
      ? Math.min(50, t.estimatedMinutes)
      : Math.ceil(t.estimatedMinutes * (1 - (t.progress ?? 0)));
    remainingPerTask.set(t.id, Math.max(remain, 0));
  }

  for (const t of prioritized) {
    while ((remainingPerTask.get(t.id) ?? 0) > 0 && cursorMinute < dailyBudget) {
      pomoIdx += 1;
      const breakMin = pomoIdx % longBreakAfter === 0 ? 15 : 5;
      pomodoros.push({
        index: pomoIdx,
        startMinute: cursorMinute,
        endMinute: cursorMinute + pomodoroMinutes,
        breakMinutes: breakMin,
        taskId: t.id,
        label: `${t.courseName} · ${t.title}`,
      });
      cursorMinute += pomodoroMinutes + breakMin;
      const left = (remainingPerTask.get(t.id) ?? 0) - pomodoroMinutes;
      remainingPerTask.set(t.id, left);
    }
    if (cursorMinute >= dailyBudget) break;
  }

  // 5. 總結
  const totalEstimated = prioritized.reduce(
    (s, t) => s + Math.ceil(t.estimatedMinutes * (1 - (t.progress ?? 0))),
    0,
  );

  let summary: string;
  if (overdueTasks.length > 0) {
    summary = `有 ${overdueTasks.length} 項已逾期，建議先聯絡老師補交，再處理 ${prioritized.length - overdueTasks.length} 項今日任務。`;
  } else if (prioritized.length === 0) {
    summary = '今天沒有待辦，建議翻翻教材或寫複習筆記。';
  } else {
    const urgent = prioritized.filter((p) => p.urgency === 'urgent');
    const soon = prioritized.filter((p) => p.urgency === 'soon');
    summary = urgent.length > 0
      ? `今天最該處理 ${urgent.length} 件 24 小時內到期的任務；安排 ${pomodoros.length} 個番茄鐘約 ${cursorMinute} 分鐘。`
      : soon.length > 0
        ? `本週有 ${soon.length} 件任務逐漸接近，可分散處理；今天先做 ${pomodoros.length} 個番茄鐘。`
        : `今日相對輕鬆；建議用 ${pomodoros.length} 個番茄鐘提前推進專題或補強教材。`;
  }

  return {
    prioritized,
    pomodoros,
    overdueTasks,
    summary,
    totalEstimatedMinutes: totalEstimated,
  };
}

// ─────────────────────────────────────────────────────────
// 便利包裝：從 demo / TC fetch 結果轉成 PlannerTask
// ─────────────────────────────────────────────────────────

export function homeworkToPlannerTask(input: {
  id: number | string;
  courseId: number | string;
  courseName: string;
  title: string;
  dueAt: string | null;
  submitted?: boolean;
  totalScore?: number;
  estimatedMinutes?: number;
}): PlannerTask {
  return {
    id: `hw_${input.id}`,
    courseId: String(input.courseId),
    courseName: input.courseName,
    title: input.title,
    kind: 'homework',
    dueAt: input.dueAt,
    estimatedMinutes: input.estimatedMinutes ?? 90,
    importance: Math.min(100, Math.round(((input.totalScore ?? 100) / 100) * 60 + 30)),
    done: input.submitted === true,
  };
}

export function examToPlannerTask(input: {
  id: number | string;
  courseId: number | string;
  courseName: string;
  title: string;
  startAt: string | null;
  isPractice?: boolean;
  submitted?: boolean;
  totalScore?: number;
}): PlannerTask {
  return {
    id: `exam_${input.id}`,
    courseId: String(input.courseId),
    courseName: input.courseName,
    title: input.title,
    kind: input.isPractice ? 'quiz' : 'exam',
    dueAt: input.startAt,
    estimatedMinutes: input.isPractice ? 30 : 120,
    importance: input.isPractice ? 50 : 90,
    done: input.submitted === true,
  };
}
