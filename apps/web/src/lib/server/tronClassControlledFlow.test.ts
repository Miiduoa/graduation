// @vitest-environment node
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassAttachmentTransfer, TronClassAttachmentCandidateInput } from './tronClassAttachmentCandidate';
import { createTronClassControlledSubmission } from './tronClassControlledSubmission';
import type { TronClassCandidateAuthorization } from './tronClassSubmissionCandidate';
import type { TronClassAssignment, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { TronClassSubmissionFirestore, TronClassSubmissionRef } from './tronClassSubmission';
import type { FetchLike } from './puEdgeRelay';

// This is an in-memory protocol integration test, not a school capture, real
// network request, durable production journal or teacher-receipt verification.
const ORIGIN = 'https://tronclass.pu.edu.tw';
const OWNER = 'firebase:synthetic-flow';
const NOW = Date.parse('2026-11-17T08:00:00.700Z');
const REVISION = 'a'.repeat(32);
const OPERATION = 'operation_controlled_0001';
const SCOPE = { courseId: 101, homeworkId: 202 };
const FILES = [
  { id: 601, fileId: 'file_pdf_controlled_0001', name: 'synthetic-report.pdf', contentType: 'application/pdf',
    bytes: Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55, 10]) },
  { id: 602, fileId: 'file_zip_controlled_0002', name: 'synthetic-code.zip', contentType: 'application/zip',
    bytes: Uint8Array.from([80, 75, 3, 4, 0, 0, 8, 0, 1, 2, 3, 4]) },
];
const binding = (): TronClassSubmissionBinding => ({ schoolId: 'pu', revision: REVISION,
  account: 'synthetic-student', userId: 303, userName: null,
  expiresAt: '2026-11-17T09:00:00.000Z', cookies: { session: 'synthetic-session', 'XSRF-TOKEN': 'synthetic-csrf' } });
const assignment = (): TronClassAssignment => ({ ...SCOPE, studentId: 303, title: '合成整合測試作業', description: '',
  deadline: '2026-11-17T10:00:00.000Z', opensAt: null, permissionKnown: true, individual: true,
  canSubmit: true, isClosed: false, allowLate: false, remainingAttempts: 1, allowsText: true,
  allowsAttachments: true, maxFiles: 4, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024,
  allowedContentTypes: ['application/pdf', 'application/zip'] });
const uploadInput = (file = FILES[0]): TronClassAttachmentCandidateInput => ({ ...SCOPE, revision: REVISION,
  operationId: OPERATION, fileId: file.fileId, name: file.name, contentType: file.contentType, bytes: file.bytes });
const finalInput = (files = FILES) => ({ ...SCOPE, revision: REVISION, operationId: OPERATION,
  content: '我的 <報告> & 程式\n完整附件', fileIds: files.map(file => file.fileId) });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
type FailureStage = 'metadata' | 'binary' | 'callback';

/** Production journal code runs unchanged against serial, atomic transactions. */
function memoryDb() {
  const rows = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  const transactionContext = new AsyncLocalStorage<boolean>();
  let nextTransaction: (() => void) | undefined;
  const snapshot = (path: string) => ({
    exists: rows.has(path), data: () => rows.has(path) ? structuredClone(rows.get(path)!) : undefined,
  });
  const db: TronClassSubmissionFirestore = {
    doc(path) { return { path, get: async () => snapshot(path) }; },
    runTransaction(run) {
      const pending = queue.then(() => transactionContext.run(true, async () => {
        const before = nextTransaction;
        nextTransaction = undefined;
        before?.();
        const writes: Array<[string, Record<string, unknown>]> = [];
        const result = await run({
          get: async (ref: TronClassSubmissionRef) => {
            if (writes.length) throw new Error('Firestore reads must precede writes');
            return snapshot(ref.path);
          },
          set(ref, value) { writes.push([ref.path, structuredClone(value)]); },
        });
        for (const [path, value] of writes) rows.set(path, value);
        return result;
      }));
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
  return { db, rows, isInsideTransaction: () => transactionContext.getStore() === true,
    beforeNextTransaction: (callback: () => void) => { nextTransaction = callback; } };
}

function controlledEnvironment(options: { fail?: FailureStage; failFile?: number } = {}) {
  const trace: string[] = [];
  const store = memoryDb();
  const ownerHash = createHash('sha256').update(OWNER).digest('hex');
  const bindingPath = `_tronClassBindings/${ownerHash}`;
  store.rows.set(bindingPath, { ownerKey: OWNER, schoolId: 'pu', state: 'connected', revision: REVISION,
    userId: 303, expiresAt: Date.parse(binding().expiresAt), updatedAt: NOW - 1000,
    account: 'synthetic-student', userName: null, sealedCookies: 'synthetic-not-a-real-ciphertext' });
  // Observations only: the factory must persist and reload every real transfer
  // through its actual Firestore journal, never through this test-side map.
  const transferred = new Map<string, TronClassAttachmentTransfer>();
  const binaries = new Map<number, Uint8Array>();
  const callbacks = new Set<number>();
  let finalRow: Record<string, unknown> | null = null;
  let hideReadbackAttachment = false;
  let writesEnabled = true;
  // Independently specified targets: the policy does not echo a response URL.
  const targets = new Map(FILES.map(file => [file.id, {
    uploadId: file.id, mode: 'raw' as const,
    url: `https://synthetic-storage.example.invalid/controlled/${file.id}`,
  }]));
  const failHere = (stage: FailureStage, id: number) => options.fail === stage &&
    (options.failFile === undefined || options.failFile === id);

  const fetchSchool: FetchLike = vi.fn(async (url, init = {}) => {
    expect(store.isInsideTransaction()).toBe(false);
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    expect(new URL(url).origin).toBe(ORIGIN);
    expect(init.redirect).toBe('manual');
    expect(headers.get('Cookie')).toContain('session=synthetic-session');
    if (init.method === 'GET' && path === '/api/activities/202/students/303/submission_list') {
      trace.push('GET history');
      const row = finalRow && structuredClone(finalRow);
      if (row && hideReadbackAttachment) row.uploads = (row.uploads as unknown[]).slice(0, -1);
      return json({ list: row ? [row] : [] });
    }
    expect(init.method).toBe('POST');
    expect(headers.get('X-XSRF-TOKEN')).toBe('synthetic-csrf');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (path === '/api/uploads') {
      const file = FILES.find(item => item.name === body.name)!;
      expect(file).toBeDefined();
      trace.push(`POST metadata ${file.id}`);
      expect(body).toMatchObject({ name: file.name, size: file.bytes.byteLength, parent_type: null, parent_id: 0 });
      if (failHere('metadata', file.id)) return new Response(null, { status: 503 });
      return json({ ...body, id: file.id, storage_type: 'S3', transcoder: 'WRPC', upload_url: targets.get(file.id)!.url });
    }
    const callback = /^\/internal-api\/upload\/callback\/(601|602)$/.exec(path);
    if (callback) {
      const uploadId = Number(callback[1]);
      trace.push(`POST callback ${uploadId}`);
      expect(body).toEqual({ file_key: uploadId });
      expect(binaries.has(uploadId)).toBe(true);
      if (failHere('callback', uploadId)) return new Response(null, { status: 503 });
      callbacks.add(uploadId);
      return new Response(null, { status: 204 });
    }
    expect(path).toBe('/api/course/activities/202/submissions');
    trace.push('POST final');
    expect(body).toMatchObject({ mode: 'normal', is_draft: false, slides: [], other_resources: [], uploads_in_rich_text: [] });
    expect((body.uploads as number[]).every(uploadId => callbacks.has(uploadId))).toBe(true);
    finalRow = { id: 501, course_id: 101, activity_id: 202, created_by: { id: 303 },
      is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
      comment: body.comment, uploads: (body.uploads as number[]).map(uploadId => {
        const file = FILES.find(item => item.id === uploadId)!;
        return { id: uploadId, name: file.name, size: file.bytes.byteLength };
      }), created_at: '2026-11-17T08:00:00Z', other_resources: [], slide_references: [] };
    return json({ submission: finalRow, student: { id: 303 } });
  });

  const fetchStorage: FetchLike = vi.fn(async (url, init = {}) => {
    expect(store.isInsideTransaction()).toBe(false);
    const target = [...targets.values()].find(item => item.url === url)!;
    expect(target).toBeDefined();
    trace.push(`PUT binary ${target.uploadId}`);
    expect(init).toMatchObject({ method: 'PUT', redirect: 'manual', credentials: 'omit' });
    const headers = new Headers(init.headers);
    for (const name of ['Cookie', 'Authorization', 'X-XSRF-TOKEN', 'Referer']) expect(headers.has(name)).toBe(false);
    const file = FILES.find(item => item.id === target.uploadId)!;
    expect(headers.get('Content-Type')).toBe(file.contentType);
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    const bytes = new Uint8Array(init.body as ArrayBuffer);
    expect(bytes).toEqual(file.bytes);
    if (failHere('binary', file.id)) return new Response(null, { status: 503 });
    binaries.set(file.id, Uint8Array.from(bytes));
    return new Response(null, { status: 204 });
  });

  const readHistory = async (current: TronClassSubmissionBinding, scope: typeof SCOPE, signal: AbortSignal) => {
    expect(scope).toEqual(SCOPE);
    const response = await fetchSchool(`${ORIGIN}/api/activities/${scope.homeworkId}/students/${current.userId}/submission_list`, {
      method: 'GET', headers: { Cookie: 'session=synthetic-session' }, redirect: 'manual', signal,
    });
    return response.json() as Promise<{ list: Array<{ id: number }> }>;
  };
  const requireBinding = async (ownerKey: string) => {
    const row = store.rows.get(bindingPath);
    if (ownerKey !== OWNER || row?.state !== 'connected' || row.userId !== 303 || row.revision !== REVISION ||
      row.expiresAt !== Date.parse(binding().expiresAt)) throw new NuniError(401, 'TRONCLASS_RECONNECT_REQUIRED');
    return binding();
  };
  const bindings = {
    requireBinding,
    assertCurrent: async (ownerKey: string, revision: string) => {
      const current = await requireBinding(ownerKey);
      if (current.revision !== revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    },
  };
  const factories = () => createTronClassControlledSubmission({
    db: store.db, bindings, enabled: () => writesEnabled, now: () => NOW, fetchSchool, fetchStorage,
    authorize: async (ownerKey): Promise<TronClassCandidateAuthorization> => {
      const current = await requireBinding(ownerKey);
      const history = await readHistory(current, SCOPE, new AbortController().signal);
      return { binding: current, assignment: assignment(), mode: 'normal', historyComplete: true,
        priorSubmissionIds: history.list.map(row => row.id), userSubmitCount: history.list.length,
        ordinaryWindowConfirmed: true, prerequisitesConfirmed: true };
    },
    resolveStorageTarget: async evidence => {
      const target = targets.get(evidence.uploadId);
      return target && target.url === evidence.url && target.mode === evidence.mode ? { ...target } : null;
    },
    readHistory,
  });
  const uploadFiles = async (files = FILES) => {
    for (const file of files) {
      const result = await factories().upload(OWNER, uploadInput(file));
      transferred.set(`${result.ownerKey}:${result.operationId}:${result.fileId}`, structuredClone(result));
    }
  };
  return { factories, uploadFiles, trace, transferred,
    setMissingReadbackFile: (value: boolean) => { hideReadbackAttachment = value; },
    disableWrites: () => { writesEnabled = false; },
    closeOwnerBeforeClaim: () => store.beforeNextTransaction(() => {
      // This occurs after the candidate's earlier binding check, immediately
      // before the real journal reads the account barrier in its transaction.
      store.rows.set(bindingPath, { schoolId: 'pu', state: 'closed', ownerHash,
        revision: 'c'.repeat(32), updatedAt: NOW });
    }),
    operationRows: () => [...store.rows].filter(([path]) => path.startsWith('_tronClassSubmissionOperations/')),
  };
}

describe('controlled attachment-to-final school protocol flow', () => {
  it('transfers PDF and ZIP bytes before final POST and verifies the exact student version', async () => {
    const test = controlledEnvironment();
    await test.uploadFiles();
    const observations = [...test.transferred.values()];
    expect(observations.map(file => file.confirmation)).toEqual(['awaiting-confirmation', 'awaiting-confirmation']);
    test.transferred.clear();
    const final = test.factories();
    const result = await final.dispatch(OWNER, finalInput());
    expect(result).toEqual({ state: 'verified-new-version', submissionId: 501, courseId: 101, activityId: 202,
      studentId: 303, sourceRecordedAt: '2026-11-17T08:00:00.000Z', operationId: OPERATION,
      confirmedAt: '2026-11-17T08:00:00.700Z' });
    expect(result).not.toHaveProperty('receipt');
    expect(result).not.toHaveProperty('submittedAt');
    expect(final.contractVerified).toBe(false);
    expect(test.trace).toEqual(['GET history', 'POST metadata 601', 'PUT binary 601', 'POST callback 601',
      'GET history', 'POST metadata 602', 'PUT binary 602', 'POST callback 602',
      'GET history', 'GET history', 'POST final', 'GET history']);
    for (const file of FILES) {
      expect(observations.find(result => result.fileId === file.fileId)?.sha256)
        .toBe(createHash('sha256').update(file.bytes).digest('hex'));
    }
  });

  it.each(['metadata', 'binary', 'callback'] as const)('does not proceed to final after %s fails', async fail => {
    const test = controlledEnvironment({ fail });
    await expect(test.uploadFiles([FILES[0]])).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(test.transferred.size).toBe(0);
    await expect(test.factories().dispatch(OWNER, finalInput([FILES[0]])))
      .rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(test.trace).not.toContain('POST final');
    // A new factory cannot automatically repeat an uncertain upload stage.
    const writesBefore = test.trace.filter(step => step !== 'GET history');
    await expect(test.factories().upload(OWNER, uploadInput()))
      .rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_ALREADY_DISPATCHED' });
    expect(test.trace.filter(step => step !== 'GET history')).toEqual(writesBefore);
  });

  it('keeps one transferred attachment from becoming a partial final when the second file fails', async () => {
    const test = controlledEnvironment({ fail: 'binary', failFile: 602 });
    await expect(test.uploadFiles()).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect([...test.transferred.values()].map(file => file.uploadId)).toEqual([601]);
    await expect(test.factories().dispatch(OWNER, finalInput()))
      .rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(test.trace).not.toContain('POST callback 602');
    expect(test.trace).not.toContain('POST final');
  });

  it('keeps a 200 final pending if readback lacks a file, then reconciles with only GET after writes stop', async () => {
    const test = controlledEnvironment();
    await test.uploadFiles();
    test.setMissingReadbackFile(true);
    expect(await test.factories().dispatch(OWNER, finalInput()))
      .toEqual({ state: 'awaiting-confirmation', operationId: OPERATION });
    expect(test.trace.filter(step => step === 'POST final')).toHaveLength(1);
    test.disableWrites();
    test.setMissingReadbackFile(false);
    const before = test.trace.length;
    const result = await test.factories().reconcile(OWNER, OPERATION);
    expect(result).toMatchObject({ state: 'verified-new-version', submissionId: 501, operationId: OPERATION });
    expect(test.trace.slice(before)).toEqual(['GET history']);
    expect(result).not.toHaveProperty('submittedAt');
    expect(result).not.toHaveProperty('receipt');
    await expect(test.factories().dispatch(OWNER, finalInput()))
      .rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_DISABLED' });
    expect(test.trace.filter(step => step === 'POST final')).toHaveLength(1);
  });

  it('shares atomic upload and final claims between independent factories so concurrent requests post once', async () => {
    const test = controlledEnvironment();
    await test.uploadFiles();
    await expect(test.factories().upload(OWNER, uploadInput()))
      .rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_ALREADY_DISPATCHED' });
    expect(test.trace.filter(step => step === 'POST metadata 601')).toHaveLength(1);
    const first = test.factories();
    const second = test.factories();
    const results = await Promise.allSettled([first.dispatch(OWNER, finalInput()), second.dispatch(OWNER, finalInput())]);
    expect(results.filter(result => result.status === 'fulfilled'), JSON.stringify({
      results: results.map(result => result.status === 'rejected' ? { status: result.status, reason: result.reason } : result),
      trace: test.trace,
    })).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      status: 'rejected', reason: { code: 'TRONCLASS_CANDIDATE_ALREADY_DISPATCHED' },
    });
    expect(test.trace.filter(step => step === 'POST final')).toHaveLength(1);
    expect(await test.factories().reconcile(OWNER, OPERATION))
      .toMatchObject({ state: 'verified-new-version', submissionId: 501 });
  });

  it('stops at the transactional account-closure barrier before any metadata or file transfer', async () => {
    const test = controlledEnvironment();
    const existingFactory = test.factories();
    test.closeOwnerBeforeClaim();
    await expect(existingFactory.upload(OWNER, uploadInput()))
      .rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(test.trace).toEqual(['GET history']);
    expect(test.operationRows()).toEqual([]);
    await expect(test.factories().upload(OWNER, uploadInput()))
      .rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(test.trace).toEqual(['GET history']);
  });
});
