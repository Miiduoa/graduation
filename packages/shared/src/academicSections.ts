/**
 * 課務次級分區用語／順序的單一來源。
 * Web `apps/web/src/lib/academicSections.ts` 的學生標籤由此衍生；
 * Mobile 用 id／mobileScreen 對應既有 LearnStack 路由；不刪功能、不改角色判斷。
 */

export const STUDENT_ACADEMIC_SECTIONS = [
  {
    id: 'timetable',
    label: '課表',
    webPath: '/timetable',
    mobileScreen: 'PersonalTimetable',
  },
  {
    id: 'coursework',
    label: '課程與作業',
    webPath: '/classroom',
    mobileScreen: 'LearnHome',
  },
  {
    id: 'grades',
    label: '成績',
    webPath: '/grades',
    mobileScreen: 'Grades',
  },
  {
    id: 'credits',
    label: '學分規劃',
    webPath: '/credit-planner',
    mobileScreen: 'CreditAuditStack',
  },
  {
    id: 'calendar',
    label: '行事曆',
    webPath: '/calendar',
    mobileScreen: 'Calendar',
  },
] as const;

/**
 * 老師課務首頁分區：名稱與順序固定。
 * teaching_todos＝點名／課程動態；grading＝批改類（作業、測驗等）。
 */
export const TEACHER_ACADEMIC_SECTIONS = [
  { id: 'today', label: '今天的課' },
  { id: 'courses', label: '授課課程' },
  { id: 'teaching_todos', label: '教學待辦' },
  { id: 'grading', label: '待批改' },
] as const;

/**
 * 通知／私訊入口用語。
 * Web 對應／messages＝通知、／dms＝私訊（若服務目錄仍寫「訊息」需另改 campusServices）。
 */
export const MESSAGING_NAV_SECTIONS = [
  {
    id: 'notifications',
    label: '通知',
    webPath: '/messages',
    mobileTab: '訊息',
    mobileScreen: 'Notifications',
  },
  {
    id: 'dms',
    label: '私訊',
    webPath: '/dms',
    mobileTab: '訊息',
    mobileScreen: 'Dms',
  },
] as const;

export type StudentAcademicSectionId = (typeof STUDENT_ACADEMIC_SECTIONS)[number]['id'];
export type TeacherAcademicSectionId = (typeof TEACHER_ACADEMIC_SECTIONS)[number]['id'];
export type MessagingNavSectionId = (typeof MESSAGING_NAV_SECTIONS)[number]['id'];

export function studentAcademicSectionLabels(): string[] {
  return STUDENT_ACADEMIC_SECTIONS.map((section) => section.label);
}

export function teacherAcademicSectionLabels(): string[] {
  return TEACHER_ACADEMIC_SECTIONS.map((section) => section.label);
}

export function messagingNavLabels(): string[] {
  return MESSAGING_NAV_SECTIONS.map((section) => section.label);
}
