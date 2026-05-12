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
import AsyncStorage from '@react-native-async-storage/async-storage';
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
} from './puDirectScraper';
import { getCloudFunctionUrl, getFirebaseAuthHeaders } from './cloudFunctions';
import {
  tcFetchCourses,
  tcFetchActivities,
  tcFetchModules,
  tcFetchAttendance,
  tcFetchProfile,
  tcFetchTodos,
  autoRefreshTCSession,
  hasTCSession,
  type TCCourse,
  type TCActivity,
  type TCModule,
  type TCAttendance,
} from './tronClassClient';

// ─── Cache Keys（v1 namespace + 舊版遷移）──────────────────

const LEGACY_PREFIX = '@pu_cache:';
const KEYS = {
  courses: 'puCache:v1:pu:courses',
  grades: 'puCache:v1:pu:grades',
  announcements: 'puCache:v1:pu:announcements',
  studentInfo: 'puCache:v1:pu:studentInfo',
  tcCourses: 'puCache:v1:tron:courses',
  tcActivities: 'puCache:v1:tron:activities',
  tcModules: 'puCache:v1:tron:modules',
  tcAttendance: 'puCache:v1:tron:attendance',
  tcTodos: 'puCache:v1:tron:todos',
  tcGrades: 'puCache:v1:tron:grades',
  lastSync: 'puCache:v1:meta:lastSync',
} as const;

const LEGACY_KEYS: Record<(typeof KEYS)[keyof typeof KEYS], string> = {
  [KEYS.courses]: `${LEGACY_PREFIX}courses`,
  [KEYS.grades]: `${LEGACY_PREFIX}grades`,
  [KEYS.announcements]: `${LEGACY_PREFIX}announcements`,
  [KEYS.studentInfo]: `${LEGACY_PREFIX}studentInfo`,
  [KEYS.tcCourses]: `${LEGACY_PREFIX}tc_courses`,
  [KEYS.tcActivities]: `${LEGACY_PREFIX}tc_activities`,
  [KEYS.tcModules]: `${LEGACY_PREFIX}tc_modules`,
  [KEYS.tcAttendance]: `${LEGACY_PREFIX}tc_attendance`,
  [KEYS.tcTodos]: `${LEGACY_PREFIX}tc_todos`,
  [KEYS.tcGrades]: `${LEGACY_PREFIX}tc_grades`,
  [KEYS.lastSync]: `${LEGACY_PREFIX}lastSync`,
};

// ─── TTL (毫秒) ─────────────────────────────────────────

const TTL = {
  courses: 7 * 24 * 60 * 60 * 1000, // 7 天
  grades: 24 * 60 * 60 * 1000, // 1 天
  announcements: 30 * 60 * 1000, // 30 分鐘
  studentInfo: 30 * 24 * 60 * 60 * 1000, // 30 天
  tcCourses: 12 * 60 * 60 * 1000, // 12 小時
  tcActivities: 2 * 60 * 60 * 1000, // 2 小時（作業截止時間重要）
  tcModules: 12 * 60 * 60 * 1000, // 12 小時
  tcAttendance: 6 * 60 * 60 * 1000, // 6 小時
  tcTodos: 30 * 60 * 1000, // 30 分鐘（待辦最即時）
  tcGrades: 6 * 60 * 60 * 1000, // 6 小時
} as const;

// ─── Cached Entry 結構（postLoginRouter 與引擎僅依賴此介面）──

export type PuTypedCacheEntry<T> = {
  data: T;
  fetchedAt: string; // ISO
  source: 'tron' | 'pu' | 'firebase' | 'mixed';
  ttlMs: number;
};

type CacheEntry<T> = PuTypedCacheEntry<T>;

function keySourceAndTtl(key: string): { source: CacheEntry<unknown>['source']; ttlMs: number } {
  if (key.includes(':tron:')) {
    if (key.includes('todos')) return { source: 'tron', ttlMs: TTL.tcTodos };
    if (key.includes('activities')) return { source: 'tron', ttlMs: TTL.tcActivities };
    if (key.includes('attendance')) return { source: 'tron', ttlMs: TTL.tcAttendance };
    if (key.includes('modules')) return { source: 'tron', ttlMs: TTL.tcModules };
    if (key.includes('grades')) return { source: 'tron', ttlMs: TTL.tcGrades };
    if (key.includes('courses')) return { source: 'tron', ttlMs: TTL.tcCourses };
    return { source: 'tron', ttlMs: TTL.tcCourses };
  }
  if (key.includes(':meta:')) return { source: 'mixed', ttlMs: Number.MAX_SAFE_INTEGER };
  if (key.includes('announcements')) return { source: 'pu', ttlMs: TTL.announcements };
  if (key.includes('grades')) return { source: 'pu', ttlMs: TTL.grades };
  if (key.includes('studentInfo')) return { source: 'pu', ttlMs: TTL.studentInfo };
  if (key.includes('courses')) return { source: 'pu', ttlMs: TTL.courses };
  return { source: 'pu', ttlMs: TTL.courses };
}

function normalizeRawEntry<T>(
  raw: string,
  key: string,
): CacheEntry<T> | null {
  try {
    const parsed = JSON.parse(raw) as {
      data: T;
      fetchedAt?: number | string;
      source?: CacheEntry<T>['source'];
      ttlMs?: number;
    };
    if (parsed == null || typeof parsed !== 'object' || !('data' in parsed)) return null;
    const { source, ttlMs } = keySourceAndTtl(key);
    let fetchedAtIso: string;
    if (typeof parsed.fetchedAt === 'string' && parsed.fetchedAt.trim()) {
      fetchedAtIso = parsed.fetchedAt;
    } else if (typeof parsed.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt)) {
      fetchedAtIso = new Date(parsed.fetchedAt).toISOString();
    } else {
      fetchedAtIso = new Date().toISOString();
    }
    return {
      data: parsed.data,
      fetchedAt: fetchedAtIso,
      source: parsed.source ?? source,
      ttlMs: typeof parsed.ttlMs === 'number' ? parsed.ttlMs : ttlMs,
    };
  } catch {
    return null;
  }
}

// ─── 通用讀寫 ────────────────────────────────────────────

async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      return normalizeRawEntry<T>(raw, key);
    }
    const legacy = LEGACY_KEYS[key as keyof typeof LEGACY_KEYS];
    if (!legacy) return null;
    const oldRaw = await AsyncStorage.getItem(legacy);
    if (!oldRaw) return null;
    const migrated = normalizeRawEntry<T>(oldRaw, key);
    if (migrated) {
      await AsyncStorage.setItem(key, JSON.stringify(migrated)).catch(() => undefined);
    }
    return migrated;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    const { source, ttlMs } = keySourceAndTtl(key);
    const entry: CacheEntry<T> = {
      data,
      fetchedAt: new Date().toISOString(),
      source,
      ttlMs,
    };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (err) {
    console.warn('[puDataCache] writeCache failed:', key, err);
  }
}

export async function seedCachedCourses(data: PUCourseResult): Promise<void> {
  await writeCache(KEYS.courses, data);
}

export async function seedCachedGrades(data: PUGradeResult): Promise<void> {
  await writeCache(KEYS.grades, data);
}

export async function seedCachedAnnouncements(data: PUAnnouncement[]): Promise<void> {
  await writeCache(KEYS.announcements, data);
}

export async function seedCachedStudentInfo(data: PUStudentInfo): Promise<void> {
  await writeCache(KEYS.studentInfo, data);
}

/** 外部引擎收集到 TronClass 課程後回寫快取（確保資料一致性） */
export async function seedCachedTCCourses(data: TCCourse[]): Promise<void> {
  await writeCache(KEYS.tcCourses, data);
}

/** 外部引擎收集到 TronClass 出席後回寫快取 */
export async function seedCachedTCAttendance(data: TCAttendance[]): Promise<void> {
  await writeCache(KEYS.tcAttendance, data);
}

function fetchedAtToMs(entry: CacheEntry<unknown> | null): number {
  if (!entry) return 0;
  const t = Date.parse(entry.fetchedAt);
  return Number.isFinite(t) ? t : 0;
}

function isExpired(entry: CacheEntry<unknown> | null, ttl: number): boolean {
  if (!entry) return true;
  const ttlUse = typeof entry.ttlMs === 'number' ? entry.ttlMs : ttl;
  return Date.now() - fetchedAtToMs(entry) > ttlUse;
}

type PUCampusBackendDataType = 'courses' | 'grades' | 'announcements' | 'studentInfo';

async function fetchPUCampusBackend<T>(
  session: PUSession,
  dataType: PUCampusBackendDataType,
  extra: Record<string, unknown> = {},
): Promise<T | null> {
  const sessionId = session.backendSessionId?.trim();
  if (!sessionId) return null;

  const url = getCloudFunctionUrl('puFetchCampusData');
  console.log(`[puDataCache] fetchPUCampusBackend: ${dataType} → ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10 秒逾時

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeaders()) },
      signal: controller.signal,
      body: JSON.stringify({
        sessionId,
        dataType,
        ...extra,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }

  if (!response.ok || !data) {
    throw new Error(
      (data?.error as string) || `PU campus backend request failed (HTTP ${response.status})`,
    );
  }

  // 後端可能回傳兩種格式：
  //   格式 A: { success: true, result: { ... } }     — result 包裝
  //   格式 B: { success: true, courses: [...], ... }  — 直接攤平
  // 都要支援。

  if (data.success !== true && data.success !== undefined) {
    throw new Error((data.error as string) || 'Backend returned success=false');
  }

  // 格式 A: 有 result 欄位
  if (data.result && typeof data.result === 'object') {
    console.log(`[puDataCache] fetchPUCampusBackend ${dataType}: got wrapped result`);
    return data.result as T;
  }

  // 格式 B: 資料直接在頂層（移除 success/error 後就是資料本身）
  const { success: _s, error: _e, ...rest } = data;
  if (Object.keys(rest).length > 0) {
    console.log(
      `[puDataCache] fetchPUCampusBackend ${dataType}: got flat result, keys:`,
      Object.keys(rest),
    );
    return rest as T;
  }

  throw new Error(`PU campus backend returned empty result for ${dataType}`);
}

function normalizeStudentInfo(
  raw:
    | {
        studentId?: string | null;
        name?: string | null;
        class?: string | null;
        className?: string | null;
        currentSemester?: string | null;
        department?: string | null;
        grade?: string | null;
        enrollmentStatus?: string | null;
      }
    | null
    | undefined,
): PUStudentInfo {
  return {
    studentId: raw?.studentId ?? null,
    name: raw?.name ?? null,
    className: raw?.className ?? raw?.class ?? null,
    currentSemester: raw?.currentSemester ?? null,
    department: raw?.department ?? null,
    grade: raw?.grade ?? null,
    enrollmentStatus: raw?.enrollmentStatus ?? null,
  };
}

async function ensureTronClassSession(): Promise<void> {
  // 先嘗試一個輕量的 session 檢查
  // tcFetchProfile 內部的 fetchTronClassBackend 遇到 401 會自動嘗試
  // auto-refresh 一次，所以如果成功就代表 session 有效或已刷新。
  try {
    const profile = await tcFetchProfile();
    if (profile?.id) return; // session 有效（或已自動刷新）
  } catch (profileError) {
    // fetchTronClassBackend 內部 auto-refresh 也失敗了
    // → 這裡再獨立嘗試一次完整的 auto-refresh
    console.warn('[puDataCache] tcFetchProfile threw:', profileError);
  }

  // 第二道防線：手動呼叫 autoRefreshTCSession（可能用不同的 login 策略）
  console.log('[puDataCache] TronClass session expired, trying manual auto-refresh…');
  const refreshed = await autoRefreshTCSession();
  if (refreshed) {
    console.log('[puDataCache] TronClass manual auto-refresh succeeded');
    return;
  }

  // 最後一道防線：檢查是否有 session 但 profile 端點本身不可用
  // （靜宜 TronClass 的 /api/users/{id} 會回 403，/api/profile 可能也不穩定）
  const hasSession = await hasTCSession();
  if (hasSession) {
    console.log(
      '[puDataCache] TronClass has session but profile endpoint failed — proceeding anyway',
    );
    return;
  }

  throw new Error('TronClass session 已失效，請重新登入');
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
  console.log('[puDataCache] refreshing courses…');
  if (session.backendSessionId) {
    try {
      const result = await fetchPUCampusBackend<{
        success?: boolean;
        courses?: PUCourseResult['courses'];
        studentInfo?: {
          studentId?: string | null;
          name?: string | null;
          class?: string | null;
          className?: string | null;
          currentSemester?: string | null;
          department?: string | null;
          grade?: string | null;
          enrollmentStatus?: string | null;
        } | null;
        semester?: string | null;
        totalCredits?: number;
      }>(session, 'courses');

      // fetchPUCampusBackend 已驗證外層 success，這裡只需檢查 result 存在
      if (result) {
        const normalized: PUCourseResult = {
          courses: result.courses ?? [],
          studentInfo: normalizeStudentInfo(result.studentInfo),
          semester: result.semester ?? null,
          totalCredits: result.totalCredits ?? 0,
        };
        await writeCache(KEYS.courses, normalized);
        console.log(
          `[puDataCache] refreshCourses backend OK: ${normalized.courses.length} courses`,
        );
        return normalized;
      }
    } catch (error) {
      console.warn('[puDataCache] refreshCourses backend failed:', error);
      // 後端模式失敗時不要 fallback 到直連（沒有 native cookie）
      // 改為嘗試讀取已有快取
      const cached = await getAnyCachedCourses();
      if (cached) {
        console.log('[puDataCache] refreshCourses: using existing cache as fallback');
        return cached;
      }
    }
    // 後端模式下不 fallback 到 nativeFetch（無 cookie）
    return null;
  }

  // 直連模式（hybrid login）— native cookie jar 有效
  const result = await puFetchCourses(session);
  if (result.success && result.data) {
    await writeCache(KEYS.courses, result.data);
    return result.data;
  }
  console.warn('[puDataCache] refreshCourses failed:', result.error);
  return null;
}

export async function refreshGrades(session: PUSession): Promise<PUGradeResult | null> {
  console.log('[puDataCache] refreshing grades…');
  if (session.backendSessionId) {
    try {
      const result = await fetchPUCampusBackend<{
        success?: boolean;
        grades?: PUGradeResult['grades'];
        allSemesters?: string[];
        summary?: PUGradeResult['summary'];
      }>(session, 'grades');

      if (result) {
        const normalized: PUGradeResult = {
          grades: result.grades ?? [],
          allSemesters: result.allSemesters ?? [],
          summary: result.summary ?? {},
        };
        await writeCache(KEYS.grades, normalized);
        console.log(`[puDataCache] refreshGrades backend OK: ${normalized.grades.length} grades`);
        return normalized;
      }
    } catch (error) {
      console.warn('[puDataCache] refreshGrades backend failed:', error);
      const cached = await getAnyCachedGrades();
      if (cached) {
        console.log('[puDataCache] refreshGrades: using existing cache as fallback');
        return cached;
      }
    }
    return null;
  }

  const result = await puFetchGrades(session);
  if (result.success && result.data) {
    await writeCache(KEYS.grades, result.data);
    return result.data;
  }
  console.warn('[puDataCache] refreshGrades failed:', result.error);
  return null;
}

export async function refreshAnnouncements(session: PUSession): Promise<PUAnnouncement[] | null> {
  console.log('[puDataCache] refreshing announcements…');
  if (session.backendSessionId) {
    try {
      const result = await fetchPUCampusBackend<{
        success?: boolean;
        announcements?: PUAnnouncement[];
      }>(session, 'announcements');

      if (result) {
        const normalized = result.announcements ?? [];
        await writeCache(KEYS.announcements, normalized);
        console.log(`[puDataCache] refreshAnnouncements backend OK: ${normalized.length} items`);
        return normalized;
      }
    } catch (error) {
      console.warn('[puDataCache] refreshAnnouncements backend failed:', error);
      const cached = await getAnyCachedAnnouncements();
      if (cached) {
        console.log('[puDataCache] refreshAnnouncements: using existing cache as fallback');
        return cached;
      }
    }
    return null;
  }

  const result = await puFetchAnnouncements(session);
  if (result.success) {
    await writeCache(KEYS.announcements, result.data);
    return result.data;
  }
  console.warn('[puDataCache] refreshAnnouncements failed:', result.error);
  return null;
}

export async function refreshStudentInfo(session: PUSession): Promise<PUStudentInfo | null> {
  console.log('[puDataCache] refreshing studentInfo…');
  if (session.backendSessionId) {
    try {
      const result = await fetchPUCampusBackend<{
        success?: boolean;
        studentInfo?: {
          studentId?: string | null;
          name?: string | null;
          class?: string | null;
          className?: string | null;
          currentSemester?: string | null;
          department?: string | null;
          grade?: string | null;
          enrollmentStatus?: string | null;
        } | null;
      }>(session, 'studentInfo');

      if (result) {
        const normalized = normalizeStudentInfo(result.studentInfo);
        await writeCache(KEYS.studentInfo, normalized);
        console.log(`[puDataCache] refreshStudentInfo backend OK: ${normalized.name}`);
        return normalized;
      }
    } catch (error) {
      console.warn('[puDataCache] refreshStudentInfo backend failed:', error);
      const cached = await getAnyCachedStudentInfo();
      if (cached) {
        console.log('[puDataCache] refreshStudentInfo: using existing cache as fallback');
        return cached;
      }
    }
    return null;
  }

  const result = await puFetchStudentInfo(session);
  if (result.success && result.data) {
    await writeCache(KEYS.studentInfo, result.data);
    return result.data;
  }
  console.warn('[puDataCache] refreshStudentInfo failed:', result.error);
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
export async function getAnyCachedTCModules(): Promise<Record<number, TCModule[]> | null> {
  return (await readCache<Record<number, TCModule[]>>(KEYS.tcModules))?.data ?? null;
}
export async function getAnyCachedTCTodos(): Promise<TCActivity[] | null> {
  return (await readCache<TCActivity[]>(KEYS.tcTodos))?.data ?? null;
}
export async function getAnyCachedTCAttendance(): Promise<TCAttendance[] | null> {
  return (await readCache<TCAttendance[]>(KEYS.tcAttendance))?.data ?? null;
}

/** TronClass 成績快取 — 寫入 */
export async function seedCachedTCGrades(data: unknown[]): Promise<void> {
  await writeCache(KEYS.tcGrades, data);
}

/** TronClass 成績快取 — 讀取（不管 TTL） */
export async function getAnyCachedTCGrades(): Promise<unknown[] | null> {
  return (await readCache<unknown[]>(KEYS.tcGrades))?.data ?? null;
}

// ─── TronClass 刷新 ─────────────────────────────────────

export async function refreshTCCourses(): Promise<TCCourse[] | null> {
  console.log('[puDataCache] refreshing TronClass courses…');
  await ensureTronClassSession();
  const courses = await tcFetchCourses('ongoing');
  await writeCache(KEYS.tcCourses, courses);
  return courses;
}

export async function refreshTCActivitiesForCourses(
  courseIds: number[],
): Promise<Record<number, TCActivity[]>> {
  console.log(`[puDataCache] refreshing TronClass activities for ${courseIds.length} courses…`);
  await ensureTronClassSession();
  const result: Record<number, TCActivity[]> = {};

  await Promise.allSettled(
    courseIds.map(async (id) => {
      const activities = await tcFetchActivities(id);
      result[id] = activities;
    }),
  );

  await writeCache(KEYS.tcActivities, result);
  return result;
}

export async function refreshTCModulesForCourses(
  courseIds: number[],
): Promise<Record<number, TCModule[]>> {
  console.log(`[puDataCache] refreshing TronClass modules for ${courseIds.length} courses…`);
  await ensureTronClassSession();
  const result: Record<number, TCModule[]> = {};

  await Promise.allSettled(
    courseIds.map(async (id) => {
      const modules = await tcFetchModules(id);
      result[id] = modules;
    }),
  );

  await writeCache(KEYS.tcModules, result);
  return result;
}

export async function refreshTCAttendance(): Promise<TCAttendance[] | null> {
  console.log('[puDataCache] refreshing TronClass attendance…');
  await ensureTronClassSession();
  const data = await tcFetchAttendance();
  await writeCache(KEYS.tcAttendance, data);
  return data;
}

export async function refreshTCTodos(): Promise<TCActivity[] | null> {
  console.log('[puDataCache] refreshing TronClass todos…');
  await ensureTronClassSession();
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
  tcActivities: Record<number, TCActivity[]> | null;
  tcModules: Record<number, TCModule[]> | null;
  tcAttendance: TCAttendance[] | null;
  tcTodos: TCActivity[] | null;
};

export type SyncAllOptions = {
  tcCourses?: TCCourse[] | null;
  includeEssential?: boolean;
};

/**
 * 登入成功後呼叫：補抓延伸資料並存入快取。
 * 必要資料（學生資料/課表/成績/公告/TronClass 課程）應由登入 bootstrap 先完成。
 *
 * 重要：如果登入 bootstrap 已經 seed 了快取，這裡會先檢查快取是否已存在，
 * 避免覆蓋或浪費網路請求。
 */
export async function syncAllData(
  session: PUSession,
  options: SyncAllOptions = {},
): Promise<SyncAllResult> {
  console.log('[puDataCache] syncAllData: starting deferred sync…');

  const includeEssential = options.includeEssential === true;

  let courses: PUCourseResult | null = null;
  let grades: PUGradeResult | null = null;
  let announcements: PUAnnouncement[] | null = null;
  let studentInfo: PUStudentInfo | null = null;

  if (includeEssential) {
    // 先檢查是否已有快取（登入 bootstrap 可能已 seed）
    const [cachedCourses, cachedGrades, cachedAnn, cachedInfo] = await Promise.all([
      getAnyCachedCourses(),
      getAnyCachedGrades(),
      getAnyCachedAnnouncements(),
      getAnyCachedStudentInfo(),
    ]);

    // 只刷新尚未有快取的項目
    const refreshTasks = await Promise.all([
      cachedCourses
        ? Promise.resolve(cachedCourses)
        : refreshCourses(session).catch((e) => {
            console.warn('[puDataCache] courses sync error:', e);
            return null;
          }),
      cachedGrades
        ? Promise.resolve(cachedGrades)
        : refreshGrades(session).catch((e) => {
            console.warn('[puDataCache] grades sync error:', e);
            return null;
          }),
      cachedAnn
        ? Promise.resolve(cachedAnn)
        : refreshAnnouncements(session).catch((e) => {
            console.warn('[puDataCache] announcements sync error:', e);
            return null;
          }),
      cachedInfo
        ? Promise.resolve(cachedInfo)
        : refreshStudentInfo(session).catch((e) => {
            console.warn('[puDataCache] studentInfo sync error:', e);
            return null;
          }),
    ]);
    [courses, grades, announcements, studentInfo] = refreshTasks;
    console.log(
      `[puDataCache] essential data: courses=${courses ? ((courses as PUCourseResult).courses?.length ?? 0) : 'null'}, ` +
        `grades=${grades ? ((grades as PUGradeResult).grades?.length ?? 0) : 'null'}, ` +
        `announcements=${announcements ? (announcements as PUAnnouncement[]).length : 'null'}, ` +
        `studentInfo=${studentInfo ? (studentInfo as PUStudentInfo).name : 'null'}`,
    );
  }

  const tcCourses =
    options.tcCourses ??
    (await getCachedTCCourses()) ??
    (await getAnyCachedTCCourses()) ??
    (await refreshTCCourses().catch((e) => {
      console.warn('[puDataCache] TC courses sync error:', e);
      return null;
    }));

  let tcActivities: Record<number, TCActivity[]> | null = null;
  let tcModules: Record<number, TCModule[]> | null = null;
  let tcAttendance: TCAttendance[] | null = null;
  let tcTodos: TCActivity[] | null = null;

  const courseIds = tcCourses?.map((c) => c.id) ?? [];

  if (courseIds.length > 0) {
    [tcActivities, tcModules, tcAttendance, tcTodos] = await Promise.all([
      refreshTCActivitiesForCourses(courseIds).catch((e) => {
        console.warn('[puDataCache] TC activities sync error:', e);
        return null;
      }),
      refreshTCModulesForCourses(courseIds).catch((e) => {
        console.warn('[puDataCache] TC modules sync error:', e);
        return null;
      }),
      refreshTCAttendance().catch((e) => {
        console.warn('[puDataCache] TC attendance sync error:', e);
        return null;
      }),
      refreshTCTodos().catch((e) => {
        console.warn('[puDataCache] TC todos sync error:', e);
        return null;
      }),
    ]);
  } else {
    [tcAttendance, tcTodos] = await Promise.all([
      refreshTCAttendance().catch((e) => {
        console.warn('[puDataCache] TC attendance sync error:', e);
        return null;
      }),
      refreshTCTodos().catch((e) => {
        console.warn('[puDataCache] TC todos sync error:', e);
        return null;
      }),
    ]);
  }

  await AsyncStorage.setItem(KEYS.lastSync, String(Date.now()));

  const successCount = [
    courses,
    grades,
    announcements,
    studentInfo,
    tcCourses,
    tcActivities,
    tcModules,
    tcAttendance,
    tcTodos,
  ].filter((value) => value != null).length;
  console.log(`[puDataCache] syncAllData done: ${successCount}/9 succeeded`);

  return {
    courses,
    grades,
    announcements,
    studentInfo,
    tcCourses,
    tcActivities,
    tcModules,
    tcAttendance,
    tcTodos,
  };
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
    console.log('[puDataCache] refreshStaleData: all cache fresh');
  }
}

// ─── 清除 ────────────────────────────────────────────────

/** 登出時呼叫 */
export async function clearPUCache(): Promise<void> {
  await AsyncStorage.multiRemove([...Object.values(KEYS), ...Object.values(LEGACY_KEYS)]);
  console.log('[puDataCache] cache cleared');
}

/** 開發診斷：列出 v1 快取條目摘要 */
export async function getPuCacheDebugMetadata(): Promise<
  { key: string; fetchedAt: string | null; source: string | null; ttlMs: number | null }[]
> {
  const keys = Object.values(KEYS) as string[];
  const out: { key: string; fetchedAt: string | null; source: string | null; ttlMs: number | null }[] =
    [];
  for (const k of keys) {
    const entry = await readCache<unknown>(k);
    out.push({
      key: k,
      fetchedAt: entry?.fetchedAt ?? null,
      source: entry?.source ?? null,
      ttlMs: entry?.ttlMs ?? null,
    });
  }
  return out;
}

/** 取得最後同步時間 */
export async function getLastSyncTime(): Promise<number | null> {
  let raw = await AsyncStorage.getItem(KEYS.lastSync);
  if (!raw) {
    raw = await AsyncStorage.getItem(LEGACY_KEYS[KEYS.lastSync]);
  }
  return raw ? parseInt(raw, 10) : null;
}

// ─── Stale-While-Revalidate ─────────────────────────────

/**
 * 通用 stale-while-revalidate 讀取。
 *
 * 行為：
 *   1. 先從快取讀取（不管 TTL），有就立即回傳 → UI 秒開
 *   2. 如果已過 TTL，背景觸發 refreshFn 更新快取
 *   3. refreshFn 完成後呼叫 onFresh callback，UI 可據此刷新
 *
 * 效果：使用者永遠看到「上次成功的資料」，同時背景自動拉最新。
 */
export async function staleWhileRevalidate<T>(opts: {
  cacheKey: keyof typeof KEYS;
  ttl: number;
  refreshFn: () => Promise<T | null>;
  onFresh?: (data: T) => void;
}): Promise<T | null> {
  const key = KEYS[opts.cacheKey];
  const entry = await readCache<T>(key);

  // 1. 立即回傳快取（即使過期）
  const staleData = entry?.data ?? null;

  // 2. 如果過期，背景刷新
  if (isExpired(entry, opts.ttl)) {
    opts.refreshFn()
      .then((freshData) => {
        if (freshData != null && opts.onFresh) {
          opts.onFresh(freshData);
        }
      })
      .catch((err) => {
        console.warn(`[puDataCache] staleWhileRevalidate refresh failed for ${opts.cacheKey}:`, err);
      });
  }

  return staleData;
}

/** 判斷某快取 key 是否過期（供外部使用） */
export async function isCacheStale(cacheKey: keyof typeof KEYS): Promise<boolean> {
  const key = KEYS[cacheKey];
  const entry = await readCache<unknown>(key);
  const { ttlMs } = keySourceAndTtl(key);
  return isExpired(entry, ttlMs);
}
