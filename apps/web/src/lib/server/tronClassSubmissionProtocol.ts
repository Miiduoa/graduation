import { NuniError } from '@campus/shared/src/nuni';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';

/** Candidate bounds for nuni, not a claim about a tenant's upload permissions. */
export const TRONCLASS_PROTOCOL_MAX_CONTENT = 20_000;
export const TRONCLASS_PROTOCOL_MAX_UPLOADS = 4;
export const TRONCLASS_PROTOCOL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TRONCLASS_PROTOCOL_MAX_PRIOR_SUBMISSIONS = 1_000;

export type TronClassProtocolRequest = {
  method: 'POST';
  /** Relative to the fixed school origin; never a nuni navigation route. */
  schoolPath: string;
  body: Record<string, unknown>;
};

export type TronClassNewSubmissionInput = {
  activityId: number;
  content: string;
  uploadIds: readonly number[];
};

export type TronClassUploadMetadataInput = { name: string; size: number };

export type TronClassAcknowledgmentContext = {
  courseId: number;
  activityId: number;
  studentId: number;
  priorSubmissionIds: readonly number[];
};

export type TronClassProtocolUnconfirmed = { state: 'unconfirmed' };
export type TronClassSubmissionAcknowledgment = TronClassProtocolUnconfirmed | {
  state: 'acknowledged';
  submissionId: number;
  courseId: number;
  activityId: number;
  studentId: number;
};
export type TronClassUploadMetadataResult = TronClassProtocolUnconfirmed | {
  state: 'metadata-created';
  uploadId: number;
  binaryUpload: 'unsupported';
};

function invalid(): never { throw new NuniError(400, 'TRONCLASS_PROTOCOL_INVALID_INPUT'); }
function unconfirmed(): TronClassProtocolUnconfirmed { return { state: 'unconfirmed' }; }
function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}
function has(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}
function owns(row: Record<string, unknown>, key: string, value: unknown): boolean {
  return has(row, key) && row[key] === value;
}
function validText(value: string, allowLayout: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 && !(allowLayout && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159)) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function filename(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && !!value.trim() &&
    value !== '.' && value !== '..' && !/[\\/]/.test(value) && validText(value, false);
}
function numericIds(value: unknown, limit: number): value is number[] {
  // Array.from also visits sparse slots; Array.every alone would skip them.
  return Array.isArray(value) && value.length <= limit && Array.from(value).every(id);
}

/**
 * Public client evidence: 66297.9aa2f6d5.js, module 473669 (2026-11-16).
 * This only constructs a request. It does not establish permission, ownership
 * of upload IDs, successful upload, or authorization to execute a write.
 * Treat input as literal text even when it contains HTML or entities.
 */
export function buildTronClassNewSubmission(input: TronClassNewSubmissionInput): TronClassProtocolRequest {
  if (!object(input) || !id(input.activityId) || typeof input.content !== 'string' ||
    input.content.length > TRONCLASS_PROTOCOL_MAX_CONTENT || !validText(input.content, true) ||
    !numericIds(input.uploadIds, TRONCLASS_PROTOCOL_MAX_UPLOADS)) return invalid();
  const content = input.content.replace(/\r\n?/g, '\n').trim();
  const uploads = [...new Set(input.uploadIds)];
  if (!content && uploads.length === 0) return invalid();
  const comment = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
  return {
    method: 'POST', schoolPath: `/api/course/activities/${input.activityId}/submissions`,
    body: { comment, uploads, slides: [], is_draft: false, mode: 'normal', other_resources: [], uploads_in_rich_text: [] },
  };
}

/** Public uploadService metadata shape; parent_id is the personal resource root. */
export function buildTronClassUploadMetadata(input: TronClassUploadMetadataInput): TronClassProtocolRequest {
  if (!object(input) || !filename(input.name) || !id(input.size) || input.size > TRONCLASS_PROTOCOL_MAX_FILE_BYTES) return invalid();
  return {
    method: 'POST', schoolPath: '/api/uploads',
    body: {
      name: input.name, size: input.size, parent_type: null, parent_id: 0,
      is_scorm: false, is_wmpkg: false, source: '', is_marked_attachment: false, embed_material_type: '',
    },
  };
}

/** Only valid after a separately verified S3/WRPC binary transfer; not an uploader. */
export function buildTronClassUploadCallback(uploadId: number): TronClassProtocolRequest {
  if (!id(uploadId)) return invalid();
  return { method: 'POST', schoolPath: `/internal-api/upload/callback/${uploadId}`, body: { file_key: uploadId } };
}

function validContext(value: TronClassAcknowledgmentContext): boolean {
  return !!object(value) && id(value.courseId) && id(value.activityId) && id(value.studentId) &&
    numericIds(value.priorSubmissionIds, TRONCLASS_PROTOCOL_MAX_PRIOR_SUBMISSIONS) &&
    new Set(value.priorSubmissionIds).size === value.priorSubmissionIds.length;
}
function identityMatches(row: Record<string, unknown>, context: TronClassAcknowledgmentContext): boolean {
  const direct: Record<string, number> = {
    course_id: context.courseId, activity_id: context.activityId, homework_id: context.activityId,
    student_id: context.studentId, user_id: context.studentId,
  };
  if (Object.entries(direct).some(([key, expected]) => has(row, key) && row[key] !== expected)) return false;
  const nested: Record<string, number> = {
    course: context.courseId, activity: context.activityId, homework: context.activityId,
    student: context.studentId, created_by: context.studentId,
  };
  for (const [key, expected] of Object.entries(nested)) {
    if (!has(row, key)) continue;
    const related = object(row[key]);
    if (!related || !owns(related, 'id', expected)) return false;
  }
  return (!has(row, 'group_id') || row.group_id === null || row.group_id === 0) &&
    (!has(row, 'group') || row.group === null) &&
    (!has(row, 'submit_by_group') || row.submit_by_group === false);
}

/**
 * Conservative candidate schema, NOT a captured/verified production response.
 * Require explicit submission course_id/activity_id/created_by.id and student.id,
 * plus final, non-teacher, latest state flags. The public frontend does not prove
 * every server response includes these fields; missing proof stays unconfirmed.
 * This never returns a receipt, content, attachments, grades, or a submittedAt.
 * In particular, created_at is not evidence of the final submission's timestamp.
 */
export function parseTronClassSubmissionAcknowledgment(
  raw: unknown, context: TronClassAcknowledgmentContext,
): TronClassSubmissionAcknowledgment {
  try {
    if (!validContext(context)) return unconfirmed();
    const envelope = object(raw);
    if (!envelope || !has(envelope, 'submission') || !has(envelope, 'student') ||
      !identityMatches(envelope, context) || !isTronClassSourceVisible(envelope)) return unconfirmed();
    const row = object(envelope.submission);
    const student = object(envelope.student);
    if (!row || !student || !owns(student, 'id', context.studentId) || !has(row, 'id') || !id(row.id) ||
      context.priorSubmissionIds.includes(row.id) || !owns(row, 'course_id', context.courseId) ||
      !owns(row, 'activity_id', context.activityId) || !has(row, 'created_by') ||
      !identityMatches(row, context) || !isTronClassSourceVisible(row) ||
      !owns(row, 'is_draft', false) || !owns(row, 'is_redo', false) ||
      !owns(row, 'submit_by_instructor', false) || !owns(row, 'is_latest_version', true) ||
      (has(row, 'marked_submitted') && typeof row.marked_submitted !== 'boolean')) return unconfirmed();
    return {
      state: 'acknowledged', submissionId: row.id,
      courseId: context.courseId, activityId: context.activityId, studentId: context.studentId,
    };
  } catch {
    // Fixed projection even for malformed objects; never include upstream values.
    return unconfirmed();
  }
}

/**
 * Only identify creation of a metadata object matching the requested filename.
 * No status, upload_url, storage host/type, transcoder, key, or token is returned
 * or used to authorize a transfer. Metadata is not an upload success or receipt.
 */
export function parseTronClassUploadMetadata(
  raw: unknown, expected: TronClassUploadMetadataInput,
): TronClassUploadMetadataResult {
  try {
    const request = buildTronClassUploadMetadata(expected);
    const row = object(raw);
    if (!row || !has(row, 'id') || !id(row.id) || !owns(row, 'name', expected.name) ||
      !isTronClassSourceVisible(row)) return unconfirmed();
    for (const [key, value] of Object.entries(request.body)) {
      if (has(row, key) && row[key] !== value) return unconfirmed();
    }
    return { state: 'metadata-created', uploadId: row.id, binaryUpload: 'unsupported' };
  } catch {
    return unconfirmed();
  }
}
