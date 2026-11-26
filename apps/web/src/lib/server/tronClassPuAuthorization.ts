import 'server-only';
import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, schoolHttpStatus } from '@campus/shared/src/puLmsReadonly';
import { normalizeTronClassAssignmentDetails } from './tronClassAssignmentDetails';
import { assertTronClassStudentEnrollment } from './tronClassCourseEnrollment';
import type { LmsReadonlySource, LmsReadOptions, LmsReadResult } from './tronClassLmsSource';
import type { TronClassSubmissionBindings } from './tronClassSubmission';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import { normalizeTronClassSubmissionHistory } from './tronClassSubmissionHistory';
import {
  createTronClassSubmissionSource,
  type TronClassAssignment,
  type TronClassHomeworkScope,
  type TronClassSubmissionBinding,
} from './tronClassSubmissionSource';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

type Dependencies = {
  bindings: TronClassSubmissionBindings;
  source?: LmsReadonlySource;
  now?: () => number;
  timeoutMs?: number;
};
type RecordData = Record<string, unknown>;

function fail(status: number, code: string): never { throw new NuniError(status, code); }
function unavailable(): never { return fail(503, 'TRONCLASS_SUBMISSION_UNAVAILABLE'); }
function blocked(): never { return fail(409, 'TRONCLASS_SUBMISSION_BLOCKED'); }
const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const own = (value: RecordData, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function record(value: unknown): RecordData | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : null;
}
function count(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d{0,15})$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function utcInstant(value: unknown): number | null {
  // Only the observed UTC representation grants a write window. Round-trip the
  // calendar components too: Date.parse alone normalizes dates such as Feb 30.
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const parsed = Date.parse(value);
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical ? parsed : null;
}
function checkedNow(now: () => number): number {
  const at = now();
  if (!Number.isFinite(at) || Math.abs(at) > 8.64e15) return unavailable();
  return at;
}

function permittedAssignment(
  activity: RecordData, assignment: TronClassAssignment, binding: TronClassSubmissionBinding,
  scope: TronClassHomeworkScope, at: number,
): TronClassAssignment {
  if (activity.id !== scope.homeworkId || activity.course_id !== scope.courseId || activity.type !== 'homework') unavailable();
  if (!isTronClassSourceVisible(activity)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
  const data = record(activity.data);
  if (activity.published !== true || activity.submit_by_group !== false || activity.is_assigned_to_all !== true ||
    activity.has_assign_student !== false || activity.has_assign_group !== false ||
    !Array.isArray(activity.prerequisites) || activity.prerequisites.length !== 0 ||
    !data || data.has_assign_target !== false || data.mode !== 'normal' || data.homework_type !== 'file_upload' ||
    activity.teaching_model !== 'online' || activity.is_started !== true || activity.is_in_progress !== true ||
    activity.is_closed !== false || activity.need_make_up !== false || activity.user_submit_count !== 0) blocked();

  let remainingAttempts: number | null;
  if (activity.non_submit_times === true && activity.submit_times === null) remainingAttempts = null;
  else if (activity.non_submit_times === false) {
    const limit = count(activity.submit_times);
    if (limit === null || limit <= 0) blocked();
    remainingAttempts = limit;
  } else blocked();
  // PU repeats these settings in data in the observed response. Their absence
  // does not invent a setting, and a conflicting duplicate cannot grant access.
  if ((own(data, 'non_submit_times') && data.non_submit_times !== activity.non_submit_times) ||
    (own(data, 'submit_times') && (remainingAttempts === null
      ? data.submit_times !== null : count(data.submit_times) !== remainingAttempts))) blocked();

  const opensAt = activity.start_time === null ? null : utcInstant(activity.start_time);
  const deadline = utcInstant(activity.end_time);
  if ((!own(activity, 'start_time') || (activity.start_time !== null && opensAt === null)) ||
    (opensAt !== null && opensAt > at) || deadline === null || deadline <= at ||
    (opensAt !== null && opensAt >= deadline)) blocked();

  const detail = normalizeTronClassAssignmentDetails(activity, scope, at);
  return {
    ...scope, studentId: binding.userId, title: detail.title ?? assignment.title,
    description: detail.description ?? assignment.description, details: detail.details,
    opensAt: opensAt === null ? null : new Date(opensAt).toISOString(), deadline: new Date(deadline).toISOString(),
    permissionKnown: true, individual: true, canSubmit: true, isClosed: false, allowLate: false, remainingAttempts,
    // Official student module 473669 accepts normal comment text. The upload
    // storage/callback contract has not been verified, so no file grant follows.
    allowsText: true, allowsAttachments: false, maxFiles: 0, maxFileBytes: 0, maxTotalBytes: 0, allowedContentTypes: [],
  };
}

/**
 * PU's observed first-submission authorization, based on the authenticated GET
 * shape documented in tronclass-live-read-verification-2026-11-18.md and the
 * public student modules in tronclass-public-contract-2026-11-16.md.
 *
 * This reader only returns private evidence to a controlled candidate. It does
 * not verify CSRF, enable contractVerified, upload, save drafts or submit work.
 * Resubmit/retract settings do not authorize an existing version or make-up work.
 * The legacy course source can default a missing role to student. Each access
 * check also requires the fixed course HTML's positive enrollment observation;
 * this does not verify the tenant's separate final-write or CSRF contract.
 */
export function createTronClassPuAuthorizationReader({
  bindings, source: suppliedSource, now = Date.now, timeoutMs = 15_000,
}: Dependencies) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail(400, 'TRONCLASS_INVALID_INPUT');

  return async function authorize(
    ownerKey: string, input: TronClassHomeworkScope, signal?: AbortSignal, expected?: string | TronClassSubmissionBinding,
  ): Promise<TronClassCandidateAuthorization> {
    if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 200 ||
      !input || !positiveId(input.courseId) || !positiveId(input.homeworkId)) fail(400, 'TRONCLASS_INVALID_INPUT');
    const scope = Object.freeze({ courseId: input.courseId, homeworkId: input.homeworkId });
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = () => new NuniError(504, 'TRONCLASS_READ_TIMEOUT');
    const deadlineAt = Date.now() + timeoutMs;
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = () => reject(timeout());
      controller.signal.addEventListener('abort', rejectDeadline, { once: true });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const check = () => {
      if (Date.now() >= deadlineAt) abort();
      if (controller.signal.aborted) throw timeout();
    };
    const readOptions = (): LmsReadOptions => {
      check();
      return { signal: controller.signal, timeoutMs: Math.max(1, Math.min(8000, deadlineAt - Date.now())) };
    };
    const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
      check();
      const result = await run();
      check();
      return result;
    };
    const suppliedBinding = typeof expected === 'object' ? expected : undefined;
    let snapshot: TronClassSubmissionBinding | undefined;
    const current = async (): Promise<TronClassSubmissionBinding> => {
      const binding = snapshot ?? suppliedBinding ?? await guarded(() => bindings.requireBinding(ownerKey, typeof expected === 'string' ? expected : undefined));
      if (typeof expected === 'string' && binding?.revision !== expected) fail(409, 'TRONCLASS_BINDING_CHANGED');
      if (!binding || binding.schoolId !== 'pu' || !positiveId(binding.userId) ||
        typeof binding.revision !== 'string' || !/^[a-f0-9]{32}$/.test(binding.revision) ||
        typeof binding.expiresAt !== 'string' || !Number.isFinite(Date.parse(binding.expiresAt)) ||
        Date.parse(binding.expiresAt) <= checkedNow(now) || !record(binding.cookies) ||
        Object.values(binding.cookies).some(value => typeof value !== 'string')) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      snapshot ??= { ...binding, cookies: Object.freeze({ ...binding.cookies }) };
      await guarded(() => bindings.assertCurrent(ownerKey, binding.revision, binding.userId));
      if (Date.parse(snapshot.expiresAt) <= checkedNow(now)) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return snapshot;
    };
    const read = async (run: () => Promise<LmsReadResult<unknown>>, activity: boolean): Promise<unknown> => {
      const result = await guarded(run);
      if (result.ok) return structuredClone(result.value);
      if (result.status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      if (result.status === 403) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
      if (activity && [404, 410].includes(result.status ?? 0)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
      return unavailable();
    };
    const operation = async (): Promise<TronClassCandidateAuthorization> => {
      const source = suppliedSource ?? (await import('./tronClassLmsSource')).tronClassLmsReadonlySource;
      const binding = await current();
      check();
      if (!source.fetchHomeworkActivity || !source.fetchStudentSubmissionList || !source.fetchCoursePage) unavailable();
      // getAssignment owns the complete course/homework membership traversal.
      // Share the total deadline through all of its internal reads, including
      // pagination, and stop legacy sources from continuing after a late reply.
      const assignmentSource: LmsReadonlySource = {
        ...source,
        fetchCourses: async (cookies, options) => {
          const rows = await guarded(() => source.fetchCourses(cookies, options, readOptions()));
          // Read access also covers teacher accounts. An explicit non-student
          // course role must not become first-submission authority. The legacy
          // source can default an absent role, so this is a denial check only.
          if (Array.isArray(rows) && rows.some(raw => {
            const course = record(raw);
            return course && (course.id === scope.courseId || course.id === String(scope.courseId)) &&
              own(course, 'role') && course.role !== 'student';
          })) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
          return rows;
        },
        fetchHomeworkPage: (cookies, courseId, page, pageSize) => guarded(() => source.fetchHomeworkPage(cookies, courseId, page, pageSize, readOptions())),
        fetchHomeworkActivity: (cookies, activityId) => guarded(() => source.fetchHomeworkActivity!(cookies, activityId, readOptions())),
      };
      const assignments = createTronClassSubmissionSource(assignmentSource);
      const access = async (latest: TronClassSubmissionBinding) => {
        const assignment = await guarded(() => assignments.getAssignment(latest, scope));
        if (assignment.studentId !== latest.userId || assignment.courseId !== scope.courseId || assignment.homeworkId !== scope.homeworkId) unavailable();
        const coursePage = await read(() => source.fetchCoursePage!(latest.cookies, scope.courseId, readOptions()), false);
        assertTronClassStudentEnrollment(coursePage, scope.courseId);
        const activity = record(await read(() => source.fetchHomeworkActivity!(latest.cookies, scope.homeworkId, readOptions()), true));
        if (!activity) unavailable();
        permittedAssignment(activity, assignment, latest, scope, checkedNow(now));
        return { activity, assignment };
      };
      const emptyHistory = async (latest: TronClassSubmissionBinding) => {
        const raw = await read(() => source.fetchStudentSubmissionList!(latest.cookies, scope.homeworkId, latest.userId, readOptions()), false);
        const history = normalizeTronClassSubmissionHistory(raw, latest, scope, checkedNow(now));
        if (history.state !== 'available' || history.latestId !== null || history.entries.length !== 0) blocked();
        // The live unsubmitted response is exactly { list: [] }. No new or
        // unknown envelope metadata is interpreted as proof of an empty history.
        const envelope = record(raw);
        if (!envelope || Object.keys(envelope).length !== 1 || !own(envelope, 'list')) unavailable();
      };
      await access(binding);
      await emptyHistory(binding);
      const latest = await current();
      const checked = await access(latest);
      await emptyHistory(latest);
      const finalBinding = await current();
      const assignment = permittedAssignment(checked.activity, checked.assignment, finalBinding, scope, checkedNow(now));
      check();
      return {
        binding: finalBinding, assignment, mode: 'normal', historyComplete: true,
        priorSubmissionIds: [], userSubmitCount: 0, ordinaryWindowConfirmed: true, prerequisitesConfirmed: true,
      };
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      const cancelled = controller.signal.aborted;
      abort();
      if (cancelled) throw timeout();
      if (error instanceof NuniError && [
        'TRONCLASS_READ_TIMEOUT', 'TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED',
        'TRONCLASS_NOT_CONNECTED', 'TRONCLASS_COURSE_ACCESS_DENIED', 'TRONCLASS_HOMEWORK_NOT_FOUND',
        'TRONCLASS_SUBMISSION_BLOCKED', 'TRONCLASS_SUBMISSION_UNAVAILABLE', 'SESSION_CHANGED', 'SIGN_IN_REQUIRED',
      ].includes(error.code)) throw new NuniError(error.status, error.code);
      const status = schoolHttpStatus(error);
      if (classifySchoolReadError(error) === 'session' || status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      if (status === 403) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
      return unavailable();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
    }
  };
}
