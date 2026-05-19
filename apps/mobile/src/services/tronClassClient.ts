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

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getCloudFunctionUrl, getFirebaseAuthHeaders } from './cloudFunctions';
import { secureDeleteItem, secureDeleteMany, secureGetItem, secureSetItem } from './secureStorage';
import {
  TRONCLASS_DATA_DISABLED_MESSAGE,
  isTronClassBackendMutation,
  isTronClassDataFetchEnabled,
  tronClassBackendReadWhenDisabled,
} from './tronClassDataEnabled';

// ─── Constants ───────────────────────────────────────────

const TC_BASE = 'https://tronclass.pu.edu.tw';
const TC_BACKEND_SESSION_KEY = '@pu_cache:tc_backend_session';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
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
  role: string; // student, teacher, ta
  student_count: number;
  classroom_schedule: unknown | null;
};

export type TCCourseDetail = TCCourse;

export type TCActivity = {
  id: number;
  course_id: number;
  type: string; // homework, forum, web_link, material, etc.
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null; // due date
  score: number | null;
  total_score: number | null;
  status: string; // submitted, graded, pending, etc.
  weight: number | null; // percentage weight in final grade
  score_percentage: number | null;
  published: boolean;
  data?: Record<string, unknown>; // nested data object from API
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
  rate: number; // 0-100
};

export type TCGradeItem = {
  course_id: number;
  course_name: string;
  final_score: number | null;
  final_grade: string | null; // A, B+, etc.
  grade_point: number | null; // 4.0, 3.7, etc.
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

// ── 新增詳細型別 ────────────────────────────────────────────

export type TCAttachment = {
  id: number;
  name: string;
  url: string;
  size: number | null;
  mime_type: string | null;
  [key: string]: unknown;
};

export type TCRubric = {
  id: number;
  title: string | null;
  criteria: Array<{
    id: number;
    description: string;
    max_score: number;
    levels?: Array<{ score: number; description: string }>;
  }>;
  [key: string]: unknown;
};

export type TCHomeworkDetail = {
  id: number;
  course_id: number;
  type: string;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  score: number | null;
  total_score: number | null;
  status: string;
  weight: number | null;
  allow_late: boolean;
  late_penalty_percent: number | null;
  attachments: TCAttachment[];
  rubric: TCRubric | null;
  submission_type: string | null;
  max_submissions: number | null;
  [key: string]: unknown;
};

export type TCHomeworkSubmission = {
  id: number;
  homework_id: number;
  student_id: number;
  submitted_at: string | null;
  status: string;
  score: number | null;
  total_score: number | null;
  feedback: string | null;
  attachments: TCAttachment[];
  is_late: boolean;
  graded_at: string | null;
  [key: string]: unknown;
};

export type TCExamDetail = {
  id: number;
  course_id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  question_count: number | null;
  total_score: number | null;
  max_attempts: number | null;
  show_answers: boolean;
  attempted: boolean;
  [key: string]: unknown;
};

export type TCExamAttempt = {
  id: number;
  exam_id: number;
  student_id: number;
  started_at: string | null;
  submitted_at: string | null;
  score: number | null;
  total_score: number | null;
  status: string;
  answers: Array<{
    question_id: number;
    answer: unknown;
    score: number | null;
    correct: boolean | null;
  }> | null;
  [key: string]: unknown;
};

export type TCDiscussion = {
  id: number;
  course_id: number;
  title: string;
  description: string | null;
  post_count: number;
  created_at: string | null;
  last_post_at: string | null;
  is_locked: boolean;
  [key: string]: unknown;
};

export type TCDiscussionPost = {
  id: number;
  discussion_id: number;
  author_id: number;
  author_name: string | null;
  content: string;
  created_at: string;
  updated_at: string | null;
  parent_id: number | null;
  likes_count: number;
  attachments: TCAttachment[];
  [key: string]: unknown;
};

export type TCMaterial = {
  id: number;
  course_id: number;
  title: string;
  type: string;
  url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  description: string | null;
  module_id: number | null;
  created_at: string | null;
  [key: string]: unknown;
};

export type TCGradeDetail = {
  score_items: TCScoreItem[];
  self_score: TCSelfScore | null;
  item_scores: Array<{
    item_id: number;
    item_name: string;
    score: number | null;
    total_score: number | null;
    weight: number | null;
    weighted_score: number | null;
  }> | null;
  source: string;
  [key: string]: unknown;
};

export type TCCourseMember = {
  id: number;
  name: string;
  role: string;
  avatar_url: string | null;
  [key: string]: unknown;
};

export type TCCourseFullData = {
  courseDetail: TCCourseDetail | null;
  activities: TCActivity[];
  modules: TCModule[];
  exams: TCExam[];
  scoreItems: TCScoreItem[];
  selfScore: TCSelfScore | null;
  homeworkStatus: TCHomeworkStatus | null;
  homeworkScores: TCActivity[];
  examStatus: unknown | null;
  courseAnnouncements: TCAnnouncementItem[];
  materials: TCMaterial[];
  discussions: TCDiscussion[];
  gradeDetails: TCGradeDetail | null;
  learningActivities: TCActivity[];
};

async function ensureBackendSessionLoaded(): Promise<void> {
  if (_tcBackendSessionLoaded) return;
  _tcBackendSessionLoaded = true;

  try {
    // 優先從 secureStorage 讀取，fallback 到 AsyncStorage（遷移期間）
    let raw = await secureGetItem(TC_BACKEND_SESSION_KEY);
    if (!raw) {
      // 遷移：從舊的 AsyncStorage 讀取
      raw = await AsyncStorage.getItem(TC_BACKEND_SESSION_KEY).catch(() => null);
      if (raw) {
        // 寫入 secureStorage 並清理舊資料
        await secureSetItem(TC_BACKEND_SESSION_KEY, raw).catch(() => undefined);
        await AsyncStorage.removeItem(TC_BACKEND_SESSION_KEY).catch(() => undefined);
      }
    }
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      sessionId?: string;
      userId?: number | null;
    };

    if (typeof parsed.sessionId === 'string' && parsed.sessionId.trim()) {
      _tcBackendSessionId = parsed.sessionId.trim();
    }

    if (typeof parsed.userId === 'number' && Number.isFinite(parsed.userId)) {
      _tcUserId = parsed.userId;
    }
  } catch (error) {
    console.warn('[TronClass] Failed to restore backend session:', error);
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
    throw new Error('Invalid TronClass backend session');
  }

  _tcBackendSessionId = normalized;
  _tcBackendSessionLoaded = true;
  _tcUserId = typeof userId === 'number' && Number.isFinite(userId) ? userId : _tcUserId;

  const payload = JSON.stringify({ sessionId: normalized, userId: _tcUserId });
  // 寫入 secureStorage，然後清理舊的 AsyncStorage
  await secureSetItem(TC_BACKEND_SESSION_KEY, payload).catch(() => undefined);
  await AsyncStorage.removeItem(TC_BACKEND_SESSION_KEY).catch(() => undefined);
}

export async function clearTCSession(): Promise<void> {
  _tcUserId = null;
  _tcBackendSessionId = null;
  _tcBackendSessionLoaded = true;
  await secureDeleteItem(TC_BACKEND_SESSION_KEY).catch(() => undefined);
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

/** 檢查是否有 TronClass session（不驗證有效性，只檢查是否存在） */
export async function hasTCSession(): Promise<boolean> {
  await ensureBackendSessionLoaded();
  return !!_tcBackendSessionId;
}

/** 後端 `_puTronClassSessions` 的 session id（供 finalizePostLogin 等使用） */
export async function getTCBackendSessionId(): Promise<string | null> {
  await ensureBackendSessionLoaded();
  return _tcBackendSessionId;
}

/**
 * 驗證 TronClass session 是否仍然有效。
 * 嘗試呼叫 profile API — 如果 401/403 代表 session 已過期。
 * 回傳 true 表示有效，false 表示已過期或不存在。
 */
export async function validateTCSession(): Promise<boolean> {
  if (!isTronClassDataFetchEnabled()) return false;
  await ensureBackendSessionLoaded();
  if (!_tcBackendSessionId) return false;

  try {
    const profile = await fetchTronClassBackend<TCUserProfile>('profile');
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
    if (!isTronClassDataFetchEnabled()) {
      return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE };
    }
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 20000); // 20 秒逾時（Cloud Functions cold-start 需要時間）

    let response: Response;
    try {
      response = await fetch(getCloudFunctionUrl('puRefreshTronClassSession'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeaders()) },
        body: JSON.stringify({ studentId, password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(abortTimer);
    }

    const text = await response.text();
    let data: {
      success?: boolean;
      tronClassSessionId?: string;
      tronClassUserId?: number | null;
      error?: string;
    } | null = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok || !data?.success || !data?.tronClassSessionId) {
      return { success: false, error: data?.error || 'TronClass session 刷新失敗' };
    }

    await setTCBackendSession(data.tronClassSessionId, data.tronClassUserId ?? null);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '連線失敗';
    return { success: false, error: msg };
  }
}

async function fetchTronClassBackend<T>(
  dataType:
    | 'profile'
    | 'courses'
    | 'activities'
    | 'modules'
    | 'attendance'
    | 'todos'
    | 'courseDetail'
    | 'exams'
    | 'scoreItems'
    | 'selfScore'
    | 'homeworkStatus'
    | 'homeworkScores'
    | 'examStatus'
    | 'announcements'
    | 'activityDetail'
    | 'homeworkDetail'
    | 'homeworkSubmissions'
    | 'examDetail'
    | 'examAttempts'
    | 'discussions'
    | 'discussionPosts'
    | 'courseAnnouncements'
    | 'materials'
    | 'gradeDetails'
    | 'courseMembers'
    | 'learningActivities'
    | 'syllabus'
    | 'courseFullData'
    | 'postDiscussion'
    | 'postDiscussionReply'
    | 'submitHomework'
    | 'surveys'
    | 'submitSurvey'
    | 'peerReviews'
    | 'submitPeerReview',
  extra: Record<string, unknown> = {},
): Promise<T> {
  if (!isTronClassDataFetchEnabled()) {
    if (isTronClassBackendMutation(dataType)) {
      return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE } as T;
    }
    return tronClassBackendReadWhenDisabled(dataType) as T;
  }

  await ensureBackendSessionLoaded();
  if (!shouldUseBackendSession()) {
    throw new Error('No TronClass backend session');
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 20000); // 20 秒逾時（含 cold-start）

  let response: Response;
  try {
    response = await fetch(getCloudFunctionUrl('puFetchTronClassData'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeaders()),
      },
      body: JSON.stringify({
        sessionId: _tcBackendSessionId,
        dataType,
        ...extra,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(abortTimer);
  }

  const text = await response.text();
  let data: { success?: boolean; result?: T; error?: string; userId?: number | null } | null = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text) as {
        success?: boolean;
        result?: T;
        error?: string;
        userId?: number | null;
      };
    } catch {
      console.warn(`[TronClass] fetchTronClassBackend(${dataType}) invalid JSON:`, text.slice(0, 200));
      data = null;
    }
  }

  if (!response.ok || data?.success !== true) {
    const isSessionExpired = response.status === 401 || response.status === 403;

    // Session 過期 → 嘗試自動刷新一次
    if (isSessionExpired && _savedCredentials) {
      console.log('[TronClass] session expired, attempting auto-refresh…');
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
        ? 'TronClass session 已失效，請重新登入'
        : `TronClass 代理請求失敗（HTTP ${response.status}）`);

    if (isSessionExpired) {
      await clearTCSession().catch(() => undefined);
    }

    throw new Error(errorMessage);
  }

  if (typeof data.userId === 'number' && Number.isFinite(data.userId)) {
    _tcUserId = data.userId;
    await secureSetItem(
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
    timeoutMs?: number;
  } = {},
): Promise<{ body: string; status: number; url: string }> {
  if (!isTronClassDataFetchEnabled()) {
    return { body: '', status: 503, url };
  }

  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.contentType) headers['Content-Type'] = options.contentType;
  if (options.accept) headers.Accept = options.accept;

  // 如果有 X-SESSION-ID，用 header 認證（不靠 cookie）
  if (_tcXSessionId) {
    headers['X-SESSION-ID'] = _tcXSessionId;
  }

  // AbortController timeout（預設 15 秒，避免 DNS/TCP 卡住）
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      credentials: _tcXSessionId ? 'omit' : 'include',
      redirect: 'follow',
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
    const result = await tcFetch(url, { accept: 'application/json' });
    if (result.status !== 200) {
      console.warn(`[TronClass] API ${result.status}: ${url}`);
      return null;
    }
    // 如果被 redirect 到登入頁，body 會是 HTML
    if (result.body.trimStart().startsWith('<')) {
      console.warn('[TronClass] Got HTML instead of JSON, session might be expired');
      return null;
    }

    return JSON.parse(result.body) as T;
  } catch (err) {
    console.warn('[TronClass] fetch error:', url, err);
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

const IDENTITY_BASE = 'https://identity.pu.edu.tw';
const CAS_LOGIN_PATH = '/auth/realms/pu/protocol/cas/login';

export async function tcLogin(
  uid: string,
  password: string,
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  if (!uid || !password) return { success: false, session: null, error: '請輸入帳號密碼' };

  if (!isTronClassDataFetchEnabled()) {
    return { success: false, session: null, error: TRONCLASS_DATA_DISABLED_MESSAGE };
  }

  // ── 策略 1: 後端代理（Cloud Functions 可以穩定連 identity.pu.edu.tw）──
  try {
    console.log('[TronClass] Trying backend proxy login…');
    const backendResult = await refreshTCBackendSession(uid, password);
    if (backendResult.success) {
      console.log('[TronClass] Backend proxy login succeeded!');
      // 驗證 session 有效性
      const profile = await fetchTronClassBackend<TCUserProfile>('profile');
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
    console.warn('[TronClass] Backend proxy failed:', backendResult.error);
  } catch (err) {
    console.warn('[TronClass] Backend proxy error:', err);
  }

  // ── 策略 2: 手機直連 Keycloak CAS ──
  return await tcLoginDirectCAS(uid, password);
}

/**
 * 直連 Keycloak CAS 登入（還原 b8a6338 能動版本的流程）
 * 用 tcFetch (credentials:"include") 維持 cookie chain。
 *
 * 重要：不要在 CAS 前嘗試 /api/login — 那會設錯誤的 cookie 狀態，
 *       干擾後續 CAS 的 redirect chain。
 */
async function tcLoginDirectCAS(
  uid: string,
  password: string,
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  try {
    // 清除之前的 X-SESSION-ID，避免 tcFetch 跳過 cookie（CAS 靠 cookie 運作）
    _tcXSessionId = null;

    const serviceUrl = `${TC_BASE}/login`;
    const casUrl = `${IDENTITY_BASE}${CAS_LOGIN_PATH}?service=${encodeURIComponent(serviceUrl)}&locale=zh_TW`;

    // Step 1: GET CAS login page
    console.log('[TronClass] Direct CAS Step 1: GET CAS login page…');
    const loginPage = await tcFetch(casUrl, { accept: 'text/html', timeoutMs: 12000 });
    console.log('[TronClass] CAS page status:', loginPage.status);

    // 解析 form action URL
    const formActionMatch = loginPage.body.match(/<form[^>]+action=["']([^"']+)["']/i);
    const formAction = formActionMatch?.[1]?.replace(/&amp;/g, '&') ?? loginPage.url;

    // 解析隱藏欄位
    const hiddenFields: Record<string, string> = {};
    const hiddenRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = hiddenRegex.exec(loginPage.body)) !== null) {
      const nameMatch = hMatch[0].match(/name=["']([^"']+)["']/);
      const valueMatch = hMatch[0].match(/value=["']([^"']*?)["']/);
      if (nameMatch?.[1]) {
        hiddenFields[nameMatch[1]] = valueMatch?.[1] ?? '';
      }
    }

    // Step 2: POST credentials
    console.log('[TronClass] Direct CAS Step 2: POST credentials…');
    const formData = new URLSearchParams({
      ...hiddenFields,
      username: uid,
      password: password,
    });

    const postUrl = formAction.startsWith('http') ? formAction : `${IDENTITY_BASE}${formAction}`;

    const loginResult = await tcFetch(postUrl, {
      method: 'POST',
      body: formData.toString(),
      contentType: 'application/x-www-form-urlencoded',
      accept: 'text/html',
      timeoutMs: 12000,
    });
    // XHR follows redirects automatically, so postXHR.url is the final URL
    saveCookiesFromXHRHeaders(postXHR.allHeaders, postXHR.url);
    const postResult = {
      body: postXHR.body,
      status: postXHR.status,
      url: postXHR.url,
    };

    console.log('[TronClass] POST status:', loginResult.status);
    console.log('[TronClass] Landed on:', loginResult.url);

    // Step 3: 驗證登入 — 先檢查帳密是否錯誤
    if (
      loginResult.body.includes('無效的使用者名稱或密碼') ||
      loginResult.body.includes('Invalid username or password') ||
      loginResult.body.includes('Invalid credentials') ||
      loginResult.body.includes('帳號或密碼')
    ) {
      return { success: false, session: null, error: 'TronClass 帳號或密碼錯誤' };
    }

    // Step 4: 驗證 session — 用 /api/profile
    console.log('[TronClass] Direct CAS Step 4: verifying session via /api/profile…');
    const profile = await tcFetchJSON<TCUserProfile>(`${TC_BASE}/api/profile`);

    if (profile?.id) {
      _tcUserId = profile.id;
      console.log('[TronClass] Login success! User:', profile.name, 'ID:', profile.id);
      return {
        success: true,
        session: { loggedIn: true, userId: profile.id, userName: profile.name },
      };
    }

    // /api/profile 也失敗的話，嘗試 /api/my-departments 確認是否有 session
    console.log('[TronClass] /api/profile failed, trying /api/my-departments…');
    const depts = await tcFetchJSON<{ departments?: unknown[] }>(`${TC_BASE}/api/my-departments`);
    if (depts?.departments) {
      console.log('[TronClass] Login success (verified via my-departments)!');
      return { success: true, session: { loggedIn: true, userId: null, userName: null } };
    }

    return {
      success: false,
      session: null,
      error: 'TronClass 登入失敗，無法取得使用者資料',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '連線失敗';
    console.warn('[TronClass] Direct CAS login error:', err);
    return { success: false, session: null, error: `TronClass 直連登入失敗：${msg}` };
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

  // 優先走後端代理（不受跨域 cookie 限制）
  if (shouldUseBackendSession()) {
    const profile = await fetchTronClassBackend<TCUserProfile>('profile');
    if (profile?.id) {
      _tcUserId = profile.id;
    }
    return _tcUserId;
  }

  // Fallback: 嘗試從 /user/index 抓取（直連模式）
  try {
    const page = await tcFetch(`${TC_BASE}/user/index`, { accept: 'text/html' });
    const match =
      page.body.match(/userId['":\s]+(\d+)/) ??
      page.body.match(/user_id['":\s]+(\d+)/i) ??
      page.body.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i) ??
      page.body.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i);
    if (match?.[1]) {
      _tcUserId = parseInt(match[1], 10);
    }
  } catch {
    /* ignore */
  }

  return _tcUserId;
}

// ─── 帳密保存在 secureStorage，供 auto-refresh 使用 ──
const TC_CRED_KEY = '@pu_tc_cred';
const TC_CRED_ASYNC_KEY = '@pu_tc_cred_fb';
let _savedCredentials: { studentId: string; password: string } | null = null;
let _savedCredentialsLoaded = false;

export async function setTCSavedCredentials(studentId: string, password: string): Promise<void> {
  _savedCredentials = { studentId, password };
  _savedCredentialsLoaded = true;
  const payload = JSON.stringify({ studentId, password });
  // 寫入 secureStorage（Keychain），清理舊的 AsyncStorage fallback
  await secureSetItem(TC_CRED_KEY, payload).catch(() => undefined);
  await AsyncStorage.removeItem(TC_CRED_ASYNC_KEY).catch(() => undefined);
}

export async function clearTCSavedCredentials(): Promise<void> {
  _savedCredentials = null;
  _savedCredentialsLoaded = true;
  await secureDeleteItem(TC_CRED_KEY).catch(() => undefined);
  await AsyncStorage.removeItem(TC_CRED_ASYNC_KEY).catch(() => undefined);
}

export async function purgeLegacyTCSensitiveStorage(): Promise<void> {
  await Promise.all([
    secureDeleteItem(TC_CRED_KEY).catch(() => undefined),
    AsyncStorage.removeItem(TC_CRED_ASYNC_KEY).catch(() => undefined),
    AsyncStorage.removeItem(TC_BACKEND_SESSION_KEY).catch(() => undefined),
  ]);
}

async function loadSavedCredentials(): Promise<{ studentId: string; password: string } | null> {
  if (_savedCredentialsLoaded) return _savedCredentials;
  _savedCredentialsLoaded = true;

  // 從 secureStorage 讀取
  try {
    const raw = await secureGetItem(TC_CRED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { studentId?: string; password?: string };
      if (parsed.studentId && parsed.password) {
        _savedCredentials = { studentId: parsed.studentId, password: parsed.password };
        return _savedCredentials;
      }
    }
  } catch { /* ignore */ }

  // Fallback: 從舊 AsyncStorage 遷移
  try {
    const raw = await AsyncStorage.getItem(TC_CRED_ASYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { studentId?: string; password?: string };
      if (parsed.studentId && parsed.password) {
        _savedCredentials = { studentId: parsed.studentId, password: parsed.password };
        // 遷移到 secureStorage
        await secureSetItem(TC_CRED_KEY, raw).catch(() => undefined);
        await AsyncStorage.removeItem(TC_CRED_ASYNC_KEY).catch(() => undefined);
      }
    }
  } catch { /* ignore */ }

  return _savedCredentials;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
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
  if (!isTronClassDataFetchEnabled()) return false;

  const creds = await loadSavedCredentials();
  if (!creds) {
    console.log('[TronClass] auto-refresh: no saved credentials');
    return false;
  }

  const { studentId, password } = creds;

  // tcLogin 內部已有 backend-first → direct CAS fallback 邏輯
  console.log('[TronClass] auto-refresh: calling tcLogin…');
  const result = await tcLogin(studentId, password);
  if (result.success) {
    console.log('[TronClass] auto-refresh succeeded');
    return true;
  }

  console.warn('[TronClass] auto-refresh failed:', result.error);
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

    const totalPages = typeof data.pages === 'number' ? data.pages : 1;
    if (page >= totalPages) break;
    page++;
  }

  return allItems;
}

/** 取得已選課程清單 — 使用 POST /api/my-courses（玩課雲版本） */
export async function tcFetchCourses(
  status: 'ongoing' | 'ended' | 'upcoming' = 'ongoing',
): Promise<TCCourse[]> {
  if (!isTronClassDataFetchEnabled()) return [];

  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCCourse[]>('courses', { status });
  }

  // 玩課雲用 POST /api/my-courses，不是 GET /api/users/{id}/courses
  console.log('[TronClass] Fetching courses via POST /api/my-courses…');
  const allCourses: TCCourse[] = [];
  let page = 1;
  const pageSize = 50;

  while (true) {
    const result = await tcFetch(`${TC_BASE}/api/my-courses`, {
      method: 'POST',
      body: JSON.stringify({
        conditions: { status: [status === 'upcoming' ? 'notStarted' : status] },
        page,
        page_size: pageSize,
      }),
      contentType: 'application/json',
      accept: 'application/json',
    });

    if (result.status !== 200) {
      console.warn('[TronClass] /api/my-courses returned:', result.status);
      break;
    }

    let data: {
      courses?: Array<{
        id: number;
        name: string;
        course_code?: string;
        department?: { id: number; name: string };
        instructors?: Array<{ id: number; name: string; avatar_big_url?: string }>;
        credit?: string | number;
        semester?: { code: string; id: number; name: string };
        klass?: { id: number; name: string };
        grade?: { id: number; name: string };
        course_outline?: string;
        start_date?: string;
        end_date?: string;
        status?: string;
        role?: string;
        course_attributes?: { student_count?: number };
        classroom_schedule?: unknown;
      }>;
      paging?: { pages?: number };
    };
    try {
      data = JSON.parse(result.body);
    } catch {
      console.warn('[TronClass] /api/my-courses JSON parse failed');
      break;
    }

    const courses = data.courses ?? [];
    if (courses.length === 0) break;

    for (const c of courses) {
      allCourses.push({
        id: c.id,
        name: c.name,
        course_code: c.course_code ?? '',
        department: c.department ?? null,
        instructors: c.instructors ?? [],
        credit: typeof c.credit === 'string' ? parseFloat(c.credit) || null : (c.credit ?? null),
        semester: c.semester ?? null,
        klass: c.klass ?? null,
        grade: c.grade ?? null,
        course_outline: c.course_outline ?? null,
        start_date: c.start_date ?? null,
        end_date: c.end_date ?? null,
        status: c.status ?? status,
        role: c.role ?? 'student',
        student_count: c.course_attributes?.student_count ?? 0,
        classroom_schedule: c.classroom_schedule ?? null,
      });
    }

    const totalPages = data.paging?.pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  console.log(`[TronClass] Fetched ${allCourses.length} courses`);
  return allCourses;
}

/** 取得課程的模組（週次/單元）*/
export async function tcFetchModules(courseId: number): Promise<TCModule[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCModule[]>('modules', { courseId });
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
    return modules.map(
      (m): TCModule => ({
        id: m.id,
        course_id: courseId,
        name: m.name ?? `Module ${m.sort ?? 0}`,
        sort: m.sort ?? 0,
        // 注意：真實 schema 中 is_hidden 是 number (0/1) 不是 boolean
        is_hidden: Boolean(m.is_hidden ?? false),
        syllabuses: m.syllabuses ?? [],
      }),
    );
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
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>('activities', { courseId });
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

  // Main activities endpoint
  const data = await tcFetchJSON<{ activities?: RawActivity[] }>(
    `${TC_BASE}/api/courses/${courseId}/activities?sub_course_id=0`
  );
  const activities = data?.activities ?? [];

  // 也抓作業活動（可能是另一個 endpoint）
  const hwData = await tcFetchAllPages<RawActivity>(
    `api/courses/${courseId}/homework-activities`,
    'homework_activities',
    {},
    50,
  ).catch(() => [] as RawActivity[]);

  // Merge activities and exams
  const seen = new Set<number>();
  const all: TCActivity[] = [];

  for (const a of activities) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);

    // Use start_time/end_time if available, fallback to begin_date/end_date for backwards compatibility
    const startTime = a.start_time ?? a.begin_date ?? null;
    const endTime = a.end_time ?? a.end_date ?? null;

    all.push({
      id: a.id,
      course_id: courseId,
      type: a.type ?? 'material',
      title: a.title ?? '',
      description:
        readOptionalString(a.description) ?? readOptionalString(a.data?.description) ?? null,
      start_time: startTime,
      end_time: endTime,
      score: a.score ?? null,
      total_score: a.total_score ?? null,
      status: a.status ?? 'pending',
      weight: a.weight ?? null,
      score_percentage: a.score_percentage ?? null,
      published: a.published ?? true,
      data: a.data,
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

/** 取出缺席統計 — 注意: 所有出缺席 endpoint 都已停用 (404/403)，回傳空陣列 */
export async function tcFetchAttendance(): Promise<TCAttendance[]> {
  console.log('[TronClass] tcFetchAttendance: All attendance endpoints are unavailable (404/403)');

  // 所有出缺席 API 都不可用，直接回傳空陣列
  return [];
}

/** 取得成績（TronClass 沒有全域成績 API，所有端點都已停用） */
export async function tcFetchGrades(): Promise<TCGradeItem[]> {
  // TronClass 沒有全域成績 API — 成績主要從 e校園 (alcat.pu.edu.tw) 取得
  console.log(
    '[TronClass] tcFetchGrades: No grades endpoint available (grades come from e-Campus)',
  );
  return [];
}

/** 取得使用者 Profile — 使用 /api/profile（玩課雲版本） */
export async function tcFetchProfile(): Promise<TCUserProfile | null> {
  if (!isTronClassDataFetchEnabled()) return null;

  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCUserProfile>('profile');
  }

  // 直連模式：用 /api/profile（玩課雲沒有 /api/users/me）
  const data = await tcFetchJSON<{
    id?: number;
    name?: string;
    user_no?: string;
    email?: string;
    avatar_big_url?: string;
    role?: string;
    login_name?: string;
  }>(`${TC_BASE}/api/profile`);

  if (data?.id) {
    _tcUserId = data.id;
    return {
      id: data.id,
      name: data.name ?? '',
      login_name: data.login_name ?? data.user_no ?? '',
      email: data.email ?? null,
      avatar_url: data.avatar_big_url ?? null,
      role: data.role ?? 'student',
    };
  }

  return null;
}

/** 取得待辦事項（即將到期的作業/測驗） */
export async function tcFetchTodos(): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>('todos');
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
    console.warn('[TronClass] No todo_list in response');
    return [];
  }

  return items.map(
    (a): TCActivity => ({
      id: a.id,
      course_id: a.course_id ?? 0,
      type: a.type ?? 'homework',
      title: a.title ?? '',
      description: a.description ?? null,
      start_time: a.start_time ?? a.begin_date ?? null,
      end_time: a.end_time ?? a.end_date ?? null,
      score: a.score ?? null,
      total_score: a.total_score ?? null,
      status: a.status ?? 'pending',
      weight: a.weight ?? null,
      score_percentage: null,
      published: true,
    }),
  );
}

/** 取得課程詳細資訊 */
export async function tcFetchCourseDetail(courseId: number): Promise<TCCourseDetail | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCCourseDetail>('courseDetail', { courseId });
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
    course_code: data.course_code ?? '',
    department: data.department ?? null,
    instructors: data.instructors ?? data.teachers ?? [],
    credit: data.credit ?? null,
    semester: data.semester ?? null,
    klass: data.klass ?? null,
    grade: data.grade ?? null,
    course_outline: data.course_outline ?? null,
    start_date: data.start_date ?? null,
    end_date: data.end_date ?? null,
    status: data.status ?? 'ongoing',
    role: data.role ?? 'student',
    student_count: data.student_count ?? 0,
    classroom_schedule: data.classroom_schedule ?? null,
  };
}

/** 取得課程考試清單 */
export async function tcFetchExams(courseId: number): Promise<TCExam[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCExam[]>('exams', { courseId });
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

  return exams.map(
    (e): TCExam => ({
      id: e.id,
      title: e.title ?? '',
      start_time: e.start_time ?? '',
      end_time: e.end_time ?? '',
      ...e,
    }),
  );
}

/** 取得課程評分項目 */
export async function tcFetchScoreItems(courseId: number): Promise<TCScoreItem[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCScoreItem[]>('scoreItems', { courseId });
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

  return items.map(
    (i): TCScoreItem => ({
      id: i.id,
      name: i.name ?? '',
      percentage: i.percentage ?? 0,
      group_id: i.group_id ?? null,
      ...i,
    }),
  );
}

/** 取得自評分數 */
export async function tcFetchSelfScore(courseId: number): Promise<TCSelfScore | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCSelfScore>('selfScore', { courseId });
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
    return await fetchTronClassBackend<TCHomeworkStatus>('homeworkStatus', { courseId });
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
    return await fetchTronClassBackend<TCActivity[]>('homeworkScores', { courseId });
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

  return homeworks.map(
    (h): TCActivity => ({
      id: h.id,
      course_id: courseId,
      type: h.type ?? 'homework',
      title: h.title ?? '',
      description: h.description ?? null,
      start_time: h.start_time ?? null,
      end_time: h.end_time ?? null,
      score: h.score ?? null,
      total_score: h.total_score ?? null,
      status: h.status ?? 'pending',
      weight: h.weight ?? null,
      score_percentage: h.score_percentage ?? null,
      published: h.published ?? true,
    }),
  );
}

/** 取得課程作業列表（含提交狀態）
 *
 * 已對齊靜宜 TronClass 真實 schema（2026-05-13 抓取）：
 *   - `submitted: boolean` ← 直接這欄
 *   - `submitted_status: string`（空字串 / 'submitted' / ...）
 *   - `score_percentage: string`（'85.00'）
 *   - `score_published: boolean`
 *   - `deadline / end_time`
 *   - `is_closed / is_in_progress`
 *   - `uploads[]`
 */
export async function tcFetchHomeworkActivities(courseId: number): Promise<any[]> {
  await ensureBackendSessionLoaded();
  const seen = new Set<number>();
  const result: any[] = [];
  let page = 1;
  // 真實 schema：response 是 { homework_activities, total, page, page_size, ... }
  while (true) {
    const url = `${TC_BASE}/api/courses/${courseId}/homework-activities?page=${page}&page_size=50`;
    let data: { homework_activities?: any[]; total?: number } | null = null;
    try {
      data = await tcFetchJSON<{ homework_activities?: any[]; total?: number }>(url);
    } catch {
      break;
    }
    const list = data?.homework_activities ?? [];
    if (list.length === 0) break;
    for (const hw of list) {
      const id = Number(hw.id ?? 0);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const scorePct = parseFloat(hw.score_percentage ?? '0');
      result.push({
        ...hw,
        // 標準化欄位給 UI 用
        submitted: hw.submitted === true,
        graded: hw.score_published === true && Number.isFinite(scorePct) && scorePct > 0,
        student_score_percentage: scorePct,
        student_submitted_at: hw.updated_at ?? null,
        student_is_late: hw.is_closed === true && hw.submitted !== true,
        student_feedback: null, // 須呼 homework-activities/{id}/submissions 才有
      });
    }
    if (result.length >= (data?.total ?? 0)) break;
    page += 1;
    if (page > 20) break; // safety
  }
  return result;
}

/** 取得考試狀態 */
export async function tcFetchExamStatus(courseId: number): Promise<unknown | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend('examStatus', { courseId });
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
    return await fetchTronClassBackend<TCAnnouncementItem[]>('announcements');
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

  return announcements.map(
    (a): TCAnnouncementItem => ({
      id: a.id,
      title: a.title ?? '',
      content: a.content ?? '',
      created_at: a.created_at,
      ...a,
    }),
  );
}

// ── 新增：詳細資料 fetch 函數 ────────────────────────────────

/** 取得單一活動詳情 */
export async function tcFetchActivityDetail(
  courseId: number,
  activityId: number,
): Promise<unknown | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend('activityDetail', { courseId, activityId });
  }
  return await tcFetchJSON(`${TC_BASE}/api/courses/${courseId}/activities/${activityId}`);
}

/** 取得作業詳情 (含描述、附件、rubric、配分) */
export async function tcFetchHomeworkDetail(
  courseId: number,
  homeworkId: number,
): Promise<TCHomeworkDetail | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCHomeworkDetail>('homeworkDetail', {
      courseId,
      homeworkId,
    });
  }

  const data = await tcFetchJSON<Record<string, unknown>>(
    `${TC_BASE}/api/courses/${courseId}/homework-activities/${homeworkId}`,
  );
  if (!data) {
    // fallback
    const fb = await tcFetchJSON<Record<string, unknown>>(
      `${TC_BASE}/api/courses/${courseId}/activities/${homeworkId}`,
    );
    if (!fb) return null;
    return normalizeHomeworkDetail(fb, courseId);
  }
  return normalizeHomeworkDetail(data, courseId);
}

function normalizeHomeworkDetail(raw: Record<string, unknown>, courseId: number): TCHomeworkDetail {
  return {
    id: Number(raw.id) || 0,
    course_id: courseId,
    type: String(raw.type ?? 'homework'),
    title: String(raw.title ?? ''),
    description:
      readOptionalString(raw.description) ??
      readOptionalString((raw.data as Record<string, unknown>)?.description) ??
      null,
    start_time: readOptionalString(raw.start_time) ?? readOptionalString(raw.begin_date) ?? null,
    end_time: readOptionalString(raw.end_time) ?? readOptionalString(raw.end_date) ?? null,
    score: typeof raw.score === 'number' ? raw.score : null,
    total_score: typeof raw.total_score === 'number' ? raw.total_score : null,
    status: String(raw.status ?? 'pending'),
    weight: typeof raw.weight === 'number' ? raw.weight : null,
    allow_late: Boolean(raw.allow_late ?? raw.allow_late_submission ?? false),
    late_penalty_percent:
      typeof raw.late_penalty_percent === 'number' ? raw.late_penalty_percent : null,
    attachments: normalizeAttachments(raw.attachments ?? raw.files ?? raw.resources),
    rubric: raw.rubric ? (raw.rubric as TCRubric) : null,
    submission_type:
      readOptionalString(raw.submission_type) ?? readOptionalString(raw.submit_type) ?? null,
    max_submissions: typeof raw.max_submissions === 'number' ? raw.max_submissions : null,
    ...raw,
  };
}

function normalizeAttachments(raw: unknown): TCAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: Record<string, unknown>) => ({
    id: Number(a.id ?? 0),
    name: String(a.name ?? a.file_name ?? a.title ?? ''),
    url: String(a.url ?? a.download_url ?? a.file_url ?? ''),
    size:
      typeof a.size === 'number' ? a.size : typeof a.file_size === 'number' ? a.file_size : null,
    mime_type: readOptionalString(a.mime_type) ?? readOptionalString(a.content_type) ?? null,
    ...a,
  }));
}

/** 取得作業提交記錄 (自己的) */
export async function tcFetchHomeworkSubmissions(
  courseId: number,
  homeworkId: number,
): Promise<TCHomeworkSubmission[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCHomeworkSubmission[]>('homeworkSubmissions', {
      courseId,
      homeworkId,
    });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/homework-activities/${homeworkId}/student-submissions`,
    `${TC_BASE}/api/courses/${courseId}/homework-activities/${homeworkId}/submissions`,
    `${TC_BASE}/api/courses/${courseId}/activities/${homeworkId}/student-submissions`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.submissions ??
        data.student_submissions ??
        (Array.isArray(data) ? data : null)) as Record<string, unknown>[] | null;
      if (items && Array.isArray(items)) {
        return items.map(
          (s): TCHomeworkSubmission => ({
            id: Number(s.id ?? 0),
            homework_id: homeworkId,
            student_id: Number(s.student_id ?? s.user_id ?? 0),
            submitted_at:
              readOptionalString(s.submitted_at) ?? readOptionalString(s.created_at) ?? null,
            status: String(s.status ?? 'submitted'),
            score: typeof s.score === 'number' ? s.score : null,
            total_score: typeof s.total_score === 'number' ? s.total_score : null,
            feedback: readOptionalString(s.feedback) ?? readOptionalString(s.comment) ?? null,
            attachments: normalizeAttachments(s.attachments ?? s.files),
            is_late: Boolean(s.is_late ?? s.late ?? false),
            graded_at: readOptionalString(s.graded_at) ?? null,
            ...s,
          }),
        );
      }
    }
  }
  return [];
}

/** 取得考試詳情 */
export async function tcFetchExamDetail(
  courseId: number,
  examId: number,
): Promise<TCExamDetail | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCExamDetail>('examDetail', { courseId, examId });
  }

  const data = await tcFetchJSON<Record<string, unknown>>(
    `${TC_BASE}/api/courses/${courseId}/exams/${examId}`,
  );
  if (!data) return null;

  return {
    id: Number(data.id ?? 0),
    course_id: courseId,
    title: String(data.title ?? ''),
    description: readOptionalString(data.description) ?? null,
    start_time: String(data.start_time ?? ''),
    end_time: String(data.end_time ?? ''),
    duration_minutes:
      typeof data.duration === 'number'
        ? data.duration
        : typeof data.duration_minutes === 'number'
          ? data.duration_minutes
          : null,
    question_count:
      typeof data.question_count === 'number'
        ? data.question_count
        : typeof data.total_questions === 'number'
          ? data.total_questions
          : null,
    total_score: typeof data.total_score === 'number' ? data.total_score : null,
    max_attempts:
      typeof data.max_attempts === 'number'
        ? data.max_attempts
        : typeof data.attempt_count === 'number'
          ? data.attempt_count
          : null,
    show_answers: Boolean(data.show_answers ?? data.show_answer ?? false),
    attempted: Boolean(data.attempted ?? data.has_attempted ?? false),
    ...data,
  };
}

/** 取得考試作答記錄 */
export async function tcFetchExamAttempts(
  courseId: number,
  examId: number,
): Promise<TCExamAttempt[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCExamAttempt[]>('examAttempts', { courseId, examId });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/exams/${examId}/student-submissions`,
    `${TC_BASE}/api/courses/${courseId}/exams/${examId}/submissions`,
    `${TC_BASE}/api/courses/${courseId}/exams/${examId}/attempts`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.submissions ??
        data.attempts ??
        data.student_submissions ??
        (Array.isArray(data) ? data : null)) as Record<string, unknown>[] | null;
      if (items && Array.isArray(items)) {
        return items.map(
          (a): TCExamAttempt => ({
            id: Number(a.id ?? 0),
            exam_id: examId,
            student_id: Number(a.student_id ?? a.user_id ?? 0),
            started_at:
              readOptionalString(a.started_at) ?? readOptionalString(a.start_time) ?? null,
            submitted_at:
              readOptionalString(a.submitted_at) ?? readOptionalString(a.end_time) ?? null,
            score: typeof a.score === 'number' ? a.score : null,
            total_score: typeof a.total_score === 'number' ? a.total_score : null,
            status: String(a.status ?? 'submitted'),
            answers: Array.isArray(a.answers) ? (a.answers as TCExamAttempt['answers']) : null,
            ...a,
          }),
        );
      }
    }
  }
  return [];
}

/** 取得課程討論區列表 */
export async function tcFetchDiscussions(courseId: number): Promise<TCDiscussion[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCDiscussion[]>('discussions', { courseId });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/discussions`,
    `${TC_BASE}/api/courses/${courseId}/forums`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.discussions ?? data.forums ?? (Array.isArray(data) ? data : null)) as
        | Record<string, unknown>[]
        | null;
      if (items && Array.isArray(items)) {
        return items.map(
          (d): TCDiscussion => ({
            id: Number(d.id ?? 0),
            course_id: courseId,
            title: String(d.title ?? d.name ?? ''),
            description: readOptionalString(d.description) ?? null,
            post_count: Number(d.post_count ?? d.reply_count ?? 0),
            created_at: readOptionalString(d.created_at) ?? null,
            last_post_at:
              readOptionalString(d.last_post_at) ?? readOptionalString(d.updated_at) ?? null,
            is_locked: Boolean(d.is_locked ?? d.locked ?? false),
            ...d,
          }),
        );
      }
    }
  }
  return [];
}

/** 取得討論區貼文 */
export async function tcFetchDiscussionPosts(
  courseId: number,
  discussionId: number,
): Promise<TCDiscussionPost[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCDiscussionPost[]>('discussionPosts', {
      courseId,
      discussionId,
    });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/discussions/${discussionId}/posts`,
    `${TC_BASE}/api/courses/${courseId}/forums/${discussionId}/posts`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.posts ?? data.replies ?? (Array.isArray(data) ? data : null)) as
        | Record<string, unknown>[]
        | null;
      if (items && Array.isArray(items)) {
        return items.map(
          (p): TCDiscussionPost => ({
            id: Number(p.id ?? 0),
            discussion_id: discussionId,
            author_id: Number(p.author_id ?? p.user_id ?? p.creator_id ?? 0),
            author_name:
              readOptionalString(p.author_name) ??
              readOptionalString(p.user_name) ??
              readOptionalString(p.creator_name) ??
              null,
            content: String(p.content ?? p.body ?? p.text ?? ''),
            created_at: String(p.created_at ?? ''),
            updated_at: readOptionalString(p.updated_at) ?? null,
            parent_id: typeof p.parent_id === 'number' ? p.parent_id : null,
            likes_count: Number(p.likes_count ?? p.like_count ?? 0),
            attachments: normalizeAttachments(p.attachments ?? p.files),
            ...p,
          }),
        );
      }
    }
  }
  return [];
}

/** 取得課程公告 (課程級別) */
export async function tcFetchCourseAnnouncements(courseId: number): Promise<TCAnnouncementItem[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCAnnouncementItem[]>('courseAnnouncements', { courseId });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/announcements`,
    `${TC_BASE}/api/courses/${courseId}/notifications`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.announcements ??
        data.notifications ??
        (Array.isArray(data) ? data : null)) as Record<string, unknown>[] | null;
      if (items && Array.isArray(items)) {
        return items.map(
          (a): TCAnnouncementItem => ({
            id: Number(a.id ?? 0),
            title: String(a.title ?? ''),
            content: String(a.content ?? a.body ?? ''),
            created_at: readOptionalString(a.created_at) ?? undefined,
            ...a,
          }),
        );
      }
    }
  }
  return [];
}

/** 取得課程教材/資源 */
export async function tcFetchMaterials(courseId: number): Promise<TCMaterial[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCMaterial[]>('materials', { courseId });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/resources`,
    `${TC_BASE}/api/courses/${courseId}/materials`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.resources ?? data.materials ?? (Array.isArray(data) ? data : null)) as
        | Record<string, unknown>[]
        | null;
      if (items && Array.isArray(items)) {
        return items.map(
          (m): TCMaterial => ({
            id: Number(m.id ?? 0),
            course_id: courseId,
            title: String(m.title ?? m.name ?? ''),
            type: String(m.type ?? m.resource_type ?? 'file'),
            url: readOptionalString(m.url) ?? readOptionalString(m.download_url) ?? null,
            file_name: readOptionalString(m.file_name) ?? readOptionalString(m.name) ?? null,
            file_size:
              typeof m.file_size === 'number'
                ? m.file_size
                : typeof m.size === 'number'
                  ? m.size
                  : null,
            mime_type:
              readOptionalString(m.mime_type) ?? readOptionalString(m.content_type) ?? null,
            description: readOptionalString(m.description) ?? null,
            module_id: typeof m.module_id === 'number' ? m.module_id : null,
            created_at: readOptionalString(m.created_at) ?? null,
            ...m,
          }),
        );
      }
    }
  }
  return [];
}

/** 取得成績明細 */
export async function tcFetchGradeDetails(courseId: number): Promise<TCGradeDetail | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCGradeDetail>('gradeDetails', { courseId });
  }

  // 嘗試 gradebook / grade-items
  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/gradebook`,
    `${TC_BASE}/api/courses/${courseId}/grade-items`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) return data as unknown as TCGradeDetail;
  }

  // Fallback: 組合 score-items + self-score
  const scoreItems = await tcFetchScoreItems(courseId);
  const selfScore = await tcFetchSelfScore(courseId);
  return {
    score_items: scoreItems,
    self_score: selfScore,
    item_scores: null,
    source: 'combined',
  };
}

/** 取得課程成員 */
export async function tcFetchCourseMembers(courseId: number): Promise<TCCourseMember[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCCourseMember[]>('courseMembers', { courseId });
  }

  const data = await tcFetchJSON<Record<string, unknown>>(
    `${TC_BASE}/api/courses/${courseId}/members?page=1&page_size=200`,
  );
  const members = (data?.members ?? (Array.isArray(data) ? data : null)) as
    | Record<string, unknown>[]
    | null;
  if (!members) return [];

  return members.map(
    (m): TCCourseMember => ({
      id: Number(m.id ?? 0),
      name: String(m.name ?? m.display_name ?? ''),
      role: String(m.role ?? 'student'),
      avatar_url: readOptionalString(m.avatar_url) ?? readOptionalString(m.avatar_big_url) ?? null,
      ...m,
    }),
  );
}

/** 取得學習活動 (含進度追蹤) */
export async function tcFetchLearningActivities(courseId: number): Promise<TCActivity[]> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCActivity[]>('learningActivities', { courseId });
  }

  const data = await tcFetchJSON<Record<string, unknown>>(
    `${TC_BASE}/api/courses/${courseId}/learning-activities`,
  );
  const items = (data?.learning_activities ??
    data?.activities ??
    (Array.isArray(data) ? data : null)) as Record<string, unknown>[] | null;
  if (!items) return [];

  return items.map(
    (a): TCActivity => ({
      id: Number(a.id ?? 0),
      course_id: courseId,
      type: String(a.type ?? 'material'),
      title: String(a.title ?? ''),
      description: readOptionalString(a.description) ?? null,
      start_time: readOptionalString(a.start_time) ?? null,
      end_time: readOptionalString(a.end_time) ?? null,
      score: typeof a.score === 'number' ? a.score : null,
      total_score: typeof a.total_score === 'number' ? a.total_score : null,
      status: String(a.status ?? 'pending'),
      weight: typeof a.weight === 'number' ? a.weight : null,
      score_percentage: typeof a.score_percentage === 'number' ? a.score_percentage : null,
      published: Boolean(a.published ?? true),
    }),
  );
}

/** 取得教學大綱 */
export async function tcFetchSyllabus(courseId: number): Promise<unknown | null> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend('syllabus', { courseId });
  }

  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/syllabus`,
    `${TC_BASE}/api/courses/${courseId}/outline`,
  ];

  for (const url of endpoints) {
    const data = await tcFetchJSON(url);
    if (data) return data;
  }
  return null;
}

/** 一次取得課程所有詳細資料 (聚合端點) */
export async function tcFetchCourseFullData(courseId: number): Promise<TCCourseFullData> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCCourseFullData>('courseFullData', { courseId });
  }

  // 平行呼叫所有端點
  const [
    courseDetail,
    activities,
    modules,
    exams,
    scoreItems,
    selfScore,
    homeworkStatus,
    homeworkScores,
    examStatus,
    courseAnnouncements,
    materials,
    discussions,
    gradeDetails,
    learningActivities,
  ] = await Promise.all([
    tcFetchCourseDetail(courseId).catch(() => null),
    tcFetchActivities(courseId).catch(() => []),
    tcFetchModules(courseId).catch(() => []),
    tcFetchExams(courseId).catch(() => []),
    tcFetchScoreItems(courseId).catch(() => []),
    tcFetchSelfScore(courseId).catch(() => null),
    tcFetchHomeworkStatus(courseId).catch(() => null),
    tcFetchHomeworkScores(courseId).catch(() => []),
    tcFetchExamStatus(courseId).catch(() => null),
    tcFetchCourseAnnouncements(courseId).catch(() => []),
    tcFetchMaterials(courseId).catch(() => []),
    tcFetchDiscussions(courseId).catch(() => []),
    tcFetchGradeDetails(courseId).catch(() => null),
    tcFetchLearningActivities(courseId).catch(() => []),
  ]);

  return {
    courseDetail,
    activities,
    modules,
    exams,
    scoreItems,
    selfScore,
    homeworkStatus,
    homeworkScores,
    examStatus,
    courseAnnouncements,
    materials,
    discussions,
    gradeDetails,
    learningActivities,
  };
}

// ── 新增：課程內容頁專用 API ───────────────────────────────────

/** 課程活動（含 uploads 檔案資訊） */
export type TCCourseActivity = {
  id: number;
  title: string;
  type: string; // "material" | "exam" | ...
  module_id: number;
  start_time: string | null;
  end_time: string | null;
  uploads: Array<{
    id: number;
    name: string;
    key: string;
    type: string;
    size: number;
    allow_download: boolean;
  }>;
};

/** 考試提交（含學生分數） */
export type TCExamSubmission = {
  exam_score: number | null;
  exam_final_score: number | null;
  exam_score_rule: string;
  submissions: Array<{
    id: number;
    exam_id: number;
    score: string;
    created_at: string;
    submitted_at: string;
    submit_method: string;
  }>;
};

/** 考試基本資訊 */
export type TCExamInfo = {
  id: number;
  title: string;
  type: string;
  module_id: number;
  start_time: string | null;
  end_time: string | null;
  total_score: number | null;
  submit_times: number;
  submitted_times: number;
  is_closed: boolean;
  score_percentage: string;
};

/** 取得課程教材活動列表（含 uploads）
 *
 * 修正：TronClass 教材有多種 type（material / video / online_video / audio / web_link / page / courseware_activity），
 * 不能只抓 `courseware_activity` 一種。改成抓全部 activities 再過濾「非作業非考試」。
 */
export async function tcFetchCourseActivities(courseId: number): Promise<TCCourseActivity[]> {
  // 排除作業 / 考試類型；其他都算教材
  const HOMEWORK_OR_EXAM = new Set([
    'homework',
    'exam',
    'quiz',
    'classroom',
    'live',
    'attendance',
    'survey',
  ]);

  // 抓全部 activities（不加 type filter）
  const urls = [
    `${TC_BASE}/api/courses/${courseId}/activities`,
    `${TC_BASE}/api/courses/${courseId}/activities?sub_course_id=0`,
  ];

  const allActivities: Record<string, unknown>[] = [];
  const seen = new Set<number>();

  for (const url of urls) {
    const data = await tcFetchJSON<{ activities?: Record<string, unknown>[] }>(url);
    if (!data?.activities) continue;
    for (const a of data.activities) {
      const id = Number(a.id ?? 0);
      if (id && !seen.has(id)) {
        seen.add(id);
        allActivities.push(a);
      }
    }
  }

  // 同時抓 courseware_activity（有些回應只在這支才有 uploads）
  const cwData = await tcFetchJSON<{ activities?: Record<string, unknown>[] }>(
    `${TC_BASE}/api/courses/${courseId}/activities?type=courseware_activity`,
  );
  if (cwData?.activities) {
    for (const a of cwData.activities) {
      const id = Number(a.id ?? 0);
      if (id && !seen.has(id)) {
        seen.add(id);
        allActivities.push(a);
      }
    }
  }

  return allActivities
    .filter((a) => !HOMEWORK_OR_EXAM.has(String(a.type ?? '').toLowerCase()))
    .map(
      (a): TCCourseActivity => ({
        id: Number(a.id ?? 0),
        title: String(a.title ?? a.name ?? ''),
        type: String(a.type ?? 'material'),
        module_id: Number(a.module_id ?? a.parent_id ?? 0),
        start_time: readOptionalString(a.start_time) ?? null,
        end_time: readOptionalString(a.end_time) ?? null,
        uploads: Array.isArray(a.uploads)
          ? (a.uploads as Record<string, unknown>[]).map((u) => ({
              id: Number(u.id ?? 0),
              name: String(u.name ?? ''),
              key: String(u.key ?? u.file_key ?? ''),
              type: String(u.type ?? u.mime_type ?? ''),
              size: Number(u.size ?? 0),
              allow_download: u.allow_download !== false,
            }))
          : Array.isArray(a.attachments)
          ? (a.attachments as Record<string, unknown>[]).map((u) => ({
              id: Number(u.id ?? 0),
              name: String(u.name ?? u.filename ?? ''),
              key: String(u.key ?? u.upload_id ?? ''),
              type: String(u.type ?? u.mime_type ?? ''),
              size: Number(u.size ?? 0),
              allow_download: u.allow_download !== false,
            }))
          : [],
      }),
    );
}

/** 取得課程考試列表 — 用 /api/courses/{id}/exams
 *
 * 真實 schema（2026-05-13 驗證）：
 *   - `exam_submissions: number[]` ← 學生已提交的 submission IDs；length > 0 = 已交
 *   - `submit_times: number`（已交次數）
 *   - `score_rule: 'highest' | 'latest'`
 *   - `score_type: 'percentage' | 'point'`
 *   - `score_percentage: string`（'85.00'，課程整體 weight）
 *   - `is_practice_mode: boolean`（true = 練習；false = 正式考試）
 *   - `is_closed / is_in_progress / is_started`
 *   - `module_id / end_time / start_time / publish_time`
 */
export async function tcFetchCourseExams(courseId: number): Promise<TCExamInfo[]> {
  const url = `${TC_BASE}/api/courses/${courseId}/exams`;
  const data = await tcFetchJSON<{ exams?: Record<string, unknown>[] }>(url);
  if (!data?.exams) return [];

  return data.exams.map((e): TCExamInfo => {
    const examSubmissions = Array.isArray(e.exam_submissions) ? e.exam_submissions : [];
    return {
      id: Number(e.id ?? 0),
      title: String(e.title ?? ''),
      // type 在 TronClass 回應裡是 'exam'（包含小考考試）— 用 is_practice_mode 區分
      type: e.is_practice_mode === true ? 'quiz' : 'exam',
      module_id: Number(e.module_id ?? 0),
      start_time: readOptionalString(e.start_time) ?? null,
      end_time: readOptionalString(e.end_time) ?? null,
      total_score: typeof e.total_score === 'number' ? e.total_score : null,
      submit_times: Number(e.submit_times ?? 0),
      // 已交 = exam_submissions 陣列有值，或 submit_times > 0
      submitted_times:
        examSubmissions.length > 0
          ? examSubmissions.length
          : Number(e.submit_times ?? 0),
      is_closed: e.is_closed === true,
      score_percentage: String(e.score_percentage ?? '0'),
    };
  });
}

/** 取得學生考試提交分數 — 用 /api/exams/{id}/submissions */
export async function tcFetchExamSubmissions(examId: number): Promise<TCExamSubmission | null> {
  const url = `${TC_BASE}/api/exams/${examId}/submissions`;
  const data = await tcFetchJSON<Record<string, unknown>>(url);
  if (!data) return null;

  return {
    exam_score: typeof data.exam_score === 'number' ? data.exam_score : null,
    exam_final_score: typeof data.exam_final_score === 'number' ? data.exam_final_score : null,
    exam_score_rule: String(data.exam_score_rule ?? 'highest'),
    submissions: Array.isArray(data.submissions)
      ? (data.submissions as Record<string, unknown>[]).map((s) => ({
          id: Number(s.id ?? 0),
          exam_id: Number(s.exam_id ?? 0),
          score: String(s.score ?? '0'),
          created_at: String(s.created_at ?? ''),
          submitted_at: String(s.submitted_at ?? ''),
          submit_method: String(s.submit_method ?? ''),
        }))
      : [],
  };
}

// ─────────────────────────────────────────────────────────
// Write endpoints — 寫入 TronClass（學生發討論 / 繳作業 / 答問卷 / 同儕互評）
// ─────────────────────────────────────────────────────────

export type TCWriteResult = {
  success: boolean;
  id?: number | string;
  error?: string;
};

/** 在課程討論區建立新討論串 */
export async function tcPostDiscussion(
  courseId: number,
  input: { title: string; content?: string },
): Promise<TCWriteResult> {
  if (!isTronClassDataFetchEnabled()) {
    return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE };
  }
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCWriteResult>('postDiscussion', { courseId, input });
  }
  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/discussions`,
    `${TC_BASE}/api/courses/${courseId}/forums`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.title, content: input.content ?? '' }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { success: true, id: (data.id as number | string | undefined) };
      }
    } catch {
      /* try next endpoint */
    }
  }
  return { success: false, error: '無法建立討論（連線或權限失敗）' };
}

/** 在討論串底下回覆 */
export async function tcPostDiscussionReply(
  courseId: number,
  discussionId: number,
  content: string,
): Promise<TCWriteResult> {
  if (!isTronClassDataFetchEnabled()) {
    return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE };
  }
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCWriteResult>('postDiscussionReply', {
      courseId,
      discussionId,
      content,
    });
  }
  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/discussions/${discussionId}/posts`,
    `${TC_BASE}/api/courses/${courseId}/forums/${discussionId}/posts`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { success: true, id: (data.id as number | string | undefined) };
      }
    } catch {
      /* try next */
    }
  }
  return { success: false, error: '回覆失敗' };
}

/** 繳交作業 */
export async function tcSubmitHomework(
  courseId: number,
  hwId: number,
  input: {
    content?: string;
    /** 附件 URI 列表，會分別上傳 */
    attachments?: Array<{ uri: string; name: string; type?: string }>;
  },
): Promise<TCWriteResult> {
  if (!isTronClassDataFetchEnabled()) {
    return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE };
  }
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCWriteResult>('submitHomework', {
      courseId,
      hwId,
      input,
    });
  }
  try {
    // 1. 先把附件上傳（multipart）
    const uploadedKeys: string[] = [];
    for (const att of input.attachments ?? []) {
      const form = new FormData();
      form.append('file', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        uri: att.uri,
        name: att.name,
        type: att.type ?? 'application/octet-stream',
      } as any);
      const upRes = await fetch(`${TC_BASE}/api/uploads`, {
        method: 'POST',
        credentials: 'include',
        body: form as unknown as BodyInit,
      });
      if (upRes.ok) {
        const upData = (await upRes.json().catch(() => ({}))) as Record<string, unknown>;
        const key = String(upData.key ?? upData.id ?? '');
        if (key) uploadedKeys.push(key);
      }
    }
    // 2. 建立繳交紀錄
    const res = await fetch(
      `${TC_BASE}/api/courses/${courseId}/homework/${hwId}/submissions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: input.content ?? '',
          upload_keys: uploadedKeys,
        }),
      },
    );
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { success: true, id: (data.id as number | string | undefined) };
    }
    return { success: false, error: `送出失敗 (${res.status})` };
  } catch (e) {
    return { success: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 取得課程問卷列表（TronClass survey endpoint，可能未公開；回傳空陣列代表沒有） */
export async function tcFetchSurveys(courseId: number): Promise<
  Array<{ id: number; title: string; questions: unknown[] }>
> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend('surveys', { courseId });
  }
  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/surveys`,
    `${TC_BASE}/api/courses/${courseId}/questionnaires`,
  ];
  for (const url of endpoints) {
    const data = await tcFetchJSON<Record<string, unknown>>(url);
    if (data) {
      const items = (data.surveys ?? data.questionnaires ?? (Array.isArray(data) ? data : null)) as
        | Record<string, unknown>[]
        | null;
      if (Array.isArray(items)) {
        return items.map((s) => ({
          id: Number(s.id ?? 0),
          title: String(s.title ?? s.name ?? ''),
          questions: Array.isArray(s.questions) ? (s.questions as unknown[]) : [],
        }));
      }
    }
  }
  return [];
}

/** 送出問卷答案 */
export async function tcSubmitSurvey(
  courseId: number,
  surveyId: number,
  answers: Record<string, unknown>,
): Promise<TCWriteResult> {
  if (!isTronClassDataFetchEnabled()) {
    return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE };
  }
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCWriteResult>('submitSurvey', {
      courseId,
      surveyId,
      answers,
    });
  }
  try {
    const res = await fetch(
      `${TC_BASE}/api/courses/${courseId}/surveys/${surveyId}/responses`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      },
    );
    return { success: res.ok };
  } catch (e) {
    return { success: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 取得同儕互評任務 */
export async function tcFetchPeerReviews(courseId: number): Promise<
  Array<{
    id: number;
    assignment_title: string;
    target_submission_id: number;
    target_anonymous_name: string;
    rubric: unknown;
    submitted: boolean;
  }>
> {
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend('peerReviews', { courseId });
  }
  const data = await tcFetchJSON<Record<string, unknown>>(
    `${TC_BASE}/api/courses/${courseId}/peer_reviews`,
  );
  const items = (data?.reviews ?? data?.assignments ?? (Array.isArray(data) ? data : null)) as
    | Record<string, unknown>[]
    | null;
  if (!Array.isArray(items)) return [];
  return items.map((r) => ({
    id: Number(r.id ?? 0),
    assignment_title: String(r.assignment_title ?? r.title ?? ''),
    target_submission_id: Number(r.target_submission_id ?? r.submission_id ?? 0),
    target_anonymous_name: String(r.anonymous_name ?? '匿名同學'),
    rubric: r.rubric ?? null,
    submitted: Boolean(r.submitted ?? false),
  }));
}

/** 送出同儕互評 */
export async function tcSubmitPeerReview(
  courseId: number,
  reviewId: number,
  payload: {
    scores: Record<string, string>;
    comments?: Record<string, string>;
    overallFeedback?: string;
    totalScore?: number;
  },
): Promise<TCWriteResult> {
  if (!isTronClassDataFetchEnabled()) {
    return { success: false, error: TRONCLASS_DATA_DISABLED_MESSAGE };
  }
  await ensureBackendSessionLoaded();
  if (shouldUseBackendSession()) {
    return await fetchTronClassBackend<TCWriteResult>('submitPeerReview', {
      courseId,
      reviewId,
      payload,
    });
  }
  try {
    const res = await fetch(
      `${TC_BASE}/api/courses/${courseId}/peer_reviews/${reviewId}/submissions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    return { success: res.ok };
  } catch (e) {
    return { success: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 構建教材檔案的下載/檢視 URL */
export function tcBuildFileViewUrl(courseId: number, activityId: number): string {
  return `${TC_BASE}/course/${courseId}/content#/activity/${activityId}`;
}

/** 構建教材檔案直接下載 URL（用 upload key）*/
export function tcBuildFileDownloadUrl(uploadKey: string): string {
  return `${TC_BASE}/api/uploads/${uploadKey}/blob`;
}

/** 構建考試檢視 URL */
export function tcBuildExamViewUrl(courseId: number, examId: number): string {
  return `${TC_BASE}/course/${courseId}/content#/exam/${examId}`;
}

/** 構建課程成績頁面 URL */
export function tcBuildScoreUrl(courseId: number): string {
  return `${TC_BASE}/course/${courseId}/score#/`;
}
