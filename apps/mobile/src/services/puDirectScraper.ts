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
};

export type PUStudentInfo = {
  studentId: string | null;
  name: string | null;
  className: string | null;
  currentSemester: string | null;
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
    const hasStudentData =
      vHtml.includes("Student No.") ||
      vHtml.includes("學號") ||
      vHtml.includes("query_course");

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
        error: "無法驗證登入狀態，請確認帳號密碼後再試",
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

    // 學生資訊
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);
    const creditsMatch = html.match(/學期總學分[：:]\s*(\d+)/);

    const studentInfo: PUStudentInfo = {
      studentId: idMatch?.[1] ?? null,
      name: nameMatch?.[1] ?? null,
      className: classMatch?.[1] ?? null,
      currentSemester: semMatch ? `${semMatch[1]}${semMatch[2]}` : null,
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
 * 從 HTML 解析成績行。
 */
function parseGradeRows(html: string): { grades: PUGrade[]; summaryRows: { semester: string; label: string; value: string }[] } {
  const rows = parseTable(html, "Score");
  const grades: PUGrade[] = [];
  const summaryRows: { semester: string; label: string; value: string }[] = [];

  for (const cells of rows) {
    if (cells.length < 6) continue;
    if (cells[0].includes("Semester") || cells[0].includes("學期別")) continue;

    const sem = cells[0];
    const courseName = cells[1];
    const score = cells[5];

    if (
      courseName.includes("排名") || courseName.includes("ranking") ||
      courseName.includes("操行") || courseName.includes("Behavior") ||
      courseName.includes("平均") || courseName.includes("average")
    ) {
      summaryRows.push({ semester: sem, label: courseName, value: score });
      continue;
    }

    if (!/^\d{4}$/.test(sem)) continue;

    const { zhName, enName } = parseCourseTitle(courseName);
    grades.push({
      semester: sem,
      courseName: zhName,
      courseNameEn: enName,
      className: cells[2],
      courseType: cells[3],
      credits: parseInt(cells[4], 10) || 0,
      score: score === "通過(Pass)" ? "Pass" : (parseFloat(score) || score),
    });
  }

  return { grades, summaryRows };
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
  semester?: string
): Promise<{ success: boolean; data: PUGradeResult | null; error?: string }> {
  try {
    // Step 1: Warm up mypu session (native cookie jar handles cross-domain)
    try {
      await nativeFetch(`${MYPU_BASE}/`);
      console.log("[puFetchGrades] mypu warmup done");
    } catch (e) {
      console.warn("[puFetchGrades] mypu warmup failed (non-fatal):", e);
    }

    // Step 1b: Try alcat's score page (may proxy/redirect to mypu with SSO)
    try {
      const alcatGrade = await nativeFetch(`${ALCAT_BASE}${GRADE_PATH}`);
      if (alcatGrade.status === 200) {
        const alcatParsed = parseGradeRows(alcatGrade.html);
        const alcatSems = [...new Set(alcatParsed.grades.map((g) => g.semester))];
        console.log(`[puFetchGrades] alcat score_all: ${alcatParsed.grades.length} grades, ${alcatSems.length} semesters`);
        if (alcatSems.length > 1) {
          const filteredGrades = semester ? alcatParsed.grades.filter((g) => g.semester === semester) : alcatParsed.grades;
          return {
            success: true,
            data: {
              grades: filteredGrades,
              allSemesters: alcatSems,
              summary: buildGradeSummary(alcatParsed.summaryRows),
            },
          };
        }
      }
    } catch (e) {
      console.warn("[puFetchGrades] alcat grade bridge failed (non-fatal):", e);
    }

    // Step 2: Fetch grade page from mypu
    const result = await nativeFetch(`${MYPU_BASE}${GRADE_PATH}`);
    if (result.status !== 200) {
      return { success: false, data: null, error: `HTTP ${result.status}` };
    }

    const html = result.html;
    console.log("[puFetchGrades] score_all.php HTML length:", html.length);
    console.log("[puFetchGrades] score_all.php snippet:", html.slice(0, 500));

    // Step 3: Parse initial response
    let { grades, summaryRows } = parseGradeRows(html);
    const initialSemesters = [...new Set(grades.map((g) => g.semester))];
    console.log(`[puFetchGrades] Initial: ${grades.length} grades, ${initialSemesters.length} semesters: [${initialSemesters.join(", ")}]`);

    // Step 4: If only ≤1 semester, try additional approaches
    if (initialSemesters.length <= 1) {
      console.log("[puFetchGrades] Only 0-1 semesters — trying POST approaches…");

      // Try POST with various form bodies
      const postAttempts = [
        { body: "", desc: "empty POST" },
        { body: "semester=", desc: "semester=empty" },
        { body: "qy=", desc: "qy=empty" },
        { body: "sem=&submit=查詢", desc: "sem=empty+submit" },
      ];

      for (const attempt of postAttempts) {
        try {
          const postRes = await nativeFetch(`${MYPU_BASE}${GRADE_PATH}`, {
            method: "POST",
            body: attempt.body,
            contentType: "application/x-www-form-urlencoded",
          });
          if (postRes.status === 200) {
            const postParsed = parseGradeRows(postRes.html);
            const postSemesters = [...new Set(postParsed.grades.map((g) => g.semester))];
            console.log(`[puFetchGrades] POST (${attempt.desc}): ${postParsed.grades.length} grades, ${postSemesters.length} semesters`);

            if (postParsed.grades.length > grades.length) {
              grades = postParsed.grades;
              summaryRows = postParsed.summaryRows;
              console.log(`[puFetchGrades] POST (${attempt.desc}) returned MORE grades — using`);
              break;
            }
          }
        } catch (e) {
          console.warn(`[puFetchGrades] POST (${attempt.desc}) failed:`, e);
        }
      }

      // Per-semester fetch — use dropdown options, or generate semester codes
      const allSemsSoFar = [...new Set(grades.map((g) => g.semester))];
      const availableSemesters = extractAvailableSemesters(html);
      let semestersToFetch = availableSemesters.filter((s) => !allSemsSoFar.includes(s));

      // If no dropdown, generate plausible semester codes (last 4 years)
      if (semestersToFetch.length === 0) {
        const rocYear = new Date().getFullYear() - 1911;
        const generated: string[] = [];
        for (let y = rocYear; y >= rocYear - 4; y--) {
          generated.push(`${y}2`, `${y}1`);
        }
        semestersToFetch = generated.filter((s) => !allSemsSoFar.includes(s));
        console.log(`[puFetchGrades] No dropdown — generated ${semestersToFetch.length} semester codes`);
      }

      if (allSemsSoFar.length <= 1 && semestersToFetch.length > 0) {
        console.log(`[puFetchGrades] Trying per-semester fetch for ${semestersToFetch.length} semesters…`);
        const allGrades = [...grades];
        const allSummary = [...summaryRows];
        const fetched = new Set(allSemsSoFar);
        let consecutiveEmpty = 0;

        for (const sem of semestersToFetch) {
          if (fetched.has(sem)) continue;
          if (consecutiveEmpty >= 3) {
            console.log("[puFetchGrades] Stopping after 3 consecutive empty semesters");
            break;
          }

          let found = false;
          try {
            const semRes = await nativeFetch(`${MYPU_BASE}${GRADE_PATH}?semester=${sem}`);
            if (semRes.status === 200) {
              const parsed = parseGradeRows(semRes.html);
              if (parsed.grades.length > 0) {
                allGrades.push(...parsed.grades);
                allSummary.push(...parsed.summaryRows);
                fetched.add(sem);
                found = true;
                console.log(`[puFetchGrades] Semester ${sem}: +${parsed.grades.length} grades`);
              }
            }
            if (!found) {
              const semPost = await nativeFetch(`${MYPU_BASE}${GRADE_PATH}`, {
                method: "POST",
                body: `semester=${sem}`,
                contentType: "application/x-www-form-urlencoded",
              });
              if (semPost.status === 200) {
                const parsed = parseGradeRows(semPost.html);
                if (parsed.grades.length > 0) {
                  allGrades.push(...parsed.grades);
                  allSummary.push(...parsed.summaryRows);
                  fetched.add(sem);
                  found = true;
                  console.log(`[puFetchGrades] Semester ${sem} POST: +${parsed.grades.length} grades`);
                }
              }
            }
          } catch (e) {
            console.warn(`[puFetchGrades] Per-semester ${sem} failed:`, e);
          }
          consecutiveEmpty = found ? 0 : consecutiveEmpty + 1;
        }

        if (allGrades.length > grades.length) {
          grades = allGrades;
          summaryRows = allSummary;
        }
      }
    }

    // Step 5: Build final result
    const allSemesters = [...new Set(grades.map((g) => g.semester))];
    console.log(`[puFetchGrades] Final: ${grades.length} grades, ${allSemesters.length} semesters: [${allSemesters.join(", ")}]`);

    const filteredGrades = semester ? grades.filter((g) => g.semester === semester) : grades;

    return {
      success: true,
      data: {
        grades: filteredGrades,
        allSemesters,
        summary: buildGradeSummary(summaryRows),
      },
    };
  } catch (err) {
    console.error("[puFetchGrades]", err);
    return { success: false, data: null, error: err instanceof Error ? err.message : "抓取成績失敗" };
  }
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
    const announcements: PUAnnouncement[] = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const text = stripTags(match[2]);
      if (text && text.length > 2 && !href.includes("javascript:")) {
        announcements.push({
          title: text,
          url: href.startsWith("http") ? href : `${ALCAT_BASE}/${href.replace(/^\//, "")}`,
          date: new Date().toISOString().split("T")[0],
        });
      }
    }

    return { success: true, data: announcements };
  } catch (err) {
    console.error("[puFetchAnnouncements]", err);
    return { success: false, data: [], error: err instanceof Error ? err.message : "抓取公告失敗" };
  }
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
    const classMatch = html.match(/班級\(Class\)[：:]\s*([^\s<]+)/);
    const idMatch = html.match(/學號\(Student No\.\)[：:]\s*(\d+)/);
    const nameMatch = html.match(/姓名\(Student Name\)[：:]\s*([^\s<]+)/);
    const semMatch = html.match(/(\d+)學年度\s*第(\d)學期/);

    return {
      success: true,
      data: {
        studentId: idMatch?.[1] ?? null,
        name: nameMatch?.[1] ?? null,
        className: classMatch?.[1] ?? null,
        currentSemester: semMatch ? `${semMatch[1]}${semMatch[2]}` : null,
      },
    };
  } catch (err) {
    console.error("[puFetchStudentInfo]", err);
    return { success: false, data: null, error: err instanceof Error ? err.message : "抓取學生資料失敗" };
  }
}
