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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALCAT_HOST = 'alcat.pu.edu.tw';
const MYPU_HOST = 'mypu.pu.edu.tw';
const LOGIN_PATH = '/index_check.php';
const COURSE_RESULT_PATH = '/stu_query/query_course.html';
const GRADE_PATH = '/score_query/score_all.php';
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

function httpsRequest(hostname, path, method, cookies, body) {
  return new Promise((resolve, reject) => {
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

    const req = https.request({ hostname, path, method, headers }, (res) => {
      const chunks = [];
      const jar = { ...cookies };
      parseCookies(res.headers['set-cookie'], jar);

      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks).toString('utf8'),
          cookies: jar,
        });
      });
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// Convenience wrappers
function get(hostname, path, cookies) {
  return httpsRequest(hostname, path, 'GET', cookies || {});
}
function post(hostname, path, cookies, body) {
  return httpsRequest(hostname, path, 'POST', cookies || {}, body);
}

// Follow 302 redirects (some PU pages redirect)
async function getFollowRedirect(hostname, path, cookies, maxRedirects = 3) {
  let res = await get(hostname, path, cookies);
  let redirects = 0;
  while (
    (res.status === 301 || res.status === 302) &&
    res.headers.location &&
    redirects < maxRedirects
  ) {
    const loc = res.headers.location;
    const url = new URL(loc, `https://${hostname}`);
    hostname = url.hostname;
    path = url.pathname + url.search;
    res = await get(hostname, path, res.cookies);
    redirects++;
  }
  return res;
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

function looksLikePuLoginPage(html) {
  const normalized = String(html || '').toLowerCase();
  return (
    normalized.includes('action="index_check.php"') ||
    normalized.includes("action='index_check.php'") ||
    (normalized.includes('name="uid"') && normalized.includes('name="upassword"')) ||
    (normalized.includes("name='uid'") && normalized.includes("name='upassword'"))
  );
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
      cookies,
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
      return { success: false, code: 'session-expired', courses: [], error: 'E校園 session 已失效，請重新登入' };
    }

    // ---- Extract student info ----
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);
    const creditsMatch = html.match(/學期總學分[：:]\s*(\d+)/);

    const studentInfo = {
      class: classMatch ? classMatch[1] : null,
      studentId: idMatch ? idMatch[1] : null,
      name: nameMatch ? nameMatch[1] : null,
    };

    const detectedSemester = semMatch ? `${semMatch[1]}${semMatch[2]}` : semester || null;
    const totalCredits = creditsMatch ? parseInt(creditsMatch[1], 10) : 0;

    // ---- Parse course table ----
    const rows = parseTable(html, 'course code');

    // Skip header row (first row with "選課代號")
    const courses = [];
    for (const cells of rows) {
      if (cells.length < 7) continue;
      if (cells[0].includes('course code') || cells[0].includes('選課代號')) continue;

      const code = cells[0];
      const classOffered = cells[1];
      const titleRaw = cells[2];
      const courseType = cells[3];
      const credits = parseInt(cells[4], 10) || 0;
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
async function puFetchGrades(cookies, semester) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    // 優先用 alcat（和登入同 domain，cookie 確定能用），
    // 若失敗或內容太短再試 mypu（不同 domain，cookie 可能無法共享）。
    let res = await getFollowRedirect(ALCAT_HOST, '/stu_query/score_all.php', cookies);
    if (res.status !== 200 || res.data.length < 200) {
      console.log('[puFetchGrades] alcat fallback to mypu…');
      res = await getFollowRedirect(MYPU_HOST, GRADE_PATH, cookies);
    }

    // ── Step 1: Establish mypu session (fallback) ──
    // alcat and mypu are on different subdomains of pu.edu.tw.
    // We try multiple approaches to establish a valid mypu session:
    //   A) Direct: send alcat cookies to mypu root (may share parent domain cookies)
    //   B) SSO bridge: visit alcat's link to mypu (follows SSO redirect chain)
    let mypuCookies = { ...cookies };

    // Approach A: warm up mypu directly
    try {
      const warmup = await get(MYPU_HOST, '/', cookies);
      mypuCookies = { ...cookies, ...warmup.cookies };
      console.log('[puFetchGrades] mypu warmup status:', warmup.status, 'cookies:', Object.keys(mypuCookies).length);
    } catch (e) {
      console.warn('[puFetchGrades] mypu warmup failed (non-fatal):', e.message);
    }

    // Approach B: Try SSO bridge URLs from alcat → mypu
    const bridgePaths = [
      '/score_query/score_all.php',          // alcat might proxy to mypu
      '/index_menu.php',                      // menu page might set cross-domain session
    ];
    for (const bp of bridgePaths) {
      try {
        const bridgeRes = await getFollowRedirect(ALCAT_HOST, bp, cookies);
        if (bridgeRes.cookies && Object.keys(bridgeRes.cookies).length > Object.keys(mypuCookies).length) {
          mypuCookies = { ...mypuCookies, ...bridgeRes.cookies };
          console.log(`[puFetchGrades] Bridge ${bp} added cookies:`, Object.keys(bridgeRes.cookies).length);
        }
        // If alcat's score page actually returns grade data directly, use it
        if (bp.includes('score') && bridgeRes.status === 200) {
          const bridgeParsed = parsePuGradeDocument(bridgeRes.data, semester);
          if (bridgeParsed.success && bridgeParsed.allSemesters.length > 1) {
            // The bridge already returned a recognized multi-semester document.
            return bridgeParsed;
          }
        }
      } catch (e) {
        console.warn(`[puFetchGrades] Bridge ${bp} failed:`, e.message);
      }
    }

    // ── Step 2: Fetch the grade page ──
    // 改名為 gradeRes 避開 function 上方 L658 已有的 `let res`（同 scope 重複宣告 → parse error）
    const gradeRes = await getFollowRedirect(MYPU_HOST, GRADE_PATH, mypuCookies);
    if (gradeRes.status !== 200) throw new Error(`HTTP ${gradeRes.status}`);

    const html = gradeRes.data;
    if (looksLikePuLoginPage(html)) {
      return { success: false, code: 'session-expired', grades: [], error: 'E校園 session 已失效，請重新登入' };
    }

    return parsePuGradeDocument(html, semester);
  } catch (err) {
    console.error('[puFetchGrades] Error:', err);
    return { success: false, grades: [], error: err.message };
  }
}

/**
 * Extract date from HTML context near a link.
 * Tries multiple date patterns: YYYY-MM-DD, ROC year format (YY-MM-DD).
 * Falls back to today's date if no date found.
 */
function extractDateFromContext(html, linkStartPos) {
  if (!html || linkStartPos < 0) return new Date().toISOString().split('T')[0];

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
  return new Date().toISOString().split('T')[0];
}

function extractAnnouncementsFromHtml(html) {
  const announcements = [];
  const seen = new Set();
  const today = new Date().toISOString().split('T')[0];

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
};
