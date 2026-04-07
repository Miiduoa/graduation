import type { CreditCategory } from "./creditAudit";

export const PROVIDENCE_UNIVERSITY_SCHOOL_ID = "pu";
export const PROVIDENCE_UNIVERSITY_SCHOOL_CODE = "PU";

export type PuStudentInfoPayload = {
  studentId: string | null;
  name: string | null;
  className?: string | null;
  class?: string | null;
  currentSemester: string | null;
};

export type PuCoursePayload = {
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

export type PuCourseResultPayload = {
  courses: PuCoursePayload[];
  studentInfo: {
    class?: string | null;
    className?: string | null;
    studentId: string | null;
    name: string | null;
    currentSemester?: string | null;
  };
  semester: string | null;
  totalCredits: number;
};

export type PuGradePayload = {
  semester: string;
  courseName: string;
  courseNameEn: string;
  class?: string;
  className?: string;
  courseType: string;
  credits: number;
  score: number | string;
};

export type PuGradeResultPayload = {
  grades: PuGradePayload[];
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

// ── Legacy type (kept for backward compat with old cache entries) ──
export type PuCreditAuditCategorySummary = {
  label: string;
  earned: number | null;
  required: number | null;
  remaining: number | null;
};

export type PuCreditAuditPayloadLegacy = {
  sourceUrl?: string | null;
  total: {
    earned: number | null;
    required: number | null;
    remaining: number | null;
  };
  byCategory: Partial<Record<CreditCategory, PuCreditAuditCategorySummary>>;
  rawCategoryRows?: Array<{
    label: string;
    values: string[];
  }>;
};

// ── Comprehensive Credit Audit Data Model (v2) ──

/** 必修尚缺科目 — a single missing required course */
export type PuMissingRequiredCourse = {
  courseName: string;
  /** 缺修 / 通過 / 修習中 / 免修 */
  status: "缺修" | "通過" | "修習中" | "免修" | string;
  /** Additional rules text, e.g. 體育修課規定 */
  rules?: string;
};

/** 通識向度修習情形 — one row in 各向度修習情形 table */
export type PuGeneralEdDimension = {
  /** e.g. "永續與在地", "宗教與思維", "科技與服務", "跨域與設計" */
  dimension: string;
  /** 至少應修學分數 */
  requiredCredits: number;
  /** 取得學分數 */
  earnedCredits: number;
  /** 備註 text */
  note?: string;
};

/** 通識必修 — required general ed courses by dimension */
export type PuRequiredGeneralCourse = {
  dimension: string;
  credits: number;
  courseName: string;
};

/** 修習中通識科目 — in-progress general ed course */
export type PuInProgressGeneralCourse = {
  courseGroup: string;
  courseName: string;
  grade: string;
  semester: string;
  credits: number;
  rules?: string;
};

/** 尚缺必選科目 */
export type PuMissingRequiredElective = {
  courseName: string;
  rules?: string;
};

/** 重覆修習科目 */
export type PuRepeatedCourse = {
  courseName: string;
  className?: string;
  semester?: string;
  credits?: number;
  score?: string;
};

/** 已通過之校內檢定 */
export type PuPassedCertification = {
  name: string;
  date?: string;
  note?: string;
};

/** 專業選修必備選項 */
export type PuProfessionalElectiveOption = {
  courseGroup: string;
  courseName: string;
  className?: string;
  semester?: string;
  credits?: number;
  earnedCredits?: number;
  rules?: string;
};

/** 修習學分累計 — credit totals extracted from 【】 brackets */
export type PuCreditTotals = {
  required: number | null;       // 【必修】
  elective: number | null;       // 【選修】
  externalElective: number | null; // 【外系選修】
  generalOld: number | null;     // 【通識-六大學群】
  generalNew: number | null;     // 【通識-四大向度】
  subtotal: number | null;       // 【小計】
  minorDouble: number | null;    // 【輔雙】
};

/** 歷年修課明細 — one semester's grade data */
export type PuSemesterGradeRecord = {
  semester: string;
  courses: Array<{
    courseName: string;
    courseNameEn: string;
    className: string;
    courseType: string;
    credits: number;
    score: number | string;
  }>;
  semesterAverage?: number | string;
  behaviorScore?: number | string;
  classRanking?: string;
  departmentRanking?: string;
};

/** 學年排名 */
export type PuAcademicYearRanking = {
  academicYear: string;
  classRanking?: string;
  departmentRanking?: string;
};

/** Full comprehensive credit audit payload (v2) */
export type PuCreditAuditPayload = {
  version: 2;
  fetchedAt: string; // ISO timestamp

  // ── tab_1.php sections ──
  /** 必修（校定及專業必修）尚缺科目 */
  missingRequiredCourses: PuMissingRequiredCourse[];
  /** 通識已修明細 (list of completed general ed course names) */
  completedGeneralCourses: string[];
  /** 110學年度起四大向度通識必修 */
  requiredGeneralCourses: PuRequiredGeneralCourse[];
  /** 各學群/向度修習情形 */
  generalEdDimensions: PuGeneralEdDimension[];
  /** 修習中通識科目 */
  inProgressGeneralCourses: PuInProgressGeneralCourse[];
  /** 尚缺必選科目 */
  missingRequiredElectives: PuMissingRequiredElective[];
  /** 重覆修習科目 */
  repeatedCourses: PuRepeatedCourse[];
  /** 已通過之校內檢定 */
  passedCertifications: PuPassedCertification[];
  /** 專業選修必備選項 */
  professionalElectiveOptions: PuProfessionalElectiveOption[];
  /** 修習學分累計 */
  creditTotals: PuCreditTotals;
  /** Notes/disclaimers from the bottom of tab_1 */
  notes: string[];

  // ── tab_2.php ──
  /** 輔系、雙主修 status text */
  minorDoubleMajorStatus: string;

  // ── tab_3.php ──
  /** 畢業條件 status text */
  graduationConditionsStatus: string;

  // ── tab_4.php ──
  /** 學程 status text */
  programStatus: string;

  // ── score_all.php — 歷年修課明細 ──
  /** Student info */
  studentId?: string;
  studentName?: string;
  /** 學年排名 */
  academicYearRankings: PuAcademicYearRanking[];
  /** Per-semester grade records */
  semesterGrades: PuSemesterGradeRecord[];

  // ── Legacy compat fields (computed from creditTotals) ──
  total: {
    earned: number | null;
    required: number | null;
    remaining: number | null;
  };
  byCategory: Partial<Record<CreditCategory, PuCreditAuditCategorySummary>>;
};

export type PuAnnouncementPayload = {
  title: string;
  url: string;
  date: string;
};

export type PuStudentLoginRequest = {
  studentId: string;
  password: string;
};

export type PuStudentLoginResponse = {
  success: boolean;
  customToken?: string;
  uid: string;
  studentId: string;
  displayName: string;
  department: string;
  isNewUser: boolean;
  puSessionId?: string;
  tronClassSessionId?: string;
  tronClassUserId?: number | null;
  studentInfo?: PuStudentInfoPayload | null;
  courses?: PuCourseResultPayload | null;
  grades?: PuGradeResultPayload | null;
  creditAudit?: PuCreditAuditPayload | null;
  announcements?: PuAnnouncementPayload[] | null;
};
