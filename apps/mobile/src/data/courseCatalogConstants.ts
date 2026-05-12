/**
 * 靜宜大學 課綱查詢系統 — 完整資料字典
 * Source: https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/
 *
 * 把表單上所有可選的枚舉值（學期、星期、節次、大樓、修別、開課單位、課程種類、語言）
 * 全部建模成型別安全的常數，供 catalog client / 篩選 UI / AI 選課助理共用。
 *
 * 注意：實際課程紀錄（成千上萬筆 × 60+ 學期）不會 bundle 進 App，
 * 而是由 courseCatalogClient.ts 即時抓取 + 快取。
 */

// ─── 學期（Semester）─────────────────────────────────────────
// 採「學年-序號」格式：1=上學期、2=下學期、3=暑修第一階段、4=暑修第二階段
export type SemesterPart = 1 | 2 | 3 | 4;

export type CatalogSemester = {
  /** 完整代碼，例如 '1142' / '1133' */
  code: string;
  /** 民國學年（98–114） */
  year: number;
  /** 1=上學期 2=下學期 3=暑修-3 4=暑修-4 */
  part: SemesterPart;
  /** 中文標籤 */
  label: string;
};

function buildSemesters(): CatalogSemester[] {
  const list: CatalogSemester[] = [];
  for (let year = 114; year >= 98; year--) {
    const parts: { part: SemesterPart; suffix: string }[] = [
      { part: 2, suffix: '學期' },
      { part: 1, suffix: '學期' },
      { part: 4, suffix: '暑修' },
      { part: 3, suffix: '暑修' },
    ];
    for (const { part, suffix } of parts) {
      // 114-2、114-1 已上線；其餘暑修也歷年提供
      list.push({
        code: `${year}${part}`,
        year,
        part,
        label: `${year}-${part}${suffix}`,
      });
    }
  }
  return list;
}

export const CATALOG_SEMESTERS: CatalogSemester[] = buildSemesters();

/** 取當前對學生最相關的學期（最新非暑修） */
export function getCurrentCatalogSemester(): CatalogSemester {
  return CATALOG_SEMESTERS.find((s) => s.part === 2) ?? CATALOG_SEMESTERS[0];
}

// ─── 星期（Weekday）──────────────────────────────────────────
export const CATALOG_WEEKDAYS = [
  { value: 0, label: '不限' },
  { value: 1, label: '星期一' },
  { value: 2, label: '星期二' },
  { value: 3, label: '星期三' },
  { value: 4, label: '星期四' },
  { value: 5, label: '星期五' },
  { value: 6, label: '星期六' },
  { value: 7, label: '星期日' },
] as const;

// ─── 節次（Period）對照表 ────────────────────────────────────
// 以官方公告為準（資料來源頁面 2025 版本）
export type CatalogPeriod = {
  /** 表單 value，0 = 不限；1–13 為節次；12 為「中午」 */
  value: number;
  /** 顯示用 */
  label: string;
  /** 上課起 (HH:mm)，0 表示無 */
  start: string;
  /** 上課迄 (HH:mm)，0 表示無 */
  end: string;
  /** 是否為授課節次（中午不算） */
  teaching: boolean;
};

export const CATALOG_PERIODS: CatalogPeriod[] = [
  { value: 1, label: '第1節', start: '08:10', end: '09:00', teaching: true },
  { value: 2, label: '第2節', start: '09:10', end: '10:00', teaching: true },
  { value: 3, label: '第3節', start: '10:10', end: '11:00', teaching: true },
  { value: 4, label: '第4節', start: '11:10', end: '12:00', teaching: true },
  { value: 99, label: '中午', start: '12:00', end: '13:00', teaching: false },
  { value: 5, label: '第5節', start: '13:10', end: '14:00', teaching: true },
  { value: 6, label: '第6節', start: '14:10', end: '15:00', teaching: true },
  { value: 7, label: '第7節', start: '15:10', end: '16:00', teaching: true },
  { value: 8, label: '第8節', start: '16:10', end: '17:00', teaching: true },
  { value: 9, label: '第9節', start: '17:10', end: '18:00', teaching: true },
  { value: 10, label: '第10節', start: '18:05', end: '18:55', teaching: true },
  { value: 11, label: '第11節', start: '19:00', end: '19:50', teaching: true },
  { value: 12, label: '第12節', start: '19:55', end: '20:45', teaching: true },
  { value: 13, label: '第13節', start: '20:50', end: '21:40', teaching: true },
];

/** 節次 -> 時段；可給 puDirectScraper / smartCalendar 共用 */
export const PERIOD_INDEX: Record<number, CatalogPeriod> = CATALOG_PERIODS.reduce(
  (acc, p) => {
    acc[p.value] = p;
    return acc;
  },
  {} as Record<number, CatalogPeriod>,
);

// ─── 大樓代碼（Building）─────────────────────────────────────
export type CatalogBuilding = {
  code: string;
  zh: string;
  en: string;
  /** 是否為標準教學大樓（用於 RoomBooking、AR Map 整合） */
  classroom: boolean;
};

export const CATALOG_BUILDINGS: CatalogBuilding[] = [
  { code: 'AK', zh: '任垣樓', en: 'Anthony Kuo Hall', classroom: true },
  { code: 'SP', zh: '伯鐸樓', en: 'St. Peter Hall', classroom: true },
  { code: 'JA', zh: '靜安樓', en: 'Jing An Hall', classroom: true },
  { code: 'TG', zh: '格倫樓', en: 'Theodore Guerin Hall', classroom: true },
  { code: 'PH', zh: '主顧樓', en: 'Providence Hall', classroom: true },
  { code: 'SF', zh: '方濟樓', en: 'St. Francis Hall', classroom: true },
  { code: 'SY', zh: '思源樓', en: 'Si Yuan Hall', classroom: true },
  { code: '2R', zh: '第二研究大樓', en: 'The 2nd Research Building', classroom: false },
  {
    code: 'AK-3C',
    zh: '資訊處',
    en: 'Office of Information Technology Services',
    classroom: false,
  },
  { code: '1R', zh: '第一研究大樓', en: 'The 1st Research Building', classroom: false },
  { code: 'ST', zh: '體育館', en: 'John Paul II Sports Hall', classroom: true },
  { code: 'SD', zh: '田徑場', en: 'Athletic Field', classroom: true },
];

export const BUILDING_INDEX: Record<string, CatalogBuilding> = CATALOG_BUILDINGS.reduce(
  (acc, b) => {
    acc[b.code] = b;
    return acc;
  },
  {} as Record<string, CatalogBuilding>,
);

// ─── 修別（Course Type）─────────────────────────────────────
export type CatalogCourseType =
  | 'required' // 必修
  | 'elective' // 選修
  | 'general' // 通識
  | 'edu_required' // 教必（教育學程必修）
  | 'edu_elective' // 教選（教育學程選修）
  | 'double' // 雙修
  | 'minor'; // 輔修

export const CATALOG_COURSE_TYPES: { value: CatalogCourseType; label: string }[] = [
  { value: 'required', label: '必修' },
  { value: 'elective', label: '選修' },
  { value: 'general', label: '通識' },
  { value: 'edu_required', label: '教必' },
  { value: 'edu_elective', label: '教選' },
  { value: 'double', label: '雙修' },
  { value: 'minor', label: '輔修' },
];

// ─── 課程種類（Course Category）─────────────────────────────
export type CatalogCourseCategory =
  | 'edu_program' // 教育學程
  | 'minor_double' // 輔系雙主修
  | 'pe' // 體育
  | 'national_defense' // 全民國防
  | 'common_elective' // 共同選
  | 'ge_sustainability' // 通識(永續與在地)
  | 'ge_religion_thinking' // 通識(宗教與思維)
  | 'ge_tech_service' // 通識(科技與服務)
  | 'ge_cross_design' // 通識(跨域與設計)
  | 'ge_culture' // 通識(台灣與世界文化)
  | 'ge_life_ecology' // 通識(生命與生態環境)
  | 'ge_religion_philosophy' // 通識(宗教與哲學思維)
  | 'ge_math_science' // 通識(數理與科學技術)
  | 'ge_society_public' // 通識(社會與公共秩序)
  | 'ge_literature_aesthetics' // 通識(文學與美感經驗)
  | 'digital' // 數位課程
  | 'micro_credit' // 微學分課程
  | 'practical_internship'; // 實務實習課程

export const CATALOG_COURSE_CATEGORIES: { value: CatalogCourseCategory; label: string }[] = [
  { value: 'edu_program', label: '教育學程' },
  { value: 'minor_double', label: '輔系雙主修' },
  { value: 'pe', label: '體育' },
  { value: 'national_defense', label: '全民國防' },
  { value: 'common_elective', label: '共同選' },
  { value: 'ge_sustainability', label: '通識(永續與在地)' },
  { value: 'ge_religion_thinking', label: '通識(宗教與思維)' },
  { value: 'ge_tech_service', label: '通識(科技與服務)' },
  { value: 'ge_cross_design', label: '通識(跨域與設計)' },
  { value: 'ge_culture', label: '通識(台灣與世界文化)' },
  { value: 'ge_life_ecology', label: '通識(生命與生態環境)' },
  { value: 'ge_religion_philosophy', label: '通識(宗教與哲學思維)' },
  { value: 'ge_math_science', label: '通識(數理與科學技術)' },
  { value: 'ge_society_public', label: '通識(社會與公共秩序)' },
  { value: 'ge_literature_aesthetics', label: '通識(文學與美感經驗)' },
  { value: 'digital', label: '數位課程' },
  { value: 'micro_credit', label: '微學分課程' },
  { value: 'practical_internship', label: '實務實習課程' },
];

// ─── 授課語言（Language）─────────────────────────────────────
export type CatalogLanguage =
  | 'zh'
  | 'en_100'
  | 'en_70'
  | 'en_60'
  | 'jp'
  | 'es'
  | 'la'
  | 'fr'
  | 'ru'
  | 'de'
  | 'other';

export const CATALOG_LANGUAGES: { value: CatalogLanguage; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en_100', label: '100%英文' },
  { value: 'en_70', label: '70%英文' },
  { value: 'en_60', label: '60%英文' },
  { value: 'jp', label: '日文' },
  { value: 'es', label: '西文' },
  { value: 'la', label: '拉丁文' },
  { value: 'fr', label: '法文' },
  { value: 'ru', label: '俄文' },
  { value: 'de', label: '德文' },
  { value: 'other', label: '其他' },
];

// ─── 開課單位（College / Department）樹狀結構 ──────────────
export type CatalogCollege = {
  key: string;
  zh: string;
  departments: CatalogDepartment[];
};

export type CatalogDepartment = {
  /** 表單送出的中文值（與官方對齊） */
  value: string;
  /** UI label，多半同 value */
  label: string;
  /** 是否為研究所 / 進修班 / 學程 */
  programType: 'undergrad' | 'graduate' | 'continuing' | 'program' | 'service';
};

/**
 * 完整還原課綱查詢系統表單上的「開課單位」清單。
 * 順序與官方表單一致，未來可由 courseCatalogClient.fetchOrganization() 動態同步。
 */
export const CATALOG_COLLEGES: CatalogCollege[] = [
  {
    key: 'science',
    zh: '理學院',
    departments: [
      { value: '食營系', label: '食營系', programType: 'undergrad' },
      { value: '應化系', label: '應化系', programType: 'undergrad' },
      { value: '化科系', label: '化科系', programType: 'undergrad' },
      { value: '財工系', label: '財工系', programType: 'undergrad' },
      { value: '國際碩士產學班', label: '國際碩士產學班', programType: 'graduate' },
      {
        value: '永續智慧學士學位學程',
        label: '永續智慧學士學位學程',
        programType: 'program',
      },
    ],
  },
  {
    key: 'management',
    zh: '管理學院',
    departments: [
      { value: '管碩專班', label: '管碩專班', programType: 'graduate' },
      { value: '會計系', label: '會計系', programType: 'undergrad' },
      { value: '觀光系', label: '觀光系', programType: 'undergrad' },
      { value: '財金系', label: '財金系', programType: 'undergrad' },
      { value: '國企系', label: '國企系', programType: 'undergrad' },
      {
        value: '創創碩士學位學程',
        label: '創創碩士學位學程',
        programType: 'graduate',
      },
      { value: '行銷數位經營系', label: '行銷數位經營系', programType: 'undergrad' },
      { value: '經管進學班', label: '經管進學班', programType: 'continuing' },
    ],
  },
  {
    key: 'foreign_language',
    zh: '外語學院',
    departments: [
      { value: '英文系', label: '英文系', programType: 'undergrad' },
      { value: '西文系', label: '西文系', programType: 'undergrad' },
      { value: '日文系', label: '日文系', programType: 'undergrad' },
    ],
  },
  {
    key: 'humanities_social',
    zh: '人社院',
    departments: [
      { value: '中文系', label: '中文系', programType: 'undergrad' },
      { value: '台文系', label: '台文系', programType: 'undergrad' },
      { value: '法律系', label: '法律系', programType: 'undergrad' },
      { value: '生態系', label: '生態系', programType: 'undergrad' },
      { value: '大傳系', label: '大傳系', programType: 'undergrad' },
      { value: '教研所', label: '教研所', programType: 'graduate' },
      { value: '社工系', label: '社工系', programType: 'undergrad' },
      {
        value: '犯罪防治碩士學位學程',
        label: '犯罪防治碩士學位學程',
        programType: 'graduate',
      },
      {
        value: '社企文創碩士學程',
        label: '社企文創碩士學程',
        programType: 'graduate',
      },
      {
        value: '原民文化碩士學程',
        label: '原民文化碩士學程',
        programType: 'graduate',
      },
      { value: '法律原民專班', label: '法律原民專班', programType: 'undergrad' },
      { value: '社工原民專班', label: '社工原民專班', programType: 'undergrad' },
      { value: '社福博班', label: '社福博班', programType: 'graduate' },
      { value: '犯防原民專班', label: '犯防原民專班', programType: 'undergrad' },
      { value: '社工培力專班', label: '社工培力專班', programType: 'continuing' },
      { value: '師培中心', label: '師培中心', programType: 'service' },
    ],
  },
  {
    key: 'informatics',
    zh: '資訊學院',
    departments: [
      { value: '資管系', label: '資管系', programType: 'undergrad' },
      { value: '資工系', label: '資工系', programType: 'undergrad' },
      {
        value: '國際資訊學士學程',
        label: '國際資訊學士學程',
        programType: 'program',
      },
      { value: '人工智慧系', label: '人工智慧系', programType: 'undergrad' },
      { value: '資科系', label: '資科系', programType: 'undergrad' },
      {
        value: '晶片設計學士學位學程',
        label: '晶片設計學士學位學程',
        programType: 'program',
      },
      {
        value: '人工智慧培力專班',
        label: '人工智慧培力專班',
        programType: 'continuing',
      },
    ],
  },
  {
    key: 'language_center',
    zh: '外語教學中心',
    departments: [{ value: '外語教學中心', label: '外語教學中心', programType: 'service' }],
  },
  {
    key: 'international',
    zh: '國際學院',
    departments: [
      { value: '寰管碩士學程', label: '寰管碩士學程', programType: 'graduate' },
      {
        value: '寰宇管理學士學程',
        label: '寰宇管理學士學程',
        programType: 'program',
      },
      {
        value: '寰宇外語教育學程',
        label: '寰宇外語教育學程',
        programType: 'program',
      },
      {
        value: '智慧媒體學士學位學程',
        label: '智慧媒體學士學位學程',
        programType: 'program',
      },
      {
        value: '博雅教育學士學程',
        label: '博雅教育學士學程',
        programType: 'program',
      },
    ],
  },
  {
    key: 'general_education',
    zh: '通識中心',
    departments: [
      { value: '通識涵養課程', label: '通識涵養課程', programType: 'service' },
      { value: '通識學程', label: '通識學程', programType: 'program' },
    ],
  },
  {
    key: 'pe_office',
    zh: '體育室',
    departments: [{ value: '體育室', label: '體育室', programType: 'service' }],
  },
  {
    key: 'literacy',
    zh: '閱讀書寫',
    departments: [{ value: '閱讀書寫', label: '閱讀書寫', programType: 'service' }],
  },
  {
    key: 'it_literacy',
    zh: '資訊能力',
    departments: [{ value: '資訊能力', label: '資訊能力', programType: 'service' }],
  },
  {
    key: 'military',
    zh: '軍訓室',
    departments: [{ value: '軍訓室', label: '軍訓室', programType: 'service' }],
  },
  {
    key: 'english_advanced',
    zh: '英特、資訊進階',
    departments: [
      { value: '英特、資訊進階', label: '英特、資訊進階', programType: 'service' },
    ],
  },
  {
    key: 'summer',
    zh: '暑修',
    departments: [{ value: '暑修', label: '暑修', programType: 'service' }],
  },
  {
    key: 'exchange',
    zh: '交換學生',
    departments: [
      { value: '交換學生', label: '交換學生', programType: 'service' },
      { value: '交換學生(碩)', label: '交換學生(碩)', programType: 'graduate' },
    ],
  },
  {
    key: 'chinese_center',
    zh: '華文中心',
    departments: [{ value: '華文中心', label: '華文中心', programType: 'service' }],
  },
  {
    key: 'external',
    zh: '校外輔雙',
    departments: [{ value: '校外輔雙', label: '校外輔雙', programType: 'service' }],
  },
  {
    key: 'teaching_dev',
    zh: '教發中心',
    departments: [{ value: '教發中心', label: '教發中心', programType: 'service' }],
  },
  {
    key: 'research',
    zh: '研發處',
    departments: [{ value: '研發處', label: '研發處', programType: 'service' }],
  },
  {
    key: 'academic_affairs',
    zh: '教務處',
    departments: [{ value: '教務處', label: '教務處', programType: 'service' }],
  },
  {
    key: 'industry_college',
    zh: '產業學院',
    departments: [{ value: '產業學院', label: '產業學院', programType: 'service' }],
  },
  {
    key: 'career_office',
    zh: '職產處',
    departments: [{ value: '職產處', label: '職產處', programType: 'service' }],
  },
];

/** 攤平所有開課單位（給單一下拉清單用） */
export const CATALOG_DEPARTMENTS_FLAT: Array<CatalogDepartment & { college: string }> =
  CATALOG_COLLEGES.flatMap((c) =>
    c.departments.map((d) => ({ ...d, college: c.zh })),
  );

// ─── 核心能力（Core Competency）─────────────────────────────
// 「依核心能力查詢」是進階查詢的子模組，
// 通識中心 / 教務處公告 8 大核心能力
export type CatalogCoreCompetency = {
  key: string;
  label: string;
  description: string;
};

export const CATALOG_CORE_COMPETENCIES: CatalogCoreCompetency[] = [
  { key: 'ethics', label: '品格倫理', description: '建立正確價值觀與生命倫理意識' },
  { key: 'social_care', label: '社會關懷', description: '同理弱勢、實踐服務學習' },
  {
    key: 'professional',
    label: '專業實踐',
    description: '應用本科專業知能於實務情境',
  },
  { key: 'cross_disciplinary', label: '跨域整合', description: '結合不同領域進行創新思考' },
  { key: 'communication', label: '溝通協作', description: '中外文表達、團隊合作' },
  {
    key: 'critical_thinking',
    label: '批判思考',
    description: '獨立分析、邏輯推理',
  },
  { key: 'global_view', label: '國際視野', description: '理解全球議題與多元文化' },
  { key: 'lifelong', label: '終身學習', description: '自主學習、適應變遷' },
];

// ─── 篩選預設值（Filter Defaults）──────────────────────────
export type CatalogFilter = {
  semester: string; // CatalogSemester.code
  keyword?: string;
  courseCode?: string;
  weekday?: number; // 0 = 不限
  period?: number; // 0 = 不限
  building?: string;
  courseType?: CatalogCourseType;
  courseName?: string;
  teacher?: string;
  college?: string; // CatalogCollege.zh
  department?: string; // CatalogDepartment.value
  classOffered?: string;
  category?: CatalogCourseCategory;
  language?: CatalogLanguage;
  coreCompetency?: string;
};

export const CATALOG_DEFAULT_FILTER: CatalogFilter = {
  semester: getCurrentCatalogSemester().code,
};
