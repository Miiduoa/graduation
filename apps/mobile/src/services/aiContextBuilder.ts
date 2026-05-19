/**
 * AI Context Builder — 把整個 APP 所有資料壓成一個 AI 看得懂的 context
 *
 * 設計核心：AI 應該「無所不知」。每次學生對話 AI，AI 都看得到：
 *  - 學生身分、角色、就讀系所
 *  - 5 門課的最新狀態（已批改 / 待繳 / 預估成績）
 *  - 今日待辦排序 (planStudy 結果)
 *  - 該推的 critical 通知
 *  - 個人錯題本當前狀態 (mastery rate, due today)
 *  - 校園精靈狀態
 *
 * 對 chatWithAI 是 prompt-friendly：可序列化成 markdown 段落，
 * 後端把整段塞進 system prompt 給 LLM。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  planStudy,
  homeworkToPlannerTask,
  examToPlannerTask,
  planNotifications,
  predictCurrent,
  statsOf as mistakeStats,
  dueToday as mistakesDueToday,
  type PlannerTask,
  type NotificationItem,
  type PredictorItem,
  type MistakeEntry,
  type PredictionSnapshot,
} from '@campus/shared';

import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoExamsByCourse,
  getDemoScoreItemsByCourse,
  getDemoAttendanceByCourse,
  getDemoDiscussionsByCourse,
} from '../data/demoCoursesMock';
import { getScopedStorageKey } from './scopedStorage';
import {
  buildWideAISnapshot,
  type WideSnapshot,
} from './aiDataInventory';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface AIFullContext {
  user: {
    uid: string;
    displayName: string;
    role: string;
    schoolId: string | null;
    department: string | null;
    studentId: string | null;
  };
  /** 5 門課的完整狀態 */
  courses: Array<{
    id: number;
    name: string;
    instructor: string;
    iconEmoji: string;
    /** 預估總成績 */
    prediction: PredictionSnapshot;
    /** 已交 / 未交作業數 */
    homeworks: { submitted: number; pending: number; graded: number; total: number };
    /** 考試已交 / 未交 */
    exams: { submitted: number; pending: number; total: number };
    /** 出席率 */
    attendance: { present: number; late: number; absent: number; total: number; rate: number };
    /** 討論串數 */
    discussionCount: number;
  }>;
  /** 跨課今日待辦 */
  studyPlan: {
    summary: string;
    priorityCount: number;
    overdueCount: number;
    pomodoroCount: number;
    totalMinutes: number;
    topTasks: Array<{
      title: string;
      courseName: string;
      urgency: string;
      hoursUntilDue: number | null;
    }>;
  };
  /** 智慧通知（critical/high 級別） */
  urgentNotifications: NotificationItem[];
  /** 錯題本當前狀態 */
  mistakes: {
    total: number;
    dueTodayCount: number;
    retired: number;
    masteryRate: number;
  };
  /** 風險課程（預估 < 70） */
  atRiskCourses: Array<{ id: number; name: string; likelyScore: number | null }>;
  /** 校園精靈（如果有 cache） */
  companion?: {
    spriteLevel?: number;
    moodLabel?: string;
    streakDays?: number;
  };
  /** 整 APP 所有 domain 的 wide snapshot — AI 拿得到全資料 */
  wide?: WideSnapshot;
  /** 生成時間 */
  generatedAt: string;
}

export interface BuildContextOptions {
  uid: string;
  schoolId?: string | null;
  displayName?: string | null;
  role?: string;
  department?: string | null;
  studentId?: string | null;
  /** Override now（測試用） */
  now?: string;
}

// ─────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────

export async function buildFullAIContext(
  options: BuildContextOptions,
): Promise<AIFullContext> {
  const now = options.now ?? new Date().toISOString();

  // 1. Courses with predictions + counts
  const courses = DEMO_COURSES.map((c) => {
    const hws = getDemoHomeworksByCourse(c.id);
    const exams = getDemoExamsByCourse(c.id);
    const items = getDemoScoreItemsByCourse(c.id);
    const att = getDemoAttendanceByCourse(c.id);
    const discussions = getDemoDiscussionsByCourse(c.id);

    const predictItems: PredictorItem[] = items.map((s) => ({
      id: String(s.id),
      title: s.name,
      weight: s.weight,
      maxScore: s.totalScore,
      score: s.studentScore,
      graded: s.studentScore !== null,
    }));
    const prediction = predictCurrent(predictItems);

    const hwSubmitted = hws.filter((h) => h.submitted).length;
    const hwGraded = hws.filter((h) => h.graded).length;
    const hwPending = hws.filter((h) => !h.submitted).length;

    const examSubmitted = exams.filter((e) => e.submitted).length;
    const examPending = exams.filter((e) => !e.submitted).length;

    const present = att.filter((a) => a.myStatus === 'present').length;
    const late = att.filter((a) => a.myStatus === 'late').length;
    const absent = att.filter((a) => a.myStatus === 'absent').length;
    const attTotal = att.length;
    const attRate = attTotal > 0 ? Math.round(((present + late) / attTotal) * 1000) / 10 : 0;

    return {
      id: c.id,
      name: c.name,
      instructor: c.instructor,
      iconEmoji: c.iconEmoji,
      prediction,
      homeworks: { submitted: hwSubmitted, pending: hwPending, graded: hwGraded, total: hws.length },
      exams: { submitted: examSubmitted, pending: examPending, total: exams.length },
      attendance: { present, late, absent, total: attTotal, rate: attRate },
      discussionCount: discussions.length,
    };
  });

  // 2. Study plan across all courses
  const plannerTasks: PlannerTask[] = [];
  for (const c of DEMO_COURSES) {
    for (const hw of getDemoHomeworksByCourse(c.id)) {
      plannerTasks.push(
        homeworkToPlannerTask({
          id: hw.id,
          courseId: hw.courseId,
          courseName: c.name,
          title: hw.title,
          dueAt: hw.dueAt,
          submitted: hw.submitted,
          totalScore: hw.totalScore,
        }),
      );
    }
    for (const e of getDemoExamsByCourse(c.id)) {
      plannerTasks.push(
        examToPlannerTask({
          id: e.id,
          courseId: e.courseId,
          courseName: c.name,
          title: e.title,
          startAt: e.startAt,
          isPractice: e.isPractice,
          submitted: e.submitted,
          totalScore: e.totalScore,
        }),
      );
    }
  }
  const studyPlan = planStudy(plannerTasks, { now });

  // 3. Urgent notifications
  const allHomeworks = DEMO_COURSES.flatMap((c) =>
    getDemoHomeworksByCourse(c.id).map((hw) => ({
      id: hw.id,
      courseId: hw.courseId,
      courseName: c.name,
      title: hw.title,
      dueAt: hw.dueAt,
      submitted: hw.submitted,
    })),
  );
  const allExams = DEMO_COURSES.flatMap((c) =>
    getDemoExamsByCourse(c.id).map((e) => ({
      id: e.id,
      courseId: e.courseId,
      courseName: c.name,
      title: e.title,
      startAt: e.startAt,
      submitted: e.submitted,
    })),
  );
  const notifications = planNotifications({
    now,
    homeworks: allHomeworks,
    exams: allExams,
  });
  const urgentNotifications = notifications.filter(
    (n) => n.severity === 'critical' || n.severity === 'high',
  );

  // 4. Mistake repertoire (per-uid scoped)
  let mistakes = { total: 0, dueTodayCount: 0, retired: 0, masteryRate: 0 };
  try {
    const storageKey = getScopedStorageKey('mistake_repertoire_v1', {
      uid: options.uid,
      schoolId: options.schoolId ?? null,
    });
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as MistakeEntry[];
      if (Array.isArray(parsed)) {
        const s = mistakeStats(parsed, now);
        mistakes = {
          total: s.total,
          dueTodayCount: s.dueTodayCount,
          retired: s.retired,
          masteryRate: s.masteryRate,
        };
      }
    }
  } catch {
    /* swallow */
  }

  // 5. At-risk courses (likelyCase < 70)
  const atRiskCourses = courses
    .filter((c) => c.prediction.likelyCase !== null && c.prediction.likelyCase < 70)
    .map((c) => ({ id: c.id, name: c.name, likelyScore: c.prediction.likelyCase }));

  return {
    user: {
      uid: options.uid,
      displayName: options.displayName ?? '同學',
      role: options.role ?? 'student',
      schoolId: options.schoolId ?? null,
      department: options.department ?? null,
      studentId: options.studentId ?? null,
    },
    courses,
    studyPlan: {
      summary: studyPlan.summary,
      priorityCount: studyPlan.prioritized.length,
      overdueCount: studyPlan.overdueTasks.length,
      pomodoroCount: studyPlan.pomodoros.length,
      totalMinutes: studyPlan.totalEstimatedMinutes,
      topTasks: studyPlan.prioritized.slice(0, 5).map((t) => ({
        title: t.title,
        courseName: t.courseName,
        urgency: t.urgency,
        hoursUntilDue: t.hoursUntilDue,
      })),
    },
    urgentNotifications,
    mistakes,
    atRiskCourses,
    wide: await buildWideAISnapshot({ uid: options.uid, schoolId: options.schoolId ?? null }),
    generatedAt: now,
  };
}

// ─────────────────────────────────────────────────────────
// 序列化成 AI prompt-friendly markdown
// ─────────────────────────────────────────────────────────

export function contextToPromptBlock(ctx: AIFullContext): string {
  const lines: string[] = [];
  lines.push('## 學生現況（generated at ' + new Date(ctx.generatedAt).toLocaleString('zh-TW') + '）');
  lines.push(`姓名：${ctx.user.displayName}`);
  if (ctx.user.studentId) lines.push(`學號：${ctx.user.studentId}`);
  if (ctx.user.department) lines.push(`系所：${ctx.user.department}`);
  lines.push(`角色：${ctx.user.role}`);
  lines.push('');

  lines.push('## 今日重點');
  lines.push(`- ${ctx.studyPlan.summary}`);
  if (ctx.studyPlan.overdueCount > 0) {
    lines.push(`- 🚨 ${ctx.studyPlan.overdueCount} 件已逾期`);
  }
  if (ctx.urgentNotifications.length > 0) {
    lines.push('- 立即注意：');
    for (const n of ctx.urgentNotifications.slice(0, 5)) {
      lines.push(`  · [${n.severity}] ${n.title} — ${n.body}`);
    }
  }
  lines.push('');

  lines.push('## 5 門課當前狀態');
  for (const c of ctx.courses) {
    const lc = c.prediction.likelyCase;
    lines.push(
      `- ${c.iconEmoji} ${c.name}（${c.instructor}）：預估 ${lc ?? '—'}% [${c.prediction.letterGrade ?? '—'}]`,
    );
    lines.push(
      `  作業 ${c.homeworks.graded}/${c.homeworks.submitted}/${c.homeworks.total}（批改/已交/總） · 考試 ${c.exams.submitted}/${c.exams.total} · 出席率 ${c.attendance.rate}%`,
    );
  }
  lines.push('');

  if (ctx.atRiskCourses.length > 0) {
    lines.push('## ⚠️ 風險課程');
    for (const r of ctx.atRiskCourses) {
      lines.push(`- ${r.name}：預估僅 ${r.likelyScore ?? '—'}%`);
    }
    lines.push('');
  }

  lines.push('## 待辦優先序');
  for (const t of ctx.studyPlan.topTasks) {
    lines.push(
      `- [${t.urgency}] ${t.title}（${t.courseName}）${t.hoursUntilDue !== null ? `— ${Math.round(t.hoursUntilDue)}h` : ''}`,
    );
  }
  lines.push('');

  lines.push('## 錯題本');
  lines.push(
    `- 總題 ${ctx.mistakes.total} · 今天該練 ${ctx.mistakes.dueTodayCount} · 已熟練 ${ctx.mistakes.retired} · 吸收率 ${Math.round(ctx.mistakes.masteryRate * 100)}%`,
  );

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// 給 AI Tool 呼叫的精簡版（避免 token 爆掉）
// ─────────────────────────────────────────────────────────

export function contextToCompactJson(ctx: AIFullContext) {
  return {
    user: { name: ctx.user.displayName, role: ctx.user.role },
    today: {
      summary: ctx.studyPlan.summary,
      priorityCount: ctx.studyPlan.priorityCount,
      overdue: ctx.studyPlan.overdueCount,
      urgent: ctx.urgentNotifications.slice(0, 5).map((n) => ({
        kind: n.kind,
        title: n.title,
        body: n.body,
      })),
    },
    courses: ctx.courses.map((c) => ({
      name: c.name,
      grade: c.prediction.likelyCase,
      letter: c.prediction.letterGrade,
      hwPending: c.homeworks.pending,
      attendance: c.attendance.rate,
    })),
    atRisk: ctx.atRiskCourses.map((r) => r.name),
    mistakes: ctx.mistakes,
  };
}
