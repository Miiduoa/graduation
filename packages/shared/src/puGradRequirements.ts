/**
 * 靜宜大學 (Providence University) — 詳細畢業學分規則
 * 資料來源：E校園 課程架構圖系統 (mypu.pu.edu.tw)
 * 115 學年度入學適用
 */
import type {
  DetailedGradTemplate,
  DetailedCreditCategory,
  NonCreditRequirement,
  CourseRequirement,
  Department,
} from "./creditAudit";

// ---------------------------------------------------------------------------
// 靜宜大學 系所清單 (可擴充)
// ---------------------------------------------------------------------------
export const puDepartments: Department[] = [
  { id: "pu-csie", schoolId: "pu", name: "資訊工程學系", college: "資訊學院", programType: "university" },
  { id: "pu-im",   schoolId: "pu", name: "資訊管理學系", college: "資訊學院", programType: "university" },
  { id: "pu-csse", schoolId: "pu", name: "資訊傳播工程學系", college: "資訊學院", programType: "university" },
];

// ---------------------------------------------------------------------------
// 校訂課程 (University-mandated) — 全校共用
// ---------------------------------------------------------------------------

const universityCoreCourses: CourseRequirement[] = [
  // 基本學術能力課程
  { name: "英文（一）", credits: 2, required: true, suggestedYear: 1, suggestedSemester: 1 },
  { name: "英文（二）", credits: 2, required: true, suggestedYear: 1, suggestedSemester: 2 },
  { name: "閱讀與書寫（一）", credits: 2, required: true, suggestedYear: 1, suggestedSemester: 1 },
  { name: "閱讀與書寫（二）", credits: 2, required: true, suggestedYear: 1, suggestedSemester: 2 },
];

const universityCore: DetailedCreditCategory = {
  key: "university_core",
  label: "校訂課程",
  minCredits: 26,
  color: "#6366F1",
  subCategories: [
    {
      key: "basic_academic",
      label: "基本學術能力課程",
      minCredits: 8,
      courses: universityCoreCourses,
      notes: "英文一/二各2學分、閱讀與書寫一/二各2學分，共8學分必修",
    },
    {
      key: "ge_sustainability",
      label: "通識涵養 — 永續與在地",
      minCredits: 4,
      notes: "永續與在地向度至少4學分",
    },
    {
      key: "ge_religion",
      label: "通識涵養 — 宗教與思維",
      minCredits: 2,
      notes: "宗教與思維向度至少2學分",
    },
    {
      key: "ge_technology",
      label: "通識涵養 — 科技與服務",
      minCredits: 2,
      notes: "科技與服務向度至少2學分",
    },
    {
      key: "ge_interdisciplinary",
      label: "通識涵養 — 跨域與設計",
      minCredits: 4,
      notes: "跨域與設計向度至少4學分；四向度合計修習應達16學分以上",
    },
    {
      key: "pe",
      label: "體育課程",
      minCredits: 2,
      notes: "體育2學分",
    },
    {
      key: "humanities_cert",
      label: "人文素養課程",
      minCredits: 0,
      notes: "0學分，認證制（須通過人文素養認證）",
    },
  ],
  notes: "通識涵養課程四大向度合計至少16學分：永續與在地4、宗教與思維2、科技與服務2、跨域與設計4；另有4學分可分配於任一向度",
};

// ---------------------------------------------------------------------------
// 資訊學院共同必修
// ---------------------------------------------------------------------------
const collegeRequiredCourses: CourseRequirement[] = [
  { name: "計算機概論（一）", credits: 3, required: true, suggestedYear: 1, suggestedSemester: 1 },
  { name: "計算機概論（二）", credits: 3, required: true, suggestedYear: 1, suggestedSemester: 2 },
  { name: "資料結構", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 1 },
  { name: "網路通訊概論", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 2 },
  { name: "作業系統", credits: 3, required: true, suggestedYear: 3, suggestedSemester: 1 },
  { name: "生涯規劃及職場倫理講座", credits: 1, required: true, suggestedYear: 3, suggestedSemester: 2, notes: "講座課程" },
];

const collegeRequired: DetailedCreditCategory = {
  key: "college_required",
  label: "院共同必修",
  minCredits: 16,
  color: "#0EA5E9",
  courses: collegeRequiredCourses,
  notes: "資訊學院共同必修課程，含計算機概論一/二、資料結構、網路通訊概論、作業系統、生涯規劃及職場倫理講座",
};

// ---------------------------------------------------------------------------
// 系專業必修 (資工系)
// ---------------------------------------------------------------------------
const deptRequiredCourses_CSIE: CourseRequirement[] = [
  { name: "線性代數", credits: 3, required: true, suggestedYear: 1, suggestedSemester: 1 },
  { name: "離散數學", credits: 3, required: true, suggestedYear: 1, suggestedSemester: 2 },
  { name: "程式設計", credits: 3, required: true, suggestedYear: 1, suggestedSemester: 1 },
  { name: "進階程式設計", credits: 3, required: true, suggestedYear: 1, suggestedSemester: 2 },
  { name: "物件導向程式設計", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 1 },
  { name: "資訊數學（一）", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 1 },
  { name: "資訊數學（二）", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 2 },
  { name: "工程數學", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 2 },
  { name: "機率與統計", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 2 },
  { name: "邏輯設計", credits: 3, required: true, suggestedYear: 2, suggestedSemester: 1 },
  { name: "組合語言與系統程式", credits: 3, required: true, suggestedYear: 3, suggestedSemester: 1 },
  { name: "計算機組織學", credits: 3, required: true, suggestedYear: 3, suggestedSemester: 1 },
  { name: "演算法概論", credits: 3, required: true, suggestedYear: 3, suggestedSemester: 2 },
  { name: "專案實作（一）", credits: 1, required: true, suggestedYear: 4, suggestedSemester: 1 },
  { name: "專案實作（二）", credits: 1, required: true, suggestedYear: 4, suggestedSemester: 2 },
];

const deptRequired_CSIE: DetailedCreditCategory = {
  key: "dept_required",
  label: "系專業必修",
  minCredits: 41,
  color: "#EF4444",
  courses: deptRequiredCourses_CSIE,
  notes: "資工系專業必修共 41 學分",
};

// ---------------------------------------------------------------------------
// 專業選修 (資工系) — 含學程群
// ---------------------------------------------------------------------------
const electiveProgramCourses_software: CourseRequirement[] = [
  { name: "軟體工程", credits: 3, required: false },
  { name: "網頁程式設計", credits: 3, required: false },
  { name: "資料庫系統", credits: 3, required: false },
  { name: "數位內容導論", credits: 3, required: false },
  { name: "多媒體系統", credits: 3, required: false },
  { name: "視窗程式設計", credits: 3, required: false },
  { name: "軟體測試", credits: 3, required: false },
  { name: "敏捷軟體開發", credits: 3, required: false },
];

const electiveProgramCourses_digital: CourseRequirement[] = [
  { name: "數位系統設計", credits: 3, required: false },
  { name: "嵌入式系統", credits: 3, required: false },
  { name: "微處理機", credits: 3, required: false },
  { name: "FPGA設計實務", credits: 3, required: false },
  { name: "數位信號處理", credits: 3, required: false },
  { name: "VLSI設計概論", credits: 3, required: false },
];

const electiveProgramCourses_network: CourseRequirement[] = [
  { name: "人工智慧", credits: 3, required: false },
  { name: "機器學習", credits: 3, required: false },
  { name: "深度學習", credits: 3, required: false },
  { name: "自然語言處理", credits: 3, required: false },
  { name: "電腦視覺", credits: 3, required: false },
  { name: "資料探勘", credits: 3, required: false },
  { name: "雲端運算", credits: 3, required: false },
  { name: "大數據分析", credits: 3, required: false },
];

const electiveProgramCourses_ic: CourseRequirement[] = [
  { name: "IC設計概論", credits: 3, required: false },
  { name: "類比IC設計", credits: 3, required: false },
  { name: "積體電路佈局", credits: 3, required: false },
  { name: "SOC設計", credits: 3, required: false },
];

const electiveCrossDomainCourses: CourseRequirement[] = [
  // 跨領域實務課群 — 精選代表課程
  { name: "網路管理", credits: 3, required: false, notes: "網路管理課群" },
  { name: "物聯網應用", credits: 3, required: false, notes: "物聯網應用課群" },
  { name: "AI應用實務", credits: 3, required: false, notes: "AI課群" },
  { name: "行動應用程式開發", credits: 3, required: false, notes: "行動軟體課群" },
  { name: "智慧資料分析", credits: 3, required: false, notes: "智慧資料分析課群" },
  { name: "行動商務", credits: 3, required: false, notes: "行動商務課群" },
  { name: "文創動漫設計", credits: 3, required: false, notes: "文創動漫設計課群" },
  { name: "企業實習", credits: 3, required: false, notes: "企業實習課群" },
  { name: "資訊安全", credits: 3, required: false, notes: "資訊安全課群" },
  { name: "寰宇學習", credits: 3, required: false, notes: "寰宇學習課群" },
];

const deptElective_CSIE: DetailedCreditCategory = {
  key: "dept_elective",
  label: "專業選修",
  minCredits: 25,
  color: "#3B82F6",
  subCategories: [
    {
      key: "elective_general",
      label: "不分課群選修",
      minCredits: 0,
      notes: "不限學程群之專業選修",
    },
    {
      key: "prog_software",
      label: "資訊軟體學程",
      minCredits: 0,
      courses: electiveProgramCourses_software,
      notes: "資訊軟體學程選修課程",
    },
    {
      key: "prog_digital",
      label: "數位系統設計學程",
      minCredits: 0,
      courses: electiveProgramCourses_digital,
      notes: "數位系統設計學程選修課程",
    },
    {
      key: "prog_network_ai",
      label: "網路智慧學程",
      minCredits: 0,
      courses: electiveProgramCourses_network,
      notes: "網路智慧學程（含AI）選修課程",
    },
    {
      key: "prog_ic",
      label: "IC設計學程",
      minCredits: 0,
      courses: electiveProgramCourses_ic,
      notes: "IC設計學程選修課程",
    },
    {
      key: "cross_domain",
      label: "跨領域實務課群",
      minCredits: 0,
      courses: electiveCrossDomainCourses,
      notes: "含網路管理、物聯網應用、AI、行動軟體、智慧資料分析、行動商務、文創動漫設計、企業實習、資訊安全、寰宇學習等課群",
    },
  ],
  notes: "專業選修至少25學分；可選修任一學程群或跨領域實務課群的課程",
};

// ---------------------------------------------------------------------------
// 外系學分
// ---------------------------------------------------------------------------
const otherDeptCredits: DetailedCreditCategory = {
  key: "other_dept",
  label: "外系學分",
  minCredits: 0,
  maxCredits: 20,
  color: "#F59E0B",
  notes: "修習他系所得學分可列計本系畢業學分，上限為 20 學分",
};

// ---------------------------------------------------------------------------
// 非學分畢業條件
// ---------------------------------------------------------------------------
const nonCreditRequirements_CSIE: NonCreditRequirement[] = [
  {
    key: "english_proficiency",
    label: "校訂英文能力",
    type: "certification",
    description: "須通過校訂英文能力畢業門檻（如 TOEIC 550 分以上或等同測驗）",
    alternatives: ["修習英文能力補救課程並通過"],
  },
  {
    key: "programming_proficiency",
    label: "程式能力檢定",
    type: "certification",
    description: "須通過系訂程式能力檢定（如 CPE 或系上自辦檢定）",
    alternatives: ["修習「程式能力檢定替代課程」並通過"],
  },
  {
    key: "humanities_certification",
    label: "人文素養認證",
    type: "certification",
    description: "校訂人文素養課程認證（0學分，須完成認證活動）",
  },
];

// ---------------------------------------------------------------------------
// 完整模板組裝：資工系 115 學年度
// ---------------------------------------------------------------------------
export const puCSIE_115: DetailedGradTemplate = {
  id: "pu-csie-115",
  schoolId: "pu",
  schoolName: "靜宜大學",
  departmentId: "pu-csie",
  departmentName: "資訊工程學系",
  college: "資訊學院",
  academicYear: "115",
  programType: "university",
  division: "不分組",
  studentType: "一般生",
  totalCreditsRequired: 128,
  categories: [
    universityCore,     // 校訂 26 學分
    collegeRequired,    // 院必修 16 學分
    deptRequired_CSIE,  // 系必修 41 學分
    deptElective_CSIE,  // 專業選修 25+ 學分
    otherDeptCredits,   // 外系 0~20 學分
  ],
  nonCreditRequirements: nonCreditRequirements_CSIE,
  otherRules: [
    "畢業總學分至少 128 學分",
    "外系學分列計本系畢業學分上限為 20 學分",
    "通識涵養課程四大向度合計至少 16 學分",
    "專案實作（一）（二）為必修，需完成畢業專案",
  ],
};

// ---------------------------------------------------------------------------
// 所有可用模板的索引 (方便 UI 選取)
// ---------------------------------------------------------------------------
export const puDetailedTemplates: DetailedGradTemplate[] = [
  puCSIE_115,
  // 未來可在此新增：puIM_115, puCSSE_115, ...
];

/**
 * 根據系所ID + 入學年度查詢畢業規則模板
 */
export function findPuGradTemplate(
  departmentId: string,
  academicYear?: string
): DetailedGradTemplate | undefined {
  return puDetailedTemplates.find(
    (t) =>
      t.departmentId === departmentId &&
      (!academicYear || t.academicYear === academicYear)
  );
}

/**
 * 將 DetailedCreditCategory.key 映射回 legacy CreditCategory
 * (給舊 UI 做相容用)
 */
export function mapDetailedToLegacyCategory(
  detailedKey: string
): import("./creditAudit").CreditCategory {
  switch (detailedKey) {
    case "university_core":
      return "general";
    case "college_required":
    case "dept_required":
      return "required";
    case "dept_elective":
      return "elective";
    case "other_dept":
      return "other";
    default:
      return "other";
  }
}

/**
 * 取得某個 DetailedGradTemplate 中所有子類別的扁平列表
 * (給課程分類選擇器用)
 */
export function flattenCategories(
  template: DetailedGradTemplate
): Array<{ categoryKey: string; categoryLabel: string; subKey?: string; subLabel?: string }> {
  const result: Array<{
    categoryKey: string;
    categoryLabel: string;
    subKey?: string;
    subLabel?: string;
  }> = [];

  for (const cat of template.categories) {
    if (cat.subCategories && cat.subCategories.length > 0) {
      for (const sub of cat.subCategories) {
        result.push({
          categoryKey: cat.key,
          categoryLabel: cat.label,
          subKey: sub.key,
          subLabel: sub.label,
        });
      }
    } else {
      result.push({
        categoryKey: cat.key,
        categoryLabel: cat.label,
      });
    }
  }

  return result;
}
