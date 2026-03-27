/**
 * 靜宜大學資料本地快取 + 定期更新
 *
 * 登入後一次抓取所有資料存進 AsyncStorage，之後優先讀快取，
 * 依照資料類型設定不同的過期時間：
 *   - 課表:     7 天（學期中幾乎不變）
 *   - 成績:     1 天（學期末較常更新）
 *   - 公告:     30 分鐘（較即時）
 *   - 學生資料: 30 天（幾乎不會變）
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  puFetchCourses,
  puFetchGrades,
  puFetchAnnouncements,
  puFetchStudentInfo,
  type PUSession,
  type PUCourseResult,
  type PUGradeResult,
  type PUAnnouncement,
  type PUStudentInfo,
} from "./puDirectScraper";
import {
  tcFetchCourses,
  tcFetchActivities,
  tcFetchModules,
  tcFetchAttendance,
  tcFetchTodos,
  type TCCourse,
  type TCActivity,
  type TCModule,
  type TCAttendance,
  type TCSession,
} from "./tronClassClient";

// ─── Cache Keys ──────────────────────────────────────────

const PREFIX = "@pu_cache:";
const KEYS = {
  courses: `${PREFIX}courses`,
  grades: `${PREFIX}grades`,
  announcements: `${PREFIX}announcements`,
  studentInfo: `${PREFIX}studentInfo`,
  tcCourses: `${PREFIX}tc_courses`,
  tcActivities: `${PREFIX}tc_activities`,
  tcModules: `${PREFIX}tc_modules`,
  tcAttendance: `${PREFIX}tc_attendance`,
  tcTodos: `${PREFIX}tc_todos`,
  lastSync: `${PREFIX}lastSync`,
} as const;

// ─── TTL (毫秒) ─────────────────────────────────────────

const TTL = {
  courses: 7 * 24 * 60 * 60 * 1000,        // 7 天
  grades: 24 * 60 * 60 * 1000,              // 1 天
  announcements: 30 * 60 * 1000,            // 30 分鐘
  studentInfo: 30 * 24 * 60 * 60 * 1000,    // 30 天
  tcCourses: 12 * 60 * 60 * 1000,           // 12 小時
  tcActivities: 2 * 60 * 60 * 1000,         // 2 小時（作業截止時間重要）
  tcModules: 12 * 60 * 60 * 1000,           // 12 小時
  tcAttendance: 6 * 60 * 60 * 1000,         // 6 小時
  tcTodos: 30 * 60 * 1000,                  // 30 分鐘（待辦最即時）
} as const;

// ─── Cached Entry 結構 ──────────────────────────────────

type CacheEntry<T> = {
  data: T;
  fetchedAt: number; // epoch ms
};

// ─── 通用讀寫 ────────────────────────────────────────────

async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, fetchedAt: Date.now() };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (err) {
    console.warn("[puDataCache] writeCache failed:", key, err);
  }
}

function isExpired(entry: CacheEntry<unknown> | null, ttl: number): boolean {
  if (!entry) return true;
  return Date.now() - entry.fetchedAt > ttl;
}

// ─── Public API ──────────────────────────────────────────

/** 取得快取的課表，過期則回傳 null */
export async function getCachedCourses(): Promise<PUCourseResult | null> {
  const entry = await readCache<PUCourseResult>(KEYS.courses);
  if (isExpired(entry, TTL.courses)) return null;
  return entry!.data;
}

/** 取得快取的成績，過期則回傳 null */
export async function getCachedGrades(): Promise<PUGradeResult | null> {
  const entry = await readCache<PUGradeResult>(KEYS.grades);
  if (isExpired(entry, TTL.grades)) return null;
  return entry!.data;
}

/** 取得快取的公告，過期則回傳 null */
export async function getCachedAnnouncements(): Promise<PUAnnouncement[] | null> {
  const entry = await readCache<PUAnnouncement[]>(KEYS.announcements);
  if (isExpired(entry, TTL.announcements)) return null;
  return entry!.data;
}

/** 取得快取的學生資料，過期則回傳 null */
export async function getCachedStudentInfo(): Promise<PUStudentInfo | null> {
  const entry = await readCache<PUStudentInfo>(KEYS.studentInfo);
  if (isExpired(entry, TTL.studentInfo)) return null;
  return entry!.data;
}

/** 強制取得（不管過期），給離線模式用 */
export async function getAnyCachedCourses(): Promise<PUCourseResult | null> {
  const entry = await readCache<PUCourseResult>(KEYS.courses);
  return entry?.data ?? null;
}

export async function getAnyCachedGrades(): Promise<PUGradeResult | null> {
  const entry = await readCache<PUGradeResult>(KEYS.grades);
  return entry?.data ?? null;
}

export async function getAnyCachedAnnouncements(): Promise<PUAnnouncement[] | null> {
  const entry = await readCache<PUAnnouncement[]>(KEYS.announcements);
  return entry?.data ?? null;
}

export async function getAnyCachedStudentInfo(): Promise<PUStudentInfo | null> {
  const entry = await readCache<PUStudentInfo>(KEYS.studentInfo);
  return entry?.data ?? null;
}

// ─── 單項刷新 ────────────────────────────────────────────

export async function refreshCourses(session: PUSession): Promise<PUCourseResult | null> {
  console.log("[puDataCache] refreshing courses…");
  const result = await puFetchCourses(session);
  if (result.success && result.data) {
    await writeCache(KEYS.courses, result.data);
    return result.data;
  }
  console.warn("[puDataCache] refreshCourses failed:", result.error);
  return null;
}

export async function refreshGrades(session: PUSession): Promise<PUGradeResult | null> {
  console.log("[puDataCache] refreshing grades…");
  const result = await puFetchGrades(session);
  if (result.success && result.data) {
    await writeCache(KEYS.grades, result.data);
    return result.data;
  }
  console.warn("[puDataCache] refreshGrades failed:", result.error);
  return null;
}

export async function refreshAnnouncements(session: PUSession): Promise<PUAnnouncement[] | null> {
  console.log("[puDataCache] refreshing announcements…");
  const result = await puFetchAnnouncements(session);
  if (result.success) {
    await writeCache(KEYS.announcements, result.data);
    return result.data;
  }
  console.warn("[puDataCache] refreshAnnouncements failed:", result.error);
  return null;
}

export async function refreshStudentInfo(session: PUSession): Promise<PUStudentInfo | null> {
  console.log("[puDataCache] refreshing studentInfo…");
  const result = await puFetchStudentInfo(session);
  if (result.success && result.data) {
    await writeCache(KEYS.studentInfo, result.data);
    return result.data;
  }
  console.warn("[puDataCache] refreshStudentInfo failed:", result.error);
  return null;
}

// ─── TronClass 快取讀取 ─────────────────────────────────

export async function getCachedTCCourses(): Promise<TCCourse[] | null> {
  const entry = await readCache<TCCourse[]>(KEYS.tcCourses);
  if (isExpired(entry, TTL.tcCourses)) return null;
  return entry!.data;
}

/** key = courseId, value = activities */
export async function getCachedTCActivities(): Promise<Record<number, TCActivity[]> | null> {
  const entry = await readCache<Record<number, TCActivity[]>>(KEYS.tcActivities);
  if (isExpired(entry, TTL.tcActivities)) return null;
  return entry!.data;
}

export async function getCachedTCModules(): Promise<Record<number, TCModule[]> | null> {
  const entry = await readCache<Record<number, TCModule[]>>(KEYS.tcModules);
  if (isExpired(entry, TTL.tcModules)) return null;
  return entry!.data;
}

export async function getCachedTCAttendance(): Promise<TCAttendance[] | null> {
  const entry = await readCache<TCAttendance[]>(KEYS.tcAttendance);
  if (isExpired(entry, TTL.tcAttendance)) return null;
  return entry!.data;
}

export async function getCachedTCTodos(): Promise<TCActivity[] | null> {
  const entry = await readCache<TCActivity[]>(KEYS.tcTodos);
  if (isExpired(entry, TTL.tcTodos)) return null;
  return entry!.data;
}

/** 不管過期 — 離線模式用 */
export async function getAnyCachedTCCourses(): Promise<TCCourse[] | null> {
  return (await readCache<TCCourse[]>(KEYS.tcCourses))?.data ?? null;
}
export async function getAnyCachedTCActivities(): Promise<Record<number, TCActivity[]> | null> {
  return (await readCache<Record<number, TCActivity[]>>(KEYS.tcActivities))?.data ?? null;
}

// ─── TronClass 刷新 ─────────────────────────────────────

export async function refreshTCCourses(): Promise<TCCourse[] | null> {
  console.log("[puDataCache] refreshing TronClass courses…");
  const courses = await tcFetchCourses("ongoing");
  if (courses.length > 0) {
    await writeCache(KEYS.tcCourses, courses);
    return courses;
  }
  return null;
}

export async function refreshTCActivitiesForCourses(courseIds: number[]): Promise<Record<number, TCActivity[]>> {
  console.log(`[puDataCache] refreshing TronClass activities for ${courseIds.length} courses…`);
  const result: Record<number, TCActivity[]> = {};

  await Promise.allSettled(
    courseIds.map(async (id) => {
      const activities = await tcFetchActivities(id);
      result[id] = activities;
    })
  );

  await writeCache(KEYS.tcActivities, result);
  return result;
}

export async function refreshTCModulesForCourses(courseIds: number[]): Promise<Record<number, TCModule[]>> {
  console.log(`[puDataCache] refreshing TronClass modules for ${courseIds.length} courses…`);
  const result: Record<number, TCModule[]> = {};

  await Promise.allSettled(
    courseIds.map(async (id) => {
      const modules = await tcFetchModules(id);
      result[id] = modules;
    })
  );

  await writeCache(KEYS.tcModules, result);
  return result;
}

export async function refreshTCAttendance(): Promise<TCAttendance[] | null> {
  console.log("[puDataCache] refreshing TronClass attendance…");
  const data = await tcFetchAttendance();
  if (data.length > 0) {
    await writeCache(KEYS.tcAttendance, data);
    return data;
  }
  return null;
}

export async function refreshTCTodos(): Promise<TCActivity[] | null> {
  console.log("[puDataCache] refreshing TronClass todos…");
  const data = await tcFetchTodos();
  await writeCache(KEYS.tcTodos, data);
  return data;
}

// ─── 一次全部抓取（登入後呼叫） ─────────────────────────

export type SyncAllResult = {
  courses: PUCourseResult | null;
  grades: PUGradeResult | null;
  announcements: PUAnnouncement[] | null;
  studentInfo: PUStudentInfo | null;
  tcCourses: TCCourse[] | null;
};

/**
 * 登入成功後呼叫：平行抓取所有資料並存入快取。
 * 如果個別抓取失敗不會中斷其他的。
 */
export async function syncAllData(session: PUSession): Promise<SyncAllResult> {
  console.log("[puDataCache] syncAllData: starting full sync…");

  const [courses, grades, announcements, studentInfo, tcCourses] = await Promise.all([
    refreshCourses(session).catch((e) => { console.warn("[puDataCache] courses sync error:", e); return null; }),
    refreshGrades(session).catch((e) => { console.warn("[puDataCache] grades sync error:", e); return null; }),
    refreshAnnouncements(session).catch((e) => { console.warn("[puDataCache] announcements sync error:", e); return null; }),
    refreshStudentInfo(session).catch((e) => { console.warn("[puDataCache] studentInfo sync error:", e); return null; }),
    refreshTCCourses().catch((e) => { console.warn("[puDataCache] TC courses sync error:", e); return null; }),
  ]);

  // TronClass: 如果有課程，背景抓取活動和模組
  if (tcCourses && tcCourses.length > 0) {
    const courseIds = tcCourses.map((c) => c.id);
    Promise.allSettled([
      refreshTCActivitiesForCourses(courseIds),
      refreshTCModulesForCourses(courseIds),
      refreshTCAttendance(),
      refreshTCTodos(),
    ]).catch(() => {});
  }

  await AsyncStorage.setItem(KEYS.lastSync, String(Date.now()));

  const successCount = [courses, grades, announcements, studentInfo, tcCourses].filter(Boolean).length;
  console.log(`[puDataCache] syncAllData done: ${successCount}/5 succeeded`);

  return { courses, grades, announcements, studentInfo, tcCourses };
}

// ─── 智慧刷新（只更新過期的） ───────────────────────────

/**
 * 只刷新已過期的資料。適合放在 app 回到前景時呼叫。
 */
export async function refreshStaleData(session: PUSession): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  const coursesEntry = await readCache<PUCourseResult>(KEYS.courses);
  if (isExpired(coursesEntry, TTL.courses)) tasks.push(refreshCourses(session));

  const gradesEntry = await readCache<PUGradeResult>(KEYS.grades);
  if (isExpired(gradesEntry, TTL.grades)) tasks.push(refreshGrades(session));

  const annEntry = await readCache<PUAnnouncement[]>(KEYS.announcements);
  if (isExpired(annEntry, TTL.announcements)) tasks.push(refreshAnnouncements(session));

  const studentEntry = await readCache<PUStudentInfo>(KEYS.studentInfo);
  if (isExpired(studentEntry, TTL.studentInfo)) tasks.push(refreshStudentInfo(session));

  // TronClass stale data
  const tcCoursesEntry = await readCache<TCCourse[]>(KEYS.tcCourses);
  if (isExpired(tcCoursesEntry, TTL.tcCourses)) tasks.push(refreshTCCourses());

  const tcTodosEntry = await readCache<TCActivity[]>(KEYS.tcTodos);
  if (isExpired(tcTodosEntry, TTL.tcTodos)) tasks.push(refreshTCTodos());

  const tcAttEntry = await readCache<TCAttendance[]>(KEYS.tcAttendance);
  if (isExpired(tcAttEntry, TTL.tcAttendance)) tasks.push(refreshTCAttendance());

  if (tasks.length > 0) {
    console.log(`[puDataCache] refreshStaleData: ${tasks.length} items stale, refreshing…`);
    await Promise.allSettled(tasks);
  } else {
    console.log("[puDataCache] refreshStaleData: all cache fresh");
  }
}

// ─── 清除 ────────────────────────────────────────────────

/** 登出時呼叫 */
export async function clearPUCache(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
  console.log("[puDataCache] cache cleared");
}

/** 取得最後同步時間 */
export async function getLastSyncTime(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(KEYS.lastSync);
  return raw ? parseInt(raw, 10) : null;
}
