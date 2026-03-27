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
  const resolvedUserId = await tcEnsureUserId(cookies, userId);
  if (!resolvedUserId) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  const conditions = JSON.stringify({ status: [status] });
  const fields =
    'id,name,course_code,department_id,semester_id,start_date,end_date,status,enroll_role,cover,teacher,student_count';
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
    department_id: course.department_id ?? null,
    semester_id: course.semester_id ?? null,
    start_date: course.start_date ?? null,
    end_date: course.end_date ?? null,
    status: course.status ?? status,
    role: course.enroll_role ?? 'student',
    teacher_name: course.teacher?.name ?? null,
    cover_image_url: course.cover?.url ?? null,
    student_count: course.student_count ?? 0,
  }));
}

async function tcFetchModules(cookies, courseId) {
  const endpoints = [
    `${TC_BASE}/api/courses/${courseId}/course-modules`,
    `${TC_BASE}/api/courses/${courseId}/modules`,
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await tcFetchJson(endpoint, cookies);
      if (Array.isArray(data) && data.length > 0) {
        return data.map((module) => ({
          id: module.id,
          course_id: courseId,
          title: module.title ?? `Module ${module.position ?? 0}`,
          description: module.description ?? null,
          position: module.position ?? 0,
          published: module.published !== false,
          activities: (module.activities ?? []).map((activity) => ({
            id: activity.id,
            course_id: courseId,
            type: activity.type ?? 'material',
            title: activity.title ?? '',
            description: activity.description ?? null,
            begin_date: activity.begin_date ?? null,
            end_date: activity.end_date ?? null,
            score: activity.score ?? null,
            total_score: activity.total_score ?? null,
            status: activity.status ?? 'pending',
            weight: activity.weight ?? null,
          })),
        }));
      }
    } catch (error) {
      if (endpoint === endpoints[endpoints.length - 1]) {
        throw error;
      }
    }
  }

  return [];
}

async function tcFetchActivities(cookies, courseId) {
  const activityData = await tcFetchJson(`${TC_BASE}/api/courses/${courseId}/activities`, cookies)
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
      description: activity.description ?? null,
      begin_date: activity.begin_date ?? null,
      end_date: activity.end_date ?? null,
      score: activity.score ?? null,
      total_score: activity.total_score ?? null,
      status: activity.status ?? 'pending',
      weight: activity.weight ?? null,
    });
  }

  return activities;
}

async function tcFetchAttendance(cookies, { userId } = {}) {
  const resolvedUserId = await tcEnsureUserId(cookies, userId);
  const endpoints = [
    resolvedUserId ? `${TC_BASE}/api/users/${resolvedUserId}/attendances` : null,
    `${TC_BASE}/api/users/me/attendances`,
    `${TC_BASE}/api/attendance/summary`,
  ].filter(Boolean);

  for (const endpoint of endpoints) {
    try {
      const data = await tcFetchJson(endpoint, cookies);
      const items = Array.isArray(data) ? data : data?.attendances;
      if (Array.isArray(items) && items.length > 0) {
        return items.map((attendance) => ({
          course_id: attendance.course_id ?? 0,
          course_name: attendance.course_name ?? '',
          total_sessions: attendance.total ?? attendance.total_sessions ?? 0,
          attended: attendance.attended ?? 0,
          absent: attendance.absent ?? 0,
          late: attendance.late ?? 0,
          leave: attendance.leave ?? 0,
          rate: attendance.rate ?? 0,
        }));
      }
    } catch (error) {
      if (String(error?.message || '').includes('session 已失效')) {
        throw error;
      }
    }
  }

  return [];
}

async function tcFetchProfile(cookies, { userId } = {}) {
  const resolvedUserId = await tcEnsureUserId(cookies, userId);
  if (!resolvedUserId) {
    throw new Error('TronClass session 已失效，請重新登入');
  }

  try {
    const profile = await tcFetchJson(`${TC_BASE}/api/users/${resolvedUserId}`, cookies);
    if (profile?.id) {
      return profile;
    }
  } catch (error) {
    if (String(error?.message || '').includes('session 已失效')) {
      throw error;
    }
  }

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
    type: item.type ?? 'homework',
    title: item.title ?? '',
    description: item.description ?? null,
    begin_date: item.begin_date ?? null,
    end_date: item.end_date ?? null,
    score: item.score ?? null,
    total_score: item.total_score ?? null,
    status: item.status ?? 'pending',
    weight: item.weight ?? null,
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
