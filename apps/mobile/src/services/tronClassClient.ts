/**
 * TronClass API Client for Providence University (靜宜大學)
 *
 * TronClass (tronclass.pu.edu.tw) 是靜宜使用的 LMS，
 * 資料走 REST JSON API (/api/...)。
 *
 * 登入流程（Mobile 端）：
 *   1. GET  identity.pu.edu.tw CAS login page → 拿到 form action + hidden fields
 *   2. POST credentials → CAS 給 ticket 然後 redirect 回 TronClass
 *   3. TronClass 驗票後給 session cookie
 *   4. 驗證 session：/api/users/me (JSON) 或 /user/index (HTML)
 *   5. 後續所有 /api/ 請求用 credentials:"include" 帶 cookie
 *
 * 每個 fetch 加上 AbortController timeout 避免 IPv6 DNS 問題卡住。
 *
 * 所有 API response 都是 JSON。
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCloudFunctionUrl } from "./cloudFunctions";

// ─── Constants ───────────────────────────────────────────

const TC_BASE = "https://tronclass.pu.edu.tw";
const TC_BACKEND_SESSION_KEY = "@pu_cache:tc_backend_session";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
};

// ─── 全域狀態 ────────────────────────────────────────────
let _tcUserId: number | null = null;
let _tcBackendSessionId: string | null = null;
let _tcBackendSessionLoaded = false;

/**
 * TronClass X-SESSION-ID — 原生 API 登入後取得的 session token。
 * 用於所有 TronClass API 呼叫的 header 認證（取代 cookie）。
 */
let _tcXSessionId: string | null = null;

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
  department: { id: number; name: string } | null;
  instructors: Array<{ id: number; name: string; avatar_big_url?: string }>;
  credit: number | null;
  semester: { code: string; id: number; name: string } | null;
  klass: { id: number; name: string } | null;
  grade: { id: number; name: string } | null;
  course_outline: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  role: string;        // student, teacher, ta
  student_count: number;
  classroom_schedule: unknown | null;
};

export type TCCourseDetail = TCCourse;

export type TCActivity = {
  id: number;
  course_id: number;
  type: string;           // homework, forum, web_link, material, etc.
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;  // due date
  score: number | null;
  total_score: number | null;
  status: string;           // submitted, graded, pending, etc.
  weight: number | null;    // percentage weight in final grade
  score_percentage: number | null;
  published: boolean;
  data?: Record<string, unknown>;  // nested data object from API
};

export type TCModule = {
  id: number;
  course_id: number;
  name: string;
  sort: number;
  is_hidden: boolean;
  syllabuses: Array<{ id: number; name?: string }>;
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

export type TCExam = {
  id: number;
  title: string;
  start_time: string;
  end_time: string;
  [key: string]: unknown;
};

export type TCScoreItem = {
  id: number;
  name: string;
  percentage: number;
  group_id: number | null;
  [key: string]: unknown;
};

export type TCSelfScore = {
  total_score: number;
  raw_score: number;
  exceptional_case: unknown | null;
};

export type TCHomeworkStatus = Record<number, Record<number, string>>; // {activityId: {studentId: status}}

export type TCAnnouncementItem = {
  id: number;
  title?: string;
  content?: string;
  created_at?: string;
  [key: string]: unknown;
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

/**
 * 重新建立 TronClass 後端 session。
 * 需要學號和密碼來重新登入 TronClass。
 */
export async function refreshTCBackendSession(
  studentId: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(getCloudFunctionUrl("puRefreshTronClassSession"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, password }),
    });

    const text = await response.text();
    let data: { success?: boolean; tronClassSessionId?: string; tronClassUserId?: number | null; error?: string } | null = null;
    if (text.trim()) {
      try { data = JSON.parse(text); } catch { data = null; }
    }

    if (!response.ok || !data?.success || !data?.tronClassSessionId) {
      return { success: false, error: data?.error || "TronClass session 刷新失敗" };
    }

    await setTCBackendSession(data.tronClassSessionId, data.tronClassUserId ?? null);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "連線失敗";
    return { success: false, error: msg };
  }
}

async function fetchTronClassBackend<T>(
  dataType: "profile" | "courses" | "activities" | "modules" | "attendance" | "todos" | "courseDetail" | "exams" | "scoreItems" | "selfScore" | "homeworkStatus" | "homeworkScores" | "examStatus" | "announcements",
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
    const isSessionExpired = response.status === 401 || response.status === 403;

    // Session 過期 → 嘗試自動刷新一次
    if (isSessionExpired && _savedCredentials) {
      console.log("[TronClass] session expired, attempting auto-refresh…");
      const refreshed = await autoRefreshTCSession();
      if (refreshed) {
        // 刷新成功 → 重試原始請求（遞迴，但 auto-refresh 只會觸發一次）
        const savedCreds = _savedCredentials;
        _savedCredentials = null; // 防止無限遞迴
        try {
          const retryResult = await fetchTronClassBackend<T>(dataType, extra);
          _savedCredentials = savedCreds; // 還原
          return retryResult;
        } catch (retryErr) {
          _savedCredentials = savedCreds; // 還原
          throw retryErr;
        }
      }
    }

    const errorMessage =
      data?.error ||
      (isSessionExpired
        ? "TronClass session 已失效，請重新登入"
        : `TronClass 代理請求失敗（HTTP ${response.status}）`);

    if (isSessionExpired) {
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
    timeoutMs?: number;
  } = {}
): Promise<{ body: string; status: number; url: string }> {
  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.contentType) headers["Content-Type"] = options.contentType;
  if (options.accept) headers.Accept = options.accept;

  // 如果有 X-SESSION-ID，用 header 認證（不靠 cookie）
  if (_tcXSessionId) {
    headers["X-SESSION-ID"] = _tcXSessionId;
  }

  // AbortController timeout（預設 15 秒，避免 DNS/TCP 卡住）
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      credentials: _tcXSessionId ? "omit" : "include",
      redirect: "follow",
      signal: controller.signal,
    });

    const body = await response.text();
    return { body, status: response.status, url: response.url };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`連線逾時 (${Math.round((options.timeoutMs ?? 15000) / 1000)}s)：${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
 * TronClass 登入
 *
 * 帳密跟 E校園 相同。策略：
 *   1. 優先嘗試後端代理（Cloud Functions）— 繞過手機端 DNS/IPv6/跨域問題
 *   2. 降級為手機直連 Keycloak CAS（原始流程）
 */

const IDENTITY_BASE = "https://identity.pu.edu.tw";
const CAS_LOGIN_PATH = "/auth/realms/pu/protocol/cas/login";

export async function tcLogin(
  uid: string,
  password: string
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  if (!uid || !password) return { success: false, session: null, error: "請輸入帳號密碼" };

  // ── 策略 1: 後端代理（Cloud Functions 可以穩定連 identity.pu.edu.tw）──
  try {
    console.log("[TronClass] Trying backend proxy login…");
    const backendResult = await refreshTCBackendSession(uid, password);
    if (backendResult.success) {
      console.log("[TronClass] Backend proxy login succeeded!");
      // 驗證 session 有效性
      const profile = await fetchTronClassBackend<TCUserProfile>("profile");
      if (profile?.id) {
        _tcUserId = profile.id;
        return {
          success: true,
          session: { loggedIn: true, userId: profile.id, userName: profile.name },
        };
      }
      // session 回來了但 profile 拿不到，仍算成功（userId 可能還沒初始化）
      return {
        success: true,
        session: { loggedIn: true, userId: _tcUserId, userName: null },
      };
    }
    console.warn("[TronClass] Backend proxy failed:", backendResult.error);
  } catch (err) {
    console.warn("[TronClass] Backend proxy error:", err);
  }

  // ── 策略 2: 手機直連 Keycloak CAS ──
  return await tcLoginDirectCAS(uid, password);
}

/**
 * 直連 Keycloak CAS 登入（完全還原原始能動版本的流程）
 * 用 tcFetch (credentials:"include") 維持 cookie chain。
 */
async function tcLoginDirectCAS(
  uid: string,
  password: string
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  try {
    // 清除之前的 X-SESSION-ID，避免 tcFetch 跳過 cookie（CAS 靠 cookie 運作）
    _tcXSessionId = null;

    const serviceUrl = `${TC_BASE}/login`;
    const casUrl = `${IDENTITY_BASE}${CAS_LOGIN_PATH}?service=${encodeURIComponent(serviceUrl)}&locale=zh_TW`;

    // Step 1: GET CAS login page
    console.log("[TronClass] Direct CAS Step 1: GET CAS login page…");
    const loginPage = await tcFetch(casUrl, { accept: "text/html", timeoutMs: 12000 });
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
    console.log("[TronClass] Direct CAS Step 2: POST credentials…");
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
      timeoutMs: 12000,
    });

    console.log("[TronClass] POST status:", loginResult.status);
    console.log("[TronClass] Landed on:", loginResult.url);

    // Step 3: 驗證登入 — 呼叫 /api/users/me
    console.log("[TronClass] Direct CAS Step 3: verifying session via /api/users/me…");
    const profile = await tcFetchJSON<TCUserProfile>(`${TC_BASE}/api/users/me`);

    if (!profile || !profile.id) {
      if (
        loginResult.body.includes("無效的使用者名稱或密碼") ||
        loginResult.body.includes("Invalid username or password") ||
        loginResult.body.includes("Invalid credentials") ||
        loginResult.body.includes("帳號或密碼")
      ) {
        return { success: false, session: null, error: "TronClass 帳號或密碼錯誤" };
      }
      return { success: false, session: null, error: "TronClass 登入失敗，無法取得使用者資料" };
    }

    _tcUserId = profile.id;
    console.log("[TronClass] Login success! User:", profile.name, "ID:", profile.id);
    return {
      success: true,
      session: { loggedIn: true, userId: profile.id, userName: profile.name },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "連線失敗";
    console.warn("[TronClass] Direct CAS login error:", err);
    return { success: false, session: null, error: `TronClass 直連登入失敗：${msg}` };
  }
}

// ─── API Endpoints ───────────────────────────────────────

/** 取得 userId（登入後才能呼叫） */
async function ensureUserId(): Promise<number | null> {
  await ensureBackendSessionLoaded();
  if (_tcUserId) return _tcUserId;

  // 優先走後端代理（不受跨域 cookie 限制）
  if (shouldUseBackendSession()) {
    const profile = await fetchTronClassBackend<TCUserProfile>("profile");
    if (profile?.id) {
      _tcUserId = profile.id;
    }
    return _tcUserId;
  }

  // Fallback: 嘗試從 /user/index 抓取（直連模式）
  try {
    const page = await tcFetch(`${TC_BASE}/user/index`, { accept: "text/html" });
    const match = page.body.match(/userId['":\s]+(\d+)/)
      ?? page.body.match(/user_id['":\s]+(\d+)/i)
      ?? page.body.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i)
      ?? page.body.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i);
    if (match?.[1]) {
      _tcUserId = parseInt(match[1], 10);
    }
  } catch { /* ignore */ }

  return _tcUserId;
}

// ─── 儲存帳密供自動刷新用（SecureStore 優先，AsyncStorage 作為 fallback） ──
import * as SecureStore from "expo-secure-store";

const TC_CRED_KEY = "@pu_tc_cred";
const TC_CRED_ASYNC_KEY = "@pu_tc_cred_fb";
let _savedCredentials: { studentId: string; password: string } | null = null;
let _savedCredentialsLoaded = false;

export async function setTCSavedCredentials(studentId: string, password: string): Promise<void> {
  _savedCredentials = { studentId, password };
  _savedCredentialsLoaded = true;
  const payload = JSON.stringify({ studentId, password });

  let secureOk = false;
  try {
    await SecureStore.setItemAsync(TC_CRED_KEY, payload);
    secureOk = true;
  } catch { /* SecureStore 不可用（例如模擬器） */ }

  // AsyncStorage fallback — SecureStore 失敗時仍能在 app 重啟後還原帳密
  if (!secureOk) {
    try { await AsyncStorage.setItem(TC_CRED_ASYNC_KEY, payload); } catch { /* ignore */ }
  }
}

export async function clearTCSavedCredentials(): Promise<void> {
  _savedCredentials = null;
  _savedCredentialsLoaded = true;
  try { await SecureStore.deleteItemAsync(TC_CRED_KEY); } catch { /* ignore */ }
  try { await AsyncStorage.removeItem(TC_CRED_ASYNC_KEY); } catch { /* ignore */ }
}

async function loadSavedCredentials(): Promise<{ studentId: string; password: string } | null> {
  if (_savedCredentialsLoaded) return _savedCredentials;
  _savedCredentialsLoaded = true;

  // 優先從 SecureStore 讀取
  try {
    const raw = await SecureStore.getItemAsync(TC_CRED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { studentId?: string; password?: string };
      if (parsed.studentId && parsed.password) {
        _savedCredentials = { studentId: parsed.studentId, password: parsed.password };
        return _savedCredentials;
      }
    }
  } catch { /* ignore */ }

  // Fallback: AsyncStorage
  try {
    const raw = await AsyncStorage.getItem(TC_CRED_ASYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { studentId?: string; password?: string };
      if (parsed.studentId && parsed.password) {
        _savedCredentials = { studentId: parsed.studentId, password: parsed.password };
      }
    }
  } catch { /* ignore */ }

  return _savedCredentials;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * 自動刷新 TronClass session。
 *
 * 策略：
 *   1. 後端代理（Cloud Functions，穩定）
 *   2. 手機直連 CAS（可能因網路問題失敗）
 * 若沒有儲存的帳密，回傳 false（需要使用者重新登入）。
 */
export async function autoRefreshTCSession(): Promise<boolean> {
  const creds = await loadSavedCredentials();
  if (!creds) {
    console.log("[TronClass] auto-refresh: no saved credentials");
    return false;
  }

  const { studentId, password } = creds;

  // tcLogin 內部已有 backend-first → direct CAS fallback 邏輯
  console.log("[TronClass] auto-refresh: calling tcLogin…");
  const result = await tcLogin(studentId, password);
  if (result.success) {
    console.log("[TronClass] auto-refresh succeeded");
    return true;
  }

  console.warn("[TronClass] auto-refresh failed:", result.error);
  return false;
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
    department?: { id: number; name: string };
    teachers?: Array<{ id: number; name: string; avatar_url?: string }>;
    instructors?: Array<{ id: number; name: string; avatar_big_url?: string }>;
    credit?: number;
    semester?: { code: string; id: number; name: string };
    klass?: { id: number; name: string };
    grade?: { id: number; name: string };
    course_outline?: string;
    start_date?: string;
    end_date?: string;
    status?: string;
    role?: string;
    cover_image_url?: string;
    student_count?: number;
    classroom_schedule?: unknown;
  };

  const courses = await tcFetchAllPages<RawCourse>(
    `api/users/${userId}/courses`,
    "courses",
    { conditions, fields: "id,name,course_code,department(id,name),teachers(id,name,avatar_url),cover_image_url,student_count,status,role" },
    50,
  );

  return courses.map((c): TCCourse => ({
    id: c.id,
    name: c.name,
    course_code: c.course_code ?? "",
    department: c.department ?? null,
    instructors: c.instructors ?? c.teachers ?? [],
    credit: c.credit ?? null,
    semester: c.semester ?? null,
    klass: c.klass ?? null,
    grade: c.grade ?? null,
    course_outline: c.course_outline ?? null,
    start_date: c.start_date ?? null,
    end_date: c.end_date ?? null,
    status: c.status ?? status,
    role: c.role ?? "student",
    student_count: c.student_count ?? 0,
    classroom_schedule: c.classroom_schedule ?? null,
  }));
}

/** 取得課程的模組（週次/單元）*/
export async function tcFetchModules(courseId: number): Promise<TCModule[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCModule[]>("modules", { courseId });
  }

  // 只使用 /api/courses/{id}/modules （not /course-modules）
  const url = `${TC_BASE}/api/courses/${courseId}/modules`;

  type APIResponse = {
    modules?: Array<{
      id: number;
      name?: string;
      sort?: number;
      is_hidden?: boolean;
      syllabuses?: Array<{ id: number; name?: string }>;
    }>;
  };

  const data = await tcFetchJSON<APIResponse>(url);
  const modules = data?.modules;

  if (modules && Array.isArray(modules) && modules.length > 0) {
    return modules.map((m): TCModule => ({
      id: m.id,
      course_id: courseId,
      name: m.name ?? `Module ${m.sort ?? 0}`,
      sort: m.sort ?? 0,
      is_hidden: m.is_hidden ?? false,
      syllabuses: m.syllabuses ?? [],
    }));
  }

  return [];
}

/** 取得課程活動（作業、測驗、教材等） */
export async function tcFetchActivities(courseId: number): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>("activities", { courseId });
  }

  // 先抓一般活動 (note: sub_course_id=0)
  const url = `${TC_BASE}/api/courses/${courseId}/activities?sub_course_id=0`;
  type RawActivity = {
    id: number;
    type?: string;
    title?: string;
    description?: string;
    start_time?: string;
    end_time?: string;
    score?: number;
    total_score?: number;
    status?: string;
    weight?: number;
    score_percentage?: number;
    published?: boolean;
    data?: Record<string, unknown>;
    // legacy field names for compatibility
    begin_date?: string;
    end_date?: string;
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

    // Use start_time/end_time if available, fallback to begin_date/end_date for backwards compatibility
    const startTime = a.start_time ?? a.begin_date ?? null;
    const endTime = a.end_time ?? a.end_date ?? null;

    all.push({
      id: a.id,
      course_id: courseId,
      type: a.type ?? "material",
      title: a.title ?? "",
      description: readOptionalString(a.description) ?? readOptionalString(a.data?.description) ?? null,
      start_time: startTime,
      end_time: endTime,
      score: a.score ?? null,
      total_score: a.total_score ?? null,
      status: a.status ?? "pending",
      weight: a.weight ?? null,
      score_percentage: a.score_percentage ?? null,
      published: a.published ?? true,
      data: a.data,
    });
  }

  return all;
}

/** 取出缺席統計 — 注意: 所有出缺席 endpoint 都已停用 (404/403)，回傳空陣列 */
export async function tcFetchAttendance(): Promise<TCAttendance[]> {
  console.log("[TronClass] tcFetchAttendance: All attendance endpoints are unavailable (404/403)");

  // 所有出缺席 API 都不可用，直接回傳空陣列
  return [];
}

/** 取得成績（TronClass 沒有全域成績 API，所有端點都已停用） */
export async function tcFetchGrades(): Promise<TCGradeItem[]> {
  // TronClass 沒有全域成績 API — 成績主要從 e校園 (alcat.pu.edu.tw) 取得
  console.log("[TronClass] tcFetchGrades: No grades endpoint available (grades come from e-Campus)");
  return [];
}

/** 取得使用者 Profile — 注意：/api/users/{id} endpoint 已停用 (403) */
export async function tcFetchProfile(): Promise<TCUserProfile | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCUserProfile>("profile");
  }

  const userId = await ensureUserId();
  if (!userId) return null;

  // /api/users/{id} endpoint 已停用 (403)，只能回傳基本資訊
  console.warn("[TronClass] /api/users/{id} endpoint is unavailable (403), returning basic profile");
  return { id: userId, name: "", login_name: "", email: null, avatar_url: null, role: "student" };
}

/** 取得待辦事項（即將到期的作業/測驗） */
export async function tcFetchTodos(): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>("todos");
  }

  // endpoint 是 api/todos → { todo_list: [...] }
  const url = `${TC_BASE}/api/todos`;

  type RawTodo = {
    id: number;
    course_id?: number;
    course_name?: string;
    course_code?: string;
    type?: string;
    title?: string;
    description?: string;
    start_time?: string;
    end_time?: string;
    score?: number;
    total_score?: number;
    status?: string;
    weight?: number;
    is_locked?: boolean;
    is_student?: boolean;
    // legacy field names for compatibility
    begin_date?: string;
    end_date?: string;
  };

  const data = await tcFetchJSON<{ todo_list?: RawTodo[] }>(url);
  const items = data?.todo_list;

  if (!items || !Array.isArray(items)) {
    console.warn("[TronClass] No todo_list in response");
    return [];
  }

  return items.map((a): TCActivity => ({
    id: a.id,
    course_id: a.course_id ?? 0,
    type: a.type ?? "homework",
    title: a.title ?? "",
    description: a.description ?? null,
    start_time: a.start_time ?? a.begin_date ?? null,
    end_time: a.end_time ?? a.end_date ?? null,
    score: a.score ?? null,
    total_score: a.total_score ?? null,
    status: a.status ?? "pending",
    weight: a.weight ?? null,
    score_percentage: null,
    published: true,
  }));
}

/** 取得課程詳細資訊 */
export async function tcFetchCourseDetail(courseId: number): Promise<TCCourseDetail | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCCourseDetail>("courseDetail", { courseId });
  }

  const url = `${TC_BASE}/api/courses/${courseId}`;

  type RawCourseDetail = {
    id: number;
    name: string;
    display_name?: string;
    course_code?: string;
    credit?: number;
    semester?: { code: string; id: number; name: string };
    academic_year?: { code: string; id: number; name: string };
    grade?: { id: number; name: string };
    klass?: { id: number; name: string };
    compulsory?: boolean;
    course_type?: string;
    start_date?: string;
    end_date?: string;
    department?: { id: number; name: string };
    instructors?: Array<{ id: number; name: string; avatar_big_url?: string }>;
    teachers?: Array<{ id: number; name: string; avatar_url?: string }>;
    classroom_schedule?: unknown;
    course_outline?: string;
    modules?: unknown[];
    subject_code?: string;
    status?: string;
    role?: string;
    student_count?: number;
    cover_image_url?: string;
  };

  const data = await tcFetchJSON<RawCourseDetail>(url);
  if (!data?.id) return null;

  return {
    id: data.id,
    name: data.name,
    course_code: data.course_code ?? "",
    department: data.department ?? null,
    instructors: data.instructors ?? data.teachers ?? [],
    credit: data.credit ?? null,
    semester: data.semester ?? null,
    klass: data.klass ?? null,
    grade: data.grade ?? null,
    course_outline: data.course_outline ?? null,
    start_date: data.start_date ?? null,
    end_date: data.end_date ?? null,
    status: data.status ?? "ongoing",
    role: data.role ?? "student",
    student_count: data.student_count ?? 0,
    classroom_schedule: data.classroom_schedule ?? null,
  };
}

/** 取得課程考試清單 */
export async function tcFetchExams(courseId: number): Promise<TCExam[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCExam[]>("exams", { courseId });
  }

  const url = `${TC_BASE}/api/courses/${courseId}/exams`;

  type RawExam = {
    id: number;
    title?: string;
    start_time?: string;
    end_time?: string;
    [key: string]: unknown;
  };

  const data = await tcFetchJSON<{ exams?: RawExam[] }>(url);
  const exams = data?.exams;

  if (!exams || !Array.isArray(exams)) return [];

  return exams.map((e): TCExam => ({
    id: e.id,
    title: e.title ?? "",
    start_time: e.start_time ?? "",
    end_time: e.end_time ?? "",
    ...e,
  }));
}

/** 取得課程評分項目 */
export async function tcFetchScoreItems(courseId: number): Promise<TCScoreItem[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCScoreItem[]>("scoreItems", { courseId });
  }

  const url = `${TC_BASE}/api/courses/${courseId}/score-items`;

  type RawScoreItem = {
    id: number;
    name?: string;
    percentage?: number;
    group_id?: number | null;
    [key: string]: unknown;
  };

  const data = await tcFetchJSON<{ items?: RawScoreItem[] }>(url);
  const items = data?.items;

  if (!items || !Array.isArray(items)) return [];

  return items.map((i): TCScoreItem => ({
    id: i.id,
    name: i.name ?? "",
    percentage: i.percentage ?? 0,
    group_id: i.group_id ?? null,
    ...i,
  }));
}

/** 取得自評分數 */
export async function tcFetchSelfScore(courseId: number): Promise<TCSelfScore | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCSelfScore>("selfScore", { courseId });
  }

  // 注意：此 endpoint 用的是單數 "course" 而非複數 "courses"
  const url = `${TC_BASE}/api/course/${courseId}/student-self-score`;

  type RawSelfScore = {
    self_score?: {
      total_score?: number;
      raw_score?: number;
      exceptional_case?: unknown;
    };
    total_score?: number;
    raw_score?: number;
    exceptional_case?: unknown;
  };

  const data = await tcFetchJSON<RawSelfScore>(url);

  if (!data) return null;

  const score = data.self_score ?? data;

  return {
    total_score: score.total_score ?? 0,
    raw_score: score.raw_score ?? 0,
    exceptional_case: score.exceptional_case ?? null,
  };
}

/** 取得作業提交狀態 */
export async function tcFetchHomeworkStatus(courseId: number): Promise<TCHomeworkStatus | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCHomeworkStatus>("homeworkStatus", { courseId });
  }

  // 注意：此 endpoint 用的是單數 "course" 而非複數 "courses"
  const url = `${TC_BASE}/api/course/${courseId}/homework-student-status`;

  const data = await tcFetchJSON<TCHomeworkStatus>(url);
  return data ?? null;
}

/** 取得作業成績 */
export async function tcFetchHomeworkScores(courseId: number): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>("homeworkScores", { courseId });
  }

  // 注意：此 endpoint 用的是單數 "course" 而非複數 "courses"
  const url = `${TC_BASE}/api/course/${courseId}/homework-scores`;

  type RawHomeworkScore = {
    id: number;
    type?: string;
    title?: string;
    description?: string;
    start_time?: string;
    end_time?: string;
    score?: number;
    total_score?: number;
    status?: string;
    weight?: number;
    score_percentage?: number;
    published?: boolean;
    [key: string]: unknown;
  };

  const data = await tcFetchJSON<{ homework_activities?: RawHomeworkScore[] }>(url);
  const homeworks = data?.homework_activities;

  if (!homeworks || !Array.isArray(homeworks)) return [];

  return homeworks.map((h): TCActivity => ({
    id: h.id,
    course_id: courseId,
    type: h.type ?? "homework",
    title: h.title ?? "",
    description: h.description ?? null,
    start_time: h.start_time ?? null,
    end_time: h.end_time ?? null,
    score: h.score ?? null,
    total_score: h.total_score ?? null,
    status: h.status ?? "pending",
    weight: h.weight ?? null,
    score_percentage: h.score_percentage ?? null,
    published: h.published ?? true,
  }));
}

/** 取得考試狀態 */
export async function tcFetchExamStatus(courseId: number): Promise<unknown | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend("examStatus", { courseId });
  }

  // 注意：此 endpoint 用的是單數 "course" 而非複數 "courses"
  const url = `${TC_BASE}/api/course/${courseId}/exam-student-status`;

  const data = await tcFetchJSON(url);
  return data ?? null;
}

/** 取得公告 */
export async function tcFetchAnnouncements(): Promise<TCAnnouncementItem[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCAnnouncementItem[]>("announcements");
  }

  const url = `${TC_BASE}/api/announcement`;

  type RawAnnouncement = {
    id: number;
    title?: string;
    content?: string;
    created_at?: string;
    [key: string]: unknown;
  };

  const data = await tcFetchJSON<{ announcements?: RawAnnouncement[] }>(url);
  const announcements = data?.announcements;

  if (!announcements || !Array.isArray(announcements)) return [];

  return announcements.map((a): TCAnnouncementItem => ({
    id: a.id,
    title: a.title ?? "",
    content: a.content ?? "",
    created_at: a.created_at,
    ...a,
  }));
}
