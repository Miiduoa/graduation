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
 * Time format example: "二(Tue)　 3, 4:PH303"
 *   → dayOfWeek=2, periods=[3,4], location="PH303"
 */

const https = require('https');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALCAT_HOST = 'alcat.pu.edu.tw';
const MYPU_HOST = 'mypu.pu.edu.tw';
const LOGIN_PATH = '/index_check.php';
const COURSE_INDEX_PATH = '/stu_query/query_index.html';
const COURSE_RESULT_PATH = '/stu_query/query_course.html';
const GRADE_PATH = '/score_query/score_all.php';

/** 靜宜大學節次 → 時間對照表 (verified from official schedule) */
const PERIOD_TIME_MAP = {
  1: { start: '08:10', end: '09:00' },
  2: { start: '09:10', end: '10:00' },
  3: { start: '10:10', end: '11:00' },
  4: { start: '11:10', end: '12:00' },
  5: { start: '13:10', end: '14:00' },
  6: { start: '14:10', end: '15:00' },
  7: { start: '15:10', end: '16:00' },
  8: { start: '16:10', end: '17:00' },
  9: { start: '17:10', end: '18:00' },
  10: { start: '18:30', end: '19:20' },
  11: { start: '19:25', end: '20:15' },
  12: { start: '20:20', end: '21:10' },
  13: { start: '21:15', end: '22:05' },
};

/** 中文星期 → dayOfWeek number */
const DAY_MAP = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7,
  'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6, 'Sun': 7,
};

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
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function httpsRequest(hostname, path, method, cookies, body) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body ? Buffer.from(body, 'utf8') : null;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
  while ((res.status === 301 || res.status === 302) && res.headers.location && redirects < maxRedirects) {
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

// ---------------------------------------------------------------------------
// Time / Place parser
// ---------------------------------------------------------------------------

/**
 * Parse PU time-place string like "二(Tue)　 3, 4:PH303"
 * Returns { dayOfWeek, periods, location, startTime, endTime }
 */
function parseTimePlace(raw) {
  if (!raw || !raw.trim()) return null;
  const s = raw.replace(/\u3000/g, ' ').trim(); // replace fullwidth space

  // Match pattern: 星期(Day) periods:location
  // e.g. "一(Mon) 2, 3, 4:PH217" or "五(Fri) 2, 3, 4:PH320" or "六(Sat) 4:"
  const match = s.match(/^([一二三四五六日])\((\w+)\)\s*([\d,\s]+):?(.*)$/);
  if (!match) return null;

  const chineseDay = match[1];
  const dayOfWeek = DAY_MAP[chineseDay] || 1;

  const periodsStr = match[3];
  const periods = periodsStr
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => !isNaN(n));

  const location = match[4] ? match[4].trim() : '';

  // Derive start/end times from first and last period
  const firstPeriod = Math.min(...periods);
  const lastPeriod = Math.max(...periods);
  const startTime = PERIOD_TIME_MAP[firstPeriod]?.start || '08:10';
  const endTime = PERIOD_TIME_MAP[lastPeriod]?.end || '09:00';

  return { dayOfWeek, periods, location, startTime, endTime };
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

    const body = `uid=${encodeURIComponent(uid)}&upassword=${encodeURIComponent(upassword)}&en_flag=zh`;
    const res = await post(ALCAT_HOST, LOGIN_PATH, {}, body);

    // After login, PU redirects to index_menu.php. Check for session cookie.
    const hasSession = Object.keys(res.cookies).some(
      (k) => k.toUpperCase().includes('PHPSESSID') || k.toUpperCase().includes('SID'),
    );

    // Check for known error patterns
    if (
      res.data.includes('帳號或密碼錯誤') ||
      res.data.includes('login_fail') ||
      res.data.includes('Login Failed') ||
      res.data.includes('密碼錯誤')
    ) {
      return { success: false, cookies: {}, error: '帳號或密碼錯誤' };
    }

    // Successful login usually redirects or shows the menu page
    if (res.status === 302 || res.status === 200) {
      // If redirected, follow to establish full session
      let cookies = res.cookies;
      if (res.status === 302 && res.headers.location) {
        const followUp = await getFollowRedirect(ALCAT_HOST, res.headers.location, cookies);
        cookies = followUp.cookies;

        // Try to extract student name from menu page
        const nameMatch = followUp.data.match(/([^\s<]+)同學您好/);
        return {
          success: true,
          cookies,
          studentName: nameMatch ? nameMatch[1] : undefined,
        };
      }

      // Try to extract name from direct 200 response
      const nameMatch = res.data.match(/([^\s<]+)同學您好/);
      return {
        success: true,
        cookies,
        studentName: nameMatch ? nameMatch[1] : undefined,
      };
    }

    return { success: false, cookies: {}, error: `HTTP ${res.status}` };
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
      const tp = parseTimePlace(timePlaceRaw);

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
 * Fetch grades.
 *
 * IMPORTANT: Grades are on a DIFFERENT domain — mypu.pu.edu.tw
 * The e-campus session cookie may or may not carry over; we try with the
 * same cookie jar and follow redirects.
 *
 * @param {object} cookies - Session cookies from puLogin
 * @param {string} [semester] - Filter to specific semester (e.g. "1141")
 * @returns {Promise<{success, grades, summary, error}>}
 */
async function puFetchGrades(cookies, semester) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    const res = await getFollowRedirect(MYPU_HOST, GRADE_PATH, cookies);

    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;

    // ---- Parse grade table ----
    // Columns: 學期別 | 課程名稱 | 修課班級 | 修別 | 學分數 | 成績
    const rows = parseTable(html, 'Score');

    const grades = [];
    const summaryRows = [];

    for (const cells of rows) {
      if (cells.length < 6) continue;
      // Skip header rows
      if (cells[0].includes('Semester') || cells[0].includes('學期別')) continue;

      const sem = cells[0];
      const courseName = cells[1];
      const cls = cells[2];
      const courseType = cells[3];
      const credits = parseInt(cells[4], 10);
      const score = cells[5];

      // Detect summary rows (排名, 操行, 平均)
      if (
        courseName.includes('排名') ||
        courseName.includes('ranking') ||
        courseName.includes('操行') ||
        courseName.includes('Behavior') ||
        courseName.includes('平均') ||
        courseName.includes('average')
      ) {
        summaryRows.push({ semester: sem, label: courseName, value: score });
        continue;
      }

      // Skip rows without a valid semester code
      if (!/^\d{4}$/.test(sem)) continue;

      const { zhName, enName } = parseCourseTitle(courseName);

      grades.push({
        semester: sem,
        courseName: zhName,
        courseNameEn: enName,
        class: cls,
        courseType,
        credits: isNaN(credits) ? 0 : credits,
        score: score === '通過(Pass)' ? 'Pass' : parseFloat(score) || score,
      });
    }

    // Optionally filter by semester
    const filteredGrades = semester
      ? grades.filter((g) => g.semester === semester)
      : grades;

    // Group summary by semester
    const summary = {};
    for (const s of summaryRows) {
      if (!summary[s.semester]) summary[s.semester] = {};
      if (s.label.includes('系排名') || s.label.includes('Department')) {
        summary[s.semester].departmentRanking = s.value;
      } else if (s.label.includes('班排名') || s.label.includes('Class')) {
        summary[s.semester].classRanking = s.value;
      } else if (s.label.includes('操行') || s.label.includes('Behavior')) {
        summary[s.semester].behaviorScore = parseFloat(s.value) || s.value;
      } else if (s.label.includes('平均') || s.label.includes('average')) {
        summary[s.semester].semesterAverage = parseFloat(s.value) || s.value;
      }
    }

    return {
      success: true,
      grades: filteredGrades,
      allSemesters: [...new Set(grades.map((g) => g.semester))],
      summary,
    };
  } catch (err) {
    console.error('[puFetchGrades] Error:', err);
    return { success: false, grades: [], error: err.message };
  }
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
    const announcements = [];

    // Extract links from the various sections on the menu page
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = stripTags(match[2]);
      if (text && text.length > 2 && !href.includes('javascript:')) {
        announcements.push({
          title: text,
          url: href.startsWith('http') ? href : `https://${ALCAT_HOST}/${href.replace(/^\//, '')}`,
          date: new Date().toISOString().split('T')[0],
        });
      }
    }

    return { success: true, announcements };
  } catch (err) {
    console.error('[puFetchAnnouncements] Error:', err);
    return { success: false, announcements: [], error: err.message };
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

    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);

    return {
      success: true,
      studentInfo: {
        studentId: idMatch ? idMatch[1] : null,
        name: nameMatch ? nameMatch[1] : null,
        class: classMatch ? classMatch[1] : null,
        currentSemester: semMatch ? `${semMatch[1]}${semMatch[2]}` : null,
      },
    };
  } catch (err) {
    console.error('[puFetchStudentInfo] Error:', err);
    return { success: false, studentInfo: {}, error: err.message };
  }
}

module.exports = {
  puLogin,
  puFetchCourses,
  puFetchGrades,
  puFetchAnnouncements,
  puFetchStudentInfo,
};
