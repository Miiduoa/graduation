/**
 * Providence University (靜宜大學) TronClass scraper.
 *
 * Why this exists:
 *   - `tronclass.pu.edu.tw` / `identity.pu.edu.tw` currently publish IPv6 AAAA
 *     records, but some client environments cannot reach those IPv6 paths.
 *   - React Native fetch on iOS cannot force IPv4, so we proxy the login/data
 *     flow through Cloud Functions and pin Node's HTTPS requests to IPv4.
 *
 * Verified against public login endpoints on 2026-03-27.
 */

const https = require('https');

const TC_BASE = 'https://tronclass.pu.edu.tw';
const TC_LOGIN_ENTRY_URL = `${TC_BASE}/login?next=/user/index`;
const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

function parseCookies(setCookieHeaders, jar) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  headers.forEach((header) => {
    const pair = String(header).split(';')[0].trim();
    const index = pair.indexOf('=');
    if (index > 0) {
      jar[pair.slice(0, index)] = pair.slice(index + 1);
    }
  });
}

function cookieString(jar) {
  return Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function normalizeRequestUrl(url) {
  return url instanceof URL ? url : new URL(String(url));
}

function resolveAbsoluteUrl(location, baseUrl) {
  return new URL(location, baseUrl).toString();
}

function hasHtmlForm(body) {
  return /<form[\s>]/i.test(body);
}

function extractLoginForm(body, fallbackUrl) {
  const formActionMatch = body.match(/<form[^>]+action=["']([^"']+)["']/i);
  const action = formActionMatch?.[1]?.replace(/&amp;/g, '&') || fallbackUrl;
  const hiddenFields = {};
  const hiddenRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let match;
  while ((match = hiddenRegex.exec(body)) !== null) {
    const nameMatch = match[0].match(/name=["']([^"']+)["']/i);
    const valueMatch = match[0].match(/value=["']([^"']*?)["']/i);
    if (nameMatch?.[1]) {
      hiddenFields[nameMatch[1]] = valueMatch?.[1] ?? '';
    }
  }

  return {
    action: resolveAbsoluteUrl(action, fallbackUrl),
    hiddenFields,
  };
}

function parseUserIdFromHtml(body) {
  // 優先從 script 中的 JS 變數擷取 userId（2026-04 實測確認此格式）
  const userIdMatch =
    body.match(/userId['":\s]+(\d+)/) ||
    body.match(/user_id['":\s]+(\d+)/i) ||
    body.match(/id=["']userId["'][^>]*value=["'](\d+)["']/i) ||
    body.match(/value=["'](\d+)["'][^>]*id=["']userId["']/i);

  return userIdMatch?.[1] ? parseInt(userIdMatch[1], 10) : null;
}

function parseUserNameFromHtml(body, fallback) {
  const nameMatch =
    body.match(/class=["']user-?name["'][^>]*>([^<]+)</i) ||
    body.match(/"name"\s*:\s*"([^"]+)"/);
  return nameMatch?.[1]?.trim() || fallback || null;
}

function isCredentialError(body) {
  // 精確匹配 Keycloak 認證錯誤訊息，避免誤判。
  // 原邏輯會把包含 "error" 或 "Invalid" 的任何 HTML 判為帳密錯誤，
  // 但 Keycloak 表單頁本身就有 "error-message" id 等 HTML 屬性。
  return (
    body.includes('無效的使用者名稱或密碼') ||
    body.includes('Invalid username or password') ||
    body.includes('Invalid credentials') ||
    body.includes('帳號或密碼錯誤')
  );
}

function httpsRequest(url, { method = 'GET', body, cookies = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = normalizeRequestUrl(url);
    const bodyBuffer = body ? Buffer.from(body, 'utf8') : null;
    const requestHeaders = {
      ...COMMON_HEADERS,
      ...headers,
    };

    if (bodyBuffer) {
      requestHeaders['Content-Length'] = String(bodyBuffer.length);
    }

    if (cookies && Object.keys(cookies).length > 0) {
      requestHeaders.Cookie = cookieString(cookies);
    }

    const request = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: requestHeaders,
        family: 4,
        servername: parsed.hostname,
      },
      (response) => {
        const chunks = [];
        const jar = { ...cookies };
        parseCookies(response.headers['set-cookie'], jar);

        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            cookies: jar,
            url: parsed.toString(),
          });
        });
      },
    );

    request.on('error', reject);

    if (bodyBuffer) {
      request.write(bodyBuffer);
    }

    request.end();
  });
}

async function requestFollowRedirects(
  url,
  {
    method = 'GET',
    body,
    cookies = {},
    headers = {},
    maxRedirects = 8,
  } = {},
) {
  let currentUrl = normalizeRequestUrl(url).toString();
  let currentMethod = method;
  let currentBody = body;
  let currentCookies = { ...cookies };
  let currentHeaders = { ...headers };

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const result = await httpsRequest(currentUrl, {
      method: currentMethod,
      body: currentBody,
      cookies: currentCookies,
      headers: currentHeaders,
    });

    currentCookies = result.cookies;

    const location = result.headers.location;
    if (
      !location ||
      ![301, 302, 303, 307, 308].includes(result.status)
    ) {
      return {
        ...result,
        cookies: currentCookies,
      };
    }

    currentUrl = resolveAbsoluteUrl(location, result.url);
    currentHeaders = {
      ...currentHeaders,
      Referer: result.url,
    };

    if (result.status === 307 || result.status === 308) {
      continue;
    }

    currentMethod = 'GET';
    currentBody = undefined;
  }

  throw new Error('TronClass redirect chain exceeded limit');
}

async function tcFetchJson(url, cookies) {
  const result = await httpsRequest(url, {
    cookies,
    headers: {
      Accept: 'application/json',
    },
  });

  if (result.status !== 200) {
    throw new Error(`HTTP ${result.status}`);
  }

  if (result.body.trimStart().startsWith('<')) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  return JSON.parse(result.body);
}

async function tcFetchAllPages(basePath, dataKey, cookies, params = {}, pageSize = 20) {
  const allItems = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams({
      ...params,
      page: String(page),
      page_size: String(pageSize),
    });
    const url = `${TC_BASE}/${basePath}?${query.toString()}`;
    const data = await tcFetchJson(url, cookies);
    const items = data?.[dataKey];
    if (!Array.isArray(items) || items.length === 0) {
      break;
    }

    allItems.push(...items);

    const totalPages = typeof data.pages === 'number' ? data.pages : 1;
    if (page >= totalPages) {
      break;
    }
    page += 1;
  }

  return allItems;
}

async function tcEnsureUserId(cookies, knownUserId = null) {
  if (knownUserId) return knownUserId;

  const indexPage = await httpsRequest(`${TC_BASE}/user/index`, {
    cookies,
    headers: {
      Accept: 'text/html',
    },
  });

  const userId = parseUserIdFromHtml(indexPage.body);
  return userId || null;
}

/**
 * 策略 A：TronClass 原生 API 登入（/api/login）
 *
 * 直接 POST JSON { user_name, password } 到 TronClass，不經 Keycloak CAS。
 * 優點：一個 HTTP 請求、無 redirect chain、無跨域 cookie 問題。
 *
 * 成功時回傳 200 + JSON（含 user id/name 等），並 Set-Cookie: session=…
 * 失敗時回傳 400 + JSON：
 *   - _NO_USER_NAME_  / _NO_PASSWORD_    → 欄位缺漏
 *   - _INVALID_PASSWORD_ (password key)  → 密碼錯
 *   - _INVALID_PASSWORD_ (user_name key) → 帳號不存在
 */
async function tcLoginNativeApi(uid, password) {
  const body = JSON.stringify({ user_name: uid, password });
  const result = await httpsRequest(`${TC_BASE}/api/login`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  console.log(`[tcLoginNativeApi] POST /api/login → HTTP ${result.status}`);

  if (result.status === 200) {
    // 成功！解析回傳的使用者資訊
    let data;
    try { data = JSON.parse(result.body); } catch { data = {}; }

    const userId =
      data.user_id || data.id || data.userId ||
      (typeof data.user === 'object' ? data.user.id || data.user.user_id : null);
    const userName =
      data.name || data.user_name || data.display_name ||
      (typeof data.user === 'object' ? data.user.name || data.user.display_name : null) ||
      uid;

    return {
      success: true,
      cookies: result.cookies,
      session: {
        loggedIn: true,
        userId: userId ? Number(userId) : null,
        userName: String(userName).trim() || uid,
      },
      raw: data,
    };
  }

  // 原生 API 失敗 → 回傳失敗但不阻斷（讓 tcLogin 繼續嘗試 CAS）
  // 原生 API 帳號系統可能跟 Keycloak CAS 不同
  console.warn('[tcLoginNativeApi] Failed:', result.status, result.body.substring(0, 200));
  return {
    success: false,
    cookies: {},
    session: null,
    error: `TronClass 原生 API 失敗（HTTP ${result.status}）`,
  };
}

/**
 * 策略 B：Keycloak CAS 登入（identity.pu.edu.tw）
 *
 * 傳統 redirect chain：TronClass → Keycloak form → POST credentials → redirect back
 */
async function tcLoginCas(uid, password) {
  const loginPage = await requestFollowRedirects(TC_LOGIN_ENTRY_URL, {
    headers: { Accept: 'text/html' },
    maxRedirects: 5,
  });

  if (loginPage.status !== 200 || !hasHtmlForm(loginPage.body)) {
    return {
      success: false,
      cookies: loginPage.cookies,
      session: null,
      error: `TronClass CAS 登入頁載入失敗（HTTP ${loginPage.status}）`,
    };
  }

  const { action, hiddenFields } = extractLoginForm(loginPage.body, loginPage.url);
  const formData = new URLSearchParams({
    ...hiddenFields,
    username: uid,
    password,
    login: '',
  }).toString();

  const loginResult = await requestFollowRedirects(action, {
    method: 'POST',
    body: formData,
    cookies: loginPage.cookies,
    headers: {
      Accept: 'text/html',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: loginPage.url,
    },
    maxRedirects: 8,
  });

  const indexPage = await requestFollowRedirects(`${TC_BASE}/user/index`, {
    cookies: loginResult.cookies,
    headers: { Accept: 'text/html' },
    maxRedirects: 3,
  });

  const userId = parseUserIdFromHtml(indexPage.body);
  if (!userId) {
    if (isCredentialError(loginResult.body) || isCredentialError(indexPage.body)) {
      return { success: false, cookies: {}, session: null, error: 'TronClass CAS 帳號或密碼錯誤' };
    }

    const errMsgMatch = loginResult.body.match(
      /<span[^>]*id=["']error-message["'][^>]*>([\s\S]*?)<\/span>/i,
    );
    const keycloakErrorText = errMsgMatch?.[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? '';

    if (keycloakErrorText) {
      return { success: false, cookies: {}, session: null, error: `TronClass CAS：${keycloakErrorText}` };
    }

    if (indexPage.url.includes('identity.pu.edu.tw') || indexPage.body.includes('/auth/realms/pu')) {
      return { success: false, cookies: {}, session: null, error: 'TronClass CAS session 未建立' };
    }

    return { success: false, cookies: {}, session: null, error: 'TronClass CAS 登入失敗，無法取得使用者 ID' };
  }

  return {
    success: true,
    cookies: indexPage.cookies,
    session: {
      loggedIn: true,
      userId,
      userName: parseUserNameFromHtml(indexPage.body, uid),
    },
  };
}

/**
 * TronClass 登入（自動選擇策略）
 *
 * 1. 先嘗試原生 API 登入 /api/login（快速、穩定）
 * 2. 若原生 API 不可用、沒有拿到 cookie，fallback 到 Keycloak CAS
 * 3. 若兩者都失敗，回傳最後錯誤
 */
async function tcLogin(uid, password) {
  try {
    if (!uid || !password) {
      return { success: false, cookies: {}, session: null, error: '請輸入帳號密碼' };
    }

    // ── 策略 A：原生 API ──
    console.log('[tcLogin] Trying native API login…');
    try {
      const nativeResult = await tcLoginNativeApi(uid, password);
      if (nativeResult.success) {
        const hasCookies = nativeResult.cookies && Object.keys(nativeResult.cookies).length > 0;

        if (hasCookies) {
          console.log('[tcLogin] Native API login succeeded with cookies, userId:', nativeResult.session?.userId);

          if (!nativeResult.session?.userId) {
            const fallbackUserId = await tcEnsureUserId(nativeResult.cookies);
            if (fallbackUserId) {
              nativeResult.session.userId = fallbackUserId;
            }
          }
          return nativeResult;
        }

        // 原生 API 回傳 200 但沒有 cookie → session 無法持久化，改用 CAS
        console.warn('[tcLogin] Native API returned 200 but no cookies → falling through to CAS');
      } else {
        console.warn('[tcLogin] Native API failed:', nativeResult.error, '→ trying CAS…');
      }
    } catch (nativeErr) {
      console.warn('[tcLogin] Native API threw:', nativeErr?.message || nativeErr, '→ trying CAS…');
    }

    // ── 策略 B：Keycloak CAS（與 E 校園相同帳密，走 identity.pu.edu.tw） ──
    console.log('[tcLogin] Trying CAS login…');
    return await tcLoginCas(uid, password);
  } catch (error) {
    return {
      success: false,
      cookies: {},
      session: null,
      error: error instanceof Error ? error.message : 'TronClass 連線失敗',
    };
  }
}

async function tcFetchCourses(cookies, { userId, status = 'ongoing' } = {}) {
  const resolvedUserId = await tcEnsureUserId(cookies, userId);
  if (!resolvedUserId) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  const conditions = JSON.stringify({ status: [status] });
  const fields =
    'id,name,course_code,department(id,name),teachers(id,name,avatar_url),cover_image_url,student_count,status,role';
  const items = await tcFetchAllPages(
    `api/users/${resolvedUserId}/courses`,
    'courses',
    cookies,
    { conditions, fields },
    50,
  );

  return items.map((course) => ({
    id: course.id,
    name: course.name,
    course_code: course.course_code || '',
    department_name: course.department?.name ?? null,
    department_id: course.department?.id ?? null,
    status: course.status ?? status,
    role: course.role ?? 'student',
    teachers: course.teachers ?? [],
    cover_image_url: course.cover_image_url ?? null,
    student_count: course.student_count ?? 0,
  }));
}

async function tcFetchModules(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/modules`, cookies);
    const modules = data?.modules;
    if (Array.isArray(modules) && modules.length > 0) {
      return modules.map((module) => ({
        id: module.id,
        course_id: courseId,
        name: module.name ?? `Module ${module.sort ?? 0}`,
        sort: module.sort ?? 0,
        is_hidden: module.is_hidden ?? false,
        syllabuses: module.syllabuses ?? [],
      }));
    }
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
  }

  return [];
}

async function tcFetchActivities(cookies, courseId) {
  const activityData = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/activities?sub_course_id=0`, cookies)
    .catch(() => ({ activities: [] }));

  const homeworkData = await tcFetchAllPages(
    `api/courses/${courseId}/homework-activities`,
    'homework_activities',
    cookies,
    {},
    50,
  ).catch(() => []);

  const seen = new Set();
  const activities = [];
  for (const activity of [...(activityData.activities ?? []), ...homeworkData]) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    activities.push({
      id: activity.id,
      course_id: courseId,
      type: activity.type ?? 'material',
      title: activity.title ?? '',
      description: activity.data?.description ?? activity.description ?? null,
      start_time: activity.start_time ?? null,
      end_time: activity.end_time ?? null,
      score: activity.score ?? null,
      total_score: activity.total_score ?? null,
      status: activity.status ?? 'pending',
      weight: activity.weight ?? null,
    });
  }

  return activities;
}

async function tcFetchAttendance(cookies, { userId: _userId } = {}) {
  // All attendance endpoints (/api/users/{id}/attendances, /api/users/me/attendances, /api/attendance/summary)
  // currently return 404. Attendance data is not available via API.
  console.log('[TronClass] Attendance endpoints not available (404). Returning empty array.');
  return [];
}

async function tcFetchProfile(cookies, { userId } = {}) {
  const resolvedUserId = await tcEnsureUserId(cookies, userId);
  if (!resolvedUserId) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  // GET /api/users/{id} endpoint returns 403. Return constructed profile from known userId.
  return {
    id: resolvedUserId,
    name: '',
    login_name: '',
    email: null,
    avatar_url: null,
    role: 'student',
  };
}

async function tcFetchTodos(cookies) {
  const data = await tcFetchJson(`${TC_BASE}/api/todos`, cookies).catch((error) => {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return { todo_list: [] };
  });

  const items = data?.todo_list;
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    id: item.id,
    course_id: item.course_id ?? item.course?.id ?? 0,
    course_name: item.course_name ?? item.course?.name ?? '',
    type: item.type ?? 'homework',
    title: item.title ?? '',
    description: item.description ?? null,
    start_time: item.start_time ?? null,
    end_time: item.end_time ?? null,
    score: item.score ?? null,
    total_score: item.total_score ?? null,
    status: item.status ?? 'pending',
    weight: item.weight ?? null,
  }));
}

async function tcFetchCourseDetail(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}`, cookies);
    return data;
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return null;
  }
}

async function tcFetchExams(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/exams`, cookies);
    return data?.exams ?? [];
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return [];
  }
}

async function tcFetchScoreItems(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/score-items`, cookies);
    return data?.items ?? [];
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return [];
  }
}

async function tcFetchSelfScore(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/course/${courseId}/student-self-score`, cookies);
    return data?.self_score ?? null;
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return null;
  }
}

async function tcFetchHomeworkStatus(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/course/${courseId}/homework-student-status`, cookies);
    return data;
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return null;
  }
}

async function tcFetchHomeworkScores(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/course/${courseId}/homework-scores`, cookies);
    return data;
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return null;
  }
}

async function tcFetchExamStatus(cookies, courseId) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/course/${courseId}/exam-student-status`, cookies);
    return data;
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return null;
  }
}

async function tcFetchAnnouncements(cookies) {
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/announcement`, cookies);
    return data?.announcements ?? [];
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
    return [];
  }
}

module.exports = {
  tcLogin,
  tcFetchCourses,
  tcFetchModules,
  tcFetchActivities,
  tcFetchAttendance,
  tcFetchProfile,
  tcFetchTodos,
  tcFetchCourseDetail,
  tcFetchExams,
  tcFetchScoreItems,
  tcFetchSelfScore,
  tcFetchHomeworkStatus,
  tcFetchHomeworkScores,
  tcFetchExamStatus,
  tcFetchAnnouncements,
};
