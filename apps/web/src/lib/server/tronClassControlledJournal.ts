import { createHash } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import {
  TRONCLASS_MAX_FILES, TRONCLASS_MAX_TOTAL_BYTES, TRONCLASS_SUBMISSION_COLLECTION,
  TRONCLASS_SUBMISSION_LOCK_COLLECTION, type TronClassSubmissionBindings,
  type TronClassSubmissionFirestore, type TronClassSubmissionTransaction,
} from './tronClassSubmission';
import { buildTronClassUploadMetadata } from './tronClassSubmissionProtocol';
import type { TronClassAttachmentClaim, TronClassAttachmentTransfer } from './tronClassAttachmentCandidate';
import {
  tronClassFinalCandidateDigest, type TronClassCandidateUploadedFile,
  type TronClassFinalCandidateAttempt, type TronClassFinalCandidateClaim,
  type TronClassFinalCandidateInput,
} from './tronClassFinalSubmissionCandidate';

const VERSION = 2;
const CANDIDATE = 'controlled-tronclass-v1';
const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;
const REVISION = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
type Data = Record<string, unknown>;
type Snapshot = { exists: boolean; data(): Data | undefined };
type Acknowledgment = NonNullable<TronClassFinalCandidateAttempt['acknowledgment']>;
type BindingIdentity = { schoolId: 'pu'; revision: string; userId: number; expiresAt: number };
type Scope = { ownerKey: string; studentId: number; revision: string; operationId: string; courseId: number; homeworkId: number };
type JournalFile = {
  fileId: string; name: string; contentType: string; size: number; sha256: string;
  state: 'claimed' | 'transferred'; uploadId: number | null;
};
type Operation = Scope & {
  version: 2; candidate: typeof CANDIDATE; schoolId: 'pu';
  state: 'preparing' | 'final-claimed' | 'acknowledged';
  files: JournalFile[]; attempt: TronClassFinalCandidateClaim | null; acknowledgment: Acknowledgment | null;
  createdAt: number; updatedAt: number; purgeAt: null;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function invalid(): never { return fail(400, 'TRONCLASS_PROTOCOL_INVALID_INPUT'); }
function conflict(): never { return fail(409, 'TRONCLASS_OPERATION_CONFLICT'); }
function unavailable(): never { return fail(503, 'TRONCLASS_JOURNAL_UNAVAILABLE'); }
function object(value: unknown): value is Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function owner(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 200 ||
    !/^(?:platform:pa_[A-Za-z0-9_-]+|firebase:[^\s/\x00-\x1f\x7f]{1,128})$/.test(value)) invalid();
}
function operationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !TOKEN.test(value)) invalid();
}
function timestamp(now: () => number): number {
  const result = now();
  if (!Number.isSafeInteger(result) || result < 0 || !Number.isFinite(new Date(result).getTime())) unavailable();
  return result;
}
function scope(value: Scope): void {
  owner(value?.ownerKey);
  operationId(value?.operationId);
  if (!positiveId(value.studentId) || !positiveId(value.courseId) || !positiveId(value.homeworkId) ||
    typeof value.revision !== 'string' || !REVISION.test(value.revision)) invalid();
}
function sameScope(left: Scope, right: Scope): boolean {
  return ['ownerKey', 'studentId', 'courseId', 'homeworkId', 'revision', 'operationId']
    .every(key => left[key as keyof Scope] === right[key as keyof Scope]);
}
function fileFields(value: Pick<JournalFile, 'fileId' | 'name' | 'size' | 'contentType' | 'sha256'>): void {
  operationId(value?.fileId);
  buildTronClassUploadMetadata({ name: value.name, size: value.size });
  if (typeof value.sha256 !== 'string' || !HASH.test(value.sha256) ||
    typeof value.contentType !== 'string' || value.contentType.length > 100 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value.contentType)) invalid();
}
function sameFile(left: JournalFile, right: Pick<JournalFile, 'fileId' | 'name' | 'size' | 'contentType' | 'sha256'>): boolean {
  return ['fileId', 'name', 'size', 'contentType', 'sha256'].every(key => left[key as keyof JournalFile] === right[key as keyof typeof right]);
}
function attachmentClaim(value: TronClassAttachmentClaim): TronClassAttachmentClaim {
  if (!object(value) || Object.keys(value).some(key => ![
    'ownerKey', 'schoolId', 'studentId', 'courseId', 'homeworkId', 'revision', 'operationId',
    'fileId', 'name', 'size', 'contentType', 'sha256',
  ].includes(key)) || value.schoolId !== 'pu') invalid();
  scope(value);
  fileFields(value);
  return structuredClone(value);
}
function finalClaim(value: TronClassFinalCandidateClaim): TronClassFinalCandidateClaim {
  if (!object(value) || Object.keys(value).some(key => ![
    'ownerKey', 'studentId', 'courseId', 'homeworkId', 'revision', 'operationId',
    'payloadDigest', 'comment', 'uploads', 'priorSubmissionIds', 'priorHistoryComplete',
  ].includes(key))) invalid();
  scope(value);
  if (typeof value.payloadDigest !== 'string' || !HASH.test(value.payloadDigest) ||
    typeof value.comment !== 'string' || value.comment.length > 120_000 ||
    value.priorHistoryComplete !== true || !Array.isArray(value.priorSubmissionIds) || value.priorSubmissionIds.length !== 0 ||
    !Array.isArray(value.uploads) || value.uploads.length > TRONCLASS_MAX_FILES ||
    (!value.comment.trim() && value.uploads.length === 0)) invalid();
  for (const upload of Array.from(value.uploads)) {
    if (!object(upload) || Object.keys(upload).some(key => !['id', 'name', 'size'].includes(key)) || !positiveId(upload.id)) invalid();
    buildTronClassUploadMetadata({ name: upload.name, size: upload.size });
  }
  if (new Set(value.uploads.map(file => file.id)).size !== value.uploads.length ||
    value.uploads.reduce((sum, file) => sum + file.size, 0) > TRONCLASS_MAX_TOTAL_BYTES ||
    tronClassFinalCandidateDigest(value) !== value.payloadDigest) conflict();
  // comment is ALREADY the request builder's escaped canonical value. Never
  // re-escape it or turn the source's rich HTML into a different digest here.
  return structuredClone(value);
}
function acknowledgment(value: Acknowledgment, attempt: TronClassFinalCandidateClaim): Acknowledgment {
  if (!object(value) || Object.keys(value).some(key => !['state', 'submissionId', 'courseId', 'activityId', 'studentId'].includes(key)) ||
    value.state !== 'acknowledged' || !positiveId(value.submissionId) ||
    value.courseId !== attempt.courseId || value.activityId !== attempt.homeworkId || value.studentId !== attempt.studentId ||
    attempt.priorSubmissionIds.includes(value.submissionId)) conflict();
  return { state: 'acknowledged', submissionId: value.submissionId, courseId: value.courseId,
    activityId: value.activityId, studentId: value.studentId };
}

function readOperation(snapshot: Snapshot, ownerKey: string, id: string): Operation | null {
  if (!snapshot.exists) return null;
  const row = snapshot.data();
  // The legacy service owns version 1 in the SAME operation namespace. Never
  // migrate, reset or overwrite one of its uncertain attempts implicitly.
  if (!object(row) || row.version !== VERSION || row.candidate !== CANDIDATE || row.schoolId !== 'pu' ||
    row.ownerKey !== ownerKey || row.operationId !== id || row.purgeAt !== null ||
    !['preparing', 'final-claimed', 'acknowledged'].includes(String(row.state)) ||
    !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.updatedAt) ||
    Number(row.createdAt) < 0 || Number(row.updatedAt) < Number(row.createdAt) ||
    !Array.isArray(row.files) || row.files.length > TRONCLASS_MAX_FILES) conflict();
  try {
    const operation = row as unknown as Operation;
    scope(operation);
    for (const file of Array.from(operation.files)) {
      if (!object(file)) conflict();
      fileFields(file);
      if ((file.state === 'claimed' && file.uploadId !== null) ||
        (file.state === 'transferred' && !positiveId(file.uploadId)) ||
        !['claimed', 'transferred'].includes(file.state)) conflict();
    }
    if (new Set(operation.files.map(file => file.fileId)).size !== operation.files.length ||
      new Set(operation.files.filter(file => file.state === 'transferred').map(file => file.uploadId)).size !==
        operation.files.filter(file => file.state === 'transferred').length ||
      operation.files.reduce((sum, file) => sum + file.size, 0) > TRONCLASS_MAX_TOTAL_BYTES) conflict();
    if (operation.state === 'preparing') {
      if (operation.attempt !== null || operation.acknowledgment !== null) conflict();
    } else {
      const attempt = finalClaim(operation.attempt!);
      if (!sameScope(operation, attempt)) conflict();
      verifyFiles(operation, attempt.uploads);
      if (operation.state === 'final-claimed' && operation.acknowledgment !== null) conflict();
      if (operation.state === 'acknowledged') acknowledgment(operation.acknowledgment!, attempt);
    }
    return structuredClone(operation);
  } catch { return conflict(); }
}

function verifyFiles(operation: Operation, uploads: TronClassFinalCandidateClaim['uploads']) {
  if (operation.files.length !== uploads.length || operation.files.some(file => file.state !== 'transferred' ||
    !uploads.some(upload => upload.id === file.uploadId && upload.name === file.name && upload.size === file.size))) {
    fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
  }
}
function newOperation(value: Scope, at: number): Operation {
  return { version: VERSION, candidate: CANDIDATE, schoolId: 'pu',
    ownerKey: value.ownerKey, studentId: value.studentId, courseId: value.courseId, homeworkId: value.homeworkId,
    revision: value.revision, operationId: value.operationId, state: 'preparing', files: [],
    attempt: null, acknowledgment: null, createdAt: at, updatedAt: at, purgeAt: null };
}
function uploadedFile(operation: Operation, file: JournalFile): TronClassCandidateUploadedFile {
  if (file.state !== 'transferred' || !positiveId(file.uploadId)) fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
  return { ownerKey: operation.ownerKey, studentId: operation.studentId, courseId: operation.courseId,
    homeworkId: operation.homeworkId, revision: operation.revision, operationId: operation.operationId,
    fileId: file.fileId, uploadId: file.uploadId, name: file.name, size: file.size,
    contentType: file.contentType, sha256: file.sha256, state: 'transferred' };
}
function matchingLock(snapshot: Snapshot, attempt: TronClassFinalCandidateClaim, state: Operation['state']): Data {
  const row = snapshot.data();
  if (!snapshot.exists || !object(row) || row.version !== VERSION || row.candidate !== CANDIDATE ||
    row.schoolId !== 'pu' || !sameScope(row as unknown as Scope, attempt) || row.payloadDigest !== attempt.payloadDigest ||
    row.purgeAt !== null || row.state !== (state === 'acknowledged' ? 'acknowledged' : 'submitting')) conflict();
  return row;
}

/**
 * Real Firestore transaction journal for controlled candidates. It deliberately
 * shares legacy operation IDs and school-task locks, but cannot enable writes or
 * attest a production contract. Every unresolved record has purgeAt:null: neither
 * a process restart nor TTL expiry may turn an uncertain write into a new one.
 */
export function createTronClassControlledJournal({ db, bindings, now = Date.now }: {
  db: TronClassSubmissionFirestore;
  bindings: TronClassSubmissionBindings;
  now?: () => number;
}) {
  const operationRef = (ownerKey: string, id: string) => db.doc(`${TRONCLASS_SUBMISSION_COLLECTION}/${hash(JSON.stringify([ownerKey, id]))}`);
  const lockRef = (value: Pick<Scope, 'studentId' | 'courseId' | 'homeworkId'>) =>
    db.doc(`${TRONCLASS_SUBMISSION_LOCK_COLLECTION}/${hash(JSON.stringify(['pu', value.studentId, value.courseId, value.homeworkId]))}`);
  async function current<T>(ownerKey: string, expectedRevision: string | undefined,
    run: (tx: TronClassSubmissionTransaction, binding: BindingIdentity, at: number) => Promise<T>): Promise<T> {
    owner(ownerKey);
    try {
      const raw = await bindings.requireBinding(ownerKey);
      const binding: BindingIdentity = { schoolId: raw?.schoolId, revision: raw?.revision,
        userId: raw?.userId, expiresAt: Date.parse(raw?.expiresAt) };
      const at = timestamp(now);
      if (!binding || binding.schoolId !== 'pu' || !positiveId(binding.userId) ||
        typeof binding.revision !== 'string' || !REVISION.test(binding.revision) ||
        !Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= at) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      if (expectedRevision !== undefined && binding.revision !== expectedRevision) fail(409, 'TRONCLASS_BINDING_CHANGED');
      const result = await db.runTransaction(async tx => {
        // Same read set as the credential lifecycle barrier. Firestore retries
        // this transaction if disconnect, rebind or closure changes the record.
        const snapshot = await tx.get(db.doc(`_tronClassBindings/${hash(ownerKey)}`));
        const row = snapshot.data();
        const instant = timestamp(now);
        if (!snapshot.exists || row?.state === 'closed' || row?.state === 'disconnected') fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        if (row?.ownerKey !== ownerKey || row.schoolId !== 'pu' || row.state !== 'connected' ||
          row.revision !== binding.revision || row.userId !== binding.userId || row.expiresAt !== binding.expiresAt) {
          fail(409, 'TRONCLASS_BINDING_CHANGED');
        }
        if (!(Number(row.expiresAt) > instant)) fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
        return run(tx, binding, instant);
      });
      await bindings.assertCurrent(ownerKey, binding.revision);
      return result;
    } catch (error) {
      if (error instanceof NuniError && [
        'TRONCLASS_PROTOCOL_INVALID_INPUT', 'TRONCLASS_OPERATION_CONFLICT', 'TRONCLASS_UPLOAD_UNCONFIRMED',
        'TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED', 'TRONCLASS_FILE_LIMIT_EXCEEDED',
      ].includes(error.code)) throw new NuniError(error.status, error.code);
      return unavailable();
    }
  }

  return Object.freeze({
    contractVerified: false as const,
    async claimAttachment(value: TronClassAttachmentClaim): Promise<boolean> {
      const input = attachmentClaim(value);
      return current(input.ownerKey, input.revision, async (tx, binding, at) => {
        if (binding.userId !== input.studentId) conflict();
        const ref = operationRef(input.ownerKey, input.operationId);
        const operation = readOperation(await tx.get(ref), input.ownerKey, input.operationId) ?? newOperation(input, at);
        const lock = await tx.get(lockRef(input));
        if (!sameScope(operation, input)) conflict();
        if (operation.state !== 'preparing' || lock.exists) return false;
        const existing = operation.files.find(file => file.fileId === input.fileId);
        if (existing) { if (!sameFile(existing, input)) conflict(); return false; }
        if (operation.files.length >= TRONCLASS_MAX_FILES ||
          operation.files.reduce((sum, file) => sum + file.size, input.size) > TRONCLASS_MAX_TOTAL_BYTES) {
          fail(413, 'TRONCLASS_FILE_LIMIT_EXCEEDED');
        }
        const file: JournalFile = { fileId: input.fileId, name: input.name, contentType: input.contentType,
          size: input.size, sha256: input.sha256, state: 'claimed', uploadId: null };
        tx.set(ref, { ...operation, files: [...operation.files, file], updatedAt: Math.max(operation.updatedAt, at) });
        return true;
      });
    },
    async storeTransferredFile(value: TronClassAttachmentTransfer): Promise<void> {
      if (!object(value) || value.state !== 'transferred' || value.confirmation !== 'awaiting-confirmation' ||
        !positiveId(value.uploadId) || Object.keys(value).some(key => ![
          'state', 'confirmation', 'ownerKey', 'uploadId', 'courseId', 'homeworkId', 'studentId',
          'revision', 'operationId', 'fileId', 'name', 'contentType', 'size', 'sha256',
        ].includes(key))) invalid();
      scope(value);
      fileFields(value);
      const input = structuredClone(value);
      await current(input.ownerKey, input.revision, async (tx, binding, at) => {
        if (binding.userId !== input.studentId) conflict();
        const ref = operationRef(input.ownerKey, input.operationId);
        const operation = readOperation(await tx.get(ref), input.ownerKey, input.operationId);
        const lock = await tx.get(lockRef(input));
        if (!operation || !sameScope(operation, input) || operation.state !== 'preparing' || lock.exists) conflict();
        const file = operation.files.find(file => file.fileId === input.fileId);
        if (!file || !sameFile(file, input) || operation.files.some(other => other.fileId !== input.fileId && other.uploadId === input.uploadId)) conflict();
        if (file.state === 'transferred') { if (file.uploadId !== input.uploadId) conflict(); return; }
        tx.set(ref, { ...operation, files: operation.files.map(current => current.fileId === input.fileId
          ? { ...current, state: 'transferred', uploadId: input.uploadId } : current), updatedAt: Math.max(operation.updatedAt, at) });
      });
    },
    async readUploadedFiles(ownerKey: string, value: Omit<TronClassFinalCandidateInput, 'content'>): Promise<TronClassCandidateUploadedFile[]> {
      owner(ownerKey);
      if (!object(value) || Object.keys(value).some(key => !['courseId', 'homeworkId', 'revision', 'operationId', 'fileIds'].includes(key)) ||
        !positiveId(value.courseId) || !positiveId(value.homeworkId) || typeof value.revision !== 'string' || !REVISION.test(value.revision) ||
        !Array.isArray(value.fileIds) || value.fileIds.length > TRONCLASS_MAX_FILES ||
        !Array.from(value.fileIds).every(id => typeof id === 'string' && TOKEN.test(id)) || new Set(value.fileIds).size !== value.fileIds.length) invalid();
      operationId(value.operationId);
      const input = structuredClone(value);
      return current(ownerKey, input.revision, async (tx, binding) => {
        const operation = readOperation(await tx.get(operationRef(ownerKey, input.operationId)), ownerKey, input.operationId);
        if (!operation && input.fileIds.length === 0) return [];
        if (!operation || !sameScope(operation, { ...input, ownerKey, studentId: binding.userId }) ||
          operation.files.length !== input.fileIds.length || operation.files.some(file => file.state !== 'transferred' || !input.fileIds.includes(file.fileId))) {
          fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
        }
        return input.fileIds.map(id => uploadedFile(operation, operation.files.find(file => file.fileId === id)!));
      });
    },
    async claimFinal(value: TronClassFinalCandidateClaim): Promise<boolean> {
      const attempt = finalClaim(value);
      return current(attempt.ownerKey, attempt.revision, async (tx, binding, at) => {
        if (binding.userId !== attempt.studentId) conflict();
        const ref = operationRef(attempt.ownerKey, attempt.operationId);
        const operation = readOperation(await tx.get(ref), attempt.ownerKey, attempt.operationId) ?? newOperation(attempt, at);
        const lock = lockRef(attempt);
        const previousLock = await tx.get(lock);
        if (!sameScope(operation, attempt)) conflict();
        if (operation.state !== 'preparing') {
          if (operation.attempt?.payloadDigest !== attempt.payloadDigest) conflict();
          return false;
        }
        // Any existing legacy or candidate slot blocks this first-release flow.
        // No owner, status, receipt or operation ID from another account escapes.
        if (previousLock.exists) return false;
        verifyFiles(operation, attempt.uploads);
        tx.set(ref, { ...operation, state: 'final-claimed', attempt, acknowledgment: null,
          updatedAt: Math.max(operation.updatedAt, at), purgeAt: null });
        tx.set(lock, { version: VERSION, candidate: CANDIDATE, schoolId: 'pu', ownerKey: attempt.ownerKey,
          studentId: attempt.studentId, courseId: attempt.courseId, homeworkId: attempt.homeworkId,
          revision: attempt.revision, operationId: attempt.operationId, state: 'submitting',
          payloadDigest: attempt.payloadDigest, updatedAt: at, purgeAt: null });
        return true;
      });
    },
    async rememberAcknowledgment(value: TronClassFinalCandidateClaim, raw: Acknowledgment): Promise<void> {
      const attempt = finalClaim(value);
      const ack = acknowledgment(raw, attempt);
      await current(attempt.ownerKey, attempt.revision, async (tx, binding, at) => {
        if (binding.userId !== attempt.studentId) conflict();
        const ref = operationRef(attempt.ownerKey, attempt.operationId);
        const operation = readOperation(await tx.get(ref), attempt.ownerKey, attempt.operationId);
        const lock = lockRef(attempt);
        const savedLock = await tx.get(lock);
        if (!operation || !sameScope(operation, attempt) || operation.attempt?.payloadDigest !== attempt.payloadDigest || operation.state === 'preparing') conflict();
        const lockData = matchingLock(savedLock, attempt, operation.state);
        if (operation.acknowledgment) {
          if (operation.acknowledgment.submissionId !== ack.submissionId) conflict();
          return;
        }
        tx.set(ref, { ...operation, state: 'acknowledged', acknowledgment: ack,
          updatedAt: Math.max(operation.updatedAt, at), purgeAt: null });
        tx.set(lock, { ...lockData, state: 'acknowledged', updatedAt: at, purgeAt: null });
      });
    },
    async readAttempt(ownerKey: string, id: string): Promise<TronClassFinalCandidateAttempt | null> {
      owner(ownerKey);
      operationId(id);
      return current(ownerKey, undefined, async (tx, binding) => {
        const operation = readOperation(await tx.get(operationRef(ownerKey, id)), ownerKey, id);
        if (!operation) return null;
        if (operation.studentId !== binding.userId) conflict();
        if (!operation.attempt) return null;
        // Read-only recovery may use a fresh connection for the SAME verified
        // student. It never updates the old revision, claim or acknowledged ID.
        matchingLock(await tx.get(lockRef(operation)), operation.attempt, operation.state);
        return structuredClone({ ...operation.attempt, acknowledgment: operation.acknowledgment });
      });
    },
  });
}
