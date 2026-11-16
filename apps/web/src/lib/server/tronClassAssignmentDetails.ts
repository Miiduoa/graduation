import { NuniError } from '@campus/shared/src/nuni';
import { classifySchoolReadError, homeworkDescriptionText, schoolHttpStatus } from '@campus/shared/src/puLmsReadonly';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import type { TronClassAssignmentDetails } from '../tronClassIntegrationTypes';
import type { LmsReadonlySource } from './tronClassLmsSource';
import type { TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

type DetailRead = {
  details: TronClassAssignmentDetails;
  title: string | null;
  description: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function flag(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function count(value: unknown): number | null {
  // The official course-list refresh parses submit_times from the activity GET.
  // Accept only an unambiguous decimal spelling, never parseInt's partial input.
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^(?:0|[1-9]\d{0,15})$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function instant(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const parsed = parseTaipeiInstant(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}
function unavailable(): DetailRead { return { details: { status: 'unavailable' }, title: null, description: null }; }
function fail(status: number, code: string): never { throw new NuniError(status, code); }

/**
 * Public client evidence (2026-11-16): student module 150664 in 88788.161d6b6a.js
 * uses the activity's submit_times, user_submit_count, is_in_progress/is_closed
 * and is_resubmit_open; module 784582 in 55200.e380810d.js reads start_time,
 * end_time, non_submit_times and data.mode/allow_retract for homework settings.
 * Course-list module 478401 in 66297.9aa2f6d5.js copies non_submit_times directly
 * from getActivity's response and parses its submit_times with parseInt.
 * Missing values do not receive the official UI's truthiness-based defaults.
 * These are observations, not the complete make-up/resubmission permission check.
 */
export function normalizeTronClassAssignmentDetails(
  raw: unknown, scope: TronClassHomeworkScope, now = Date.now(),
): DetailRead {
  if (!id(scope.courseId) || !id(scope.homeworkId) || !Number.isFinite(now) || Math.abs(now) > 8.64e15) {
    return fail(502, 'TRONCLASS_ASSIGNMENT_DETAILS_INVALID');
  }
  const activity = record(raw);
  if (!activity || activity.id !== scope.homeworkId || activity.course_id !== scope.courseId || activity.type !== 'homework') {
    return fail(502, 'TRONCLASS_ASSIGNMENT_DETAILS_INVALID');
  }
  if (!isTronClassSourceVisible(activity)) return fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
  const data = record(activity.data) ?? {};
  const unlimited = flag(activity.non_submit_times);
  const limit = unlimited === true ? null : count(activity.submit_times);
  const used = count(activity.user_submit_count);
  const title = typeof activity.title === 'string' ? activity.title.trim().slice(0, 300) : '';
  return {
    details: {
      status: 'available', fetchedAt: new Date(now).toISOString(),
      submissionType: activity.submit_by_group === true ? 'group' : activity.submit_by_group === false ? 'individual' : 'unknown',
      mode: data.mode === 'normal' || data.mode === 'multiple' ? data.mode : 'unknown',
      opensAt: instant(activity.start_time), deadline: instant(activity.end_time),
      isInProgress: flag(activity.is_in_progress), isClosed: flag(activity.is_closed),
      attempts: { unlimited, limit, used, remaining: unlimited === false && limit !== null && used !== null ? Math.max(0, limit - used) : null },
      resubmissionOpen: flag(activity.is_resubmit_open), retractAllowed: flag(data.allow_retract),
    },
    title: title || null,
    description: typeof data.description === 'string' ? homeworkDescriptionText(data.description) : null,
  };
}

/** Caller must first confirm the binding's course and homework-list ownership. */
export async function readTronClassAssignmentDetails(
  source: LmsReadonlySource, binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope,
): Promise<DetailRead> {
  if (!id(scope.courseId) || !id(scope.homeworkId) || !id(binding.userId)) return fail(502, 'TRONCLASS_ASSIGNMENT_DETAILS_INVALID');
  if (!source.fetchHomeworkActivity) return unavailable();
  let response: Awaited<ReturnType<NonNullable<LmsReadonlySource['fetchHomeworkActivity']>>>;
  try { response = await source.fetchHomeworkActivity(binding.cookies, scope.homeworkId); }
  catch (error) {
    if (error instanceof NuniError && ['TRONCLASS_BINDING_CHANGED', 'SESSION_CHANGED'].includes(error.code)) throw error;
    const status = schoolHttpStatus(error);
    if (classifySchoolReadError(error) === 'session' || status === 401) return fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
    if (status === 403) return fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
    if (status === 404 || status === 410) return fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
    return unavailable();
  }
  if (!response.ok) {
    if (response.status === 401) return fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
    if (response.status === 403) return fail(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
    if (response.status === 404 || response.status === 410) return fail(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
    return unavailable();
  }
  return normalizeTronClassAssignmentDetails(response.value, scope);
}
