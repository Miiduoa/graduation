/**
 * Per-Course AI Context — 給 LMS 課程頁的「AI 助教」按鈕用
 * ───────────────────────────────────────────────────────────
 * 設計原則:**不引入任何新的 AI 後端**。
 * LMS 課程頁點「AI 助教」時:
 *   1. 用 courseId 從 supabaseLmsCache facade 取該課程資料
 *      (facade 會自動依 flag 走 Supabase 或 TronClass)
 *   2. 塑形成 AIContext 形狀
 *   3. 把 AIContext 傳給既有的 AIChatScreen + chatWithCampusAssistant
 *
 * 結果:LMS 內嵌對話介面 100% 走「舊 AI 助理」(chatWithCampusAssistant),
 *       不會碰到 Supabase Edge Function ai-course-assistant。
 *       Background Agent (aiAgentRuntime) 共用同一份資料,工具自動可用。
 */

import type { AIContext } from './ai';
import {
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  getAnyCachedTCAnnouncements,
  getAnyCachedTCScoreItems,
  getAnyCachedTCMaterials,
  getAnyCachedTCCourseMembers,
  // facade — 內部依 flag 切換 Supabase / TronClass
} from './supabaseLmsCache';

type RoleHint = 'student' | 'teacher' | 'assistant' | 'observer';

function pickRoleFromMembers(
  members: any[] | null,
  selfUserId: string | undefined,
): RoleHint | undefined {
  if (!members || !selfUserId) return undefined;
  const me = members.find(m => String(m.user_id) === selfUserId);
  if (!me) return undefined;
  const r = String(me.role || '').toLowerCase();
  if (r.includes('teacher')) return 'teacher';
  if (r.includes('assist') || r.includes('ta')) return 'assistant';
  if (r.includes('student')) return 'student';
  return 'observer';
}

/**
 * 用 courseId 組裝該課程的 AIContext。
 * @param courseId LMS 課程 id (兼容字串 / 數字)
 * @param baseContext 上層已建好的全域 context(可選),會被 per-course 資料覆蓋對應欄位
 * @returns 縮窄到該課程的 AIContext。若資料源不可用,回 baseContext 或空 context。
 */
export async function buildPerCourseAIContext(
  courseId: string | number,
  baseContext?: Partial<AIContext>,
): Promise<AIContext> {
  const cid = String(courseId);
  const numericCid = Number(courseId);

  const [allCourses, activitiesGrouped, anns, scoresGrouped, materialsGrouped, membersGrouped] =
    await Promise.all([
      getAnyCachedTCCourses().catch(() => null),
      getAnyCachedTCActivities().catch(() => null),
      getAnyCachedTCAnnouncements().catch(() => null),
      getAnyCachedTCScoreItems().catch(() => null),
      getAnyCachedTCMaterials().catch(() => null),
      getAnyCachedTCCourseMembers().catch(() => null),
    ]);

  // 找出該課程基本資料
  const course = Array.isArray(allCourses)
    ? allCourses.find((c: any) => String(c.id) === cid)
    : undefined;

  // 該課程的活動 (作業 / 測驗)
  const acts =
    (activitiesGrouped as any)?.[numericCid] ??
    (activitiesGrouped as any)?.[cid] ??
    [];

  // 該課程的公告
  const courseAnns = (anns ?? []).filter(
    (a: any) => String(a.course_id) === cid || a.course_id === numericCid,
  );

  // 該課程的成績項
  const scoreItems =
    (scoresGrouped as any)?.[numericCid] ?? (scoresGrouped as any)?.[cid] ?? [];

  // 該課程的教材
  const materials =
    (materialsGrouped as any)?.[numericCid] ?? (materialsGrouped as any)?.[cid] ?? [];

  // 該課程的成員(用來判斷自己是教師還是學生)
  const members =
    (membersGrouped as any)?.[numericCid] ?? (membersGrouped as any)?.[cid] ?? null;

  // role hint
  const selfUserId = baseContext?.userId;
  const courseRole = pickRoleFromMembers(members, selfUserId);

  // 把 score items 算成簡單的平均
  let avgScore: number | null = null;
  if (Array.isArray(scoreItems) && scoreItems.length) {
    const nums = scoreItems
      .map((s: any) => Number(s.score))
      .filter((n: number) => Number.isFinite(n));
    if (nums.length) avgScore = nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  // pendingAssignments: 從 activities 過濾出 type=homework 且 due_at 在未來
  const now = Date.now();
  const pendingAssignments = (acts ?? [])
    .filter((a: any) => {
      if (a.activity_type && a.activity_type !== 'homework') return false;
      if (!a.due_at) return true;
      const t = new Date(a.due_at).getTime();
      return Number.isFinite(t) && t >= now;
    })
    .slice(0, 20)
    .map((a: any) => ({
      id: String(a.id),
      title: a.title || '',
      groupName: course?.name || '',
      dueAt: a.due_at,
      isLate: false,
    }));

  // 把該課程教材塑成 announcements 加進 context.announcements 的「該課程提示」
  const materialMentions = (materials ?? [])
    .slice(0, 8)
    .map((m: any) => ({
      id: `material:${m.id}`,
      title: `教材: ${m.title || ''}`,
      source: 'lms',
    }));

  const annMentions = (courseAnns ?? [])
    .slice(0, 10)
    .map((a: any) => ({
      id: `announcement:${a.id}`,
      title: a.title || a.content || '',
      source: 'lms',
    }));

  const ctx: AIContext = {
    ...(baseContext as AIContext),
    schoolId: baseContext?.schoolId || 'pu',
    userId: baseContext?.userId,
    userName: baseContext?.userName,
    // 把 role 收斂到該課程的 role (給 system prompt 更準確)
    role: (courseRole as any) ?? baseContext?.role,
    // 縮窄到單一課程
    courses: course
      ? [
          {
            id: String(course.id),
            name: course.name || '',
            teacher: undefined,
            credits: undefined,
          },
        ]
      : baseContext?.courses,
    pendingAssignments,
    gradesSummary: course
      ? {
          gpa: undefined,
          courses: [
            {
              name: course.name || '',
              grade: avgScore ?? undefined,
            },
          ],
        }
      : baseContext?.gradesSummary,
    announcements: [...annMentions, ...materialMentions],
  };

  return ctx;
}

/**
 * 給 system prompt 加上一段 LMS 課程焦點提示文字
 * (與 buildPerCourseAIContext 配合使用,或單獨 prepend 到對話 system role)
 */
export function buildPerCourseSystemHint(opts: {
  courseId: string | number;
  courseName?: string;
  roleHint?: RoleHint;
}): string {
  const lines = [
    `# LMS 課程焦點`,
    `你目前在課程「${opts.courseName || `(課程 ${opts.courseId})`}」的 AI 助教情境中,`,
    `請優先用該課程的資料(教材、作業、測驗、討論、公告、成績)回答學生問題;`,
    `若問題明顯不屬於該課程(例如校內巴士、餐廳推薦),請禮貌引導學生點開全域助理。`,
  ];
  if (opts.roleHint === 'teacher') {
    lines.push(`使用者在此課程身份是「教師」,可以提供教學設計、批改建議、學情分析等較深入的回應。`);
  } else if (opts.roleHint === 'assistant') {
    lines.push(`使用者在此課程身份是「助教」,可協助提醒繳交、分組、出勤等行政動作。`);
  } else {
    lines.push(`使用者是該課程的「學生」,請保持鼓勵與學習引導的口吻。`);
  }
  return lines.join('\n');
}
