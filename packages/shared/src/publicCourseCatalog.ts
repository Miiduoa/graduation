/** Fields from a public course listing. Section and course codes retain leading zeroes. */
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
};

export type PublicCourseCatalogResponse = {
  schoolId: 'ncnu';
  sourceUrl: string;
  courses: PublicCatalogCourse[];
  truncated: boolean;
};

export function isNcnuPublicCourseCatalog(value: unknown): value is PublicCourseCatalogResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PublicCourseCatalogResponse>;
  return data.schoolId === 'ncnu' && typeof data.sourceUrl === 'string' && typeof data.truncated === 'boolean' &&
    Array.isArray(data.courses) && data.courses.length <= 50 && data.courses.every(row =>
      row && ['code', 'section', 'title', 'department', 'teacher', 'time', 'room', 'semester', 'credits']
        .every(field => typeof row[field as keyof PublicCatalogCourse] === 'string') &&
      row.code.trim() && row.title.trim() && row.semester.trim());
}
