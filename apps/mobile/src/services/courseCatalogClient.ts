/**
 * 靜宜大學 課綱查詢系統 — Client
 * Source: https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/
 *
 * 實際 API（已驗證 2026-05-12）：
 *   1. GET  ${BASE}/getCsrfToken                → { csrf_token }
 *   2. POST ${BASE}/simpleSearch                → { showRemain, courseResult: [...] }
 *        data: { csrf_token, simpleYearsem, searchName }
 *   3. POST ${BASE}/fullSearch                  → 同上
 *        data: { csrf_token, fullYearsem, selectionCode?, weekand?, classHour?,
 *                courseBuilding?, courseType?, courseName?, teaName?,
 *                offerUnit?, offerClass?, category?, language? }
 *   4. POST ${BASE}/fetchOfferUnit              → 開課單位（依學期）
 *   5. POST ${BASE}/fetchOfferClass             → 開課班級（依學期 + 單位）
 *
 * 必要 HTTP header：
 *   - User-Agent           （否則 403）
 *   - X-Requested-With: XMLHttpRequest
 *   - Referer: BASE/
 *   - Cookie warm-up：先 GET BASE 拿 ci_session cookie
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  CATALOG_DEFAULT_FILTER,
  PERIOD_INDEX,
  type CatalogFilter,
  type CatalogCourseType,
  type CatalogLanguage,
} from '../data/courseCatalogConstants';

// ─── 常數 ──────────────────────────────────────────────────

const BASE = 'https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/';
const CACHE_KEY_PREFIX = '@course_catalog:v3:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TOKEN_CACHE: { token: string | null; warmedAt: number } = {
  token: null,
  warmedAt: 0,
};

function shouldSkipDirectCatalogFetch(): boolean {
  // The official PU catalog does not allow browser-origin API calls. Native can query it directly;
  // Web should rely on cache/empty state until a server-side proxy is available.
  return Platform.OS === 'web';
}

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: BASE,
  Origin: 'https://mypu.pu.edu.tw',
};

// ─── 型別 ──────────────────────────────────────────────────

export type CatalogCourse = {
  semester: string;
  code: string;
  name: string;
  nameEn: string;
  courseType: string;
  courseTypeKey: CatalogCourseType | null;
  credits: number;
  department: string;
  classOffered: string;
  teacher: string;
  teacherEmail: string;
  timePlaceRaw: string;
  slots: CatalogTimeSlot[];
  capacity: number | null;
  enrolled: number | null;
  remaining: number | null;
  language: string;
  languageKey: CatalogLanguage | null;
  syllabusUrl: string | null;
  notes: string;
  tags: string[];
  raw: Record<string, any>;
};

export type CatalogTimeSlot = {
  dayOfWeek: number; // 1=Mon..7=Sun
  periods: number[];
  startTime: string;
  endTime: string;
  building: string; // e.g. '一研' or '主顧'
  room: string; // e.g. '101'
  locationRaw: string; // 全字串
};

export type CatalogQueryResult = {
  filter: CatalogFilter;
  courses: CatalogCourse[];
  totalCount: number;
  source: 'live' | 'cache' | 'sample';
  fetchedAt: number;
  showRemain: boolean;
  error?: string;
};

export type CatalogQueryOptions = {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  limit?: number;
};

// ─── HTTP helpers ──────────────────────────────────────────

async function warmupCookieJar(signal?: AbortSignal): Promise<void> {
  if (TOKEN_CACHE.warmedAt && Date.now() - TOKEN_CACHE.warmedAt < 60 * 60 * 1000) return;
  try {
    await fetch(BASE, {
      method: 'GET',
      headers: COMMON_HEADERS,
      credentials: 'include',
      redirect: 'follow',
      signal,
    });
    TOKEN_CACHE.warmedAt = Date.now();
  } catch {
    // 不阻擋
  }
}

async function getCsrfToken(signal?: AbortSignal): Promise<string> {
  await warmupCookieJar(signal);
  // Token 有效期不長，每次查詢前都拿新的最穩定
  const res = await fetch(BASE + 'getCsrfToken', {
    method: 'GET',
    headers: COMMON_HEADERS,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  if (!res.ok) throw new Error(`getCsrfToken failed: HTTP ${res.status}`);
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('getCsrfToken: invalid JSON');
  }
  if (!parsed?.csrf_token) throw new Error('getCsrfToken: missing csrf_token');
  TOKEN_CACHE.token = parsed.csrf_token;
  return parsed.csrf_token;
}

async function postForm(
  endpoint: 'simpleSearch' | 'fullSearch' | 'fetchOfferUnit' | 'fetchOfferClass',
  data: Record<string, string>,
  signal?: AbortSignal,
): Promise<any> {
  const csrf = await getCsrfToken(signal);
  const body = new URLSearchParams({ csrf_token: csrf, ...data }).toString();

  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
    credentials: 'include',
    redirect: 'follow',
    signal,
  });
  if (!res.ok) throw new Error(`${endpoint} failed: HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // PHP/CI 有時直接回字串
    return text;
  }
}

// ─── 解析 helpers ──────────────────────────────────────────

const DAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
};

const TYPE_MAP: Record<string, CatalogCourseType> = {
  必修: 'required',
  選修: 'elective',
  通識: 'general',
  教必: 'edu_required',
  教選: 'edu_elective',
  雙修: 'double',
  輔修: 'minor',
};

const LANGUAGE_MAP: Record<string, CatalogLanguage> = {
  中文: 'zh',
  '100%英文': 'en_100',
  '70%英文': 'en_70',
  '60%英文': 'en_60',
  日文: 'jp',
  西文: 'es',
  拉丁文: 'la',
  法文: 'fr',
  俄文: 'ru',
  德文: 'de',
};

function normalizeType(s: string): CatalogCourseType | null {
  if (!s) return null;
  for (const [zh, key] of Object.entries(TYPE_MAP)) {
    if (s.includes(zh)) return key;
  }
  return null;
}

function normalizeLanguage(s: string): CatalogLanguage | null {
  if (!s) return null;
  const key = s.replace(/\s+/g, '');
  return LANGUAGE_MAP[key] ?? null;
}

/**
 * 解析靜宜課表時間字串。
 * 範例：
 *   `三  5、 6、 7：一研101`           → 週三第5,6,7節 @ 一研101
 *   `一 1、 2：主顧101；三  5、 6：主顧219`  → 兩段
 *   `二 1、 2、 3、 4、 5、 6` (無教室)
 *
 *   也接受半形分號、全形分號、逗號當分隔。
 */
function parseTimePlace(raw: string): CatalogTimeSlot[] {
  if (!raw?.trim()) return [];
  const slots: CatalogTimeSlot[] = [];

  // 把全形分號 / 換行 統一成標準分隔
  const segments = raw
    .replace(/\s+/g, ' ')
    .split(/[;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // (週) (節次列表，全形或半形逗號分隔)：(地點)
    const m = seg.match(
      /^([一二三四五六日])\s*([\d\s,，、]+)(?:[:：](.*))?$/,
    );
    if (!m) continue;
    const dayOfWeek = DAY_MAP[m[1]] ?? 0;
    if (!dayOfWeek) continue;

    const periods = m[2]
      .split(/[,，、\s]+/)
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    if (periods.length === 0) continue;

    const minP = Math.min(...periods);
    const maxP = Math.max(...periods);
    const startTime = PERIOD_INDEX[minP]?.start ?? '08:10';
    const endTime = PERIOD_INDEX[maxP]?.end ?? '09:00';

    const locationRaw = (m[3] ?? '').trim();
    // 嘗試切「大樓名」與「教室號」（純數字結尾）
    const locMatch = locationRaw.match(/^(.+?)(\d+[A-Z]?)?$/);
    const building = locMatch?.[1] ?? locationRaw;
    const room = locMatch?.[2] ?? '';

    slots.push({
      dayOfWeek,
      periods,
      startTime,
      endTime,
      building,
      room,
      locationRaw,
    });
  }

  return slots;
}

function extractTags(row: Record<string, any>): string[] {
  const tags: string[] = [];
  const note = (row.course_note ?? '').toString();
  const teaMark = (row.tea_mark ?? '').toString();
  const teaStatus = (row.tea_status ?? '').toString();
  if (teaMark === '1') tags.push('practice'); // 實習
  if (teaMark === '2') tags.push('laboratory'); // 實驗
  if (teaStatus === '*') tags.push('co_teaching'); // 合授
  if (/微學分/.test(note)) tags.push('micro_credit');
  if (/數位課程|遠距/.test(note)) tags.push('digital');
  if (/實習/.test(note)) tags.push('practical');
  if (/EMI|英語授課|English/i.test(note)) tags.push('emi');
  return tags;
}

function rowToCourse(row: Record<string, any>, semester: string): CatalogCourse {
  const courseName: string = (row.courseName ?? '').trim();
  // 名稱可能含 \n 接英文翻譯
  const nameLines = courseName.split(/\n+/);
  const zhName = nameLines[0]?.trim() ?? courseName;
  const enName = nameLines.slice(1).join(' ').trim();

  const credits = parseInt(String(row.credit ?? '0'), 10) || 0;
  const cap = row.cour_person != null ? parseInt(String(row.cour_person), 10) : null;
  const enr = row.stdCount != null ? parseInt(String(row.stdCount), 10) : null;
  const remaining = cap != null && enr != null ? Math.max(0, cap - enr) : null;
  const courseType = (row.cus_select_cn ?? '').toString().trim();

  return {
    semester,
    code: (row.selectno ?? '').toString().trim(),
    name: zhName,
    nameEn: enName,
    courseType,
    courseTypeKey: normalizeType(courseType),
    credits,
    department: (row.dep1_cn ?? row.dep_cn ?? '').toString().trim(),
    classOffered: (row.cla_cn ?? '').toString().trim(),
    teacher: (row.tea_name ?? '').toString().trim(),
    teacherEmail: '',
    timePlaceRaw: (row.placeTime ?? '').toString().trim(),
    slots: parseTimePlace((row.placeTime ?? '').toString()),
    capacity: cap,
    enrolled: enr,
    remaining,
    language: '',
    languageKey: null,
    syllabusUrl:
      row.cus_num && row.tea_num
        ? `${BASE}showOutline?cusNum=${row.cus_num}&teaNum=${row.tea_num}&semester=${semester}`
        : null,
    notes: (row.course_note ?? '').toString().trim(),
    tags: extractTags(row),
    raw: row,
  };
}

// ─── 公開 API ──────────────────────────────────────────────

export async function queryCatalog(
  filter: Partial<CatalogFilter> = {},
  options: CatalogQueryOptions = {},
): Promise<CatalogQueryResult> {
  const merged: CatalogFilter = { ...CATALOG_DEFAULT_FILTER, ...filter };

  if (!options.forceRefresh) {
    const cached = await readCache(merged);
    if (cached) return cached;
  }

  if (shouldSkipDirectCatalogFetch()) {
    return {
      filter: merged,
      courses: [],
      totalCount: 0,
      source: 'sample',
      fetchedAt: Date.now(),
      showRemain: false,
      error: 'Web 版無法直接連線課綱查詢系統，請使用行動裝置或後端代理同步。',
    };
  }

  try {
    const live = await queryLive(merged, options);
    if (live.courses.length > 0) {
      await writeCache(merged, live);
    }
    return live;
  } catch (err) {
    console.warn('[courseCatalog] live query failed:', err);
    return {
      filter: merged,
      courses: [],
      totalCount: 0,
      source: 'live',
      fetchedAt: Date.now(),
      showRemain: false,
      error:
        err instanceof Error
          ? err.message.includes('Network')
            ? '無法連線到課綱查詢系統，請檢查網路'
            : err.message
          : '查詢失敗',
    };
  }
}

async function queryLive(
  filter: CatalogFilter,
  options: CatalogQueryOptions,
): Promise<CatalogQueryResult> {
  // 1. 判斷該走 simpleSearch 還是 fullSearch
  const hasSimpleOnly =
    !filter.weekday &&
    !filter.period &&
    !filter.building &&
    !filter.courseType &&
    !filter.college &&
    !filter.department &&
    !filter.category &&
    !filter.language &&
    !filter.courseCode;

  const searchName = (filter.keyword ?? filter.courseName ?? filter.teacher ?? '').trim();

  let response: any;

  if (hasSimpleOnly && searchName) {
    response = await postForm(
      'simpleSearch',
      {
        simpleYearsem: filter.semester,
        searchName,
      },
      options.signal,
    );
  } else {
    // 注意：fullSearch 的 category 預設值是 "1"（「不限」），必須送出，否則 HTTP 500
    const data: Record<string, string> = {
      fullYearsem: filter.semester,
      category: filter.category ? mapCategoryKeyToCode(filter.category) : '1',
    };
    if (filter.courseCode) data.selectionCode = filter.courseCode;
    if (filter.weekday) data.weekand = String(filter.weekday);
    if (filter.period) data.classHour = String(filter.period);
    if (filter.building) data.courseBuilding = filter.building;
    if (filter.courseType) {
      const code = mapCourseTypeKeyToCode(filter.courseType);
      if (code) data.courseType = code;
    }
    if (filter.courseName || searchName) {
      data.courseName = filter.courseName ?? searchName;
    }
    if (filter.teacher) data.teaName = filter.teacher;
    if (filter.department) data.offerUnit = mapDepartmentToCode(filter.department);
    if (filter.classOffered) data.offerClass = filter.classOffered;
    if (filter.language) {
      const code = mapLanguageKeyToCode(filter.language);
      if (code) data.language = code;
    }

    response = await postForm('fullSearch', data, options.signal);
  }

  // response 形如：{showRemain, courseResult: [...]} 或字串 'error'
  let rawList: any[] = [];
  let showRemain = false;
  if (response && typeof response === 'object') {
    if (Array.isArray(response.courseResult)) rawList = response.courseResult;
    if (typeof response.showRemain === 'boolean') showRemain = response.showRemain;
  }

  const courses = rawList
    .map((row) => rowToCourse(row, filter.semester))
    .filter((c) => c.code);

  return {
    filter,
    courses: options.limit ? courses.slice(0, options.limit) : courses,
    totalCount: courses.length,
    source: 'live',
    fetchedAt: Date.now(),
    showRemain,
  };
}

// ─── 各下拉欄位的 API 代碼對照表（取自校方系統 HTML option value） ────

const COURSE_TYPE_CODE: Record<string, string> = {
  required: 'A',
  elective: 'D',
  general: 'B',
  edu_required: 'G',
  edu_elective: 'H',
  double: 'F',
  minor: 'E',
};

const LANGUAGE_CODE: Record<string, string> = {
  zh: 'A',
  en_100: 'I',
  en_70: 'J',
  en_60: 'B',
  jp: 'D',
  es: 'C',
  fr: 'E',
  de: 'F',
  ru: 'G',
  la: 'H',
};

// category 代碼直接是數字字串。filter 用語意 key（與 constants 對齊），先做映射
const CATEGORY_CODE: Record<string, string> = {
  edu_program: '2',
  minor_double: '3',
  pe: '4',
  national_defense: '5',
  common_elective: '6',
  ge_sustainability: '7',
  ge_religion_thinking: '8',
  ge_tech_service: '9',
  ge_cross_design: '10',
  ge_culture: '11',
  ge_life_ecology: '12',
  ge_religion_philosophy: '13',
  ge_math_science: '14',
  ge_society_public: '15',
  ge_literature_aesthetics: '16',
  digital: '17',
  micro_credit: '18',
  practical_internship: '19',
};

// 系所中文名 / 代碼 → 校方 dep1 代碼
const DEPARTMENT_CODE: Record<string, string> = {
  // 理學院
  '理學院': '20', '食營系': '22', '應化系': '23', '化科系': '24',
  '財工系': '28', '永續智慧學士學位學程': '2A',
  // 管理學院
  '管理學院': '30', '會計系': '32', '觀光系': '35', '財金系': '36',
  '國企系': '37', '行銷數位經營系': '3A', '經管進學班': '3B',
  // 外語學院
  '外語學院': '40', '英文系': '41', '西文系': '42', '日文系': '43',
  // 人社院
  '人社院': '50', '中文系': '51', '台文系': '53', '法律系': '54',
  '生態系': '55', '大傳系': '56', '社工系': '58',
  // 資訊學院
  '資訊學院': '70', '資管系': '71', '資工系': '72',
  '國際資訊學士學程': '74', '人工智慧系': '75', '資科系': '76',
  '晶片設計學士學位學程': '77',
  // 國際學院
  '國際學院': 'V0', '智慧媒體學士學位學程': 'V4', '博雅教育學士學程': 'V6',
  // 中心 / 進修
  '通識中心': '61', '通識涵養課程': '64', '通識學程': '65',
  '體育室': '62', '師培中心': '63', '外語教學中心': '95',
  '閱讀書寫': '66', '資訊能力': '67', '軍訓室': '81',
};

function mapCourseTypeKeyToCode(key: string): string | undefined {
  return COURSE_TYPE_CODE[key] ?? (key.length === 1 ? key : undefined);
}

function mapLanguageKeyToCode(key: string): string | undefined {
  return LANGUAGE_CODE[key] ?? (key.length === 1 ? key : undefined);
}

function mapCategoryKeyToCode(key: string): string {
  // 接受語意 key 或直接傳代碼數字
  return CATEGORY_CODE[key] ?? (/^\d+$/.test(key) ? key : '1');
}

function mapDepartmentToCode(input: string): string {
  if (/^[0-9A-Z]{2,3}$/.test(input)) return input;
  return DEPARTMENT_CODE[input] ?? '';
}

// ─── 取開課單位／開課班級 ─────────────────────────────────

export async function fetchOfferUnit(semester: string): Promise<string[]> {
  if (shouldSkipDirectCatalogFetch()) return [];
  try {
    const res = await postForm('fetchOfferUnit', { fullYearsem: semester });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

export async function fetchOfferClass(semester: string, offerUnit: string): Promise<string[]> {
  if (shouldSkipDirectCatalogFetch()) return [];
  try {
    const res = await postForm('fetchOfferClass', {
      fullYearsem: semester,
      offerUnit,
    });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

// ─── 快取 ──────────────────────────────────────────────────

function cacheKeyOf(filter: CatalogFilter): string {
  return CACHE_KEY_PREFIX + JSON.stringify(filter);
}

async function readCache(filter: CatalogFilter): Promise<CatalogQueryResult | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKeyOf(filter));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogQueryResult;
    if (!parsed.fetchedAt || Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    parsed.source = 'cache';
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(filter: CatalogFilter, result: CatalogQueryResult): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKeyOf(filter), JSON.stringify(result));
  } catch {
    // ignore
  }
}

export async function clearCatalogCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((k) => k.startsWith(CACHE_KEY_PREFIX));
    if (targets.length > 0) await AsyncStorage.multiRemove(targets);
  } catch {
    // ignore
  }
}

// ─── 整合 helpers ──────────────────────────────────────────

export type PersonalCourseDraft = {
  code: string;
  name: string;
  nameEn: string;
  teacher: string;
  credits: number;
  schedule: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    location: string;
  }>;
};

export function toPersonalCourseDraft(course: CatalogCourse): PersonalCourseDraft {
  return {
    code: course.code,
    name: course.name,
    nameEn: course.nameEn,
    teacher: course.teacher,
    credits: course.credits,
    schedule: course.slots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.locationRaw,
    })),
  };
}

export function detectConflicts(
  candidate: CatalogCourse,
  existing: Array<{
    dayOfWeek?: number;
    startTime?: string;
    endTime?: string;
    name?: string;
  }>,
): Array<{ withName: string; day: number; overlap: string }> {
  const out: Array<{ withName: string; day: number; overlap: string }> = [];
  for (const e of existing) {
    if (!e.dayOfWeek || !e.startTime || !e.endTime) continue;
    for (const s of candidate.slots) {
      if (s.dayOfWeek !== e.dayOfWeek) continue;
      if (s.startTime < e.endTime && s.endTime > e.startTime) {
        out.push({
          withName: e.name ?? '已選課程',
          day: e.dayOfWeek,
          overlap: `${s.startTime}-${s.endTime}`,
        });
      }
    }
  }
  return out;
}

/** 取得本學期當前所有開課單位（如果線上抓不到就用本地常數） */
export async function fetchCatalogOrganization(): Promise<{ college: string; departments: string[] }[]> {
  const { CATALOG_COLLEGES } = await import('../data/courseCatalogConstants');
  return CATALOG_COLLEGES.map((c) => ({
    college: c.zh,
    departments: c.departments.map((d) => d.value),
  }));
}
