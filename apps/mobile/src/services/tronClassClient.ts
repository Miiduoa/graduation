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
const TC_HOST = "tronclass.pu.edu.tw";
const IDENTITY_HOST = "identity.pu.edu.tw";
const IDENTITY_BASE = "https://identity.pu.edu.tw";
const CAS_LOGIN_PATH = "/auth/realms/pu/protocol/cas/login";
const TC_LOGIN_SERVICE_URL = `${TC_BASE}/login?next=/user/index`;
const TC_BACKEND_SESSION_KEY = "@pu_cache:tc_backend_session";

// ── Domain-fronting route ───────────────────────────────
//
// 靜宜的 identity.pu.edu.tw 與 tronclass.pu.edu.tw 在同一台主機 (140.128.5.203)
// 後面是同一套 Tengine/nginx 反向代理。部分校外網路環境會過濾
// identity.pu.edu.tw 的 SNI 或 DNS，但 tronclass.pu.edu.tw 仍可連線。
// 解法：把要給 identity 的請求改成連 tronclass，加上 Host: identity.pu.edu.tw
// header，後端仍會把它路由到 Keycloak 處理。已用 curl 驗證可行
// （回應一致返回 Keycloak 登入頁與相同的 Set-Cookie）。
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json, text/html, */*",
  "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
};

/**
 * 若 URL 是 identity.pu.edu.tw，改寫為 tronclass.pu.edu.tw 並回傳 Host override。
 * 若非 identity，原封不動。
 */
function rewriteIdentityUrl(url: string): { finalUrl: string; hostOverride: string | null } {
  try {
    const u = new URL(url);
    if (u.hostname === IDENTITY_HOST) {
      u.hostname = TC_HOST;
      return { finalUrl: u.toString(), hostOverride: IDENTITY_HOST };
    }
  } catch {
    // 非標準 URL，直接回傳
  }
  return { finalUrl: url, hostOverride: null };
}

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
//
// 實作策略：
//   1. 先用 fetch + credentials:"include" + redirect:"follow"
//      讓 iOS NSURLSession / Android OkHttp 的原生 cookie jar 自動管理 cookies。
//      這個模式和 puDirectScraper.ts 完全一樣，已驗證可用。
//   2. 不自己設 Cookie header — 原生 cookie jar 會自動處理；
//      手動塞 Cookie header 在 iOS 上有時會被 NSURLSession 拒絕。
//   3. 若 fetch 丟錯（例如網路暫時性失敗），用 XHR 當備援，
//      但不做 header 手動注入，讓 withCredentials 走原生 cookie jar。
//   4. 所有錯誤都帶上原始訊息 + URL，方便除錯。

async function tcFetch(
  url: string,
  options: {
    method?: string;
    body?: string;
    contentType?: string;
    accept?: string;
  } = {}
): Promise<{ body: string; status: number; url: string }> {
  const method = options.method ?? "GET";

  // ── Domain-fronting：若是 identity.pu.edu.tw，改走 tronclass host ──
  const { finalUrl, hostOverride } = rewriteIdentityUrl(url);

  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.contentType) headers["Content-Type"] = options.contentType;
  if (options.accept) headers.Accept = options.accept;
  if (hostOverride) {
    headers["Host"] = hostOverride;
    // Origin / Referer 用原 identity 位址，Keycloak CSRF 檢查才不會擋
    headers["Origin"] = `https://${hostOverride}`;
    headers["Referer"] = `https://${hostOverride}/auth/realms/pu/protocol/cas/login`;
  }

  // 路由後的 request log（方便除錯）
  if (hostOverride) {
    console.log(`[tcFetch] ROUTE ${method} ${url.substring(0, 70)} → via ${finalUrl.substring(0, 70)} (Host: ${hostOverride})`);
  }

  // ── 嘗試 fetch（原生 cookie jar 模式）──
  try {
    const response = await fetch(finalUrl, {
      method,
      headers,
      body: options.body,
      credentials: "include",
      redirect: "follow",
    });
    const body = await response.text();
    console.log(`[tcFetch] ${method} ${finalUrl.substring(0, 80)} → ${response.status} (${body.length}B)`);
    // 把 response.url 中的 tronclass host 還原為 identity host（如果有 override），
    // 避免後續 parser 判斷錯誤
    let respUrl = response.url;
    if (hostOverride && respUrl.includes(TC_HOST) && url.includes(IDENTITY_HOST)) {
      respUrl = respUrl.replace(TC_HOST, IDENTITY_HOST);
    }
    return { body, status: response.status, url: respUrl };
  } catch (fetchErr) {
    const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.warn(`[tcFetch] fetch failed for ${finalUrl}: ${errMsg} — trying XHR…`);

    // ── XHR 備援 ──
    return new Promise<{ body: string; status: number; url: string }>((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open(method, finalUrl, true);
        xhr.withCredentials = true;   // 讓原生 cookie jar 自動帶 cookies
        xhr.timeout = 30000;

        // 只設 Content-Type / Accept；User-Agent 讓系統自己處理
        if (options.contentType) {
          try { xhr.setRequestHeader("Content-Type", options.contentType); } catch { /* ignore */ }
        }
        if (options.accept) {
          try { xhr.setRequestHeader("Accept", options.accept); } catch { /* ignore */ }
        }
        try { xhr.setRequestHeader("Accept-Language", "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"); } catch { /* ignore */ }

        // 設 Host override（domain fronting）
        if (hostOverride) {
          try { xhr.setRequestHeader("Host", hostOverride); } catch { /* 某些平台可能被擋 */ }
          try { xhr.setRequestHeader("Origin", `https://${hostOverride}`); } catch { /* ignore */ }
          try { xhr.setRequestHeader("Referer", `https://${hostOverride}/auth/realms/pu/protocol/cas/login`); } catch { /* ignore */ }
        }

        xhr.onload = () => {
          let respUrl = xhr.responseURL || finalUrl;
          if (hostOverride && respUrl.includes(TC_HOST) && url.includes(IDENTITY_HOST)) {
            respUrl = respUrl.replace(TC_HOST, IDENTITY_HOST);
          }
          const body = xhr.responseText ?? "";
          console.log(`[tcFetch/xhr] ${method} ${finalUrl.substring(0, 80)} → ${xhr.status} (${body.length}B)`);
          resolve({ body, status: xhr.status, url: respUrl });
        };
        xhr.onerror = () => {
          console.warn(`[tcFetch/xhr] XHR failed for ${finalUrl} (readyState=${xhr.readyState}, status=${xhr.status})`);
          reject(new Error(`網路連線失敗，無法連到 ${new URL(finalUrl).hostname}（請確認手機網路是否連到靜宜校園網路或 VPN）`));
        };
        xhr.ontimeout = () => {
          reject(new Error(`連線逾時：${new URL(finalUrl).hostname}`));
        };

        xhr.send(options.body ?? null);
      } catch (xhrErr) {
        const xhrMsg = xhrErr instanceof Error ? xhrErr.message : String(xhrErr);
        reject(new Error(`無法建立 XHR 請求：${xhrMsg}`));
      }
    });
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
      // 記錄關鍵除錯資訊
      console.warn("[TronClass] userId not found. POST landed on:", loginResult.url,
        "index landed on:", indexPage.url,
        "POST body len:", loginResult.body.length,
        "index body len:", indexPage.body.length);

      // 帳密錯誤偵測：
      // 靜宜 Keycloak 驗證失敗時會回傳
      //   <span id="error-message" style="color:red">無效的使用者名稱或密碼</span>
      // （經 Chrome MCP 實測 2026-04 確認）
      // 為避免誤判（例如網路問題讓 POST 落在其他頁面），同時符合
      //   1) URL 仍在 identity / login-actions 下  或  body 仍含 Keycloak 登入表單
      //   2) body 內出現明確錯誤字串
      // 才判定為帳密錯誤。
      const postUrlStillAtKeycloak =
        loginResult.url.includes("identity.pu.edu.tw") ||
        loginResult.url.includes("login-actions/authenticate") ||
        loginResult.body.includes("/auth/realms/pu");
      const hasExplicitErrorText =
        loginResult.body.includes("無效的使用者名稱或密碼") ||
        loginResult.body.includes("Invalid username or password") ||
        /id=["']error-message["'][^>]*>[^<]+</i.test(loginResult.body);

      if (postUrlStillAtKeycloak && hasExplicitErrorText) {
        return { success: false, session: null, error: "TronClass 帳號或密碼錯誤" };
      }
      // 若 index 頁仍被 redirect 回 CAS，代表 session cookie 沒成功建立
      if (indexPage.url.includes("identity.pu.edu.tw") || indexPage.body.includes("/auth/realms/pu")) {
        return {
          success: false,
          session: null,
          error: "TronClass 登入失敗：session 未能建立，請確認密碼或稍後再試",
        };
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
