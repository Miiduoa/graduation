import { createHash } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassAcknowledgedReadbackResult } from '@campus/shared/src/tronClassSubmissionConfirmation';
import { isTronClassAssignmentDetails } from '../tronClassAssignmentDetails';
import { createTronClassControlledSubmission, type TronClassControlledSubmissionDependencies } from './tronClassControlledSubmission';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import { createTronClassOperationReconciler } from './tronClassOperationReconcile';
import { createTronClassRawSubmissionHistoryReader } from './tronClassRawSubmissionHistory';
import { mapTronClassSubmissionConfirmation } from './tronClassSubmissionConfirmation';
import { tronClassFinalCandidateDigest, type TronClassFinalCandidateAttempt, type TronClassFinalCandidateInput } from './tronClassFinalSubmissionCandidate';
import { buildTronClassNewSubmission } from './tronClassSubmissionProtocol';
import { assertTronClassCandidateAuthorization, tronClassCandidateHeaders, type TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import {
  TRONCLASS_MAX_FILES, TRONCLASS_MAX_FILE_BYTES, TRONCLASS_MAX_TOTAL_BYTES,
  type TronClassPreparedSubmission, type TronClassSubmissionBindings, type TronClassSubmissionFirestore,
  type TronClassSubmissionResult, type TronClassUploadedAttachment,
} from './tronClassSubmission';
import type { TronClassAssignment, TronClassHomeworkScope, TronClassSubmissionBinding } from './tronClassSubmissionSource';

type OperationInput = TronClassHomeworkScope & { revision: string; operationId: string };
export type TronClassPublicUploadInput = OperationInput & {
  fileId: string; name: string; contentType: string; bytes: Uint8Array;
};
export type TronClassPublicSubmitInput = OperationInput & {
  content: string; attachments: string[]; confirmed: true;
};
export type TronClassPublicSubmissionResult = TronClassSubmissionResult | TronClassAcknowledgedReadbackResult;
export type TronClassPublicSubmissionService = {
  prepare(ownerKey: string, scope: TronClassHomeworkScope): Promise<TronClassPreparedSubmission>;
  upload(ownerKey: string, input: TronClassPublicUploadInput, signal?: AbortSignal): Promise<TronClassUploadedAttachment>;
  submit(ownerKey: string, input: TronClassPublicSubmitInput, signal?: AbortSignal): Promise<TronClassPublicSubmissionResult>;
  reconcile(ownerKey: string, input: { operationId: string; revision: string }): Promise<TronClassPublicSubmissionResult>;
};

export type TronClassPublicSubmissionDependencies = {
  db: TronClassSubmissionFirestore;
  bindings: TronClassSubmissionBindings;
  readonlyPrepare: TronClassPublicSubmissionService['prepare'];
  legacyReconcile(ownerKey: string, input: { operationId: string; revision: string }): Promise<TronClassSubmissionResult>;
  /** Explicit server-owned tenant evidence; neither an HTTP field nor an environment toggle. */
  contractVerified?: boolean;
  enabled?: () => boolean;
  authorization?: TronClassControlledSubmissionDependencies['authorize'];
  /** Independently verified attachment destination policy; not needed for text-only writes. */
  resolveStorageTarget?: TronClassControlledSubmissionDependencies['resolveStorageTarget'];
  /** Owner is explicit. Each controlled candidate closes over this request's owner. */
  readHistory?: ReturnType<typeof createTronClassRawSubmissionHistoryReader>;
  fetchSchool?: TronClassControlledSubmissionDependencies['fetchSchool'];
  fetchStorage?: TronClassControlledSubmissionDependencies['fetchStorage'];
  now?: () => number;
};

const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;
const REVISION = /^[a-f0-9]{32}$/;
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function invalid(): never { return fail(400, 'TRONCLASS_INVALID_INPUT'); }
function unavailable(): never { return fail(503, 'TRONCLASS_SUBMISSION_UNAVAILABLE'); }
function conflict(): never { return fail(409, 'TRONCLASS_OPERATION_CONFLICT'); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function ownerAndScope(ownerKey: string, scope: TronClassHomeworkScope) {
  if (typeof ownerKey !== 'string' || !ownerKey || ownerKey.length > 200 ||
    !record(scope) || !positiveId(scope.courseId) || !positiveId(scope.homeworkId)) invalid();
}
function operation(ownerKey: string, input: OperationInput) {
  ownerAndScope(ownerKey, input);
  if (typeof input.revision !== 'string' || !REVISION.test(input.revision) ||
    typeof input.operationId !== 'string' || !TOKEN.test(input.operationId)) invalid();
}
function instant(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}
function assignmentShape(assignment: TronClassAssignment) {
  if (!assignment || typeof assignment.title !== 'string' || !assignment.title.trim() || assignment.title.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(assignment.title) || typeof assignment.description !== 'string' || assignment.description.length > 20_000 ||
    !['permissionKnown', 'individual', 'canSubmit', 'isClosed', 'allowLate', 'allowsText', 'allowsAttachments']
      .every(key => typeof assignment[key as keyof TronClassAssignment] === 'boolean') ||
    (assignment.deadline !== null && !instant(assignment.deadline)) || (assignment.opensAt !== null && !instant(assignment.opensAt)) ||
    !['maxFiles', 'maxFileBytes', 'maxTotalBytes'].every(key => {
      const value = assignment[key as 'maxFiles' | 'maxFileBytes' | 'maxTotalBytes'];
      return Number.isSafeInteger(value) && value >= 0;
    }) || (assignment.remainingAttempts !== null && (!Number.isSafeInteger(assignment.remainingAttempts) || assignment.remainingAttempts < 0)) ||
    !Array.isArray(assignment.allowedContentTypes) || assignment.allowedContentTypes.length > 50 ||
    !Array.from(assignment.allowedContentTypes).every(type => typeof type === 'string' && type.length <= 100 && MIME.test(type)) ||
    (assignment.details !== undefined && !isTronClassAssignmentDetails(assignment.details))) unavailable();
}

/**
 * Public DTO adapter for the existing v2 journal/candidates. The production
 * factory supplies neither tenant authorization nor a storage policy, and its
 * contractVerified remains false. A runtime flag alone cannot enable this path.
 * No v2 upload/final call ever passes through the legacy v1 writer or receipt parser.
 */
export function createTronClassPublicSubmissionService(dependencies: TronClassPublicSubmissionDependencies): TronClassPublicSubmissionService {
  const { db, bindings, readonlyPrepare, legacyReconcile, now = Date.now } = dependencies;
  const authorization = dependencies.authorization;
  const resolveStorageTarget = dependencies.resolveStorageTarget;
  const attachmentsConfigured = typeof resolveStorageTarget === 'function';
  const contractVerified = dependencies.contractVerified === true;
  const runtimeEnabled = dependencies.enabled ?? (() => false);
  const readHistory = dependencies.readHistory ?? createTronClassRawSubmissionHistoryReader({ bindings, now });
  const journal = createTronClassControlledJournal({ db, bindings, now });
  const reconcile = createTronClassOperationReconciler({ db, bindings, legacyReconcile, readHistory, now });
  const enabled = () => runtimeEnabled() === true && contractVerified &&
    typeof authorization === 'function';
  const guardWrites = () => {
    if (runtimeEnabled() !== true) fail(503, 'TRONCLASS_WRITES_DISABLED');
    if (!contractVerified || typeof authorization !== 'function') unavailable();
  };
  const guardAttachmentWrites = () => {
    guardWrites();
    if (!attachmentsConfigured) unavailable();
  };
  async function current(ownerKey: string, revision: string, studentId?: number): Promise<TronClassSubmissionBinding> {
    const binding = await bindings.requireBinding(ownerKey);
    const at = now();
    if (!binding || binding.schoolId !== 'pu' || !positiveId(binding.userId) || binding.revision !== revision ||
      (studentId !== undefined && binding.userId !== studentId)) fail(409, 'TRONCLASS_BINDING_CHANGED');
    if (!Number.isFinite(at) || !instant(binding.expiresAt) || Date.parse(binding.expiresAt) <= at) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
    await bindings.assertCurrent(ownerKey, revision);
    return binding;
  }
  function controlled(ownerKey: string) {
    guardWrites();
    return createTronClassControlledSubmission({
      db, bindings, enabled, authorize: authorization!, resolveStorageTarget,
      readHistory: (binding, scope, signal) => readHistory(ownerKey, binding, scope, signal),
      fetchSchool: dependencies.fetchSchool, fetchStorage: dependencies.fetchStorage, now,
    });
  }
  function blockedReason(): string | null {
    if (runtimeEnabled() !== true) return '目前暫停站內作業繳交，你仍可查看作業說明。';
    if (!enabled()) return '此學校目前尚未開放在 nuni 繳交，請使用 TronClass 作業頁。';
    return null;
  }
  async function assertAttemptInput(ownerKey: string, input: TronClassFinalCandidateInput, attempt: TronClassFinalCandidateAttempt) {
    let files;
    try {
      files = await journal.readUploadedFiles(ownerKey, { courseId: input.courseId, homeworkId: input.homeworkId,
        revision: input.revision, operationId: input.operationId, fileIds: [...input.fileIds] });
    } catch (error) {
      if (error instanceof NuniError && error.code === 'TRONCLASS_UPLOAD_UNCONFIRMED') return conflict();
      throw error;
    }
    const request = buildTronClassNewSubmission({ activityId: input.homeworkId, content: input.content,
      uploadIds: files.map(file => file.uploadId) });
    // Compare the exact wire payload against the immutable original baseline.
    // Fresh authorization may now report a used attempt or a closed assignment.
    const payload = { ...attempt, comment: request.body.comment as string,
      uploads: files.map(file => ({ id: file.uploadId, name: file.name, size: file.size })) };
    if (tronClassFinalCandidateDigest(payload) !== attempt.payloadDigest) conflict();
  }
  return {
    async prepare(ownerKey, input) {
      ownerAndScope(ownerKey, input);
      if (Object.keys(input).some(key => !['courseId', 'homeworkId'].includes(key))) invalid();
      const scope = Object.freeze({ courseId: input.courseId, homeworkId: input.homeworkId });
      const base = structuredClone(await readonlyPrepare(ownerKey, scope));
      if (!base || base.source !== 'tronclass' || base.schoolId !== 'pu' || base.courseId !== scope.courseId ||
        base.homeworkId !== scope.homeworkId || typeof base.revision !== 'string' || !REVISION.test(base.revision)) unavailable();
      const binding = await current(ownerKey, base.revision);
      // Project the existing read-only DTO explicitly; do not spread provider data.
      const preparation: TronClassPreparedSubmission = {
        source: 'tronclass', schoolId: 'pu', ...scope, revision: base.revision,
        title: base.title, description: base.description, deadline: base.deadline,
        canSubmit: false, blockedReason: blockedReason(), maxFiles: base.maxFiles, maxFileBytes: base.maxFileBytes,
        allowedContentTypes: [...base.allowedContentTypes], rules: base.rules, receipt: base.receipt,
        ...(base.details === undefined ? {} : { details: base.details }), ...(base.history === undefined ? {} : { history: base.history }),
      };
      if (preparation.blockedReason) return preparation;
      const granted: TronClassCandidateAuthorization = structuredClone(await authorization!(ownerKey, scope));
      await current(ownerKey, base.revision, binding.userId);
      if (!granted?.binding || granted.binding.revision !== base.revision || granted.binding.userId !== binding.userId ||
        granted.binding.schoolId !== binding.schoolId) fail(409, 'TRONCLASS_BINDING_CHANGED');
      if (!granted.assignment || granted.assignment.courseId !== scope.courseId || granted.assignment.homeworkId !== scope.homeworkId ||
        granted.assignment.studentId !== binding.userId) conflict();
      assignmentShape(granted.assignment);
      const allowsAttachments = attachmentsConfigured && granted.assignment.allowsAttachments;
      let reason = blockedReason();
      if (!reason) {
        try {
          assertTronClassCandidateAuthorization(granted, scope, now(), false);
          tronClassCandidateHeaders(granted.binding);
          if (!granted.assignment.allowsText && (!allowsAttachments || granted.assignment.maxFiles === 0 ||
            granted.assignment.maxFileBytes === 0 || granted.assignment.maxTotalBytes === 0)) fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
        } catch (error) {
          if (error instanceof NuniError && error.code === 'TRONCLASS_SUBMISSION_BLOCKED') {
            reason = '這份作業目前不符合站內繳交條件，請重新讀取或至 TronClass 查看。';
          } else if (error instanceof NuniError && error.code === 'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED') {
            reason = '尚無法確認校方送交驗證，請重新連線或使用 TronClass 作業頁。';
          } else throw error;
        }
      }
      const assignment = granted.assignment;
      await current(ownerKey, base.revision, binding.userId);
      reason = blockedReason() ?? reason;
      return {
        ...preparation, title: assignment.title, description: assignment.description, deadline: assignment.deadline,
        canSubmit: reason === null, blockedReason: reason, receipt: null,
        maxFiles: allowsAttachments ? Math.min(assignment.maxFiles, TRONCLASS_MAX_FILES) : 0,
        maxFileBytes: allowsAttachments ? Math.min(assignment.maxFileBytes, TRONCLASS_MAX_FILE_BYTES) : 0,
        allowedContentTypes: allowsAttachments ? [...assignment.allowedContentTypes] : [],
        rules: assignment.permissionKnown ? { status: 'confirmed', allowsText: assignment.allowsText,
          allowsAttachments, maxTotalBytes: allowsAttachments ? Math.min(assignment.maxTotalBytes, TRONCLASS_MAX_TOTAL_BYTES) : 0 } : { status: 'unknown' },
        // An authorizer can observe newer rules than the earlier read-only call.
        // Missing fresh observations must not revive that earlier detail snapshot.
        details: assignment.details === undefined ? { status: 'unavailable' } : structuredClone(assignment.details),
      };
    },
    async upload(ownerKey, rawInput, signal) {
      operation(ownerKey, rawInput);
      if (Object.keys(rawInput).some(key => !['courseId', 'homeworkId', 'revision', 'operationId', 'fileId', 'name', 'contentType', 'bytes'].includes(key)) ||
        typeof rawInput.fileId !== 'string' || !TOKEN.test(rawInput.fileId) || typeof rawInput.name !== 'string' || !rawInput.name ||
        rawInput.name.length > 200 || /[\u0000-\u001f\u007f\\/]/.test(rawInput.name) ||
        typeof rawInput.contentType !== 'string' || rawInput.contentType.length > 100 || !MIME.test(rawInput.contentType) ||
        !(rawInput.bytes instanceof Uint8Array) || !rawInput.bytes.byteLength || rawInput.bytes.byteLength > TRONCLASS_MAX_FILE_BYTES) invalid();
      guardAttachmentWrites();
      const input = { ...rawInput, bytes: Uint8Array.from(rawInput.bytes) };
      const digest = createHash('sha256').update(input.bytes).digest('hex');
      const transfer = await controlled(ownerKey).upload(ownerKey, input, signal);
      await current(ownerKey, input.revision, transfer.studentId);
      if (transfer.state !== 'transferred' || transfer.confirmation !== 'awaiting-confirmation' ||
        transfer.ownerKey !== ownerKey || transfer.revision !== input.revision || transfer.operationId !== input.operationId ||
        transfer.courseId !== input.courseId || transfer.homeworkId !== input.homeworkId || transfer.fileId !== input.fileId ||
        transfer.name !== input.name || transfer.contentType !== input.contentType || transfer.size !== input.bytes.byteLength ||
        transfer.sha256 !== digest || !positiveId(transfer.uploadId)) conflict();
      // controlled.upload resolves only after the exact transfer is durably saved.
      return { fileId: transfer.fileId, name: transfer.name, contentType: transfer.contentType,
        size: transfer.size, sha256: transfer.sha256, status: 'uploaded' };
    },
    async submit(ownerKey, rawInput, signal) {
      operation(ownerKey, rawInput);
      if (Object.keys(rawInput).some(key => !['courseId', 'homeworkId', 'revision', 'operationId', 'content', 'attachments', 'confirmed'].includes(key)) ||
        rawInput.confirmed !== true || typeof rawInput.content !== 'string' || rawInput.content.length > 20_000 ||
        !Array.isArray(rawInput.attachments) || rawInput.attachments.length > TRONCLASS_MAX_FILES ||
        !Array.from(rawInput.attachments).every(value => typeof value === 'string' && TOKEN.test(value)) ||
        new Set(rawInput.attachments).size !== rawInput.attachments.length || (!rawInput.content.trim() && rawInput.attachments.length === 0)) invalid();
      if (rawInput.attachments.length > 0) guardAttachmentWrites();
      const input = { courseId: rawInput.courseId, homeworkId: rawInput.homeworkId, revision: rawInput.revision,
        operationId: rawInput.operationId, content: rawInput.content, fileIds: [...rawInput.attachments] };
      const candidate = controlled(ownerKey);
      const unknown = (): TronClassSubmissionResult => ({ status: 'unknown', operationId: input.operationId, receipt: null });
      try {
        const result = await candidate.dispatch(ownerKey, input, signal);
        const binding = await current(ownerKey, input.revision);
        if (result.operationId !== input.operationId) conflict();
        if (result.state !== 'verified-new-version') return unknown();
        const attempt = await journal.readAttempt(ownerKey, input.operationId);
        if (!attempt || attempt.courseId !== input.courseId || attempt.homeworkId !== input.homeworkId ||
          attempt.revision !== input.revision || attempt.studentId !== binding.userId) conflict();
        const confirmed = mapTronClassSubmissionConfirmation(ownerKey, attempt, result);
        await current(ownerKey, input.revision, binding.userId);
        return confirmed;
      } catch (error) {
        // A durable final claim survives failed responses, policy changes and
        // process restarts. Never retry dispatch or release its lock here.
        if (!(error instanceof NuniError) || ![
          'TRONCLASS_CANDIDATE_TIMEOUT', 'TRONCLASS_CANDIDATE_UNCONFIRMED', 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED',
          'TRONCLASS_CANDIDATE_DISABLED', 'TRONCLASS_CANDIDATE_CSRF_UNVERIFIED', 'TRONCLASS_SUBMISSION_BLOCKED',
        ].includes(error.code)) throw error;
        const attempt = await journal.readAttempt(ownerKey, input.operationId);
        if (!attempt) throw error;
        if (attempt.courseId !== input.courseId || attempt.homeworkId !== input.homeworkId || attempt.revision !== input.revision) conflict();
        // A changed school permission can reject before candidate.claim checks
        // its digest. Never attribute a different draft to this original attempt.
        await assertAttemptInput(ownerKey, input, attempt);
        await current(ownerKey, input.revision, attempt.studentId);
        return unknown();
      }
    },
    reconcile,
  };
}
