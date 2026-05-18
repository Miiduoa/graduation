/**
 * Supabase LMS Cache — Facade for LMS v2
 * ───────────────────────────────────────────────────────────
 * 行為:
 *   - flag OFF (預設) → 全部函數轉呼叫 puDataCache 的對應實作 (TronClass)
 *   - flag ON → 改打 Supabase,把結果塑形成與 puDataCache 同樣的型別
 *
 * 目的:讓 aiAgentTools / aiContextBuilder / 其他 30+ 個 ai*.ts 不需要改一行,
 *      就能自動把資料源從 TronClass 切到 Supabase。
 *
 * 設計約定:
 *   - 介面 (export 名稱、回傳型別) 100% 對齊 puDataCache
 *   - 任何網路失敗都回 null 而非 throw,讓 AI tool 走 graceful fallback
 *   - 預設 5 秒 timeout
 *
 * 注意:本檔目前只實作必要的 getAnyCached* read 路徑。
 *      寫入(submitAssignment / gradeSubmission / 等)在 Phase 4 另寫工具檔。
 */

import { isLmsV2Enabled } from './lmsV2FeatureFlag';
import { getSupabaseClient } from './supabaseClient';
import {
  // 把 puDataCache 全部 re-export,讓任何 import 路徑都不破
  getAnyCachedCourses as puGetAnyCachedCourses,
  getAnyCachedGrades as puGetAnyCachedGrades,
  getAnyCachedAnnouncements as puGetAnyCachedAnnouncements,
  getAnyCachedStudentInfo as puGetAnyCachedStudentInfo,
  getAnyCachedTCCourses as puGetAnyCachedTCCourses,
  getAnyCachedTCActivities as puGetAnyCachedTCActivities,
  getAnyCachedTCModules as puGetAnyCachedTCModules,
  getAnyCachedTCAttendance as puGetAnyCachedTCAttendance,
  getAnyCachedTCTodos as puGetAnyCachedTCTodos,
  getAnyCachedTCAnnouncements as puGetAnyCachedTCAnnouncements,
  getAnyCachedTCExams as puGetAnyCachedTCExams,
  getAnyCachedTCScoreItems as puGetAnyCachedTCScoreItems,
  getAnyCachedTCHomeworkActivities as puGetAnyCachedTCHomeworkActivities,
  getAnyCachedTCDiscussions as puGetAnyCachedTCDiscussions,
  getAnyCachedTCMaterials as puGetAnyCachedTCMaterials,
  getAnyCachedTCCourseMembers as puGetAnyCachedTCCourseMembers,
  getAnyCachedTCCourseAnnouncements as puGetAnyCachedTCCourseAnnouncements,
  syncAllData as puSyncAllData,
} from './puDataCache';

// ───── 通用 helpers ─────
const SUPABASE_TIMEOUT_MS = 5000;

async function withTimeout<T>(p: Promise<T>, ms = SUPABASE_TIMEOUT_MS): Promise<T | null> {
  let timer: any;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('supabase-timeout')), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fromSupabase<T = any>(
  query: () => Promise<{ data: T | null; error: any }>,
): Promise<T | null> {
  if (!isLmsV2Enabled()) return null;
  const sb = getSupabaseClient();
  if (!sb) return null;
  const result = await withTimeout(query());
  if (!result) return null;
  if (result.error) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[supabaseLmsCache]', result.error?.message ?? result.error);
    }
    return null;
  }
  return (result.data ?? null) as T | null;
}

// ───── PU 直接抓取的 4 個(課表 / 成績 / 公告 / 學生資料)─────
// 這些屬於「校務系統 (非 LMS)」,LMS v2 不取代,直接 passthrough。

export async function getAnyCachedCourses(): ReturnType<typeof puGetAnyCachedCourses> {
  return puGetAnyCachedCourses();
}
export async function getAnyCachedGrades(): ReturnType<typeof puGetAnyCachedGrades> {
  return puGetAnyCachedGrades();
}
export async function getAnyCachedAnnouncements(): ReturnType<typeof puGetAnyCachedAnnouncements> {
  return puGetAnyCachedAnnouncements();
}
export async function getAnyCachedStudentInfo(): ReturnType<typeof puGetAnyCachedStudentInfo> {
  return puGetAnyCachedStudentInfo();
}

// ───── TronClass 對齊欄位(LMS v2 取代區)─────

/**
 * 課程清單 — 改打 Supabase courses + course_members
 */
export async function getAnyCachedTCCourses(): ReturnType<typeof puGetAnyCachedTCCourses> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCCourses();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCCourses();

  const rows = await fromSupabase(() =>
    sb
      .from('course_members')
      .select(
        `course_id, role,
         courses ( id, name, code, term, start_at, end_at, description )`,
      )
      .eq('user_id', (sb.auth.getUser ? null : null)) // RLS 自動限制本人
      .limit(200),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCCourses();

  // 塑形成 TCCourse[] 形狀(對齊 tronClassClient.ts 的 TCCourse 型別)
  // 注:此處的 TCCourse 型別細節以舊系統為準,任何欄位缺失填空字串 / 0
  const mapped: any[] = rows
    .map((r: any) => {
      const c = r?.courses;
      if (!c) return null;
      return {
        id: typeof c.id === 'number' ? c.id : Number.parseInt(String(c.id), 10) || c.id,
        name: c.title || '',
        course_code: c.catalog_summary || '',
        term: String(c.term_id ?? ''),
        
        
        description: c.description || '',
        // 角色資訊嵌進來,讓上游能感知教師 / 學生
        __role: r.role,
        __source: 'supabase',
      };
    })
    .filter(Boolean);

  return mapped.length ? (mapped as any) : puGetAnyCachedTCCourses();
}

/**
 * 活動(作業 / 測驗 / 公告 / 討論)— 改打 Supabase 對應表
 */
export async function getAnyCachedTCActivities(): ReturnType<typeof puGetAnyCachedTCActivities> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCActivities();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCActivities();

  // 取本人所屬課程的 assignments + quizzes 合併
  const assignments = await fromSupabase(() =>
    sb.from('assignments').select('id, course_id, title, due_at, max_points').limit(500),
  );
  const quizzes = await fromSupabase(() =>
    sb.from('quizzes').select('id, course_id, title, due_at, max_points').limit(500),
  );

  if (!assignments && !quizzes) return puGetAnyCachedTCActivities();

  const grouped: Record<number, any[]> = {};
  const push = (courseId: any, item: any) => {
    const key = Number(courseId);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  };

  (assignments ?? []).forEach((a: any) =>
    push(a.course_id, {
      id: a.id,
      title: a.title,
      activity_type: 'homework',
      due_at: a.due_at,
      __source: 'supabase',
    }),
  );
  (quizzes ?? []).forEach((q: any) =>
    push(q.course_id, {
      id: q.id,
      title: q.title,
      activity_type: 'exam',
      due_at: q.due_at,
      __source: 'supabase',
    }),
  );

  return grouped as any;
}

/**
 * 模組 / 章節 — Supabase course_units + material_chapters
 */
export async function getAnyCachedTCModules(): ReturnType<typeof puGetAnyCachedTCModules> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCModules();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCModules();

  const units = await fromSupabase(() =>
    sb.from('course_units').select('id, course_id, title, position').limit(500),
  );
  if (!units) return puGetAnyCachedTCModules();

  const grouped: Record<number, any[]> = {};
  (units as any[]).forEach((u: any) => {
    const key = Number(u.course_id);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      id: u.id,
      title: u.title,
      position: u.position,
      __source: 'supabase',
    });
  });
  return grouped as any;
}

/**
 * 點名紀錄 — live_attendance
 */
export async function getAnyCachedTCAttendance(): ReturnType<typeof puGetAnyCachedTCAttendance> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCAttendance();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCAttendance();

  const rows = await fromSupabase(() =>
    sb
      .from('live_attendance')
      .select('id, session_id, user_id, status, checked_in_at')
      .order('checked_in_at', { ascending: false })
      .limit(500),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCAttendance();
  return rows.map((r: any) => ({
    id: r.id,
    session_id: r.session_id,
    status: r.status,
    checked_in_at: r.checked_in_at,
    __source: 'supabase',
  })) as any;
}

/**
 * 待辦 — assignments 還沒繳的 + quizzes 還沒考的
 */
export async function getAnyCachedTCTodos(): ReturnType<typeof puGetAnyCachedTCTodos> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCTodos();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCTodos();

  // 用 view / RPC 比較乾淨;此處先用簡化版
  const assignments = await fromSupabase(() =>
    sb
      .from('assignments')
      .select('id, course_id, title, due_at')
      .gte('due_at', new Date().toISOString())
      .limit(50),
  );
  if (!assignments) return puGetAnyCachedTCTodos();
  return (assignments as any[]).map((a: any) => ({
    id: a.id,
    title: a.title,
    activity_type: 'homework',
    due_at: a.due_at,
    __source: 'supabase',
  })) as any;
}

/**
 * 課程公告 — announcements table
 */
export async function getAnyCachedTCAnnouncements(): ReturnType<typeof puGetAnyCachedTCAnnouncements> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCAnnouncements();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCAnnouncements();

  const rows = await fromSupabase(() =>
    sb
      .from('announcements')
      .select('id, course_id, title, body, published_at')
      .order('published_at', { ascending: false })
      .limit(200),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCAnnouncements();
  return rows.map((r: any) => ({
    id: r.id,
    course_id: r.course_id,
    title: r.title,
    content: r.body,
    published_at: r.published_at,
    __source: 'supabase',
  })) as any;
}

/**
 * 考試 — quizzes 視為 exam (LMS v2 沒有分開 exam 表)
 */
export async function getAnyCachedTCExams(): ReturnType<typeof puGetAnyCachedTCExams> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCExams();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCExams();

  const quizzes = await fromSupabase(() =>
    sb.from('quizzes').select('id, course_id, title, due_at').limit(200),
  );
  if (!quizzes) return puGetAnyCachedTCExams();
  const grouped: Record<number, any[]> = {};
  (quizzes as any[]).forEach((q: any) => {
    const key = Number(q.course_id);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ id: q.id, title: q.title, due_at: q.due_at, __source: 'supabase' });
  });
  return grouped as any;
}

/**
 * 成績項目 — course_grade_rollups
 */
export async function getAnyCachedTCScoreItems(): ReturnType<typeof puGetAnyCachedTCScoreItems> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCScoreItems();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCScoreItems();

  const rows = await fromSupabase(() =>
    sb
      .from('course_grade_rollups')
      .select('course_id, student_id, weighted_percent')
      .limit(500),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCScoreItems();
  const grouped: Record<number, any[]> = {};
  rows.forEach((r: any) => {
    const key = Number(r.course_id);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      id: r.id,
      title: r.item_name,
      score: r.score,
      weight: r.weight,
      max_score: r.max_score,
      __source: 'supabase',
    });
  });
  return grouped as any;
}

// 以下幾個目前先 passthrough (LMS v2 結構雖然有,但 mapping 之後再做),
// 確保 flag ON 時也不會打死,而是退回舊路徑

export async function getAnyCachedTCHomeworkActivities(): ReturnType<
  typeof puGetAnyCachedTCHomeworkActivities
> {
  return puGetAnyCachedTCHomeworkActivities();
}
export async function getAnyCachedTCDiscussions(): ReturnType<typeof puGetAnyCachedTCDiscussions> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCDiscussions();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCDiscussions();

  const rows = await fromSupabase(() =>
    sb.from('forum_topics').select('id, course_id, title, created_at').limit(300),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCDiscussions();
  const grouped: Record<number, any[]> = {};
  rows.forEach((r: any) => {
    const key = Number(r.course_id);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      id: r.id,
      title: r.title,
      created_at: r.created_at,
      __source: 'supabase',
    });
  });
  return grouped as any;
}
export async function getAnyCachedTCMaterials(): ReturnType<typeof puGetAnyCachedTCMaterials> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCMaterials();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCMaterials();

  const rows = await fromSupabase(() =>
    sb.from('course_materials').select('id, course_id, title, url, kind').limit(500),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCMaterials();
  const grouped: Record<number, any[]> = {};
  rows.forEach((r: any) => {
    const key = Number(r.course_id);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      id: r.id,
      title: r.title,
      url: r.url,
      kind: r.kind,
      __source: 'supabase',
    });
  });
  return grouped as any;
}
export async function getAnyCachedTCCourseMembers(): ReturnType<
  typeof puGetAnyCachedTCCourseMembers
> {
  if (!isLmsV2Enabled()) return puGetAnyCachedTCCourseMembers();
  const sb = getSupabaseClient();
  if (!sb) return puGetAnyCachedTCCourseMembers();

  const rows = await fromSupabase(() =>
    sb.from('course_members').select('course_id, user_id, role').limit(2000),
  );
  if (!rows || !Array.isArray(rows)) return puGetAnyCachedTCCourseMembers();
  const grouped: Record<number, any[]> = {};
  rows.forEach((r: any) => {
    const key = Number(r.course_id);
    if (!Number.isFinite(key)) return;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      user_id: r.user_id,
      role: r.role,
      __source: 'supabase',
    });
  });
  return grouped as any;
}
export async function getAnyCachedTCCourseAnnouncements(): ReturnType<
  typeof puGetAnyCachedTCCourseAnnouncements
> {
  return puGetAnyCachedTCCourseAnnouncements();
}

/**
 * 全量同步 — 強制重新從來源拉。Flag ON 時打 Supabase + 一些補充欄位;
 * OFF 時委派回 puDataCache.syncAllData。
 */
export async function syncAllData(...args: any[]): ReturnType<typeof puSyncAllData> {
  // 預設先讓舊路徑跑(它會處理 PU 校務系統的拉取),
  // 之後 v2 寫入完整時可在這層加 Supabase prefetch。
  return (puSyncAllData as any)(...args);
}
