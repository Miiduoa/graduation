/**
 * TronClass API Client for Providence University (靜宜大學)
 *
 * TronClass (tronclass.pu.edu.tw) 是靜宜使用的 LMS，
 * 認證走 Keycloak CAS (identity.pu.edu.tw)，
 * 資料走 REST JSON API (/api/...)。
 *
 * 登入流程：
 *   1. GET  identity.pu.edu.tw CAS login page → 拿到 form action + hidden fields
 *   2. POST credentials → CAS 給 ticket 然後 redirect 回 TronClass
 *   3. TronClass 驗票後給 session cookie
 *   4. 後續所有 /api/ 請求用 credentials:"include" 自動帶 cookie
 *
 * 所有 API response 都是 JSON。
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCloudFunctionUrl } from "./cloudFunctions";

// ─── Constants ───────────────────────────────────────────

const TC_BASE = "https://tronclass.pu.edu.tw";
const IDENTITY_BASE = "https://identity.pu.edu.tw";
const CAS_LOGIN_PATH = "/auth/realms/pu/protocol/cas/login";
const TC_LOGIN_SERVICE_URL = `${TC_BASE}/login?next=/user/index`;
const TC_BACKEND_SESSION_KEY = "@pu_cache:tc_backend_session";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
};

// ─── 全域 userId（登入後從 /user/index 取得） ────────────
let _tcUserId: number | null = null;
let _tcBackendSessionId: string | null = null;
let _tcBackendSessionLoaded = false;

// ─── Types ───────────────────────────────────────────────

export type TCSession = {
  loggedIn: true;
  userId: number | null;
  userName: string | null;
};

export type TCCourse = {
  id: number;
  name: string;
  course_code: string;
  department_id: number | null;
  semester_id: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  role: string;        // student, teacher, ta
  teacher_name: string | null;
  cover_image_url: string | null;
  student_count: number;
};

export type TCActivity = {
  id: number;
  course_id: number;
  type: string;           // homework, exam, quiz, discussion, material, survey, etc.
  title: string;
  description: string | null;
  begin_date: string | null;
  end_date: string | null;  // due date
  score: number | null;
  total_score: number | null;
  status: string;           // submitted, graded, pending, etc.
  weight: number | null;    // percentage weight in final grade
};

export type TCModule = {
  id: number;
  course_id: number;
  title: string;
  description: string | null;
  position: number;
  published: boolean;
  activities: TCActivity[];
};

export type TCUserProfile = {
  id: number;
  name: string;
  login_name: string;
  email: string | null;
  avatar_url: string | null;
  role: string;
};

export type TCAttendance = {
  course_id: number;
  course_name: string;
  total_sessions: number;
  attended: number;
  absent: number;
  late: number;
  leave: number;
  rate: number;       // 0-100
};

export type TCGradeItem = {
  course_id: number;
  course_name: string;
  final_score: number | null;
  final_grade: string | null;  // A, B+, etc.
  grade_point: number | null;  // 4.0, 3.7, etc.
  credits: number;
  semester: string;
};

async function ensureBackendSessionLoaded(): Promise<void> {
  if (_tcBackendSessionLoaded) return;
  _tcBackendSessionLoaded = true;

  try {
    const raw = await AsyncStorage.getItem(TC_BACKEND_SESSION_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      sessionId?: string;
      userId?: number | null;
    };

    if (typeof parsed.sessionId === "string" && parsed.sessionId.trim()) {
      _tcBackendSessionId = parsed.sessionId.trim();
    }

    if (typeof parsed.userId === "number" && Number.isFinite(parsed.userId)) {
      _tcUserId = parsed.userId;
    }
  } catch (error) {
    console.warn("[TronClass] Failed to restore backend session:", error);
  }
}

function shouldUseBackendSession(): boolean {
  return !!_tcBackendSessionId;
}

export async function setTCBackendSession(
  sessionId: string,
  userId?: number | null,
): Promise<void> {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error("Invalid TronClass backend session");
  }

  _tcBackendSessionId = normalized;
  _tcBackendSessionLoaded = true;
  _tcUserId = typeof userId === "number" && Number.isFinite(userId) ? userId : _tcUserId;

  await AsyncStorage.setItem(
    TC_BACKEND_SESSION_KEY,
    JSON.stringify({
      sessionId: normalized,
      userId: _tcUserId,
    }),
  );
}

export async function clearTCSession(): Promise<void> {
  _tcUserId = null;
  _tcBackendSessionId = null;
  _tcBackendSessionLoaded = true;
  await AsyncStorage.removeItem(TC_BACKEND_SESSION_KEY).catch(() => undefined);
}

/** 檢查是否有 TronClass session（不驗證有效性，只檢查是否存在） */
export async function hasTCSession(): Promise<boolean> {
  await ensureBackendSessionLoaded();
  return !!_tcBackendSessionId;
}

/**
 * 驗證 TronClass session 是否仍然有效。
 * 嘗試呼叫 profile API — 如果 401/403 代表 session 已過期。
 * 回傳 true 表示有效，false 表示已過期或不存在。
 */
export async function validateTCSession(): Promise<boolean> {
  await ensureBackendSessionLoaded();
  if (!_tcBackendSessionId) return false;

  try {
    const profile = await fetchTronClassBackend<TCUserProfile>("profile");
    return !!profile?.id;
  } catch {
    return false;
  }
}

async function fetchTronClassBackend<T>(
  dataType: "profile" | "courses" | "activities" | "modules" | "attendance" | "todos",
  extra: Record<string, unknown> = {},
): Promise<T> {
  await ensureBackendSessionLoaded();
  if (!shouldUseBackendSession()) {
    throw new Error("No TronClass backend session");
  }

  const response = await fetch(getCloudFunctionUrl("puFetchTronClassData"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId: _tcBackendSessionId,
      dataType,
      ...extra,
    }),
  });

  const text = await response.text();
  let data: { success?: boolean; result?: T; error?: string; userId?: number | null } | null = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text) as { success?: boolean; result?: T; error?: string; userId?: number | null };
    } catch {
      data = null;
    }
  }

  if (!response.ok || data?.success !== true) {
    const errorMessage =
      data?.error ||
      (response.status === 401 || response.status === 403
        ? "TronClass session 已失效，請重新登入"
        : `TronClass 代理請求失敗（HTTP ${response.status}）`);

    if (response.status === 401 || response.status === 403) {
      await clearTCSession().catch(() => undefined);
    }

    throw new Error(errorMessage);
  }

  if (typeof data.userId === "number" && Number.isFinite(data.userId)) {
    _tcUserId = data.userId;
    await AsyncStorage.setItem(
      TC_BACKEND_SESSION_KEY,
      JSON.stringify({
        sessionId: _tcBackendSessionId,
        userId: _tcUserId,
      }),
    ).catch(() => undefined);
  }

  return data.result as T;
}

// ─── Helper: Native Fetch ────────────────────────────────

async function tcFetch(
  url: string,
  options: {
    method?: string;
    body?: string;
    contentType?: string;
    accept?: string;
  } = {}
): Promise<{ body: string; status: number; url: string }> {
  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.contentType) headers["Content-Type"] = options.contentType;
  if (options.accept) headers.Accept = options.accept;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    credentials: "include",
    redirect: "follow",
  });

  const body = await response.text();
  return { body, status: response.status, url: response.url };
}

async function tcFetchJSON<T>(url: string): Promise<T | null> {
  try {
    const result = await tcFetch(url, { accept: "application/json" });
    if (result.status !== 200) {
      console.warn(`[TronClass] API ${result.status}: ${url}`);
      return null;
    }
    // 如果被 redirect 到登入頁，body 會是 HTML
    if (result.body.trimStart().startsWith("<")) {
      console.warn("[TronClass] Got HTML instead of JSON, session might be expired");
      return null;
    }
    return JSON.parse(result.body) as T;
  } catch (err) {
    console.warn("[TronClass] fetch error:", url, err);
    return null;
  }
}

// ─── Login ───────────────────────────────────────────────

/**
 * 透過 Keycloak CAS 登入 TronClass。
 *
 * 步驟：
 * 1. GET CAS login page → 解析 form action 和隱藏欄位
 * 2. POST 帳密 → CAS redirect 回 TronClass 並設 cookie
 * 3. 驗證登入狀態 by calling /api/users/me
 */
export async function tcLogin(
  uid: string,
  password: string
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  try {
    if (!uid || !password) return { success: false, session: null, error: "請輸入帳號密碼" };

    const serviceUrl = TC_LOGIN_SERVICE_URL;
    const casUrl =
      `${IDENTITY_BASE}${CAS_LOGIN_PATH}` +
      `?ui_locales=zh-TW&service=${encodeURIComponent(serviceUrl)}&locale=zh_TW`;

    // Step 1: GET CAS login page
    console.log("[TronClass] Step 1: GET CAS login page…");
    const loginPage = await tcFetch(casUrl, { accept: "text/html" });
    console.log("[TronClass] CAS page status:", loginPage.status);

    // 解析 form action URL
    const formActionMatch = loginPage.body.match(/<form[^>]+action=["']([^"']+)["']/i);
    const formAction = formActionMatch?.[1]?.replace(/&amp;/g, "&") ?? loginPage.url;

    // 解析隱藏欄位
    const hiddenFields: Record<string, string> = {};
    const hiddenRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = hiddenRegex.exec(loginPage.body)) !== null) {
      const nameMatch = hMatch[0].match(/name=["']([^"']+)["']/);
      const valueMatch = hMatch[0].match(/value=["']([^"']*?)["']/);
      if (nameMatch?.[1]) {
        hiddenFields[nameMatch[1]] = valueMatch?.[1] ?? "";
      }
    }

    // Step 2: POST credentials
    console.log("[TronClass] Step 2: POST credentials to CAS…");
    const formData = new URLSearchParams({
      ...hiddenFields,
      username: uid,
      password: password,
    });

    const postUrl = formAction.startsWith("http")
      ? formAction
      : `${IDENTITY_BASE}${formAction}`;

    const loginResult = await tcFetch(postUrl, {
      method: "POST",
      body: formData.toString(),
      contentType: "application/x-www-form-urlencoded",
      accept: "text/html",
    });

    console.log("[TronClass] POST status:", loginResult.status);
    console.log("[TronClass] Landed on:", loginResult.url);

    // Step 3: 驗證登入 — 抓 /user/index 頁面取得 userId
    console.log("[TronClass] Step 3: verifying session via /user/index…");
    const indexPage = await tcFetch(`${TC_BASE}/user/index`, { accept: "text/html" });
    console.log("[TronClass] /user/index status:", indexPage.status);

    // 從 HTML 找 userId hidden input
    const userIdMatch = indexPage.body.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i)
      ?? indexPage.body.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i);

    if (!userIdMatch?.[1]) {
      // 嘗試看看是不是帳密錯
      if (
        loginResult.body.includes("密碼錯誤") ||
        loginResult.body.includes("Invalid") ||
        loginResult.body.includes("error") ||
        loginResult.body.includes("帳號或密碼")
      ) {
        return { success: false, session: null, error: "TronClass 帳號或密碼錯誤" };
      }
      return { success: false, session: null, error: "TronClass 登入失敗，無法取得使用者 ID" };
    }

    const userId = parseInt(userIdMatch[1], 10);
    _tcUserId = userId;

    // 嘗試從頁面取得使用者名稱
    const nameMatch = indexPage.body.match(/class=["']user-?name["'][^>]*>([^<]+)</i)
      ?? indexPage.body.match(/"name"\s*:\s*"([^"]+)"/);
    const userName = nameMatch?.[1]?.trim() ?? uid;

    console.log("[TronClass] Login success! User:", userName, "ID:", userId);
    return {
      success: true,
      session: {
        loggedIn: true,
        userId,
        userName,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "連線失敗";
    console.warn("[TronClass] Login error:", err);
    return { success: false, session: null, error: `TronClass 登入失敗：${msg}` };
  }
}

// ─── API Endpoints ───────────────────────────────────────

/** 取得 userId（登入後才能呼叫） */
async function ensureUserId(): Promise<number | null> {
  await ensureBackendSessionLoaded();
  if (_tcUserId) return _tcUserId;

  if (shouldUseBackendSession()) {
    const profile = await fetchTronClassBackend<TCUserProfile>("profile");
    if (profile?.id) {
      _tcUserId = profile.id;
    }
    return _tcUserId;
  }

  // 嘗試從 /user/index 抓取
  try {
    const page = await tcFetch(`${TC_BASE}/user/index`, { accept: "text/html" });
    const match = page.body.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i)
      ?? page.body.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i);
    if (match?.[1]) {
      _tcUserId = parseInt(match[1], 10);
    }
  } catch { /* ignore */ }

  return _tcUserId;
}

/** 分頁取得所有資料 */
async function tcFetchAllPages<T>(
  basePath: string,
  dataKey: string,
  params: Record<string, string> = {},
  pageSize = 20,
): Promise<T[]> {
  const allItems: T[] = [];
  let page = 1;

  while (true) {
    const queryParams = new URLSearchParams({
      ...params,
      page: String(page),
      page_size: String(pageSize),
    });
    const url = `${TC_BASE}/${basePath}?${queryParams.toString()}`;
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (!data) break;

    const items = data[dataKey];
    if (!Array.isArray(items) || items.length === 0) break;

    allItems.push(...(items as T[]));

    const totalPages = typeof data.pages === "number" ? data.pages : 1;
    if (page >= totalPages) break;
    page++;
  }

  return allItems;
}

/** 取得已選課程清單 */
export async function tcFetchCourses(
  status: "ongoing" | "ended" | "upcoming" = "ongoing"
): Promise<TCCourse[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCCourse[]>("courses", { status });
  }

  const userId = await ensureUserId();
  if (!userId) {
    console.warn("[TronClass] No userId, cannot fetch courses");
    return [];
  }

  const conditions = JSON.stringify({ status: [status] });
  type RawCourse = {
    id: number;
    name: string;
    course_code?: string;
    department_id?: number;
    semester_id?: number;
    start_date?: string;
    end_date?: string;
    status?: string;
    enroll_role?: string;
    cover?: { url?: string };
    teacher?: { name?: string };
    student_count?: number;
  };

  const courses = await tcFetchAllPages<RawCourse>(
    `api/users/${userId}/courses`,
    "courses",
    { conditions, fields: "id,name,course_code,department_id,semester_id,start_date,end_date,status,enroll_role,cover,teacher,student_count" },
    50,
  );

  return courses.map((c): TCCourse => ({
    id: c.id,
    name: c.name,
    course_code: c.course_code ?? "",
    department_id: c.department_id ?? null,
    semester_id: c.semester_id ?? null,
    start_date: c.start_date ?? null,
    end_date: c.end_date ?? null,
    status: c.status ?? status,
    role: c.enroll_role ?? "student",
    teacher_name: c.teacher?.name ?? null,
    cover_image_url: c.cover?.url ?? null,
    student_count: c.student_count ?? 0,
  }));
}

/** 取得課程的模組（週次/單元）— 嘗試多個可能的 endpoint */
export async function tcFetchModules(courseId: number): Promise<TCModule[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCModule[]>("modules", { courseId });
  }

  // TronClass 不同版本可能用不同 endpoint
  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/course-modules`,
    `${TC_BASE}/api/courses/${courseId}/modules`,
  ];

  for (const url of endpoints) {
    type APIResponse = Array<{
      id: number;
      title?: string;
      description?: string;
      position?: number;
      published?: boolean;
      activities?: Array<{
        id: number;
        type?: string;
        title?: string;
        description?: string;
        begin_date?: string;
        end_date?: string;
        score?: number;
        total_score?: number;
        status?: string;
        weight?: number;
      }>;
    }>;

    const data = await tcFetchJSON<APIResponse>(url);
    if (data && Array.isArray(data) && data.length > 0) {
      return data.map((m): TCModule => ({
        id: m.id,
        course_id: courseId,
        title: m.title ?? `Module ${m.position ?? 0}`,
        description: m.description ?? null,
        position: m.position ?? 0,
        published: m.published !== false,
        activities: (m.activities ?? []).map((a): TCActivity => ({
          id: a.id,
          course_id: courseId,
          type: a.type ?? "material",
          title: a.title ?? "",
          description: a.description ?? null,
          begin_date: a.begin_date ?? null,
          end_date: a.end_date ?? null,
          score: a.score ?? null,
          total_score: a.total_score ?? null,
          status: a.status ?? "pending",
          weight: a.weight ?? null,
        })),
      }));
    }
  }

  return [];
}

/** 取得課程活動（作業、測驗、教材等） */
export async function tcFetchActivities(courseId: number): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>("activities", { courseId });
  }

  // 先抓一般活動
  const url = `${TC_BASE}/api/courses/${courseId}/activities`;
  type RawActivity = {
    id: number;
    type?: string;
    title?: string;
    description?: string;
    begin_date?: string;
    end_date?: string;
    score?: number;
    total_score?: number;
    status?: string;
    weight?: number;
  };

  const data = await tcFetchJSON<{ activities?: RawActivity[] }>(url);
  const activities = data?.activities ?? [];

  // 也抓作業活動（可能是另一個 endpoint）
  const hwData = await tcFetchAllPages<RawActivity>(
    `api/courses/${courseId}/homework-activities`,
    "homework_activities",
    {},
    50,
  ).catch(() => [] as RawActivity[]);

  // 合併，去重
  const seen = new Set<number>();
  const all: TCActivity[] = [];

  for (const a of [...activities, ...hwData]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    all.push({
      id: a.id,
      course_id: courseId,
      type: a.type ?? "material",
      title: a.title ?? "",
      description: a.description ?? null,
      begin_date: a.begin_date ?? null,
      end_date: a.end_date ?? null,
      score: a.score ?? null,
      total_score: a.total_score ?? null,
      status: a.status ?? "pending",
      weight: a.weight ?? null,
    });
  }

  return all;
}

/** 取得出缺席統計 — 嘗試多個可能的 endpoint */
export async function tcFetchAttendance(): Promise<TCAttendance[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCAttendance[]>("attendance");
  }

  const userId = await ensureUserId();

  // TronClass 出缺席 API 沒有統一標準，嘗試多個可能路徑
  const endpoints = [
    userId ? `${TC_BASE}/api/users/${userId}/attendances` : null,
    `${TC_BASE}/api/users/me/attendances`,
    `${TC_BASE}/api/attendance/summary`,
  ].filter(Boolean) as string[];

  for (const url of endpoints) {
    type RawAttendance = {
      course_id?: number;
      course_name?: string;
      total?: number;
      total_sessions?: number;
      attended?: number;
      absent?: number;
      late?: number;
      leave?: number;
      rate?: number;
    };

    const data = await tcFetchJSON<RawAttendance[] | { attendances?: RawAttendance[] }>(url);
    const items = Array.isArray(data)
      ? data
      : (data as { attendances?: RawAttendance[] })?.attendances;

    if (items && Array.isArray(items) && items.length > 0) {
      return items.map((a): TCAttendance => ({
        course_id: a.course_id ?? 0,
        course_name: a.course_name ?? "",
        total_sessions: a.total ?? a.total_sessions ?? 0,
        attended: a.attended ?? 0,
        absent: a.absent ?? 0,
        late: a.late ?? 0,
        leave: a.leave ?? 0,
        rate: a.rate ?? 0,
      }));
    }
  }

  return [];
}

/** 取得成績（TronClass 不一定有全域成績 API，嘗試多個路徑） */
export async function tcFetchGrades(): Promise<TCGradeItem[]> {
  const userId = await ensureUserId();
  const endpoints = [
    userId ? `${TC_BASE}/api/users/${userId}/grades` : null,
    `${TC_BASE}/api/users/me/grades`,
    `${TC_BASE}/api/grades`,
  ].filter(Boolean) as string[];

  for (const url of endpoints) {
    type RawGrade = {
      course_id?: number;
      course_name?: string;
      final_score?: number;
      final_grade?: string;
      grade_point?: number;
      credits?: number;
      semester?: string;
    };

    const data = await tcFetchJSON<RawGrade[] | { grades?: RawGrade[] }>(url);
    const items = Array.isArray(data)
      ? data
      : (data as { grades?: RawGrade[] })?.grades;

    if (items && Array.isArray(items) && items.length > 0) {
      return items.map((g): TCGradeItem => ({
        course_id: g.course_id ?? 0,
        course_name: g.course_name ?? "",
        final_score: g.final_score ?? null,
        final_grade: g.final_grade ?? null,
        grade_point: g.grade_point ?? null,
        credits: g.credits ?? 0,
        semester: g.semester ?? "",
      }));
    }
  }

  // TronClass 可能沒有全域成績 API — 成績主要從 alcat.pu.edu.tw 取得
  console.log("[TronClass] No grades endpoint available (this is normal — grades come from e-Campus)");
  return [];
}

/** 取得使用者 Profile */
export async function tcFetchProfile(): Promise<TCUserProfile | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCUserProfile>("profile");
  }

  const userId = await ensureUserId();
  if (!userId) return null;

  // 嘗試 API endpoint
  const data = await tcFetchJSON<TCUserProfile>(`${TC_BASE}/api/users/${userId}`);
  if (data?.id) return data;

  // fallback: 從已知資訊建構
  return userId ? { id: userId, name: "", login_name: "", email: null, avatar_url: null, role: "student" } : null;
}

/** 取得待辦事項（即將到期的作業/測驗） */
export async function tcFetchTodos(): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>("todos");
  }

  // 根據 tronclass-cli，endpoint 是 api/todos → { todo_list: [...] }
  const url = `${TC_BASE}/api/todos`;

  type RawTodo = {
    id: number;
    course_id?: number;
    course?: { id?: number; name?: string };
    type?: string;
    title?: string;
    description?: string;
    begin_date?: string;
    end_date?: string;
    score?: number;
    total_score?: number;
    status?: string;
    weight?: number;
  };

  const data = await tcFetchJSON<{ todo_list?: RawTodo[] }>(url);
  const items = data?.todo_list;

  if (!items || !Array.isArray(items)) {
    console.warn("[TronClass] No todo_list in response");
    return [];
  }

  return items.map((a): TCActivity => ({
    id: a.id,
    course_id: a.course_id ?? a.course?.id ?? 0,
    type: a.type ?? "homework",
    title: a.title ?? "",
    description: a.description ?? null,
    begin_date: a.begin_date ?? null,
    end_date: a.end_date ?? null,
    score: a.score ?? null,
    total_score: a.total_score ?? null,
    status: a.status ?? "pending",
    weight: a.weight ?? null,
  }));
}
