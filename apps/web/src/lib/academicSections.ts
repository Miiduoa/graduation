import { STUDENT_ACADEMIC_SECTIONS } from '@campus/shared/src/academicSections';

/** 課務次級導覽：主 Tab／AcademicNav／服務目錄共用同一套名稱（來源：packages/shared）。 */
export const ACADEMIC_SECTIONS = STUDENT_ACADEMIC_SECTIONS.map((section) => ({
  path: section.webPath,
  label: section.label,
})) as ReadonlyArray<{
  readonly path: (typeof STUDENT_ACADEMIC_SECTIONS)[number]['webPath'];
  readonly label: (typeof STUDENT_ACADEMIC_SECTIONS)[number]['label'];
}>;

/** 校方學習平臺入口；各校平臺名稱在選定校園後顯示。 */
export const ACADEMIC_LMS_SECTIONS = [
  { path: '/school-courses', label: '校方課程' },
  { path: '/school-lms', label: '校方作業與教材' },
] as const;

export type AcademicSectionPath =
  | (typeof ACADEMIC_SECTIONS)[number]['path']
  | (typeof ACADEMIC_LMS_SECTIONS)[number]['path']
  | '/import';

export function academicNavigationPath(
  pathname: string | null | undefined,
): AcademicSectionPath | null {
  if (!pathname) return null;
  if (pathname === '/credit-planner/review') return '/credit-planner';
  if (pathname.startsWith('/school-lms/')) return '/school-lms';
  if (pathname === '/classroom' || pathname.startsWith('/classroom/course')) return '/classroom';
  if (ACADEMIC_SECTIONS.some((section) => section.path === pathname)) {
    return pathname as AcademicSectionPath;
  }
  if (ACADEMIC_LMS_SECTIONS.some((section) => section.path === pathname)) {
    return pathname as AcademicSectionPath;
  }
  if (pathname === '/import') return '/import';
  return null;
}
