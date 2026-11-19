import { createCourseAccess } from '@campus/shared/src/courseAccessClient';
import { createNuniClasses, nuniId, type NuniTransport, type NuniAssignment, type NuniQuiz } from '@campus/shared/src/nuni';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { V2Error } from './contracts';
import { parseTeachingArguments, parseTeachingResult, type TeachingPartialReason, type TeachingRead, type TeachingWork } from './teacherWorkspace';

export type TeachingReadGuard = { beforeRead(): void; afterRead(): void };
const FOLLOWUP_RESERVE = 2;
const COURSE_READ_COST = 4; // Fresh scope receipt, two activity reads, then fresh scope readback.

function sourceFailure(error: unknown): boolean {
  const failure = error as { status?: number; statusCode?: number; code?: string } | null;
  if (!failure || failure.status === 401 || failure.status === 403 || failure.statusCode === 401 || failure.statusCode === 403 ||
      ['ABORTED', 'API_BUDGET_EXCEEDED', 'TOOL_TIMEOUT', 'SESSION_CHANGED'].includes(failure.code ?? '')) return false;
  return failure.status === 503 || failure.status === 404 || failure.statusCode === 404;
}
function clean(value: string, max: number): string {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
  if (!text) throw new V2Error(502, 'INVALID_TEACHING_RESULT');
  return text;
}
function projectWork(rows: (NuniAssignment | NuniQuiz)[]): TeachingWork[] {
  if (new Set(rows.map(item => item.id)).size !== rows.length) throw new V2Error(502, 'INVALID_TEACHING_RESULT');
  return rows.map(item => {
    const due = item.dueAt === null ? null : parseTaipeiInstant(item.dueAt);
    if (item.dueAt !== null && due === null) throw new V2Error(502, 'INVALID_TEACHING_RESULT');
    return { id: item.id, title: clean(item.title, 160), state: item.state,
      dueAt: due === null ? null : new Date(due).toISOString(),
      receivedCount: 'submissionCount' in item ? item.submissionCount : item.responseCount };
  }).sort((a, b) => Number(a.state === 'closed') - Number(b.state === 'closed') ||
    (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) || a.id.localeCompare(b.id))
    .slice(0, 5);
}

/** A scoped read using the caller's verified platform transport. This never
 * grants a role, reads student answers, or enters co-teacher authorization. */
export async function readTeachingOverview(input: {
  schoolId: string;
  args?: unknown;
  request: NuniTransport;
  accountId: string;
  guard: TeachingReadGuard;
  remainingApiCalls(): number;
  now?: number;
}): Promise<TeachingRead> {
  const { schoolId, guard } = input;
  const query = parseTeachingArguments(input.args ?? {});
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) || schoolId === 'personal')
    throw new V2Error(422, 'TEACHING_INVALID_INPUT');
  nuniId(input.accountId, 'pa');
  guard.afterRead();
  const result: TeachingRead = { version: 1, source: 'platform-teaching', schoolId,
    checkedAt: new Date(input.now ?? Date.now()).toISOString(), query, status: 'ready',
    courses: [], partial: false, partialReasons: [], unreadCourseCount: null, href: '/classroom' };
  const incomplete = (reason: TeachingPartialReason) => {
    result.partial = true;
    if (!result.partialReasons.includes(reason)) result.partialReasons.push(reason);
  };
  const finish = (unavailable?: TeachingRead['unavailable']) => {
    guard.afterRead();
    if (!result.courses.length && result.partial) {
      result.status = 'unavailable';
      result.unavailable = unavailable ?? (result.partialReasons.includes('scope-unverified') ? 'SCOPE_UNVERIFIED'
        : result.partialReasons.includes('api-budget') ? 'API_BUDGET' : 'SOURCE_UNAVAILABLE');
    }
    return parseTeachingResult(result, schoolId, query);
  };
  const remaining = () => {
    guard.afterRead();
    const value = input.remainingApiCalls();
    if (!Number.isSafeInteger(value) || value < 0) throw new V2Error(502, 'INVALID_TEACHING_BUDGET');
    return value;
  };
  const request: NuniTransport = async (path, body, queryString) => {
    guard.beforeRead();
    if (remaining() < 1) throw new V2Error(429, 'API_BUDGET_EXCEEDED');
    try { return await input.request(path, body, queryString); }
    finally { guard.afterRead(); }
  };
  const classes = createNuniClasses(request, input.accountId);
  const access = createCourseAccess(request);
  if (remaining() < FOLLOWUP_RESERVE + 1) { incomplete('api-budget'); return finish(); }
  let workspaces;
  try { workspaces = await classes.list(); }
  catch (error) {
    if (!sourceFailure(error)) throw error;
    incomplete('source-unavailable');
    return finish((error as { status?: number }).status === 404 ? 'NOT_CONNECTED' : 'SOURCE_UNAVAILABLE');
  }
  if (new Set(workspaces.map(course => course.id)).size !== workspaces.length)
    throw new V2Error(502, 'INVALID_TEACHING_RESULT');
  result.unreadCourseCount = workspaces.filter(course => course.state === 'active' && course.memberRole !== 'student').length;
  // A collaboration role is not a reviewed owner-teacher credential. Never
  // send those IDs into the stronger scope reader or silently claim no duties.
  if (workspaces.some(course => course.state === 'active' && course.memberRole === 'co-teacher')) incomplete('scope-unverified');
  const candidates = workspaces.filter(course => course.state === 'active' && course.memberRole === 'owner-teacher');
  for (const candidate of candidates) {
    guard.afterRead();
    if (result.courses.length >= query.limit) { incomplete('course-limit'); break; }
    if (remaining() < COURSE_READ_COST + FOLLOWUP_RESERVE) { incomplete('api-budget'); break; }
    let receipt;
    try { receipt = await access.workspace(candidate.id, schoolId); }
    catch (error) {
      if (!sourceFailure(error)) throw error;
      incomplete((error as { status?: number; statusCode?: number }).status === 404 ||
        (error as { statusCode?: number }).statusCode === 404 ? 'scope-unverified' : 'source-unavailable');
      continue;
    }
    if (receipt.status !== 'reviewed' || receipt.memberRole !== 'owner-teacher') { incomplete('scope-unverified'); continue; }
    const reads = await Promise.allSettled([classes.assignments(candidate.id), classes.quizzes(candidate.id)]);
    guard.afterRead();
    const failures = reads.flatMap(read => read.status === 'rejected' ? [read.reason] : []);
    // A failed authorization or corrupt response invalidates the complete read,
    // even when the other independently requested source happened to succeed.
    const terminal = failures.findIndex(error => !sourceFailure(error));
    if (terminal >= 0) throw failures[terminal];
    if (failures.length) { incomplete('source-unavailable'); continue; }
    const assignments = (reads[0] as PromiseFulfilledResult<NuniAssignment[]>).value;
    const quizzes = (reads[1] as PromiseFulfilledResult<NuniQuiz[]>).value;
    let verified;
    try { verified = await access.workspace(candidate.id, schoolId); }
    catch (error) {
      const failure = error as { status?: number; statusCode?: number };
      if (failure.status === 404 || failure.statusCode === 404) throw new V2Error(403, 'FORBIDDEN_SCOPE');
      if (!sourceFailure(error)) throw error;
      incomplete('source-unavailable'); continue;
    }
    if (verified.status !== 'reviewed' || verified.memberRole !== 'owner-teacher' ||
        verified.course.id !== receipt.course.id || verified.course.version !== receipt.course.version)
      throw new V2Error(403, 'FORBIDDEN_SCOPE');
    const partial = assignments.length > 5 || quizzes.length > 5;
    if (partial) incomplete('work-limit');
    result.courses.push({ workspaceId: candidate.id, schoolId, title: clean(verified.course.title, 200),
      memberRole: 'owner-teacher', assignments: projectWork(assignments), quizzes: projectWork(quizzes),
      partial, href: `/classroom/course/${candidate.id}` });
    result.unreadCourseCount--;
  }
  return finish();
}
