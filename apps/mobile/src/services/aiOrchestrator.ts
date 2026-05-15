/**
 * AI Orchestrator — APP 的 AI 代理大腦
 *
 * 設計理念：APP 主打 AI 代理一切。每個角色每個動作前後都會經過 AI 演算：
 *  - 動作前：AI 預檢 / 預測 / 建議
 *  - 動作後：AI 重算下游影響、推送相關角色
 *  - 跨角色：把每個 emit 過的 RoleEvent 都作為 AI signal，重算 student/teacher 的待辦排序
 *
 * 不是把 AI 塞進對話框；是讓 AI **決定** 每個動作的下一步。
 *
 * 純函式 + AsyncStorage 友善。所有計算都是 deterministic，無 I/O 依賴。
 */
import {
  draftFeedback,
  predictCurrent,
  simulateWhatIf,
  planStudy,
  planNotifications,
  homeworkToPlannerTask,
  examToPlannerTask,
  type PlannerTask,
  type PredictorItem,
  type NotificationItem,
} from '@campus/shared';

import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoExamsByCourse,
  getDemoScoreItemsByCourse,
} from '../data/demoCoursesMock';
import { emitRoleEvent, type RoleEvent } from './roleEventBus';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type ActorRole = 'student' | 'teacher' | 'ta' | 'department' | 'vendor';

export interface AIDecision {
  /** 建議的下一步動作（給 UI 顯示） */
  suggestion: string;
  /** AI 信心度 0-100 */
  confidence: number;
  /** 受影響的下游角色 / 課程 */
  affects: Array<{ role: ActorRole; courseId?: number; reason: string }>;
  /** 預測影響（如 grade delta） */
  forecast?: {
    metric: string;
    before: number | null;
    after: number | null;
    delta: number | null;
  };
  /** 是否需要使用者確認 */
  needsConfirm: boolean;
}

// ─────────────────────────────────────────────────────────
// 1. Teacher 動作前的 AI 預檢
// ─────────────────────────────────────────────────────────

export interface TeacherGradeInput {
  courseId: number;
  homeworkId: number;
  studentUid: string;
  studentName: string;
  newScore: number;
}

/**
 * 老師批改前 → AI 演算：
 *  - 預估這份分數會讓學生總成績怎麼變
 *  - 是否會把學生推到 atRisk
 *  - 建議是否同時發評語
 */
export function aiPreReviewGrade(input: TeacherGradeInput): AIDecision {
  const items = getDemoScoreItemsByCourse(input.courseId);
  const before = predictCurrent(items.map((s): PredictorItem => ({
    id: String(s.id),
    title: s.name,
    weight: s.weight,
    maxScore: s.totalScore,
    score: s.studentScore,
    graded: s.studentScore !== null,
  })));

  // 用 simulateWhatIf 假設老師打的分數套到該作業項目
  const matchedItem = items.find((s) => s.name.includes('作業') || s.type === 'homework');
  const overrides = matchedItem
    ? [{ itemId: String(matchedItem.id), assumedScore: input.newScore }]
    : [];
  const after = simulateWhatIf(
    items.map((s): PredictorItem => ({
      id: String(s.id),
      title: s.name,
      weight: s.weight,
      maxScore: s.totalScore,
      score: s.studentScore,
      graded: s.studentScore !== null,
    })),
    overrides,
  );

  const beforeLikely = before.likelyCase;
  const afterLikely = after.likelyCase;
  const delta = beforeLikely !== null && afterLikely !== null
    ? Math.round((afterLikely - beforeLikely) * 10) / 10
    : null;

  const wasAtRisk = beforeLikely !== null && beforeLikely < 70;
  const willBeAtRisk = afterLikely !== null && afterLikely < 70;
  const movedToRisk = !wasAtRisk && willBeAtRisk;
  const movedFromRisk = wasAtRisk && !willBeAtRisk;

  let suggestion: string;
  if (movedToRisk) {
    suggestion = `這份分數會讓 ${input.studentName} 的預估成績從 ${beforeLikely}% 跌到 ${afterLikely}%（紅旗）。建議同步發鼓勵性評語 + 標記為需要關注。`;
  } else if (movedFromRisk) {
    suggestion = `學生 ${input.studentName} 從紅旗區回到 ${afterLikely}%。建議發肯定評語強化動機。`;
  } else if (input.newScore < 60) {
    suggestion = `${input.newScore} 分偏低。建議用「鼓勵」tone 起草評語，並指出 1-2 個具體改進點。`;
  } else if (input.newScore >= 90) {
    suggestion = `${input.newScore} 分優異。建議簡短肯定即可，避免過度讚美失去意義。`;
  } else {
    suggestion = `分數合理。${delta !== null ? `學生總成績將變化 ${delta > 0 ? '+' : ''}${delta}%。` : ''}`;
  }

  return {
    suggestion,
    confidence: 80,
    affects: [
      { role: 'student', courseId: input.courseId, reason: '收到評語 + 成績更新' },
      ...(movedToRisk
        ? [{ role: 'department' as ActorRole, courseId: input.courseId, reason: '紅旗學生數 +1' }]
        : []),
    ],
    forecast: delta !== null
      ? { metric: '預估總成績', before: beforeLikely, after: afterLikely, delta }
      : undefined,
    needsConfirm: movedToRisk || input.newScore < 50,
  };
}

// ─────────────────────────────────────────────────────────
// 2. AI 預測「老師發 bulk reminder 後學生有多少會交」
// ─────────────────────────────────────────────────────────

export interface BulkReminderForecastInput {
  homeworkTitle: string;
  hoursUntilDue: number;
  studentCount: number;
  tone: 'strict' | 'neutral' | 'encouraging';
}

export function aiForecastBulkReminder(input: BulkReminderForecastInput): AIDecision {
  // 簡單模型：tone × hoursUntilDue → 預估補交率
  let baseRate = 0.5;
  if (input.hoursUntilDue < 6) baseRate += 0.2;
  else if (input.hoursUntilDue < 24) baseRate += 0.15;
  else if (input.hoursUntilDue > 72) baseRate -= 0.1;

  if (input.tone === 'strict') baseRate += 0.05;
  if (input.tone === 'encouraging') baseRate += 0.1;

  const predicted = Math.max(0, Math.min(1, baseRate));
  const expectedSubmissions = Math.round(input.studentCount * predicted);

  return {
    suggestion: `AI 預估發送後約 ${expectedSubmissions}/${input.studentCount} 人會在截止前補交（${Math.round(predicted * 100)}%）。${
      input.tone === 'strict' && input.hoursUntilDue < 6
        ? '時間緊張 + 嚴格語氣可能讓部分學生焦慮，建議改用中性。'
        : input.hoursUntilDue > 48 && input.tone === 'strict'
          ? '距離截止還久，嚴格語氣可能適得其反。改用鼓勵 tone 效果更好。'
          : '配置合適。'
    }`,
    confidence: 65,
    affects: [
      { role: 'student', reason: `${expectedSubmissions} 人預計補交` },
      { role: 'teacher', reason: `預計後續批改負擔 +${expectedSubmissions} 份` },
    ],
    forecast: {
      metric: '補交率',
      before: 0,
      after: Math.round(predicted * 100),
      delta: Math.round(predicted * 100),
    },
    needsConfirm: input.tone === 'strict' && input.hoursUntilDue < 6,
  };
}

// ─────────────────────────────────────────────────────────
// 3. 學生 inbox 進件 → AI 即時摘要
// ─────────────────────────────────────────────────────────

export function aiSummarizeStudentInbox(events: RoleEvent<unknown>[]): {
  summary: string;
  priorityCount: number;
  recommendedAction: string | null;
} {
  if (events.length === 0) {
    return { summary: '目前沒有新動態。', priorityCount: 0, recommendedAction: null };
  }
  const critical = events.filter((e) => e.kind === 'attendance_session_opened').length;
  const grades = events.filter((e) => e.kind === 'grade_published').length;
  const feedback = events.filter((e) => e.kind === 'feedback_drafted').length;
  const reminders = events.filter((e) => e.kind === 'bulk_reminder_sent').length;
  const hwPublished = events.filter((e) => e.kind === 'homework_published').length;

  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} 個老師正在點名（立即處理）`);
  if (reminders > 0) parts.push(`${reminders} 份作業提醒（檢查是否需補交）`);
  if (grades > 0) parts.push(`${grades} 個新成績`);
  if (feedback > 0) parts.push(`${feedback} 份老師評語`);
  if (hwPublished > 0) parts.push(`${hwPublished} 份新作業發布`);

  const summary = parts.join('、') + '。';
  let recommendedAction: string | null = null;
  if (critical > 0) recommendedAction = '立刻進入正在點名的課程簽到';
  else if (reminders > 0) recommendedAction = '檢查作業提醒，安排補交';
  else if (feedback > 0) recommendedAction = '查看老師評語並更新錯題本';

  return {
    summary,
    priorityCount: critical * 3 + reminders * 2 + grades + feedback,
    recommendedAction,
  };
}

// ─────────────────────────────────────────────────────────
// 4. 學生改 what-if → AI 反饋
// ─────────────────────────────────────────────────────────

export function aiCommentOnWhatIf(input: {
  itemTitle: string;
  newScore: number;
  newTotal: number | null;
  oldGrade: number | null;
  newGrade: number | null;
}): string {
  const delta = input.oldGrade !== null && input.newGrade !== null
    ? Math.round((input.newGrade - input.oldGrade) * 10) / 10
    : null;
  if (delta === null) return 'AI 還在算…';
  if (delta >= 5)
    return `若 ${input.itemTitle} 真的拿到 ${input.newScore}${input.newTotal ? ` / ${input.newTotal}` : ''}，總成績可拉高 ${delta}%！值得衝刺。`;
  if (delta >= 1)
    return `${input.itemTitle} 拿到 ${input.newScore} 會讓總成績 +${delta}%。合理但邊際效益不高。`;
  if (delta <= -5)
    return `⚠️ ${input.itemTitle} 拿到 ${input.newScore} 會讓總成績下跌 ${Math.abs(delta)}%。建議補強。`;
  return `${input.itemTitle} 改成 ${input.newScore} 影響不大（${delta > 0 ? '+' : ''}${delta}%）。`;
}

// ─────────────────────────────────────────────────────────
// 5. 系所層 — AI 教學健康度評分
// ─────────────────────────────────────────────────────────

export function aiDepartmentHealthScore(): {
  score: number; // 0-100
  topRisks: string[];
  suggestions: string[];
} {
  const courseHealth: Array<{ name: string; score: number; pending: number }> = [];

  for (const c of DEMO_COURSES) {
    const items = getDemoScoreItemsByCourse(c.id);
    const hws = getDemoHomeworksByCourse(c.id);
    const pred = predictCurrent(items.map((s): PredictorItem => ({
      id: String(s.id),
      title: s.name,
      weight: s.weight,
      maxScore: s.totalScore,
      score: s.studentScore,
      graded: s.studentScore !== null,
    })));
    const pending = hws.filter((h) => h.submitted && !h.graded).length;
    courseHealth.push({
      name: c.name,
      score: pred.likelyCase ?? 75,
      pending,
    });
  }

  const avg = courseHealth.reduce((s, c) => s + c.score, 0) / Math.max(1, courseHealth.length);
  const totalPending = courseHealth.reduce((s, c) => s + c.pending, 0);
  // 健康度 = 班均 - 待批改負擔扣分
  const score = Math.max(0, Math.min(100, Math.round(avg - totalPending * 1.5)));

  const topRisks: string[] = [];
  for (const ch of courseHealth) {
    if (ch.score < 70) topRisks.push(`${ch.name} 預估 ${ch.score}%`);
    if (ch.pending >= 3) topRisks.push(`${ch.name} 待批改 ${ch.pending} 份`);
  }

  const suggestions: string[] = [];
  if (totalPending >= 5)
    suggestions.push(`批改負擔重，建議協調 TA 協助；目前 ${totalPending} 份待批改`);
  if (avg < 75)
    suggestions.push('班級平均偏低，建議檢視教學節奏或舉辦補強複習會');
  if (topRisks.length === 0)
    suggestions.push('整體教學運作健康，可投資於下學期課綱優化');

  return { score, topRisks, suggestions };
}

// ─────────────────────────────────────────────────────────
// 6. 餐廳 — AI 建議下一步動作
// ─────────────────────────────────────────────────────────

export function aiVendorNextAction(input: {
  pendingOrders: number;
  processingOrders: number;
  readyOrders: number;
  oldestPendingMinutes: number;
  /** 餐廳是否正在營業 */
  isOpen?: boolean;
  /** 店家類型，可影響話術 */
  category?: 'cafeteria' | 'coffee' | 'store' | 'breakfast' | 'drink' | 'noodle' | 'international' | 'buffet';
  /** 今日累計營收，可比較目標 */
  todayRevenue?: number;
  /** 今日累計出餐 */
  todayServed?: number;
  /** 當前時段 hour 0-23（不傳則用 Date.now()） */
  hour?: number;
}): { action: string; severity: 'critical' | 'high' | 'medium' | 'low' } {
  // 沒營業
  if (input.isOpen === false) {
    return {
      action: '店家目前打烊中，可預先整理明日食材與排班',
      severity: 'low',
    };
  }
  // 超久訂單先處理
  if (input.oldestPendingMinutes > 20) {
    return {
      action: `有訂單已等候 ${input.oldestPendingMinutes} 分鐘，立刻處理避免客訴`,
      severity: 'critical',
    };
  }
  if (input.pendingOrders >= 5) {
    const tip =
      input.category === 'breakfast' ? '可同步處理飲品與主餐'
      : input.category === 'drink' ? '同口味組批量製作能省時'
      : input.category === 'coffee' ? '相同豆種或飲品可一起萃取'
      : '集中製作同類型品項';
    return {
      action: `堆積 ${input.pendingOrders} 筆新訂單，建議${tip}`,
      severity: 'high',
    };
  }
  if (input.readyOrders >= 3) {
    return {
      action: `${input.readyOrders} 份已備好待取，可在 APP 推播通知學生取餐`,
      severity: 'medium',
    };
  }
  // 完全沒訂單時：依時段給有用建議，而非千篇一律
  if (input.pendingOrders === 0 && input.processingOrders === 0 && input.readyOrders === 0) {
    const hour = input.hour ?? new Date().getHours();
    if (hour >= 6 && hour < 10 && input.category !== 'breakfast' && input.category !== 'coffee') {
      return {
        action: '清晨人潮少，可發 loyalty 推播刺激早餐時段點單',
        severity: 'low',
      };
    }
    if (hour >= 14 && hour < 17 && (input.category === 'cafeteria' || input.category === 'noodle')) {
      return {
        action: '下午冷清時段，可推出限時 9 折券吸引下午茶族群',
        severity: 'low',
      };
    }
    if (hour >= 21 || hour < 6) {
      return {
        action: '深夜時段，可預備明日熱門品項食材並盤點庫存',
        severity: 'low',
      };
    }
    // 依品類做不同建議，避免「無訂單」千篇一律
    const tip =
      input.category === 'breakfast' ? '可預煎蛋餅 / 切配主餐，迎接下波早課人潮'
      : input.category === 'coffee' ? '可預磨豆並擺出限時新品試喝'
      : input.category === 'drink' ? '可預備熱門茶底（冰塊、糖漿）以縮短候時'
      : input.category === 'noodle' ? '可預熬湯頭與切配，迎接午餐尖峰'
      : input.category === 'buffet' ? '可重新擺盤、補充熱賣菜色'
      : input.category === 'international' ? '可預備配菜（春捲皮、香料）'
      : '訂單空檔，可整理菜單或預備熱門品項食材';
    return { action: tip, severity: 'low' };
  }
  // 進行中合理範圍
  const served = input.todayServed ?? 0;
  if (served >= 100) {
    return { action: `已出餐 ${served} 份，營運順暢；維持目前速度`, severity: 'low' };
  }
  return { action: '訂單流順暢，繼續維持', severity: 'low' };
}

// ─────────────────────────────────────────────────────────
// 7. 通用：把任何 RoleEvent 餵給 AI 重算 student 待辦
// ─────────────────────────────────────────────────────────

export function aiRecomputeStudentPlanAfterEvent(): { tasks: PlannerTask[]; notifications: NotificationItem[] } {
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
  const plan = planStudy(tasks);
  const hwForNotif = DEMO_COURSES.flatMap((c) =>
    getDemoHomeworksByCourse(c.id).map((hw) => ({
      id: hw.id, courseId: hw.courseId, courseName: c.name,
      title: hw.title, dueAt: hw.dueAt, submitted: hw.submitted,
    })),
  );
  const examForNotif = DEMO_COURSES.flatMap((c) =>
    getDemoExamsByCourse(c.id).map((e) => ({
      id: e.id, courseId: e.courseId, courseName: c.name,
      title: e.title, startAt: e.startAt, submitted: e.submitted,
    })),
  );
  const notifications = planNotifications({
    now: new Date().toISOString(),
    homeworks: hwForNotif,
    exams: examForNotif,
  });
  return { tasks: plan.prioritized, notifications };
}

// ─────────────────────────────────────────────────────────
// 8. 主入口：執行任一角色動作前的 AI 演算
// ─────────────────────────────────────────────────────────

export type OrchestratorAction =
  | { type: 'teacher_grade'; payload: TeacherGradeInput }
  | { type: 'teacher_bulk_reminder'; payload: BulkReminderForecastInput }
  | { type: 'student_what_if'; payload: { itemTitle: string; newScore: number; newTotal: number | null; oldGrade: number | null; newGrade: number | null } };

export function orchestrate(action: OrchestratorAction): AIDecision | { comment: string } {
  switch (action.type) {
    case 'teacher_grade':
      return aiPreReviewGrade(action.payload);
    case 'teacher_bulk_reminder':
      return aiForecastBulkReminder(action.payload);
    case 'student_what_if':
      return { comment: aiCommentOnWhatIf(action.payload) };
    default:
      return { comment: 'AI 暫無建議' };
  }
}
