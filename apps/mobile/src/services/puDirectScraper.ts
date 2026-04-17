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

// ─── Constants ───────────────────────────────────────────

const ALCAT_BASE = "https://alcat.pu.edu.tw";
const MYPU_BASE = "https://mypu.pu.edu.tw";
const LOGIN_PATH = "/index_check.php";
const COURSE_PATH = "/stu_query/query_course.html";
const GRADE_PATH = "/score_query/score_all.php";
const MENU_PATH = "/index_menu.php";

/** 靜宜大學節次 → 時間對照表 */
const PERIOD_TIME_MAP: Record<number, { start: string; end: string }> = {
  1: { start: "08:10", end: "09:00" },
  2: { start: "09:10", end: "10:00" },
  3: { start: "10:10", end: "11:00" },
  4: { start: "11:10", end: "12:00" },
  5: { start: "13:10", end: "14:00" },
  6: { start: "14:10", end: "15:00" },
  7: { start: "15:10", end: "16:00" },
  8: { start: "16:10", end: "17:00" },
  9: { start: "17:10", end: "18:00" },
  10: { start: "18:30", end: "19:20" },
  11: { start: "19:25", end: "20:15" },
  12: { start: "20:20", end: "21:10" },
  13: { start: "21:15", end: "22:05" },
};

const DAY_MAP: Record<string, number> = {
  "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7,
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
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

// ─── HTML Helpers ────────────────────────────────────────

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
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
    normalized.includes("action=\"index_check.php\"") ||
    normalized.includes("action='index_check.php'") ||
    (normalized.includes("name=\"uid\"") && normalized.includes("name=\"upassword\"")) ||
    (normalized.includes("name='uid'") && normalized.includes("name='upassword'"))
  );
}

function hasPuStudentContext(html: string): boolean {
  return (
    html.includes("學號(Student No.)") ||
    html.includes("姓名(Student Name)") ||
    html.includes("Student No.") ||
    html.includes("query_course")
  );
}

function normalizePuUrl(href: string): string {
  try {
    return new URL(href, `${ALCAT_BASE}/`).toString();
  } catch {
    return `${ALCAT_BASE}/${href.replace(/^\//, "")}`;
  }
}

function isUsefulAnnouncementLink(title: string, href: string, hasDate: boolean): boolean {
  if (!title || title.length < 4) return false;
  if (!href || /^javascript:/i.test(href) || href.startsWith("#")) return false;
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
  const todayStr = new Date().toISOString().split("T")[0];

  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[0];
    const rowText = stripTags(rowHtml);
    const extractedDate = extractDateFromText(rowText) ?? extractDateFromText(rowHtml);
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch: RegExpExecArray | null;

    while ((linkMatch = linkRegex.exec(rowHtml)) !== null) {
      const href = linkMatch[1]?.trim() ?? "";
      const title = stripTags(linkMatch[2] ?? "");
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
    const href = linkMatch[1]?.trim() ?? "";
    const title = stripTags(linkMatch[2] ?? "");
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
  const s = raw.replace(/\u3000/g, " ").trim();

  const match = s.match(/^([一二三四五六日])\((\w+)\)\s*([\d,\s]+):?(.*)$/);
  if (!match) return null;

  const dayOfWeek = DAY_MAP[match[1]] ?? 1;
  const periods = match[3]
    .split(",")
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => !isNaN(n));
  const location = match[4]?.trim() ?? "";

  const firstPeriod = Math.min(...periods);
  const lastPeriod = Math.max(...periods);
  const startTime = PERIOD_TIME_MAP[firstPeriod]?.start ?? "08:10";
  const endTime = PERIOD_TIME_MAP[lastPeriod]?.end ?? "09:00";

  return { dayOfWeek, periods, location, startTime, endTime };
}

function parseCourseTitle(raw: string): { zhName: string; enName: string } {
  const boundary = raw.search(/[A-Z]/);
  if (boundary > 0) {
    return { zhName: raw.slice(0, boundary).trim(), enName: raw.slice(boundary).trim() };
  }
  return { zhName: raw.trim(), enName: "" };
}

// ─── Fetch Helpers ───────────────────────────────────────
//
// React Native 的 fetch 無法讀取 set-cookie header（原生安全限制），
// 所以我們不再自己管 cookie，改用 credentials: "include" 讓
// iOS (NSURLSession) / Android (OkHttp) 的原生 cookie jar 自動處理。

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function nativeFetch(
  url: string,
  options: { method?: string; body?: string; contentType?: string } = {}
): Promise<{ html: string; status: number }> {
  const headers: Record<string, string> = { ...COMMON_HEADERS };
  if (options.body && options.contentType) headers["Content-Type"] = options.contentType;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    credentials: "include", // 讓原生 cookie jar 管理 cookie
    redirect: "follow",     // 讓原生層自動跟隨 redirect
  });

  const html = await response.text();
  return { html, status: response.status };
}

// ─── Public API ──────────────────────────────────────────

/**
 * 登入靜宜大學 e-campus。
 * 成功後回傳 session cookies（後續 API 呼叫用）。
 */
export async function puLogin(
  uid: string,
  password: string
): Promise<{ success: boolean; session: PUSession | null; error?: string }> {
  try {
    if (!uid || !password) return { success: false, session: null, error: "請輸入學號和密碼" };

    // ── Step 0: 先 GET 登入頁，讓原生 cookie jar 拿到初始 session cookie ──
    console.log("[puLogin] Step 0: warming up cookie jar…");
    await nativeFetch(`${ALCAT_BASE}/`);

    // ── Step 1: POST 登入表單 ──
    const body = `uid=${encodeURIComponent(uid)}&upassword=${encodeURIComponent(password)}&en_flag=zh`;
    console.log("[puLogin] Step 1: POST login…");
    const loginResult = await nativeFetch(`${ALCAT_BASE}${LOGIN_PATH}`, {
      method: "POST",
      body,
      contentType: "application/x-www-form-urlencoded",
    });
    console.log("[puLogin] POST status:", loginResult.status);
    console.log("[puLogin] POST html length:", loginResult.html.length);
    console.log("[puLogin] POST html snippet:", loginResult.html.slice(0, 500));

    // ── Step 2: 不靠 POST 回傳頁的文字判斷，直接試抓受保護的課表頁 ──
    console.log("[puLogin] Step 2: verifying session via course page…");
    const verifyResult = await nativeFetch(`${ALCAT_BASE}${COURSE_PATH}`);
    console.log("[puLogin] verify status:", verifyResult.status);
    console.log("[puLogin] verify html length:", verifyResult.html.length);
    console.log("[puLogin] verify html snippet:", verifyResult.html.slice(0, 500));

    const vHtml = verifyResult.html;

    // 課表頁有學生學號 → 登入成功
    const hasStudentData = hasPuStudentContext(vHtml);

    if (!hasStudentData) {
      // 真的登入失敗（帳密錯或 session 沒存下來）
      // 從 POST 回傳頁嘗試取得伺服器的錯誤訊息
      const postHtml = loginResult.html;
      if (
        postHtml.includes("帳號或密碼錯誤") ||
        postHtml.includes("密碼錯誤") ||
        postHtml.includes("login_fail") ||
        postHtml.includes("Login Failed")
      ) {
        return { success: false, session: null, error: "帳號或密碼錯誤" };
      }
      return {
        success: false,
        session: null,
        error: looksLikePuLoginPage(vHtml)
          ? "E校園 登入失敗，伺服器未建立有效工作階段"
          : "無法驗證登入狀態，請確認帳號密碼後再試",
      };
    }

    // 嘗試取得學生姓名
    const nameMatch =
      vHtml.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/) ??
      loginResult.html.match(/([^\s<]+)同學您好/);
    const studentName = nameMatch?.[1] ?? null;

    console.log("[puLogin] success! studentName =", studentName);
    return {
      success: true,
      session: { loggedIn: true, studentName },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "連線失敗";
    console.error("[puLogin] Error:", err);
    return { success: false, session: null, error: `登入失敗：${msg}` };
  }
}

/**
 * 取得課表。
 */
export async function puFetchCourses(
  _session: PUSession,
  _semester?: string
): Promise<{ success: boolean; data: PUCourseResult | null; error?: string }> {
  try {
    const result = await nativeFetch(`${ALCAT_BASE}${COURSE_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html) || !hasPuStudentContext(html)) {
      return { success: false, data: null, error: "E校園 session 已失效，請重新登入" };
    }

    // 學生資訊
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);
    const creditsMatch = html.match(/學期總學分[：:]\s*(\d+)/);
    const className = classMatch?.[1] ?? null;
    const { department, grade } = className ? parseClassName(className) : { department: null, grade: null };
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
    const rows = parseTable(html, "course code");
    const courses: PUCourse[] = [];

    for (const cells of rows) {
      if (cells.length < 7) continue;
      if (cells[0].includes("course code") || cells[0].includes("選課代號")) continue;

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
        location: tp?.location ?? "",
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
    console.error("[puFetchCourses]", err);
    return { success: false, data: null, error: err instanceof Error ? err.message : "抓取課表失敗" };
  }
}

/**
 * 取得成績（注意：成績在不同 domain — mypu.pu.edu.tw）。
 */
export async function puFetchGrades(
  _session: PUSession,
  semester?: string
): Promise<{ success: boolean; data: PUGradeResult | null; error?: string }> {
  try {
    // 優先用 alcat（和登入同 domain，cookie 確定能用），
    // 若失敗再試 mypu。
    let result = await nativeFetch(`${ALCAT_BASE}/stu_query/score_all.php`);
    if (result.status !== 200 || result.html.length < 200) {
      console.log("[puFetchGrades] alcat fallback to mypu…");
      result = await nativeFetch(`${MYPU_BASE}${GRADE_PATH}`);
    }
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html)) {
      return { success: false, data: null, error: "E校園 session 已失效，請重新登入" };
    }

    // ── 成績頁結構（2026-04 實測確認）：
    //   每個學期是一個 <p>學期別(Semester)：YYY [ T ]</p> 後接一個 5 欄 <table>
    //   欄位: 科目名稱(Course) | 修課班級(Class) | 修別(Course type) | 學分數(Credits) | 成績(Score)
    //   表尾有: 學期平均成績, 操行成績, 班排名, 系排名

    const grades: PUGrade[] = [];
    const summary: PUGradeResult["summary"] = {};

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
        (table.includes("Score") || table.includes("成績")) &&
        (table.includes("Course") || table.includes("科目"))
      ) {
        gradeTables.push(table);
      }
    }

    // 3. 逐個表格配對學期並解析
    for (let i = 0; i < gradeTables.length; i++) {
      const sem = semesterCodes[i] ?? `unknown_${i}`;
      const rows = parseTable(gradeTables[i], "");

      if (!summary[sem]) summary[sem] = {};

      for (const cells of rows) {
        if (cells.length < 5) continue;
        // 跳過表頭
        if (cells[0].includes("Course") || cells[0].includes("科目名稱")) continue;

        const courseName = cells[0];
        const score = cells[4];

        // 摘要行（平均、操行、排名）
        if (
          courseName.includes("平均") || courseName.includes("average") ||
          courseName.includes("操行") || courseName.includes("Behavior") ||
          courseName.includes("排名") || courseName.includes("ranking")
        ) {
          const entry = summary[sem];
          if (courseName.includes("系排名") || courseName.includes("Department")) {
            entry.departmentRanking = score;
          } else if (courseName.includes("班排名") || courseName.includes("Class")) {
            entry.classRanking = score;
          } else if (courseName.includes("操行") || courseName.includes("Behavior")) {
            entry.behaviorScore = parseFloat(score) || score;
          } else if (courseName.includes("平均") || courseName.includes("average")) {
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
          score: score === "通過(Pass)" ? "Pass" : (parseFloat(score) || score),
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
    console.error("[puFetchGrades]", err);
    return { success: false, data: null, error: err instanceof Error ? err.message : "抓取成績失敗" };
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
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Try ROC year pattern (YYY/MM/DD, e.g., 113/04/13 = 2024/04/13)
  const rocMatch = text.match(/(\d{2,3})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (rocMatch) {
    const [, rocYear, month, day] = rocMatch;
    const yearNum = parseInt(rocYear, 10);
    const gregorianYear = yearNum >= 1000 ? yearNum : yearNum + 1911; // ROC year = AD - 1911
    return `${gregorianYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/**
 * 取得公告。
 */
export async function puFetchAnnouncements(
  _session: PUSession
): Promise<{ success: boolean; data: PUAnnouncement[]; error?: string }> {
  try {
    const result = await nativeFetch(`${ALCAT_BASE}${MENU_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: [], error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html)) {
      return { success: false, data: [], error: "E校園 session 已失效，請重新登入" };
    }

    return { success: true, data: extractAnnouncementsFromHtml(html) };
  } catch (err) {
    console.error("[puFetchAnnouncements]", err);
    return { success: false, data: [], error: err instanceof Error ? err.message : "抓取公告失敗" };
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
  if (!emailOrText) return "";

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
  _session: PUSession
): Promise<{ success: boolean; data: PUStudentInfo | null; error?: string }> {
  try {
    const result = await nativeFetch(`${ALCAT_BASE}${COURSE_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    if (looksLikePuLoginPage(html) || !hasPuStudentContext(html)) {
      return { success: false, data: null, error: "E校園 session 已失效，請重新登入" };
    }
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);

    const className = classMatch?.[1] ?? null;
    const { department, grade } = className ? parseClassName(className) : { department: null, grade: null };

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
    console.error("[puFetchStudentInfo]", err);
    return { success: false, data: null, error: err instanceof Error ? err.message : "抓取學生資料失敗" };
  }
}

/**
 * 取得缺曠紀錄。
 */
export async function puFetchAbsence(
  _session: PUSession
): Promise<{ success: boolean; data: PUAbsence[]; error?: string }> {
  try {
    // Try multiple possible absence page URLs
    const possiblePaths = [
      "/stu_query/query_absence.html",
      "/stu_query/absence.html",
      "/stu_query/query_abs.html",
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
      return { success: false, data: [], error: "無法取得缺曠紀錄頁面" };
    }

    const html = result.html;
    const absences: PUAbsence[] = [];

    // Parse absence table: typically contains columns like:
    // 日期 | 課程 | 節次 | 缺曠類別 | 狀態
    const rows = parseTable(html, "");

    for (const cells of rows) {
      if (cells.length < 5) continue;
      // Skip header rows
      if (
        cells[0].includes("日期") ||
        cells[0].includes("Date") ||
        cells[0].includes("課程") ||
        cells[0].includes("Course")
      ) {
        continue;
      }

      absences.push({
        date: cells[0] || "",
        courseName: cells[1] || "",
        period: cells[2] || "",
        absenceType: cells[3] || "",
        status: cells[4] || "",
      });
    }

    return { success: true, data: absences };
  } catch (err) {
    console.error("[puFetchAbsence]", err);
    return { success: false, data: [], error: err instanceof Error ? err.message : "抓取缺曠紀錄失敗" };
  }
}

/**
 * 取得學分統計。
 */
export async function puFetchCreditSummary(
  _session: PUSession
): Promise<{ success: boolean; data: PUCreditSummary | null; error?: string }> {
  try {
    // Try multiple possible credit page URLs
    const possiblePaths = [
      "/stu_query/query_credit.html",
      "/stu_query/credit_check.html",
      "/stu_query/credit.html",
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
      return { success: false, data: null, error: "無法取得學分統計頁面" };
    }

    const html = result.html;
    const categories: PUCreditSummary["categories"] = [];
    let totalRequired = 0;
    let totalEarned = 0;

    // Parse credit table: typically contains columns like:
    // 科目類別 | 應修學分 | 已修學分 | 狀態
    const rows = parseTable(html, "");

    for (const cells of rows) {
      if (cells.length < 3) continue;
      // Skip header rows
      if (cells[0].includes("類別") || cells[0].includes("Category") || cells[0].includes("應修")) {
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
    console.error("[puFetchCreditSummary]", err);
    return { success: false, data: null, error: err instanceof Error ? err.message : "抓取學分統計失敗" };
  }
}

/**
 * 取得詳細的公告（從主要portal頁面，包含多個公告源）。
 */
export async function puFetchDetailedAnnouncements(
  _session: PUSession
): Promise<{ success: boolean; data: PUDetailedAnnouncement[]; error?: string }> {
  try {
    // Try to fetch the main portal/menu page
    const possiblePaths = ["/index_frame.php", "/index_menu.php", "/"];

    let result: { html: string; status: number } | null = null;

    for (const path of possiblePaths) {
      const fetchResult = await nativeFetch(`${ALCAT_BASE}${path}`);
      if (fetchResult.status === 200 && fetchResult.html.length > 200) {
        result = fetchResult;
        break;
      }
    }

    if (!result) {
      return { success: false, data: [], error: "無法取得公告頁面" };
    }

    const html = result.html;
    const announcements: PUDetailedAnnouncement[] = [];

    // Extract announcements from different categories
    // Look for sections like: <h3>系統公告</h3>, <h3>校園公告</h3>, etc.
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let currentCategory = "其他";

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

        if (linkText && linkText.length > 2 && !href.includes("javascript:")) {
          // Extract date if available
          const dateStr = extractDateFromText(linkContent) || new Date().toISOString().split("T")[0];

          // Check for "new" or "important" indicators (e.g., <img src="new.gif">, <span class="new">)
          const isNew = /new|最新|NEW/i.test(linkContent);
          const isImportant = /important|重要|important|red/i.test(linkContent);

          announcements.push({
            title: linkText,
            url: href.startsWith("http") ? href : `${ALCAT_BASE}/${href.replace(/^\//, "")}`,
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
    console.error("[puFetchDetailedAnnouncements]", err);
    return {
      success: false,
      data: [],
      error: err instanceof Error ? err.message : "抓取詳細公告失敗",
    };
  }
}
