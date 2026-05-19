/**
 * Providence University (靜宜大學) Direct Scraper
 *
 * React Native 版本 — 直接從 app 發 HTTPS 請求到靜宜的系統，
 * 不需要 Firebase Cloud Functions 當中間層。
 *
 * 目標網站：
 *   - 登入:   POST https://alcat.pu.edu.tw/index_check.php
 *   - 課表:   GET  https://alcat.pu.edu.tw/stu_query/query_course.html
 *   - 成績:   GET  https://mypu.pu.edu.tw/score_query/score_all.php
 *   - 公告:   GET  https://alcat.pu.edu.tw/index_menu.php
 *
 * Verified against live pages 2026-03-24.
 */

import type {
  CreditCategory,
  PuCreditAuditPayload,
  PuMissingRequiredCourse,
  PuGeneralEdDimension,
  PuRequiredGeneralCourse,
  PuInProgressGeneralCourse,
  PuMissingRequiredElective,
  PuRepeatedCourse,
  PuPassedCertification,
  PuProfessionalElectiveOption,
  PuCreditTotals,
  PuSemesterGradeRecord,
  PuAcademicYearRanking,
  PuCreditAuditCategorySummary,
} from "@campus/shared/src";

// ─── Constants ───────────────────────────────────────────

const ALCAT_BASE = 'https://alcat.pu.edu.tw';
const MYPU_BASE = 'https://mypu.pu.edu.tw';
const LOGIN_PATH = '/index_check.php';
const COURSE_PATH = '/stu_query/query_course.html';
const GRADE_PATH = '/score_query/score_all.php';
const MENU_PATH = '/index_menu.php';

// ── 學分試算表 (Credit Audit) ──
// 主頁面 /grade_review/main.php 包含 iframe tabs:
//   tab_1.php = 學分試算總覽 (必修/選修/通識尚缺 + 修習學分累計)
//   tab_3.php = 畢業條件
//   /stu_query/score_all.php = 歷年修課明細 (所有學期成績！)
const CREDIT_AUDIT_TAB1 = "/grade_review/tab_1.php";
const ALCAT_GRADE_ALL = "/stu_query/score_all.php";
const CREDIT_AUDIT_CANDIDATE_PATHS = [
  `${ALCAT_BASE}/stu_query/query_credit.html`,
  `${ALCAT_BASE}/stu_query/credit_check.html`,
  `${ALCAT_BASE}/stu_query/credit_calc.html`,
  `${ALCAT_BASE}/stu_query/query_score.html`,
  `${ALCAT_BASE}/stu_query/query_history.html`,
  `${MYPU_BASE}/score_query/credit_calc.php`,
  `${MYPU_BASE}/score_query/credit_check.php`,
  `${MYPU_BASE}/score_query/score_history.php`,
  `${MYPU_BASE}/score_query/score_list.php`,
  `${MYPU_BASE}/credit_query/index.php`,
  `${MYPU_BASE}/credit_query/credit_check.php`,
];

/** 靜宜大學節次 → 時間對照表 */
const PERIOD_TIME_MAP: Record<number, { start: string; end: string }> = {
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

const DAY_MAP: Record<string, number> = {
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

// ─── Types ───────────────────────────────────────────────

export type PUSession = {
  /** 標記已登入；cookie 由原生 cookie jar 自動管理 */
  loggedIn: true;
  studentName: string | null;
  /** 後端統一登入模式下，E 校園 cookie 保存在 Cloud Functions。 */
  backendSessionId?: string | null;
};

export type PUStudentInfo = {
  studentId: string | null;
  name: string | null;
  className: string | null;
  currentSemester: string | null;
  department: string | null;
  grade: string | null;
  enrollmentStatus: string | null;
};

export type PUCourse = {
  code: string;
  classOffered: string;
  name: string;
  nameEn: string;
  courseType: string;
  credits: number;
  dayOfWeek: number | null;
  periods: number[];
  startTime: string | null;
  endTime: string | null;
  location: string;
  timePlaceRaw: string;
  teacherEmail: string;
  teacherName?: string;
};

export type PUCourseResult = {
  courses: PUCourse[];
  studentInfo: PUStudentInfo;
  semester: string | null;
  totalCredits: number;
};

export type PUGrade = {
  semester: string;
  courseName: string;
  courseNameEn: string;
  className: string;
  courseType: string;
  credits: number;
  score: number | string;
};

export type PUGradeResult = {
  grades: PUGrade[];
  allSemesters: string[];
  summary: Record<
    string,
    {
      departmentRanking?: string;
      classRanking?: string;
      behaviorScore?: number | string;
      semesterAverage?: number | string;
    }
  >;
};

export type PUAnnouncement = {
  title: string;
  url: string;
  date: string;
  category?: string;
};

export type PUAbsence = {
  date: string;
  courseName: string;
  period: string;
  absenceType: string; // 曠課, 病假, 事假, 公假 etc.
  status: string;
};

export type PUCreditSummary = {
  totalRequired: number;
  totalEarned: number;
  categories: Array<{
    category: string; // 必修, 選修, 通識, etc.
    required: number;
    earned: number;
  }>;
};

export type PUDetailedAnnouncement = {
  title: string;
  url: string;
  date: string;
  category: string;
  isNew: boolean;
  isImportant: boolean;
};

type AuditColumnRole = "label" | "earned" | "required" | "remaining";

// ── Additional tab paths for comprehensive audit ──
const CREDIT_AUDIT_TAB2 = "/grade_review/tab_2.php";
const CREDIT_AUDIT_TAB3 = "/grade_review/tab_3.php";
const CREDIT_AUDIT_TAB4 = "/grade_review/tab_4.php";

// ─── HTML Helpers ────────────────────────────────────────

function stripTags(html: string): string {
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

function parseTable(html: string, headerHint: string): string[][] {
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) ?? [];

  let bestTable: string | null = null;
  for (const table of tables) {
    if (headerHint && !table.includes(headerHint)) continue;
    bestTable = table;
    break;
  }
  if (!bestTable && tables.length > 0) bestTable = tables[tables.length - 1]!;
  if (!bestTable) return [];

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const allRows: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(bestTable)) !== null) {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null;
    while ((c = cellRegex.exec(m[1])) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (cells.length > 0) allRows.push(cells);
  }
  return allRows;
}

function looksLikePuLoginPage(html: string): boolean {
  const normalized = html.toLowerCase();
  return (
    normalized.includes('action="index_check.php"') ||
    normalized.includes("action='index_check.php'") ||
    (normalized.includes('name="uid"') && normalized.includes('name="upassword"')) ||
    (normalized.includes("name='uid'") && normalized.includes("name='upassword'"))
  );
}

function hasPuStudentContext(html: string): boolean {
  return (
    html.includes('學號(Student No.)') ||
    html.includes('姓名(Student Name)') ||
    html.includes('Student No.') ||
    html.includes('query_course')
  );
}

function normalizePuUrl(href: string): string {
  try {
    return new URL(href, `${ALCAT_BASE}/`).toString();
  } catch {
    return `${ALCAT_BASE}/${href.replace(/^\//, '')}`;
  }
}

function isUsefulAnnouncementLink(title: string, href: string, hasDate: boolean): boolean {
  if (!title || title.length < 4) return false;
  if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return false;
  if (/index_check\.php|logout/i.test(href)) return false;
  if (!hasDate && title.length < 8) return false;
  return true;
}

function pushUniqueAnnouncement(
  target: PUAnnouncement[],
  seen: Set<string>,
  announcement: PUAnnouncement,
): void {
  const key = `${announcement.title}::${announcement.url}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(announcement);
}

function extractAnnouncementsFromHtml(html: string): PUAnnouncement[] {
  const announcements: PUAnnouncement[] = [];
  const seen = new Set<string>();
  const todayStr = new Date().toISOString().split('T')[0];

  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[0];
    const rowText = stripTags(rowHtml);
    const extractedDate = extractDateFromText(rowText) ?? extractDateFromText(rowHtml);
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch: RegExpExecArray | null;

    while ((linkMatch = linkRegex.exec(rowHtml)) !== null) {
      const href = linkMatch[1]?.trim() ?? '';
      const title = stripTags(linkMatch[2] ?? '');
      if (!isUsefulAnnouncementLink(title, href, Boolean(extractedDate))) {
        continue;
      }

      pushUniqueAnnouncement(announcements, seen, {
        title,
        url: normalizePuUrl(href),
        date: extractedDate ?? todayStr,
      });
    }
  }

  if (announcements.length > 0) {
    return announcements;
  }

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = linkMatch[1]?.trim() ?? '';
    const title = stripTags(linkMatch[2] ?? '');
    const context = html.slice(
      Math.max(0, linkMatch.index - 160),
      Math.min(html.length, linkMatch.index + linkMatch[0].length + 160),
    );
    const extractedDate = extractDateFromText(stripTags(context)) ?? extractDateFromText(context);

    if (!isUsefulAnnouncementLink(title, href, Boolean(extractedDate))) {
      continue;
    }

    pushUniqueAnnouncement(announcements, seen, {
      title,
      url: normalizePuUrl(href),
      date: extractedDate ?? todayStr,
    });
  }

  return announcements;
}

// ─── Time/Place Parser ───────────────────────────────────

function parseTimePlace(raw: string): {
  dayOfWeek: number;
  periods: number[];
  location: string;
  startTime: string;
  endTime: string;
} | null {
  if (!raw?.trim()) return null;
  const s = raw.replace(/\u3000/g, ' ').trim();

  const match = s.match(/^([一二三四五六日])\((\w+)\)\s*([\d,\s]+):?(.*)$/);
  if (!match) return null;

  const dayOfWeek = DAY_MAP[match[1]] ?? 1;
  const periods = match[3]
    .split(',')
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => !isNaN(n));
  const location = match[4]?.trim() ?? '';

  const firstPeriod = Math.min(...periods);
  const lastPeriod = Math.max(...periods);
  const startTime = PERIOD_TIME_MAP[firstPeriod]?.start ?? '08:10';
  const endTime = PERIOD_TIME_MAP[lastPeriod]?.end ?? '09:00';

  return { dayOfWeek, periods, location, startTime, endTime };
}

function parseCourseTitle(raw: string): { zhName: string; enName: string } {
  const boundary = raw.search(/[A-Z]/);
  if (boundary > 0) {
    return { zhName: raw.slice(0, boundary).trim(), enName: raw.slice(boundary).trim() };
  }
  return { zhName: raw.trim(), enName: '' };
}

// ─── Fetch Helpers ───────────────────────────────────────
//
// React Native 的 fetch 無法讀取 set-cookie header（原生安全限制），
// 所以我們不再自己管 cookie，改用 credentials: "include" 讓
// iOS (NSURLSession) / Android (OkHttp) 的原生 cookie jar 自動處理。

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

async function nativeFetch(
  url: string,
  options: { method?: string; body?: string; contentType?: string; timeoutMs?: number } = {},
): Promise<{ html: string; status: number }> {
  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.body && options.contentType) headers['Content-Type'] = options.contentType;

  // 加入超時機制，預設 15 秒（避免校園伺服器無回應時永遠卡住）
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      credentials: 'include', // 讓原生 cookie jar 管理 cookie
      redirect: 'follow', // 讓原生層自動跟隨 redirect
      signal: controller.signal,
    });

    const html = await response.text();
    return { html, status: response.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`連線逾時，伺服器沒有回應（${url.includes('alcat') ? 'E校園' : '校園系統'}）`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Public API ──────────────────────────────────────────

/**
 * 登入靜宜大學 e-campus。
 * 成功後回傳 session cookies（後續 API 呼叫用）。
 */
export async function puLogin(
  uid: string,
  password: string,
): Promise<{ success: boolean; session: PUSession | null; error?: string }> {
  try {
    if (!uid || !password) return { success: false, session: null, error: '請輸入學號和密碼' };

    // ── Step 0: 先 GET 登入頁，讓原生 cookie jar 拿到初始 session cookie ──
    console.log('[puLogin] Step 0: warming up cookie jar…');
    await nativeFetch(`${ALCAT_BASE}/`);

    // ── Step 1: POST 登入表單 ──
    const body = `uid=${encodeURIComponent(uid)}&upassword=${encodeURIComponent(password)}&en_flag=zh`;
    console.log('[puLogin] Step 1: POST login…');
    const loginResult = await nativeFetch(`${ALCAT_BASE}${LOGIN_PATH}`, {
      method: 'POST',
      body,
      contentType: 'application/x-www-form-urlencoded',
    });
    console.log('[puLogin] POST status:', loginResult.status);
    console.log('[puLogin] POST html length:', loginResult.html.length);
    console.log('[puLogin] POST html snippet:', loginResult.html.slice(0, 500));

    // ── Step 2: 不靠 POST 回傳頁的文字判斷，直接試抓受保護的課表頁 ──
    console.log('[puLogin] Step 2: verifying session via course page…');
    const verifyResult = await nativeFetch(`${ALCAT_BASE}${COURSE_PATH}`);
    console.log('[puLogin] verify status:', verifyResult.status);
    console.log('[puLogin] verify html length:', verifyResult.html.length);
    console.log('[puLogin] verify html snippet:', verifyResult.html.slice(0, 500));

    const vHtml = verifyResult.html;

    // 課表頁有學生學號 → 登入成功
    const hasStudentData = hasPuStudentContext(vHtml);

    if (!hasStudentData) {
      // 真的登入失敗（帳密錯或 session 沒存下來）
      // 從 POST 回傳頁嘗試取得伺服器的錯誤訊息
      const postHtml = loginResult.html;
      if (
        postHtml.includes('帳號或密碼錯誤') ||
        postHtml.includes('密碼錯誤') ||
        postHtml.includes('login_fail') ||
        postHtml.includes('Login Failed')
      ) {
        return { success: false, session: null, error: '帳號或密碼錯誤' };
      }
      return {
        success: false,
        session: null,
        error: looksLikePuLoginPage(vHtml)
          ? 'E校園 登入失敗，伺服器未建立有效工作階段'
          : '無法驗證登入狀態，請確認帳號密碼後再試',
      };
    }

    // 嘗試取得學生姓名
    const nameMatch =
      vHtml.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/) ??
      loginResult.html.match(/([^\s<]+)同學您好/);
    const studentName = nameMatch?.[1] ?? null;

    console.log('[puLogin] success! studentName =', studentName);
    return {
      success: true,
      session: { loggedIn: true, studentName },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '連線失敗';
    console.error('[puLogin] Error:', err);
    return { success: false, session: null, error: `登入失敗：${msg}` };
  }
}

/**
 * 取得課表。
 */
export async function puFetchCourses(
  _session: PUSession,
  _semester?: string,
): Promise<{ success: boolean; data: PUCourseResult | null; error?: string }> {
  try {
    const result = await nativeFetch(`${ALCAT_BASE}${COURSE_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html) || !hasPuStudentContext(html)) {
      return { success: false, data: null, error: 'E校園 session 已失效，請重新登入' };
    }

    // 學生資訊
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);
    const creditsMatch = html.match(/學期總學分[：:]\s*(\d+)/);
    const className = classMatch?.[1] ?? null;
    const { department, grade } = className
      ? parseClassName(className)
      : { department: null, grade: null };
    const enrollStatusMatch = html.match(/學籍狀態[：:]\s*([^\s<]+)|Status[：:]\s*([^\s<]+)/);

    const studentInfo: PUStudentInfo = {
      studentId: idMatch?.[1] ?? null,
      name: nameMatch?.[1] ?? null,
      className,
      currentSemester: semMatch ? `${semMatch[1]}${semMatch[2]}` : null,
      department,
      grade,
      enrollmentStatus: enrollStatusMatch?.[1] ?? enrollStatusMatch?.[2] ?? null,
    };

    const totalCredits = creditsMatch ? parseInt(creditsMatch[1], 10) : 0;
    const detectedSemester = semMatch ? `${semMatch[1]}${semMatch[2]}` : null;

    // 解析課表
    const rows = parseTable(html, 'course code');
    const courses: PUCourse[] = [];

    for (const cells of rows) {
      if (cells.length < 7) continue;
      if (cells[0].includes('course code') || cells[0].includes('選課代號')) continue;

      const { zhName, enName } = parseCourseTitle(cells[2]);
      const tp = parseTimePlace(cells[5]);

      courses.push({
        code: cells[0],
        classOffered: cells[1],
        name: zhName,
        nameEn: enName,
        courseType: cells[3],
        credits: parseInt(cells[4], 10) || 0,
        dayOfWeek: tp?.dayOfWeek ?? null,
        periods: tp?.periods ?? [],
        startTime: tp?.startTime ?? null,
        endTime: tp?.endTime ?? null,
        location: tp?.location ?? '',
        timePlaceRaw: cells[5],
        teacherEmail: cells[6],
        teacherName: extractTeacherName(cells[6]),
      });
    }

    return {
      success: true,
      data: { courses, studentInfo, semester: detectedSemester, totalCredits },
    };
  } catch (err) {
    console.error('[puFetchCourses]', err);
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : '抓取課表失敗',
    };
  }
}

/**
 * 從 HTML 解析成績行。
 */
/**
 * 解析「歷年修課明細」格式 — 學期標題 + 每學期一個 table
 * 格式: 學期別(Semester)：114 [ 1 ] → 下方 table 有 Course, Class, CourseType, Credits, Score
 * 學期結束有: 學期平均成績, 操行成績, 班排名, 系排名
 */
function parsePerSemesterGrades(html: string): { grades: PUGrade[]; summaryRows: { semester: string; label: string; value: string }[] } {
  const grades: PUGrade[] = [];
  const summaryRows: { semester: string; label: string; value: string }[] = [];

  // 用 學期別(Semester)：XXX [ Y ] 來拆分 HTML
  const semesterSections = html.split(/學期別\(Semester\)/);
  if (semesterSections.length <= 1) return { grades: [], summaryRows: [] };

  for (let i = 1; i < semesterSections.length; i++) {
    const section = semesterSections[i];
    // 解析學期代碼: ：114 [ 1 ] → "1141"
    const semMatch = section.match(/[：:]\s*(\d{2,3})\s*\[\s*(\d+)\s*\]/);
    if (!semMatch) continue;
    const semester = `${semMatch[1]}${semMatch[2]}`;

    // 解析此學期的 table
    const tables = parseAllTables(section);
    for (const rows of tables) {
      for (const cells of rows) {
        if (cells.length < 5) continue;

        const courseName = (cells[0] ?? "").trim();
        if (!courseName) continue;
        if (courseName.includes("科目名稱") || courseName.includes("Course")) continue;

        // 學期平均、排名等 summary rows
        if (
          courseName.includes("平均") || courseName.includes("average") ||
          courseName.includes("操行") || courseName.includes("Behavior") ||
          courseName.includes("排名") || courseName.includes("ranking")
        ) {
          const value = cells[cells.length - 1] ?? "";
          if (value) summaryRows.push({ semester, label: courseName, value: value.trim() });
          continue;
        }

        // 正常成績 row: [Course, Class, CourseType, Credits, Score]
        const scoreIdx = cells.length >= 5 ? cells.length - 1 : 4;
        const creditsIdx = cells.length >= 5 ? cells.length - 2 : 3;
        const courseTypeIdx = cells.length >= 5 ? cells.length - 3 : 2;
        const classIdx = cells.length >= 5 ? cells.length - 4 : 1;

        const score = (cells[scoreIdx] ?? "").trim();
        if (!score) continue;

        const { zhName, enName } = parseCourseTitle(courseName);
        grades.push({
          semester,
          courseName: zhName,
          courseNameEn: enName,
          className: (cells[classIdx] ?? "").trim(),
          courseType: (cells[courseTypeIdx] ?? "").trim(),
          credits: parseInt(cells[creditsIdx] ?? "0", 10) || 0,
          score: normalizeScoreValue(score),
        });
      }
    }
  }

  return { grades: dedupeGradeRows(grades), summaryRows: dedupeSummaryRows(summaryRows) };
}

function parseGradeRows(html: string): { grades: PUGrade[]; summaryRows: { semester: string; label: string; value: string }[] } {
  // 優先嘗試「歷年修課明細」格式（學期標題 + per-table）
  const perSemResult = parsePerSemesterGrades(html);
  if (perSemResult.grades.length > 0) {
    console.log(`[parseGradeRows] Per-semester format: ${perSemResult.grades.length} grades`);
    return perSemResult;
  }

  // Fallback: 原始格式（單一大 table，column 0 = semester）
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
 * 從下拉選單提取可用學期列表。
 */
function extractAvailableSemesters(html: string): string[] {
  const semesters: string[] = [];
  const optionRegex = /<option[^>]*value=["']?(\d{4})["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = optionRegex.exec(html)) !== null) {
    if (!semesters.includes(m[1])) semesters.push(m[1]);
  }
  return semesters;
}

/**
 * 建構學期摘要物件。
 */
function buildGradeSummary(summaryRows: { semester: string; label: string; value: string }[]): PUGradeResult["summary"] {
  const summary: PUGradeResult["summary"] = {};
  for (const s of summaryRows) {
    if (!summary[s.semester]) summary[s.semester] = {};
    const entry = summary[s.semester];
    if (s.label.includes("系排名") || s.label.includes("Department")) {
      entry.departmentRanking = s.value;
    } else if (s.label.includes("班排名") || s.label.includes("Class")) {
      entry.classRanking = s.value;
    } else if (s.label.includes("操行") || s.label.includes("Behavior")) {
      entry.behaviorScore = parseFloat(s.value) || s.value;
    } else if (s.label.includes("平均") || s.label.includes("average")) {
      entry.semesterAverage = parseFloat(s.value) || s.value;
    }
  }
  return summary;
}

/**
 * 取得成績（注意：成績在不同 domain — mypu.pu.edu.tw）。
 *
 * 策略：
 * 1. 先 GET score_all.php 看回傳幾個學期
 * 2. 如果只有 ≤1 學期，嘗試 POST 或帶參數取得全部
 * 3. 如果頁面有學期下拉選單，逐學期抓取
 */
export async function puFetchGrades(
  _session: PUSession,
  semester?: string,
): Promise<{ success: boolean; data: PUGradeResult | null; error?: string }> {
  try {
    // 優先用 alcat（和登入同 domain，cookie 確定能用），
    // 若失敗再試 mypu。
    let result = await nativeFetch(`${ALCAT_BASE}/stu_query/score_all.php`);
    if (result.status !== 200 || result.html.length < 200) {
      console.log('[puFetchGrades] alcat fallback to mypu…');
      result = await nativeFetch(`${MYPU_BASE}${GRADE_PATH}`);
    }
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html)) {
      return { success: false, data: null, error: 'E校園 session 已失效，請重新登入' };
    }

    // ── 成績頁結構（2026-04 實測確認）：
    //   每個學期是一個 <p>學期別(Semester)：YYY [ T ]</p> 後接一個 5 欄 <table>
    //   欄位: 科目名稱(Course) | 修課班級(Class) | 修別(Course type) | 學分數(Credits) | 成績(Score)
    //   表尾有: 學期平均成績, 操行成績, 班排名, 系排名

    const grades: PUGrade[] = [];
    const summary: PUGradeResult['summary'] = {};

    // 1. 找出所有學期代碼：學期別(Semester)：YYY [ T ] → "YYYT"
    const semRegex = /學期別\(Semester\)[：:]\s*(\d+)\s*\[\s*(\d+)\s*\]/g;
    const semesterCodes: string[] = [];
    let semMatch: RegExpExecArray | null;
    while ((semMatch = semRegex.exec(html)) !== null) {
      semesterCodes.push(`${semMatch[1]}${semMatch[2]}`);
    }

    // 2. 找出所有含 "Score" 的 5 欄表格（跳過學年排名表等）
    const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
    const allTables = html.match(tableRegex) ?? [];
    const gradeTables: string[] = [];
    for (const table of allTables) {
      // 只取含 "Score" 或 "成績" 的 5 欄表格
      if (
        (table.includes('Score') || table.includes('成績')) &&
        (table.includes('Course') || table.includes('科目'))
      ) {
        gradeTables.push(table);
      }
    }

    // 3. 逐個表格配對學期並解析
    for (let i = 0; i < gradeTables.length; i++) {
      const sem = semesterCodes[i] ?? `unknown_${i}`;
      const rows = parseTable(gradeTables[i], '');

      if (!summary[sem]) summary[sem] = {};

      for (const cells of rows) {
        if (cells.length < 5) continue;
        // 跳過表頭
        if (cells[0].includes('Course') || cells[0].includes('科目名稱')) continue;

        const courseName = cells[0];
        const score = cells[4];

        // 摘要行（平均、操行、排名）
        if (
          courseName.includes('平均') ||
          courseName.includes('average') ||
          courseName.includes('操行') ||
          courseName.includes('Behavior') ||
          courseName.includes('排名') ||
          courseName.includes('ranking')
        ) {
          const entry = summary[sem];
          if (courseName.includes('系排名') || courseName.includes('Department')) {
            entry.departmentRanking = score;
          } else if (courseName.includes('班排名') || courseName.includes('Class')) {
            entry.classRanking = score;
          } else if (courseName.includes('操行') || courseName.includes('Behavior')) {
            entry.behaviorScore = parseFloat(score) || score;
          } else if (courseName.includes('平均') || courseName.includes('average')) {
            entry.semesterAverage = parseFloat(score) || score;
          }
          continue;
        }

        const { zhName, enName } = parseCourseTitle(courseName);
        grades.push({
          semester: sem,
          courseName: zhName,
          courseNameEn: enName,
          className: cells[1],
          courseType: cells[2],
          credits: parseInt(cells[3], 10) || 0,
          score: score === '通過(Pass)' ? 'Pass' : parseFloat(score) || score,
        });
      }
    }

    const filteredGrades = semester ? grades.filter((g) => g.semester === semester) : grades;

    return {
      success: true,
      data: {
        grades: filteredGrades,
        allSemesters: [...new Set(grades.map((g) => g.semester))],
        summary,
      },
    };
  } catch (err) {
    console.error('[puFetchGrades]', err);
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : '抓取成績失敗',
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// ── Comprehensive Credit Audit Parser (v2) ──────────────────
// ═══════════════════════════════════════════════════════════════

/**
 * Parse 修習學分累計 from the 【】bracket format in tab_1.php
 */
function parseCreditTotals(html: string): PuCreditTotals {
  const text = stripTags(html).replace(/\s+/g, " ");
  console.log("[parseCreditTotals] Stripped text sample (last 600 chars):", text.slice(-600));

  const extract = (label: string): number | null => {
    // Allow whitespace between 】 and ：, and between ： and the number
    // Also handle optional "學分" suffix and variations like "： 51學分"
    const patterns = [
      new RegExp(`【${label}】\\s*[：:]\\s*(\\d+)`, "i"),
      new RegExp(`【${label}[^】]*】\\s*[：:]\\s*(\\d+)`, "i"),
      // Fallback: label followed by number anywhere nearby (within 20 chars)
      new RegExp(`${label}[】\\s：:]*?(\\d+)\\s*學分`, "i"),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        console.log(`[parseCreditTotals] Matched "${label}" = ${m[1]} via ${re.source}`);
        return parseInt(m[1], 10);
      }
    }
    return null;
  };

  // 小計 has special format: 【小計(...)】：88 or 【小計(不含輔雙)】 ： 88
  const subtotalPatterns = [
    /【小計[^】]*】\s*[：:]\s*(\d+)/,
    /小計[^）)]*[）)】]?\s*[：:]\s*(\d+)/,
    /小計\s*[（(][^）)]*[）)]\s*[】]?\s*[：:]\s*(\d+)/,
  ];
  let subtotal: number | null = null;
  for (const re of subtotalPatterns) {
    const m = text.match(re);
    if (m) {
      subtotal = parseInt(m[1], 10);
      console.log(`[parseCreditTotals] Matched subtotal = ${subtotal} via ${re.source}`);
      break;
    }
  }

  const result = {
    required: extract("必修"),
    elective: extract("選修"),
    externalElective: extract("外系選修"),
    generalOld: extract("通識-六大學群"),
    generalNew: extract("通識-四大向度"),
    subtotal,
    minorDouble: extract("輔雙"),
  };
  console.log("[parseCreditTotals] Final result:", JSON.stringify(result));
  return result;
}

/**
 * Parse 必修尚缺科目 section from tab_1.php
 * The section starts with header "必修（校定及專業必修）" and goes until "通識"
 */
function parseMissingRequiredCourses(html: string): PuMissingRequiredCourse[] {
  const courses: PuMissingRequiredCourse[] = [];

  // Extract the 必修 section (table 0)
  const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) ?? [];
  if (tables.length === 0) return courses;

  const firstTable = tables[0];
  // Check if it contains 必修
  if (!firstTable.includes("必修")) return courses;

  const text = stripTags(firstTable);
  // If it says 尚無紀錄, no missing courses
  if (text.includes("尚無紀錄")) return courses;

  // Parse rows for course names and status
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(firstTable)) !== null) {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null;
    while ((c = cellRegex.exec(m[1])) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (cells.length < 1) continue;
    const name = cells[0].trim();
    // Skip headers and section titles
    if (!name || name.includes("必修") || name.includes("尚缺") || name.includes("尚無")
        || name.includes("科目名稱") || name.includes("通識") || name.includes("應修得")) continue;

    // Detect status from bgcolor or text
    const rowHtml = m[1];
    let status: string = "缺修";
    if (rowHtml.includes("bgcolor") || rowHtml.includes("background")) {
      // Color coding: green=通過, red=缺修, yellow=修習中, blue=免修
      if (rowHtml.includes("#00") || rowHtml.includes("green")) status = "通過";
      else if (rowHtml.includes("yellow") || rowHtml.includes("#FF")) status = "修習中";
      else if (rowHtml.includes("blue")) status = "免修";
    }

    courses.push({
      courseName: name,
      status,
      rules: cells.length > 1 ? cells.slice(1).join(" ").trim() || undefined : undefined,
    });
  }

  return courses;
}

/**
 * Parse 各向度修習情形 table from tab_1.php
 * Headers: 通識向度 | 通識課程至少應修學分數 | 取得學分數 | 備註
 */
function parseGeneralEdDimensions(html: string): PuGeneralEdDimension[] {
  const dimensions: PuGeneralEdDimension[] = [];
  const tables = parseAllTables(html);

  for (const rows of tables) {
    // Find table with "通識向度" + "應修學分" header pattern
    const headerRow = rows.find(r =>
      r.some(c => c.includes("通識向度")) && r.some(c => c.includes("應修") || c.includes("學分數"))
    );
    if (!headerRow) continue;

    for (const cells of rows) {
      if (cells === headerRow) continue;
      if (cells.length < 3) continue;
      const dimension = cells[0]?.trim();
      if (!dimension || dimension.includes("通識向度") || dimension.includes("各學群")) continue;

      dimensions.push({
        dimension,
        requiredCredits: parseInt(cells[1], 10) || 0,
        earnedCredits: parseInt(cells[2], 10) || 0,
        note: cells[3]?.trim() || undefined,
      });
    }
  }

  return dimensions;
}

/**
 * Parse 110學年度起四大向度通識必修 section
 * Headers: 通識向度 | 學分 | 科目名稱
 */
function parseRequiredGeneralCourses(html: string): PuRequiredGeneralCourse[] {
  const courses: PuRequiredGeneralCourse[] = [];
  const tables = parseAllTables(html);

  for (const rows of tables) {
    // Find the header row with 通識向度 + 學分 + 科目名稱
    const headerIdx = rows.findIndex(r =>
      r.length >= 3 && r.some(c => c.includes("通識向度")) && r.some(c => c === "學分" || c.includes("學分"))
    );
    if (headerIdx < 0) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.length < 3) continue;
      const dimension = cells[0]?.trim();
      if (!dimension || dimension.includes("各學群") || dimension.includes("修習情形")) break;

      courses.push({
        dimension,
        credits: parseInt(cells[1], 10) || 0,
        courseName: cells[2]?.trim() ?? "",
      });
    }
  }

  return courses;
}

/**
 * Parse 修習中通識科目 table
 * Headers: 課群名稱 | 課程名稱 | 開課年級 | 學期 | 學分數 | 修課規定
 */
function parseInProgressGeneralCourses(html: string): PuInProgressGeneralCourse[] {
  const courses: PuInProgressGeneralCourse[] = [];
  const tables = parseAllTables(html);

  for (const rows of tables) {
    const headerIdx = rows.findIndex(r =>
      r.some(c => c.includes("課群名稱")) && r.some(c => c.includes("課程名稱"))
    );
    if (headerIdx < 0) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.length < 4) continue;
      const courseGroup = cells[0]?.trim();
      const courseName = cells[1]?.trim();
      if (!courseName) continue;

      courses.push({
        courseGroup: courseGroup || "",
        courseName,
        grade: cells[2]?.trim() ?? "",
        semester: cells[3]?.trim() ?? "",
        credits: parseInt(cells[4] ?? "0", 10) || 0,
        rules: cells[5]?.trim() || undefined,
      });
    }
  }

  return courses;
}

/**
 * Parse 專業選修必備選項 table
 * Headers: 課群名稱 | 課程名稱 | 修課班級 | 學期 | 學分數 | 取得學分 | 修課規定
 */
function parseProfessionalElectiveOptions(html: string): PuProfessionalElectiveOption[] {
  const options: PuProfessionalElectiveOption[] = [];
  // Find section after 專業選修必備選項
  const sectionIdx = html.indexOf("專業選修必備選項");
  if (sectionIdx < 0) return options;

  const sectionHtml = html.substring(sectionIdx);
  // Find next section marker (修習學分累計)
  const endIdx = sectionHtml.indexOf("修習學分累計");
  const slice = endIdx > 0 ? sectionHtml.substring(0, endIdx) : sectionHtml;

  const tables = parseAllTables(slice);
  for (const rows of tables) {
    for (const cells of rows) {
      if (cells.length < 4) continue;
      if (cells.some(c => c.includes("課群名稱") || c.includes("課程名稱"))) continue;

      const courseName = cells[1]?.trim();
      if (!courseName) continue;

      options.push({
        courseGroup: cells[0]?.trim() ?? "",
        courseName,
        className: cells[2]?.trim() || undefined,
        semester: cells[3]?.trim() || undefined,
        credits: parseInt(cells[4] ?? "0", 10) || undefined,
        earnedCredits: parseInt(cells[5] ?? "0", 10) || undefined,
        rules: cells[6]?.trim() || undefined,
      });
    }
  }

  return options;
}

/**
 * Parse notes/disclaimers from the bottom of tab_1
 */
function parseAuditNotes(html: string): string[] {
  const notes: string[] = [];
  const creditIdx = html.indexOf("修習學分累計");
  if (creditIdx < 0) return notes;

  const bottomText = stripTags(html.substring(creditIdx));
  // Extract numbered notes: 1.xxx 2.xxx 3.xxx
  const noteMatches = bottomText.match(/\d+\.[^.]+(?:\.|$)/g);
  if (noteMatches) {
    for (const note of noteMatches) {
      const clean = note.trim();
      if (clean.length > 10) notes.push(clean);
    }
  }
  return notes;
}

/**
 * Parse 通識已修明細 section
 */
function parseCompletedGeneralCourses(html: string): string[] {
  const courses: string[] = [];
  const sectionIdx = html.indexOf("通識已修明細");
  if (sectionIdx < 0) return courses;

  // Get text between "通識已修明細" and the next major section
  const sectionHtml = html.substring(sectionIdx);
  const endMarkers = ["110學年度", "各學群", "修習中通識", "尚缺必選"];
  let endIdx = sectionHtml.length;
  for (const marker of endMarkers) {
    const idx = sectionHtml.indexOf(marker);
    if (idx > 0 && idx < endIdx) endIdx = idx;
  }

  const text = stripTags(sectionHtml.substring(0, endIdx));
  if (text.includes("尚無紀錄")) return courses;

  // If there's table data, parse course names from it
  const slice = sectionHtml.substring(0, endIdx);
  const tables = parseAllTables(slice);
  for (const rows of tables) {
    for (const cells of rows) {
      const name = cells[0]?.trim();
      if (name && !name.includes("通識") && !name.includes("已修") && name.length > 1) {
        courses.push(name);
      }
    }
  }

  return courses;
}

/**
 * Parse sections that may contain "尚無紀錄" — returns items or empty
 */
function parseSimpleListSection(html: string, sectionName: string): string[] {
  const idx = html.indexOf(sectionName);
  if (idx < 0) return [];

  const sectionHtml = html.substring(idx, idx + 2000);
  const text = stripTags(sectionHtml).substring(0, 500);
  if (text.includes("尚無紀錄")) return [];

  // Return non-empty lines that aren't the section header
  return text.split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 1 && !l.includes(sectionName));
}

/**
 * Parse score_all.php for 歷年修課明細
 */
function parseScoreAllPage(html: string): {
  studentId?: string;
  studentName?: string;
  academicYearRankings: PuAcademicYearRanking[];
  semesterGrades: PuSemesterGradeRecord[];
} {
  const result: ReturnType<typeof parseScoreAllPage> = {
    academicYearRankings: [],
    semesterGrades: [],
  };

  const text = stripTags(html);

  // Student info
  const idMatch = text.match(/學號\(Student (?:number|No\.?)\)[：:]\s*(\d+)/);
  const nameMatch = text.match(/姓名\(Name\)[：:]\s*([^\s]+)/);
  if (idMatch) result.studentId = idMatch[1];
  if (nameMatch) result.studentName = nameMatch[1];

  // 學年排名
  const yearRankRegex = /(\d{2,3})學年\(Academic Year\)\s*班排名\(Class ranking\)[：:]\s*(\d+\s*\/\s*\d+)\s*系排名\(Department ranking\)[：:]\s*(\d+\s*\/\s*\d+)/g;
  let yrm: RegExpExecArray | null;
  while ((yrm = yearRankRegex.exec(text)) !== null) {
    result.academicYearRankings.push({
      academicYear: yrm[1].trim(),
      classRanking: yrm[2].trim(),
      departmentRanking: yrm[3].trim(),
    });
  }

  // Per-semester grades (reuse existing parsePerSemesterGrades + enhance)
  const semesterSections = html.split(/學期別\(Semester\)/);
  for (let i = 1; i < semesterSections.length; i++) {
    const section = semesterSections[i];
    const semMatch = section.match(/[：:]\s*(\d{2,3})\s*\[\s*(\d+)\s*\]/);
    if (!semMatch) continue;
    const semester = `${semMatch[1]}${semMatch[2]}`;

    const record: PuSemesterGradeRecord = {
      semester,
      courses: [],
    };

    // Parse course rows from table in this section
    const sectionTables = parseAllTables(section);
    for (const rows of sectionTables) {
      for (const cells of rows) {
        if (cells.length < 5) continue;
        const courseName = cells[0]?.trim();
        if (!courseName) continue;
        if (courseName.includes("科目名稱") || courseName.includes("Course")) continue;

        // Summary rows
        const sectionText = stripTags(section);
        if (courseName.includes("平均") || courseName.includes("average")) {
          const val = cells[cells.length - 1]?.trim();
          record.semesterAverage = parseFloat(val) || val;
          continue;
        }
        if (courseName.includes("操行") || courseName.includes("Behavior")) {
          const val = cells[cells.length - 1]?.trim();
          record.behaviorScore = parseFloat(val) || val;
          continue;
        }
        if (courseName.includes("班排名") || courseName.includes("Class ranking")) {
          record.classRanking = cells[cells.length - 1]?.trim();
          continue;
        }
        if (courseName.includes("系排名") || courseName.includes("Department ranking")) {
          record.departmentRanking = cells[cells.length - 1]?.trim();
          continue;
        }

        // Normal course row
        const scoreIdx = cells.length - 1;
        const creditsIdx = cells.length - 2;
        const courseTypeIdx = cells.length - 3;
        const classIdx = cells.length - 4;

        const score = (cells[scoreIdx] ?? "").trim();
        if (!score) continue;

        const { zhName, enName } = parseCourseTitle(courseName);
        record.courses.push({
          courseName: zhName,
          courseNameEn: enName,
          className: (cells[classIdx] ?? "").trim(),
          courseType: (cells[courseTypeIdx] ?? "").trim(),
          credits: parseInt(cells[creditsIdx] ?? "0", 10) || 0,
          score: normalizeScoreValue(score),
        });
      }
    }

    // Also try to get summary from text directly if table parsing missed it
    const secText = stripTags(section);
    if (!record.semesterAverage) {
      const avgMatch = secText.match(/學期平均成績\(Semester average\)\s*([\d.]+)/);
      if (avgMatch) record.semesterAverage = parseFloat(avgMatch[1]);
    }
    if (!record.behaviorScore) {
      const behMatch = secText.match(/操行成績\(Behavior score\)\s*([\d.]+)/);
      if (behMatch) record.behaviorScore = parseFloat(behMatch[1]);
    }
    if (!record.classRanking) {
      const crMatch = secText.match(/班排名\(Class ranking\)\s*([\d\s/]+)/);
      if (crMatch) record.classRanking = crMatch[1].trim();
    }
    if (!record.departmentRanking) {
      const drMatch = secText.match(/系排名\(Department ranking\)\s*([\d\s/]+)/);
      if (drMatch) record.departmentRanking = drMatch[1].trim();
    }

    if (record.courses.length > 0) {
      result.semesterGrades.push(record);
    }
  }

  return result;
}

/**
 * Build legacy compat fields from PuCreditTotals
 */
function buildLegacyCompat(totals: PuCreditTotals): {
  total: { earned: number | null; required: number | null; remaining: number | null };
  byCategory: Partial<Record<CreditCategory, PuCreditAuditCategorySummary>>;
} {
  const earned = totals.subtotal;
  const byCategory: Partial<Record<CreditCategory, PuCreditAuditCategorySummary>> = {};
  if (totals.required != null) {
    byCategory.required = { label: "必修", earned: totals.required, required: null, remaining: null };
  }
  if (totals.elective != null) {
    byCategory.elective = { label: "選修", earned: totals.elective, required: null, remaining: null };
  }
  const generalTotal = (totals.generalOld ?? 0) + (totals.generalNew ?? 0);
  if (generalTotal > 0 || totals.generalOld != null || totals.generalNew != null) {
    byCategory.general = { label: "通識", earned: generalTotal, required: null, remaining: null };
  }

  return {
    total: { earned, required: null, remaining: null },
    byCategory,
  };
}

/**
 * 全新的學分試算抓取 — 完整抓取所有 tabs 的資料
 */
export async function puFetchCreditAudit(
  _session: PUSession,
): Promise<{ success: boolean; data: PuCreditAuditPayload | null; error?: string }> {
  try {
    console.log("[puFetchCreditAudit v2] Starting comprehensive fetch...");

    // ── Parallel fetch all tabs ──
    const [tab1Res, tab2Res, tab3Res, tab4Res, scoreAllRes] = await Promise.allSettled([
      nativeFetch(`${ALCAT_BASE}${CREDIT_AUDIT_TAB1}`),
      nativeFetch(`${ALCAT_BASE}${CREDIT_AUDIT_TAB2}`),
      nativeFetch(`${ALCAT_BASE}${CREDIT_AUDIT_TAB3}`),
      nativeFetch(`${ALCAT_BASE}${CREDIT_AUDIT_TAB4}`),
      nativeFetch(`${ALCAT_BASE}${ALCAT_GRADE_ALL}`),
    ]);

    // Helper: check if HTML is a valid data page (not login-expired)
    const isValidPage = (res: PromiseSettledResult<{ html: string; status: number }>): string => {
      if (res.status !== "fulfilled") return "";
      if (res.value.status !== 200) return "";
      const html = res.value.html;
      // Detect session-expired / login redirect pages
      if (html.includes("尚未登入") || html.includes("Not yet logged in") || html.includes("請重新登入")) {
        console.warn("[puFetchCreditAudit v2] Session expired detected in response");
        return "";
      }
      return html;
    };

    const tab1Html = isValidPage(tab1Res);
    const tab2Html = isValidPage(tab2Res);
    const tab3Html = isValidPage(tab3Res);
    const tab4Html = isValidPage(tab4Res);
    const scoreAllHtml = isValidPage(scoreAllRes);

    console.log(`[puFetchCreditAudit v2] Page lengths: tab1=${tab1Html.length}, tab2=${tab2Html.length}, tab3=${tab3Html.length}, tab4=${tab4Html.length}, scoreAll=${scoreAllHtml.length}`);

    if (!tab1Html && !scoreAllHtml) {
      return { success: false, data: null, error: "無法連線到學分試算頁面（可能需要重新登入）" };
    }

    // ── Parse tab_1.php sections ──
    // Use 'let' because we may fill in fallback values from scoreAll data
    let creditTotals = parseCreditTotals(tab1Html);
    const missingRequiredCourses = parseMissingRequiredCourses(tab1Html);
    const completedGeneralCourses = parseCompletedGeneralCourses(tab1Html);
    const requiredGeneralCourses = parseRequiredGeneralCourses(tab1Html);
    const generalEdDimensions = parseGeneralEdDimensions(tab1Html);
    const inProgressGeneralCourses = parseInProgressGeneralCourses(tab1Html);
    const professionalElectiveOptions = parseProfessionalElectiveOptions(tab1Html);
    const notes = parseAuditNotes(tab1Html);

    // Simple sections that may be "尚無紀錄"
    const missingElectiveRaw = parseSimpleListSection(tab1Html, "尚缺必選科目");
    const missingRequiredElectives: PuMissingRequiredElective[] = missingElectiveRaw.map(
      name => ({ courseName: name })
    );

    const repeatedRaw = parseSimpleListSection(tab1Html, "重覆修習科目");
    const repeatedCourses: PuRepeatedCourse[] = repeatedRaw.map(
      name => ({ courseName: name })
    );

    const certRaw = parseSimpleListSection(tab1Html, "已通過之校內檢定");
    const passedCertifications: PuPassedCertification[] = certRaw.map(
      name => ({ name })
    );

    // ── Parse tab_2/3/4 simple status text ──
    const tab2Text = stripTags(tab2Html).trim();
    const tab3Text = stripTags(tab3Html).trim();
    const tab4Text = stripTags(tab4Html).trim();

    console.log(`[puFetchCreditAudit v2] Parsed creditTotals:`, JSON.stringify(creditTotals));
    console.log(`[puFetchCreditAudit v2] generalEdDimensions: ${generalEdDimensions.length}, inProgressGeneral: ${inProgressGeneralCourses.length}`);

    // ── Parse score_all.php ──
    const scoreData = parseScoreAllPage(scoreAllHtml);
    console.log(`[puFetchCreditAudit v2] scoreAll: ${scoreData.semesterGrades.length} semesters, student=${scoreData.studentId}`);

    // ── Fallback: if creditTotals are all null, compute from scoreAll grades ──
    if (creditTotals.subtotal == null && creditTotals.required == null && creditTotals.elective == null) {
      console.warn("[puFetchCreditAudit v2] creditTotals all null — computing fallback from semesterGrades");
      let totalPassedCredits = 0;
      for (const sem of scoreData.semesterGrades) {
        for (const course of sem.courses) {
          const scoreStr = String(course.score).toLowerCase();
          const score = typeof course.score === "number" ? course.score : parseFloat(scoreStr);
          const passed = !isNaN(score) && score >= 60;
          // Also count "Pass", "通過", "通過(Pass)" for P/F courses
          const isPassText = scoreStr.includes("通過") || scoreStr === "pass";
          if (passed || isPassText) {
            totalPassedCredits += course.credits;
          }
        }
      }
      if (totalPassedCredits > 0) {
        creditTotals.subtotal = totalPassedCredits;
        console.log(`[puFetchCreditAudit v2] Fallback subtotal from grades: ${totalPassedCredits}`);
      }
    }

    // ── Build legacy compat ──
    const legacyCompat = buildLegacyCompat(creditTotals);

    const payload: PuCreditAuditPayload = {
      version: 2,
      fetchedAt: new Date().toISOString(),

      // tab_1.php
      missingRequiredCourses,
      completedGeneralCourses,
      requiredGeneralCourses,
      generalEdDimensions,
      inProgressGeneralCourses,
      missingRequiredElectives,
      repeatedCourses,
      passedCertifications,
      professionalElectiveOptions,
      creditTotals,
      notes,

      // tab_2/3/4
      minorDoubleMajorStatus: tab2Text || "尚無資料",
      graduationConditionsStatus: tab3Text || "尚無資料",
      programStatus: tab4Text || "尚無資料",

      // score_all.php
      studentId: scoreData.studentId,
      studentName: scoreData.studentName,
      academicYearRankings: scoreData.academicYearRankings,
      semesterGrades: scoreData.semesterGrades,

      // Legacy compat
      total: legacyCompat.total,
      byCategory: legacyCompat.byCategory,
    };

    console.log(`[puFetchCreditAudit v2] Done. creditTotals.subtotal=${creditTotals.subtotal}, semesters=${scoreData.semesterGrades.length}, dimensions=${generalEdDimensions.length}`);
    return { success: true, data: payload };
  } catch (err) {
    console.error("[puFetchCreditAudit v2]", err);
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : "抓取學分試算失敗",
    };
  }
}

/**
 * Helper: Extract date from text near a link element.
 * Tries patterns: YYYY/MM/DD, YYYY-MM-DD, ROC_YEAR/MM/DD (e.g., 113/04/13)
 */
function extractDateFromText(text: string): string | null {
  if (!text) return null;

  // Try modern date pattern (YYYY/MM/DD or YYYY-MM-DD)
  const modernMatch = text.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (modernMatch) {
    const [, year, month, day] = modernMatch;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Try ROC year pattern (YYY/MM/DD, e.g., 113/04/13 = 2024/04/13)
  const rocMatch = text.match(/(\d{2,3})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (rocMatch) {
    const [, rocYear, month, day] = rocMatch;
    const yearNum = parseInt(rocYear, 10);
    const gregorianYear = yearNum >= 1000 ? yearNum : yearNum + 1911; // ROC year = AD - 1911
    return `${gregorianYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

/**
 * 取得公告。
 */
export async function puFetchAnnouncements(
  _session: PUSession,
): Promise<{ success: boolean; data: PUAnnouncement[]; error?: string }> {
  try {
    const result = await nativeFetch(`${ALCAT_BASE}${MENU_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: [], error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html)) {
      return { success: false, data: [], error: 'E校園 session 已失效，請重新登入' };
    }

    return { success: true, data: extractAnnouncementsFromHtml(html) };
  } catch (err) {
    console.error('[puFetchAnnouncements]', err);
    return { success: false, data: [], error: err instanceof Error ? err.message : '抓取公告失敗' };
  }
}

/**
 * Helper: Parse class name like "資管三A" to extract department and grade.
 */
function parseClassName(className: string): { department: string | null; grade: string | null } {
  if (!className) return { department: null, grade: null };

  // Pattern: 系名 + 年級 + 班級 (e.g., "資管三A" → dept="資管", grade="三", class="A")
  const match = className.match(/^([^\d一二三四]+)(一|二|三|四|1|2|3|4)?([A-Z])?$/);
  if (match) {
    return { department: match[1] || null, grade: match[2] || null };
  }

  return { department: null, grade: null };
}

/**
 * Helper: Extract teacher name from email or HTML context.
 * If email like "changyi@pu.edu.tw", returns "changyi" as display name.
 */
function extractTeacherName(emailOrText: string): string {
  if (!emailOrText) return '';

  // If it's an email, extract the prefix
  const emailMatch = emailOrText.match(/^([^@]+)@/);
  if (emailMatch) return emailMatch[1];

  // Otherwise return as-is (might already be a name)
  return emailOrText.trim();
}

/**
 * 取得學生基本資料。
 */
export async function puFetchStudentInfo(
  _session: PUSession,
): Promise<{ success: boolean; data: PUStudentInfo | null; error?: string }> {
  try {
    const result = await nativeFetch(`${ALCAT_BASE}${COURSE_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html) || !hasPuStudentContext(html)) {
      return { success: false, data: null, error: 'E校園 session 已失效，請重新登入' };
    }
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);

    const className = classMatch?.[1] ?? null;
    const { department, grade } = className
      ? parseClassName(className)
      : { department: null, grade: null };

    // Try to extract enrollment status from HTML (e.g., "在學", "休學")
    const enrollStatusMatch = html.match(/學籍狀態[：:]\s*([^\s<]+)|Status[：:]\s*([^\s<]+)/);
    const enrollmentStatus = enrollStatusMatch?.[1] ?? enrollStatusMatch?.[2] ?? null;

    return {
      success: true,
      data: {
        studentId: idMatch?.[1] ?? null,
        name: nameMatch?.[1] ?? null,
        className,
        currentSemester: semMatch ? `${semMatch[1]}${semMatch[2]}` : null,
        department,
        grade,
        enrollmentStatus,
      },
    };
  } catch (err) {
    console.error('[puFetchStudentInfo]', err);
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : '抓取學生資料失敗',
    };
  }
}

/**
 * 取得缺曠紀錄。
 */
export async function puFetchAbsence(
  _session: PUSession,
): Promise<{ success: boolean; data: PUAbsence[]; error?: string }> {
  try {
    // Try multiple possible absence page URLs
    const possiblePaths = [
      '/stu_query/query_absence.html',
      '/stu_query/absence.html',
      '/stu_query/query_abs.html',
    ];

    let result: { html: string; status: number } | null = null;

    for (const path of possiblePaths) {
      const fetchResult = await nativeFetch(`${ALCAT_BASE}${path}`);
      if (fetchResult.status === 200 && fetchResult.html.length > 200) {
        result = fetchResult;
        break;
      }
    }

    if (!result) {
      return { success: false, data: [], error: '無法取得缺曠紀錄頁面' };
    }

    const html = result.html;
    const absences: PUAbsence[] = [];

    // Parse absence table: typically contains columns like:
    // 日期 | 課程 | 節次 | 缺曠類別 | 狀態
    const rows = parseTable(html, '');

    for (const cells of rows) {
      if (cells.length < 5) continue;
      // Skip header rows
      if (
        cells[0].includes('日期') ||
        cells[0].includes('Date') ||
        cells[0].includes('課程') ||
        cells[0].includes('Course')
      ) {
        continue;
      }

      absences.push({
        date: cells[0] || '',
        courseName: cells[1] || '',
        period: cells[2] || '',
        absenceType: cells[3] || '',
        status: cells[4] || '',
      });
    }

    return { success: true, data: absences };
  } catch (err) {
    console.error('[puFetchAbsence]', err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : '抓取缺曠紀錄失敗',
    };
  }
}

/**
 * 取得學分統計。
 */
export async function puFetchCreditSummary(
  _session: PUSession,
): Promise<{ success: boolean; data: PUCreditSummary | null; error?: string }> {
  try {
    // Try multiple possible credit page URLs
    const possiblePaths = [
      '/stu_query/query_credit.html',
      '/stu_query/credit_check.html',
      '/stu_query/credit.html',
    ];

    let result: { html: string; status: number } | null = null;

    for (const path of possiblePaths) {
      const fetchResult = await nativeFetch(`${ALCAT_BASE}${path}`);
      if (fetchResult.status === 200 && fetchResult.html.length > 200) {
        result = fetchResult;
        break;
      }
    }

    if (!result) {
      return { success: false, data: null, error: '無法取得學分統計頁面' };
    }

    const html = result.html;
    const categories: PUCreditSummary['categories'] = [];
    let totalRequired = 0;
    let totalEarned = 0;

    // Parse credit table: typically contains columns like:
    // 科目類別 | 應修學分 | 已修學分 | 狀態
    const rows = parseTable(html, '');

    for (const cells of rows) {
      if (cells.length < 3) continue;
      // Skip header rows
      if (cells[0].includes('類別') || cells[0].includes('Category') || cells[0].includes('應修')) {
        continue;
      }

      const categoryName = cells[0];
      const required = parseInt(cells[1], 10) || 0;
      const earned = parseInt(cells[2], 10) || 0;

      if (categoryName && categoryName.trim()) {
        categories.push({ category: categoryName, required, earned });
        totalRequired += required;
        totalEarned += earned;
      }
    }

    return {
      success: true,
      data: { totalRequired, totalEarned, categories },
    };
  } catch (err) {
    console.error('[puFetchCreditSummary]', err);
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : '抓取學分統計失敗',
    };
  }
}

/**
 * 取得詳細的公告（從主要portal頁面，包含多個公告源）。
 */
export async function puFetchDetailedAnnouncements(
  _session: PUSession,
): Promise<{ success: boolean; data: PUDetailedAnnouncement[]; error?: string }> {
  try {
    // Try to fetch the main portal/menu page
    const possiblePaths = ['/index_frame.php', '/index_menu.php', '/'];

    let result: { html: string; status: number } | null = null;

    for (const path of possiblePaths) {
      const fetchResult = await nativeFetch(`${ALCAT_BASE}${path}`);
      if (fetchResult.status === 200 && fetchResult.html.length > 200) {
        result = fetchResult;
        break;
      }
    }

    if (!result) {
      return { success: false, data: [], error: '無法取得公告頁面' };
    }

    const html = result.html;
    const announcements: PUDetailedAnnouncement[] = [];

    // Extract announcements from different categories
    // Look for sections like: <h3>系統公告</h3>, <h3>校園公告</h3>, etc.
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let currentCategory = '其他';

    // First pass: identify category sections
    const sectionRegex = /(<h[2-4][^>]*>([^<]+)<\/h[2-4]>[\s\S]*?)(?=<h[2-4]|$)/gi;
    let sectionMatch: RegExpExecArray | null;

    while ((sectionMatch = sectionRegex.exec(html)) !== null) {
      const sectionText = sectionMatch[1];
      const categoryMatch = sectionText.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i);

      if (categoryMatch) {
        currentCategory = stripTags(categoryMatch[1]);
      }

      // Extract links from this section
      linkRegex.lastIndex = 0;
      let linkMatch: RegExpExecArray | null;

      while ((linkMatch = linkRegex.exec(sectionText)) !== null) {
        const href = linkMatch[1];
        const linkContent = linkMatch[2];
        const linkText = stripTags(linkContent);

        if (linkText && linkText.length > 2 && !href.includes('javascript:')) {
          // Extract date if available
          const dateStr =
            extractDateFromText(linkContent) || new Date().toISOString().split('T')[0];

          // Check for "new" or "important" indicators (e.g., <img src="new.gif">, <span class="new">)
          const isNew = /new|最新|NEW/i.test(linkContent);
          const isImportant = /important|重要|important|red/i.test(linkContent);

          announcements.push({
            title: linkText,
            url: href.startsWith('http') ? href : `${ALCAT_BASE}/${href.replace(/^\//, '')}`,
            date: dateStr,
            category: currentCategory,
            isNew,
            isImportant,
          });
        }
      }
    }

    return { success: true, data: announcements };
  } catch (err) {
    console.error('[puFetchDetailedAnnouncements]', err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : '抓取詳細公告失敗',
    };
  }
}
