import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { NuniError } from '@campus/shared/src/nuni';
import { createPuRelayFetch, type FetchLike } from './puEdgeRelay';
import {
  buildTronClassUploadCallback, buildTronClassUploadMetadata, parseTronClassUploadMetadata,
  TRONCLASS_PROTOCOL_MAX_FILE_BYTES,
} from './tronClassSubmissionProtocol';
import type { TronClassAssignment, TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import { tronClassSchoolWriteHeaders } from './tronClassWriteHeaders';

const SCHOOL_ORIGIN = 'https://tronclass.pu.edu.tw';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;
const REVISION = /^[a-f0-9]{32}$/;

export type TronClassAttachmentCandidateAuthorization = {
  binding: TronClassSubmissionBinding;
  assignment: TronClassAssignment;
  mode: 'normal';
  ordinaryWindowConfirmed: boolean;
  prerequisitesConfirmed: boolean;
};

export type TronClassAttachmentCandidateInput = TronClassHomeworkScope & {
  revision: string;
  operationId: string;
  fileId: string;
  name: string;
  contentType: string;
  bytes: Uint8Array;
};

/**
 * Persist this immutable claim atomically BEFORE metadata is created. Only the
 * first acquisition may return true. The same owner/operation/file slot must
 * reject replays and changed payloads across processes, restarts and revisions.
 * An uncertain or failed transfer does not release a claim for automatic retry.
 */
export type TronClassAttachmentClaim = Readonly<TronClassHomeworkScope & {
  ownerKey: string;
  schoolId: 'pu';
  studentId: number;
  revision: string;
  operationId: string;
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
}>;

/** Only fields observed in the official uploadClass; no credentials or body. */
export type TronClassUploadTargetEvidence = Readonly<{
  uploadId: number;
  url: string;
  storageType: 'S3' | 'MEDIA';
  transcoder: string | null;
  mode: 'raw' | 'multipart';
}>;

export type TronClassPinnedUploadTarget = Readonly<{
  uploadId: number;
  url: string;
  mode: 'raw' | 'multipart';
}>;

export type TronClassAttachmentTransfer = {
  state: 'transferred';
  confirmation: 'awaiting-confirmation';
  ownerKey: string;
  uploadId: number;
  courseId: number;
  homeworkId: number;
  studentId: number;
  revision: string;
  operationId: string;
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
};

export type TronClassAttachmentCandidateDependencies = {
  enabled?: () => boolean;
  authorize: (ownerKey: string, scope: TronClassHomeworkScope, signal?: AbortSignal, expected?: string | TronClassSubmissionBinding) => Promise<TronClassAttachmentCandidateAuthorization>;
  assertCurrent: (ownerKey: string, revision: string) => Promise<void>;
  claim: (claim: TronClassAttachmentClaim) => Promise<boolean>;
  /**
   * A SERVER-OWNED, audited policy must independently approve the exact object
   * URL and upload ID. Never implement this by echoing evidence, checking only
   * its origin, or accepting a caller-provided allowlist/presigned URL.
   * MEDIA destinations requiring ambient school cookies are unsupported here;
   * only a separately verified credential-free PUT contract may be approved.
   */
  resolveStorageTarget: (evidence: TronClassUploadTargetEvidence, claim: TronClassAttachmentClaim) => Promise<TronClassPinnedUploadTarget | null>;
  fetchSchool?: FetchLike;
  fetchStorage?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

function fail(status: number, code: string): never { throw new NuniError(status, code); }
function invalid(): never { return fail(400, 'TRONCLASS_PROTOCOL_INVALID_INPUT'); }
function unconfirmed(): never { return fail(502, 'TRONCLASS_UPLOAD_UNCONFIRMED'); }
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function object(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function copiedInput(input: TronClassAttachmentCandidateInput): TronClassAttachmentCandidateInput {
  if (!object(input) || Object.keys(input).some(key => ![
    'courseId', 'homeworkId', 'revision', 'operationId', 'fileId', 'name', 'contentType', 'bytes',
  ].includes(key)) || !positiveId(input.courseId) || !positiveId(input.homeworkId) ||
    typeof input.revision !== 'string' || !REVISION.test(input.revision) ||
    typeof input.operationId !== 'string' || !TOKEN.test(input.operationId) ||
    typeof input.fileId !== 'string' || !TOKEN.test(input.fileId) ||
    typeof input.contentType !== 'string' || input.contentType.length > 100 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.contentType) ||
    !(input.bytes instanceof Uint8Array) || !input.bytes.byteLength || input.bytes.byteLength > TRONCLASS_PROTOCOL_MAX_FILE_BYTES) invalid();
  // Includes Unicode, filename and byte limits from the shared request builder.
  buildTronClassUploadMetadata({ name: input.name, size: input.bytes.byteLength });
  return { ...input, bytes: Uint8Array.from(input.bytes) };
}

function checkedAuthorization(value: TronClassAttachmentCandidateAuthorization, input: TronClassAttachmentCandidateInput, now: number) {
  const binding = value?.binding;
  const assignment = value?.assignment;
  if (!Number.isFinite(now) || !binding || binding.schoolId !== 'pu' || !positiveId(binding.userId) ||
    binding.revision !== input.revision || !REVISION.test(binding.revision) ||
    !Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= now) {
    fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
  }
  if (!assignment || assignment.courseId !== input.courseId || assignment.homeworkId !== input.homeworkId ||
    assignment.studentId !== binding.userId || assignment.permissionKnown !== true || assignment.individual !== true ||
    assignment.canSubmit !== true || assignment.isClosed !== false || assignment.allowsAttachments !== true ||
    value.mode !== 'normal' || value.ordinaryWindowConfirmed !== true || value.prerequisitesConfirmed !== true ||
    !Number.isSafeInteger(assignment.maxFiles) || assignment.maxFiles <= 0 ||
    !Number.isSafeInteger(assignment.maxFileBytes) || assignment.maxFileBytes < input.bytes.byteLength ||
    !Number.isSafeInteger(assignment.maxTotalBytes) || assignment.maxTotalBytes < input.bytes.byteLength ||
    (assignment.remainingAttempts !== null && (!Number.isSafeInteger(assignment.remainingAttempts) || assignment.remainingAttempts <= 0)) ||
    !Array.isArray(assignment.allowedContentTypes) || assignment.allowedContentTypes.length > 50 ||
    assignment.allowedContentTypes.some(type => typeof type !== 'string' || type.length > 100) ||
    (assignment.allowedContentTypes.length > 0 && !assignment.allowedContentTypes.includes(input.contentType))) {
    fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
  }
  for (const [at, opens] of [[assignment.opensAt, true], [assignment.deadline, false]] as const) {
    if (at !== null && (!Number.isFinite(Date.parse(at)) || (opens ? Date.parse(at) > now : Date.parse(at) < now))) {
      fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
    }
  }
}

function storageUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(raw)) return unconfirmed();
  let url: URL;
  try { url = new URL(raw); } catch { return unconfirmed(); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port ||
    url.href !== raw || !host.includes('.') || isIP(host) || host.startsWith('[') ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return unconfirmed();
  // Even a same-origin policy mistake must not PUT into a school API/login.
  // Encoded segments, dot normalization and separators cannot disguise it.
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return unconfirmed(); }
  if (path.includes('%') || path.includes('//') || /[\\\x00-\x20\x7f]/.test(path) ||
    path.split('/').some(part => part === '.' || part === '..')) return unconfirmed();
  if (url.origin === SCHOOL_ORIGIN && /^\/(?:api|internal-api|auth|cas|login|logout|account|course)(?:\/|$)/i.test(path)) return unconfirmed();
  return raw;
}

/** Official 72914 uploadClass + 748693 / 56834 uploader branches, 2026-11-16. */
function targetEvidence(raw: unknown, input: TronClassAttachmentCandidateInput): TronClassUploadTargetEvidence {
  const parsed = parseTronClassUploadMetadata(raw, { name: input.name, size: input.bytes.byteLength });
  const row = object(raw);
  if (parsed.state !== 'metadata-created' || !row) return unconfirmed();
  const transcoder = row.transcoder === undefined || row.transcoder === null ? null : row.transcoder;
  if (transcoder !== null && (typeof transcoder !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(transcoder))) return unconfirmed();
  // QINIU multipart/chunk completion and CHINAMCLOUD are outside this adapter.
  const rawPut = row.storage_type === 'S3' && transcoder === 'WRPC';
  if (!rawPut && row.storage_type !== 'MEDIA') return unconfirmed();
  return Object.freeze({ uploadId: parsed.uploadId, url: storageUrl(row.upload_url),
    storageType: rawPut ? 'S3' : 'MEDIA', transcoder, mode: rawPut ? 'raw' : 'multipart' });
}

function checkLength(response: Response): number | null {
  const length = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') return unconfirmed();
  if (length === null) return null;
  if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_RESPONSE_BYTES) return unconfirmed();
  return Number(length);
}

async function boundedResponse(response: Response, signal: AbortSignal, check: () => void, json: boolean): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    if (json && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return unconfirmed();
    const expected = checkLength(response);
    if (!response.body) {
      if (json || (expected !== null && expected !== 0)) return unconfirmed();
      return null;
    }
    reader = response.body.getReader();
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      check();
      const next = await reader.read();
      check();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) return unconfirmed();
      if (json) chunks.push(next.value);
    }
    if (expected !== null && expected !== length) return unconfirmed();
    if (!json) return null;
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return unconfirmed(); }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    else void response.body?.cancel().catch(() => {});
  }
}

/**
 * Controlled transfer only. No production provider or public route uses it.
 * HTTP acknowledgment of metadata/binary/callback does not prove association
 * with an assignment, final submission, readable bytes, or teacher receipt.
 */
export function createTronClassAttachmentUploadCandidate(dependencies: TronClassAttachmentCandidateDependencies) {
  if (!dependencies || ['authorize', 'assertCurrent', 'claim', 'resolveStorageTarget']
    .some(key => typeof dependencies[key as keyof TronClassAttachmentCandidateDependencies] !== 'function')) invalid();
  const enabled = dependencies.enabled ?? (() => false);
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) invalid();
  // Web fetch exposes the response stream before buffering. The historical
  // IPv4 helper buffers an unbounded body; do not use it for this candidate.
  const direct: FetchLike = (url, init) => fetch(url, init);
  const fetchSchool = dependencies.fetchSchool ?? createPuRelayFetch({ directFetch: direct });
  const fetchStorage = dependencies.fetchStorage ?? direct;
  return Object.freeze({
    contractVerified: false as const,
    async dispatch(ownerKey: string, value: TronClassAttachmentCandidateInput, signal?: AbortSignal): Promise<TronClassAttachmentTransfer> {
      if (!enabled()) fail(503, 'TRONCLASS_CANDIDATE_DISABLED');
      if (typeof ownerKey !== 'string' || !/^(?:platform:pa_[A-Za-z0-9_-]+|firebase:[^\s/\x00-\x1f\x7f]{1,128})$/.test(ownerKey) || ownerKey.length > 200) invalid();
      const input = copiedInput(value);
      const scope = Object.freeze({ courseId: input.courseId, homeworkId: input.homeworkId });
      const controller = new AbortController();
      let cancelledByCaller = false;
      const abort = () => { cancelledByCaller = true; controller.abort(); };
      const timedOut = () => new NuniError(cancelledByCaller ? 499 : 504,
        cancelledByCaller ? 'TRONCLASS_UPLOAD_CANCELLED' : 'TRONCLASS_CANDIDATE_TIMEOUT');
      let authorization: TronClassAttachmentCandidateAuthorization | undefined;
      const check = () => {
        if (controller.signal.aborted) throw timedOut();
        if (!enabled()) fail(503, 'TRONCLASS_CANDIDATE_DISABLED');
        if (authorization) checkedAuthorization(authorization, input, now());
      };
      const guard = async () => {
        check();
        if (authorization) await dependencies.assertCurrent(ownerKey, authorization.binding.revision);
        check();
      };
      const stage = async <T>(run: () => Promise<T>, discard?: (value: T) => void): Promise<T> => {
        await guard();
        const result = await run();
        try { await guard(); } catch (error) { discard?.(result); throw error; }
        return result;
      };
      let rejectDeadline: (() => void) | undefined;
      const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = () => reject(timedOut());
        controller.signal.addEventListener('abort', rejectDeadline, { once: true });
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const dispose = (response: Response) => { void response.body?.cancel().catch(() => {}); };
      const request = async (fetcher: FetchLike, url: string, init: RequestInit, json: boolean, school: boolean) => {
        const response = await stage(() => fetcher(url, { ...init, signal: controller.signal,
          credentials: 'omit', cache: 'no-store', redirect: 'manual' }), dispose);
        if (!response || ![200, 201, ...(json ? [] : [204])].includes(response.status) || response.redirected) {
          if (response) dispose(response);
          if (school && response && [401, 403].includes(response.status)) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
          return unconfirmed();
        }
        try { return await stage(() => boundedResponse(response, controller.signal, check, json)); }
        finally { dispose(response); }
      };
      const operation = async (): Promise<TronClassAttachmentTransfer> => {
        const granted = await stage(() => dependencies.authorize(ownerKey, scope, controller.signal, input.revision));
        checkedAuthorization(granted, input, now());
        // Snapshot all identity/rule values before another async dependency runs.
        authorization = { ...granted, binding: { ...granted.binding, cookies: { ...granted.binding.cookies } },
          assignment: { ...granted.assignment, allowedContentTypes: [...granted.assignment.allowedContentTypes] } };
        const headers = tronClassSchoolWriteHeaders(authorization.binding);
        const claim: TronClassAttachmentClaim = Object.freeze({ ...scope, ownerKey, schoolId: 'pu',
          studentId: authorization.binding.userId, revision: input.revision,
          operationId: input.operationId, fileId: input.fileId, name: input.name,
          contentType: input.contentType, size: input.bytes.byteLength,
          sha256: createHash('sha256').update(input.bytes).digest('hex') });
        if (await stage(() => dependencies.claim(claim)) !== true) fail(409, 'TRONCLASS_UPLOAD_ALREADY_DISPATCHED');
        const metadata = buildTronClassUploadMetadata({ name: input.name, size: input.bytes.byteLength });
        const raw = await request(fetchSchool, `${SCHOOL_ORIGIN}${metadata.schoolPath}`,
          { method: metadata.method, headers, body: JSON.stringify(metadata.body) }, true, true);
        const evidence = targetEvidence(raw, input);
        const pinned = await stage(() => dependencies.resolveStorageTarget(evidence, claim));
        if (!pinned || !object(pinned) || Object.keys(pinned).some(key => !['uploadId', 'url', 'mode'].includes(key)) ||
          pinned.uploadId !== evidence.uploadId || pinned.url !== evidence.url || pinned.mode !== evidence.mode) return unconfirmed();
        const target = storageUrl(pinned.url);
        let body: ArrayBuffer = new ArrayBuffer(input.bytes.byteLength);
        new Uint8Array(body).set(input.bytes);
        let contentType = input.contentType;
        if (evidence.mode === 'multipart') {
          const form = new FormData();
          form.append('file', new Blob([body], { type: input.contentType }), input.name);
          // Encode once, preserving the generated boundary for both direct and
          // relay transports. String(FormData) is never a valid multipart body.
          const encoded = new Request('https://upload-body.invalid/', { method: 'PUT', body: form });
          body = await stage(() => encoded.arrayBuffer());
          contentType = encoded.headers.get('content-type') ?? '';
          if (!/^multipart\/form-data; boundary=/.test(contentType) || body.byteLength > input.bytes.byteLength + MAX_MULTIPART_OVERHEAD) return unconfirmed();
        }
        // Storage never receives school Cookie, CSRF, Authorization or Referer,
        // even when the object URL happens to share the school's origin.
        await request(fetchStorage, target, { method: 'PUT', body,
          headers: { 'Content-Type': contentType, 'Accept-Encoding': 'identity' } }, false, false);
        if (evidence.mode === 'raw') {
          const callback = buildTronClassUploadCallback(evidence.uploadId);
          await request(fetchSchool, `${SCHOOL_ORIGIN}${callback.schoolPath}`,
            { method: callback.method, headers, body: JSON.stringify(callback.body) }, false, true);
        }
        await guard();
        return { state: 'transferred', confirmation: 'awaiting-confirmation', ownerKey, uploadId: evidence.uploadId,
          ...scope, studentId: claim.studentId, revision: claim.revision, operationId: claim.operationId,
          fileId: claim.fileId, name: claim.name, contentType: claim.contentType, size: claim.size, sha256: claim.sha256 };
      };
      try { return await Promise.race([operation(), deadline]); }
      catch (error) {
        controller.abort();
        // Only our own fixed codes may escape; no upstream body, URL, Cookie,
        // filename or thrown dependency message is copied into an error.
        if (error instanceof NuniError && [
          'TRONCLASS_PROTOCOL_INVALID_INPUT', 'TRONCLASS_RECONNECT_REQUIRED', 'TRONCLASS_BINDING_CHANGED',
          'TRONCLASS_SUBMISSION_BLOCKED', 'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED', 'TRONCLASS_CANDIDATE_DISABLED',
          'TRONCLASS_CANDIDATE_TIMEOUT', 'TRONCLASS_UPLOAD_CANCELLED', 'TRONCLASS_UPLOAD_UNCONFIRMED',
          'TRONCLASS_UPLOAD_ALREADY_DISPATCHED',
        ].includes(error.code)) throw new NuniError(error.status, error.code);
        return unconfirmed();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (rejectDeadline) controller.signal.removeEventListener('abort', rejectDeadline);
        controller.abort();
      }
    },
  });
}
