import 'server-only';
import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, schoolHttpStatus } from '@campus/shared/src/puLmsReadonly';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type {
  TronClassSpecialSubmissionWindow, TronClassSubmissionAvailability,
} from '@campus/shared/src/tronClassSubmissionAvailability';
import { assertTronClassStudentEnrollment } from './tronClassCourseEnrollment';
import type { LmsReadonlySource, LmsReadOptions, LmsReadResult } from './tronClassLmsSource';
import type { TronClassSubmissionBindings } from './tronClassSubmission';
import { normalizeTronClassSubmissionHistory } from './tronClassSubmissionHistory';
import {
  createTronClassSubmissionSource, type TronClassHomeworkScope, type TronClassSubmissionBinding,
} from './tronClassSubmissionSource';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

type Row = Record<string, unknown>;
type Evidence = { activity: unknown; history?: unknown; makeUp?: unknown; resubmit?: unknown };
type Identity = Pick<TronClassSubmissionBinding, 'userId' | 'revision'>;
type Dependencies = {
  bindings: TronClassSubmissionBindings;
  source?: LmsReadonlySource;
  now?: () => number;
  timeoutMs?: number;
};
const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const revision = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const own = (value: Row, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): Row | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function unavailable(): never { return fail(502, 'TRONCLASS_AVAILABILITY_UNAVAILABLE'); }
function checkedNow(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value) || Math.abs(value) > 8.64e15) return unavailable();
  return value;
}
function count(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d{0,15})$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function sourceTime(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const at = parseTaipeiInstant(value);
  return at !== null && at <= now + 60_000 ? new Date(at).toISOString() : null;
}
function unknownAvailability(
  scope: TronClassHomeworkScope, binding: Identity, now: number,
  state: 'unavailable' | 'group-unsupported',
): TronClassSubmissionAvailability {
  return {
    source: 'tronclass', ...scope, revision: binding.revision, fetchedAt: new Date(now).toISOString(), state,
    ordinary: { state: 'unknown', kind: 'unknown', remainingAttempts: null },
    makeUp: { state: 'unknown', updatedAt: null }, resubmit: { state: 'unknown', updatedAt: null },
    draft: { state: 'unknown', submissionId: null, count: null },
  };
}

function checkedActivity(value: unknown, scope: TronClassHomeworkScope): Row {
  const activity = record(value);
  if (!activity || activity.id !== scope.homeworkId || activity.course_id !== scope.courseId || activity.type !== 'homework') unavailable();
  if (!isTronClassSourceVisible(activity)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
  if (typeof activity.submit_by_group !== 'boolean') unavailable();
  return activity;
}

function specialWindow(
  value: unknown, kind: 'make-up' | 'resubmit', activity: Row,
  binding: Identity, scope: TronClassHomeworkScope, now: number,
): TronClassSpecialSubmissionWindow {
  const envelope = record(value);
  const key = kind === 'make-up' ? 'make_up_record' : 'resubmit_record';
  if (!envelope) return { state: 'unknown', updatedAt: null };
  // The successful student endpoint may return exactly {}. The official
  // repository resolves its missing record property as undefined, and the
  // student controller treats that as no record. Do not extend this meaning to
  // nonempty error envelopes or non-JSON objects from an injected source.
  const prototype = Object.getPrototypeOf(envelope);
  if ((prototype === Object.prototype || prototype === null) && Reflect.ownKeys(envelope).length === 0) {
    return { state: 'none', updatedAt: null };
  }
  // Only the observed empty envelope or a single explicit record is evidence.
  // A mixed error/record envelope must not report an open or absent window.
  if ((prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(envelope).length !== 1 || !own(envelope, key)) {
    return { state: 'unknown', updatedAt: null };
  }
  if (envelope[key] === null) return { state: 'none', updatedAt: null };
  const row = record(envelope[key]);
  if (!row) return { state: 'unknown', updatedAt: null };
  // The path is session-bound. Optional source identity fields must agree too;
  // the permission record's created_by may be the teacher and is not projected.
  if ((own(row, 'course_id') && row.course_id !== scope.courseId) ||
    (own(row, 'activity_id') && row.activity_id !== scope.homeworkId) ||
    (own(row, 'homework_id') && row.homework_id !== scope.homeworkId) ||
    (own(row, 'student_id') && row.student_id !== binding.userId) ||
    (own(row, 'user_id') && row.user_id !== binding.userId) ||
    (own(row, 'student') && record(row.student)?.id !== binding.userId) ||
    (own(row, 'group_id') && ![null, 0].includes(row.group_id as null | number)) || row.group) unavailable();
  const updatedAt = sourceTime(row.last_updated_time, now);
  // These are the individual student-detail endpoint fields, not the teacher
  // list's submitted/is_closed/closed_time projection. Never mix those schemas.
  if (row.has_submitted === true) return { state: 'used', updatedAt };
  const closed = row[kind === 'make-up' ? 'make_up_is_closed' : 'resubmit_is_closed'];
  if (row.has_submitted !== false || typeof closed !== 'boolean') return { state: 'unknown', updatedAt };
  if (closed) return { state: 'closed', updatedAt };
  if (kind === 'resubmit') {
    if (activity.is_resubmit_open === false) return { state: 'disabled', updatedAt };
    if (activity.is_resubmit_open !== true) return { state: 'unknown', updatedAt };
  }
  return { state: 'open', updatedAt };
}

/** Public-client evidence projection. It cannot authorize a school mutation. */
export function normalizeTronClassSubmissionAvailability(
  evidence: Evidence, binding: Identity, scope: TronClassHomeworkScope, now = Date.now(),
): TronClassSubmissionAvailability {
  if (!positiveId(binding.userId) || !revision(binding.revision) || !positiveId(scope.courseId) ||
    !positiveId(scope.homeworkId) || !Number.isFinite(now) || Math.abs(now) > 8.64e15) unavailable();
  const activity = checkedActivity(evidence.activity, scope);
  if (activity.submit_by_group === true) return unknownAvailability(scope, binding, now, 'group-unsupported');
  const history = normalizeTronClassSubmissionHistory(evidence.history, binding, scope, now);
  const rows = (record(evidence.history)!.list as unknown[]).map(value => record(value)!);
  const used = count(activity.user_submit_count);
  const limit = count(activity.submit_times);
  const data = record(activity.data);
  const duplicateSettingsAgree = !data ||
    ((!own(data, 'non_submit_times') || data.non_submit_times === activity.non_submit_times) &&
      (!own(data, 'submit_times') || (activity.non_submit_times === true
        ? data.submit_times === activity.submit_times : count(data.submit_times) === limit)));
  const markedCountKnown = rows.every(row => typeof row.marked_submitted === 'boolean');
  const countAgrees = used !== null && markedCountKnown && rows.filter(row => row.marked_submitted === true).length === used;
  const unlimited = activity.non_submit_times === true && activity.submit_times === null;
  const limited = activity.non_submit_times === false && limit !== null;
  const attemptsKnown = countAgrees && duplicateSettingsAgree && (unlimited || limited);
  const remainingAttempts = attemptsKnown && limited ? Math.max(0, limit! - used!) : null;
  const knownHistory = history.entries.every(entry => entry.state !== 'unknown');
  const kind = !knownHistory || !countAgrees || used === null ? 'unknown'
    : used > 0 || history.entries.some(entry => entry.state !== 'draft') ? 'repeat' : 'first';
  let ordinary: TronClassSubmissionAvailability['ordinary']['state'] = 'unknown';
  if (activity.is_closed === true) ordinary = 'closed';
  else if (activity.is_started === false) ordinary = 'not-started';
  else if (activity.is_started === true && activity.is_in_progress === true && activity.is_closed === false && attemptsKnown) {
    ordinary = remainingAttempts === 0 ? 'attempts-exhausted' : 'open';
  }

  let draft: TronClassSubmissionAvailability['draft'] = { state: 'unknown', submissionId: null, count: null };
  // Missing flags never prove that there is no school draft. A returned version
  // can prefill a new POST in the school UI, but is not a draft to update by PUT.
  if (rows.every(row => typeof row.is_draft === 'boolean' && typeof row.is_redo === 'boolean' &&
    typeof row.submit_by_instructor === 'boolean' && !(row.is_draft && (row.is_redo || row.submit_by_instructor)))) {
    const drafts = rows.filter(row => row.is_draft === true);
    draft = drafts.length === 0 ? { state: 'none', submissionId: null, count: 0 }
      : drafts.length === 1 ? { state: 'available', submissionId: String(drafts[0].id), count: 1 }
        : { state: 'ambiguous', submissionId: null, count: drafts.length };
  }
  return {
    source: 'tronclass', ...scope, revision: binding.revision, fetchedAt: new Date(now).toISOString(), state: 'available',
    ordinary: { state: ordinary, kind, remainingAttempts },
    makeUp: specialWindow(evidence.makeUp, 'make-up', activity, binding, scope, now),
    resubmit: specialWindow(evidence.resubmit, 'resubmit', activity, binding, scope, now), draft,
  };
}

/** Reads only the bound student's current, personal homework preparation data. */
export function createTronClassSubmissionAvailabilityReader({
  bindings, source: suppliedSource, now = Date.now, timeoutMs = 15_000,
}: Dependencies) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) fail(400, 'TRONCLASS_INVALID_INPUT');
  return async function readAvailability(
    ownerKey: string, input: TronClassHomeworkScope, expectedRevision: string, signal?: AbortSignal, suppliedBinding?: TronClassSubmissionBinding,
  ): Promise<TronClassSubmissionAvailability> {
    if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 200 || !revision(expectedRevision) ||
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
    const options = (): LmsReadOptions => {
      check();
      return { signal: controller.signal, timeoutMs: Math.max(1, Math.min(8000, deadlineAt - Date.now())) };
    };
    const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
      check();
      const result = await run();
      check();
      return result;
    };
    let snapshot: TronClassSubmissionBinding | undefined;
    const current = async (): Promise<TronClassSubmissionBinding> => {
      const binding = snapshot ?? suppliedBinding ?? await guarded(() => bindings.requireBinding(ownerKey, expectedRevision));
      if (!binding || binding.revision !== expectedRevision) fail(409, 'TRONCLASS_BINDING_CHANGED');
      if (binding.schoolId !== 'pu' || !positiveId(binding.userId) ||
        typeof binding.expiresAt !== 'string' || !Number.isFinite(Date.parse(binding.expiresAt)) ||
        Date.parse(binding.expiresAt) <= checkedNow(now) || !record(binding.cookies) ||
        Object.values(binding.cookies).some(value => typeof value !== 'string')) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      snapshot ??= { ...binding, cookies: Object.freeze({ ...binding.cookies }) };
      await guarded(() => bindings.assertCurrent(ownerKey, expectedRevision));
      if (Date.parse(binding.expiresAt) <= checkedNow(now)) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return snapshot;
    };
    const read = async (run: () => Promise<LmsReadResult<unknown>>, activity = false, optional = false): Promise<unknown> => {
      try {
        const result = await guarded(run);
        if (result.ok) return structuredClone(result.value);
        if (result.status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (result.status === 403) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
        if (activity && [404, 410].includes(result.status ?? 0)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        if (optional) return undefined;
        return unavailable();
      } catch (error) {
        if (error instanceof NuniError && ([401, 403, 409, 504].includes(error.status) ||
          error.code === 'TRONCLASS_HOMEWORK_NOT_FOUND')) throw error;
        const status = schoolHttpStatus(error);
        if (classifySchoolReadError(error) === 'session' || status === 401) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (status === 403) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
        if (activity && [404, 410].includes(status ?? 0)) fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        if (optional) return undefined;
        return unavailable();
      }
    };
    const operation = async () => {
      const source = suppliedSource ?? (await import('./tronClassLmsSource')).tronClassLmsReadonlySource;
      const binding = await current();
      check();
      if (!source.fetchHomeworkActivity || !source.fetchCoursePage || !source.fetchStudentSubmissionList) unavailable();
      const assignmentSource: LmsReadonlySource = {
        ...source,
        fetchCourses: async (cookies, query) => {
          const rows = await guarded(() => source.fetchCourses(cookies, query, options()));
          if (Array.isArray(rows) && rows.some(raw => {
            const row = record(raw);
            return row && (row.id === scope.courseId || row.id === String(scope.courseId)) &&
              own(row, 'role') && row.role !== 'student';
          })) fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
          return rows;
        },
        fetchHomeworkPage: (cookies, courseId, page, pageSize) =>
          guarded(() => source.fetchHomeworkPage(cookies, courseId, page, pageSize, options())),
        fetchHomeworkActivity: (cookies, activityId) =>
          guarded(() => source.fetchHomeworkActivity!(cookies, activityId, options())),
      };
      const assignments = createTronClassSubmissionSource(assignmentSource);
      const access = async (latest: TronClassSubmissionBinding) => {
        const assignment = await guarded(() => assignments.getAssignment(latest, scope));
        if (assignment.studentId !== latest.userId || assignment.courseId !== scope.courseId ||
          assignment.homeworkId !== scope.homeworkId) unavailable();
        const page = await read(() => source.fetchCoursePage!(latest.cookies, scope.courseId, options()));
        assertTronClassStudentEnrollment(page, scope.courseId);
        return checkedActivity(await read(() => source.fetchHomeworkActivity!(latest.cookies, scope.homeworkId, options()), true), scope);
      };
      const initial = await access(binding);
      let history: unknown;
      let makeUp: unknown;
      let resubmit: unknown;
      if (initial.submit_by_group === false) {
        const historyBinding = await current();
        history = await read(() => source.fetchStudentSubmissionList!(historyBinding.cookies, scope.homeworkId, historyBinding.userId, options()));
        // Reject a foreign or incomplete history before any extra student read.
        normalizeTronClassSubmissionHistory(history, historyBinding, scope, checkedNow(now));
        const recordBinding = await current();
        if (source.fetchStudentMakeUpRecord) {
          makeUp = await read(() => source.fetchStudentMakeUpRecord!(recordBinding.cookies, scope.homeworkId, recordBinding.userId, options()), false, true);
        }
        const resubmitBinding = await current();
        if (source.fetchStudentResubmitRecord) {
          resubmit = await read(() => source.fetchStudentResubmitRecord!(resubmitBinding.cookies, scope.homeworkId, resubmitBinding.userId, options()), false, true);
        }
      }
      const latest = await current();
      const activity = await access(latest);
      if (activity.submit_by_group !== initial.submit_by_group) unavailable();
      await current();
      check();
      return normalizeTronClassSubmissionAvailability({ activity, history, makeUp, resubmit }, latest, scope, checkedNow(now));
    };
    try { return await Promise.race([operation(), deadline]); }
    catch (error) {
      controller.abort();
      if (error instanceof NuniError && [
        'TRONCLASS_READ_TIMEOUT', 'TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED', 'TRONCLASS_NOT_CONNECTED',
        'TRONCLASS_COURSE_ACCESS_DENIED', 'TRONCLASS_HOMEWORK_NOT_FOUND', 'TRONCLASS_AVAILABILITY_UNAVAILABLE',
        'SESSION_CHANGED', 'SIGN_IN_REQUIRED',
      ].includes(error.code)) throw new NuniError(error.status, error.code);
      return unavailable();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
    }
  };
}
