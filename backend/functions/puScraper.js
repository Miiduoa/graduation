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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALCAT_HOST = 'alcat.pu.edu.tw';
const MYPU_HOST = 'mypu.pu.edu.tw';
const LOGIN_PATH = '/index_check.php';
const COURSE_RESULT_PATH = '/stu_query/query_course.html';
const GRADE_PATH = '/score_query/score_all.php';
const ALCAT_GRADE_ALL = '/stu_query/score_all.php'; // 歷年修課明細（學分試算表使用）
const CREDIT_AUDIT_TAB1 = '/grade_review/tab_1.php'; // 學分試算總覽
const CREDIT_AUDIT_CANDIDATE_PATHS = [
  `https://${ALCAT_HOST}/stu_query/query_credit.html`,
  `https://${ALCAT_HOST}/stu_query/credit_check.html`,
  `https://${ALCAT_HOST}/stu_query/credit_calc.html`,
  `https://${ALCAT_HOST}/stu_query/query_score.html`,
  `https://${ALCAT_HOST}/stu_query/query_history.html`,
  `https://${MYPU_HOST}/score_query/credit_calc.php`,
  `https://${MYPU_HOST}/score_query/credit_check.php`,
  `https://${MYPU_HOST}/score_query/score_history.php`,
  `https://${MYPU_HOST}/score_query/score_list.php`,
  `https://${MYPU_HOST}/credit_query/index.php`,
  `https://${MYPU_HOST}/credit_query/credit_check.php`,
];

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
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
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

// ---------------------------------------------------------------------------
// Time / Place parser
// ---------------------------------------------------------------------------

/**
 * Parse PU time-place string like "二(Tue)  3, 4:PH303"
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
      return { success: false, courses: [], error: 'E校園 session 已失效，請重新登入' };
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
      const tp = parseTimePlace(timePlaceRaw);
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
/**
 * Parse grade rows from an HTML response.
 * Returns { grades, summaryRows }.
 */
/**
 * 解析「歷年修課明細」格式 — 學期標題 + 每學期一個 table
 * 格式: 學期別(Semester)：114 [ 1 ] → 下方 table 有 Course, Class, CourseType, Credits, Score
 */
function parsePerSemesterGrades(html) {
  const grades = [];
  const summaryRows = [];

  const semesterSections = html.split(/學期別\(Semester\)/);
  if (semesterSections.length <= 1) return { grades: [], summaryRows: [] };

  for (let i = 1; i < semesterSections.length; i++) {
    const section = semesterSections[i];
    const semMatch = section.match(/[：:]\s*(\d{2,3})\s*\[\s*(\d+)\s*\]/);
    if (!semMatch) continue;
    const semester = `${semMatch[1]}${semMatch[2]}`;

    const tables = parseAllTables(section);
    for (const rows of tables) {
      for (const cells of rows) {
        if (cells.length < 5) continue;
        const courseName = (cells[0] || '').trim();
        if (!courseName) continue;
        if (courseName.includes('科目名稱') || courseName.includes('Course')) continue;

        if (
          courseName.includes('平均') || courseName.includes('average') ||
          courseName.includes('操行') || courseName.includes('Behavior') ||
          courseName.includes('排名') || courseName.includes('ranking')
        ) {
          const value = cells[cells.length - 1] || '';
          if (value) summaryRows.push({ semester, label: courseName, value: value.trim() });
          continue;
        }

        const scoreIdx = cells.length - 1;
        const creditsIdx = cells.length - 2;
        const courseTypeIdx = cells.length - 3;
        const classIdx = cells.length - 4;

        const score = (cells[scoreIdx] || '').trim();
        if (!score) continue;

        const { zhName, enName } = parseCourseTitle(courseName);
        grades.push({
          semester,
          courseName: zhName,
          courseNameEn: enName,
          className: (cells[classIdx] || '').trim(),
          courseType: (cells[courseTypeIdx] || '').trim(),
          credits: parseInt(cells[creditsIdx] || '0', 10) || 0,
          score: normalizeScoreValue(score),
        });
      }
    }
  }

  return { grades: dedupeGradeRows(grades), summaryRows: dedupeSummaryRows(summaryRows) };
}

function parseGradeRows(html) {
  // 優先嘗試「歷年修課明細」格式
  const perSemResult = parsePerSemesterGrades(html);
  if (perSemResult.grades.length > 0) {
    console.log(`[parseGradeRows] Per-semester format: ${perSemResult.grades.length} grades`);
    return perSemResult;
  }

  // Fallback: 原始格式
  const parsedTables = parseAllTables(html)
    .map((rows) => parseGradeRowsFromTableRows(rows))
    .filter((candidate) => candidate.grades.length > 0 || candidate.summaryRows.length > 0);

  if (parsedTables.length === 0) {
    return { grades: [], summaryRows: [] };
  }

  return {
    grades: dedupeGradeRows(parsedTables.flatMap((candidate) => candidate.grades)),
    summaryRows: dedupeSummaryRows(parsedTables.flatMap((candidate) => candidate.summaryRows)),
  };
}

/**
 * Build summary object from summary rows.
 */
function buildGradeSummary(summaryRows) {
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
  return summary;
}

/**
 * Try to extract available semesters from the grade page's form/dropdown.
 * Many PU pages have a <select> for semester selection.
 */
function extractAvailableSemesters(html) {
  const semesters = [];
  // Pattern: <option value="1132">113學年度第2學期</option>
  const optionRegex = /<option[^>]*value=["']?(\d{4})["']?[^>]*>/gi;
  let m;
  while ((m = optionRegex.exec(html)) !== null) {
    if (!semesters.includes(m[1])) semesters.push(m[1]);
  }
  return semesters;
}

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
          const bridgeParsed = parseGradeRows(bridgeRes.data);
          if (bridgeParsed.grades.length > 1) {
            const bridgeSems = [...new Set(bridgeParsed.grades.map(g => g.semester))];
            console.log(`[puFetchGrades] Bridge ${bp} returned ${bridgeParsed.grades.length} grades, ${bridgeSems.length} semesters!`);
            if (bridgeSems.length > 1) {
              // alcat's own score page has all semesters — use it
              const summary = buildGradeSummary(bridgeParsed.summaryRows);
              const filteredGrades = semester
                ? bridgeParsed.grades.filter(g => g.semester === semester)
                : bridgeParsed.grades;
              return { success: true, grades: filteredGrades, allSemesters: bridgeSems, summary };
            }
          }
        }
      } catch (e) {
        console.warn(`[puFetchGrades] Bridge ${bp} failed:`, e.message);
      }
    }

    // ── Step 2: Fetch the grade page ──
    const res = await getFollowRedirect(MYPU_HOST, GRADE_PATH, mypuCookies);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;
    if (looksLikePuLoginPage(html)) {
      return { success: false, grades: [], error: 'E校園 session 已失效，請重新登入' };
    }

    // ---- Parse grade tables (2026-04 verified) ----
    // Structure: Each semester has a <p>學期別(Semester)：YYY [ T ]</p>
    //            followed by a 5-column table:
    //            科目名稱(Course) | 修課班級(Class) | 修別(Course type) | 學分數(Credits) | 成績(Score)
    //            Table footer rows: 學期平均成績, 操行成績, 班排名, 系排名

    const grades = [];
    const summary = {};

    // 1. Extract semester codes from <p> headers
    const semRegex = /學期別\(Semester\)[：:]\s*(\d+)\s*\[\s*(\d+)\s*\]/g;
    const semesterCodes = [];
    let semMatch;
    while ((semMatch = semRegex.exec(html)) !== null) {
      semesterCodes.push(`${semMatch[1]}${semMatch[2]}`);
    }

    // 2. Find all 5-column grade tables (contain "Score" or "成績" AND "Course" or "科目")
    const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
    const allTables = html.match(tableRegex) || [];
    const gradeTables = [];
    for (const table of allTables) {
      if (
        (table.includes('Score') || table.includes('成績')) &&
        (table.includes('Course') || table.includes('科目'))
      ) {
        gradeTables.push(table);
      }
    }

    // 3. Parse each table, pair with semester
    for (let i = 0; i < gradeTables.length; i++) {
      const sem = semesterCodes[i] || `unknown_${i}`;
      const rows = parseTable(gradeTables[i], '');

      if (!summary[sem]) summary[sem] = {};

      for (const cells of rows) {
        if (cells.length < 5) continue;
        if (cells[0].includes('Course') || cells[0].includes('科目名稱')) continue;

        const courseName = cells[0];
        const score = cells[4];

        // Summary rows (average, behavior, ranking)
        if (
          courseName.includes('平均') ||
          courseName.includes('average') ||
          courseName.includes('操行') ||
          courseName.includes('Behavior') ||
          courseName.includes('排名') ||
          courseName.includes('ranking')
        ) {
          if (courseName.includes('系排名') || courseName.includes('Department')) {
            summary[sem].departmentRanking = score;
          } else if (courseName.includes('班排名') || courseName.includes('Class')) {
            summary[sem].classRanking = score;
          } else if (courseName.includes('操行') || courseName.includes('Behavior')) {
            summary[sem].behaviorScore = parseFloat(score) || score;
          } else if (courseName.includes('平均') || courseName.includes('average')) {
            summary[sem].semesterAverage = parseFloat(score) || score;
          }
          continue;
        }

        const { zhName, enName } = parseCourseTitle(courseName);

        grades.push({
          semester: sem,
          courseName: zhName,
          courseNameEn: enName,
          class: cells[1],
          courseType: cells[2],
          credits: parseInt(cells[3], 10) || 0,
          score: score === '通過(Pass)' ? 'Pass' : parseFloat(score) || score,
        });
      }
    }

    const filteredGrades = semester ? grades.filter((g) => g.semester === semester) : grades;

    return {
      success: true,
      grades: filteredGrades,
      allSemesters,
      summary,
    };
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

    // 從成績頁取得所有成績資料
    const gradeResult = await puFetchGrades(cookies);
    if (!gradeResult.success || !gradeResult.grades || gradeResult.grades.length === 0) {
      return {
        success: true,
        creditSummary: { totalRequired: 128, totalEarned: 0, categories: [], semesters: [] },
      };
    }

    // 依修別（courseType）分類統計
    const categoryMap = {};
    let totalEarned = 0;
    let totalCourses = 0;

    for (const g of gradeResult.grades) {
      const ct = (g.courseType || '其他').trim();
      const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
      const passed = isNaN(score)
        ? String(g.score).includes('Pass') || String(g.score).includes('通過')
        : score >= 60;

      if (!categoryMap[ct]) {
        categoryMap[ct] = {
          category: ct,
          earned: 0,
          courses: 0,
          passedCourses: 0,
          failedCourses: 0,
          credits: 0,
        };
      }
      categoryMap[ct].courses += 1;
      categoryMap[ct].credits += g.credits;
      totalCourses += 1;

      if (passed) {
        categoryMap[ct].earned += g.credits;
        categoryMap[ct].passedCourses += 1;
        totalEarned += g.credits;
      } else {
        categoryMap[ct].failedCourses += 1;
      }
    }

    const categories = Object.values(categoryMap).sort((a, b) => b.earned - a.earned);

    // 每學期摘要
    const semesterMap = {};
    for (const g of gradeResult.grades) {
      const sem = g.semester || 'unknown';
      if (!semesterMap[sem])
        semesterMap[sem] = {
          semester: sem,
          courses: 0,
          credits: 0,
          totalScore: 0,
          weightedScore: 0,
          weightedCredits: 0,
        };
      semesterMap[sem].courses += 1;
      const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
      const passed = isNaN(score) ? String(g.score).includes('Pass') : score >= 60;
      if (passed) semesterMap[sem].credits += g.credits;
      if (!isNaN(score) && score > 0) {
        semesterMap[sem].weightedScore += score * g.credits;
        semesterMap[sem].weightedCredits += g.credits;
      }
    }

    const semesters = Object.values(semesterMap)
      .map((s) => ({
        ...s,
        average:
          s.weightedCredits > 0 ? Math.round((s.weightedScore / s.weightedCredits) * 100) / 100 : 0,
        ranking: gradeResult.summary?.[s.semester] || {},
      }))
      .sort((a, b) => String(b.semester).localeCompare(String(a.semester)));

    return {
      success: true,
      creditSummary: {
        totalRequired: 128,
        totalEarned,
        totalCourses,
        categories,
        semesters,
        allSemesters: gradeResult.allSemesters || [],
        gradeSummary: gradeResult.summary || {},
      },
    };
  } catch (err) {
    console.error('[puFetchCreditSummary] Error:', err);
    return {
      success: true,
      creditSummary: { totalRequired: 128, totalEarned: 0, categories: [], semesters: [] },
    };
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

/**
 * Discover all available links on the e-Campus menu page.
 * Returns categorized links found on /index_menu.php.
 * This helps identify URLs for credit audit, grade query, etc.
 */
async function puDiscoverMenuLinks(cookies) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    const res = await getFollowRedirect(ALCAT_HOST, '/index_menu.php', cookies);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.data;
    const links = [];
    const linkRegex = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[2];
      const text = stripTags(match[4]).trim();
      const target = extractAnchorTarget(match[0], href);
      if (!text || text.length <= 1 || !target) continue;
      links.push({ text, href: target });
    }

    // Categorize links
    const creditLinks = links.filter((link) => isCreditAuditLink(link.text, link.href));

    console.log('[puDiscoverMenuLinks] Total links:', links.length);
    console.log('[puDiscoverMenuLinks] Credit/grade related:', JSON.stringify(creditLinks, null, 2));
    console.log('[puDiscoverMenuLinks] All links:', JSON.stringify(links.map(l => `${l.text}: ${l.href}`), null, 2));

    return { success: true, links, creditLinks };
  } catch (err) {
    console.error('[puDiscoverMenuLinks] Error:', err);
    return { success: false, links: [], creditLinks: [], error: err.message };
  }
}

/**
 * Fetch credit audit / historical grades from e-Campus.
 * Tries multiple known URL patterns on both alcat and mypu.
 *
 * @param {object} cookies - Session cookies from puLogin
 * @returns {Promise<{success, grades, allSemesters, summary, creditAudit, error}>}
 */
async function puFetchCreditAudit(cookies) {
  try {
    if (!cookies || !Object.keys(cookies).length) throw new Error('No session cookies');

    // First, discover available links from the menu
    const discovery = await puDiscoverMenuLinks(cookies);
    const creditLinks = discovery.creditLinks || [];

    // Build a list of URLs to try (from discovery + known patterns)
    const urlsToTry = [];

    // Add discovered credit-related links
    for (const link of creditLinks) {
      const expandedTargets = expandCreditAuditTargets(link.href);
      for (const href of expandedTargets) {
        urlsToTry.push({ url: href, desc: link.text, source: 'discovered' });
      }
    }

    // Add known common PU URL patterns for credit audit
    for (const url of CREDIT_AUDIT_CANDIDATE_PATHS) {
      urlsToTry.push({ url, desc: url, source: 'pattern' });
    }

    // Try each URL and collect grade/credit data
    let bestGrades = [];
    let bestSummary = {};
    let bestSemesters = [];
    let bestCreditAudit = null;
    let creditAuditHtml = null;
    let creditAuditUrl = null;

    for (const { url, desc, source } of urlsToTry) {
      try {
        const parsed = new URL(url);
        const res = await getFollowRedirect(parsed.hostname, parsed.pathname + parsed.search, cookies);

        if (res.status !== 200) continue;
        if (res.data.length < 100) continue; // Too small to be useful

        const html = res.data;
        console.log(`[puFetchCreditAudit] ${desc} (${source}): status=${res.status}, length=${html.length}`);

        // Check if this page has grade tables
        const parsed2 = parseGradeRows(html);
        if (parsed2.grades.length > bestGrades.length) {
          bestGrades = parsed2.grades;
          bestSemesters = [...new Set(parsed2.grades.map(g => g.semester))];
          bestSummary = buildGradeSummary(parsed2.summaryRows);
          creditAuditUrl = url;
          console.log(`[puFetchCreditAudit] ${desc}: ${parsed2.grades.length} grades, ${bestSemesters.length} semesters — BEST so far`);
        }

        // Check if this page has credit audit info (學分統計, 畢業門檻, etc.)
        if (html.includes('學分') && (html.includes('畢業') || html.includes('必修') || html.includes('選修') || html.includes('通識'))) {
          const parsedCreditAudit = parseCreditAuditSummary(html, url);
          if (getCreditAuditCompleteness(parsedCreditAudit) > getCreditAuditCompleteness(bestCreditAudit)) {
            bestCreditAudit = parsedCreditAudit;
          }
          creditAuditHtml = html;
          creditAuditUrl = url;
          console.log(`[puFetchCreditAudit] ${desc}: appears to have credit audit data!`);

          // Try to extract credit summary tables
          const allTables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
          for (let i = 0; i < allTables.length; i++) {
            console.log(`[puFetchCreditAudit] Table ${i} snippet:`, allTables[i].slice(0, 300).replace(/\s+/g, ' '));
          }
        }
      } catch (e) {
        // Silently skip failed URLs
      }
    }

    return {
      success: bestGrades.length > 0 || creditAuditHtml !== null || bestCreditAudit !== null,
      grades: bestGrades,
      allSemesters: bestSemesters,
      summary: bestSummary,
      creditAudit: bestCreditAudit,
      creditAuditUrl,
      creditAuditHtml: creditAuditHtml ? creditAuditHtml.slice(0, 5000) : null, // Truncate for safety
    };
  } catch (err) {
    console.error('[puFetchCreditAudit] Error:', err);
    return { success: false, grades: [], allSemesters: [], summary: {}, creditAudit: null, error: err.message };
  }
}

module.exports = {
  puLogin,
  puFetchCourses,
  puFetchGrades,
  puFetchAnnouncements,
  puFetchStudentInfo,
  puFetchAbsence,
  puFetchCreditSummary,
};
