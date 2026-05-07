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

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getCloudFunctionUrl } from './cloudFunctions';

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
    const raw = await AsyncStorage.getItem(TC_BACKEND_SESSION_KEY);
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
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 2000); // 2 秒逾時，Cloud Functions 未部署時快速失敗

    let response: Response;
    try {
      response = await fetch(getCloudFunctionUrl('puRefreshTronClassSession'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    | 'courseFullData',
  extra: Record<string, unknown> = {},
): Promise<T> {
  await ensureBackendSessionLoaded();
  if (!shouldUseBackendSession()) {
    throw new Error('No TronClass backend session');
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 5000); // 5 秒逾時

  let response: Response;
  try {
    response = await fetch(getCloudFunctionUrl('puFetchTronClassData'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
  } = {},
): Promise<{ body: string; status: number; url: string }> {
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

async function tcFetchJSON<T>(url: string): Promise<T | null> {
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
 * 直連 Keycloak CAS 登入（完全還原原始能動版本的流程）
 * 用 tcFetch (credentials:"include") 維持 cookie chain。
 */
async function tcLoginDirectCAS(
  uid: string,
  password: string,
): Promise<{ success: boolean; session: TCSession | null; error?: string }> {
  try {
    // 清除之前的 X-SESSION-ID，避免 tcFetch 跳過 cookie（CAS 靠 cookie 運作）
    _tcXSessionId = null;

    // ── 策略 A: 先嘗試 TronClass 原生 /api/login（最可靠） ──
    console.log('[TronClass] Trying native /api/login endpoint…');
    try {
      const nativeLoginResult = await tcFetch(`${TC_BASE}/api/login`, {
        method: 'POST',
        body: JSON.stringify({ user_name: uid, password }),
        contentType: 'application/json',
        accept: 'application/json',
        timeoutMs: 10000,
      });
      console.log('[TronClass] Native /api/login status:', nativeLoginResult.status);

      if (nativeLoginResult.status === 200) {
        try {
          const nativeData = JSON.parse(nativeLoginResult.body);
          // 有些 TronClass 實例回傳 session_id 在 header 或 body
          const sessionId = nativeData?.session_id ?? nativeData?.token ?? null;
          if (sessionId) {
            _tcXSessionId = sessionId;
          }
          // 嘗試取得 profile 驗證
          const profile = await tcFetchJSON<TCUserProfile>(`${TC_BASE}/api/profile`);
          if (profile?.id) {
            _tcUserId = profile.id;
            console.log('[TronClass] Native login success! User:', profile.name);
            return {
              success: true,
              session: { loggedIn: true, userId: profile.id, userName: profile.name },
            };
          }
          // 即使沒 profile，如果 /api/login 回 200 也算成功
          if (nativeData?.id || nativeData?.user_id) {
            _tcUserId = nativeData.id ?? nativeData.user_id;
            console.log('[TronClass] Native login success (from response body)!');
            return {
              success: true,
              session: { loggedIn: true, userId: _tcUserId, userName: nativeData.name ?? null },
            };
          }
        } catch {
          /* JSON parse failed, try CAS */
        }
      } else if (
        nativeLoginResult.status === 400 ||
        nativeLoginResult.status === 401 ||
        nativeLoginResult.status === 403
      ) {
        // 帳密錯 → 不需要繼續嘗試 CAS
        try {
          const errData = JSON.parse(nativeLoginResult.body);
          const errCode = errData?.errors?.code ?? '';
          const errMsg = JSON.stringify(
            errData?.errors ?? errData?.error ?? errData?.message ?? '',
          );
          if (
            errCode === '_INVALID_PASSWORD_' ||
            errMsg.includes('密碼') ||
            errMsg.includes('password') ||
            errMsg.includes('Invalid') ||
            errMsg.includes('does not match')
          ) {
            return { success: false, session: null, error: 'TronClass 帳號或密碼錯誤' };
          }
        } catch {
          /* continue to CAS */
        }
      }
      console.log("[TronClass] Native /api/login didn't work, falling back to CAS…");
    } catch (nativeErr) {
      console.warn('[TronClass] Native /api/login error (trying CAS):', nativeErr);
    }

    // ── 策略 B: Keycloak CAS 登入 ──
    const serviceUrl = `${TC_BASE}/login`;
    const casUrl = `${IDENTITY_BASE}${CAS_LOGIN_PATH}?service=${encodeURIComponent(serviceUrl)}&locale=zh_TW`;

    // Step 1: GET CAS login page
    console.log('[TronClass] Direct CAS Step 1: GET CAS login page…');
    const loginPage = await tcFetch(casUrl, { accept: 'text/html', timeoutMs: 15000 });
    console.log('[TronClass] CAS page status:', loginPage.status);
    console.log('[TronClass] CAS page url:', loginPage.url);
    console.log('[TronClass] CAS body length:', loginPage.body.length);

    // 如果已經被 redirect 到 TronClass（表示已登入），直接驗證
    if (loginPage.url.includes('tronclass.pu.edu.tw') && !loginPage.body.includes('<form')) {
      console.log('[TronClass] Already redirected to TronClass (session active)');
      const profile = await tcFetchJSON<TCUserProfile>(`${TC_BASE}/api/profile`);
      if (profile?.id) {
        _tcUserId = profile.id;
        return {
          success: true,
          session: { loggedIn: true, userId: profile.id, userName: profile.name },
        };
      }
    }

    // 解析 form action URL（支援多種 Keycloak HTML 格式）
    // 嘗試多種 regex 模式匹配 form action
    let formAction: string | null = null;
    const formPatterns = [
      /<form[^>]+id=["']kc-form-login["'][^>]+action=["']([^"']+)["']/i,
      /<form[^>]+action=["']([^"']+)["'][^>]+id=["']kc-form-login["']/i,
      /<form[^>]+action=["'](https?:\/\/identity[^"']+)["']/i,
      /<form[^>]+action=["']([^"']+authenticate[^"']*?)["']/i,
      /<form[^>]+action=["']([^"']+)["']/i, // 最寬鬆的 fallback
    ];
    for (const pattern of formPatterns) {
      const match = loginPage.body.match(pattern);
      if (match?.[1]) {
        formAction = match[1].replace(/&amp;/g, '&');
        console.log('[TronClass] Matched form action with pattern:', pattern.source.slice(0, 40));
        break;
      }
    }

    if (!formAction) {
      console.warn('[TronClass] Could not find form action in CAS page');
      console.warn('[TronClass] CAS body snippet:', loginPage.body.slice(0, 1000));
      formAction = loginPage.url; // fallback 到 CAS URL 本身
    }

    // 解析隱藏欄位（增強版：支援更多 HTML 格式）
    const hiddenFields: Record<string, string> = {};
    const hiddenRegex = /<input[^>]*type=["']hidden["'][^>]*\/?>/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = hiddenRegex.exec(loginPage.body)) !== null) {
      const nameMatch = hMatch[0].match(/name=["']([^"']+)["']/);
      const valueMatch = hMatch[0].match(/value=["']([^"']*?)["']/);
      if (nameMatch?.[1]) {
        hiddenFields[nameMatch[1]] = valueMatch?.[1] ?? '';
      }
    }
    console.log('[TronClass] Hidden fields found:', Object.keys(hiddenFields).join(', '));

    // Step 2: POST credentials
    console.log('[TronClass] Direct CAS Step 2: POST credentials…');
    const formData = new URLSearchParams({
      ...hiddenFields,
      username: uid,
      password: password,
    });

    const postUrl = formAction.startsWith('http') ? formAction : `${IDENTITY_BASE}${formAction}`;
    console.log('[TronClass] POST URL:', postUrl);

    const loginResult = await tcFetch(postUrl, {
      method: 'POST',
      body: formData.toString(),
      contentType: 'application/x-www-form-urlencoded',
      accept: 'text/html',
      timeoutMs: 15000,
    });

    console.log('[TronClass] POST status:', loginResult.status);
    console.log('[TronClass] Landed on:', loginResult.url);

    // Step 3: 驗證登入 — 檢查帳密是否錯誤
    const errorIndicators = [
      '無效的使用者名稱或密碼',
      'Invalid username or password',
      'Invalid credentials',
      '帳號或密碼',
      '登入失敗',
      'Login failed',
      'kc-feedback-text',
      'input-error',
    ];
    const isCredentialError = errorIndicators.some((indicator) =>
      loginResult.body.includes(indicator),
    );

    if (isCredentialError) {
      // 再次確認是否真的是帳密錯誤（排除只是表單殘留）
      const stillOnLoginPage =
        loginResult.body.includes('kc-form-login') || loginResult.body.includes('id="password"');
      if (stillOnLoginPage) {
        return { success: false, session: null, error: 'TronClass 帳號或密碼錯誤' };
      }
    }

    // Step 3.5: 如果 POST 後 redirect 回 TronClass，嘗試手動跟隨 ticket URL
    if (loginResult.url.includes('identity.pu.edu.tw') && loginResult.status === 200) {
      // 可能 POST 成功但 redirect 沒被 follow 到 TronClass
      // 找 redirect URL（meta refresh 或 Location 模擬）
      const ticketMatch =
        loginResult.body.match(/url=["']?([^"'\s>]+tronclass[^"'\s>]*)/i) ??
        loginResult.body.match(/href=["']([^"']*tronclass[^"']*ticket=[^"']+)/i);
      if (ticketMatch?.[1]) {
        console.log('[TronClass] Following ticket redirect manually…');
        const ticketUrl = ticketMatch[1].replace(/&amp;/g, '&');
        await tcFetch(ticketUrl.startsWith('http') ? ticketUrl : `${TC_BASE}${ticketUrl}`, {
          accept: 'text/html',
          timeoutMs: 10000,
        });
      }
    }

    // Step 4: 驗證 session — 多重驗證
    console.log('[TronClass] Direct CAS Step 4: verifying session…');

    // 4a: /api/profile
    const profile = await tcFetchJSON<TCUserProfile>(`${TC_BASE}/api/profile`);
    if (profile?.id) {
      _tcUserId = profile.id;
      console.log('[TronClass] Login success! User:', profile.name, 'ID:', profile.id);
      return {
        success: true,
        session: { loggedIn: true, userId: profile.id, userName: profile.name },
      };
    }

    // 4b: /api/my-departments
    console.log('[TronClass] /api/profile failed, trying /api/my-departments…');
    const depts = await tcFetchJSON<{ departments?: unknown[] }>(`${TC_BASE}/api/my-departments`);
    if (depts?.departments) {
      console.log('[TronClass] Login success (verified via my-departments)!');
      return { success: true, session: { loggedIn: true, userId: null, userName: null } };
    }

    // 4c: /api/my-courses（有些版本的 profile 被關閉但 courses 可用）
    console.log('[TronClass] Trying /api/my-courses as final verification…');
    const coursesCheck = await tcFetchJSON<{ courses?: unknown[] }>(`${TC_BASE}/api/my-courses`);
    if (coursesCheck?.courses) {
      console.log('[TronClass] Login success (verified via my-courses)!');
      return { success: true, session: { loggedIn: true, userId: null, userName: null } };
    }

    // 最後檢查：是否到了 TronClass 主頁面（HTML 裡有使用者標記）
    if (loginResult.url.includes('tronclass.pu.edu.tw')) {
      console.log('[TronClass] Landed on TronClass domain, treating as partial success');
      return { success: true, session: { loggedIn: true, userId: null, userName: null } };
    }

    return {
      success: false,
      session: null,
      error: 'TronClass 登入後無法驗證 session，可能是伺服器暫時不穩定，請稍後再試',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '連線失敗';
    console.warn('[TronClass] Direct CAS login error:', err);
    return { success: false, session: null, error: `TronClass 登入失敗：${msg}` };
  }
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

// ─── 儲存帳密供自動刷新用（SecureStore 優先，AsyncStorage 作為 fallback） ──
import * as SecureStore from 'expo-secure-store';

const TC_CRED_KEY = '@pu_tc_cred';
const TC_CRED_ASYNC_KEY = '@pu_tc_cred_fb';
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
  } catch {
    /* SecureStore 不可用（例如模擬器） */
  }

  // AsyncStorage fallback — SecureStore 失敗時仍能在 app 重啟後還原帳密
  if (!secureOk) {
    try {
      await AsyncStorage.setItem(TC_CRED_ASYNC_KEY, payload);
    } catch {
      /* ignore */
    }
  }
}

export async function clearTCSavedCredentials(): Promise<void> {
  _savedCredentials = null;
  _savedCredentialsLoaded = true;
  try {
    await SecureStore.deleteItemAsync(TC_CRED_KEY);
  } catch {
    /* ignore */
  }
  try {
    await AsyncStorage.removeItem(TC_CRED_ASYNC_KEY);
  } catch {
    /* ignore */
  }
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
  } catch {
    /* ignore */
  }

  // Fallback: AsyncStorage
  try {
    const raw = await AsyncStorage.getItem(TC_CRED_ASYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { studentId?: string; password?: string };
      if (parsed.studentId && parsed.password) {
        _savedCredentials = { studentId: parsed.studentId, password: parsed.password };
      }
    }
  } catch {
    /* ignore */
  }

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
        is_hidden: m.is_hidden ?? false,
        syllabuses: m.syllabuses ?? [],
      }),
    );
  }

  return [];
}

/** 取得課程活動（作業、測驗、教材等） */
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

  const data = await tcFetchJSON<{ activities?: RawActivity[] }>(url);
  const activities = data?.activities ?? [];

  // 也抓作業活動（可能是另一個 endpoint）
  const hwData = await tcFetchAllPages<RawActivity>(
    `api/courses/${courseId}/homework-activities`,
    'homework_activities',
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

/** 取得課程作業列表（含提交狀態） */
export async function tcFetchHomeworkActivities(courseId: number): Promise<any[]> {
  await ensureBackendSessionLoaded();
  const url = `${TC_BASE}/api/courses/${courseId}/homework-activities?page_size=50`;
  try {
    const data = await tcFetchJSON<{ homework_activities?: any[] }>(url);
    return data?.homework_activities ?? [];
  } catch {
    return [];
  }
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

/** 取得課程教材活動列表（含 uploads）— 用 /api/courses/{id}/activities?type=courseware_activity */
export async function tcFetchCourseActivities(courseId: number): Promise<TCCourseActivity[]> {
  const url = `${TC_BASE}/api/courses/${courseId}/activities?type=courseware_activity`;
  const data = await tcFetchJSON<{ activities?: Record<string, unknown>[] }>(url);
  if (!data?.activities) return [];

  return data.activities.map(
    (a): TCCourseActivity => ({
      id: Number(a.id ?? 0),
      title: String(a.title ?? ''),
      type: String(a.type ?? ''),
      module_id: Number(a.module_id ?? 0),
      start_time: readOptionalString(a.start_time) ?? null,
      end_time: readOptionalString(a.end_time) ?? null,
      uploads: Array.isArray(a.uploads)
        ? (a.uploads as Record<string, unknown>[]).map((u) => ({
            id: Number(u.id ?? 0),
            name: String(u.name ?? ''),
            key: String(u.key ?? ''),
            type: String(u.type ?? ''),
            size: Number(u.size ?? 0),
            allow_download: u.allow_download === true,
          }))
        : [],
    }),
  );
}

/** 取得課程考試列表 — 用 /api/courses/{id}/exams */
export async function tcFetchCourseExams(courseId: number): Promise<TCExamInfo[]> {
  const url = `${TC_BASE}/api/courses/${courseId}/exams`;
  const data = await tcFetchJSON<{ exams?: Record<string, unknown>[] }>(url);
  if (!data?.exams) return [];

  return data.exams.map((e): TCExamInfo => {
    // exam_submissions 是一個陣列（包含提交 ID），用它的長度判斷是否已提交
    const examSubmissions = Array.isArray(e.exam_submissions) ? e.exam_submissions : [];
    return {
      id: Number(e.id ?? 0),
      title: String(e.title ?? ''),
      type: String(e.type ?? 'exam'),
      module_id: Number(e.module_id ?? 0),
      start_time: readOptionalString(e.start_time) ?? null,
      end_time: readOptionalString(e.end_time) ?? null,
      total_score: typeof e.total_score === 'number' ? e.total_score : null,
      submit_times: Number(e.submit_times ?? 0),
      submitted_times: examSubmissions.length,
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
