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
  const userIdMatch =
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
  return (
    body.includes('密碼錯誤') ||
    body.includes('Invalid') ||
    body.includes('error') ||
    body.includes('帳號或密碼')
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

async function tcLogin(uid, password) {
  try {
    if (!uid || !password) {
      return { success: false, cookies: {}, session: null, error: '請輸入帳號密碼' };
    }

    const loginPage = await requestFollowRedirects(TC_LOGIN_ENTRY_URL, {
      headers: {
        Accept: 'text/html',
      },
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
      headers: {
        Accept: 'text/html',
      },
      maxRedirects: 3,
    });

    const userId = parseUserIdFromHtml(indexPage.body);
    if (!userId) {
      if (isCredentialError(loginResult.body) || isCredentialError(indexPage.body)) {
        return { success: false, cookies: {}, session: null, error: 'TronClass 帳號或密碼錯誤' };
      }

      return {
        success: false,
        cookies: {},
        session: null,
        error: 'TronClass 登入失敗，無法取得使用者 ID',
      };
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
  // 2026-04: Use POST /api/my-courses (confirmed working endpoint)
  const body = JSON.stringify({
    conditions: { status: [status] },
    page: 1,
    page_size: 200,
  });

  const result = await httpsRequest(`${TC_BASE}/api/my-courses`, {
    method: 'POST',
    body,
    cookies,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (result.status !== 200) {
    throw new Error(`HTTP ${result.status}`);
  }
  if (result.body.trimStart().startsWith('<')) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  const data = JSON.parse(result.body);
  const courses = data.courses ?? [];

  return courses.map((course) => ({
    id: course.id,
    name: course.name,
    course_code: course.course_code || '',
    department_id: course.department?.id ?? null,
    department_name: course.department?.name ?? null,
    semester_id: course.semester?.id ?? null,
    semester_name: course.semester?.name ?? null,
    academic_year: course.academic_year?.name ?? null,
    start_date: course.start_date ?? null,
    end_date: course.end_date ?? null,
    status: course.status ?? status,
    role: 'student',
    teacher_name: course.instructors?.[0]?.name ?? null,
    cover_image_url: course.cover || null,
    student_count: course.course_attributes?.student_count ?? 0,
    credit: parseFloat(String(course.credit ?? '0')) || 0,
    compulsory: course.compulsory ?? false,
    grade_name: course.grade?.name ?? null,
    klass_name: course.klass?.name ?? null,
    instructors: (course.instructors ?? []).map((i) => ({ id: i.id, name: i.name })),
  }));
}

async function tcFetchModules(cookies, courseId) {
  // 2026-04: GET /api/courses/{id}/modules → { modules: [...] }
  try {
    const data = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/modules`, cookies);
    const modules = data?.modules ?? [];
    return modules
      .filter((m) => m.is_hidden !== 1)
      .map((module) => ({
        id: module.id,
        course_id: courseId,
        title: module.name ?? `Module ${module.sort ?? 0}`,
        description: null,
        position: module.sort ?? 0,
        published: true,
        activities: [],
      }));
  } catch (error) {
    console.warn(`[TronClass] tcFetchModules(${courseId}) error:`, error.message);
    return [];
  }
}

async function tcFetchActivities(cookies, courseId) {
  // 2026-04: GET /api/courses/{id}/activities?sub_course_id=0 + /api/courses/{id}/exams
  const activityData = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/activities?sub_course_id=0`, cookies)
    .catch(() => ({ activities: [] }));

  const examData = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/exams`, cookies)
    .catch(() => ({ exams: [] }));

  const seen = new Set();
  const activities = [];

  for (const activity of (activityData.activities ?? [])) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    activities.push({
      id: activity.id,
      course_id: courseId,
      type: activity.type ?? 'material',
      title: activity.title ?? '',
      description: activity.data?.description ?? null,
      begin_date: activity.start_time ?? null,
      end_date: activity.end_time ?? null,
      score: activity.score ?? null,
      total_score: null,
      status: 'pending',
      weight: activity.score_percentage ? parseFloat(activity.score_percentage) : null,
      module_id: activity.module_id ?? null,
      completion_criterion: activity.completion_criterion_key ?? null,
    });
  }

  for (const exam of (examData.exams ?? [])) {
    if (seen.has(exam.id)) continue;
    seen.add(exam.id);
    activities.push({
      id: exam.id,
      course_id: courseId,
      type: 'exam',
      title: exam.title ?? '',
      description: null,
      begin_date: exam.start_time ?? null,
      end_date: exam.end_time ?? null,
      score: exam.score ?? null,
      total_score: exam.total_score ?? null,
      status: 'pending',
      weight: null,
      module_id: exam.module_id ?? null,
      completion_criterion: null,
    });
  }

  return activities;
}

async function tcFetchAttendance(cookies, { userId } = {}) {
  // 2026-04: Use per-course rollcall endpoints
  // First fetch all ongoing courses, then get rollcall-score for each
  let courses;
  try {
    courses = await tcFetchCourses(cookies, { userId, status: 'ongoing' });
  } catch (error) {
    console.warn('[TronClass] tcFetchAttendance: Failed to fetch courses:', error.message);
    return [];
  }

  const results = [];
  for (const course of courses) {
    try {
      const rollcallScore = await tcFetchJson(`${TC_BASE}/api/course/${course.id}/rollcall-score`, cookies);
      if (rollcallScore) {
        const totalSessions = rollcallScore.rollcall_count ?? 0;
        const attended = rollcallScore.rollcall_times ?? 0;
        const rate = totalSessions > 0
          ? parseFloat(rollcallScore.score_percentage ?? '0')
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
    } catch (error) {
      // Skip individual course errors
      console.warn(`[TronClass] tcFetchAttendance: Rollcall error for course ${course.id}:`, error.message);
    }
  }

  return results;
}

async function tcFetchProfile(cookies, { userId } = {}) {
  const resolvedUserId = await tcEnsureUserId(cookies, userId);
  if (!resolvedUserId) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  // No direct profile API available; return basic info from userId
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
    course_id: item.course_id ?? 0,
    type: item.type ?? 'homework',
    title: item.title ?? '',
    description: item.course_name ?? null,
    begin_date: item.start_time ?? null,
    end_date: item.end_time ?? null,
    score: null,
    total_score: null,
    status: item.is_locked ? 'locked' : 'pending',
    weight: null,
    module_id: null,
    completion_criterion: null,
  }));
}

module.exports = {
  tcLogin,
  tcFetchCourses,
  tcFetchModules,
  tcFetchActivities,
  tcFetchAttendance,
  tcFetchProfile,
  tcFetchTodos,
};
