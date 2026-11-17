import { createHash } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import { createPuRelayFetch, type FetchLike } from './puEdgeRelay';
import {
  assertTronClassCandidateAuthorization, createTronClassCandidateFetch,
  readTronClassCandidateJson, tronClassCandidateHeaders, type TronClassCandidateAuthorization,
} from './tronClassSubmissionCandidate';
import {
  buildTronClassNewSubmission, buildTronClassUploadMetadata, parseTronClassSubmissionAcknowledgment,
  type TronClassSubmissionAcknowledgment,
} from './tronClassSubmissionProtocol';
import { verifyTronClassSubmissionReadback } from './tronClassSubmissionReadback';
import type { TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';

const ORIGIN = 'https://tronclass.pu.edu.tw';
const OPERATION_ID = /^[A-Za-z0-9_-]{16,80}$/;
const REVISION = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function invalid(): never { return fail(400, 'TRONCLASS_PROTOCOL_INVALID_INPUT'); }

export type TronClassFinalCandidateInput = TronClassHomeworkScope & {
  revision: string;
  operationId: string;
  content: string;
  fileIds: readonly string[];
};

/** Read from the controlled upload journal, never accepted from an HTTP body. */
export type TronClassCandidateUploadedFile = TronClassHomeworkScope & {
  ownerKey: string;
  studentId: number;
  revision: string;
  operationId: string;
  fileId: string;
  uploadId: number;
  name: string;
  size: number;
  contentType: string;
  sha256: string;
  state: 'transferred';
};

/** Persist before POST. No cookies, passwords or storage URLs belong in this record. */
export type TronClassFinalCandidateClaim = TronClassHomeworkScope & {
  ownerKey: string;
  studentId: number;
  revision: string;
  operationId: string;
  payloadDigest: string;
  comment: string;
  uploads: Array<{ id: number; name: string; size: number }>;
  priorSubmissionIds: number[];
  priorHistoryComplete: true;
};

type Acknowledgment = Extract<TronClassSubmissionAcknowledgment, { state: 'acknowledged' }>;
export type TronClassFinalCandidateAttempt = TronClassFinalCandidateClaim & {
  acknowledgment: Acknowledgment | null;
};

type Dependencies = {
  enabled?: () => boolean;
  authorize(ownerKey: string, scope: TronClassHomeworkScope): Promise<TronClassCandidateAuthorization>;
  assertCurrent(ownerKey: string, revision: string): Promise<void>;
  readUploadedFiles(ownerKey: string, input: Omit<TronClassFinalCandidateInput, 'content'>): Promise<TronClassCandidateUploadedFile[]>;
  /** Must atomically reserve the school student/activity across owners and processes. */
  claim(attempt: TronClassFinalCandidateClaim): Promise<boolean>;
  rememberAcknowledgment(attempt: TronClassFinalCandidateClaim, acknowledgment: Acknowledgment): Promise<void>;
  readAttempt(ownerKey: string, operationId: string): Promise<TronClassFinalCandidateAttempt | null>;
  requireBinding(ownerKey: string): Promise<TronClassSubmissionBinding>;
  /** Fixed official student submission_list GET, with current ownership/visibility checked by the reader. */
  readHistory(binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope, signal: AbortSignal): Promise<unknown>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

function checkedInput(ownerKey: string, input: TronClassFinalCandidateInput) {
  if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 300 || !input ||
    !id(input.courseId) || !id(input.homeworkId) || typeof input.revision !== 'string' || !REVISION.test(input.revision) ||
    typeof input.operationId !== 'string' || !OPERATION_ID.test(input.operationId) ||
    typeof input.content !== 'string' || input.content.length > 20_000 ||
    !Array.isArray(input.fileIds) || input.fileIds.length > 4 ||
    !Array.from(input.fileIds).every(value => typeof value === 'string' && OPERATION_ID.test(value)) ||
    new Set(input.fileIds).size !== input.fileIds.length ||
    Object.keys(input).some(key => !['courseId', 'homeworkId', 'revision', 'operationId', 'content', 'fileIds'].includes(key))) invalid();
  return { ...input, fileIds: [...input.fileIds] };
}

function capturedAuthorization(value: TronClassCandidateAuthorization): TronClassCandidateAuthorization {
  return { ...value, binding: { ...value.binding, cookies: { ...value.binding.cookies } },
    assignment: { ...value.assignment, allowedContentTypes: [...value.assignment.allowedContentTypes] },
    priorSubmissionIds: [...value.priorSubmissionIds] };
}

export function tronClassFinalCandidateDigest(attempt: TronClassFinalCandidateClaim): string {
  return digest(JSON.stringify({ ownerKey: attempt.ownerKey, studentId: attempt.studentId,
    courseId: attempt.courseId, homeworkId: attempt.homeworkId, revision: attempt.revision,
    operationId: attempt.operationId, comment: attempt.comment, uploads: attempt.uploads,
    priorSubmissionIds: attempt.priorSubmissionIds, priorHistoryComplete: attempt.priorHistoryComplete }));
}

function checkedAttempt(raw: TronClassFinalCandidateAttempt | null, ownerKey: string, operationId: string) {
  if (!raw || raw.ownerKey !== ownerKey || raw.operationId !== operationId ||
    !id(raw.courseId) || !id(raw.homeworkId) || !id(raw.studentId) ||
    typeof raw.revision !== 'string' || !REVISION.test(raw.revision) ||
    typeof raw.payloadDigest !== 'string' || !HASH.test(raw.payloadDigest) ||
    typeof raw.comment !== 'string' || raw.comment.length > 120_000 ||
    raw.priorHistoryComplete !== true || !Array.isArray(raw.priorSubmissionIds) || raw.priorSubmissionIds.length !== 0 ||
    !Array.isArray(raw.uploads) || raw.uploads.length > 4 ||
    !Array.from(raw.uploads).every(file => !!file && id(file.id)) ||
    new Set(raw.uploads.map(file => file.id)).size !== raw.uploads.length ||
    (!raw.comment.trim() && raw.uploads.length === 0)) fail(409, 'TRONCLASS_OPERATION_CONFLICT');
  for (const file of raw.uploads) buildTronClassUploadMetadata({ name: file.name, size: file.size });
  if (tronClassFinalCandidateDigest(raw) !== raw.payloadDigest) fail(409, 'TRONCLASS_OPERATION_CONFLICT');
  return structuredClone(raw);
}

function checkedFiles(raw: TronClassCandidateUploadedFile[], ownerKey: string, input: TronClassFinalCandidateInput,
  authorization: TronClassCandidateAuthorization): TronClassCandidateUploadedFile[] {
  const assignment = authorization.assignment;
  if (!Array.isArray(raw) || raw.length !== input.fileIds.length ||
    !Array.from(raw).every(file => !!file && typeof file === 'object') ||
    new Set(raw.map(file => file.fileId)).size !== raw.length ||
    new Set(raw.map(file => file.uploadId)).size !== raw.length) fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
  const files = raw.map(file => ({ ...file }));
  for (const file of files) {
    if (file.state !== 'transferred' || file.ownerKey !== ownerKey || file.studentId !== authorization.binding.userId ||
      file.revision !== input.revision || file.operationId !== input.operationId ||
      file.courseId !== input.courseId || file.homeworkId !== input.homeworkId || !input.fileIds.includes(file.fileId) ||
      !id(file.uploadId) || typeof file.sha256 !== 'string' || !HASH.test(file.sha256) ||
      typeof file.contentType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(file.contentType)) {
      fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
    }
    buildTronClassUploadMetadata({ name: file.name, size: file.size });
  }
  if (!['maxFiles', 'maxFileBytes', 'maxTotalBytes'].every(key => {
    const value = assignment[key as 'maxFiles' | 'maxFileBytes' | 'maxTotalBytes'];
    return Number.isSafeInteger(value) && value >= 0;
  }) || !Array.isArray(assignment.allowedContentTypes) || assignment.allowedContentTypes.length > 50 ||
    !Array.from(assignment.allowedContentTypes).every(type => typeof type === 'string') ||
    (files.length > 0 && assignment.allowsAttachments !== true) ||
    files.length > Math.min(assignment.maxFiles, 4) ||
    files.some(file => file.size > assignment.maxFileBytes || (assignment.allowedContentTypes.length > 0 &&
      !assignment.allowedContentTypes.includes(file.contentType))) ||
    files.reduce((total, file) => total + file.size, 0) > Math.min(assignment.maxTotalBytes, MAX_TOTAL_BYTES)) {
    fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
  }
  return input.fileIds.map(fileId => files.find(file => file.fileId === fileId)!);
}

/**
 * Executable controlled flow: persisted upload handles -> one final POST ->
 * exact student readback. Production routes never construct this candidate.
 * The required journal is server-only; an in-memory claim is insufficient for
 * real requests. A failed final call is never automatically retried.
 */
export function createTronClassFinalSubmissionCandidate(dependencies: Dependencies) {
  if (!dependencies || ['authorize', 'assertCurrent', 'readUploadedFiles', 'claim', 'rememberAcknowledgment',
    'readAttempt', 'requireBinding', 'readHistory'].some(key => typeof dependencies[key as keyof Dependencies] !== 'function')) invalid();
  const enabled = dependencies.enabled ?? (() => false);
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) invalid();

  async function bounded<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal, check: () => void) => Promise<T>) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeoutError = () => new NuniError(504, 'TRONCLASS_CANDIDATE_TIMEOUT');
    let rejectDeadline: (() => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = () => reject(timeoutError());
      controller.signal.addEventListener('abort', rejectDeadline, { once: true });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    const check = () => { if (controller.signal.aborted) throw timeoutError(); };
    try { return await Promise.race([run(controller.signal, check), deadline]); }
    catch (error) {
      controller.abort();
      if (error instanceof NuniError && [
        'TRONCLASS_PROTOCOL_INVALID_INPUT', 'TRONCLASS_CANDIDATE_DISABLED', 'TRONCLASS_CANDIDATE_TIMEOUT',
        'TRONCLASS_CANDIDATE_UNCONFIRMED', 'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED',
        'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED', 'TRONCLASS_RECONNECT_REQUIRED', 'TRONCLASS_BINDING_CHANGED',
        'TRONCLASS_OPERATION_CONFLICT', 'TRONCLASS_UPLOAD_UNCONFIRMED', 'TRONCLASS_SUBMISSION_BLOCKED',
      ].includes(error.code)) throw new NuniError(error.status, error.code);
      return fail(502, 'TRONCLASS_CANDIDATE_UNCONFIRMED');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
    }
  }

  async function readback(attempt: TronClassFinalCandidateAttempt, binding: TronClassSubmissionBinding,
    signal: AbortSignal, check: () => void) {
    const pending = { state: 'awaiting-confirmation' as const, operationId: attempt.operationId };
    if (!attempt.acknowledgment) return pending;
    const ack = attempt.acknowledgment;
    if (ack.courseId !== attempt.courseId || ack.activityId !== attempt.homeworkId || ack.studentId !== binding.userId) return pending;
    await dependencies.assertCurrent(attempt.ownerKey, binding.revision);
    check();
    const history = await dependencies.readHistory({ ...binding, cookies: { ...binding.cookies } },
      Object.freeze({ courseId: attempt.courseId, homeworkId: attempt.homeworkId }), signal);
    check();
    const result = verifyTronClassSubmissionReadback(history, {
      acknowledgment: ack, priorHistoryComplete: attempt.priorHistoryComplete,
      priorSubmissionIds: attempt.priorSubmissionIds, comment: attempt.comment, uploads: attempt.uploads,
    }, now());
    await dependencies.assertCurrent(attempt.ownerKey, binding.revision);
    check();
    if (result.state !== 'verified-new-version') return pending;
    const confirmedAt = now();
    if (!Number.isFinite(confirmedAt)) return pending;
    return { ...result, operationId: attempt.operationId, confirmedAt: new Date(confirmedAt).toISOString() };
  }

  return Object.freeze({
    contractVerified: false as const,
    async dispatch(ownerKey: string, rawInput: TronClassFinalCandidateInput, signal?: AbortSignal) {
      if (!enabled()) fail(503, 'TRONCLASS_CANDIDATE_DISABLED');
      const input = checkedInput(ownerKey, rawInput);
      const scope = Object.freeze({ courseId: input.courseId, homeworkId: input.homeworkId });
      return bounded(signal, async (signal, check) => {
        check();
        const raw = await dependencies.authorize(ownerKey, scope);
        check();
        assertTronClassCandidateAuthorization(raw, scope, now(), !!input.content.trim());
        let authorization = capturedAuthorization(raw);
        let binding = authorization.binding;
        if (input.revision !== binding.revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
        let headers = tronClassCandidateHeaders(binding);
        const uploadScope = { ...scope, revision: input.revision, operationId: input.operationId, fileIds: [...input.fileIds] };
        const files = checkedFiles(await dependencies.readUploadedFiles(ownerKey, uploadScope), ownerKey, input, authorization);
        check();
        const request = buildTronClassNewSubmission({ activityId: input.homeworkId, content: input.content,
          uploadIds: files.map(file => file.uploadId) });
        const body = JSON.stringify(request.body);
        const attempt: TronClassFinalCandidateClaim = {
          ...scope, ownerKey, studentId: binding.userId, revision: binding.revision, operationId: input.operationId,
          payloadDigest: '', comment: request.body.comment as string,
          uploads: files.map(file => ({ id: file.uploadId, name: file.name, size: file.size })),
          priorSubmissionIds: [...authorization.priorSubmissionIds], priorHistoryComplete: true,
        };
        attempt.payloadDigest = tronClassFinalCandidateDigest(attempt);
        const guard = async () => {
          await dependencies.assertCurrent(ownerKey, binding.revision);
          check();
          if (!enabled()) fail(503, 'TRONCLASS_CANDIDATE_DISABLED');
          assertTronClassCandidateAuthorization(authorization, scope, now(), !!input.content.trim());
        };
        await guard();
        if (await dependencies.claim(structuredClone(attempt)) !== true) fail(409, 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED');
        check();
        // Uploads and the durable claim can take time. Re-read the actual school
        // rules and baseline before POST; a second school-tab submission or a
        // teacher's changed limits must not be accepted using our first snapshot.
        const freshRaw = await dependencies.authorize(ownerKey, scope);
        check();
        assertTronClassCandidateAuthorization(freshRaw, scope, now(), !!input.content.trim());
        const fresh = capturedAuthorization(freshRaw);
        if (fresh.binding.revision !== binding.revision || fresh.binding.userId !== binding.userId) fail(409, 'TRONCLASS_BINDING_CHANGED');
        checkedFiles(files, ownerKey, input, fresh);
        authorization = fresh;
        binding = fresh.binding;
        headers = tronClassCandidateHeaders(binding);
        await guard();
        const fetchSchool = dependencies.fetch ?? createPuRelayFetch({
          directFetch: createTronClassCandidateFetch(undefined, files.map(file => file.uploadId)),
        });
        const response = await fetchSchool(`${ORIGIN}${request.schoolPath}`, {
          method: 'POST', body, headers, redirect: 'manual', cache: 'no-store', signal,
        });
        check();
        if ((response.status !== 200 && response.status !== 201) || response.redirected) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 401 || response.status === 403) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
          return { state: 'awaiting-confirmation' as const, operationId: input.operationId };
        }
        const acknowledgment = parseTronClassSubmissionAcknowledgment(await readTronClassCandidateJson(response, signal), {
          courseId: input.courseId, activityId: input.homeworkId, studentId: binding.userId,
          priorSubmissionIds: authorization.priorSubmissionIds,
        });
        check();
        if (acknowledgment.state !== 'acknowledged') return { state: 'awaiting-confirmation' as const, operationId: input.operationId };
        // Save the version before reading it back. Losing a response must not
        // cause another POST; a later check can use the original persisted ID.
        await dependencies.rememberAcknowledgment(structuredClone(attempt), { ...acknowledgment });
        check();
        return readback({ ...attempt, acknowledgment }, binding, signal, check);
      });
    },
    async reconcile(ownerKey: string, operationId: string, signal?: AbortSignal) {
      if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 300 || typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) invalid();
      // Reconciliation is read-only and remains available with writes disabled.
      return bounded(signal, async (signal, check) => {
        check();
        const raw = await dependencies.readAttempt(ownerKey, operationId);
        check();
        const attempt = checkedAttempt(raw, ownerKey, operationId);
        const binding = await dependencies.requireBinding(ownerKey);
        check();
        if (!binding || binding.schoolId !== 'pu' || binding.userId !== attempt.studentId ||
          !REVISION.test(binding.revision) || !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= now()) {
          fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        }
        return readback(attempt, { ...binding, cookies: { ...binding.cookies } }, signal, check);
      });
    },
  });
}
