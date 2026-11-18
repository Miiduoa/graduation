/** A course picker can load before any homework, announcement or material feed. */
export type TronClassCourseSummary = {
  id: number;
  name: string;
  code: string;
  teachers: string[];
  semester: string | null;
  status: string;
  href: string;
};

export type TronClassCourseIndexError = {
  courseId: null;
  area: 'courses';
  message: string;
};

/** This contract describes course-list coverage only, never homework completeness. */
export type TronClassCourseIndex = {
  kind: 'course-index';
  revision: string;
  fetchedAt: string;
  courses: TronClassCourseSummary[];
  errors: TronClassCourseIndexError[];
  partial: boolean;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;
const only = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

/** Shared Web/native decoder; a normal sync snapshot cannot impersonate this index. */
export function decodeTronClassCourseIndex(value: unknown): TronClassCourseIndex | null {
  if (!record(value) || !only(value, ['kind', 'revision', 'fetchedAt', 'courses', 'errors', 'partial']) ||
    value.kind !== 'course-index' || typeof value.revision !== 'string' || !/^[a-f0-9]{32}$/.test(value.revision) ||
    typeof value.fetchedAt !== 'string' || value.fetchedAt.length !== 24 ||
    !Number.isFinite(Date.parse(value.fetchedAt)) || new Date(value.fetchedAt).toISOString() !== value.fetchedAt ||
    !Array.isArray(value.courses) || value.courses.length > 1000 ||
    !Array.isArray(value.errors) || value.errors.length > 10 ||
    typeof value.partial !== 'boolean' || value.partial !== (value.errors.length > 0)) return null;
  const courses: TronClassCourseSummary[] = [];
  const seen = new Set<number>();
  for (const row of value.courses) {
    if (!record(row) || !only(row, ['id', 'name', 'code', 'teachers', 'semester', 'status', 'href']) ||
      typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id) ||
      !text(row.name, 300) || !row.name.trim() || !text(row.code, 100) ||
      !Array.isArray(row.teachers) || row.teachers.length > 30 ||
      !(row.semester === null || text(row.semester, 100)) || !text(row.status, 40) ||
      row.href !== `https://tronclass.pu.edu.tw/course/${row.id}/content`) return null;
    const teachers: string[] = [];
    for (const name of row.teachers) {
      if (!text(name, 100) || !name.trim()) return null;
      teachers.push(name);
    }
    seen.add(row.id);
    courses.push({ id: row.id, name: row.name, code: row.code, teachers,
      semester: typeof row.semester === 'string' ? row.semester : null, status: row.status, href: row.href });
  }
  const errors: TronClassCourseIndexError[] = [];
  for (const error of value.errors) {
    if (!record(error) || !only(error, ['courseId', 'area', 'message']) ||
      error.courseId !== null || error.area !== 'courses' || !text(error.message, 500) || !error.message.trim()) return null;
    errors.push({ courseId: null, area: 'courses', message: error.message });
  }
  return { kind: 'course-index', revision: value.revision, fetchedAt: value.fetchedAt,
    courses, errors, partial: value.partial };
}
