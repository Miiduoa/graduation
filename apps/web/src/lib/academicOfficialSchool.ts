/** Only Providence University currently has an official academic adapter. */
export const OFFICIAL_ACADEMIC_SCHOOL_ID = 'pu' as const;

export type OfficialAcademicSchoolId = typeof OFFICIAL_ACADEMIC_SCHOOL_ID;

export function isOfficialAcademicSchool(
  schoolId: string | null | undefined,
): schoolId is OfficialAcademicSchoolId {
  return schoolId === OFFICIAL_ACADEMIC_SCHOOL_ID;
}

export const OFFICIAL_ACADEMIC_SOURCE_LABEL = '靜宜大學 e 校園';
export const OFFICIAL_ACADEMIC_PORTAL_URL = 'https://alcat.pu.edu.tw/';
