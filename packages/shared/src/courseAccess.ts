/** Course metadata is a search hint. Only the server's reviewed directory is authoritative. */
export type CourseScope = { schoolId: string; academicYear: string; semester: string };
export type CourseMetadata = CourseScope & {
  title: string; courseCode: string; teacher: string; className: string;
};
export type CourseCandidate = CourseMetadata & {
  id: string; workspaceId: string; version: number;
  verification: 'administrator-reviewed';
};
export type CourseMatch = { course: CourseCandidate; reasons: string[]; conflicts: string[]; rank: number };
export type CourseRequestState = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'revoked';
export type CourseRequest = {
  id: string; kind: 'student' | 'teacher'; state: CourseRequestState; version: number;
  workspaceId: string; courseId: string | null; metadata: CourseMetadata;
  statement: string; decisionReason: string | null; createdAt: string;
  // Approval and current workspace membership are intentionally separate facts.
  membershipActive: boolean;
  applicantId?: string; // Only returned to an authorized reviewer, never in directory search.
};
export class CourseAccessError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 422) {
    super(code); this.name = 'CourseAccessError';
  }
}
export function courseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CourseAccessError('COURSE_INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function courseKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key)))
    throw new CourseAccessError('COURSE_INVALID_INPUT');
}
export function courseText(value: unknown, max = 200, min = 0): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value))
    throw new CourseAccessError('COURSE_INVALID_INPUT');
  const text = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (text.length < min || text.length > max) throw new CourseAccessError('COURSE_INVALID_INPUT');
  return text;
}
export const courseFold = (text: string) => text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
export function courseScope(value: unknown): CourseScope {
  const row = courseRecord(value);
  const schoolId = courseText(row.schoolId, 64, 1).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/u.test(schoolId))
    throw new CourseAccessError('COURSE_SCOPE_REQUIRED');
  const year = courseText(row.academicYear, 12, 1).replace(/學年度$/u, '').trim();
  if (!/^(?:[1-9]\d{1,2}|20\d{2})$/u.test(year)) throw new CourseAccessError('COURSE_SCOPE_REQUIRED');
  const academicYear = String(Number(year) >= 2000 ? Number(year) - 1911 : Number(year));
  const terms: Record<string, string> = { '1': '1', '一': '1', '上': '1', '上學期': '1', '第一學期': '1',
    '2': '2', '二': '2', '下': '2', '下學期': '2', '第二學期': '2', 'summer': 'summer', '暑期': 'summer' };
  const semester = terms[courseText(row.semester, 20, 1).toLowerCase()];
  if (!semester) throw new CourseAccessError('COURSE_SCOPE_REQUIRED');
  return { schoolId, academicYear, semester };
}
export function courseMetadata(value: unknown): CourseMetadata {
  const row = courseRecord(value);
  courseKeys(row, ['schoolId', 'academicYear', 'semester', 'title', 'courseCode', 'teacher', 'className']);
  return { ...courseScope(row), title: courseText(row.title, 200, 1),
    courseCode: courseText(row.courseCode ?? '', 80), teacher: courseText(row.teacher ?? '', 160),
    className: courseText(row.className ?? '', 120) };
}
/** Whitelist what leaves a personal import: never send the screenshot, raw source, grades or student name. */
export function courseHints(row: CourseScope & { title: string; courseCode?: string; teacher?: string; className?: string }): CourseMetadata {
  return courseMetadata({ schoolId: row.schoolId, academicYear: row.academicYear, semester: row.semester,
    title: row.title, courseCode: row.courseCode || '', teacher: row.teacher || '', className: row.className || '' });
}
export function sameCourseScope(a: CourseScope, b: CourseScope): boolean {
  return a.schoolId === b.schoolId && a.academicYear === b.academicYear && a.semester === b.semester;
}
export function courseIdentifier(value: unknown, prefix: 'cw' | 'ccd' | 'car'): string {
  const id = courseText(value, 40, 1);
  if (!new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, 'u').test(id))
    throw new CourseAccessError('COURSE_INVALID_INPUT');
  return id;
}
export function courseVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new CourseAccessError('COURSE_INVALID_INPUT');
  return Number(value);
}
export function parseCourseCandidate(value: unknown): CourseCandidate {
  const row = courseRecord(value);
  if (row.verification !== 'administrator-reviewed') throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  return { ...courseHints(row as unknown as CourseMetadata), id: courseIdentifier(row.id, 'ccd'),
    workspaceId: courseIdentifier(row.workspaceId, 'cw'), version: courseVersion(row.version),
    verification: 'administrator-reviewed' };
}
/** Rank, but never join or silently select. A matching name does not prove anybody's identity. */
export function recommendCourses(hints: CourseMetadata, candidates: readonly CourseCandidate[]): CourseMatch[] {
  const input = courseMetadata(hints);
  if (candidates.length > 200) throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  const matches: CourseMatch[] = [];
  for (const raw of candidates) {
    const course = parseCourseCandidate(raw);
    if (!sameCourseScope(input, course)) continue;
    const code = !!input.courseCode && courseFold(input.courseCode) === courseFold(course.courseCode);
    const title = courseFold(input.title) === courseFold(course.title);
    const teacher = !!input.teacher && courseFold(input.teacher) === courseFold(course.teacher);
    const section = !!input.className && courseFold(input.className) === courseFold(course.className);
    // Never fuzz course codes, teacher names, or school aliases.
    if (!code && !title) continue;
    const reasons = [code && '課號相同', title && '課名相同', teacher && '教師欄位相同', section && '班別相同'].filter(Boolean) as string[];
    const conflicts = [!!input.courseCode && !code && '課號不同', !title && '課名不同',
      !!input.teacher && !teacher && '教師欄位不同', !!input.className && !section && '班別不同'].filter(Boolean) as string[];
    matches.push({ course, reasons, conflicts, rank: (code ? 40 : 0) + (title ? 10 : 0) + (teacher ? 5 : 0) + (section ? 3 : 0) });
  }
  return matches.sort((a, b) => b.rank - a.rank || a.course.id.localeCompare(b.course.id));
}
export const courseRequestCopy: Record<CourseRequestState, string> = {
  pending: '等待管理員核對', approved: '管理員已核對通過', rejected: '申請未通過',
  withdrawn: '已撤回申請', revoked: '授權已撤銷',
};
export function courseAccessErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) :
    error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
  if (status === 404 || code === 'COURSE_ACCESS_DISABLED') return '課班比對與審核服務尚未開放，或這筆資料已不可用。你的匯入資料仍保留；不會自行加入課班。';
  if (status === 401) return '登入已失效，請重新登入後再試。';
  if (code === 'COURSE_SCOPE_REQUIRED') return '請先確認學校、學年度與學期，再查找課班。';
  if (status === 409) return '課班或申請狀態已改變，請重新查詢後再操作。';
  if (status === 403) return '這個帳號沒有此項操作權限；申請內容不會授予教師或管理員權限。';
  return '這次操作未完成，請重新查詢狀態後再試。';
}
