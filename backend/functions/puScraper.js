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

function parseAllTables(html) {
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  return tables.map((table) => {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const allRows = [];
    let m;
    while ((m = rowRegex.exec(table)) !== null) {
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let c;
      while ((c = cellRegex.exec(m[1])) !== null) {
        cells.push(stripTags(c[1]));
      }
      if (cells.length > 0) allRows.push(cells);
    }
    return allRows;
  });
}

function normalizeSemesterValue(raw) {
  const value = String(raw || '').replace(/\s+/g, '').trim();
  if (!value) return null;
  if (/^\d{4}$/.test(value)) return value;

  const rocMatch = value.match(/^(\d{3})[-年]?([12])$/);
  if (rocMatch) return `${rocMatch[1]}${rocMatch[2]}`;

  const fullMatch = value.match(/(\d{3})學年度第([12])學期/);
  if (fullMatch) return `${fullMatch[1]}${fullMatch[2]}`;

  return null;
}

function normalizeScoreValue(raw) {
  const value = String(raw || '').trim();
  if (!value) return value;
  if (value === '通過(Pass)' || value.toLowerCase() === 'pass') return 'Pass';
  const numeric = parseFloat(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function parseGradeRowsFromTableRows(rows) {
  const grades = [];
  const summaryRows = [];

  for (const cells of rows) {
    if (cells.length < 6) continue;

    const semester = normalizeSemesterValue(cells[0]);
    const courseName = String(cells[1] || '').trim();
    const score = String(cells[5] || '').trim();

    if (!semester || !courseName || !score) continue;
    if (courseName.includes('課程名稱') || courseName.includes('Course Name')) continue;

    if (
      courseName.includes('排名') || courseName.includes('ranking') ||
      courseName.includes('操行') || courseName.includes('Behavior') ||
      courseName.includes('平均') || courseName.includes('average')
    ) {
      summaryRows.push({ semester, label: courseName, value: score });
      continue;
    }

    const { zhName, enName } = parseCourseTitle(courseName);
    grades.push({
      semester,
      courseName: zhName,
      courseNameEn: enName,
      class: cells[2],
      courseType: cells[3],
      credits: parseInt(cells[4], 10) || 0,
      score: normalizeScoreValue(score),
    });
  }

  return { grades, summaryRows };
}

function dedupeGradeRows(grades) {
  const seen = new Set();
  const deduped = [];
  for (const grade of grades) {
    const key = [
      grade.semester,
      grade.courseName,
      grade.credits,
      String(grade.score),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(grade);
  }
  return deduped;
}

function dedupeSummaryRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = `${row.semester}|${row.label}|${row.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function extractJavascriptUrl(raw) {
  const absoluteMatch = String(raw || '').match(/https?:\/\/[^"')\s]+/i);
  if (absoluteMatch) return absoluteMatch[0];

  const quotedPathMatch = String(raw || '').match(/['"]([^'"]+\.(?:php|html)(?:\?[^'"]*)?)['"]/i);
  if (quotedPathMatch) return quotedPathMatch[1];

  const pathMatch = String(raw || '').match(/\/[A-Za-z0-9_./-]+\.(?:php|html)(?:\?[^"')\s]*)?/i);
  if (pathMatch) return pathMatch[0];

  return null;
}

function extractAnchorTarget(anchorHtml, rawHref) {
  const candidates = [rawHref];
  const onclickMatch = anchorHtml.match(/\bonclick=["']([^"']+)["']/i);
  if (onclickMatch && onclickMatch[1]) {
    candidates.push(onclickMatch[1]);
  }

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    if (!value.toLowerCase().startsWith('javascript:')) return value;

    const extracted = extractJavascriptUrl(value);
    if (extracted) return extracted;
  }

  return null;
}

function isCreditAuditLink(text, target) {
  const haystack = `${text} ${target}`.toLowerCase();
  return (
    haystack.includes('學分') ||
    haystack.includes('試算') ||
    haystack.includes('畢業') ||
    haystack.includes('修課') ||
    haystack.includes('歷年') ||
    haystack.includes('成績') ||
    haystack.includes('credit') ||
    haystack.includes('graduate') ||
    haystack.includes('score')
  );
}

function expandCreditAuditTargets(target) {
  const urls = new Set();

  try {
    const resolved = new URL(target, `https://${ALCAT_HOST}/`);
    urls.add(resolved.toString());

    const path = `${resolved.pathname}${resolved.search}`;
    if (resolved.hostname === ALCAT_HOST && /^\/(?:score_query|credit_query)\//.test(path)) {
      urls.add(`https://${MYPU_HOST}${path}`);
    }
    if (resolved.hostname === MYPU_HOST && /^\/stu_query\//.test(path)) {
      urls.add(`https://${ALCAT_HOST}${path}`);
    }
  } catch {
    // Ignore malformed targets.
  }

  return Array.from(urls);
}

const CREDIT_AUDIT_CATEGORY_MATCHERS = [
  { key: 'required', keywords: ['必修'] },
  { key: 'elective', keywords: ['選修'] },
  { key: 'general', keywords: ['通識', '博雅', '核心'] },
  { key: 'english', keywords: ['英文', '英語', '外語'] },
  { key: 'other', keywords: ['體育', '服務學習', '軍訓', '勞作', '其他'] },
];

function normalizeAuditCellText(text) {
  return String(text || '').replace(/\s+/g, '').trim();
}

function detectAuditColumnRole(text) {
  const normalized = normalizeAuditCellText(text);
  if (!normalized) return null;
  if (normalized.includes('類別') || normalized.includes('項目') || normalized.includes('名稱')) return 'label';
  if (normalized.includes('已修') || normalized.includes('已得') || normalized.includes('已通過') || normalized.includes('累計')) return 'earned';
  if (normalized.includes('應修') || normalized.includes('應得') || normalized.includes('需修') || normalized.includes('規定') || normalized.includes('門檻')) return 'required';
  if (normalized.includes('尚缺') || normalized.includes('未修') || normalized.includes('未得') || normalized.includes('不足')) return 'remaining';
  return null;
}

function extractAuditColumnRoles(rows) {
  for (const row of rows.slice(0, 4)) {
    const roles = {};
    row.forEach((cell, index) => {
      const role = detectAuditColumnRole(cell);
      if (role && roles[role] == null) {
        roles[role] = index;
      }
    });

    if (Object.keys(roles).length >= 2) {
      return roles;
    }
  }

  return {};
}

function findCreditAuditCategory(text) {
  const normalized = normalizeAuditCellText(text);
  if (!normalized) return null;

  for (const matcher of CREDIT_AUDIT_CATEGORY_MATCHERS) {
    if (matcher.keywords.some((keyword) => normalized.includes(keyword))) {
      return matcher.key;
    }
  }

  return null;
}

function isCreditAuditTotalLabel(text) {
  const normalized = normalizeAuditCellText(text);
  if (!normalized) return false;

  return (
    normalized.includes('總計') ||
    normalized.includes('合計') ||
    normalized.includes('總學分') ||
    normalized.includes('畢業學分') ||
    normalized.includes('畢業門檻')
  );
}

function parseAuditNumber(text) {
  const match = String(text || '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function extractNamedAuditMetrics(text) {
  const raw = String(text || '');
  const earnedMatch = raw.match(/(?:已修|已得|已通過|累計)[^\d]{0,8}(-?\d+(?:\.\d+)?)/);
  const requiredMatch = raw.match(/(?:應修|應得|需修|規定|門檻|畢業學分)[^\d]{0,8}(-?\d+(?:\.\d+)?)/);
  const remainingMatch = raw.match(/(?:尚缺|未修|未得|不足)[^\d]{0,8}(-?\d+(?:\.\d+)?)/);

  return {
    earned: earnedMatch ? parseFloat(earnedMatch[1]) : null,
    required: requiredMatch ? parseFloat(requiredMatch[1]) : null,
    remaining: remainingMatch ? parseFloat(remainingMatch[1]) : null,
  };
}

function buildAuditMetricsFromRow(cells, roles) {
  const joined = cells.join(' ');
  const namedMetrics = extractNamedAuditMetrics(joined);

  const earned =
    (roles.earned != null ? parseAuditNumber(cells[roles.earned] || '') : null) ??
    namedMetrics.earned ??
    null;
  const required =
    (roles.required != null ? parseAuditNumber(cells[roles.required] || '') : null) ??
    namedMetrics.required ??
    null;
  const remaining =
    (roles.remaining != null ? parseAuditNumber(cells[roles.remaining] || '') : null) ??
    namedMetrics.remaining ??
    null;

  if (earned == null && required == null && remaining == null) {
    return { earned: null, required: null, remaining: null };
  }

  return {
    earned,
    required,
    remaining: remaining ?? (earned != null && required != null ? Math.max(0, required - earned) : null),
  };
}

function mergeAuditSummaryEntry(current, next) {
  return {
    earned: current?.earned ?? next.earned ?? null,
    required: current?.required ?? next.required ?? null,
    remaining: current?.remaining ?? next.remaining ?? null,
  };
}

function getCreditAuditCompleteness(payload) {
  if (!payload) return 0;

  let score = 0;
  if (payload.total?.earned != null) score += 1;
  if (payload.total?.required != null) score += 1;
  if (payload.total?.remaining != null) score += 1;

  for (const entry of Object.values(payload.byCategory || {})) {
    if (!entry) continue;
    score += 1;
    if (entry.earned != null) score += 1;
    if (entry.required != null) score += 1;
    if (entry.remaining != null) score += 1;
  }

  return score;
}

function parseCreditAuditSummary(html, sourceUrl) {
  const tables = parseAllTables(html);
  let best = null;

  for (const rows of tables) {
    const roles = extractAuditColumnRoles(rows);
    const payload = {
      sourceUrl: sourceUrl || null,
      total: {
        earned: null,
        required: null,
        remaining: null,
      },
      byCategory: {},
      rawCategoryRows: [],
    };

    for (const cells of rows) {
      const joined = cells.join(' ').trim();
      if (!joined) continue;

      const labelCell =
        (roles.label != null ? cells[roles.label] : null) ||
        cells.find((cell) => findCreditAuditCategory(cell) || isCreditAuditTotalLabel(cell)) ||
        cells[0] ||
        '';
      const category = findCreditAuditCategory(labelCell) || findCreditAuditCategory(joined);
      const isTotal = !category && (isCreditAuditTotalLabel(labelCell) || isCreditAuditTotalLabel(joined));
      if (!category && !isTotal) continue;

      const metrics = buildAuditMetricsFromRow(cells, roles);
      if (metrics.earned == null && metrics.required == null && metrics.remaining == null) continue;

      payload.rawCategoryRows.push({
        label: labelCell,
        values: cells.slice(1),
      });

      if (category) {
        const current = payload.byCategory[category];
        payload.byCategory[category] = {
          label: current?.label || String(labelCell).trim(),
          earned: current?.earned ?? metrics.earned ?? null,
          required: current?.required ?? metrics.required ?? null,
          remaining: current?.remaining ?? metrics.remaining ?? null,
        };
      } else if (isTotal) {
        payload.total = mergeAuditSummaryEntry(payload.total, metrics);
      }
    }

    if (getCreditAuditCompleteness(payload) > getCreditAuditCompleteness(best)) {
      best = payload;
    }
  }

  return getCreditAuditCompleteness(best) > 0 ? best : null;
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

    // ── Strategy 0 (BEST): alcat /stu_query/score_all.php ──
    // 學分試算表「歷年修課明細」使用的頁面，包含所有學期成績
    try {
      const alcatAll = await getFollowRedirect(ALCAT_HOST, ALCAT_GRADE_ALL, cookies);
      if (alcatAll.status === 200 && alcatAll.data.length > 200) {
        const parsed = parseGradeRows(alcatAll.data);
        const sems = [...new Set(parsed.grades.map(g => g.semester))];
        console.log(`[puFetchGrades] alcat stu_query/score_all: ${parsed.grades.length} grades, ${sems.length} semesters`);
        if (sems.length >= 1) {
          const filteredGrades = semester ? parsed.grades.filter(g => g.semester === semester) : parsed.grades;
          return {
            success: true,
            grades: filteredGrades,
            allSemesters: sems,
            summary: buildGradeSummary(parsed.summaryRows),
          };
        }
      }
    } catch (e) {
      console.warn('[puFetchGrades] Strategy 0 (alcat stu_query) failed:', e.message);
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
    const updatedCookies = res.cookies;
    console.log('[puFetchGrades] score_all.php HTML length:', html.length);
    console.log('[puFetchGrades] score_all.php snippet:', html.slice(0, 800).replace(/\s+/g, ' '));

    // ── Step 3: Parse initial response ──
    let { grades, summaryRows } = parseGradeRows(html);
    const initialSemesters = [...new Set(grades.map((g) => g.semester))];
    console.log(`[puFetchGrades] Initial parse: ${grades.length} grades across ${initialSemesters.length} semesters: [${initialSemesters.join(', ')}]`);

    // ── Step 4: If only ≤1 semester, try to get ALL semesters ──
    if (initialSemesters.length <= 1) {
      console.log('[puFetchGrades] Only 0-1 semester found — trying additional approaches…');

      // Approach A: Check if the page has a form with semester dropdown
      const availableSemesters = extractAvailableSemesters(html);
      console.log(`[puFetchGrades] Available semesters from dropdown: [${availableSemesters.join(', ')}]`);

      // Approach B: Try POST with empty semester to request "all"
      const postAttempts = [
        // Try empty body POST
        { body: '', desc: 'empty POST' },
        // Try common form parameters for "all semesters"
        { body: 'semester=', desc: 'semester=empty' },
        { body: 'qy=', desc: 'qy=empty' },
        { body: 'sem=&submit=查詢', desc: 'sem=empty+submit' },
        { body: 'year=&sem=&btn=查詢', desc: 'year+sem=empty' },
      ];

      for (const attempt of postAttempts) {
        try {
          const postRes = await post(MYPU_HOST, GRADE_PATH, updatedCookies, attempt.body);
          if (postRes.status === 200 && postRes.data.length > html.length * 0.5) {
            const postParsed = parseGradeRows(postRes.data);
            const postSemesters = [...new Set(postParsed.grades.map((g) => g.semester))];
            console.log(`[puFetchGrades] POST (${attempt.desc}): ${postParsed.grades.length} grades, ${postSemesters.length} semesters: [${postSemesters.join(', ')}]`);

            if (postParsed.grades.length > grades.length) {
              grades = postParsed.grades;
              summaryRows = postParsed.summaryRows;
              console.log(`[puFetchGrades] POST (${attempt.desc}) returned MORE grades — using this result`);
              break;
            }
          }
        } catch (e) {
          console.warn(`[puFetchGrades] POST (${attempt.desc}) failed:`, e.message);
        }
      }

      // Approach C: Per-semester fetch — use dropdown options, or generate semester codes
      const allSemestersSoFar = [...new Set(grades.map((g) => g.semester))];
      let semestersToFetch = availableSemesters.filter(s => !allSemestersSoFar.includes(s));

      // If no dropdown found, generate plausible semester codes (last 4 years = 8 semesters)
      if (semestersToFetch.length === 0) {
        const now = new Date();
        const rocYear = now.getFullYear() - 1911;
        const generated = [];
        for (let y = rocYear; y >= rocYear - 4; y--) {
          generated.push(`${y}2`, `${y}1`);
        }
        semestersToFetch = generated.filter(s => !allSemestersSoFar.includes(s));
        console.log(`[puFetchGrades] No dropdown — generated ${semestersToFetch.length} semester codes to try`);
      }

      if (allSemestersSoFar.length <= 1 && semestersToFetch.length > 0) {
        console.log(`[puFetchGrades] Trying per-semester fetch for ${semestersToFetch.length} semesters…`);
        const allGrades = [...grades];
        const allSummaryRows = [...summaryRows];
        const fetchedSemesters = new Set(allSemestersSoFar);
        let consecutiveEmpty = 0;

        for (const sem of semestersToFetch) {
          if (fetchedSemesters.has(sem)) continue;

          // Stop after 3 consecutive empty semesters (likely reached start of enrollment)
          if (consecutiveEmpty >= 3) {
            console.log(`[puFetchGrades] Stopping per-semester fetch after 3 consecutive empty semesters`);
            break;
          }

          let found = false;
          try {
            // Try GET with query param
            const semRes = await getFollowRedirect(MYPU_HOST, `${GRADE_PATH}?semester=${sem}`, updatedCookies);
            if (semRes.status === 200) {
              const semParsed = parseGradeRows(semRes.data);
              if (semParsed.grades.length > 0) {
                allGrades.push(...semParsed.grades);
                allSummaryRows.push(...semParsed.summaryRows);
                fetchedSemesters.add(sem);
                found = true;
                console.log(`[puFetchGrades] Semester ${sem}: +${semParsed.grades.length} grades`);
              }
            }

            if (!found) {
              // Try POST with specific semester
              const semPostRes = await post(MYPU_HOST, GRADE_PATH, updatedCookies, `semester=${sem}`);
              if (semPostRes.status === 200) {
                const semParsed = parseGradeRows(semPostRes.data);
                if (semParsed.grades.length > 0) {
                  allGrades.push(...semParsed.grades);
                  allSummaryRows.push(...semParsed.summaryRows);
                  fetchedSemesters.add(sem);
                  found = true;
                  console.log(`[puFetchGrades] Semester ${sem} (POST): +${semParsed.grades.length} grades`);
                }
              }
            }
          } catch (e) {
            console.warn(`[puFetchGrades] Per-semester fetch for ${sem} failed:`, e.message);
          }

          consecutiveEmpty = found ? 0 : consecutiveEmpty + 1;
        }

        if (allGrades.length > grades.length) {
          grades = allGrades;
          summaryRows = allSummaryRows;
        }
      }
    }

    // ── Step 5: Fallback to E-campus credit audit if the main grade page is still incomplete ──
    let allSemesters = [...new Set(grades.map((g) => g.semester))];
    if (allSemesters.length <= 1) {
      try {
        const auditResult = await puFetchCreditAudit(cookies);
        if (auditResult.success && auditResult.grades.length > grades.length) {
          console.log(`[puFetchGrades] Credit audit fallback improved result: ${auditResult.grades.length} grades, ${auditResult.allSemesters.length} semesters`);
          grades = auditResult.grades;
          summaryRows = dedupeSummaryRows([
            ...summaryRows,
            ...Object.entries(auditResult.summary || {}).flatMap(([semesterKey, value]) => {
              const rows = [];
              if (value.departmentRanking != null) {
                rows.push({ semester: semesterKey, label: '系排名', value: String(value.departmentRanking) });
              }
              if (value.classRanking != null) {
                rows.push({ semester: semesterKey, label: '班排名', value: String(value.classRanking) });
              }
              if (value.behaviorScore != null) {
                rows.push({ semester: semesterKey, label: '操行', value: String(value.behaviorScore) });
              }
              if (value.semesterAverage != null) {
                rows.push({ semester: semesterKey, label: '平均', value: String(value.semesterAverage) });
              }
              return rows;
            }),
          ]);
          allSemesters = auditResult.allSemesters || [...new Set(grades.map((g) => g.semester))];
        }
      } catch (e) {
        console.warn('[puFetchGrades] Credit audit fallback failed:', e.message);
      }
    }

    // ── Step 6: Final result ──
    console.log(`[puFetchGrades] Final result: ${grades.length} grades across ${allSemesters.length} semesters: [${allSemesters.join(', ')}]`);

    const filteredGrades = semester
      ? grades.filter((g) => g.semester === semester)
      : grades;

    const summary = buildGradeSummary(summaryRows);

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
  puFetchCreditAudit,
  puDiscoverMenuLinks,
};
