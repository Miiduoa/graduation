/**
 * 課綱查詢系統 — 角色 × 資料 對應表
 *
 * 把課綱資料的每個欄位（學期、修別、課程種類、節次、大樓、開課單位、語言、教師、學分…）
 * 對應到 App 的 11 種角色（UserRole + 衍生身份），並定義每個角色在此模組能做什麼。
 *
 * 本檔僅是宣告式對應，CourseCatalogScreen 與其他 Hub 依此渲染入口/動作。
 */

import type { UserRole } from '../data/types';
import type { Permission } from './permissions';
import type {
  CatalogCourseCategory,
  CatalogCourseType,
  CatalogFilter,
} from '../data/courseCatalogConstants';

// ─── 角色擴充：把 vendor / visitor 也納進來 ────────────────
export type ExtendedRole = UserRole | 'visitor';

// ─── 該角色在課綱模組的「主要任務」 ────────────────────────
export type CatalogRoleScenario =
  | 'pick_personal_course' // 學生：挑選下學期課
  | 'explore_courses' // 學生/校友：純探索
  | 'verify_offering' // 教師/系主任：確認自己/系上開課
  | 'workload_planning' // 教師：備課負擔規劃
  | 'classroom_lookup' // 教師/職員：教室預約前查課表
  | 'curriculum_audit' // 系主任：本系課表覆蓋率、核心能力對應
  | 'cross_listing' // 系主任/教務：跨院/雙修/輔修核對
  | 'reporting' // 教務/校級：開課量統計、語言別、學分結構
  | 'public_browse' // 訪客：公開瀏覽
  | 'sales_targeting' // 廠商：依課表時段定位人潮（咖啡/印刷等）
  | 'alumni_lookback'; // 校友：回查當年所修

export type CatalogRoleAction = {
  id: string;
  label: string;
  description: string;
  /** 預設套用的篩選 */
  defaultFilter?: Partial<CatalogFilter>;
  /** 觸發時要 navigate 的路由名稱 */
  route?: string;
  /** 是否需要某些權限 */
  requires?: Permission[];
};

export type CatalogRoleConfig = {
  role: ExtendedRole;
  zhName: string;
  scenarios: CatalogRoleScenario[];
  /** 進入課綱查詢的快捷篩選按鈕 */
  quickActions: CatalogRoleAction[];
  /** 該角色看到的「重點欄位」（UI 上會優先顯示） */
  highlightedFields: CatalogField[];
  /** 該角色「不需要」看到的欄位（可摺疊起來） */
  hiddenFields?: CatalogField[];
  /** 是否可一鍵加入個人課表 */
  canAddToSchedule: boolean;
  /** 是否可比對畢業學分 */
  canCompareGraduation: boolean;
  /** 是否可開出統計報表 */
  canExportReport: boolean;
};

export type CatalogField =
  | 'semester'
  | 'code'
  | 'name'
  | 'nameEn'
  | 'courseType'
  | 'credits'
  | 'department'
  | 'classOffered'
  | 'teacher'
  | 'timePlace'
  | 'building'
  | 'capacity'
  | 'enrolled'
  | 'language'
  | 'tags'
  | 'syllabusUrl';

// ─── 共用快捷動作（會被多個角色引用） ──────────────────────

const QA_THIS_SEMESTER: CatalogRoleAction = {
  id: 'this_semester',
  label: '本學期所有課',
  description: '預設過濾為當前學期，可再依院系縮小範圍',
  defaultFilter: {},
};

const QA_GE_COURSES: CatalogRoleAction = {
  id: 'general_ed',
  label: '通識課程',
  description: '8 大向度通識，學生可挑湊學分；教師可查同向度開課情況',
  defaultFilter: { courseType: 'general' as CatalogCourseType },
};

const QA_PE: CatalogRoleAction = {
  id: 'pe',
  label: '體育課程',
  description: '體育室開設的學期體育/運動類選修',
  defaultFilter: { category: 'pe' as CatalogCourseCategory },
};

const QA_EMI: CatalogRoleAction = {
  id: 'emi',
  label: '全英語課程 (EMI)',
  description: '100%/70% 英語授課的課程，國際生與雙語推動用',
  defaultFilter: { language: 'en_100' },
};

const QA_DIGITAL: CatalogRoleAction = {
  id: 'digital',
  label: '數位課程',
  description: '線上/非同步數位學分，可彈性安排',
  defaultFilter: { category: 'digital' as CatalogCourseCategory },
};

const QA_MICRO: CatalogRoleAction = {
  id: 'micro_credit',
  label: '微學分課程',
  description: '0.5–1 學分的短期模組，常為跨域、職涯',
  defaultFilter: { category: 'micro_credit' as CatalogCourseCategory },
};

const QA_INTERN: CatalogRoleAction = {
  id: 'practical',
  label: '實務實習',
  description: '校外實習、產業學程課程',
  defaultFilter: { category: 'practical_internship' as CatalogCourseCategory },
};

const QA_EDU_PROGRAM: CatalogRoleAction = {
  id: 'edu_program',
  label: '教育學程',
  description: '修教程的同學會用到的教必/教選',
  defaultFilter: { category: 'edu_program' as CatalogCourseCategory },
};

const QA_DOUBLE_MINOR: CatalogRoleAction = {
  id: 'minor_double',
  label: '輔系/雙主修',
  description: '系主任可查申請輔雙的學生會修什麼',
  defaultFilter: { category: 'minor_double' as CatalogCourseCategory },
};

// ─── 各角色設定 ───────────────────────────────────────────

export const CATALOG_ROLE_MATRIX: CatalogRoleConfig[] = [
  {
    role: 'student',
    zhName: '學生',
    scenarios: ['pick_personal_course', 'explore_courses'],
    quickActions: [
      QA_THIS_SEMESTER,
      QA_GE_COURSES,
      QA_PE,
      QA_DIGITAL,
      QA_MICRO,
      QA_EDU_PROGRAM,
      QA_EMI,
    ],
    highlightedFields: [
      'name',
      'teacher',
      'timePlace',
      'credits',
      'courseType',
      'capacity',
      'enrolled',
      'tags',
      'syllabusUrl',
    ],
    canAddToSchedule: true,
    canCompareGraduation: true,
    canExportReport: false,
  },
  {
    role: 'alumni',
    zhName: '校友',
    scenarios: ['alumni_lookback', 'explore_courses'],
    quickActions: [QA_THIS_SEMESTER, QA_MICRO, QA_INTERN],
    highlightedFields: ['semester', 'name', 'teacher', 'department', 'syllabusUrl'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: false,
  },
  {
    role: 'teacher',
    zhName: '教師',
    scenarios: ['verify_offering', 'workload_planning', 'classroom_lookup'],
    quickActions: [
      {
        id: 'my_offerings',
        label: '我的開課',
        description: '本學期我所授課程一覽（依老師名查）',
      },
      QA_THIS_SEMESTER,
      QA_DIGITAL,
      QA_MICRO,
    ],
    highlightedFields: [
      'code',
      'name',
      'teacher',
      'classOffered',
      'timePlace',
      'building',
      'capacity',
      'enrolled',
    ],
    canAddToSchedule: true,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'professor',
    zhName: '教授',
    scenarios: ['verify_offering', 'workload_planning', 'curriculum_audit'],
    quickActions: [
      {
        id: 'my_offerings',
        label: '我的開課',
        description: '本學期所有授課',
      },
      QA_THIS_SEMESTER,
      QA_EMI,
    ],
    highlightedFields: ['code', 'name', 'classOffered', 'timePlace', 'enrolled', 'capacity'],
    canAddToSchedule: true,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'department_head',
    zhName: '系所主管',
    scenarios: ['curriculum_audit', 'cross_listing', 'reporting'],
    quickActions: [
      {
        id: 'dept_offerings',
        label: '本系開課',
        description: '本系本學期所有課程，含必/選/輔雙',
      },
      QA_DOUBLE_MINOR,
      QA_EMI,
      QA_INTERN,
    ],
    highlightedFields: [
      'code',
      'name',
      'teacher',
      'classOffered',
      'courseType',
      'credits',
      'enrolled',
      'capacity',
      'language',
      'tags',
    ],
    canAddToSchedule: false,
    canCompareGraduation: true,
    canExportReport: true,
  },
  {
    role: 'principal',
    zhName: '校長 / 一級主管',
    scenarios: ['reporting', 'cross_listing'],
    quickActions: [QA_EMI, QA_INTERN, QA_DIGITAL, QA_MICRO],
    highlightedFields: ['department', 'courseType', 'credits', 'enrolled', 'language'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'department',
    zhName: '系辦助理',
    scenarios: ['curriculum_audit', 'cross_listing'],
    quickActions: [
      {
        id: 'dept_offerings',
        label: '本系開課',
        description: '校務行政查詢本系課表/教師教學負擔',
      },
      QA_EDU_PROGRAM,
      QA_DOUBLE_MINOR,
    ],
    highlightedFields: ['code', 'name', 'teacher', 'classOffered', 'timePlace', 'enrolled'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'school',
    zhName: '教務 / 校級',
    scenarios: ['reporting', 'cross_listing'],
    quickActions: [QA_EMI, QA_DIGITAL, QA_MICRO, QA_INTERN, QA_GE_COURSES],
    highlightedFields: [
      'semester',
      'department',
      'courseType',
      'credits',
      'enrolled',
      'capacity',
      'language',
      'tags',
    ],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'admin',
    zhName: '系統管理員',
    scenarios: ['reporting', 'cross_listing'],
    quickActions: [QA_THIS_SEMESTER, QA_EMI, QA_DIGITAL, QA_INTERN],
    highlightedFields: ['semester', 'department', 'courseType', 'credits', 'language', 'tags'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'staff',
    zhName: '行政職員',
    scenarios: ['classroom_lookup'],
    quickActions: [
      {
        id: 'building_busy',
        label: '教室使用情形',
        description: '依大樓查當前學期上課時段，協助租借/維護排程',
      },
      QA_PE,
    ],
    highlightedFields: ['timePlace', 'building', 'classOffered', 'enrolled'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: true,
  },
  {
    role: 'vendor',
    zhName: '商家 / 餐廳老闆',
    scenarios: ['sales_targeting'],
    quickActions: [
      {
        id: 'lunch_window',
        label: '中午下課人潮',
        description: '查 4 節結束、12:00 前後散場的課程數',
        defaultFilter: { period: 4 },
      },
      {
        id: 'evening_peak',
        label: '晚間 5–6 節',
        description: '對應晚餐時段人潮預測',
        defaultFilter: { period: 5 },
      },
    ],
    highlightedFields: ['timePlace', 'building', 'enrolled'],
    hiddenFields: ['credits', 'syllabusUrl', 'language', 'tags'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: false,
  },
  {
    role: 'visitor',
    zhName: '訪客',
    scenarios: ['public_browse'],
    quickActions: [QA_THIS_SEMESTER, QA_GE_COURSES, QA_EMI],
    highlightedFields: ['name', 'teacher', 'department', 'courseType', 'credits', 'language'],
    hiddenFields: ['enrolled', 'capacity', 'syllabusUrl'],
    canAddToSchedule: false,
    canCompareGraduation: false,
    canExportReport: false,
  },
];

// ─── 工具函式 ─────────────────────────────────────────────

export function getCatalogRoleConfig(role: ExtendedRole | null | undefined): CatalogRoleConfig {
  const r = role ?? 'visitor';
  return (
    CATALOG_ROLE_MATRIX.find((c) => c.role === r) ??
    CATALOG_ROLE_MATRIX.find((c) => c.role === 'visitor')!
  );
}

/**
 * 對應「課綱欄位」與「資料庫/Firestore 主資料」之間的 join：
 * 例如 catalog.code 對應 enrollments.courseCode、catalog.classOffered 對應 users.className
 *
 * UI 不直接使用，但留給 AI agent / data router 做語意連結。
 */
export const CATALOG_FIELD_JOINS: Array<{
  catalogField: CatalogField;
  joinsTo: Array<{ domain: string; field: string; via: string }>;
}> = [
  {
    catalogField: 'code',
    joinsTo: [
      { domain: 'enrollments', field: 'courseCode', via: 'exact' },
      { domain: 'schedule.courses', field: 'code', via: 'exact' },
      { domain: 'grades', field: 'courseCode', via: 'exact' },
    ],
  },
  {
    catalogField: 'classOffered',
    joinsTo: [
      { domain: 'users', field: 'className', via: 'substring' },
      { domain: 'studentInfo', field: 'className', via: 'exact' },
    ],
  },
  {
    catalogField: 'teacher',
    joinsTo: [
      { domain: 'users', field: 'displayName', via: 'fuzzy' },
      { domain: 'teachers', field: 'name', via: 'fuzzy' },
    ],
  },
  {
    catalogField: 'department',
    joinsTo: [
      { domain: 'departments', field: 'name', via: 'exact' },
      { domain: 'users.profile', field: 'department', via: 'exact' },
      { domain: 'puGradRequirements', field: 'department', via: 'mapping' },
    ],
  },
  {
    catalogField: 'building',
    joinsTo: [
      { domain: 'map.pois', field: 'buildingCode', via: 'exact' },
      { domain: 'roomBooking', field: 'building', via: 'exact' },
    ],
  },
  {
    catalogField: 'timePlace',
    joinsTo: [
      { domain: 'schedule.slots', via: 'composite', field: 'dayOfWeek+period' },
      { domain: 'attendance.sessions', via: 'composite', field: 'startTime' },
      { domain: 'smartCalendar.events', via: 'composite', field: 'startTime+endTime' },
    ],
  },
  {
    catalogField: 'courseType',
    joinsTo: [
      {
        domain: 'creditAudit.categories',
        field: 'requirementKey',
        via: 'mapping(required→core, elective→elective, general→ge)',
      },
    ],
  },
];
