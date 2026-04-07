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
 * === 2026-04 API 端點修正 ===
 * 透過瀏覽器實測確認的正確 API 端點：
 *   - POST /api/my-courses → 課程清單（取代舊的 /api/users/{id}/courses）
 *   - GET  /api/courses/{id}/modules → { modules: [...] }
 *   - GET  /api/courses/{id}/activities?sub_course_id=0 → { activities: [...] }
 *   - GET  /api/courses/{id}/exams → { exams: [...] }
 *   - GET  /api/course/{id}/homework-scores → 作業成績
 *   - GET  /api/course/{id}/performance-score → 總成績
 *   - GET  /api/course/{id}/rollcall-score → 點名成績
 *   - GET  /api/course/{id}/student/{userId}/rollcalls → 點名紀錄
 *   - GET  /api/todos → { todo_list: [...] }
 *   - GET  /api/my-academic-years → 學年
 *   - GET  /api/my-semesters → 學期
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCloudFunctionUrl } from "./cloudFunctions";

// ─── Constants ───────────────────────────────────────────

const TC_BASE = "https://tronclass.pu.edu.tw";
const IDENTITY_BASE = "https://identity.pu.edu.tw";
const CAS_LOGIN_PATH = "/auth/realms/pu/protocol/cas/login";
const TC_LOGIN_SERVICE_URL = `${TC_BASE}/login?next=/user/index`;
const TC_BACKEND_SESSION_KEY = "@pu_cache:tc_backend_session";
const TC_CREDENTIALS_KEY = "@pu_cache:tc_credentials";

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

// ─── 手動 Cookie Jar ────────────────────────────────────
// React Native 的 fetch 不會在不同請求間正確共享 cookies（已測試確認）
// 所以我們用手動 cookie 管理來解決
type CookieEntry = { name: string; value: string; domain: string; path: string; secure: boolean };
const _cookieJar: CookieEntry[] = [];

/**
 * 從 response headers 解析並儲存 Set-Cookie
 * React Native 的 Headers 物件可能會合併 set-cookie 或完全不暴露
 * 所以我們同時嘗試多種方式
 */
function saveCookiesFromResponse(response: Response, requestUrl: string): void {
  const urlObj = new URL(requestUrl);
  const defaultDomain = urlObj.hostname;
  const cookies: string[] = [];

  // 方法 1: response.headers.get (有些 RN 版本會用 ", " 合併多個 set-cookie)
  const raw = response.headers.get("set-cookie");
  if (raw) {
    // 嘗試分割（但要小心 expires 裡也有逗號）
    // 簡單策略：用正則分割 ", NAME=" 模式
    const parts = raw.split(/,\s*(?=[A-Za-z_][A-Za-z0-9_]*=)/);
    cookies.push(...parts);
  }

  // 方法 2: response.headers.forEach
  try {
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        const parts = value.split(/,\s*(?=[A-Za-z_][A-Za-z0-9_]*=)/);
        for (const p of parts) {
          if (!cookies.includes(p)) cookies.push(p);
        }
      }
    });
  } catch { /* ignore */ }

  // 解析每個 Set-Cookie
  for (const cookie of cookies) {
    const parts = cookie.split(";").map(s => s.trim());
    if (!parts[0]) continue;
    const eqIdx = parts[0].indexOf("=");
    if (eqIdx < 0) continue;

    const name = parts[0].substring(0, eqIdx).trim();
    const value = parts[0].substring(eqIdx + 1).trim();
    if (!name) continue;

    let domain = defaultDomain;
    let path = "/";
    let secure = false;

    for (const attr of parts.slice(1)) {
      const [k, v] = attr.split("=").map(s => s?.trim() ?? "");
      const kl = k.toLowerCase();
      if (kl === "domain" && v) domain = v.startsWith(".") ? v.substring(1) : v;
      if (kl === "path" && v) path = v;
      if (kl === "secure") secure = true;
    }

    // 更新或新增 cookie
    const existing = _cookieJar.findIndex(c => c.name === name && c.domain === domain && c.path === path);
    if (existing >= 0) {
      _cookieJar[existing].value = value;
    } else {
      _cookieJar.push({ name, value, domain, path, secure });
    }
  }

  if (cookies.length > 0) {
    console.log(`[CookieJar] Saved ${cookies.length} cookies from ${defaultDomain}, jar size: ${_cookieJar.length}`);
  }
}

/** 取得應該發送到指定 URL 的 cookies */
function getCookiesForUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const matching = _cookieJar.filter(c => {
      // Domain 匹配
      if (urlObj.hostname !== c.domain && !urlObj.hostname.endsWith("." + c.domain)) return false;
      // Path 匹配
      if (!urlObj.pathname.startsWith(c.path)) return false;
      // Secure 檢查
      if (c.secure && urlObj.protocol !== "https:") return false;
      return true;
    });
    return matching.map(c => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

/** 清空 cookie jar */
function clearCookieJar(): void {
  _cookieJar.length = 0;
  console.log("[CookieJar] Cleared");
}

// ─── 自動重新登入管理 ────────────────────────────────────
let _tcReLoginInProgress: Promise<boolean> | null = null;
let _tcSessionValid = false; // 是否已驗證 session 有效

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
  department_name: string | null;
  semester_id: number | null;
  semester_name: string | null;
  academic_year: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  role: string;
  teacher_name: string | null;
  cover_image_url: string | null;
  student_count: number;
  credit: number;
  compulsory: boolean;
  grade_name: string | null;
  klass_name: string | null;
  instructors: Array<{ id: number; name: string }>;
};

export type TCActivity = {
  id: number;
  course_id: number;
  type: string;           // homework, exam, material, web_link, online_video, page, forum, survey, etc.
  title: string;
  description: string | null;
  begin_date: string | null;
  end_date: string | null;  // due date
  score: number | null;
  total_score: number | null;
  status: string;           // submitted, graded, pending, etc.
  weight: number | null;    // percentage weight in final grade
  module_id: number | null;
  completion_criterion: string | null;
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
  final_grade: string | null;
  grade_point: number | null;
  credits: number;
  semester: string;
};

/** 單一課程的詳細成績 */
export type TCCourseScore = {
  course_id: number;
  course_name: string;
  performance_score: {
    final_score: number | null;
    original_score: number | null;
  } | null;
  rollcall_score: {
    score: string | null;
    score_percentage: string | null;
    rollcall_times: number;
    rollcall_count: number;
  } | null;
  homework_scores: Array<{
    id: number;
    title: string;
    score_percentage: string | null;
    start_time: string | null;
    end_time: string | null;
    student_status: string | null; // un_submitted, un_marked, scored, etc.
  }>;
  exam_scores: Array<{
    id: number;
    title: string;
    score: number | null;
    total_score: number | null;
  }>;
};

/** 點名紀錄詳細 */
export type TCRollcallRecord = {
  course_id: number;
  records: Array<{
    id: number;
    status: string;  // present, absent, late, leave
    created_at: string;
    lesson_name: string | null;
  }>;
};

// ─── Session Management ──────────────────────────────────

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
  _tcSessionValid = false;
  clearCookieJar();
  await AsyncStorage.removeItem(TC_BACKEND_SESSION_KEY).catch(() => undefined);
  // 注意：不清除 credentials — 讓使用者登出時才清除
}

/** 登出時完全清除（含存儲的密碼） */
export async function clearTCSessionFull(): Promise<void> {
  await clearTCSession();
  await AsyncStorage.removeItem(TC_CREDENTIALS_KEY).catch(() => undefined);
}

/** 儲存 TronClass 憑證（登入後呼叫） */
async function saveTCCredentials(uid: string, password: string): Promise<void> {
  try {
    // 簡易編碼 — 不是加密，但至少不是明文存放
    const encoded = btoa(encodeURIComponent(`${uid}:${password}`));
    await AsyncStorage.setItem(TC_CREDENTIALS_KEY, encoded);
    console.log("[TronClass] Credentials saved for auto re-login");
  } catch (err) {
    console.warn("[TronClass] Failed to save credentials:", err);
  }
}

/** 讀取儲存的 TronClass 憑證 */
async function loadTCCredentials(): Promise<{ uid: string; password: string } | null> {
  try {
    const encoded = await AsyncStorage.getItem(TC_CREDENTIALS_KEY);
    if (!encoded) return null;
    const decoded = decodeURIComponent(atob(encoded));
    const colonIdx = decoded.indexOf(":");
    if (colonIdx <= 0) return null;
    return {
      uid: decoded.substring(0, colonIdx),
      password: decoded.substring(colonIdx + 1),
    };
  } catch (err) {
    console.warn("[TronClass] Failed to load credentials:", err);
    return null;
  }
}

/**
 * 嘗試透過 CAS SSO 重新登入 TronClass（不需要密碼）
 * 如果 cookie jar 裡的 Keycloak session cookie 仍有效，這會自動取得新的 TronClass session
 */
async function tcReLoginViaCAS(): Promise<boolean> {
  try {
    console.log("[TronClass] Attempting CAS SSO re-login (using cookie jar)…");
    const serviceUrl = TC_LOGIN_SERVICE_URL;
    const casUrl =
      `${IDENTITY_BASE}${CAS_LOGIN_PATH}` +
      `?ui_locales=zh-TW&service=${encodeURIComponent(serviceUrl)}&locale=zh_TW`;
    const result = await tcFetchFollowRedirects(casUrl, { accept: "text/html" });
    if (result.url.includes("identity.pu.edu.tw")) return false;
    const verifyResult = await _verifyTCSession("sso");
    return verifyResult.success;
  } catch (err) {
    console.warn("[TronClass] CAS SSO re-login error:", err);
    return false;
  }
}

/**
 * 嘗試自動重新登入 TronClass
 * 優先順序：1. CAS SSO（無需密碼） 2. 儲存的憑證
 * 返回 true 表示重新登入成功
 */
async function autoReLogin(): Promise<boolean> {
  // 避免多次同時重新登入
  if (_tcReLoginInProgress) {
    return _tcReLoginInProgress;
  }

  _tcReLoginInProgress = (async () => {
    try {
      // 策略 1: 嘗試 CAS SSO（不需要密碼，利用 Keycloak 既有 session cookie）
      const ssoOk = await tcReLoginViaCAS();
      if (ssoOk) return true;

      // 策略 2: 嘗試使用儲存的憑證
      const creds = await loadTCCredentials();
      if (!creds) {
        console.warn("[TronClass] No saved credentials, cannot auto re-login");
        return false;
      }

      console.log("[TronClass] Auto re-login: attempting with saved credentials…");
      const result = await tcLogin(creds.uid, creds.password);
      if (result.success) {
        console.log("[TronClass] Auto re-login with credentials successful!");
        _tcSessionValid = true;
        return true;
      }

      console.warn("[TronClass] Auto re-login failed:", result.error);
      // 密碼可能已變更 → 清除儲存的憑證
      await AsyncStorage.removeItem(TC_CREDENTIALS_KEY).catch(() => undefined);
      return false;
    } catch (err) {
      console.warn("[TronClass] Auto re-login error:", err);
      return false;
    } finally {
      _tcReLoginInProgress = null;
    }
  })();

  return _tcReLoginInProgress;
}

async function fetchTronClassBackend<T>(
  dataType: "profile" | "courses" | "activities" | "modules" | "attendance" | "todos",
  extra: Record<string, unknown> = {},
): Promise<T> {
  await ensureBackendSessionLoaded();
  if (!shouldUseBackendSession()) {
    throw new Error("No TronClass backend session");
  }

  let response: Response;
  try {
    response = await fetch(getCloudFunctionUrl("puFetchTronClassData"), {
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
  } catch (networkErr) {
    console.warn(`[TronClass] fetchTronClassBackend(${dataType}) network error:`, networkErr);
    throw new Error(`TronClass 代理網路錯誤（${dataType}）`);
  }

  const text = await response.text();
  let data: { success?: boolean; result?: T; error?: string; userId?: number | null } | null = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text) as { success?: boolean; result?: T; error?: string; userId?: number | null };
    } catch {
      console.warn(`[TronClass] fetchTronClassBackend(${dataType}) invalid JSON:`, text.slice(0, 200));
      data = null;
    }
  }

  if (!response.ok || data?.success !== true) {
    const errorMessage =
      data?.error ||
      (response.status === 401 || response.status === 403
        ? "TronClass session 已失效，請重新登入"
        : `TronClass 代理請求失敗（${dataType}, HTTP ${response.status}）`);

    console.warn(`[TronClass] fetchTronClassBackend(${dataType}) failed:`, errorMessage);

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

  console.log(`[TronClass] fetchTronClassBackend(${dataType}) success`);
  return data.result as T;
}

// ─── Helper: XHR-based request (for reliable cookie capture) ────

/**
 * 使用 XMLHttpRequest 發送請求（比 fetch 更可靠地取得 Set-Cookie）
 * React Native 的 XHR.getAllResponseHeaders() 會暴露所有 headers
 */
function xhrRequest(
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ body: string; status: number; url: string; allHeaders: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? "GET", url, true);
    xhr.withCredentials = true; // 讓原生層也管理 cookies（雙重保險）

    // 設定 headers
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        try { xhr.setRequestHeader(key, value); } catch { /* some headers are restricted */ }
      }
    }

    xhr.onload = () => {
      const allHeaders = xhr.getAllResponseHeaders() ?? "";
      resolve({
        body: xhr.responseText ?? "",
        status: xhr.status,
        url: xhr.responseURL || url,
        allHeaders,
      });
    };
    xhr.onerror = () => reject(new Error(`XHR error: ${url}`));
    xhr.ontimeout = () => reject(new Error(`XHR timeout: ${url}`));
    xhr.timeout = 30000;

    xhr.send(options.body ?? null);
  });
}

/**
 * 從 XHR getAllResponseHeaders() 解析並儲存 cookies
 */
function saveCookiesFromXHRHeaders(allHeaders: string, requestUrl: string): void {
  const urlObj = new URL(requestUrl);
  const defaultDomain = urlObj.hostname;
  let count = 0;

  // getAllResponseHeaders() 回傳 "key: value\r\n" 格式
  const lines = allHeaders.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^set-cookie:\s*(.+)/i);
    if (!match) continue;

    const cookie = match[1];
    const parts = cookie.split(";").map(s => s.trim());
    if (!parts[0]) continue;
    const eqIdx = parts[0].indexOf("=");
    if (eqIdx < 0) continue;

    const name = parts[0].substring(0, eqIdx).trim();
    const value = parts[0].substring(eqIdx + 1).trim();
    if (!name) continue;

    let domain = defaultDomain;
    let path = "/";
    let secure = false;

    for (const attr of parts.slice(1)) {
      const [k, v] = attr.split("=").map(s => s?.trim() ?? "");
      const kl = k.toLowerCase();
      if (kl === "domain" && v) domain = v.startsWith(".") ? v.substring(1) : v;
      if (kl === "path" && v) path = v;
      if (kl === "secure") secure = true;
    }

    const existing = _cookieJar.findIndex(c => c.name === name && c.domain === domain && c.path === path);
    if (existing >= 0) {
      _cookieJar[existing].value = value;
    } else {
      _cookieJar.push({ name, value, domain, path, secure });
    }
    count++;
  }

  if (count > 0) {
    console.log(`[CookieJar/XHR] Saved ${count} cookies from ${defaultDomain}, jar size: ${_cookieJar.length}`);
  }
}

// ─── Helper: Native Fetch ────────────────────────────────

async function tcFetch(
  url: string,
  options: {
    method?: string;
    body?: string;
    contentType?: string;
    accept?: string;
    redirect?: "follow" | "manual";
  } = {}
): Promise<{ body: string; status: number; url: string; redirectUrl?: string }> {
  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.contentType) headers["Content-Type"] = options.contentType;
  if (options.accept) headers.Accept = options.accept;

  // 手動帶上 cookies（React Native 的 credentials:"include" 不可靠）
  const cookieStr = getCookiesForUrl(url);
  if (cookieStr) {
    headers["Cookie"] = cookieStr;
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    credentials: "include", // 也保留原生機制作為備用
    redirect: options.redirect ?? "follow",
  });

  // 手動儲存 response cookies
  saveCookiesFromResponse(response, url);

  const body = await response.text();

  // 取得 redirect URL（手動模式時從 Location header）
  let redirectUrl: string | undefined;
  if (response.status >= 300 && response.status < 400) {
    redirectUrl = response.headers.get("location") ?? undefined;
  }

  return { body, status: response.status, url: response.url, redirectUrl };
}

/**
 * 手動跟隨 redirect，確保每一步的 cookies 都正確保存
 * React Native 的 fetch redirect:"follow" 有時不會正確處理跨域 cookie
 */
async function tcFetchFollowRedirects(
  url: string,
  options: {
    method?: string;
    body?: string;
    contentType?: string;
    accept?: string;
  } = {},
  maxRedirects = 10,
): Promise<{ body: string; status: number; url: string }> {
  let currentUrl = url;
  let currentMethod = options.method ?? "GET";
  let currentBody = options.body;
  let currentContentType = options.contentType;

  for (let i = 0; i < maxRedirects; i++) {
    let result: { body: string; status: number; url: string; redirectUrl?: string };
    try {
      result = await tcFetch(currentUrl, {
        method: currentMethod,
        body: currentBody,
        contentType: currentContentType,
        accept: options.accept,
        redirect: "manual",
      });
    } catch {
      // React Native 某些版本不支援 redirect:"manual" → fallback 用 follow
      console.warn("[TronClass] redirect:manual failed, falling back to follow");
      return tcFetch(url, { ...options, redirect: "follow" });
    }

    // 不是 redirect → 回傳結果
    // 注意：React Native redirect:manual 可能回傳 status=0（opaque redirect）
    if (result.status === 0 && result.body === "" && result.url !== currentUrl) {
      // Opaque redirect — URL 已變更，繼續用 GET 請求新 URL
      console.log(`[TronClass] Opaque redirect → ${result.url}`);
      currentUrl = result.url;
      currentMethod = "GET";
      currentBody = undefined;
      currentContentType = undefined;
      continue;
    }

    if (result.status < 300 || result.status >= 400) {
      return { body: result.body, status: result.status, url: currentUrl };
    }

    // 是 redirect → 跟隨
    const location = result.redirectUrl;
    if (!location) {
      console.warn("[TronClass] Redirect without Location header at", currentUrl);
      return { body: result.body, status: result.status, url: currentUrl };
    }

    // 解析 redirect URL（可能是相對路徑）
    try {
      const base = new URL(currentUrl);
      currentUrl = new URL(location, base).toString();
    } catch {
      currentUrl = location;
    }

    console.log(`[TronClass] Following redirect #${i + 1} → ${currentUrl}`);

    // Redirect 後改用 GET（除非是 307/308）
    if (result.status !== 307 && result.status !== 308) {
      currentMethod = "GET";
      currentBody = undefined;
      currentContentType = undefined;
    }
  }

  console.warn("[TronClass] Too many redirects");
  return { body: "", status: 0, url: currentUrl };
}

async function tcFetchJSON<T>(
  url: string,
  options?: { method?: string; body?: string; contentType?: string },
  _retried = false,
): Promise<T | null> {
  try {
    const result = await tcFetch(url, { accept: "application/json", ...options });

    // 401/403 或被 redirect 到登入頁（body 是 HTML）→ session/token 過期
    const isSessionExpired =
      result.status === 401 ||
      result.status === 403 ||
      (result.status === 200 && result.body.trimStart().startsWith("<"));

    if (isSessionExpired && !_retried) {
      console.warn("[TronClass] Session expired detected, attempting auto re-login…");
      _tcSessionValid = false;
      const reLoggedIn = await autoReLogin();
      if (reLoggedIn) {
        console.log("[TronClass] Re-login succeeded, retrying request…");
        return tcFetchJSON<T>(url, options, true);
      }
      console.warn("[TronClass] Re-login failed, returning null");
      return null;
    }

    if (result.status !== 200) {
      console.warn(`[TronClass] API ${result.status}: ${url}`);
      return null;
    }

    if (result.body.trimStart().startsWith("<")) {
      console.warn("[TronClass] Got HTML instead of JSON, session expired (already retried)");
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
 * 使用手動 cookie jar 解決 React Native fetch 不共享 cookies 的問題。
 * 已確認：不帶 cookie POST 到 Keycloak 會得到 400 Bad Request。
 *
 * 流程：
 *   1. GET CAS login page → Keycloak 設定 session cookies（AUTH_SESSION_ID 等）
 *   2. POST credentials（帶 step 1 的 cookies）→ Keycloak 驗證 → redirect 到 TronClass
 *   3. 手動跟隨 redirect chain → 每一步保存 cookies
 *   4. 驗證 TronClass session
 */
export async function tcLogin(
  uid: string,
  password: string
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  try {
    if (!uid || !password) return { success: false, session: null, error: "請輸入帳號密碼" };

    // 清除舊的 cookies，確保乾淨狀態
    clearCookieJar();

    const serviceUrl = TC_LOGIN_SERVICE_URL;
    const casUrl =
      `${IDENTITY_BASE}${CAS_LOGIN_PATH}` +
      `?ui_locales=zh-TW&service=${encodeURIComponent(serviceUrl)}&locale=zh_TW`;

    // ── Step 1: GET CAS login page ──
    // 這一步 Keycloak 會設定 AUTH_SESSION_ID + KC_RESTART cookies
    // 使用 XHR 確保可以讀取 Set-Cookie headers（fetch 可能不暴露）
    console.log("[TronClass] Step 1: GET CAS login page (via XHR)…");
    const loginPageXHR = await xhrRequest(casUrl, {
      headers: { ...COMMON_HEADERS, Accept: "text/html" },
    });
    saveCookiesFromXHRHeaders(loginPageXHR.allHeaders, casUrl);
    // 也嘗試用 fetch 方式儲存（雙重保險）
    const loginPage = {
      body: loginPageXHR.body,
      status: loginPageXHR.status,
      url: loginPageXHR.url,
    };
    console.log("[TronClass] CAS page status:", loginPage.status, "URL:", loginPage.url);
    console.log("[TronClass] Cookie jar after step 1:", _cookieJar.length, "cookies",
      _cookieJar.map(c => c.name).join(", "));

    // 如果已經登入（被 redirect 到 TronClass），跳過登入直接驗證
    if (loginPage.url.includes("tronclass.pu.edu.tw") && !loginPage.url.includes("/login")) {
      console.log("[TronClass] Already logged in, verifying session…");
      return await _verifyTCSession(uid, password);
    }

    // 解析 form action URL
    let formAction: string | null = null;
    const formMatch = loginPage.body.match(/<form[^>]+action=["']([^"']*login-actions\/authenticate[^"']*?)["']/i);
    if (formMatch?.[1]) {
      formAction = formMatch[1].replace(/&amp;/g, "&");
      console.log("[TronClass] Found login-actions form action");
    }
    if (!formAction) {
      const anyFormMatch = loginPage.body.match(/<form[^>]+action=["']([^"']+)["']/i);
      if (anyFormMatch?.[1]) {
        formAction = anyFormMatch[1].replace(/&amp;/g, "&");
      }
    }
    if (!formAction) {
      console.warn("[TronClass] No form action found! Preview:", loginPage.body.substring(0, 200));
      return { success: false, session: null, error: "無法解析 TronClass 登入頁面" };
    }

    const postUrl = formAction.startsWith("http") ? formAction : `${IDENTITY_BASE}${formAction}`;

    // 解析隱藏欄位
    const hiddenFields: Record<string, string> = {};
    const inputRegex = /<input[^>]*>/gi;
    let inputMatch: RegExpExecArray | null;
    while ((inputMatch = inputRegex.exec(loginPage.body)) !== null) {
      const tag = inputMatch[0];
      if (!/type=["']hidden["']/i.test(tag)) continue;
      const nameM = tag.match(/name=["']([^"']+)["']/);
      const valueM = tag.match(/value=["']([^"']*?)["']/);
      if (nameM?.[1]) hiddenFields[nameM[1]] = valueM?.[1] ?? "";
    }

    // ── Step 2: POST credentials ──
    // 使用 XHR 帶上 step 1 的 cookies + 捕捉 redirect 結果
    console.log("[TronClass] Step 2: POST credentials (via XHR)…");
    const formData = new URLSearchParams({ ...hiddenFields, username: uid, password: password });
    const cookiesForPost = getCookiesForUrl(postUrl);
    console.log("[TronClass] Sending cookies:", cookiesForPost ? "yes" : "NONE!");

    const postXHR = await xhrRequest(postUrl, {
      method: "POST",
      body: formData.toString(),
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
        ...(cookiesForPost ? { Cookie: cookiesForPost } : {}),
      },
    });
    // XHR follows redirects automatically, so postXHR.url is the final URL
    saveCookiesFromXHRHeaders(postXHR.allHeaders, postXHR.url);
    const postResult = {
      body: postXHR.body,
      status: postXHR.status,
      url: postXHR.url,
    };

    console.log("[TronClass] POST result URL:", postResult.url, "status:", postResult.status);
    console.log("[TronClass] Cookie jar after step 2:", _cookieJar.length, "cookies",
      _cookieJar.map(c => c.name).join(", "));

    // 檢查是否還在 identity 頁面
    if (postResult.url.includes("identity.pu.edu.tw")) {
      // 檢查密碼錯誤（使用 Keycloak 實測確認的錯誤訊息）
      const isPasswordError =
        postResult.body.includes("Invalid username or password") ||
        postResult.body.includes("無效的使用者名稱或密碼") ||
        postResult.body.includes("帳號或密碼錯誤") ||
        postResult.body.includes("密碼錯誤") ||
        postResult.body.includes("error-message");

      if (isPasswordError) {
        return { success: false, session: null, error: "帳號或密碼錯誤，請確認後重試" };
      }

      // 可能是 400 Bad Request（cookies 遺失）→ 提供更具體的錯誤訊息
      if (postResult.status === 400) {
        console.warn("[TronClass] Got 400 — cookies likely not sent with POST");
        return { success: false, session: null, error: "登入請求被拒絕（session 問題），請重試" };
      }

      console.warn("[TronClass] Still on identity page. Status:", postResult.status);
      return { success: false, session: null, error: "登入驗證失敗，請稍後再試" };
    }

    // ── Step 3: 驗證 TronClass session ──
    console.log("[TronClass] Step 3: Verifying TronClass session…");
    return await _verifyTCSession(uid, password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "連線失敗";
    console.warn("[TronClass] Login error:", err);
    return { success: false, session: null, error: `TronClass 登入失敗：${msg}` };
  }
}

/**
 * 驗證 TronClass session 是否有效，並取得 userId
 */
async function _verifyTCSession(
  uid: string,
  password?: string,
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  console.log("[TronClass] Verifying session via /user/index…");
  const indexPage = await tcFetch(`${TC_BASE}/user/index`, { accept: "text/html" });
  console.log("[TronClass] /user/index status:", indexPage.status, "url:", indexPage.url);

  // 如果被 redirect 回登入頁面，代表沒有 session
  if (indexPage.url.includes("/login") || indexPage.url.includes("identity.pu.edu.tw")) {
    console.warn("[TronClass] Session verification failed — redirected to login");
    return { success: false, session: null, error: "TronClass 登入後 session 未建立，請稍後再試" };
  }

  // 從 HTML 找 userId hidden input
  const userIdMatch =
    indexPage.body.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i) ??
    indexPage.body.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i) ??
    indexPage.body.match(/userId["']?\s*[:=]\s*["']?(\d+)/i) ??
    indexPage.body.match(/"id"\s*:\s*(\d+)/);

  if (!userIdMatch?.[1]) {
    console.warn("[TronClass] Could not extract userId from /user/index");
    console.log("[TronClass] Page preview:", indexPage.body.substring(0, 300));
    return { success: false, session: null, error: "登入似乎成功但無法取得使用者資訊，請再試一次" };
  }

  const userId = parseInt(userIdMatch[1], 10);
  _tcUserId = userId;

  // 嘗試取得使用者名稱
  const nameMatch =
    indexPage.body.match(/class=["']user-?name["'][^>]*>([^<]+)</i) ??
    indexPage.body.match(/"name"\s*:\s*"([^"]+)"/);
  const userName = nameMatch?.[1]?.trim() ?? uid;

  console.log("[TronClass] Login success! User:", userName, "ID:", userId);
  _tcSessionValid = true;

  // 儲存憑證以支持自動重新登入
  if (password) {
    await saveTCCredentials(uid, password);
  }

  return {
    success: true,
    session: {
      loggedIn: true,
      userId,
      userName,
    },
  };
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

/**
 * 取得已選課程清單
 * 使用 POST /api/my-courses （2026-04 實測確認的正確端點）
 * 策略：優先直連 TronClass（native cookie），失敗再走 Cloud Functions proxy
 */
export async function tcFetchCourses(
  status: "ongoing" | "ended" | "upcoming" = "ongoing"
): Promise<TCCourse[]> {
  // 優先嘗試直連（因為後端 Cloud Functions 可能還沒部署最新修正）
  console.log("[TronClass] Fetching courses via POST /api/my-courses (direct first)…");
  const directResult = await _tcFetchCoursesDirect(status);
  if (directResult.length > 0) {
    console.log(`[TronClass] Direct fetch got ${directResult.length} courses`);
    return directResult;
  }

  // 直連沒結果 → 嘗試 backend proxy
  console.log("[TronClass] Direct fetch returned 0 courses, trying backend proxy…");
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    try {
      const backendResult = await fetchTronClassBackend<TCCourse[]>("courses", { status });
      if (backendResult && backendResult.length > 0) {
        console.log(`[TronClass] Backend proxy got ${backendResult.length} courses`);
        return backendResult;
      }
    } catch (err) {
      console.warn("[TronClass] Backend proxy failed:", err);
    }
  }

  return directResult; // return whatever direct got (might be empty)
}

async function _tcFetchCoursesDirect(
  status: "ongoing" | "ended" | "upcoming" = "ongoing"
): Promise<TCCourse[]> {
  console.log("[TronClass] _tcFetchCoursesDirect…");

  // POST /api/my-courses with optional filter body
  type RawCourse = {
    id: number;
    name: string;
    course_code?: string;
    department?: { id?: number; name?: string };
    semester?: { id?: number; name?: string };
    academic_year?: { id?: number; name?: string; code?: string };
    start_date?: string;
    end_date?: string;
    credit?: string;
    compulsory?: boolean;
    grade?: { id?: number; name?: string };
    klass?: { id?: number; name?: string };
    instructors?: Array<{ id: number; name: string; avatar_small_url?: string }>;
    cover?: string;
    course_attributes?: { student_count?: number; published?: boolean };
    is_mute?: boolean;
    course_type?: number;
  };

  type CoursesResponse = {
    courses: RawCourse[];
    paging?: { page: number; page_size: number; total: number };
  };

  // Map status to TronClass filter
  const statusMap: Record<string, string[]> = {
    ongoing: ["ongoing"],
    ended: ["ended"],
    upcoming: ["upcoming"],
  };

  const body = JSON.stringify({
    conditions: { status: statusMap[status] || ["ongoing"] },
    page: 1,
    page_size: 200,
  });

  const data = await tcFetchJSON<CoursesResponse>(`${TC_BASE}/api/my-courses`, {
    method: "POST",
    body,
    contentType: "application/json",
  });

  if (!data?.courses) {
    // Fallback: try without conditions (get all courses)
    const allData = await tcFetchJSON<CoursesResponse>(`${TC_BASE}/api/my-courses`, {
      method: "POST",
      body: "{}",
      contentType: "application/json",
    });
    if (!allData?.courses) {
      console.warn("[TronClass] Failed to fetch courses");
      return [];
    }
    return mapRawCourses(allData.courses);
  }

  return mapRawCourses(data.courses);
}

function mapRawCourses(courses: Array<Record<string, unknown>>): TCCourse[] {
  return courses.map((c: Record<string, unknown>): TCCourse => {
    const dept = c.department as { id?: number; name?: string } | undefined;
    const sem = c.semester as { id?: number; name?: string } | undefined;
    const ay = c.academic_year as { name?: string } | undefined;
    const grade = c.grade as { name?: string } | undefined;
    const klass = c.klass as { name?: string } | undefined;
    const instructors = (c.instructors as Array<{ id: number; name: string }>) ?? [];
    const attrs = c.course_attributes as { student_count?: number } | undefined;

    return {
      id: c.id as number,
      name: (c.name as string) ?? "",
      course_code: (c.course_code as string) ?? "",
      department_id: dept?.id ?? null,
      department_name: dept?.name ?? null,
      semester_id: sem?.id ?? null,
      semester_name: sem?.name ?? null,
      academic_year: ay?.name ?? null,
      start_date: (c.start_date as string) ?? null,
      end_date: (c.end_date as string) ?? null,
      status: "ongoing",
      role: "student",
      teacher_name: instructors[0]?.name ?? null,
      cover_image_url: (c.cover as string) || null,
      student_count: attrs?.student_count ?? 0,
      credit: parseFloat(String(c.credit ?? "0")) || 0,
      compulsory: (c.compulsory as boolean) ?? false,
      grade_name: grade?.name ?? null,
      klass_name: klass?.name ?? null,
      instructors,
    };
  });
}

/**
 * 取得課程的模組（週次/單元）
 * 使用 GET /api/courses/{id}/modules → { modules: [...] }
 */
export async function tcFetchModules(courseId: number): Promise<TCModule[]> {
  // 優先直連
  console.log(`[TronClass] Fetching modules for course ${courseId} (direct first)…`);

  type RawModule = {
    id: number;
    name?: string;
    sort?: number;
    is_hidden?: number;
    syllabuses?: Array<{ id: number; summary?: string }>;
  };

  const data = await tcFetchJSON<{ modules: RawModule[] }>(`${TC_BASE}/api/courses/${courseId}/modules`);
  const modules = data?.modules ?? [];

  // Also fetch activities to associate with modules
  const activities = await tcFetchActivities(courseId);
  const actByModule = new Map<number, TCActivity[]>();
  for (const act of activities) {
    const mid = act.module_id;
    if (mid != null) {
      if (!actByModule.has(mid)) actByModule.set(mid, []);
      actByModule.get(mid)!.push(act);
    }
  }

  return modules
    .filter(m => m.is_hidden !== 1)
    .map((m): TCModule => ({
      id: m.id,
      course_id: courseId,
      title: m.name ?? `Module ${m.sort ?? 0}`,
      description: null,
      position: m.sort ?? 0,
      published: true,
      activities: actByModule.get(m.id) ?? [],
    }));
}

/**
 * 取得課程活動（作業、測驗、教材等）
 * 使用 GET /api/courses/{id}/activities?sub_course_id=0
 */
export async function tcFetchActivities(courseId: number): Promise<TCActivity[]> {
  // 優先直連
  console.log(`[TronClass] Fetching activities for course ${courseId} (direct)…`);

  type RawActivity = {
    id: number;
    type?: string;
    title?: string;
    data?: { description?: string };
    start_time?: string;
    end_time?: string;
    score?: number;
    score_percentage?: string;
    module_id?: number;
    completion_criterion_key?: string;
    published?: boolean;
  };

  // Main activities endpoint
  const data = await tcFetchJSON<{ activities?: RawActivity[] }>(
    `${TC_BASE}/api/courses/${courseId}/activities?sub_course_id=0`
  );
  const activities = data?.activities ?? [];

  // Also fetch exams (separate endpoint)
  type RawExam = {
    id: number;
    title?: string;
    start_time?: string;
    end_time?: string;
    score?: number;
    total_score?: number;
    module_id?: number;
  };
  const examData = await tcFetchJSON<{ exams?: RawExam[] }>(
    `${TC_BASE}/api/courses/${courseId}/exams`
  );
  const exams = examData?.exams ?? [];

  // Merge activities and exams
  const seen = new Set<number>();
  const all: TCActivity[] = [];

  for (const a of activities) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    all.push({
      id: a.id,
      course_id: courseId,
      type: a.type ?? "material",
      title: a.title ?? "",
      description: a.data?.description ?? null,
      begin_date: a.start_time ?? null,
      end_date: a.end_time ?? null,
      score: a.score ?? null,
      total_score: null,
      status: "pending",
      weight: a.score_percentage ? parseFloat(a.score_percentage) : null,
      module_id: a.module_id ?? null,
      completion_criterion: a.completion_criterion_key ?? null,
    });
  }

  for (const e of exams) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    all.push({
      id: e.id,
      course_id: courseId,
      type: "exam",
      title: e.title ?? "",
      description: null,
      begin_date: e.start_time ?? null,
      end_date: e.end_time ?? null,
      score: e.score ?? null,
      total_score: e.total_score ?? null,
      status: "pending",
      weight: null,
      module_id: e.module_id ?? null,
      completion_criterion: null,
    });
  }

  console.log(`[TronClass] Got ${all.length} activities for course ${courseId}`);
  return all;
}

/**
 * 取得出缺席統計
 * 使用 per-course rollcall endpoints: /api/course/{id}/rollcall-score
 */
export async function tcFetchAttendance(): Promise<TCAttendance[]> {
  // 優先直連 — 先取得所有進行中的課程
  const courses = await tcFetchCourses("ongoing");
  if (courses.length === 0) return [];

  console.log(`[TronClass] Fetching attendance for ${courses.length} courses…`);

  const results: TCAttendance[] = [];

  for (const course of courses) {
    try {
      type RollcallScore = {
        score?: string;
        score_percentage?: string;
        rollcall_times?: number;
        rollcall_count?: number;
      };

      const rollcallScore = await tcFetchJSON<RollcallScore>(
        `${TC_BASE}/api/course/${course.id}/rollcall-score`
      );

      if (rollcallScore) {
        const totalSessions = rollcallScore.rollcall_count ?? 0;
        const attended = rollcallScore.rollcall_times ?? 0;
        const rate = totalSessions > 0
          ? parseFloat(rollcallScore.score_percentage ?? "0")
          : 0;

        results.push({
          course_id: course.id,
          course_name: course.name,
          total_sessions: totalSessions,
          attended,
          absent: Math.max(0, totalSessions - attended),
          late: 0,
          leave: 0,
          rate,
        });
      }
    } catch (err) {
      console.warn(`[TronClass] Failed to fetch rollcall for course ${course.id}:`, err);
    }
  }

  return results;
}

/**
 * 取得單一課程的詳細點名紀錄
 */
export async function tcFetchRollcallRecords(courseId: number): Promise<TCRollcallRecord | null> {
  const userId = await ensureUserId();
  if (!userId) return null;

  type RawRollcall = {
    id: number;
    status?: string;
    created_at?: string;
    lesson_name?: string;
  };

  const data = await tcFetchJSON<{ rollcalls: RawRollcall[] }>(
    `${TC_BASE}/api/course/${courseId}/student/${userId}/rollcalls?page=1&page_size=200`
  );

  if (!data?.rollcalls) return null;

  return {
    course_id: courseId,
    records: data.rollcalls.map(r => ({
      id: r.id,
      status: r.status ?? "unknown",
      created_at: r.created_at ?? "",
      lesson_name: r.lesson_name ?? null,
    })),
  };
}

/**
 * 取得單一課程的詳細成績
 * 使用多個 per-course score endpoints
 */
export async function tcFetchCourseScores(courseId: number, courseName: string = ""): Promise<TCCourseScore> {
  console.log(`[TronClass] Fetching scores for course ${courseId} (${courseName})…`);

  // Parallel fetch all score-related endpoints
  type PerformanceScore = { final_score?: number; original_score?: number };
  type RollcallScore = { score?: string; score_percentage?: string; rollcall_times?: number; rollcall_count?: number };
  type HWScore = { homework_activities?: Array<{ id: number; title: string; score_percentage?: string; start_time?: string; end_time?: string }> };
  type HWStatus = Record<string, Record<string, string>>; // { activityId: { studentId: status } }
  type ExamScore = { exam_scores?: Array<{ id: number; title?: string; score?: number; total_score?: number }> };

  const userId = await ensureUserId();

  const [performanceData, rollcallData, hwScoresData, hwStatusData, examScoresData] = await Promise.all([
    tcFetchJSON<PerformanceScore>(`${TC_BASE}/api/course/${courseId}/performance-score?isOriginalScore=true`),
    tcFetchJSON<RollcallScore>(`${TC_BASE}/api/course/${courseId}/rollcall-score`),
    tcFetchJSON<HWScore>(`${TC_BASE}/api/course/${courseId}/homework-scores?fields=id,title,score_percentage,start_time,end_time`),
    tcFetchJSON<HWStatus>(`${TC_BASE}/api/course/${courseId}/homework-student-status`),
    tcFetchJSON<ExamScore>(`${TC_BASE}/api/courses/${courseId}/exam-scores?no-intercept=true`),
  ]);

  // Build homework scores with student status
  const hwActivities = hwScoresData?.homework_activities ?? [];
  const homeworkScores = hwActivities.map(hw => {
    let studentStatus: string | null = null;
    if (hwStatusData && userId) {
      const statusMap = hwStatusData[String(hw.id)];
      if (statusMap) {
        studentStatus = statusMap[String(userId)] ?? null;
      }
    }
    return {
      id: hw.id,
      title: hw.title,
      score_percentage: hw.score_percentage ?? null,
      start_time: hw.start_time ?? null,
      end_time: hw.end_time ?? null,
      student_status: studentStatus,
    };
  });

  return {
    course_id: courseId,
    course_name: courseName,
    performance_score: performanceData ? {
      final_score: performanceData.final_score ?? null,
      original_score: performanceData.original_score ?? null,
    } : null,
    rollcall_score: rollcallData ? {
      score: rollcallData.score ?? null,
      score_percentage: rollcallData.score_percentage ?? null,
      rollcall_times: rollcallData.rollcall_times ?? 0,
      rollcall_count: rollcallData.rollcall_count ?? 0,
    } : null,
    homework_scores: homeworkScores,
    exam_scores: (examScoresData?.exam_scores ?? []).map(e => ({
      id: e.id,
      title: e.title ?? "",
      score: e.score ?? null,
      total_score: e.total_score ?? null,
    })),
  };
}

/**
 * 取得成績 — 使用 per-course score endpoints
 * TronClass 沒有全域成績 API，成績主要從 e-Campus (alcat.pu.edu.tw) 取得
 */
export async function tcFetchGrades(): Promise<TCGradeItem[]> {
  // TronClass 沒有全域成績 API — 成績主要從 alcat.pu.edu.tw 取得
  console.log("[TronClass] No global grades endpoint — grades come from e-Campus");
  return [];
}

/** 取得使用者 Profile */
export async function tcFetchProfile(): Promise<TCUserProfile | null> {
  const userId = await ensureUserId();
  if (!userId) return null;

  // 從課程清單中取得使用者資訊
  return {
    id: userId,
    name: "",
    login_name: "",
    email: null,
    avatar_url: null,
    role: "student",
  };
}

/** 取得待辦事項（即將到期的作業/測驗） */
export async function tcFetchTodos(): Promise<TCActivity[]> {
  // 優先直連 GET /api/todos → { todo_list: [...] }
  const url = `${TC_BASE}/api/todos`;

  type RawTodo = {
    id: number;
    course_id?: number;
    course_name?: string;
    course_code?: string;
    type?: string;
    title?: string;
    start_time?: string;
    end_time?: string;
    is_locked?: boolean;
    submit_rate?: number;
    not_scored_num?: number;
  };

  const data = await tcFetchJSON<{ todo_list?: RawTodo[] }>(url);
  const items = data?.todo_list;

  if (!items || !Array.isArray(items)) {
    console.warn("[TronClass] No todo_list in response");
    return [];
  }

  console.log(`[TronClass] Got ${items.length} todos`);

  return items.map((a): TCActivity => ({
    id: a.id,
    course_id: a.course_id ?? 0,
    type: a.type ?? "homework",
    title: a.title ?? "",
    description: a.course_name ?? null,
    begin_date: a.start_time ?? null,
    end_date: a.end_time ?? null,
    score: null,
    total_score: null,
    status: a.is_locked ? "locked" : "pending",
    weight: null,
    module_id: null,
    completion_criterion: null,
  }));
}

// ─── New Supplementary Endpoints ─────────────────────────

/** 取得學年列表 */
export async function tcFetchAcademicYears(): Promise<Array<{ id: number; name: string; is_active: boolean }>> {
  type RawYear = { id: number; name: string; sort?: number; is_active?: boolean };
  const data = await tcFetchJSON<RawYear[]>(`${TC_BASE}/api/my-academic-years?fields=id,name,sort,is_active`);
  if (!data || !Array.isArray(data)) return [];
  return data.map(y => ({ id: y.id, name: y.name, is_active: y.is_active ?? false }));
}

/** 取得學期列表 */
export async function tcFetchSemesters(): Promise<Array<{ id: number; name: string }>> {
  type RawSemester = { id: number; name: string };
  const data = await tcFetchJSON<RawSemester[]>(`${TC_BASE}/api/my-semesters`);
  if (!data || !Array.isArray(data)) return [];
  return data;
}

/** 取得課程詳細資訊（含大綱、教室排程等） */
export async function tcFetchCourseDetail(courseId: number): Promise<Record<string, unknown> | null> {
  const fields = [
    "id", "name", "start_date", "end_date", "course_code", "subject_code",
    "cover", "credit", "course_attributes(student_count,teaching_class_name,practice_hours,data)",
    "academic_year", "semester", "public_scope", "learning_mode", "teaching_mode",
    "score_published", "students_count", "compulsory", "syllabus_enabled",
    "display_name", "classroom_schedule", "second_name",
    "department(id,code,name)", "grade(id,name)", "klass(id,name)",
    "instructors(id,user_no,email,avatar_big_url,avatar_small_url,name,portfolio_url)",
    "modules",
  ].join(",");

  return await tcFetchJSON<Record<string, unknown>>(
    `${TC_BASE}/api/courses/${courseId}?fields=${encodeURIComponent(fields)}`
  );
}

/** 取得 AI 能力學分 */
export async function tcFetchAIAbility(): Promise<unknown> {
  return await tcFetchJSON(`${TC_BASE}/api/air-credit/user/courses/ai-ability`);
}
