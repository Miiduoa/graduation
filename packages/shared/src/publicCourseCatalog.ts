export type PublicCatalogMeeting = { time: string; room: string };

/** Fields from a public course listing. Codes retain leading zeroes and internal spaces. */
export type PublicCatalogCourse = {
  code: string;
  section: string;
  title: string;
  department: string;
  teacher: string;
  time: string;
  room: string;
  semester: string;
  credits: string;
  /** Each entry preserves one official room/time pair, including an unpublished time. */
  meetings?: PublicCatalogMeeting[];
};

export type PublicCourseCatalogResponse = {
  schoolId: 'ncnu' | 'nthu';
  sourceUrl: string;
  courses: PublicCatalogCourse[];
  truncated: boolean;
};

export function isPublicCourseCatalog(
  value: unknown,
  expectedSchoolId: PublicCourseCatalogResponse['schoolId'],
): value is PublicCourseCatalogResponse {
  if (!value || typeof value !== 'object') return false;
  if (expectedSchoolId !== 'ncnu' && expectedSchoolId !== 'nthu') return false;
  const data = value as Partial<PublicCourseCatalogResponse>;
  return data.schoolId === expectedSchoolId && typeof data.sourceUrl === 'string' && typeof data.truncated === 'boolean' &&
    Array.isArray(data.courses) && data.courses.length <= 50 && data.courses.every(row =>
      row && ['code', 'section', 'title', 'department', 'teacher', 'time', 'room', 'semester', 'credits']
        .every(field => typeof row[field as keyof PublicCatalogCourse] === 'string') &&
      row.code.trim() && row.title.trim() && row.semester.trim() &&
      (row.meetings === undefined || (Array.isArray(row.meetings) && row.meetings.length <= 32 &&
        row.meetings.every(meeting => meeting && typeof meeting.time === 'string' && typeof meeting.room === 'string'))));
}

export function isNcnuPublicCourseCatalog(value: unknown): value is PublicCourseCatalogResponse {
  return isPublicCourseCatalog(value, 'ncnu');
}
