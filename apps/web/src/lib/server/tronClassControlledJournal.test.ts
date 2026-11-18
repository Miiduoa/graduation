// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type {
  TronClassSubmissionBindings, TronClassSubmissionFirestore, TronClassSubmissionRef,
  TronClassSubmissionTransaction,
} from './tronClassSubmission';
import type { TronClassAttachmentClaim, TronClassAttachmentTransfer } from './tronClassAttachmentCandidate';
import {
  tronClassFinalCandidateDigest, type TronClassFinalCandidateClaim,
  type TronClassFinalCandidateAttempt,
} from './tronClassFinalSubmissionCandidate';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import { buildTronClassNewSubmission } from './tronClassSubmissionProtocol';

const OWNER = 'firebase:journal-fixture';
const OTHER = 'firebase:journal-other';
const REVISION = 'a'.repeat(32);
const NOW = Date.parse('2026-11-17T09:00:00.000Z');
const OPERATION = 'operation_fixture_001';
const FILE = 'attachment_fixture_001';
type Data = Record<string, unknown>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const bindingPath = (owner = OWNER) => `_tronClassBindings/${hash(owner)}`;
const operationPath = (owner = OWNER, id = OPERATION) => `_tronClassSubmissionOperations/${hash(JSON.stringify([owner, id]))}`;
const lockPath = (student = 30, course = 10, homework = 20) => `_tronClassSubmissionLocks/${hash(JSON.stringify(['pu', student, course, homework]))}`;
function bindingRow(ownerKey = OWNER, userId = 30, revision = REVISION): Data {
  return { ownerKey, schoolId: 'pu', state: 'connected', userId, revision, expiresAt: NOW + 3600_000, updatedAt: NOW };
}

/**
 * Shared, serialized Firestore-style transactions. Reads see committed values,
 * all reads precede writes, and a thrown callback commits NONE of its writes.
 * Two journal instances share this store; claims aren't fixture callbacks.
 */
function transactionalStore() {
  const rows = new Map<string, Data>();
  let queue: Promise<void> = Promise.resolve();
  let beforeNextTransaction: (() => void) | null = null;
  let rejectWriteNumber: number | null = null;
  const transactions: Array<{ reads: string[]; writes: string[] }> = [];
  const snapshot = (path: string) => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db: TronClassSubmissionFirestore = {
    doc(path) { return { path, async get() { return snapshot(path); } }; },
    async runTransaction<T>(run: (tx: TronClassSubmissionTransaction) => Promise<T>): Promise<T> {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending = new Map<string, Data>();
      const observed = { reads: [] as string[], writes: [] as string[] };
      transactions.push(observed);
      try {
        const before = beforeNextTransaction;
        beforeNextTransaction = null;
        before?.();
        const result = await run({
          async get(ref: TronClassSubmissionRef) {
            if (pending.size) throw new Error('Firestore requires all reads before writes');
            observed.reads.push(ref.path);
            return snapshot(ref.path);
          },
          set(ref, value) {
            observed.writes.push(ref.path);
            if (rejectWriteNumber === observed.writes.length) { rejectWriteNumber = null; throw new Error('synthetic commit interruption'); }
            pending.set(ref.path, structuredClone(value));
          },
        });
        for (const [path, value] of pending) rows.set(path, value);
        return result;
      } finally { release(); }
    },
  };
  const bindings: TronClassSubmissionBindings = {
    async requireBinding(ownerKey) {
      const row = rows.get(bindingPath(ownerKey));
      if (row?.state !== 'connected' || Number(row.expiresAt) <= NOW) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return { schoolId: 'pu', revision: row.revision as string, userId: row.userId as number,
        expiresAt: new Date(Number(row.expiresAt)).toISOString(), account: 'synthetic-account', userName: null,
        cookies: { session: 'synthetic-private-cookie' } };
    },
    async assertCurrent(ownerKey, revision) {
      const row = rows.get(bindingPath(ownerKey));
      if (row?.state !== 'connected' || row.revision !== revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    },
  };
  rows.set(bindingPath(), bindingRow());
  return { db, rows, bindings, transactions,
    beforeNext(run: () => void) { beforeNextTransaction = run; },
    failWrite(number: number) { rejectWriteNumber = number; },
  };
}
function setup() {
  const store = transactionalStore();
  let time = NOW;
  const dependencies = { db: store.db, bindings: store.bindings, now: () => time };
  return { ...store, dependencies, journal: createTronClassControlledJournal(dependencies), advance(ms: number) { time += ms; } };
}
function claim(overrides: Partial<TronClassAttachmentClaim> = {}): TronClassAttachmentClaim {
  return { ownerKey: OWNER, schoolId: 'pu', studentId: 30, courseId: 10, homeworkId: 20,
    revision: REVISION, operationId: OPERATION, fileId: FILE, name: '作業.txt', contentType: 'text/plain',
    size: 12, sha256: 'b'.repeat(64), ...overrides };
}
function transfer(value = claim(), uploadId = 40): TronClassAttachmentTransfer {
  return { ownerKey: value.ownerKey, studentId: value.studentId, courseId: value.courseId, homeworkId: value.homeworkId,
    revision: value.revision, operationId: value.operationId, fileId: value.fileId, name: value.name,
    contentType: value.contentType, size: value.size, sha256: value.sha256,
    uploadId, state: 'transferred', confirmation: 'awaiting-confirmation' };
}
function finalAttempt(overrides: Partial<TronClassFinalCandidateClaim> = {}): TronClassFinalCandidateClaim {
  const comment = buildTronClassNewSubmission({ activityId: 20, content: '文字 <內容>\n第二行', uploadIds: [40] }).body.comment as string;
  const value = { ownerKey: OWNER, studentId: 30, courseId: 10, homeworkId: 20, revision: REVISION,
    operationId: OPERATION, comment, uploads: [{ id: 40, name: '作業.txt', size: 12 }],
    priorHistoryComplete: true as const, priorSubmissionIds: [], payloadDigest: '', ...overrides };
  value.payloadDigest = tronClassFinalCandidateDigest(value);
  return value;
}
const uploadInput = () => ({ courseId: 10, homeworkId: 20, revision: REVISION, operationId: OPERATION, fileIds: [FILE] });
const cancelInput = () => ({ courseId: 10, homeworkId: 20, revision: REVISION, operationId: OPERATION });
const ack = (): NonNullable<TronClassFinalCandidateAttempt['acknowledgment']> =>
  ({ state: 'acknowledged', submissionId: 90, courseId: 10, activityId: 20, studentId: 30 });
async function transferred(s: ReturnType<typeof setup>, value = claim(), uploadId = 40) {
  expect(await s.journal.claimAttachment(value)).toBe(true);
  await s.journal.storeTransferredFile(transfer(value, uploadId));
}

describe('controlled Firestore journal', () => {
  describe('cancelling preparation before the final claim', () => {
    it('persists an absent-operation tombstone before allowing the client to edit again', async () => {
      const s = setup();
      expect(await s.journal.cancelPreparation(OWNER, cancelInput())).toEqual({
        status: 'cancelled', operationId: OPERATION, courseId: 10, homeworkId: 20,
      });
      const cancelled = structuredClone(s.rows.get(operationPath()));
      expect(cancelled).toMatchObject({ version: 2, ownerKey: OWNER, studentId: 30, revision: REVISION,
        state: 'cancelled', files: [], attempt: null, acknowledgment: null, purgeAt: null });
      expect(cancelled).not.toHaveProperty('expiresAt');
      expect(s.rows.has(lockPath())).toBe(false);

      const restarted = createTronClassControlledJournal(s.dependencies);
      expect(await restarted.claimAttachment(claim())).toBe(false);
      expect(await restarted.claimFinal(finalAttempt({ uploads: [] }))).toBe(false);
      await expect(restarted.storeTransferredFile(transfer())).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
      await expect(restarted.readUploadedFiles(OWNER, { ...uploadInput(), fileIds: [] }))
        .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
      expect(await restarted.readAttempt(OWNER, OPERATION)).toBeNull();
      expect(s.rows.get(operationPath())).toEqual(cancelled);
      expect(s.rows.has(lockPath())).toBe(false);
    });

    it.each(['claimed', 'transferred'] as const)('stops a %s attachment operation and rejects every late completion', async phase => {
      const s = setup();
      await s.journal.claimAttachment(claim());
      if (phase === 'transferred') await s.journal.storeTransferredFile(transfer());
      const files = structuredClone(s.rows.get(operationPath())?.files);
      expect((await s.journal.cancelPreparation(OWNER, cancelInput())).status).toBe('cancelled');
      const stopped = structuredClone(s.rows.get(operationPath()));
      expect(stopped).toMatchObject({ state: 'cancelled', files, purgeAt: null });
      await expect(s.journal.storeTransferredFile(transfer())).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
      expect(await s.journal.claimAttachment(claim({ fileId: 'attachment_delayed_002' }))).toBe(false);
      expect(await s.journal.claimFinal(finalAttempt())).toBe(false);
      await expect(s.journal.rememberAcknowledgment(finalAttempt(), ack()))
        .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
      expect(s.rows.get(operationPath())).toEqual(stopped);
      expect(s.rows.has(lockPath())).toBe(false);
    });

    it.each(['cancel-first', 'final-first'] as const)('serializes concurrent cancellation and final claim: %s', async order => {
      const s = setup();
      await transferred(s);
      const other = createTronClassControlledJournal(s.dependencies);
      const cancel = () => s.journal.cancelPreparation(OWNER, cancelInput());
      const final = () => other.claimFinal(finalAttempt());
      const [first, second] = order === 'cancel-first'
        ? await Promise.all([cancel(), final()]) : await Promise.all([final(), cancel()]);
      if (order === 'cancel-first') {
        expect(first).toMatchObject({ status: 'cancelled' });
        expect(second).toBe(false);
        expect(s.rows.get(operationPath())).toMatchObject({ state: 'cancelled', attempt: null, purgeAt: null });
        expect(s.rows.has(lockPath())).toBe(false);
      } else {
        expect(first).toBe(true);
        expect(second).toMatchObject({ status: 'unknown' });
        expect(s.rows.get(operationPath())).toMatchObject({ state: 'final-claimed', attempt: finalAttempt(), purgeAt: null });
        expect(s.rows.get(lockPath())).toMatchObject({ state: 'submitting', operationId: OPERATION, purgeAt: null });
      }
    });

    it.each(['final-claimed', 'acknowledged'] as const)('never cancels or modifies a %s operation or its lock', async state => {
      const s = setup();
      const value = finalAttempt({ uploads: [] });
      await s.journal.claimFinal(value);
      if (state === 'acknowledged') await s.journal.rememberAcknowledgment(value, ack());
      const before = structuredClone([...s.rows]);
      const transactions = s.transactions.length;
      expect((await s.journal.cancelPreparation(OWNER, cancelInput())).status).toBe('unknown');
      expect([...s.rows]).toEqual(before);
      expect(s.transactions.slice(transactions).flatMap(tx => tx.writes)).toEqual([]);
    });

    it('keeps repeated cancellation idempotent across a restart and a same-student reconnect', async () => {
      const s = setup();
      await transferred(s);
      const nextRevision = 'c'.repeat(32);
      s.rows.set(bindingPath(), bindingRow(OWNER, 30, nextRevision));
      const input = { ...cancelInput(), revision: nextRevision };
      const result = await s.journal.cancelPreparation(OWNER, input);
      const before = structuredClone(s.rows.get(operationPath()));
      expect(result.status).toBe('cancelled');
      expect(before).toMatchObject({ revision: REVISION, state: 'cancelled', purgeAt: null });
      s.advance(500);
      const restarted = createTronClassControlledJournal(s.dependencies);
      expect(await restarted.cancelPreparation(OWNER, input)).toEqual(result);
      expect(s.rows.get(operationPath())).toEqual(before);
      expect(await restarted.claimFinal(finalAttempt({ revision: nextRevision, uploads: [], operationId: 'new_operation_after_cancel' }))).toBe(true);
      expect(s.rows.get(operationPath())).toEqual(before);
    });

    it.each(['student', 'course', 'homework'] as const)('rejects a cancellation with a different %s and leaves original evidence intact', async changed => {
      const s = setup();
      await transferred(s);
      const before = structuredClone(s.rows.get(operationPath()));
      const input = cancelInput();
      if (changed === 'student') s.rows.set(bindingPath(), bindingRow(OWNER, 31));
      if (changed === 'course') input.courseId = 11;
      if (changed === 'homework') input.homeworkId = 21;
      await expect(s.journal.cancelPreparation(OWNER, input)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
      expect(s.rows.get(operationPath())).toEqual(before);
      expect(s.rows.has(lockPath())).toBe(false);
    });

    it('does not read or cancel another owner operation when the opaque operation ID is the same', async () => {
      const s = setup();
      await transferred(s);
      s.rows.set(bindingPath(OTHER), bindingRow(OTHER));
      const before = structuredClone(s.rows.get(operationPath()));
      const transactions = s.transactions.length;
      expect((await s.journal.cancelPreparation(OTHER, cancelInput())).status).toBe('cancelled');
      expect(s.rows.get(operationPath())).toEqual(before);
      expect(s.rows.get(operationPath(OTHER))).toMatchObject({ ownerKey: OTHER, state: 'cancelled', files: [] });
      expect(s.transactions.slice(transactions).flatMap(tx => tx.reads)).not.toContain(operationPath());
      expect(s.transactions.slice(transactions).flatMap(tx => tx.writes)).not.toContain(operationPath());
    });

    it.each(['closed', 'disconnected', 'revision-changed', 'student-changed', 'expired'] as const)(
      'rechecks the current binding in the cancellation transaction: %s', async state => {
        const s = setup();
        await transferred(s);
        const before = structuredClone(s.rows.get(operationPath()));
        s.beforeNext(() => {
          if (state === 'closed' || state === 'disconnected') s.rows.set(bindingPath(), { ...bindingRow(), state });
          if (state === 'revision-changed') s.rows.set(bindingPath(), bindingRow(OWNER, 30, 'c'.repeat(32)));
          if (state === 'student-changed') s.rows.set(bindingPath(), bindingRow(OWNER, 31));
          if (state === 'expired') s.advance(3600_001);
        });
        await expect(s.journal.cancelPreparation(OWNER, cancelInput())).rejects.toMatchObject({ code:
          ['closed', 'disconnected', 'expired'].includes(state) ? 'TRONCLASS_RECONNECT_REQUIRED' : 'TRONCLASS_BINDING_CHANGED' });
        expect(s.rows.get(operationPath())).toEqual(before);
        expect(s.rows.has(lockPath())).toBe(false);
      },
    );

    it.each([1, 2])('refuses legacy or unknown version %s without rewriting it', async version => {
      const s = setup();
      const unknown = { version, ownerKey: OWNER, operationId: OPERATION, state: 'unknown', privateReceipt: 'private-legacy', purgeAt: null };
      s.rows.set(operationPath(), unknown);
      await expect(s.journal.cancelPreparation(OWNER, cancelInput())).rejects.toMatchObject({
        code: 'TRONCLASS_OPERATION_CONFLICT', message: 'TRONCLASS_OPERATION_CONFLICT',
      });
      expect(s.rows.get(operationPath())).toEqual(unknown);
    });

    it.each(['submitting', 'unknown', 'submitted', 'owner-deleted', 'not-sent'])('does not modify a pre-existing %s school-task lock', async state => {
      const s = setup();
      const lock = { version: 1, state, ownerKey: OTHER, privateReceipt: 'private-lock', purgeAt: null };
      s.rows.set(lockPath(), lock);
      expect(await s.journal.cancelPreparation(OWNER, cancelInput())).toEqual({
        status: 'unknown', operationId: OPERATION, courseId: 10, homeworkId: 20,
      });
      expect(s.rows.get(lockPath())).toEqual(lock);
      expect(s.rows.has(operationPath())).toBe(false);
    });

    it.each(['absent', 'preparing'] as const)('does not report successful cancellation when persistence fails for an %s operation', async state => {
      const s = setup();
      if (state === 'preparing') await transferred(s);
      const before = structuredClone([...s.rows]);
      s.failWrite(1);
      await expect(s.journal.cancelPreparation(OWNER, cancelInput())).rejects.toMatchObject({
        code: 'TRONCLASS_JOURNAL_UNAVAILABLE', message: 'TRONCLASS_JOURNAL_UNAVAILABLE',
      });
      expect([...s.rows]).toEqual(before);
      expect((await s.journal.cancelPreparation(OWNER, cancelInput())).status).toBe('cancelled');
    });
  });

  it('stores a durable claim before transfer, then exposes only the exact transferred set', async () => {
    const s = setup();
    expect(s.journal.contractVerified).toBe(false);
    expect(Object.isFrozen(s.journal)).toBe(true);
    expect(await s.journal.claimAttachment(claim())).toBe(true);
    expect(s.rows.get(operationPath())).toMatchObject({ version: 2, candidate: 'controlled-tronclass-v1',
      ownerKey: OWNER, state: 'preparing', purgeAt: null,
      files: [{ fileId: FILE, state: 'claimed', uploadId: null }] });
    await expect(s.journal.readUploadedFiles(OWNER, uploadInput())).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    await s.journal.storeTransferredFile(transfer());
    expect(await s.journal.readUploadedFiles(OWNER, uploadInput())).toEqual([{
      ownerKey: OWNER, studentId: 30, courseId: 10, homeworkId: 20, revision: REVISION, operationId: OPERATION,
      fileId: FILE, uploadId: 40, name: '作業.txt', contentType: 'text/plain', size: 12, sha256: 'b'.repeat(64), state: 'transferred',
    }]);
    expect(s.transactions.every(tx => tx.reads[0] === bindingPath())).toBe(true);
    expect(JSON.stringify([...s.rows.values()])).not.toContain('synthetic-private-cookie');
  });

  it('atomically stores final intent and the shared school lock, then persists one acknowledged version', async () => {
    const s = setup();
    await transferred(s);
    const attempt = finalAttempt();
    expect(await s.journal.claimFinal(attempt)).toBe(true);
    expect(s.rows.get(operationPath())).toMatchObject({ state: 'final-claimed', attempt, acknowledgment: null, purgeAt: null });
    expect(s.rows.get(lockPath())).toMatchObject({ state: 'submitting', ownerKey: OWNER, operationId: OPERATION,
      payloadDigest: attempt.payloadDigest, purgeAt: null });
    expect(await s.journal.readAttempt(OWNER, OPERATION)).toEqual({ ...attempt, acknowledgment: null });
    await s.journal.rememberAcknowledgment(attempt, ack());
    expect(await s.journal.readAttempt(OWNER, OPERATION)).toEqual({ ...attempt, acknowledgment: ack() });
    expect(s.rows.get(lockPath())).toMatchObject({ state: 'acknowledged', purgeAt: null });
    // The canonical HTML is stored exactly once, never double-escaped.
    expect(s.rows.get(operationPath())?.attempt).toMatchObject({ comment: '文字 &lt;內容&gt;<br>第二行' });
  });

  it('two independent factories race for a file slot and only one commits', async () => {
    const s = setup();
    const other = createTronClassControlledJournal(s.dependencies);
    const results = await Promise.all([s.journal.claimAttachment(claim()), other.claimAttachment(claim())]);
    expect(results.sort()).toEqual([false, true]);
    expect((s.rows.get(operationPath())?.files as unknown[]).length).toBe(1);
    expect(await createTronClassControlledJournal(s.dependencies).claimAttachment(claim())).toBe(false);
  });

  it('two nuni owners of the same school student cannot both acquire final submission', async () => {
    const s = setup();
    s.rows.set(bindingPath(OTHER), bindingRow(OTHER));
    const other = createTronClassControlledJournal(s.dependencies);
    const one = finalAttempt({ uploads: [], operationId: 'text_operation_001' });
    const two = finalAttempt({ ownerKey: OTHER, uploads: [], operationId: 'text_operation_002' });
    const results = await Promise.all([s.journal.claimFinal(one), other.claimFinal(two)]);
    expect(results.sort()).toEqual([false, true]);
    const lock = s.rows.get(lockPath())!;
    expect([OWNER, OTHER]).toContain(lock.ownerKey);
    expect(s.rows.size).toBe(4); // two bindings, one operation, one shared lock
    expect(await other.claimFinal(two)).toBe(false);
  });

  it('distinct school students do not share a task lock', async () => {
    const s = setup();
    s.rows.set(bindingPath(OTHER), bindingRow(OTHER, 31));
    expect(await s.journal.claimFinal(finalAttempt({ uploads: [] }))).toBe(true);
    expect(await s.journal.claimFinal(finalAttempt({ ownerKey: OTHER, studentId: 31, uploads: [] }))).toBe(true);
    expect(s.rows.has(lockPath(30))).toBe(true);
    expect(s.rows.has(lockPath(31))).toBe(true);
  });

  it('does not commit the operation if writing the shared lock fails', async () => {
    const s = setup();
    s.failWrite(2);
    await expect(s.journal.claimFinal(finalAttempt({ uploads: [] }))).rejects.toMatchObject({ code: 'TRONCLASS_JOURNAL_UNAVAILABLE' });
    expect(s.rows.has(operationPath())).toBe(false);
    expect(s.rows.has(lockPath())).toBe(false);
    expect(await s.journal.claimFinal(finalAttempt({ uploads: [] }))).toBe(true);
  });

  it.each(['sha256', 'name', 'size', 'contentType'] as const)('rejects changed %s in the same file slot across factories', async key => {
    const s = setup();
    await s.journal.claimAttachment(claim());
    const changes = { sha256: 'c'.repeat(64), name: '不同.txt', size: 13, contentType: 'application/pdf' };
    const other = createTronClassControlledJournal(s.dependencies);
    await expect(other.claimAttachment(claim({ [key]: changes[key] }))).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.rows.get(operationPath())).toMatchObject({ files: [{ sha256: 'b'.repeat(64), name: '作業.txt', size: 12, contentType: 'text/plain' }] });
  });

  it.each(['revision', 'student', 'course', 'homework'] as const)('cannot reuse an operation after its %s changes', async kind => {
    const s = setup();
    await s.journal.claimAttachment(claim());
    const next = { ...claim() };
    if (kind === 'revision') { next.revision = 'c'.repeat(32); s.rows.set(bindingPath(), bindingRow(OWNER, 30, next.revision)); }
    if (kind === 'student') { next.studentId = 31; s.rows.set(bindingPath(), bindingRow(OWNER, 31)); }
    if (kind === 'course') next.courseId = 11;
    if (kind === 'homework') next.homeworkId = 21;
    await expect(s.journal.claimAttachment(next)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.rows.get(operationPath())).toMatchObject({ revision: REVISION, studentId: 30, courseId: 10, homeworkId: 20 });
  });

  it.each(['claimAttachment', 'storeTransferredFile', 'readUploadedFiles', 'claimFinal', 'readAttempt'] as const)('never interprets or overwrites legacy operations through %s', async method => {
    const s = setup();
    const legacy = { version: 1, ownerKey: OWNER, operationId: OPERATION, state: 'unknown', privateReceipt: 'legacy-secret', purgeAt: null };
    s.rows.set(operationPath(), legacy);
    const action = method === 'claimAttachment' ? () => s.journal.claimAttachment(claim())
      : method === 'storeTransferredFile' ? () => s.journal.storeTransferredFile(transfer())
        : method === 'readUploadedFiles' ? () => s.journal.readUploadedFiles(OWNER, uploadInput())
          : method === 'claimFinal' ? () => s.journal.claimFinal(finalAttempt()) : () => s.journal.readAttempt(OWNER, OPERATION);
    await expect(action()).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT', message: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.rows.get(operationPath())).toEqual(legacy);
  });

  it.each(['submitting', 'unknown', 'submitted', 'owner-deleted', 'not-sent'])('never overwrites an existing legacy %s school lock', async state => {
    const s = setup();
    const old = { version: 1, state, ownerKey: OTHER, privateReceipt: 'do-not-disclose' };
    s.rows.set(lockPath(), old);
    expect(await s.journal.claimFinal(finalAttempt({ uploads: [] }))).toBe(false);
    expect(await s.journal.claimAttachment(claim())).toBe(false);
    expect(s.rows.has(operationPath())).toBe(false);
    expect(s.rows.get(lockPath())).toEqual(old);
  });

  it.each(['missing', 'wrong-bytes', 'wrong-size', 'wrong-name', 'wrong-owner', 'wrong-upload-id'])('refuses a %s transfer completion', async kind => {
    const s = setup();
    if (kind !== 'missing') await s.journal.claimAttachment(claim());
    const result = transfer();
    if (kind === 'wrong-bytes') result.sha256 = 'c'.repeat(64);
    if (kind === 'wrong-size') result.size = 13;
    if (kind === 'wrong-name') result.name = '不同.txt';
    if (kind === 'wrong-owner') { s.rows.set(bindingPath(OTHER), bindingRow(OTHER)); result.ownerKey = OTHER; }
    if (kind === 'wrong-upload-id') { await s.journal.storeTransferredFile(result); result.uploadId = 41; }
    await expect(s.journal.storeTransferredFile(result)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    if (kind !== 'missing') expect(s.rows.get(operationPath())).toMatchObject({ files: [{ sha256: 'b'.repeat(64), name: '作業.txt', size: 12 }] });
  });

  it('allows idempotent completion but never gives two files the same school upload ID', async () => {
    const s = setup();
    await transferred(s);
    await s.journal.storeTransferredFile(transfer());
    const other = claim({ fileId: 'attachment_fixture_002', name: '另一份.txt' });
    await s.journal.claimAttachment(other);
    await expect(s.journal.storeTransferredFile(transfer(other, 40))).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    await s.journal.storeTransferredFile(transfer(other, 41));
    await expect(s.journal.readUploadedFiles(OWNER, uploadInput())).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    const complete = await s.journal.readUploadedFiles(OWNER, { ...uploadInput(), fileIds: [other.fileId, FILE] });
    expect(complete.map(file => file.uploadId)).toEqual([41, 40]);
  });

  it.each(['untransferred', 'omitted', 'substituted', 'changed-name', 'changed-size'])('requires the exact full transferred set before final: %s', async kind => {
    const s = setup();
    await s.journal.claimAttachment(claim());
    if (kind !== 'untransferred') await s.journal.storeTransferredFile(transfer());
    let uploads = [{ id: 40, name: '作業.txt', size: 12 }];
    if (kind === 'omitted') uploads = [];
    if (kind === 'substituted') uploads[0].id = 41;
    if (kind === 'changed-name') uploads[0].name = '不同.txt';
    if (kind === 'changed-size') uploads[0].size = 13;
    await expect(s.journal.claimFinal(finalAttempt({ uploads }))).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.rows.has(lockPath())).toBe(false);
    expect(s.rows.get(operationPath())).toMatchObject({ state: 'preparing' });
  });

  it('rejects a modified canonical body under an old payload digest', async () => {
    const s = setup();
    const attempt = finalAttempt({ uploads: [] });
    attempt.comment += 'changed';
    await expect(s.journal.claimFinal(attempt)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.transactions).toHaveLength(0);
  });

  it('the final operation can be claimed once even if the process restarts', async () => {
    const s = setup();
    const attempt = finalAttempt({ uploads: [] });
    expect(await s.journal.claimFinal(attempt)).toBe(true);
    const other = createTronClassControlledJournal(s.dependencies);
    expect(await other.claimFinal(attempt)).toBe(false);
    await expect(other.claimFinal(finalAttempt({ uploads: [], comment: 'different' }))).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.rows.get(lockPath())).toMatchObject({ payloadDigest: attempt.payloadDigest });
  });

  it.each(['studentId', 'courseId', 'activityId', 'submissionId'] as const)('acknowledgment %s must match a claimed payload and fixed version', async key => {
    const s = setup();
    const attempt = finalAttempt({ uploads: [] });
    await s.journal.claimFinal(attempt);
    const altered = { ...ack(), [key]: ack()[key] + 1 };
    if (key === 'submissionId') await s.journal.rememberAcknowledgment(attempt, ack());
    await expect(s.journal.rememberAcknowledgment(attempt, altered)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    const saved = await s.journal.readAttempt(OWNER, OPERATION);
    expect(saved?.acknowledgment).toEqual(key === 'submissionId' ? ack() : null);
  });

  it('acknowledgment persistence is idempotent and rejects changed payloads with a newly valid digest', async () => {
    const s = setup();
    const attempt = finalAttempt({ uploads: [] });
    await s.journal.claimFinal(attempt);
    await s.journal.rememberAcknowledgment(attempt, ack());
    await s.journal.rememberAcknowledgment(attempt, ack());
    await expect(s.journal.rememberAcknowledgment(finalAttempt({ uploads: [], comment: 'changed' }), ack()))
      .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect((await s.journal.readAttempt(OWNER, OPERATION))?.comment).toBe(attempt.comment);
  });

  it.each(['closed', 'disconnected', 'revision-changed', 'student-changed', 'expired'])('checks the actual binding transaction after a stale server precheck: %s', async kind => {
    const s = setup();
    s.beforeNext(() => {
      if (kind === 'closed') s.rows.set(bindingPath(), { schoolId: 'pu', state: 'closed', ownerHash: hash(OWNER), revision: 'c'.repeat(32), updatedAt: NOW });
      if (kind === 'disconnected') s.rows.set(bindingPath(), { ...bindingRow(), state: 'disconnected', revision: 'c'.repeat(32) });
      if (kind === 'revision-changed') s.rows.set(bindingPath(), bindingRow(OWNER, 30, 'c'.repeat(32)));
      if (kind === 'student-changed') s.rows.set(bindingPath(), bindingRow(OWNER, 31));
      if (kind === 'expired') s.advance(3600_001);
    });
    await expect(s.journal.claimAttachment(claim())).rejects.toMatchObject({ code:
      ['closed', 'disconnected', 'expired'].includes(kind) ? 'TRONCLASS_RECONNECT_REQUIRED' : 'TRONCLASS_BINDING_CHANGED' });
    expect(s.rows.has(operationPath())).toBe(false);
  });

  it.each(['transfer', 'acknowledgment'] as const)('does not recreate %s data after account closure and cleanup', async phase => {
    const s = setup();
    await transferred(s);
    const attempt = finalAttempt();
    if (phase === 'acknowledgment') await s.journal.claimFinal(attempt);
    // Lifecycle closes the binding first, then erases owner-keyed operations
    // and anonymizes uncertain shared locks. The late completion must lose.
    s.beforeNext(() => {
      s.rows.set(bindingPath(), { schoolId: 'pu', state: 'closed', ownerHash: hash(OWNER), revision: 'c'.repeat(32), updatedAt: NOW });
      s.rows.delete(operationPath());
      if (s.rows.has(lockPath())) s.rows.set(lockPath(), { version: 1, state: 'owner-deleted', updatedAt: NOW });
    });
    const action = phase === 'transfer' ? () => s.journal.storeTransferredFile(transfer())
      : () => s.journal.rememberAcknowledgment(attempt, ack());
    await expect(action()).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(s.rows.has(operationPath())).toBe(false);
    if (phase === 'acknowledgment') expect(s.rows.get(lockPath())).toEqual({ version: 1, state: 'owner-deleted', updatedAt: NOW });
  });

  it.each(['transfer', 'acknowledgment'])('does not write a late %s completion after explicit disconnect or rebind', async phase => {
    const s = setup();
    await transferred(s);
    const attempt = finalAttempt();
    if (phase === 'acknowledgment') await s.journal.claimFinal(attempt);
    const before = structuredClone(s.rows.get(operationPath()));
    s.rows.set(bindingPath(), bindingRow(OWNER, 30, 'c'.repeat(32)));
    const action = phase === 'transfer' ? () => s.journal.storeTransferredFile(transfer())
      : () => s.journal.rememberAcknowledgment(attempt, ack());
    await expect(action()).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(s.rows.get(operationPath())).toEqual(before);
  });

  it('permits read-only recovery for the same school student after reconnect, with old claim unchanged', async () => {
    const s = setup();
    const attempt = finalAttempt({ uploads: [] });
    await s.journal.claimFinal(attempt);
    await s.journal.rememberAcknowledgment(attempt, ack());
    const before = structuredClone(s.rows.get(operationPath()));
    s.rows.set(bindingPath(), bindingRow(OWNER, 30, 'c'.repeat(32)));
    expect(await s.journal.readAttempt(OWNER, OPERATION)).toEqual({ ...attempt, acknowledgment: ack() });
    expect(s.rows.get(operationPath())).toEqual(before);
    await expect(s.journal.claimFinal(finalAttempt({ uploads: [], revision: 'c'.repeat(32) })))
      .rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
  });

  it('refuses old attempt contents after binding a different school account', async () => {
    const s = setup();
    await s.journal.claimFinal(finalAttempt({ uploads: [] }));
    s.rows.set(bindingPath(), bindingRow(OWNER, 31, 'c'.repeat(32)));
    await expect(s.journal.readAttempt(OWNER, OPERATION)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    s.rows.set(bindingPath(OTHER), bindingRow(OTHER));
    expect(await s.journal.readAttempt(OTHER, OPERATION)).toBeNull();
  });

  it('keeps unresolved operations and final locks outside TTL cleanup', async () => {
    const s = setup();
    await s.journal.claimAttachment(claim());
    expect(s.rows.get(operationPath())?.purgeAt).toBeNull();
    await s.journal.storeTransferredFile(transfer());
    await s.journal.claimFinal(finalAttempt());
    for (const path of [operationPath(), lockPath()]) expect(s.rows.get(path)?.purgeAt).toBeNull();
    await s.journal.rememberAcknowledgment(finalAttempt(), ack());
    for (const path of [operationPath(), lockPath()]) expect(s.rows.get(path)?.purgeAt).toBeNull();
  });

  it('enforces combined application file budgets across concurrent claims', async () => {
    const s = setup();
    const other = createTronClassControlledJournal(s.dependencies);
    const size = 10 * 1024 * 1024;
    await s.journal.claimAttachment(claim({ fileId: 'attachment_large_001', size }));
    const results = await Promise.allSettled([
      s.journal.claimAttachment(claim({ fileId: 'attachment_large_002', size })),
      other.claimAttachment(claim({ fileId: 'attachment_large_003', size })),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((s.rows.get(operationPath())?.files as unknown[])).toHaveLength(2);
  });

  it('does not retain caller-owned mutable arrays and omits secret transport properties', async () => {
    const s = setup();
    const attempt = finalAttempt({ uploads: [] });
    await s.journal.claimFinal(attempt);
    attempt.comment = 'mutated-after-write';
    attempt.priorSubmissionIds.push(99);
    const saved = await s.journal.readAttempt(OWNER, OPERATION);
    expect(saved?.comment).toBe('文字 &lt;內容&gt;<br>第二行');
    expect(saved?.priorSubmissionIds).toEqual([]);
    const bad = { ...claim({ operationId: 'operation_fixture_002' }), cookies: { session: 'private' } };
    await expect(s.journal.claimAttachment(bad)).rejects.toMatchObject({ code: 'TRONCLASS_PROTOCOL_INVALID_INPUT' });
    expect(JSON.stringify([...s.rows.values()])).not.toContain('cookies');
  });

  it('drops private database exception messages', async () => {
    const s = setup();
    const db = { ...s.db, runTransaction: vi.fn(async () => { throw new Error('private-owner-cookie-and-body'); }) };
    const journal = createTronClassControlledJournal({ ...s.dependencies, db });
    await expect(journal.claimAttachment(claim())).rejects.toMatchObject({ code: 'TRONCLASS_JOURNAL_UNAVAILABLE', message: 'TRONCLASS_JOURNAL_UNAVAILABLE' });
  });
});
