// @vitest-environment node
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { handleTronClassIntegration, type TronClassRouteDependencies } from './tronClassIntegrationRoute';
import { createTronClassPublicSubmissionService } from './tronClassPublicSubmissionService';
import type { TronClassSubmissionFirestore, TronClassPreparedSubmission } from './tronClassSubmission';
import type { TronClassAssignment, TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { FetchLike } from './puEdgeRelay';

const OWNER = 'platform:pa_public_route_fixture';
const NOW = Date.parse('2026-11-18T06:00:00.000Z');
const REVISION = 'a'.repeat(32);
const OPERATION = 'operation_http_fixture';
const FILE = 'attachment_http_fixture';
const SCOPE = { courseId: 101, homeworkId: 202 };
const BYTES = Uint8Array.from([37, 80, 68, 70, 10]);
const TARGET = Object.freeze({ uploadId: 601, mode: 'raw' as const, url: 'https://synthetic-storage.example.invalid/controlled/601' });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

/** All school data and HTTP are synthetic; the public route, adapter and v2 journal run unchanged. */
function environment(contractVerified = true) {
  const rows = new Map<string, Record<string, unknown>>();
  const snapshot = (path: string) => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  let queue = Promise.resolve();
  const db: TronClassSubmissionFirestore = {
    doc: path => ({ path, get: async () => snapshot(path) }),
    runTransaction(run) {
      const result = queue.then(async () => {
        const writes: Array<[string, Record<string, unknown>]> = [];
        const value = await run({
          get: async ref => {
            if (writes.length) throw new Error('read after write');
            return snapshot(ref.path);
          },
          set: (ref, data) => { writes.push([ref.path, structuredClone(data)]); },
        });
        for (const [path, data] of writes) rows.set(path, data);
        return value;
      });
      queue = result.then(() => {}, () => {});
      return result;
    },
  };
  const binding: TronClassSubmissionBinding = { schoolId: 'pu', userId: 303, account: 'synthetic-account', userName: null,
    revision: REVISION, expiresAt: new Date(NOW + 3_600_000).toISOString(),
    cookies: { session: 'synthetic-cookie', 'XSRF-TOKEN': 'synthetic-csrf' } };
  const bindingPath = `_tronClassBindings/${createHash('sha256').update(OWNER).digest('hex')}`;
  rows.set(bindingPath, {
    ownerKey: OWNER, schoolId: 'pu', userId: 303, revision: REVISION, state: 'connected',
    expiresAt: NOW + 3_600_000, updatedAt: NOW,
  });
  const bindings = {
    requireBinding: vi.fn(async (owner: string, sourceRevision?: string) => {
      if (owner !== OWNER) throw new NuniError(401, 'TRONCLASS_NOT_CONNECTED');
      if (sourceRevision !== undefined && sourceRevision !== binding.revision)
        throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
      return structuredClone(binding);
    }),
    getStatus: async () => ({ schoolId: 'pu', connected: true, revision: binding.revision }),
    assertCurrent: async (owner: string, revision: string) => {
      if (owner !== OWNER || revision !== binding.revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
    },
  };
  const assignment: TronClassAssignment = { ...SCOPE, studentId: 303, title: '合成作業', description: '合成說明',
    deadline: null, opensAt: null, permissionKnown: true, individual: true, canSubmit: true, isClosed: false,
    allowLate: false, allowsText: true, allowsAttachments: true, maxFiles: 4, maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 20 * 1024 * 1024, remainingAttempts: 1, allowedContentTypes: ['application/pdf'] };
  const prepared: TronClassPreparedSubmission = { source: 'tronclass', schoolId: 'pu', ...SCOPE, revision: REVISION,
    title: assignment.title, description: assignment.description, deadline: null,
    canSubmit: false, blockedReason: '正式來源尚未啟用', maxFiles: 4, maxFileBytes: assignment.maxFileBytes,
    allowedContentTypes: ['application/pdf'], rules: { status: 'unknown' }, receipt: null };
  let finalRow: Record<string, unknown> | null = null;
  let missingReadback = false;
  let enabled = true;
  let callbackComplete = false;
  let binaryComplete = false;
  let finalPosts = 0;
  const fetchSchool: FetchLike = vi.fn(async (url, init = {}) => {
    expect(new URL(url).origin).toBe('https://tronclass.pu.edu.tw');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const path = new URL(url).pathname;
    if (path === '/api/uploads') return json({ ...body, id: 601, storage_type: 'S3', transcoder: 'WRPC', upload_url: TARGET.url });
    if (path === '/internal-api/upload/callback/601') {
      expect(binaryComplete).toBe(true);
      callbackComplete = true;
      return new Response(null, { status: 204 });
    }
    expect(path).toBe('/api/course/activities/202/submissions');
    expect(callbackComplete).toBe(true);
    expect(body.uploads).toEqual([601]);
    finalPosts++;
    finalRow = { id: 501, course_id: 101, activity_id: 202, created_by: { id: 303 },
      is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
      comment: body.comment, uploads: [{ id: 601, name: '作業.pdf', size: BYTES.byteLength }],
      created_at: '2026-11-18T06:00:00Z', other_resources: [], slide_references: [] };
    return json({ submission: finalRow, student: { id: 303 } });
  });
  const fetchStorage: FetchLike = vi.fn(async (url, init = {}) => {
    expect(url).toBe(TARGET.url);
    expect(init).toMatchObject({ method: 'PUT', credentials: 'omit', redirect: 'manual' });
    expect(new Headers(init.headers).has('Cookie')).toBe(false);
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(BYTES);
    binaryComplete = true;
    return new Response(null, { status: 204 });
  });
  const readonlyPrepare = vi.fn(async () => structuredClone(prepared));
  const readHistory = vi.fn(async (owner: string) => {
    expect(owner).toBe(OWNER);
    return { list: !missingReadback && finalRow ? [structuredClone(finalRow)] : [] };
  });
  const service = createTronClassPublicSubmissionService({
    db, bindings, now: () => NOW, readonlyPrepare,
    legacyReconcile: async () => { throw new Error('v2 must not use v1'); },
    enabled: () => enabled, contractVerified,
    authorization: async (owner, _scope, _signal, expected) => ({
      binding: await bindings.requireBinding(owner, typeof expected === 'string' ? expected : expected?.revision),
      assignment: structuredClone(assignment),
      mode: 'normal', historyComplete: true, priorSubmissionIds: finalRow ? [501] : [], userSubmitCount: finalRow ? 1 : 0,
      ordinaryWindowConfirmed: true, prerequisitesConfirmed: true }),
    resolveStorageTarget: async evidence => evidence.uploadId === TARGET.uploadId && evidence.url === TARGET.url && evidence.mode === TARGET.mode
      ? { ...TARGET } : null,
    readHistory,
    fetchSchool, fetchStorage,
  });
  const authenticate = vi.fn(async () => ({ ownerKey: OWNER, provider: 'platform' }));
  const dependencies = { bindings, authenticate, submissions: async () => service, rateLimit: () => {} } as unknown as TronClassRouteDependencies;
  const post = (body: unknown) => handleTronClassIntegration(new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), dependencies);
  const uploadRequest = () => {
    const query = new URLSearchParams({ courseId: '101', homeworkId: '202', revision: REVISION,
      operationId: OPERATION, fileId: FILE, name: '作業.pdf' });
    return new NextRequest(`https://nuni.tw/api/tronclass?${query}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: BYTES,
    });
  };
  const submit = () => post({ action: 'submit', ...SCOPE, revision: REVISION, operationId: OPERATION,
    content: '我的 <報告>\n合成附件', attachments: [FILE], confirmed: true });
  const upload = (request = uploadRequest()) => handleTronClassIntegration(request, dependencies);
  return { post, upload, uploadRequest, submit, rows, fetchSchool, fetchStorage, bindings, readonlyPrepare, readHistory,
    replaceBinding: () => {
      binding.revision = 'b'.repeat(32);
      binding.userId = 404;
      rows.set(bindingPath, { ...rows.get(bindingPath), revision: binding.revision, userId: binding.userId });
      return binding.revision;
    },
    finalPosts: () => finalPosts,
    setMissingReadback: (value: boolean) => { missingReadback = value; }, disable: () => { enabled = false; } };
}

beforeEach(() => vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe('public HTTP to durable v2 school workflow', () => {
  const cancelInput = { action: 'cancel-preparation', ...SCOPE, revision: REVISION, operationId: OPERATION };

  it.each([
    { action: 'prepare', ...SCOPE, revision: REVISION },
    { action: 'reconcile', revision: REVISION, operationId: OPERATION },
    { action: 'submit', ...SCOPE, revision: REVISION, operationId: OPERATION,
      content: '合成答案', attachments: [], confirmed: true },
    cancelInput,
    null,
  ])('blocks stale coursework operations before accessing the replacement session %#', async input => {
    const s = environment();
    const replacement = s.replaceBinding();
    expect(await (await s.post({ action: 'status' })).json()).toMatchObject({ connected: true, revision: replacement });
    const response = input ? await s.post(input) : await s.upload();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'TRONCLASS_BINDING_CHANGED' });
    if (input) expect(s.bindings.requireBinding).toHaveBeenCalledWith(OWNER, REVISION);
    expect(s.readonlyPrepare).not.toHaveBeenCalled();
    expect(s.readHistory).not.toHaveBeenCalled();
    expect(s.fetchSchool).not.toHaveBeenCalled();
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: false, contractVerified: true, error: 'TRONCLASS_WRITES_DISABLED' },
    { enabled: true, contractVerified: false, error: 'TRONCLASS_SUBMISSION_UNAVAILABLE' },
  ])('rejects PUT with $error before accessing the attachment body', async ({ enabled, contractVerified, error }) => {
    const s = environment(contractVerified);
    if (!enabled) s.disable();
    const request = s.uploadRequest();
    const body = vi.spyOn(request, 'body', 'get');
    const response = await s.upload(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error });
    expect(body).not.toHaveBeenCalled();
    expect(s.fetchSchool).not.toHaveBeenCalled();
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it('stops an upload-only preparation and blocks delayed final and upload calls without school writes', async () => {
    const s = environment();
    expect((await s.upload()).status).toBe(200);
    const calls = vi.mocked(s.fetchSchool).mock.calls.length;
    const stopped = await s.post(cancelInput);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ status: 'cancelled', operationId: OPERATION, ...SCOPE });
    expect((await s.submit()).status).toBe(409);
    expect((await s.upload()).status).toBe(409);
    expect(s.fetchSchool).toHaveBeenCalledTimes(calls);
    expect(s.finalPosts()).toBe(0);
    expect([...s.rows.values()].find(row => row.operationId === OPERATION)).toMatchObject({ state: 'cancelled', purgeAt: null });
    expect([...s.rows.keys()].some(path => path.startsWith('_tronClassSubmissionLocks/'))).toBe(false);
  });

  it.each([
    { enabled: false, contractVerified: true },
    { enabled: true, contractVerified: false },
  ])('returns a no-op cancellation for a missing operation when writes are blocked (%j)', async ({ enabled, contractVerified }) => {
    const s = environment(contractVerified);
    if (!enabled) s.disable();
    const before = structuredClone([...s.rows]);
    expect(await (await s.post(cancelInput)).json()).toEqual({ status: 'cancelled', operationId: OPERATION, ...SCOPE });
    expect(await (await s.post(cancelInput)).json()).toEqual({ status: 'cancelled', operationId: OPERATION, ...SCOPE });
    expect(s.fetchSchool).not.toHaveBeenCalled();
    expect(s.fetchStorage).not.toHaveBeenCalled();
    expect([...s.rows]).toEqual(before);
  });

  it('still cancels an existing preparation after school writes are disabled', async () => {
    const s = environment();
    expect((await s.upload()).status).toBe(200);
    const calls = vi.mocked(s.fetchSchool).mock.calls.length;
    s.disable();
    expect(await (await s.post(cancelInput)).json()).toEqual({ status: 'cancelled', operationId: OPERATION, ...SCOPE });
    expect([...s.rows.values()].find(row => row.operationId === OPERATION)).toMatchObject({ state: 'cancelled' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(calls);
  });

  it('cannot turn an already attempted final into editable work or release its persistent lock', async () => {
    const s = environment();
    s.setMissingReadback(true);
    expect((await s.upload()).status).toBe(200);
    expect(await (await s.submit()).json()).toMatchObject({ status: 'unknown' });
    const before = structuredClone([...s.rows]);
    const calls = vi.mocked(s.fetchSchool).mock.calls.length;
    s.disable();
    expect(await (await s.post(cancelInput)).json()).toEqual({ status: 'unknown', operationId: OPERATION, ...SCOPE });
    expect([...s.rows]).toEqual(before);
    expect(s.fetchSchool).toHaveBeenCalledTimes(calls);
    expect(s.finalPosts()).toBe(1);
  });

  it('prepares, transfers one attachment, submits and exposes only a scoped acknowledged confirmation', async () => {
    const s = environment();
    const prepare = await s.post({ action: 'prepare', ...SCOPE, revision: REVISION });
    expect(prepare.status).toBe(200);
    expect(await prepare.json()).toMatchObject({ ...SCOPE, canSubmit: true, rules: { status: 'confirmed' } });
    const upload = await s.upload();
    expect(upload.status).toBe(200);
    expect(await upload.json()).toEqual({ fileId: FILE, name: '作業.pdf', contentType: 'application/pdf', size: BYTES.byteLength,
      sha256: createHash('sha256').update(BYTES).digest('hex'), status: 'uploaded' });
    const submit = await s.submit();
    expect(submit.status).toBe(200);
    const result = await submit.json();
    expect(result).toMatchObject({ status: 'confirmed', operationId: OPERATION, receipt: null,
      confirmation: { ...SCOPE, submissionId: 501, confirmedAt: new Date(NOW).toISOString() } });
    expect(JSON.stringify(result)).not.toMatch(/submittedAt|studentId|ownerKey|cookie|csrf|uploadId|storage|報告/);
    expect(submit.headers.get('cache-control')).toBe('no-store, private');
    const records = [...s.rows].filter(([path]) => path.startsWith('_tronClassSubmissionOperations/'));
    expect(records).toHaveLength(1);
    expect(records[0][1]).toMatchObject({ version: 2, operationId: OPERATION });
    expect(s.finalPosts()).toBe(1);
  });

  it('retains an uncertain v2 operation, then reconciles the same ID with writes disabled and no duplicate POST', async () => {
    const s = environment();
    s.setMissingReadback(true);
    expect((await s.upload()).status).toBe(200);
    expect(await (await s.submit()).json()).toEqual({ status: 'unknown', operationId: OPERATION, receipt: null });
    s.disable();
    s.setMissingReadback(false);
    const requests = vi.mocked(s.fetchSchool).mock.calls.length;
    const result = await s.post({ action: 'reconcile', operationId: OPERATION, revision: REVISION });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ status: 'confirmed', operationId: OPERATION });
    expect(s.fetchSchool).toHaveBeenCalledTimes(requests);
    expect(s.finalPosts()).toBe(1);
    expect([...s.rows.keys()].some(path => path.startsWith('_tronClassSubmissionLocks/'))).toBe(true);
  });
});
