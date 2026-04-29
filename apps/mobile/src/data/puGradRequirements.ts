/**
 * 靜宜大學各系畢業門檻資料
 *
 * 資料來源：
 *   - 靜宜大學教務處修業規定
 *   - 各系課程架構圖（alcat.pu.edu.tw）
 *   - 教育部校務資訊公開平台（udb.moe.edu.tw）
 *
 * 分類說明：
 *   required    = 專業必修（系必修 + 院必修）
 *   elective    = 專業選修（系選修）
 *   general     = 通識涵養（博雅/核心通識）
 *   common      = 校共同必修（國文、英文、體育、服務學習等）
 *   free        = 自由選修
 *
 * 110 學年度起通識由 18 學分改為 16 學分。
 * 各系畢業總學分大多 128–133 學分。
 */

// ─── 學分分類定義 ───────────────────────────────────────

export type PUCreditCat =
  | "required"   // 專業必修（系必修 + 院必修）
  | "elective"   // 專業選修
  | "general"    // 通識涵養
  | "common"     // 校共同必修（國文、英文）
  | "pe"         // 體育（0 學分但必修）
  | "service"    // 服務學習（0 學分但必修）
  | "free";      // 自由選修

export const PU_CATEGORY_LABELS: Record<PUCreditCat, string> = {
  required: "專業必修",
  elective: "專業選修",
  general: "通識涵養",
  common: "校共同必修",
  pe: "體育",
  service: "服務學習",
  free: "自由選修",
};

export const PU_CATEGORY_COLORS: Record<PUCreditCat, string> = {
  required: "#f43f5e",   // 紅
  elective: "#3b82f6",   // 藍
  general: "#10b981",    // 綠
  common: "#f59e0b",     // 橙
  pe: "#8b5cf6",         // 紫
  service: "#a855f7",    // 淺紫
  free: "#64748b",       // 灰
};

// ─── 系所畢業門檻定義 ──────────────────────────────────

export type DeptGradRequirement = {
  /** 系所 ID（用於比對 E 校園回傳的 className） */
  id: string;
  /** 系所全名 */
  name: string;
  /** 簡稱 */
  shortName: string;
  /** 所屬學院 */
  college: string;
  /** 畢業總學分 */
  totalCredits: number;
  /** 各類別最低學分 */
  credits: Record<PUCreditCat, number>;
  /** 體育必修門數 */
  peCoursesRequired: number;
  /** 服務學習必修門數 */
  serviceCoursesRequired: number;
  /** 適用入學年度起（民國年） */
  appliesFrom: number;
  /** 備註 */
  notes?: string;
};

// ─── 校共同必修基準（適用全校） ─────────────────────────
// 國文 4 學分 + 英文 6 學分 = 10 學分
// 體育 4 門 0 學分
// 服務學習 2 門 0 學分
const COMMON_CREDITS = 10;
const PE_COURSES = 4;
const SERVICE_COURSES = 2;

// ─── 通識學分基準 ──────────────────────────────────────
// 110 學年度起: 16 學分（四大向度各至少 4 學分）
// 109 學年度前: 18 學分（六大學群）
const GENERAL_CREDITS_NEW = 16; // 110+
const GENERAL_CREDITS_OLD = 18; // 109-

// ─── 各系畢業門檻資料庫 ────────────────────────────────

export const PU_DEPARTMENTS: DeptGradRequirement[] = [
  // ═══════════ 資訊學院 ═══════════
  {
    id: "csim",
    name: "資訊管理學系",
    shortName: "資管系",
    college: "資訊學院",
    totalCredits: 128,
    credits: {
      required: 54,    // 院必修 + 系專業必修
      elective: 26,    // 系專業選修
      general: 16,     // 通識涵養
      common: 10,      // 校共同必修（國文4+英文6）
      pe: 0,
      service: 0,
      free: 22,        // 128 - 54 - 26 - 16 - 10 = 22
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
    notes: "含程式設計、資料庫管理、系統分析與設計等核心必修",
  },
  {
    id: "cs",
    name: "資訊工程學系",
    shortName: "資工系",
    college: "資訊學院",
    totalCredits: 132,
    credits: {
      required: 60,
      elective: 24,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
    notes: "含計算機概論、資料結構、演算法、作業系統等核心必修",
  },
  {
    id: "cact",
    name: "資訊傳播工程學系",
    shortName: "資傳系",
    college: "資訊學院",
    totalCredits: 128,
    credits: {
      required: 50,
      elective: 30,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },

  // ═══════════ 管理學院 ═══════════
  {
    id: "ba",
    name: "企業管理學系",
    shortName: "企管系",
    college: "管理學院",
    totalCredits: 129,
    credits: {
      required: 54,
      elective: 27,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "acc",
    name: "會計學系",
    shortName: "會計系",
    college: "管理學院",
    totalCredits: 129,
    credits: {
      required: 57,
      elective: 24,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "fin",
    name: "財務金融學系",
    shortName: "財金系",
    college: "管理學院",
    totalCredits: 129,
    credits: {
      required: 54,
      elective: 27,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "itm",
    name: "觀光事業學系",
    shortName: "觀光系",
    college: "管理學院",
    totalCredits: 128,
    credits: {
      required: 48,
      elective: 32,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },

  // ═══════════ 人文暨社會科學院 ═══════════
  {
    id: "soc",
    name: "社會工作與兒童少年福利學系",
    shortName: "社工系",
    college: "人文暨社會科學院",
    totalCredits: 128,
    credits: {
      required: 52,
      elective: 28,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "law",
    name: "法律學系",
    shortName: "法律系",
    college: "人文暨社會科學院",
    totalCredits: 128,
    credits: {
      required: 56,
      elective: 24,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "eco",
    name: "生態人文學系",
    shortName: "生態系",
    college: "人文暨社會科學院",
    totalCredits: 128,
    credits: {
      required: 48,
      elective: 32,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },

  // ═══════════ 外語學院 ═══════════
  {
    id: "eng",
    name: "英國語文學系",
    shortName: "英文系",
    college: "外語學院",
    totalCredits: 129,
    credits: {
      required: 62,
      elective: 19,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "spa",
    name: "西班牙語文學系",
    shortName: "西文系",
    college: "外語學院",
    totalCredits: 133,
    credits: {
      required: 62,
      elective: 23,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "jpn",
    name: "日本語文學系",
    shortName: "日文系",
    college: "外語學院",
    totalCredits: 133,
    credits: {
      required: 62,
      elective: 23,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },

  // ═══════════ 理學院 ═══════════
  {
    id: "stat",
    name: "應用化學系",
    shortName: "化學系",
    college: "理學院",
    totalCredits: 128,
    credits: {
      required: 58,
      elective: 22,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "fsc",
    name: "食品營養學系",
    shortName: "食營系",
    college: "理學院",
    totalCredits: 128,
    credits: {
      required: 56,
      elective: 24,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
  {
    id: "cosmetics",
    name: "化粧品科學系",
    shortName: "化科系",
    college: "理學院",
    totalCredits: 128,
    credits: {
      required: 54,
      elective: 26,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },

  // ═══════════ 大傳學院 ═══════════
  {
    id: "masscom",
    name: "大眾傳播學系",
    shortName: "大傳系",
    college: "大傳學院",
    totalCredits: 130,
    credits: {
      required: 54,
      elective: 28,
      general: 16,
      common: 10,
      pe: 0,
      service: 0,
      free: 22,
    },
    peCoursesRequired: PE_COURSES,
    serviceCoursesRequired: SERVICE_COURSES,
    appliesFrom: 110,
  },
];

// ─── 預設門檻（找不到系所時使用） ──────────────────────

export const PU_DEFAULT_REQUIREMENT: DeptGradRequirement = {
  id: "default",
  name: "靜宜大學（一般系所）",
  shortName: "一般",
  college: "",
  totalCredits: 128,
  credits: {
    required: 50,
    elective: 30,
    general: 16,
    common: 10,
    pe: 0,
    service: 0,
    free: 22,
  },
  peCoursesRequired: PE_COURSES,
  serviceCoursesRequired: SERVICE_COURSES,
  appliesFrom: 110,
  notes: "一般系所預設值，實際門檻請參考所屬系所之修業規定",
};

// ─── 系所比對函式 ───────────────────────────────────────

/**
 * 根據 E 校園回傳的班級名稱 / 系所名稱自動比對畢業門檻
 *
 * @param deptStr - E 校園回傳的 className / department（如 "資管四B"、"資訊管理學系"）
 * @returns 對應的畢業門檻，找不到則回傳預設值
 */
export function matchDepartment(deptStr?: string | null): DeptGradRequirement {
  if (!deptStr) return PU_DEFAULT_REQUIREMENT;

  const s = deptStr.trim();

  // 逐系比對：用 shortName 和 name 做模糊匹配
  for (const dept of PU_DEPARTMENTS) {
    // 全名比對
    if (s.includes(dept.name)) return dept;
    // 簡稱比對（去掉「系」字比對前綴）
    const prefix = dept.shortName.replace("系", "");
    if (prefix.length >= 2 && s.includes(prefix)) return dept;
  }

  // 關鍵字比對
  const keywordMap: Record<string, string> = {
    "資管": "csim",
    "資工": "cs",
    "資傳": "cact",
    "企管": "ba",
    "會計": "acc",
    "財金": "fin",
    "觀光": "itm",
    "社工": "soc",
    "法律": "law",
    "生態": "eco",
    "英文": "eng",
    "西文": "spa",
    "日文": "jpn",
    "化學": "stat",
    "食營": "fsc",
    "化科": "cosmetics",
    "化粧品": "cosmetics",
    "大傳": "masscom",
  };

  for (const [keyword, id] of Object.entries(keywordMap)) {
    if (s.includes(keyword)) {
      const found = PU_DEPARTMENTS.find((d) => d.id === id);
      if (found) return found;
    }
  }

  return PU_DEFAULT_REQUIREMENT;
}

/**
 * 根據 E 校園修別字串判定學分分類
 *
 * E 校園成績頁的「修別」欄位可能的值：
 *   必修、選修、通識、博雅、體育、服務學習
 *   以及英文 Required / Elective / General / PE / Service
 *
 * 需要進一步細分「必修」是校共同必修還是專業必修：
 *   校共同必修：國文、英文、大一英文、英語聽講
 *   通識：通識、博雅、核心
 *   其餘必修：專業必修
 */
const COMMON_REQUIRED_KEYWORDS = [
  "國文", "英文", "大一英文", "英語聽講", "英語會話",
  "English", "Chinese", "大學國文",
];

export function mapCourseTypeDetailed(
  courseType?: string,
  courseName?: string,
): PUCreditCat {
  if (!courseType) return "free";
  const t = courseType.trim();

  // 體育
  if (t.includes("體育") || t === "PE") return "pe";
  // 服務學習
  if (t.includes("服務") || t.includes("Service")) return "service";
  // 通識
  if (t.includes("通識") || t.includes("博雅") || t.includes("核心") || t === "General") return "general";
  // 選修
  if (t.includes("選修") || t === "Elective" || t === "選") return "elective";

  // 必修 — 需判斷是校共同必修還是專業必修
  if (t.includes("必修") || t === "Required" || t === "必") {
    if (courseName) {
      const name = courseName.trim();
      for (const keyword of COMMON_REQUIRED_KEYWORDS) {
        if (name.includes(keyword)) return "common";
      }
    }
    return "required";
  }

  return "free";
}
