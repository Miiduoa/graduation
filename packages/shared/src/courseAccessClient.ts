import { CourseAccessError, courseIdentifier, courseMetadata, courseRecord, courseText, courseVersion,
  parseCourseCandidate, recommendCourses, sameCourseScope, type CourseMetadata, type CourseRequest,
  type CourseRequestState, type CourseWorkspace } from './courseAccess';
export type CourseTransport = (path: string, input?: Record<string, unknown>) => Promise<unknown>;
const states: CourseRequestState[] = ['pending', 'approved', 'rejected', 'withdrawn', 'revoked'];
export function parseCourseWorkspace(value: unknown, workspaceId: string, schoolId: string): CourseWorkspace {
  const row = courseRecord(value);
  if (row.workspaceId !== courseIdentifier(workspaceId, 'cw') || row.membershipActive !== true ||
      !['student', 'owner-teacher', 'co-teacher'].includes(String(row.memberRole)))
    throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  const membership = { workspaceId, memberRole: row.memberRole as CourseWorkspace['memberRole'], membershipActive: true as const };
  if (row.status === 'unreviewed' && row.course === null) return { ...membership, status: 'unreviewed', course: null };
  if (row.status !== 'reviewed') throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  const course = parseCourseCandidate(row.course);
  if (course.workspaceId !== workspaceId || course.schoolId !== schoolId || row.memberRole === 'co-teacher')
    throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  return { ...membership, status: 'reviewed', course };
}
export function parseCourseRequest(value: unknown): CourseRequest {
  const row = courseRecord(value);
  if (!['student', 'teacher'].includes(String(row.kind)) || !states.includes(row.state as CourseRequestState) ||
      typeof row.membershipActive !== 'boolean' || !Number.isFinite(Date.parse(String(row.createdAt))))
    throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  if (row.applicantId !== undefined && (typeof row.applicantId !== 'string' || !/^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(row.applicantId)))
    throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  return { ...(row.applicantId === undefined ? {} : { applicantId: String(row.applicantId) }), id: courseIdentifier(row.id, 'car'), kind: row.kind as 'student' | 'teacher',
    state: row.state as CourseRequestState, version: courseVersion(row.version),
    workspaceId: courseIdentifier(row.workspaceId, 'cw'),
    courseId: row.courseId === null ? null : courseIdentifier(row.courseId, 'ccd'),
    metadata: courseMetadata(row.metadata), statement: courseText(row.statement, 1000),
    decisionReason: row.decisionReason === null ? null : courseText(row.decisionReason, 1000),
    createdAt: courseText(row.createdAt, 40, 1), membershipActive: row.membershipActive };
}
export function parseCourseRequests(value: unknown): { requests: CourseRequest[]; nextCursor: string | null } {
  const row = courseRecord(value);
  if (!Array.isArray(row.requests) || row.requests.length > 100) throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
  return { requests: row.requests.map(parseCourseRequest), nextCursor: row.nextCursor === null ? null : courseIdentifier(row.nextCursor, 'car') };
}
export function createCourseAccess(transport: CourseTransport) {
  return {
    async workspace(workspaceId: string, schoolId: string) {
      courseIdentifier(workspaceId, 'cw');
      return parseCourseWorkspace(await transport('course-access/workspace-course', { workspaceId, schoolId }), workspaceId, schoolId);
    },
    async match(metadata: CourseMetadata) {
      const hints = courseMetadata(metadata);
      const result = courseRecord(await transport('course-access/match', hints));
      if (!Array.isArray(result.candidates) || result.candidates.length > 200 || typeof result.truncated !== 'boolean')
        throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      const candidates = result.candidates.map(parseCourseCandidate);
      if (new Set(candidates.map(item => item.id)).size !== candidates.length || candidates.some(item => !sameCourseScope(item, hints)))
        throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      return { matches: recommendCourses(hints, candidates), truncated: result.truncated };
    },
    async student(input: { courseId: string; version: number; metadata: CourseMetadata; confirmed: true; idempotencyKey: string }) {
      const result = parseCourseRequest(await transport('course-access/student-requests', input));
      if (result.kind !== 'student' || result.courseId !== input.courseId || !sameCourseScope(result.metadata, courseMetadata(input.metadata)))
        throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      return result;
    },
    async teacher(input: { workspaceId: string; metadata: CourseMetadata; statement: string; confirmed: true; idempotencyKey: string }) {
      const result = parseCourseRequest(await transport('course-access/teacher-requests', input));
      if (result.kind !== 'teacher' || result.workspaceId !== input.workspaceId || !sameCourseScope(result.metadata, courseMetadata(input.metadata)))
        throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      return result;
    },
    async mine(cursor: string | null = null) {
      return parseCourseRequests(await transport('course-access/requests', { cursor }));
    },
    async queue(schoolId: string, cursor: string | null = null) {
      const result = parseCourseRequests(await transport('course-access/reviews', { schoolId, cursor }));
      if (result.requests.some(item => item.metadata.schoolId !== schoolId)) throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      return result;
    },
    async withdraw(id: string, version: number, idempotencyKey: string) {
      const result = parseCourseRequest(await transport(`course-access/requests/${courseIdentifier(id, 'car')}/withdraw`, { version, idempotencyKey }));
      if (result.id !== id) throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      return result;
    },
    async decide(id: string, input: { version: number; decision: 'approve' | 'reject' | 'revoke'; reason: string;
      evidenceReference: string; independentlyVerified: boolean; idempotencyKey: string }) {
      const result = parseCourseRequest(await transport(`course-access/requests/${courseIdentifier(id, 'car')}/decide`, input));
      if (result.id !== id) throw new CourseAccessError('COURSE_INVALID_RESPONSE', 502);
      return result;
    },
  };
}

/** Exact allowlist shared by the browser BFF; no generic authenticated proxy. */
export function isCourseAccessPath(path: string): boolean {
  return ['match', 'workspace-course', 'student-requests', 'teacher-requests', 'requests', 'reviews'].some(action => path === `course-access/${action}`) ||
    /^course-access\/requests\/car_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:withdraw|decide)$/u.test(path);
}
