import { createHash } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import type {
  TronClassAssignment, TronClassHomeworkScope, TronClassSourceReceipt,
  TronClassSubmissionBinding, TronClassSubmissionSource,
} from './tronClassSubmissionSource';

export const TRONCLASS_SUBMISSION_COLLECTION = '_tronClassSubmissionOperations';
export const TRONCLASS_SUBMISSION_LOCK_COLLECTION = '_tronClassSubmissionLocks';
export const TRONCLASS_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TRONCLASS_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const TRONCLASS_MAX_FILES = 4;
const ID = /^[A-Za-z0-9_-]{16,80}$/;
const REVISION = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;

export type TronClassSubmissionReceipt = {
  source: 'tronclass';
  id: string;
  courseId: number;
  homeworkId: number;
  status: 'submitted';
  submittedAt: string;
  content: string;
  attachments: Array<{ name: string; size: number }>;
};

export type TronClassPreparedSubmission = TronClassHomeworkScope & {
  source: 'tronclass'; schoolId: 'pu'; revision: string;
  title: string; description: string; deadline: string | null;
  canSubmit: boolean; blockedReason: string | null;
  maxFiles: number; maxFileBytes: number; allowedContentTypes: string[];
  receipt: TronClassSubmissionReceipt | null;
};

export type TronClassUploadedAttachment = {
  fileId: string; name: string; contentType: string; size: number;
  sha256: string; status: 'uploaded';
};

export type TronClassSubmissionResult = {
  status: 'submitted' | 'unknown';
  operationId: string;
  receipt: TronClassSubmissionReceipt | null;
};

type RecordData = Record<string, unknown>;
type Snapshot = { exists: boolean; data(): RecordData | undefined };
export type TronClassSubmissionRef = { path: string; get(): Promise<Snapshot> };
export type TronClassSubmissionTransaction = {
  get(ref: TronClassSubmissionRef): Promise<Snapshot>;
  set(ref: TronClassSubmissionRef, value: RecordData): unknown;
};
export type TronClassSubmissionFirestore = {
  doc(path: string): TronClassSubmissionRef;
  runTransaction<T>(run: (tx: TronClassSubmissionTransaction) => Promise<T>): Promise<T>;
};
export type TronClassSubmissionBindings = {
  requireBinding(ownerKey: string): Promise<TronClassSubmissionBinding>;
  assertCurrent(ownerKey: string, revision: string): Promise<void>;
};

type LedgerFile = Omit<TronClassUploadedAttachment, 'status'> & {
  status: 'uploading' | 'uploaded' | 'failed'; key: string | null;
};
type Operation = RecordData & TronClassHomeworkScope & {
  version: 1; ownerKey: string; schoolId: 'pu'; studentId: number;
  operationId: string; revision: string;
  state: 'draft' | 'submitting' | 'unknown' | 'submitted';
  files: LedgerFile[]; createdAt: number; updatedAt: number;
  submitStartedAt: number | null; contentDigest: string | null;
  payloadDigest: string | null; priorReceiptIds: string[];
  receipt: TronClassSubmissionReceipt | null;
  purgeAt: Date | null;
};
type ScopedOperationInput = TronClassHomeworkScope & { revision: string; operationId: string };

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function fail(status: number, code: string): never { throw new NuniError(status, code); }
function invalid(): never { return fail(400, 'TRONCLASS_INVALID_INPUT'); }
function unavailable(): never { return fail(503, 'TRONCLASS_SUBMISSION_UNAVAILABLE'); }
function conflict(): never { return fail(409, 'TRONCLASS_OPERATION_CONFLICT'); }

function validateScope(scope: TronClassHomeworkScope) {
  if (!scope || !positiveId(scope.courseId) || !positiveId(scope.homeworkId)) invalid();
}
function validateOperation(input: ScopedOperationInput) {
  validateScope(input);
  if (typeof input.revision !== 'string' || !REVISION.test(input.revision) ||
    typeof input.operationId !== 'string' || !ID.test(input.operationId)) invalid();
}
function canonicalInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}
function shortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function validateAssignment(assignment: TronClassAssignment, binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope) {
  if (!assignment || assignment.courseId !== scope.courseId || assignment.homeworkId !== scope.homeworkId ||
    assignment.studentId !== binding.userId || !shortString(assignment.title, 300) ||
    typeof assignment.description !== 'string' || assignment.description.length > 20000 ||
    !['permissionKnown', 'individual', 'canSubmit', 'isClosed', 'allowLate', 'allowsText', 'allowsAttachments']
      .every((key) => typeof assignment[key as keyof TronClassAssignment] === 'boolean') ||
    (assignment.deadline !== null && canonicalInstant(assignment.deadline) === null) ||
    (assignment.opensAt !== null && canonicalInstant(assignment.opensAt) === null) ||
    !['maxFiles', 'maxFileBytes', 'maxTotalBytes'].every((key) => {
      const value = assignment[key as keyof TronClassAssignment];
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    }) ||
    (assignment.remainingAttempts !== null && (!Number.isSafeInteger(assignment.remainingAttempts) || assignment.remainingAttempts < 0)) ||
    !Array.isArray(assignment.allowedContentTypes) || assignment.allowedContentTypes.length > 50 ||
    assignment.allowedContentTypes.some((type) => !shortString(type, 100))) unavailable();
}
function assignmentBlock(assignment: TronClassAssignment, now: number): string | null {
  if (!assignment.permissionKnown) return '無法確認這份作業的繳交規則，請先至 TronClass 查看。';
  if (!assignment.individual) return '這份作業須由小組繳交，請至 TronClass 確認組別與繳交方式。';
  if (!assignment.canSubmit || assignment.isClosed || assignment.remainingAttempts === 0) return '這份作業目前未開放繳交，請至 TronClass 查看。';
  if (assignment.opensAt && canonicalInstant(assignment.opensAt)! > now) return '這份作業尚未開放繳交。';
  if (assignment.deadline && canonicalInstant(assignment.deadline)! < now && !assignment.allowLate) return '作業已截止，目前未開放補交。';
  if (!assignment.allowsText && !assignment.allowsAttachments) return '這份作業的繳交方式尚未開放，請至 TronClass 查看。';
  return null;
}
function publicReceipt(receipt: TronClassSourceReceipt): TronClassSubmissionReceipt {
  return {
    source: 'tronclass', id: receipt.id, courseId: receipt.courseId, homeworkId: receipt.homeworkId,
    status: 'submitted', submittedAt: receipt.submittedAt, content: receipt.content,
    attachments: receipt.attachments.map(({ name, size }) => ({ name, size })),
  };
}
function validatedReceipts(value: unknown, binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope, now: number): TronClassSourceReceipt[] {
  if (!Array.isArray(value) || value.length > 100) unavailable();
  const ids = new Set<string>();
  for (const item of value) {
    const row = item as TronClassSourceReceipt;
    const at = canonicalInstant(row?.submittedAt);
    if (!row || !shortString(row.id, 200) || ids.has(row.id) || row.courseId !== scope.courseId ||
      row.homeworkId !== scope.homeworkId || row.studentId !== binding.userId || row.status !== 'submitted' ||
      at === null || at > now + 60_000 || typeof row.content !== 'string' || row.content.length > 20000 ||
      !Array.isArray(row.attachments) || row.attachments.length > TRONCLASS_MAX_FILES ||
      row.attachments.some((file) => !file || !shortString(file.key, 300) || !shortString(file.name, 200) ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > TRONCLASS_MAX_FILE_BYTES) ||
      new Set(row.attachments.map((file) => file.key)).size !== row.attachments.length) unavailable();
    ids.add(row.id);
  }
  return value as TronClassSourceReceipt[];
}
function readOperation(snapshot: Snapshot, ownerKey: string, operationId: string): Operation | null {
  if (!snapshot.exists) return null;
  const value = snapshot.data() as Operation | undefined;
  if (!value || value.version !== 1 || value.ownerKey !== ownerKey || value.schoolId !== 'pu' ||
    value.operationId !== operationId || !positiveId(value.studentId) || !positiveId(value.courseId) ||
    !positiveId(value.homeworkId) || !REVISION.test(value.revision) ||
    !['draft', 'submitting', 'unknown', 'submitted'].includes(value.state) ||
    !Array.isArray(value.files) || value.files.length > TRONCLASS_MAX_FILES ||
    value.files.some((file) => !file || !ID.test(file.fileId) || !HASH.test(file.sha256) ||
      !['uploading', 'uploaded', 'failed'].includes(file.status)) ||
    !Array.isArray(value.priorReceiptIds) || value.priorReceiptIds.length > 100) unavailable();
  return value;
}
function assertScope(operation: Operation, binding: TronClassSubmissionBinding, input: ScopedOperationInput) {
  if (operation.revision !== input.revision || operation.studentId !== binding.userId ||
    operation.courseId !== input.courseId || operation.homeworkId !== input.homeworkId) conflict();
}
function uploadHandle(file: LedgerFile): TronClassUploadedAttachment {
  return { fileId: file.fileId, name: file.name, contentType: file.contentType, size: file.size, sha256: file.sha256, status: 'uploaded' };
}
function assertPayloadAllowed(assignment: TronClassAssignment, content: string, files: LedgerFile[], now: number) {
  if (assignmentBlock(assignment, now) || (content.trim() && !assignment.allowsText) ||
    (files.length > 0 && !assignment.allowsAttachments) ||
    files.length > Math.min(assignment.maxFiles, TRONCLASS_MAX_FILES) ||
    files.some((file) => file.size > assignment.maxFileBytes ||
      (assignment.allowedContentTypes.length > 0 && !assignment.allowedContentTypes.includes(file.contentType))) ||
    files.reduce((sum, file) => sum + file.size, 0) > Math.min(assignment.maxTotalBytes, TRONCLASS_MAX_TOTAL_BYTES)) {
    fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
  }
}

export function createTronClassSubmissionService({ db, bindings, source, now = Date.now,
  writeEnabled = () => process.env.TRONCLASS_HOMEWORK_WRITE_ENABLED === 'true',
}: {
  db: TronClassSubmissionFirestore;
  bindings: TronClassSubmissionBindings;
  source: TronClassSubmissionSource;
  now?: () => number;
  writeEnabled?: () => boolean;
}) {
  const operationRef = (ownerKey: string, operationId: string) => db.doc(`${TRONCLASS_SUBMISSION_COLLECTION}/${digest(JSON.stringify([ownerKey, operationId]))}`);
  // One school account cannot submit twice by binding it to two nuni accounts.
  // The owner is kept in the private lock body and must match on every read;
  // conflict responses never disclose the other account or its operation ID.
  const lockRef = (studentId: number, scope: TronClassHomeworkScope) =>
    db.doc(`${TRONCLASS_SUBMISSION_LOCK_COLLECTION}/${digest(JSON.stringify(['pu', studentId, scope.courseId, scope.homeworkId]))}`);
  const guardWrites = () => {
    if (!writeEnabled()) fail(503, 'TRONCLASS_WRITES_DISABLED');
    if (source.contractVerified !== true) unavailable();
  };
  async function transaction<T>(ownerKey: string, run: (tx: TronClassSubmissionTransaction) => Promise<T>): Promise<T> {
    return db.runTransaction(async (tx) => {
      // Account deletion writes this permanent barrier before clearing private
      // operations. Read it in the SAME transaction so an in-flight request
      // cannot recreate user data after deletion finishes. Housekeeping may
      // still resolve an old revision, but a deleted owner may never write.
      const barrier = (await tx.get(db.doc(`_tronClassBindings/${digest(ownerKey)}`))).data();
      if (barrier?.state === 'closed') fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return run(tx);
    });
  }
  async function bindingFor(ownerKey: string, revision?: string) {
    if (!shortString(ownerKey, 300)) invalid();
    const binding = await bindings.requireBinding(ownerKey);
    if (!binding || binding.schoolId !== 'pu' || !positiveId(binding.userId) || !REVISION.test(binding.revision) ||
      canonicalInstant(binding.expiresAt) === null || canonicalInstant(binding.expiresAt)! <= now()) {
      fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
    }
    if (revision !== undefined && binding.revision !== revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
    return binding;
  }
  async function assignmentFor(ownerKey: string, binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope) {
    const assignment = await source.getAssignment(binding, scope);
    await bindings.assertCurrent(ownerKey, binding.revision);
    validateAssignment(assignment, binding, scope);
    return assignment;
  }
  async function receiptsFor(ownerKey: string, binding: TronClassSubmissionBinding, scope: TronClassHomeworkScope) {
    const value = await source.listSubmissions(binding, scope);
    await bindings.assertCurrent(ownerKey, binding.revision);
    return validatedReceipts(value, binding, scope, now());
  }
  function newOperation(ownerKey: string, binding: TronClassSubmissionBinding, input: ScopedOperationInput): Operation {
    return { version: 1, ownerKey, schoolId: 'pu', studentId: binding.userId,
      courseId: input.courseId, homeworkId: input.homeworkId, operationId: input.operationId,
      revision: input.revision, state: 'draft', files: [], createdAt: now(), updatedAt: now(),
      submitStartedAt: null, contentDigest: null, payloadDigest: null, priorReceiptIds: [], receipt: null,
      purgeAt: new Date(now() + 24 * 3600_000) };
  }
  async function markUnknown(ownerKey: string, operation: Operation) {
    await transaction(ownerKey, async (tx) => {
      const ref = operationRef(ownerKey, operation.operationId);
      const current = readOperation(await tx.get(ref), ownerKey, operation.operationId);
      if (!current || current.payloadDigest !== operation.payloadDigest) conflict();
      if (current.state !== 'submitted') tx.set(ref, { ...current, state: 'unknown', purgeAt: null, updatedAt: now() });
    });
  }
  async function releaseUnsentClaim(ownerKey: string, operation: Operation) {
    await transaction(ownerKey, async (tx) => {
      const ref = operationRef(ownerKey, operation.operationId);
      const lock = lockRef(operation.studentId, operation);
      const current = readOperation(await tx.get(ref), ownerKey, operation.operationId);
      const lockData = (await tx.get(lock)).data();
      if (!current || current.payloadDigest !== operation.payloadDigest ||
        lockData?.ownerKey !== ownerKey || lockData.operationId !== operation.operationId) conflict();
      if (current.state === 'submitted') return;
      // No source.submit call started. Clear only our own claim and retain the
      // staged files. Clearing the digest makes stale reconciliation snapshots
      // unable to revive this attempt after another operation acquires the lock.
      tx.set(ref, { ...current, state: 'draft', payloadDigest: null, contentDigest: null,
        submitStartedAt: null, priorReceiptIds: [], purgeAt: new Date(now() + 24 * 3600_000), updatedAt: now() });
      tx.set(lock, { ...lockData, state: 'not-sent', updatedAt: now() });
    });
  }
  async function reconcileOperation(ownerKey: string, binding: TronClassSubmissionBinding, operation: Operation): Promise<TronClassSubmissionResult> {
    if (operation.state === 'draft' || !operation.payloadDigest || !operation.contentDigest || operation.submitStartedAt === null) {
      fail(409, 'TRONCLASS_SUBMISSION_NOT_STARTED');
    }
    let candidates: TronClassSourceReceipt[];
    try {
      candidates = await receiptsFor(ownerKey, binding, operation);
    } catch (error) {
      await bindings.assertCurrent(ownerKey, binding.revision);
      if (error instanceof NuniError && ['TRONCLASS_BINDING_CHANGED', 'TRONCLASS_RECONNECT_REQUIRED'].includes(error.code)) throw error;
      await markUnknown(ownerKey, operation);
      return { status: 'unknown', operationId: operation.operationId, receipt: null };
    }
    const matching = candidates.filter((receipt) => {
      if (operation.priorReceiptIds.includes(receipt.id) ||
        canonicalInstant(receipt.submittedAt)! < Math.floor(operation.submitStartedAt! / 1000) * 1000 ||
        digest(receipt.content) !== operation.contentDigest || receipt.attachments.length !== operation.files.length) return false;
      return operation.files.every((file) => receipt.attachments.some((item) => item.key === file.key && item.name === file.name && item.size === file.size));
    });
    if (matching.length !== 1) {
      await markUnknown(ownerKey, operation);
      return { status: 'unknown', operationId: operation.operationId, receipt: null };
    }
    const receipt = publicReceipt(matching[0]);
    await bindings.assertCurrent(ownerKey, binding.revision);
    await transaction(ownerKey, async (tx) => {
      const ref = operationRef(ownerKey, operation.operationId);
      const lock = lockRef(binding.userId, operation);
      const current = readOperation(await tx.get(ref), ownerKey, operation.operationId);
      const lockData = (await tx.get(lock)).data();
      if (!current || current.payloadDigest !== operation.payloadDigest || lockData?.ownerKey !== ownerKey ||
        lockData?.operationId !== operation.operationId) conflict();
      tx.set(ref, { ...current, state: 'submitted', receipt, purgeAt: new Date(now() + 30 * 86400_000), updatedAt: now() });
      tx.set(lock, { ...lockData, state: 'submitted', updatedAt: now() });
    });
    await bindings.assertCurrent(ownerKey, binding.revision);
    return { status: 'submitted', operationId: operation.operationId, receipt };
  }
  return {
    async prepare(ownerKey: string, scope: TronClassHomeworkScope): Promise<TronClassPreparedSubmission> {
      validateScope(scope);
      const binding = await bindingFor(ownerKey);
      const assignment = await assignmentFor(ownerKey, binding, scope);
      let blockedReason = !writeEnabled() ? '目前暫停站內作業繳交，你仍可查看作業說明。'
        : source.contractVerified !== true ? '此學校目前尚未開放在 nuni 繳交，請使用 TronClass 作業頁。'
          : assignmentBlock(assignment, now());
      let receipt: TronClassSubmissionReceipt | null = null;
      if (source.contractVerified === true) {
        try {
          const receipts = await receiptsFor(ownerKey, binding, scope);
          const latest = receipts.sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0];
          if (latest) receipt = publicReceipt(latest);
        } catch {
          await bindings.assertCurrent(ownerKey, binding.revision);
          blockedReason = '繳交紀錄暫時無法確認，請重新讀取後再試。';
        }
      }
      await bindings.assertCurrent(ownerKey, binding.revision);
      return { source: 'tronclass', schoolId: 'pu', courseId: scope.courseId, homeworkId: scope.homeworkId, revision: binding.revision,
        title: assignment.title, description: assignment.description, deadline: assignment.deadline,
        canSubmit: blockedReason === null, blockedReason,
        maxFiles: Math.min(assignment.maxFiles, TRONCLASS_MAX_FILES),
        maxFileBytes: Math.min(assignment.maxFileBytes, TRONCLASS_MAX_FILE_BYTES),
        allowedContentTypes: [...assignment.allowedContentTypes], receipt };
    },
    async upload(ownerKey: string, input: ScopedOperationInput & {
      fileId: string; name: string; contentType: string; bytes: Uint8Array;
    }): Promise<TronClassUploadedAttachment> {
      validateOperation(input);
      if (!ID.test(input.fileId) || !shortString(input.name, 200) || /[\\/]/.test(input.name) ||
        !shortString(input.contentType, 100) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.contentType) ||
        !(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > TRONCLASS_MAX_FILE_BYTES) invalid();
      guardWrites();
      const binding = await bindingFor(ownerKey, input.revision);
      const assignment = await assignmentFor(ownerKey, binding, input);
      if (assignmentBlock(assignment, now()) || !assignment.allowsAttachments || input.bytes.byteLength > assignment.maxFileBytes ||
        (assignment.allowedContentTypes.length > 0 && !assignment.allowedContentTypes.includes(input.contentType))) {
        fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
      }
      // Copy the caller buffer before awaiting: the ledger hash and sent bytes
      // must describe the same file even if a caller mutates its buffer.
      const bytes = Uint8Array.from(input.bytes);
      const file: LedgerFile = { fileId: input.fileId, name: input.name, contentType: input.contentType,
        size: bytes.byteLength, sha256: digest(bytes), status: 'uploading', key: null };
      const existing = await transaction(ownerKey, async (tx) => {
        const ref = operationRef(ownerKey, input.operationId);
        const operation = readOperation(await tx.get(ref), ownerKey, input.operationId) ?? newOperation(ownerKey, binding, input);
        assertScope(operation, binding, input);
        const previous = operation.files.find((item) => item.fileId === file.fileId);
        if (previous) {
          if (previous.sha256 !== file.sha256 || previous.name !== file.name || previous.contentType !== file.contentType) conflict();
          if (previous.status === 'uploaded') return uploadHandle(previous);
          fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
        }
        if (operation.state !== 'draft') fail(409, 'TRONCLASS_SUBMISSION_IN_PROGRESS');
        if (operation.files.length >= Math.min(assignment.maxFiles, TRONCLASS_MAX_FILES) ||
          operation.files.reduce((sum, item) => sum + item.size, file.size) > Math.min(assignment.maxTotalBytes, TRONCLASS_MAX_TOTAL_BYTES)) {
          fail(413, 'TRONCLASS_FILE_LIMIT_EXCEEDED');
        }
        tx.set(ref, { ...operation, files: [...operation.files, file], updatedAt: now() });
        return null;
      });
      if (existing) { await bindings.assertCurrent(ownerKey, binding.revision); return existing; }
      try {
        await bindings.assertCurrent(ownerKey, binding.revision);
        guardWrites();
        const uploaded = await source.uploadFile(binding, assignment, { ...file, bytes });
        await bindings.assertCurrent(ownerKey, binding.revision);
        if (!uploaded || uploaded.courseId !== input.courseId || uploaded.homeworkId !== input.homeworkId ||
          uploaded.studentId !== binding.userId || !shortString(uploaded.key, 300) || uploaded.name !== file.name ||
          uploaded.size !== file.size || uploaded.sha256 !== file.sha256 || uploaded.contentType !== file.contentType) {
          fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
        }
        await transaction(ownerKey, async (tx) => {
          const ref = operationRef(ownerKey, input.operationId);
          const operation = readOperation(await tx.get(ref), ownerKey, input.operationId);
          if (!operation || operation.state !== 'draft') conflict();
          assertScope(operation, binding, input);
          const current = operation.files.find((item) => item.fileId === file.fileId);
          if (!current || current.status !== 'uploading' || current.sha256 !== file.sha256 ||
            operation.files.some((item) => item.fileId !== file.fileId && item.key === uploaded.key)) conflict();
          tx.set(ref, { ...operation, files: operation.files.map((item) => item.fileId === file.fileId
            ? { ...item, key: uploaded.key, status: 'uploaded' } : item), updatedAt: now() });
        });
        await bindings.assertCurrent(ownerKey, binding.revision);
        return uploadHandle(file);
      } catch (error) {
        await transaction(ownerKey, async (tx) => {
          const ref = operationRef(ownerKey, input.operationId);
          const operation = readOperation(await tx.get(ref), ownerKey, input.operationId);
          if (!operation || operation.state !== 'draft') return;
          tx.set(ref, { ...operation, files: operation.files.map((item) => item.fileId === file.fileId && item.status === 'uploading'
            ? { ...item, status: 'failed' } : item), updatedAt: now() });
        });
        if (error instanceof NuniError) throw error;
        fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
      }
    },
    async submit(ownerKey: string, input: ScopedOperationInput & {
      content: string; attachments: string[]; confirmed: true;
    }): Promise<TronClassSubmissionResult> {
      validateOperation(input);
      if (input.confirmed !== true || typeof input.content !== 'string' || input.content.length > 20000 ||
        !Array.isArray(input.attachments) || input.attachments.length > TRONCLASS_MAX_FILES ||
        input.attachments.some((id) => typeof id !== 'string' || !ID.test(id)) ||
        new Set(input.attachments).size !== input.attachments.length || (!input.content.trim() && input.attachments.length === 0)) invalid();
      guardWrites();
      const binding = await bindingFor(ownerKey, input.revision);
      const payloadDigest = digest(JSON.stringify([input.courseId, input.homeworkId, input.revision, input.content, [...input.attachments].sort()]));
      const ref = operationRef(ownerKey, input.operationId);
      const existing = readOperation(await ref.get(), ownerKey, input.operationId);
      if (existing) {
        assertScope(existing, binding, input);
        if (existing.state !== 'draft') {
          if (existing.payloadDigest !== payloadDigest) conflict();
          // Even a repeated final POST is a read-only reconciliation now.
          return reconcileOperation(ownerKey, binding, existing);
        }
      }
      const assignment = await assignmentFor(ownerKey, binding, input);
      if (assignmentBlock(assignment, now()) || (input.content.trim() && !assignment.allowsText) ||
        (input.attachments.length > 0 && !assignment.allowsAttachments)) fail(409, 'TRONCLASS_SUBMISSION_BLOCKED');
      const previousReceipts = await receiptsFor(ownerKey, binding, input);
      await bindings.assertCurrent(ownerKey, binding.revision);
      const claim = await transaction(ownerKey, async (tx) => {
        const operation = readOperation(await tx.get(ref), ownerKey, input.operationId) ?? newOperation(ownerKey, binding, input);
        const lock = lockRef(binding.userId, input);
        const lockSnapshot = await tx.get(lock);
        assertScope(operation, binding, input);
        if (operation.state !== 'draft') {
          if (operation.payloadDigest !== payloadDigest) conflict();
          return { operation, claimed: false };
        }
        if (lockSnapshot.exists && lockSnapshot.data()?.state !== 'not-sent') {
          // First release supports one final submission per assignment. A new
          // operation cannot evade an unresolved or completed operation lock.
          // Even the same operation ID stays blocked if its private receipt
          // expired: the durable slot is the evidence that a write started.
          fail(409, 'TRONCLASS_SUBMISSION_IN_PROGRESS');
        }
        if (operation.files.length !== input.attachments.length || operation.files.some((file) =>
          file.status !== 'uploaded' || !file.key || !input.attachments.includes(file.fileId))) fail(409, 'TRONCLASS_UPLOAD_UNCONFIRMED');
        assertPayloadAllowed(assignment, input.content, operation.files, now());
        const claimed: Operation = { ...operation, state: 'submitting', payloadDigest, contentDigest: digest(input.content),
          priorReceiptIds: previousReceipts.map((receipt) => receipt.id), purgeAt: null, submitStartedAt: now(), updatedAt: now() };
        tx.set(ref, claimed);
        tx.set(lock, { ownerKey, studentId: binding.userId, schoolId: 'pu', courseId: input.courseId, homeworkId: input.homeworkId,
          operationId: input.operationId, revision: input.revision, state: 'submitting', updatedAt: now() });
        return { operation: claimed, claimed: true };
      });
      if (claim.claimed) {
        // The durable claim is committed before the external request. A crash
        // leaves a reconciliable operation. Only a known pre-dispatch failure
        // can release our claim; an attempted external write never can.
        let dispatchStarted = false;
        try {
          const latestAssignment = await assignmentFor(ownerKey, binding, input);
          assertPayloadAllowed(latestAssignment, input.content, claim.operation.files, now());
          await bindings.assertCurrent(ownerKey, binding.revision);
          guardWrites();
          dispatchStarted = true;
          await source.submit(binding, latestAssignment, { operationId: input.operationId, content: input.content,
            attachments: claim.operation.files.map((file) => ({ key: file.key!, name: file.name, size: file.size })) });
        } catch (error) {
          if (!dispatchStarted) {
            await releaseUnsentClaim(ownerKey, claim.operation);
            throw error;
          }
          // A thrown response does not prove the server did not accept it.
        }
        await markUnknown(ownerKey, claim.operation);
      }
      await bindings.assertCurrent(ownerKey, binding.revision);
      return reconcileOperation(ownerKey, binding, claim.operation);
    },
    async reconcile(ownerKey: string, input: { operationId: string; revision: string }): Promise<TronClassSubmissionResult> {
      if (!input || typeof input.operationId !== 'string' || !ID.test(input.operationId) ||
        typeof input.revision !== 'string' || !REVISION.test(input.revision)) invalid();
      // Reconciliation stays available after the write switch is turned off.
      const binding = await bindingFor(ownerKey, input.revision);
      const operation = readOperation(await operationRef(ownerKey, input.operationId).get(), ownerKey, input.operationId);
      if (!operation) fail(404, 'TRONCLASS_SUBMISSION_NOT_FOUND');
      // A refreshed login for the SAME verified school identity can recover an
      // unknown result. The original operation/payload stays immutable and this
      // method cannot dispatch another submission. A different identity cannot.
      if (operation.studentId !== binding.userId) conflict();
      return reconcileOperation(ownerKey, binding, operation);
    },
  };
}

/** Request-local construction; credentials and sessions never enter a client bundle. */
export async function getDefaultTronClassSubmissionService() {
  const [{ getFirebaseAdmin }, { createTronClassBindingService }, { createTronClassSubmissionSource }] = await Promise.all([
    import('./firebaseAdmin'), import('./tronClassBinding'), import('./tronClassSubmissionSource'),
  ]);
  const runtime = await getFirebaseAdmin();
  if (!runtime?.db) unavailable();
  return createTronClassSubmissionService({
    db: runtime.db as unknown as TronClassSubmissionFirestore,
    bindings: createTronClassBindingService(),
    source: createTronClassSubmissionSource(),
  });
}
