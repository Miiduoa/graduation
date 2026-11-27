import { NuniError } from '@campus/shared/src/nuni';
import { homeworkDescriptionText, classifySchoolReadError, schoolHttpStatus } from '@campus/shared/src/puLmsReadonly';
import { parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import {
  TRONCLASS_HISTORY_MAX_ATTACHMENTS, TRONCLASS_HISTORY_MAX_CONTENT, TRONCLASS_HISTORY_MAX_ENTRIES,
  type TronClassSubmissionHistory, type TronClassSubmissionHistoryEntry,
} from '@campus/shared/src/tronClassSubmissionHistory';
import type { LmsReadonlySource, LmsReadOptions } from './tronClassLmsSource';
import type { TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { isTronClassSourceVisible } from './tronClassSourceVisibility';
import { readTronClassPreparationSource, type TronClassPreparationRead } from './tronClassPreparationRead';

function invalid(): never { throw new NuniError(502, 'TRONCLASS_HISTORY_UNAVAILABLE'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function createdAt(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const instant = parseTaipeiInstant(value);
  return instant !== null && instant <= now + 60_000 ? new Date(instant).toISOString() : null;
}
function stateOf(row: Record<string, unknown>): TronClassSubmissionHistoryEntry['state'] {
  if (row.is_draft === true && row.is_redo === true) return 'unknown';
  if (row.is_draft === true) return 'draft';
  if (row.is_redo === true) return 'returned';
  // Never repeat the upstream client's !undefined -> submitted inference.
  if (row.is_draft !== false || row.is_redo !== false) return 'unknown';
  if (row.submit_by_instructor === false) return 'submitted';
  if (row.submit_by_instructor === true && row.marked_submitted === true) return 'teacher-marked';
  return 'unknown';
}

function isPlainDownload(file: Record<string, unknown>): boolean {
  // The official resource template uses different routes for references,
  // external providers and generated marking PDFs. Those are not this route.
  return file.allow_download === true &&
    [undefined, null, 0].includes(file.reference_id as undefined | null | number) &&
    [undefined, null, ''].includes(file.source as undefined | null | string) &&
    [undefined, null, '', 'agree'].includes(file.audit_status as undefined | null | string) &&
    [undefined, false, 0].includes(file.deleted as undefined | boolean | number) &&
    [undefined, false, 0].includes(file.is_deleted as undefined | boolean | number) &&
    [undefined, false, 0].includes(file.from_project as undefined | boolean | number) &&
    [undefined, false, 0].includes(file.isFromKnowledgeGraph as undefined | boolean | number) &&
    file.type !== 'link' && (file.status === undefined || file.status === null ||
      (typeof file.status === 'string' && !['cliping', 'clip_failed', 'uploading', 'failed'].includes(file.status)));
}

/** Projection of the official student submission_list; not a final-write receipt. */
export function normalizeTronClassSubmissionHistory(
  value: unknown, binding: Pick<TronClassSubmissionBinding, 'userId'>,
  scope: TronClassHomeworkScope, now = Date.now(),
): TronClassSubmissionHistory {
  if (!id(binding.userId) || !id(scope.courseId) || !id(scope.homeworkId) || !Number.isFinite(now)) return invalid();
  const envelope = object(value);
  if (!Array.isArray(envelope.list) || envelope.list.length > TRONCLASS_HISTORY_MAX_ENTRIES) return invalid();
  // The observed history contract is a list, optionally accompanied by
  // explicit completeness metadata. A mixed error/list response (even an
  // empty list) is not evidence of the student's current history. Fail closed
  // on unknown envelope fields until the tenant contract is verified.
  const prototype = Object.getPrototypeOf(envelope);
  if ((prototype !== Object.prototype && prototype !== null) ||
    !Object.prototype.hasOwnProperty.call(envelope, 'list') ||
    Reflect.ownKeys(envelope).some(key =>
      typeof key !== 'string' || !['list', 'total', 'has_next', 'next_page'].includes(key)) ||
    (envelope.total !== undefined && envelope.total !== envelope.list.length) ||
    (envelope.has_next !== undefined && envelope.has_next !== false) ||
    (envelope.next_page !== undefined && envelope.next_page !== null)) return invalid();
  const ids = new Set<number>();
  let latestId: string | null = null;
  const entries = envelope.list.map((value): TronClassSubmissionHistoryEntry => {
    const row = object(value);
    if (!id(row.id) || ids.has(row.id) || !isTronClassSourceVisible(row) ||
      (row.course_id !== undefined && row.course_id !== scope.courseId) ||
      (row.activity_id !== undefined && row.activity_id !== scope.homeworkId) ||
      (row.homework_id !== undefined && row.homework_id !== scope.homeworkId) ||
      (row.student_id !== undefined && row.student_id !== binding.userId) ||
      (row.user_id !== undefined && row.user_id !== binding.userId) ||
      // PU history can omit this duplicate identity. If it is supplied, even
      // a teacher-marked row must agree with the bound student's scope.
      (Object.prototype.hasOwnProperty.call(row, 'student') && object(row.student).id !== binding.userId) ||
      (row.group_id !== undefined && row.group_id !== null && row.group_id !== 0) || row.group) return invalid();
    const creator = object(row.created_by);
    if (!id(creator.id)) return invalid();
    const teacherCreated = row.submit_by_instructor === true;
    if (creator.id !== binding.userId && !teacherCreated) return invalid();
    ids.add(row.id);
    const isLatest = row.is_latest_version === true;
    if (isLatest) {
      if (latestId !== null) return invalid();
      latestId = String(row.id);
    }
    let state = stateOf(row);
    if (row.is_latest_version !== undefined && typeof row.is_latest_version !== 'boolean') state = 'unknown';
    // Teacher-created marker rows never disclose the creator's body/resources.
    const redacted = teacherCreated;
    if (!redacted && row.comment !== null && typeof row.comment !== 'string') return invalid();
    const rawContent = redacted || row.comment === null ? '' : row.comment as string;
    if (!redacted && (!Array.isArray(row.uploads) || row.uploads.length > TRONCLASS_HISTORY_MAX_ATTACHMENTS)) return invalid();
    const uploadIds = new Set<number>();
    const attachments = redacted ? [] : (row.uploads as unknown[]).map((value) => {
      const file = object(value);
      if (!id(file.id) || uploadIds.has(file.id) || !isTronClassSourceVisible(file) ||
        typeof file.name !== 'string' || !file.name.trim() || file.name.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(file.name) ||
        !(file.size === null || file.size === undefined ||
          (typeof file.size === 'number' && Number.isSafeInteger(file.size) && file.size >= 0))) return invalid();
      uploadIds.add(file.id);
      return {
        name: file.name, size: typeof file.size === 'number' ? file.size : null,
        // Missing permissions, teacher markers and ambiguous states never
        // become download authority. The BFF checks the current source again.
        ...(isPlainDownload(file) && row.submit_by_instructor === false &&
          creator.id === binding.userId && state !== 'unknown'
          ? { download: { uploadId: file.id } } : {}),
      };
    });
    return {
      id: String(row.id), state, isLatest, createdAt: createdAt(row.created_at, now),
      content: homeworkDescriptionText(rawContent, TRONCLASS_HISTORY_MAX_CONTENT),
      contentTruncated: rawContent.length > TRONCLASS_HISTORY_MAX_CONTENT,
      attachments,
      hasOtherResources: !redacted && ((Array.isArray(row.other_resources) && row.other_resources.length > 0) ||
        (Array.isArray(row.slide_references) && row.slide_references.length > 0)),
    };
  });
  return { source: 'tronclass', ...scope, fetchedAt: new Date(now).toISOString(), state: 'available', latestId, entries };
}

/** Caller must first verify this binding's current course and homework access. */
export async function readTronClassSubmissionHistory(
  source: LmsReadonlySource, binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope, now = Date.now(),
  context?: TronClassPreparationRead,
): Promise<TronClassSubmissionHistory> {
  context?.check();
  if (!source.fetchHomeworkActivity || !source.fetchStudentSubmissionList ||
    !id(scope.courseId) || !id(scope.homeworkId) || !id(binding.userId)) return invalid();
  const read = async (request: (options?: LmsReadOptions) => Promise<{ ok: true; value: unknown } | { ok: false; status: number | null }>, activityRead = false) => {
    try {
      const response = await readTronClassPreparationSource(context, request);
      if (!response.ok) {
        if (response.status === 401) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (response.status === 403) throw new NuniError(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
        if (activityRead && (response.status === 404 || response.status === 410)) {
          throw new NuniError(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
        }
        return invalid();
      }
      return response.value;
    } catch (error) {
      context?.check();
      if (error instanceof NuniError && ([401, 403].includes(error.status) ||
        ['TRONCLASS_BINDING_CHANGED', 'SESSION_CHANGED', 'TRONCLASS_HOMEWORK_NOT_FOUND'].includes(error.code))) throw error;
      const status = schoolHttpStatus(error);
      if (classifySchoolReadError(error) === 'session' || status === 401) {
        throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
      }
      if (status === 403) throw new NuniError(403, 'TRONCLASS_COURSE_ACCESS_DENIED');
      if (activityRead && (status === 404 || status === 410)) throw new NuniError(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
      return invalid();
    }
  };
  const activity = object(await read(options => source.fetchHomeworkActivity!(binding.cookies, scope.homeworkId, options), true));
  if (activity.id !== scope.homeworkId || activity.course_id !== scope.courseId ||
    activity.type !== 'homework') return invalid();
  if (!isTronClassSourceVisible(activity)) throw new NuniError(404, 'TRONCLASS_HOMEWORK_NOT_FOUND');
  if (activity.submit_by_group === true) {
    return { source: 'tronclass', ...scope, fetchedAt: new Date(now).toISOString(),
      state: 'group-unsupported', latestId: null, entries: [] };
  }
  if (activity.submit_by_group !== false) return invalid();
  const value = await read(options => source.fetchStudentSubmissionList!(binding.cookies, scope.homeworkId, binding.userId, options));
  return normalizeTronClassSubmissionHistory(value, binding, scope, now);
}
