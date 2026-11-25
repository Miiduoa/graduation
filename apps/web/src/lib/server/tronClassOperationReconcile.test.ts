// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassOperationReconciler } from './tronClassOperationReconcile';
import { createTronClassControlledJournal } from './tronClassControlledJournal';
import { tronClassFinalCandidateDigest, type TronClassFinalCandidateClaim } from './tronClassFinalSubmissionCandidate';
import type { TronClassSubmissionBindings, TronClassSubmissionFirestore, TronClassSubmissionResult } from './tronClassSubmission';

const OWNER = 'platform:pa_reconcile_fixture';
const OPERATION = 'operation_readback_fixture';
const REVISION = 'a'.repeat(32);
const NOW = Date.parse('2026-11-18T04:00:00.000Z');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const operationPath = (owner = OWNER) => `_tronClassSubmissionOperations/${hash(JSON.stringify([owner, OPERATION]))}`;
const bindingPath = `_tronClassBindings/${hash(OWNER)}`;
const row = {
  id: 501, created_by: { id: 303 }, course_id: 101, activity_id: 202, created_at: '2026-11-18T03:00:00Z',
  is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
  comment: '合成 &lt;內容&gt;<br>第二行', uploads: [],
};
async function setup(acknowledged = true) {
  const rows = new Map<string, Record<string, unknown>>();
  rows.set(bindingPath, { ownerKey: OWNER, schoolId: 'pu', state: 'connected', userId: 303,
    revision: REVISION, expiresAt: NOW + 3600_000, updatedAt: NOW });
  const snapshot = (path: string) => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db: TronClassSubmissionFirestore = {
    doc(path) { return { path, async get() { return snapshot(path); } }; },
    async runTransaction(run) {
      const writes = new Map<string, Record<string, unknown>>();
      const result = await run({ async get(ref) { return snapshot(ref.path); }, set(ref, data) { writes.set(ref.path, structuredClone(data)); } });
      for (const [path, data] of writes) rows.set(path, data);
      return result;
    },
  };
  const bindings: TronClassSubmissionBindings = {
    async requireBinding(owner) {
      const data = rows.get(bindingPath)!;
      if (owner !== OWNER || data.state !== 'connected') throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
      return { schoolId: 'pu', revision: data.revision as string, userId: data.userId as number,
        account: 'synthetic-account', userName: null, cookies: { session: 'private-cookie' },
        expiresAt: new Date(data.expiresAt as number).toISOString() };
    },
    async assertCurrent(owner, revision) {
      const data = rows.get(bindingPath)!;
      if (owner !== OWNER || data.state !== 'connected' || data.revision !== revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    },
  };
  const claim: TronClassFinalCandidateClaim = {
    ownerKey: OWNER, studentId: 303, courseId: 101, homeworkId: 202, revision: REVISION, operationId: OPERATION,
    payloadDigest: '', comment: row.comment, uploads: [], priorHistoryComplete: true, priorSubmissionIds: [],
  };
  claim.payloadDigest = tronClassFinalCandidateDigest(claim);
  const journal = createTronClassControlledJournal({ db, bindings, now: () => NOW });
  await journal.claimFinal(claim);
  if (acknowledged) await journal.rememberAcknowledgment(claim, { state: 'acknowledged', submissionId: 501, studentId: 303, courseId: 101, activityId: 202 });
  const readHistory = vi.fn(async () => ({ list: [row] } as unknown));
  const legacyReconcile = vi.fn(async (): Promise<TronClassSubmissionResult> => ({ status: 'unknown', operationId: OPERATION, receipt: null }));
  const reconcile = createTronClassOperationReconciler({ db, bindings, readHistory, legacyReconcile, now: () => NOW });
  return { rows, db, bindings, journal, claim, readHistory, legacyReconcile, reconcile,
    rebind(change: Record<string, unknown>) { rows.set(bindingPath, { ...rows.get(bindingPath)!, ...change }); } };
}
const input = { operationId: OPERATION, revision: REVISION };

describe('public v1/v2 read-only reconciliation', () => {
  it('confirms only the durable acknowledged version and never projects private content or a guessed submittedAt', async () => {
    const s = await setup();
    const before = structuredClone([...s.rows]);
    const result = await s.reconcile(OWNER, input);
    expect(result).toEqual({ status: 'confirmed', operationId: OPERATION, receipt: null, confirmation: {
      kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu', operationId: OPERATION,
      submissionId: 501, courseId: 101, homeworkId: 202,
      confirmedAt: new Date(NOW).toISOString(), sourceRecordedAt: '2026-11-18T03:00:00.000Z',
    } });
    expect(s.legacyReconcile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-cookie|studentId|submittedAt|內容|uploads/);
    expect([...s.rows]).toEqual(before); // no lock release, TTL, revision migration or write
    expect(await s.reconcile(OWNER, input)).toEqual(result);
  });

  it('keeps a lost final response unknown without reading or guessing from matching content', async () => {
    const s = await setup(false);
    expect(await s.reconcile(OWNER, input)).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
    expect(s.readHistory).not.toHaveBeenCalled();
    expect(s.legacyReconcile).not.toHaveBeenCalled();
  });

  it('keeps an existing preparing operation unknown because another actor can still claim final submission', async () => {
    const s = await setup();
    for (const path of [...s.rows.keys()]) if (path !== bindingPath) s.rows.delete(path);
    await s.journal.claimAttachment({ ownerKey: OWNER, schoolId: 'pu', studentId: 303, courseId: 101, homeworkId: 202,
      revision: REVISION, operationId: OPERATION, fileId: 'attachment_fixture_001', name: '作業.txt',
      contentType: 'text/plain', size: 12, sha256: 'c'.repeat(64) });
    const before = structuredClone([...s.rows]);
    expect(await s.reconcile(OWNER, input)).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
    expect([...s.rows]).toEqual(before);
    expect(s.readHistory).not.toHaveBeenCalled();
    expect(s.legacyReconcile).not.toHaveBeenCalled();
  });

  it.each([
    { list: [] }, { list: [row], total: 2 }, { list: [{ ...row, id: 502 }] },
    { list: [{ ...row, comment: '不同的內容' }] }, { list: [{ ...row, course_id: 999 }] },
    { list: [{ ...row, created_by: { id: 999 } }] }, { list: [{ ...row, is_draft: true }] },
    { list: [{ ...row, is_redo: true }] }, { list: [{ ...row, uploads: [{ id: 6, name: '額外檔案.txt', size: 12 }] }] },
  ])('retains unknown for nonmatching or incomplete school readback: %j', async raw => {
    const s = await setup();
    s.readHistory.mockResolvedValue(raw);
    expect(await s.reconcile(OWNER, input)).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
  });

  it('uses a fresh revision for the same verified student without rewriting the immutable attempt', async () => {
    const s = await setup();
    s.rebind({ revision: 'b'.repeat(32) });
    expect(await s.reconcile(OWNER, { ...input, revision: 'b'.repeat(32) })).toMatchObject({ status: 'confirmed' });
    expect(s.readHistory).toHaveBeenCalledWith(OWNER, expect.objectContaining({ userId: 303, revision: 'b'.repeat(32) }), { courseId: 101, homeworkId: 202 });
    expect(s.rows.get(operationPath())?.revision).toBe(REVISION);
  });

  it('rejects the same owner rebound to another school student', async () => {
    const s = await setup();
    s.rebind({ revision: 'b'.repeat(32), userId: 404 });
    await expect(s.reconcile(OWNER, { ...input, revision: 'b'.repeat(32) })).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.readHistory).not.toHaveBeenCalled();
  });

  it('discards a matched response when binding changes during the school request', async () => {
    const s = await setup();
    s.readHistory.mockImplementation(async () => { s.rebind({ revision: 'b'.repeat(32) }); return { list: [row] }; });
    await expect(s.reconcile(OWNER, input)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
  });

  it.each([
    [401, 'TRONCLASS_RECONNECT_REQUIRED'], [403, 'TRONCLASS_COURSE_ACCESS_DENIED'],
    [404, 'TRONCLASS_HOMEWORK_NOT_FOUND'], [409, 'TRONCLASS_BINDING_CHANGED'],
  ])('propagates a revocation instead of returning an old confirmation: %s %s', async (status, code) => {
    const s = await setup();
    s.readHistory.mockRejectedValue(new NuniError(status as number, code as string));
    await expect(s.reconcile(OWNER, input)).rejects.toMatchObject({ code });
  });

  it.each([new Error('private-cookie'), new NuniError(504, 'TRONCLASS_READ_TIMEOUT'), new NuniError(502, 'TRONCLASS_HISTORY_UNAVAILABLE')])(
    'keeps attempted writes unknown during temporary read failure', async error => {
      const s = await setup();
      s.readHistory.mockRejectedValue(error);
      expect(await s.reconcile(OWNER, input)).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
    },
  );

  it('preserves the exact legacy reconciliation path for v1 and missing operations', async () => {
    const s = await setup();
    s.rows.set(operationPath(), { version: 1 });
    await s.reconcile(OWNER, input);
    expect(s.legacyReconcile).toHaveBeenCalledExactlyOnceWith(OWNER, input, expect.objectContaining({ revision: input.revision }));
    s.rows.delete(operationPath());
    s.legacyReconcile.mockRejectedValue(new NuniError(404, 'TRONCLASS_SUBMISSION_NOT_FOUND'));
    await expect(s.reconcile(OWNER, input)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_NOT_FOUND' });
    expect(s.readHistory).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, 3, '2'])('does not fall back to legacy for an unknown journal version: %j', async version => {
    const s = await setup();
    s.rows.set(operationPath(), { version });
    await expect(s.reconcile(OWNER, input)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.legacyReconcile).not.toHaveBeenCalled();
  });

  it('rejects a forged or changed acknowledged attempt before school I/O', async () => {
    const s = await setup();
    const record = s.rows.get(operationPath())!;
    s.rows.set(operationPath(), { ...record, attempt: { ...(record.attempt as object), comment: 'tampered' } });
    await expect(s.reconcile(OWNER, input)).rejects.toMatchObject({ code: 'TRONCLASS_OPERATION_CONFLICT' });
    expect(s.readHistory).not.toHaveBeenCalled();
  });

  it('authenticates before reading another owner operation and freezes input before asynchronous work', async () => {
    const s = await setup();
    await expect(s.reconcile('platform:pa_other', input)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    const mutable = { ...input };
    const pending = s.reconcile(OWNER, mutable);
    mutable.operationId = 'other_operation_fixture';
    mutable.revision = 'b'.repeat(32);
    expect(await pending).toMatchObject({ status: 'confirmed', operationId: OPERATION });
  });
});
