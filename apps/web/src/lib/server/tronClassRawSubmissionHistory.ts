import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, schoolHttpStatus } from '@campus/shared/src/puLmsReadonly';
import type { LmsReadonlySource, LmsReadResult } from './tronClassLmsSource';
import type { TronClassSubmissionBindings } from './tronClassSubmission';
import {
  createTronClassSubmissionSource,
  type TronClassHomeworkScope,
  type TronClassSubmissionBinding,
  type TronClassSubmissionSource,
} from './tronClassSubmissionSource';
import { normalizeTronClassSubmissionHistory } from './tronClassSubmissionHistory';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const revision = /^[a-f0-9]{32}$/;
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function unavailable(): never { return fail(502, 'TRONCLASS_HISTORY_UNAVAILABLE'); }

type Dependencies = {
  bindings: TronClassSubmissionBindings;
  source?: LmsReadonlySource;
  assignments?: Pick<TronClassSubmissionSource, 'getAssignment'>;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * Private, read-only evidence for the controlled operation reconciler. The
 * student ID and cookies always come from the current server-side binding.
 * Raw source fields never form an HTTP response, a saved fixture or a receipt.
 */
export function createTronClassRawSubmissionHistoryReader({
  bindings, source: suppliedSource, assignments: suppliedAssignments, now = Date.now, timeoutMs = 15_000,
}: Dependencies) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    fail(400, 'TRONCLASS_INVALID_INPUT');
  }

  return async function readHistory(
    ownerKey: string,
    expected: Pick<TronClassSubmissionBinding, 'schoolId' | 'revision' | 'userId'>,
    input: TronClassHomeworkScope,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 200 ||
      !expected || expected.schoolId !== 'pu' || typeof expected.revision !== 'string' || !revision.test(expected.revision) || !positiveId(expected.userId) ||
      !input || !positiveId(input.courseId) || !positiveId(input.homeworkId)) fail(400, 'TRONCLASS_INVALID_INPUT');
    const scope = Object.freeze({ courseId: input.courseId, homeworkId: input.homeworkId });
    const identity = Object.freeze({ schoolId: expected.schoolId, revision: expected.revision, userId: expected.userId });
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = () => new NuniError(504, 'TRONCLASS_READ_TIMEOUT');
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = () => reject(timeout());
      controller.signal.addEventListener('abort', rejectDeadline, { once: true });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const check = () => { if (controller.signal.aborted) throw timeout(); };

    const current = async () => {
      check();
      const binding = await bindings.requireBinding(ownerKey);
      check();
      if (binding.schoolId !== identity.schoolId || binding.userId !== identity.userId || binding.revision !== identity.revision) {
        fail(409, 'TRONCLASS_BINDING_CHANGED');
      }
      const at = now();
      if (!Number.isFinite(at) || !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= at) {
        fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      }
      await bindings.assertCurrent(ownerKey, binding.revision);
      check();
      return { ...binding, cookies: { ...binding.cookies } };
    };
    const read = async (run: () => Promise<LmsReadResult<unknown>>, activity: boolean) => {
      check();
      try {
        const response = await run();
        check();
        if (response.ok) return response.value;
        if (response.status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (response.status === 403) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
        if (activity && [404, 410].includes(response.status ?? 0)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        return unavailable();
      } catch (error) {
        if (error instanceof NuniError && ([401, 403, 409, 504].includes(error.status) ||
          error.code === 'TRONCLASS_HOMEWORK_NOT_FOUND')) throw error;
        const status = schoolHttpStatus(error);
        if (classifySchoolReadError(error) === 'session' || status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (status === 403) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
        if (activity && [404, 410].includes(status ?? 0)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        return unavailable();
      }
    };
    const operation = async () => {
      check();
      const source = suppliedSource ?? (await import('./tronClassLmsSource')).tronClassLmsReadonlySource;
      check();
      if (!source.fetchHomeworkActivity || !source.fetchStudentSubmissionList) unavailable();
      const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
        check();
        const value = await run();
        check();
        return value;
      };
      // The existing source GETs have their own transport deadline. Guard every
      // page as well so a timed-out outer operation cannot continue paging or
      // start further course/detail requests after a late response arrives.
      const assignmentSource: LmsReadonlySource = {
        ...source,
        fetchCourses: (cookies, options) => guarded(() => source.fetchCourses(cookies, options)),
        fetchHomeworkPage: (cookies, courseId, page, pageSize) => guarded(() => source.fetchHomeworkPage(cookies, courseId, page, pageSize)),
        fetchHomeworkActivity: (cookies, activityId) => guarded(() => source.fetchHomeworkActivity!(cookies, activityId)),
      };
      const assignments = suppliedAssignments ?? createTronClassSubmissionSource(assignmentSource);
      const checkAccess = async (binding: TronClassSubmissionBinding) => {
        const assignment = await assignments.getAssignment(binding, scope);
        check();
        if (assignment.studentId !== binding.userId || assignment.courseId !== scope.courseId || assignment.homeworkId !== scope.homeworkId) unavailable();
        const raw = await read(() => source.fetchHomeworkActivity!(binding.cookies, scope.homeworkId), true);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) unavailable();
        const activity = raw as Record<string, unknown>;
        if (activity.id !== scope.homeworkId || activity.course_id !== scope.courseId || activity.type !== 'homework') unavailable();
        if (!isTronClassSourceVisible(activity)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        if (activity.submit_by_group !== false) unavailable();
      };
      const binding = await current();
      await checkAccess(binding);
      check();
      const raw = structuredClone(await read(() => source.fetchStudentSubmissionList!(binding.cookies, scope.homeworkId, binding.userId), false));
      // Validate ownership, duplicate IDs and complete-list evidence, but retain
      // the exact wire comment/upload IDs for the private readback verifier.
      normalizeTronClassSubmissionHistory(raw, binding, scope, now());
      check();
      const latest = await current();
      await checkAccess(latest);
      await current();
      check();
      return structuredClone(raw);
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      controller.abort();
      if (error instanceof NuniError && [
        'TRONCLASS_READ_TIMEOUT', 'TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED',
        'TRONCLASS_NOT_CONNECTED', 'TRONCLASS_COURSE_ACCESS_DENIED', 'TRONCLASS_HOMEWORK_NOT_FOUND',
        'TRONCLASS_HISTORY_UNAVAILABLE', 'SESSION_CHANGED', 'SIGN_IN_REQUIRED',
      ].includes(error.code)) throw new NuniError(error.status, error.code);
      return unavailable();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
    }
  };
}
