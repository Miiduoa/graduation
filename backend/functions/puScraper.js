/**
 * Providence University (靜宜大學) e-Campus Scraper
 *
 * Verified against live pages on 2026-03-24:
 *   - Login:   POST https://alcat.pu.edu.tw/index_check.php
 *   - Courses: GET  https://alcat.pu.edu.tw/stu_query/query_course.html
 *   - Grades:  GET  https://mypu.pu.edu.tw/score_query/score_all.php  (different domain!)
 *
 * Course table columns (7):
 *   選課代號 | 上課班級 | 科目 | 修別 | 學分 | 上課時間地點 | 老師email
 *
 * Grade table columns (6):
 *   學期別 | 課程名稱 | 修課班級 | 修別 | 學分數 | 成績
 *
 * Time format example: "二(Tue)  3, 4:PH303"
 *   → dayOfWeek=2, periods=[3,4], location="PH303"
 */

const https = require('https');
const { parsePuGradeDocument, parseGradeSemesterCodes } = require('./lib/puGradeDocument');
const { buildDerivedCreditSummary } = require('./lib/puCreditSummary');
const { parsePuCourseTime } = require('./lib/puCourseTime');
const { taipeiDateKey } = require('./lib/taipeiDay');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALCAT_HOST = 'alcat.pu.edu.tw';
const MYPU_HOST = 'mypu.pu.edu.tw';
const LOGIN_PATH = '/index_check.php';
const COURSE_RESULT_PATH = '/stu_query/query_course.html';
const GRADE_PATH = '/score_query/score_all.php';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const CAMPUS_HOSTS = new Set([ALCAT_HOST, MYPU_HOST]);
/** 成績 SSO 整條（含單跳重試）須低於前端 45 秒讀取期限。 */
const GRADE_FETCH_BUDGET_MS = 40_000;
const MAX_TRANSIENT_HOP_RETRIES = 2;
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function parseCookies(setCookieHeaders, jar) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  headers.forEach((header) => {
    const pair = header.split(';')[0].trim();
    const idx = pair.indexOf('=');
    if (idx > 0) {
      jar[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
  });
}

function cookieString(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function campusErrorCode(error) {
  if (!error || typeof error !== 'object') return 'unknown';
  if (typeof error.code === 'string' && error.code.trim()) return error.code;
  if (typeof error.name === 'string' && error.name.trim()) return error.name;
  return 'unknown';
}

function isTransientCampusError(error) {
  const code = campusErrorCode(error);
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed out|ECONNRESET|interrupted/i.test(message);
}

function logGradeEvent(event, error) {
  console.warn(JSON.stringify({
    msg: 'pu_fetch_grades',
    event,
    code: campusErrorCode(error),
  }));
}

function hopTimeoutMs(deadlineAt) {
  if (deadlineAt == null) return REQUEST_TIMEOUT_MS;
  const leftover = deadlineAt - Date.now();
  if (leftover <= 0) {
    const error = new Error('Campus request timed out');
    error.code = 'ETIMEDOUT';
    throw error;
  }
  return Math.min(REQUEST_TIMEOUT_MS, leftover);
}

function httpsRequest(hostname, path, method, cookies, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!CAMPUS_HOSTS.has(hostname) || !path.startsWith('/') || path.startsWith('//')) {
      reject(new Error('Untrusted campus URL'));
      return;
    }
    const bodyBuf = body ? Buffer.from(body, 'utf8') : null;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    };
    if (bodyBuf) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = bodyBuf.length;
    }
    if (cookies && Object.keys(cookies).length) {
      headers.Cookie = cookieString(cookies);
    }

    let req;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      const error = new Error('Campus request timed out');
      error.code = 'ETIMEDOUT';
      finish(error);
      req?.destroy?.();
    }, timeoutMs);
    timer.unref?.();
    req = https.request({ hostname, path, method, headers, family: 4 }, (res) => {
      const chunks = [];
      let bytes = 0;
      const jar = { ...cookies };
      parseCookies(res.headers['set-cookie'], jar);

      res.on('error', error => finish(error));
      res.on('aborted', () => finish(new Error('Campus response interrupted')));
      res.on('data', (c) => {
        bytes += c.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          finish(new Error('Campus response is too large'));
          req?.destroy?.();
          return;
        }
        if (!settled) chunks.push(c);
      });
      res.on('end', () => {
        finish(null, {
          status: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks).toString('utf8'),
          cookies: jar,
        });
      });
    });
    req.on('error', error => finish(error));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// Convenience wrappers
function get(hostname, path, cookies, timeoutMs) {
  return httpsRequest(hostname, path, 'GET', cookies || {}, undefined, timeoutMs);
}
function post(hostname, path, cookies, body, timeoutMs) {
  return httpsRequest(hostname, path, 'POST', cookies || {}, body, timeoutMs);
}

async function requestHop(hostname, path, method, cookies, body, extra = {}) {
  const retries = extra.hopRetries || 0;
  const attempts = 1 + retries;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const timeoutMs = hopTimeoutMs(extra.deadlineAt);
      return method === 'POST'
        ? await post(hostname, path, cookies, body, timeoutMs)
        : await get(hostname, path, cookies, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isTransientCampusError(error) || attempt === attempts - 1) throw error;
      if (extra.deadlineAt != null && extra.deadlineAt - Date.now() <= 0) throw error;
    }
  }
  throw lastError;
}

function assertCampusUrl(url) {
  if (!CAMPUS_HOSTS.has(url.hostname) || !['https:', 'http:'].includes(url.protocol) ||
    url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Untrusted campus redirect');
  }
  url.protocol = 'https:';
}

async function requestFollowRedirect(hostname, path, cookies, {
  method = 'GET',
  body,
  maxRedirects = 3,
  hopRetries = 0,
  deadlineAt,
} = {}) {
  let current = new URL(path, `https://${hostname}/`);
  assertCampusUrl(current);
  let currentMethod = method;
  let currentBody = body;
  const hop = { hopRetries, deadlineAt };
  let res = await requestHop(
    current.hostname,
    current.pathname + current.search,
    currentMethod,
    cookies,
    currentBody,
    hop,
  );
  let redirects = 0;
  while ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
    if (redirects >= maxRedirects) throw new Error('Too many campus redirects');
    current = new URL(res.headers.location, current);
    assertCampusUrl(current);
    if (res.status !== 307 && res.status !== 308) {
      currentMethod = 'GET';
      currentBody = undefined;
    }
    res = await requestHop(
      current.hostname,
      current.pathname + current.search,
      currentMethod,
      res.cookies,
      currentBody,
      hop,
    );
    redirects++;
  }
  return { ...res, url: current.toString() };
}

// 僅在既有校務主機間跟隨轉址，不把登入 Cookie 送到其他網站。
function getFollowRedirect(hostname, path, cookies, maxRedirects = 3, extra = {}) {
  return requestFollowRedirect(hostname, path, cookies, { maxRedirects, ...extra });
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags from a string */
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an HTML table into an array of string arrays (rows × cells).
 * Picks the table whose header text matches `headerHint` (substring match).
 * Returns rows starting AFTER the header row(s).
 */
function parseTable(html, headerHint) {
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  let bestTable = null;
  for (const table of tables) {
    if (headerHint && !table.includes(headerHint)) continue;
    bestTable = table;
    break;
  }
  if (!bestTable && tables.length > 0) bestTable = tables[tables.length - 1];
  if (!bestTable) return [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const allRows = [];
  let m;
  while ((m = rowRegex.exec(bestTable)) !== null) {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let c;
    while ((c = cellRegex.exec(m[1])) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (cells.length > 0) allRows.push(cells);
  }

  return allRows;
}

function isPuCourseHeader(cells) {
  return cells.length >= 7 && /選課代號|課程代碼|course\s*code/i.test(cells[0]) &&
    /科目|課程|course/i.test(cells[2]) && /學分|credits?/i.test(cells[4]);
}

function puCourseRows(html) {
  for (const table of html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || []) {
    const rows = parseTable(table);
    const header = rows.findIndex(isPuCourseHeader);
    if (header >= 0) return rows.slice(header + 1);
  }
  return null;
}

function isPuEmptyCourseMessage(text) {
  return /^(?:本學期|該學期)?(?:尚未選課|(?:目前)?(?:尚無|查無|無)選課資料)[。.!！]?$/.test(
    text.replace(/\s+/g, ''),
  );
}

function hasPuEmptyCourseMessage(html) {
  // 只接受頁面上的明確無課文字，不把腳本中的空狀態文案當作校務結果。
  const visible = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  return visible.split(/<[^>]+>/).some(text => isPuEmptyCourseMessage(stripTags(text)));
}

function looksLikePuLoginPage(html) {
  const raw = String(html || '');
  const normalized = raw.toLowerCase();
  if (
    normalized.includes('action="index_check.php"') ||
    normalized.includes("action='index_check.php'") ||
    (normalized.includes('name="uid"') && normalized.includes('name="upassword"')) ||
    (normalized.includes("name='uid'") && normalized.includes("name='upassword'"))
  ) {
    return true;
  }
  const compact = raw.replace(/\s+/g, '');
  if (compact.includes('尚未登入') && (compact.includes('已逾時') || compact.includes('請重新登入'))) {
    return true;
  }
  return /not\s*yet\s*logged\s*in/i.test(raw);
}

const SCORE_BRIDGE_PATH = '/index_chkLogin.php?link=index_ToNewPlt.php?sysID=score_query';
const MYPU_REDIRECT_PATH = '/index_redirect_mypu.php';

function isMypuRedirectAction(url) {
  return url.hostname === MYPU_HOST && url.pathname === MYPU_REDIRECT_PATH;
}

function encodeFormFields(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** Parse the auto-submit POST form on alcat index_ToNewPlt.php. */
function parseCampusAutoPostForm(html, baseUrl) {
  const formMatch = String(html || '').match(/<form\b[^>]*>[\s\S]*?<\/form>/i);
  if (!formMatch) return null;
  const openTag = formMatch[0].match(/^<form\b[^>]*>/i)?.[0] || '';
  const method = (openTag.match(/\bmethod\s*=\s*["']([^"']+)["']/i)?.[1] || 'get').trim().toLowerCase();
  if (method !== 'post') return null;
  const actionRaw = (openTag.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] || '').replace(/&amp;/g, '&');
  let action;
  try {
    action = new URL(actionRaw, baseUrl);
  } catch {
    return null;
  }
  if (!CAMPUS_HOSTS.has(action.hostname) ||
    !['https:', 'http:'].includes(action.protocol) ||
    action.username || action.password || (action.port && action.port !== '443')) {
    return null;
  }
  action.protocol = 'https:';
  if (!isMypuRedirectAction(action)) return null;

  const fields = {};
  const inputRegex = /<input\b[^>]*>/gi;
  let input;
  while ((input = inputRegex.exec(formMatch[0])) !== null) {
    const tag = input[0];
    const type = (tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image' || type === 'file') continue;
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const value = tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    fields[name] = value.replace(/&amp;/g, '&');
  }
  return { action, fields };
}

function expiredSessionResult(kind) {
  const empty = kind === 'grades' ? { grades: [] } : { courses: [] };
  return {
    success: false,
    code: 'session-expired',
    ...empty,
    error: 'E校園 session 已失效，請重新登入',
  };
}

function cookieJar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || /[\s;=\r\n]/.test(key) || typeof item !== 'string' || /[;\r\n]/.test(item)) {
      return null;
    }
    if (item) next[key] = item;
  }
  return Object.keys(next).length ? next : null;
}

async function fetchMypuScoreAll(mypuCookies, semester, extra = {}) {
  const gradeRes = await getFollowRedirect(MYPU_HOST, GRADE_PATH, mypuCookies || {}, 3, extra);
  if (gradeRes.status !== 200) throw new Error(`HTTP ${gradeRes.status}`);
  const cookies = cookieJar(gradeRes.cookies) || cookieJar(mypuCookies);
  if (looksLikePuLoginPage(gradeRes.data)) {
    return { loginPage: true, cookies };
  }
  return {
    loginPage: false,
    cookies,
    parsed: parsePuGradeDocument(gradeRes.data, semester),
  };
}

function hasPuStudentContext(html) {
  const text = String(html || '');
  return (
    text.includes('學號(Student No.)') ||
    text.includes('姓名(Student Name)') ||
    text.includes('Student No.') ||
    text.includes('query_course')
  );
}

function normalizePuUrl(href) {
  return new URL(String(href || ''), `https://${ALCAT_HOST}/`).toString();
}

function isUsefulAnnouncementLink(title, href, hasDate) {
  if (!title || title.length < 4) return false;
  if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return false;
  if (/index_check\.php|logout/i.test(href)) return false;
  if (!hasDate && title.length < 8) return false;
  return true;
}

function pushUniqueAnnouncement(target, seen, announcement) {
  const key = `${announcement.title}::${announcement.url}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(announcement);
}

/**
 * Parse course name: "計算機概論(二)INTRODUCTION TO COMPUTER SCIENCE(2)"
 * Returns { zhName, enName }
 */
function parseCourseTitle(raw) {
  // Try to split at the boundary between Chinese and Latin characters
  const boundary = raw.search(/[A-Z]/);
  if (boundary > 0) {
    return {
      zhName: raw.slice(0, boundary).trim(),
      enName: raw.slice(boundary).trim(),
    };
  }
  return { zhName: raw.trim(), enName: '' };
}

/**
 * Extract teacher name from teacher email.
 * e.g., "changyi@pu.edu.tw" → "changyi"
 */
function extractTeacherName(email) {
  if (!email) return '';
  const match = email.match(/^([^@]+)@/);
  return match ? match[1] : email;
}

/**
 * Parse class name to extract department and grade.
 * e.g., "資管三A" → { department: "資管系", grade: "三年級" }
 */
function parseClassInfo(className) {
  if (!className) return { department: null, grade: null };

  // Match pattern: 系名 + 年級(one or two Chinese characters) + optional suffix
  // Examples: "資管三A", "會計四甲", "英文二"
  const match = className.match(
    /^([^\d\w一二三四五六七八九\u4e00-\u9fff]*[\u4e00-\u9fff]+?)([一二三四五六七八九])(.*)$/,
  );

  if (match) {
    let department = match[1];
    const gradeChar = match[2];

    // Normalize department name
    if (department && !department.includes('系')) {
      department += '系';
    }

    // Map grade character to year
    const gradeMap = {
      一: '一年級',
      二: '二年級',
      三: '三年級',
      四: '四年級',
      五: '五年級',
      六: '六年級',
    };
    const grade = gradeMap[gradeChar] || null;

    return { department, grade };
  }

  return { department: null, grade: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Login to PU e-campus
 * @param {string} uid - Student account
 * @param {string} upassword - Password
 * @returns {Promise<{success: boolean, cookies: object, studentName?: string, error?: string}>}
 */
async function puLogin(uid, upassword) {
  try {
    if (!uid || !upassword) throw new Error('Missing uid or upassword');

    const warmup = await get(ALCAT_HOST, '/', {});
    const body = `uid=${encodeURIComponent(uid)}&upassword=${encodeURIComponent(upassword)}&en_flag=zh`;
    const res = await post(ALCAT_HOST, LOGIN_PATH, warmup.cookies, body);

    // Check for known error patterns
    if (
      res.data.includes('帳號或密碼錯誤') ||
      res.data.includes('login_fail') ||
      res.data.includes('Login Failed') ||
      res.data.includes('密碼錯誤')
    ) {
      return { success: false, cookies: {}, error: '帳號或密碼錯誤' };
    }

    if (res.status !== 200 && res.status !== 302) {
      return { success: false, cookies: {}, error: `HTTP ${res.status}` };
    }

    let cookies = res.cookies;
    if (res.status === 302 && res.headers.location) {
      const followUp = await getFollowRedirect(ALCAT_HOST, res.headers.location, cookies);
      cookies = followUp.cookies;
    }

    const verify = await getFollowRedirect(ALCAT_HOST, COURSE_RESULT_PATH, cookies);
    if (
      verify.status !== 200 ||
      looksLikePuLoginPage(verify.data) ||
      !hasPuStudentContext(verify.data)
    ) {
      return {
        success: false,
        cookies: {},
        error: '無法驗證 E校園 登入狀態',
      };
    }

    const nameMatch =
      verify.data.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/) ||
      verify.data.match(/([^\s<]+)同學您好/) ||
      res.data.match(/([^\s<]+)同學您好/);

    return {
      success: true,
      cookies: verify.cookies,
      studentName: nameMatch ? nameMatch[1] : undefined,
    };
  } catch (err) {
    console.error('[puLogin] Error:', err);
    return { success: false, cookies: {}, error: err.message };
  }
}

/**
 * Fetch course schedule.
 *
 * URL flow: /stu_query/query_index.html → /stu_query/query_course.html
 * The query_course.html page is loaded directly (no extra form submit needed).
 *
 * @param {object} cookies - Session cookies from puLogin
 * @param {string} [semester] - e.g. "1142" (optional, defaults to current)
 * @returns {Promise<{success, courses, studentInfo, semester, totalCredits, error}>}
 */
async function puFetchCourses(cookies, semester) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    // Go directly to the course result page
    const res = await getFollowRedirect(ALCAT_HOST, COURSE_RESULT_PATH, cookies);

    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;
    if (looksLikePuLoginPage(html) || !hasPuStudentContext(html)) {
      return expiredSessionResult('courses');
    }

    // ---- Extract student info ----
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);
    const creditsMatch = html.match(/學期總學分[：:]\s*(\d+(?:\.\d+)?)/);

    const studentInfo = {
      class: classMatch ? classMatch[1] : null,
      studentId: idMatch ? idMatch[1] : null,
      name: nameMatch ? nameMatch[1] : null,
    };

    const detectedSemester = semMatch ? `${semMatch[1]}${semMatch[2]}` : semester || null;
    const totalCredits = creditsMatch ? Number(creditsMatch[1]) : 0;

    // ---- Parse course table ----
    const rows = puCourseRows(html);
    if (rows === null && !hasPuEmptyCourseMessage(html)) {
      throw new Error('Unrecognized course table; document may have changed');
    }
    const dataRows = (rows || []).filter(cells => cells.some(Boolean) &&
      !isPuCourseHeader(cells) && !isPuEmptyCourseMessage(cells.join(' ')));

    const courses = [];
    for (const cells of dataRows) {
      if (cells.length < 7) continue;

      const code = cells[0];
      const classOffered = cells[1];
      const titleRaw = cells[2];
      const courseType = cells[3];
      const credits = /^\d+(?:\.\d+)?$/.test(cells[4]) ? Number(cells[4]) : null;
      if (!code || !titleRaw || credits === null) continue;
      const timePlaceRaw = cells[5];
      const teacherEmail = cells[6];

      const { zhName, enName } = parseCourseTitle(titleRaw);
      const tp = parsePuCourseTime(timePlaceRaw);
      const teacherName = extractTeacherName(teacherEmail);

      courses.push({
        code,
        classOffered,
        name: zhName,
        nameEn: enName,
        courseType,
        credits,
        dayOfWeek: tp ? tp.dayOfWeek : null,
        periods: tp ? tp.periods : [],
        startTime: tp ? tp.startTime : null,
        endTime: tp ? tp.endTime : null,
        location: tp ? tp.location : '',
        timePlaceRaw,
        teacherEmail,
        teacherName,
      });
    }

    if (dataRows.length > 0 && courses.length === 0) {
      throw new Error('No recognizable course rows; document may have changed');
    }

    return {
      success: true,
      courses,
      studentInfo,
      semester: detectedSemester,
      totalCredits,
    };
  } catch (err) {
    console.error('[puFetchCourses] Error:', err);
    return { success: false, courses: [], error: err.message };
  }
}

/**
 * Fetch historical grades. Parse both direct and SSO bridge pages with
 * the same tested parser. No guessed semester codes or synthetic grades.
 */
async function puFetchGrades(cookies, semester, options = {}) {
  const deadlineAt = Date.now() + GRADE_FETCH_BUDGET_MS;
  const hopOpts = { hopRetries: MAX_TRANSIENT_HOP_RETRIES, deadlineAt };
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    // alcat /score_query/score_all.php 已 404。改走現行 SSO：
    // chkLogin → index_ToNewPlt.php 自動 POST → mypu index_redirect_mypu.php → score_all.php。
    // 課表仍走 alcat query_course.html，不經這條轉接。
    // mypu cookie 與 alcat cookie 分開保存，避免同名 PHPSESSID 互相覆蓋。
    // 帳密 POST 不在這條路徑；暫時性錯誤只重試該跳。
    const storedMypu = cookieJar(options.mypuCookies);
    if (storedMypu) {
      try {
        const cached = await fetchMypuScoreAll(storedMypu, semester, hopOpts);
        if (!cached.loginPage) {
          const parsed = cached.parsed;
          if (parsed) return { ...parsed, mypuCookies: cached.cookies };
        }
      } catch (error) {
        logGradeEvent('stored_mypu_failed', error);
      }
    }

    let mypuCookies = {};
    let usableBridge = null;
    let bridgeTransient = false;

    try {
      const hop = await getFollowRedirect(ALCAT_HOST, SCORE_BRIDGE_PATH, cookies, 5, hopOpts);
      if (looksLikePuLoginPage(hop.data)) return expiredSessionResult('grades');
      if (hop.status === 200) {
        const parsedHop = parsePuGradeDocument(hop.data, semester);
        if (parsedHop.success) {
          usableBridge = parsedHop;
          if (parsedHop.allSemesters.length > 1) return { ...parsedHop, mypuCookies: cookieJar(mypuCookies) };
        }
      }
      const form = parseCampusAutoPostForm(hop.data, hop.url || `https://${ALCAT_HOST}/`);
      if (form) {
        const posted = await requestFollowRedirect(
          form.action.hostname,
          form.action.pathname + form.action.search,
          {},
          { method: 'POST', body: encodeFormFields(form.fields), maxRedirects: 5, ...hopOpts },
        );
        mypuCookies = cookieJar(posted.cookies) || {};
        if (looksLikePuLoginPage(posted.data)) return expiredSessionResult('grades');
        if (posted.status === 200) {
          const parsedPost = parsePuGradeDocument(posted.data, semester);
          if (parsedPost.success) {
            usableBridge = parsedPost;
            if (parsedPost.allSemesters.length > 1) {
              return { ...parsedPost, mypuCookies: cookieJar(mypuCookies) };
            }
          }
        }
      }
    } catch (e) {
      logGradeEvent('score_sso_bridge_failed', e);
      bridgeTransient = isTransientCampusError(e);
    }

    // Keep a valid single-semester bridge result if mypu is unavailable.
    try {
      if (!Object.keys(mypuCookies).length && bridgeTransient) {
        return { success: false, grades: [] };
      }
      const gradeRes = await fetchMypuScoreAll(mypuCookies, semester, hopOpts);
      if (gradeRes.loginPage) {
        if (usableBridge) return { ...usableBridge, mypuCookies: gradeRes.cookies };
        if (bridgeTransient && !Object.keys(mypuCookies).length) {
          return { success: false, grades: [] };
        }
        return expiredSessionResult('grades');
      }
      const parsed = gradeRes.parsed;
      const nextCookies = gradeRes.cookies;
      return parsed.success
        ? { ...parsed, mypuCookies: nextCookies }
        : { ...(usableBridge || parsed), mypuCookies: nextCookies };
    } catch (error) {
      if (usableBridge) return { ...usableBridge, mypuCookies: cookieJar(mypuCookies) };
      if (bridgeTransient) return { success: false, grades: [] };
      throw error;
    }
  } catch (err) {
    logGradeEvent('grades_failed', err);
    return { success: false, grades: [] };
  }
}

/**
 * Extract date from HTML context near a link.
 * Tries multiple date patterns: YYYY-MM-DD, ROC year format (YY-MM-DD).
 * Falls back to today's date if no date found.
 */
function extractDateFromContext(html, linkStartPos) {
  if (!html || linkStartPos < 0) return taipeiDateKey();

  // Look in a window around the link (200 chars before and after)
  const start = Math.max(0, linkStartPos - 200);
  const end = Math.min(html.length, linkStartPos + 200);
  const context = html.substring(start, end);

  // Try AD year format first: YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD
  let match = context.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Try ROC year format: YY/MM/DD, YY-MM-DD (add 1911 to ROC year)
  match = context.match(/(\d{2,3})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (match) {
    const rocYear = parseInt(match[1], 10);
    const adYear = rocYear + 1911;
    const month = String(match[2]).padStart(2, '0');
    const day = String(match[3]).padStart(2, '0');
    return `${adYear}-${month}-${day}`;
  }

  // Fallback to today
  return taipeiDateKey();
}

function extractAnnouncementsFromHtml(html) {
  const announcements = [];
  const seen = new Set();
  const today = taipeiDateKey();

  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[0];
    const rowText = stripTags(rowHtml);
    const date = extractDateFromContext(rowText, 0) || extractDateFromContext(rowHtml, 0);
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;

    while ((linkMatch = linkRegex.exec(rowHtml)) !== null) {
      const href = linkMatch[1]?.trim() || '';
      const title = stripTags(linkMatch[2] || '');
      if (!isUsefulAnnouncementLink(title, href, Boolean(date))) continue;

      pushUniqueAnnouncement(announcements, seen, {
        title,
        url: normalizePuUrl(href),
        date: date || today,
        category: 'system',
      });
    }
  }

  if (announcements.length > 0) {
    return announcements;
  }

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1]?.trim() || '';
    const title = stripTags(match[2] || '');
    const date = extractDateFromContext(html, match.index);
    if (!isUsefulAnnouncementLink(title, href, Boolean(date))) continue;

    pushUniqueAnnouncement(announcements, seen, {
      title,
      url: normalizePuUrl(href),
      date: date || today,
      category: 'system',
    });
  }

  return announcements;
}

/**
 * Fetch announcements from the logged-in e-campus main menu.
 * The menu page at /index_menu.php shows "目前開放中的系統" which
 * contains system-level announcements.
 *
 * @param {object} cookies
 * @returns {Promise<{success, announcements, error}>}
 */
async function puFetchAnnouncements(cookies) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    const res = await getFollowRedirect(ALCAT_HOST, '/index_menu.php', cookies);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;
    if (looksLikePuLoginPage(html)) {
      return { success: false, announcements: [], error: 'E校園 session 已失效，請重新登入' };
    }

    return { success: true, announcements: extractAnnouncementsFromHtml(html) };
  } catch (err) {
    console.error('[puFetchAnnouncements] Error:', err);
    return { success: false, announcements: [], error: err.message };
  }
}

/**
 * Fetch absence/attendance records.
 *
 * URL: https://alcat.pu.edu.tw/stu_query/query_absence.html
 *
 * @param {object} cookies - Session cookies from puLogin
 * @returns {Promise<{success, absences, error}>}
 */
async function puFetchAbsence(cookies) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    const res = await getFollowRedirect(ALCAT_HOST, '/stu_query/query_absence.html', cookies);

    // Gracefully return empty array if page doesn't exist or user doesn't have access
    if (res.status === 404 || res.status === 403) {
      return { success: true, absences: [] };
    }

    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;
    const absences = [];

    // Parse absence records table
    // Expected columns: date | courseName | period | absenceType | status
    const rows = parseTable(html, 'absence');

    // Skip header row
    for (const cells of rows) {
      if (cells.length < 5) continue;
      if (cells[0].includes('date') || cells[0].includes('日期') || cells[0].includes('course')) {
        continue;
      }

      const date = cells[0];
      const courseName = cells[1];
      const period = cells[2];
      const absenceType = cells[3];
      const status = cells[4];

      absences.push({
        date,
        courseName,
        period,
        absenceType,
        status,
      });
    }

    return { success: true, absences };
  } catch (err) {
    console.error('[puFetchAbsence] Error:', err);
    return { success: true, absences: [] };
  }
}

/**
 * Compute credit summary from grade data.
 *
 * Note: The dedicated credit page (/stu_query/query_credit.html) does NOT exist
 * on alcat.pu.edu.tw. Instead, we derive credit info from grade records.
 *
 * @param {object} cookies - Session cookies from puLogin
 * @returns {Promise<{success, creditSummary, error}>}
 */
async function puFetchCreditSummary(cookies) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');
    // A derived grade summary is not a verified graduation credit audit.
    return buildDerivedCreditSummary(await puFetchGrades(cookies));
  } catch (err) {
    console.error('[puFetchCreditSummary] Error:', err);
    return { success: false, creditSummary: null, error: err.message };
  }
}

/**
 * Fetch student profile info from the course query page.
 * (The course page contains: class, student ID, name)
 *
 * @param {object} cookies
 * @returns {Promise<{success, studentInfo, error}>}
 */
async function puFetchStudentInfo(cookies) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    const res = await getFollowRedirect(ALCAT_HOST, COURSE_RESULT_PATH, cookies);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;
    if (looksLikePuLoginPage(html) || !hasPuStudentContext(html)) {
      return { success: false, studentInfo: {}, error: 'E校園 session 已失效，請重新登入' };
    }

    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);

    const className = classMatch ? classMatch[1] : null;
    const { department, grade } = parseClassInfo(className);

    return {
      success: true,
      studentInfo: {
        studentId: idMatch ? idMatch[1] : null,
        name: nameMatch ? nameMatch[1] : null,
        class: className,
        department,
        grade,
        currentSemester: semMatch ? `${semMatch[1]}${semMatch[2]}` : null,
      },
    };
  } catch (err) {
    console.error('[puFetchStudentInfo] Error:', err);
    return { success: false, studentInfo: {}, error: err.message };
  }
}

// Legacy credit-audit URL discovery was removed: it was not exported,
// contained unresolved parser references, and could not produce verified
// graduation eligibility from the available academic records.

module.exports = {
  puLogin,
  puFetchCourses,
  puFetchGrades,
  puFetchAnnouncements,
  puFetchStudentInfo,
  puFetchAbsence,
  puFetchCreditSummary,
  parseGradeSemesterCodes,
  looksLikePuLoginPage,
  parseCampusAutoPostForm,
  isTransientCampusError,
  SCORE_BRIDGE_PATH,
  MAX_TRANSIENT_HOP_RETRIES,
  GRADE_FETCH_BUDGET_MS,
};
