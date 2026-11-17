import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { TRONCLASS_HISTORY_MAX_ENTRIES } from '@campus/shared/src/tronClassSubmissionHistory';
import {
  TRONCLASS_PROTOCOL_MAX_CONTENT, TRONCLASS_PROTOCOL_MAX_UPLOADS,
  buildTronClassUploadMetadata,
  type TronClassProtocolUnconfirmed, type TronClassSubmissionAcknowledgment,
} from './tronClassSubmissionProtocol';
import { normalizeTronClassSubmissionHistory } from './tronClassSubmissionHistory';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

export type TronClassSubmissionReadbackContext = {
  /** Captured from this attempt's final response, never guessed from a list. */
  acknowledgment: Extract<TronClassSubmissionAcknowledgment, { state: 'acknowledged' }>;
  /** The caller must have read the complete, same-student history before POST. */
  priorHistoryComplete: true;
  priorSubmissionIds: readonly number[];
  /** The exact comment emitted by buildTronClassNewSubmission, including escapes. */
  comment: string;
  /** Files whose complete transfer was checked before this attempt's final POST. */
  uploads: readonly { id: number; name: string; size: number }[];
};

export type TronClassSubmissionReadback = TronClassProtocolUnconfirmed | {
  state: 'verified-new-version';
  submissionId: number;
  courseId: number;
  activityId: number;
  studentId: number;
  /** Source created_at is a record time, not an authoritative submission time. */
  sourceRecordedAt: string | null;
};

type Acknowledgment = TronClassSubmissionReadbackContext['acknowledgment'];
const unconfirmed = (): TronClassProtocolUnconfirmed => ({ state: 'unconfirmed' });
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const has = (row: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(row, key);
function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function contextValid(value: TronClassSubmissionReadbackContext): boolean {
  if (!object(value)) return false;
  const acknowledgment = object(value.acknowledgment);
  if (!acknowledgment || acknowledgment.state !== 'acknowledged' ||
    !id(acknowledgment.submissionId) || !id(acknowledgment.courseId) ||
    !id(acknowledgment.activityId) || !id(acknowledgment.studentId) ||
    value.priorHistoryComplete !== true || !Array.isArray(value.priorSubmissionIds) ||
    value.priorSubmissionIds.length >= TRONCLASS_HISTORY_MAX_ENTRIES ||
    !Array.from(value.priorSubmissionIds).every(id) ||
    new Set(value.priorSubmissionIds).size !== value.priorSubmissionIds.length ||
    value.priorSubmissionIds.includes(acknowledgment.submissionId) ||
    typeof value.comment !== 'string' || value.comment.length > TRONCLASS_PROTOCOL_MAX_CONTENT * 6 ||
    !Array.isArray(value.uploads) || value.uploads.length > TRONCLASS_PROTOCOL_MAX_UPLOADS ||
    (!value.comment.trim() && value.uploads.length === 0)) return false;
  const uploads = new Set<number>();
  for (const file of Array.from(value.uploads)) {
    if (!object(file) || !id(file.id) || uploads.has(file.id)) return false;
    // Use the same filename, byte bounds and Unicode checks as metadata creation.
    buildTronClassUploadMetadata({ name: file.name, size: file.size });
    uploads.add(file.id);
  }
  return true;
}

/** Absence of redundant scope fields is allowed only because the GET is scoped. */
function identityMatches(row: Record<string, unknown>, context: Acknowledgment, teacherCreator = false): boolean {
  const direct: Record<string, number> = {
    course_id: context.courseId, activity_id: context.activityId, homework_id: context.activityId,
    student_id: context.studentId, user_id: context.studentId,
  };
  if (Object.entries(direct).some(([key, expected]) => has(row, key) && row[key] !== expected)) return false;
  const related: Record<string, number> = {
    course: context.courseId, activity: context.activityId, homework: context.activityId,
    student: context.studentId, created_by: context.studentId,
  };
  for (const [key, expected] of Object.entries(related)) {
    if (!has(row, key)) continue;
    const relation = object(row[key]);
    if (!relation || !has(relation, 'id') || !id(relation.id) ||
      (!(teacherCreator && key === 'created_by') && relation.id !== expected)) return false;
  }
  return (!has(row, 'group_id') || row.group_id === null || row.group_id === 0) &&
    (!has(row, 'group') || row.group === null) &&
    (!has(row, 'submit_by_group') || row.submit_by_group === false);
}

function sourceRecordedAt(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const instant = parseTaipeiInstant(value);
  return instant !== null && instant <= now + 60_000 ? new Date(instant).toISOString() : null;
}

/**
 * Match a complete, authenticated submission_list read to one captured POST.
 * The caller supplies the current student's fixed school GET and must recheck
 * binding/access before using the result. This pure matcher is not authorization
 * or a production-contract attestation. No timestamp establishes freshness:
 * the acknowledged ID must be absent from the complete baseline and be the only
 * new ID and the unique latest version, with exactly the sent body and files.
 */
export function verifyTronClassSubmissionReadback(
  raw: unknown, context: TronClassSubmissionReadbackContext, now = Date.now(),
): TronClassSubmissionReadback {
  try {
    if (!Number.isFinite(now) || !contextValid(context)) return unconfirmed();
    const acknowledgment = context.acknowledgment;
    const envelope = object(raw);
    if (!envelope || !isTronClassSourceVisible(envelope) ||
      !identityMatches(envelope, acknowledgment)) return unconfirmed();
    // Reuse the read-only parser's completeness, duplicate, visibility and
    // per-row ownership checks without using its text projection for comparison.
    const history = normalizeTronClassSubmissionHistory(raw, { userId: acknowledgment.studentId },
      { courseId: acknowledgment.courseId, homeworkId: acknowledgment.activityId }, now);
    if (history.latestId !== String(acknowledgment.submissionId) ||
      history.entries.length !== context.priorSubmissionIds.length + 1) return unconfirmed();
    const ids = new Set(history.entries.map(row => Number(row.id)));
    if (context.priorSubmissionIds.some(prior => !ids.has(prior))) return unconfirmed();

    let matched: Record<string, unknown> | undefined;
    for (const value of envelope.list as unknown[]) {
      const row = object(value);
      if (!row || typeof row.is_latest_version !== 'boolean' ||
        !identityMatches(row, acknowledgment, row.submit_by_instructor === true)) return unconfirmed();
      if (row.id === acknowledgment.submissionId) matched = row;
    }
    if (!matched || matched.is_latest_version !== true || matched.is_draft !== false ||
      matched.is_redo !== false || matched.submit_by_instructor !== false ||
      (has(matched, 'marked_submitted') && typeof matched.marked_submitted !== 'boolean') ||
      matched.comment !== context.comment || !Array.isArray(matched.uploads) ||
      matched.uploads.length !== context.uploads.length) return unconfirmed();
    // A source may omit unused optional resource fields. If supplied, only an
    // explicit empty array is compatible with the normal text/file request.
    for (const key of ['other_resources', 'slide_references', 'slides', 'uploads_in_rich_text']) {
      if (has(matched, key) && (!Array.isArray(matched[key]) || matched[key].length !== 0)) return unconfirmed();
    }
    if (has(matched, 'mode') && matched.mode !== 'normal') return unconfirmed();
    const expectedFiles = new Map(context.uploads.map(file => [file.id, file]));
    for (const value of matched.uploads) {
      const file = object(value);
      const expected = file && id(file.id) ? expectedFiles.get(file.id) : undefined;
      if (!file || !expected || file.name !== expected.name || file.size !== expected.size ||
        !isTronClassSourceVisible(file)) return unconfirmed();
      expectedFiles.delete(expected.id);
    }
    if (expectedFiles.size > 0) return unconfirmed();
    return {
      state: 'verified-new-version', submissionId: acknowledgment.submissionId,
      courseId: acknowledgment.courseId, activityId: acknowledgment.activityId,
      studentId: acknowledgment.studentId, sourceRecordedAt: sourceRecordedAt(matched.created_at, now),
    };
  } catch {
    // No raw value, filename, account, body, URL, grading detail or exception is
    // returned on an incomplete or malformed response.
    return unconfirmed();
  }
}
