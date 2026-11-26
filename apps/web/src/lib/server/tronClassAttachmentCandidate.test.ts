// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { FetchLike } from './puEdgeRelay';
import {
  createTronClassAttachmentUploadCandidate,
  type TronClassAttachmentCandidateAuthorization,
  type TronClassAttachmentCandidateDependencies,
  type TronClassAttachmentCandidateInput,
  type TronClassAttachmentClaim,
  type TronClassPinnedUploadTarget,
  type TronClassUploadTargetEvidence,
} from './tronClassAttachmentCandidate';

// All payloads, identities and responses are synthetic. No school writes occur.
const NOW = Date.parse('2026-11-17T06:00:00.000Z');
const OWNER = 'firebase:synthetic-owner';
const ORIGIN = 'https://tronclass.pu.edu.tw';
const STORAGE = 'https://storage.example.test/objects/40?signature=synthetic-private-signature';
const REVISION = 'a'.repeat(32);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function input(): TronClassAttachmentCandidateInput {
  return { courseId: 10, homeworkId: 20, revision: REVISION,
    operationId: 'operation_fixture_01', fileId: 'file_fixture_001',
    name: '課程作業.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('校方作業內容\n第二行') };
}
function authorization(): TronClassAttachmentCandidateAuthorization {
  return {
    binding: { schoolId: 'pu', userId: 30, account: 'synthetic-account', userName: null,
      revision: REVISION, expiresAt: '2026-11-17T07:00:00.000Z',
      cookies: { session: 'synthetic-private-cookie', 'XSRF-TOKEN': 'synthetic%2Dcsrf' } },
    assignment: { courseId: 10, homeworkId: 20, studentId: 30, title: '合成作業', description: '',
      deadline: '2026-11-17T08:00:00.000Z', opensAt: null, permissionKnown: true, individual: true,
      canSubmit: true, isClosed: false, allowLate: false, remainingAttempts: 1,
      allowsText: true, allowsAttachments: true, maxFiles: 4, maxFileBytes: 1024, maxTotalBytes: 4096,
      allowedContentTypes: ['text/plain'] },
    mode: 'normal', ordinaryWindowConfirmed: true, prerequisitesConfirmed: true,
  };
}
function metadata(file = input(), url = STORAGE, kind: 'raw' | 'multipart' = 'raw') {
  return { id: 40, name: file.name, size: file.bytes.byteLength, upload_url: url,
    storage_type: kind === 'raw' ? 'S3' : 'MEDIA', transcoder: kind === 'raw' ? 'WRPC' : null,
    created_at: '2026-11-17T06:00:00Z', status: 'synthetic-unverified', private_field: 'never-return-this' };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function setup(options: { kind?: 'raw' | 'multipart'; url?: string; value?: TronClassAttachmentCandidateAuthorization } = {}) {
  const file = input();
  const value = options.value ?? authorization();
  const raw = metadata(file, options.url ?? STORAGE, options.kind ?? 'raw');
  const enabled = vi.fn(() => true);
  const authorize = vi.fn<TronClassAttachmentCandidateDependencies['authorize']>(async () => value);
  const assertCurrent = vi.fn(async () => {});
  const claims = new Map<string, TronClassAttachmentClaim>();
  const claim = vi.fn(async (entry: TronClassAttachmentClaim) => {
    const key = JSON.stringify([entry.ownerKey, entry.operationId, entry.fileId]);
    if (claims.has(key)) return false;
    claims.set(key, entry);
    return true;
  });
  const resolveStorageTarget = vi.fn(async (evidence: TronClassUploadTargetEvidence): Promise<TronClassPinnedUploadTarget | null> => {
    // A synthetic independently pinned object, not an origin-only policy.
    if (evidence.uploadId !== 40 || evidence.url !== (options.url ?? STORAGE)) return null;
    return { uploadId: 40, url: options.url ?? STORAGE, mode: options.kind ?? 'raw' };
  });
  const fetchSchool = vi.fn<FetchLike>(async (url) => {
    if (url === `${ORIGIN}/api/uploads`) return json(raw, 201);
    if (url === `${ORIGIN}/internal-api/upload/callback/40`) return new Response(null, { status: 204 });
    throw new Error('Unexpected school URL');
  });
  const fetchStorage = vi.fn<FetchLike>(async () => new Response(null, { status: 200 }));
  const dependencies = { enabled, authorize, assertCurrent, claim, resolveStorageTarget, fetchSchool, fetchStorage, now: () => NOW };
  return { ...dependencies, file, value, raw, claims, dependencies,
    candidate: createTronClassAttachmentUploadCandidate(dependencies) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('controlled attachment transfer', () => {
  it('is disabled and unverified by default with no authorization or network work', async () => {
    const s = setup();
    const candidate = createTronClassAttachmentUploadCandidate({ ...s.dependencies, enabled: undefined });
    expect(candidate.contractVerified).toBe(false);
    expect(Object.isFrozen(candidate)).toBe(true);
    await expect(candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_DISABLED' });
    expect(s.authorize).not.toHaveBeenCalled();
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.fetchSchool).not.toHaveBeenCalled();
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it.each(['authorize', 'assertCurrent', 'claim', 'resolveStorageTarget'] as const)('requires the %s server dependency', key => {
    const s = setup();
    expect(() => createTronClassAttachmentUploadCandidate({ ...s.dependencies, [key]: undefined } as unknown as TronClassAttachmentCandidateDependencies))
      .toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
  });

  it('persists a claim before metadata, transfers exact bytes, then callbacks with no receipt claim', async () => {
    const s = setup();
    const stages: string[] = [];
    s.claim.mockImplementationOnce(async claim => { stages.push('claim'); expect(Object.isFrozen(claim)).toBe(true); return true; });
    s.fetchSchool.mockImplementation(async url => { stages.push(url.endsWith('/api/uploads') ? 'metadata' : 'callback'); return url.endsWith('/api/uploads') ? json(s.raw) : new Response(null, { status: 204 }); });
    s.fetchStorage.mockImplementationOnce(async () => { stages.push('binary'); return new Response(null, { status: 201 }); });
    const result = await s.candidate.dispatch(OWNER, s.file);
    expect(stages).toEqual(['claim', 'metadata', 'binary', 'callback']);
    expect(s.authorize).toHaveBeenCalledExactlyOnceWith(OWNER, { courseId: 10, homeworkId: 20 },
      expect.any(AbortSignal), s.file.revision);
    expect(result).toEqual({ state: 'transferred', confirmation: 'awaiting-confirmation', ownerKey: OWNER,
      uploadId: 40, courseId: 10, homeworkId: 20, studentId: 30, revision: REVISION,
      operationId: s.file.operationId, fileId: s.file.fileId, name: s.file.name,
      contentType: 'text/plain', size: s.file.bytes.byteLength, sha256: digest(s.file.bytes) });
    for (const property of ['receipt', 'submittedAt', 'url', 'cookies', 'private_field']) expect(result).not.toHaveProperty(property);
    const [url, request] = s.fetchStorage.mock.calls[0];
    expect(url).toBe(STORAGE);
    expect(request).toMatchObject({ method: 'PUT', redirect: 'manual', credentials: 'omit', cache: 'no-store' });
    expect(new Uint8Array(request!.body as ArrayBuffer)).toEqual(s.file.bytes);
    const storageHeaders = new Headers(request!.headers);
    for (const header of ['cookie', 'authorization', 'x-xsrf-token', 'origin', 'referer']) expect(storageHeaders.has(header)).toBe(false);
    expect(storageHeaders.get('content-type')).toBe('text/plain');
    const [metaUrl, metaRequest] = s.fetchSchool.mock.calls[0];
    expect(metaUrl).toBe(`${ORIGIN}/api/uploads`);
    expect(JSON.parse(String(metaRequest!.body))).toMatchObject({ name: s.file.name, size: s.file.bytes.byteLength, parent_id: 0 });
    expect(new Headers(metaRequest!.headers).get('cookie')).toContain('session=synthetic-private-cookie');
    expect(new Headers(metaRequest!.headers).get('x-xsrf-token')).toBe('synthetic-csrf');
    expect(s.fetchSchool.mock.calls[1][0]).toBe(`${ORIGIN}/internal-api/upload/callback/40`);
    expect(JSON.parse(String(s.fetchSchool.mock.calls[1][1]!.body))).toEqual({ file_key: 40 });
  });

  it('requires an exact same-origin storage object, sends encoded multipart, and omits credentials and callback', async () => {
    const s = setup({ kind: 'multipart', url: `${ORIGIN}/storage/objects/40` });
    const result = await s.candidate.dispatch(OWNER, s.file);
    expect(result.state).toBe('transferred');
    expect(s.fetchSchool).toHaveBeenCalledTimes(1);
    const [url, request] = s.fetchStorage.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/storage/objects/40`);
    const headers = new Headers(request!.headers);
    expect(headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('x-xsrf-token')).toBe(false);
    const decoded = await new Request(url, { method: 'PUT', headers, body: request!.body }).formData();
    const file = decoded.get('file') as File;
    expect(file.name).toBe(s.file.name);
    expect(file.type).toBe('text/plain');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(s.file.bytes);
    expect([...decoded.keys()]).toEqual(['file']);
  });

  it.each(['same-instance', 'new-instance', 'changed-bytes', 'changed-name', 'changed-revision'])('uses the persistent claim for %s replay rejection', async kind => {
    const s = setup();
    await s.candidate.dispatch(OWNER, s.file);
    const other = kind === 'same-instance' ? s.candidate : createTronClassAttachmentUploadCandidate(s.dependencies);
    const again = { ...s.file };
    if (kind === 'changed-bytes') again.bytes = new TextEncoder().encode('different content');
    if (kind === 'changed-name') again.name = 'another-name.txt';
    if (kind === 'changed-revision') { again.revision = 'b'.repeat(32); s.value.binding.revision = again.revision; }
    await expect(other.dispatch(OWNER, again)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_ALREADY_DISPATCHED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(2);
    expect(s.fetchStorage).toHaveBeenCalledTimes(1);
  });

  it('allows only one of two processes to transfer the same file claim', async () => {
    const s = setup();
    const other = createTronClassAttachmentUploadCandidate(s.dependencies);
    const results = await Promise.allSettled([s.candidate.dispatch(OWNER, s.file), other.dispatch(OWNER, s.file)]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected')).toHaveLength(1);
    expect(s.fetchStorage).toHaveBeenCalledTimes(1);
    expect(s.claims.size).toBe(1);
  });

  it('never returns to metadata after a failed binary attempt', async () => {
    const s = setup();
    s.fetchStorage.mockRejectedValueOnce(new Error('upstream private signature'));
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    const other = createTronClassAttachmentUploadCandidate(s.dependencies);
    await expect(other.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_ALREADY_DISPATCHED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(1);
    expect(s.fetchStorage).toHaveBeenCalledTimes(1);
  });

  it('copies file bytes and parameters before awaiting authorization', async () => {
    const s = setup();
    const before = Uint8Array.from(s.file.bytes);
    const originalName = s.file.name;
    s.authorize.mockImplementationOnce(async () => { s.file.bytes.fill(0); s.file.name = 'mutated.txt'; s.file.fileId = 'another_file_001'; return s.value; });
    const result = await s.candidate.dispatch(OWNER, s.file);
    expect(result).toMatchObject({ name: originalName, sha256: digest(before), fileId: 'file_fixture_001' });
    expect(new Uint8Array(s.fetchStorage.mock.calls[0][1]!.body as ArrayBuffer)).toEqual(before);
  });

  it.each([
    ['unknown permission', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.permissionKnown = false; }],
    ['different student', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.studentId = 31; }],
    ['different course', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.courseId = 11; }],
    ['different activity', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.homeworkId = 21; }],
    ['group assignment', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.individual = false; }],
    ['attachments forbidden', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.allowsAttachments = false; }],
    ['closed assignment', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.isClosed = true; }],
    ['no attempts', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.remainingAttempts = 0; }],
    ['zero file count', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.maxFiles = 0; }],
    ['zero total bytes', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.maxTotalBytes = 0; }],
    ['oversized file', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.maxFileBytes = 1; }],
    ['forbidden type', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.allowedContentTypes = ['application/pdf']; }],
    ['unknown window', (a: TronClassAttachmentCandidateAuthorization) => { a.ordinaryWindowConfirmed = false; }],
    ['unknown prerequisites', (a: TronClassAttachmentCandidateAuthorization) => { a.prerequisitesConfirmed = false; }],
    ['future opening', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.opensAt = '2026-11-17T07:00:00Z'; }],
    ['past deadline even if late allowed', (a: TronClassAttachmentCandidateAuthorization) => { a.assignment.deadline = '2026-11-17T05:00:00Z'; a.assignment.allowLate = true; }],
  ])('stops %s before a durable claim or any write', async (_label, alter) => {
    const s = setup();
    alter(s.value);
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.fetchSchool).not.toHaveBeenCalled();
  });

  it.each(['bad-revision', 'empty-bytes', 'bad-filename', 'injected-url', 'bad-mime', 'short-operation', 'oversized-bytes'])('rejects %s without reading school identity', async kind => {
    const s = setup();
    const file = { ...s.file } as TronClassAttachmentCandidateInput & { url?: string };
    if (kind === 'bad-revision') file.revision = 'bad';
    if (kind === 'empty-bytes') file.bytes = new Uint8Array();
    if (kind === 'bad-filename') file.name = '../name';
    if (kind === 'injected-url') file.url = STORAGE;
    if (kind === 'bad-mime') file.contentType = 'text/plain\r\nInjected: true';
    if (kind === 'short-operation') file.operationId = 'bad';
    if (kind === 'oversized-bytes') file.bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(s.candidate.dispatch(OWNER, file)).rejects.toMatchObject({ code: 'TRONCLASS_PROTOCOL_INVALID_INPUT' });
    expect(s.authorize).not.toHaveBeenCalled();
  });

  it('uses the same optional XSRF policy for metadata and callback, without sending school cookies to storage', async () => {
    const s = setup();
    delete s.value.binding.cookies['XSRF-TOKEN'];
    await expect(s.candidate.dispatch(OWNER, s.file)).resolves.toMatchObject({ state: 'transferred' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(2);
    for (const [, request] of s.fetchSchool.mock.calls) {
      const headers = new Headers(request?.headers);
      expect(headers.has('X-XSRF-TOKEN')).toBe(false);
      expect(headers.get('Cookie')).toBe('session=synthetic-private-cookie');
    }
    const [, request] = s.fetchStorage.mock.calls[0];
    expect(new Headers(request?.headers).has('Cookie')).toBe(false);
    expect(s.candidate.contractVerified).toBe(false);
  });

  it.each(['bad-percent-token', 'cookie-injection', 'token-newline'])('rejects %s before creating upload metadata', async kind => {
    const s = setup();
    if (kind === 'bad-percent-token') s.value.binding.cookies['XSRF-TOKEN'] = '%xx';
    if (kind === 'cookie-injection') s.value.binding.cookies.session = 'value; another=session';
    if (kind === 'token-newline') s.value.binding.cookies['XSRF-TOKEN'] = 'bad%0atoken';
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toBeInstanceOf(NuniError);
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.fetchSchool).not.toHaveBeenCalled();
  });

  it.each([
    ['wrapper', (raw: Record<string, unknown>) => ({ upload: raw })],
    ['missing ID', (raw: Record<string, unknown>) => ({ ...raw, id: undefined })],
    ['string ID', (raw: Record<string, unknown>) => ({ ...raw, id: '40' })],
    ['different name', (raw: Record<string, unknown>) => ({ ...raw, name: 'wrong.txt' })],
    ['different size', (raw: Record<string, unknown>) => ({ ...raw, size: 900 })],
    ['wrong parent', (raw: Record<string, unknown>) => ({ ...raw, parent_id: 500 })],
    ['missing URL', (raw: Record<string, unknown>) => ({ ...raw, upload_url: undefined })],
    ['QINIU', (raw: Record<string, unknown>) => ({ ...raw, storage_type: 'QINIU' })],
    ['CHINAMCLOUD', (raw: Record<string, unknown>) => ({ ...raw, storage_type: 'CHINAMCLOUD' })],
    ['invented LOCAL enum', (raw: Record<string, unknown>) => ({ ...raw, storage_type: 'LOCAL' })],
    ['S3 without WRPC', (raw: Record<string, unknown>) => ({ ...raw, transcoder: null })],
    ['missing storage', (raw: Record<string, unknown>) => ({ ...raw, storage_type: undefined })],
  ])('does not send bytes for %s metadata', async (_label, change) => {
    const s = setup();
    s.fetchSchool.mockResolvedValueOnce(json(change(s.raw)));
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(1);
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it('accepts absent metadata size only as a transfer acknowledgment, not source byte verification', async () => {
    const s = setup();
    s.fetchSchool.mockResolvedValueOnce(json({ ...s.raw, size: undefined }));
    const result = await s.candidate.dispatch(OWNER, s.file);
    expect(result).toMatchObject({ state: 'transferred', confirmation: 'awaiting-confirmation' });
    expect(result).not.toHaveProperty('bytesVerified');
  });

  it.each([
    `${ORIGIN}/api/uploads/40`, `${ORIGIN}/internal-api/upload/callback/40`, `${ORIGIN}/%61pi/uploads/40`,
    `${ORIGIN}//api/uploads/40`, `${ORIGIN}/storage/../api/uploads/40`, `${ORIGIN}/storage/%252fapi`,
    `${ORIGIN}/login`, 'http://storage.example.test/object/40', 'https://127.0.0.1/object/40',
    'https://[::1]/object/40', 'https://localhost/object/40', 'https://object.internal/object/40',
    'https://user:secret@storage.example.test/object/40', `${STORAGE}#secret`,
    'https://storage.example.test:8443/object/40', '/relative/object/40',
  ])('rejects unsafe metadata target %s even with an accepting policy', async url => {
    const s = setup({ url });
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchStorage).not.toHaveBeenCalled();
    expect(s.fetchSchool).toHaveBeenCalledTimes(1);
  });

  it.each(['unapproved', 'wrong-object', 'wrong-id', 'wrong-mode', 'extra-headers'])('requires exact policy agreement: %s', async kind => {
    const s = setup();
    const target = { uploadId: 40, url: STORAGE, mode: 'raw' as const };
    if (kind === 'unapproved') s.resolveStorageTarget.mockResolvedValueOnce(null);
    if (kind === 'wrong-object') s.resolveStorageTarget.mockResolvedValueOnce({ ...target, url: STORAGE.replace('/40?', '/41?') });
    if (kind === 'wrong-id') s.resolveStorageTarget.mockResolvedValueOnce({ ...target, uploadId: 41 });
    if (kind === 'wrong-mode') s.resolveStorageTarget.mockResolvedValueOnce({ ...target, mode: 'multipart' });
    if (kind === 'extra-headers') s.resolveStorageTarget.mockResolvedValueOnce({ ...target, headers: { Cookie: 'unsafe' } } as TronClassPinnedUploadTarget);
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it.each(['metadata', 'binary', 'callback'] as const)('does not retry/follow redirects from %s', async stage => {
    const s = setup();
    const redirected = () => new Response('private upstream body', { status: 307, headers: { Location: 'https://untrusted.example.test/' } });
    if (stage === 'metadata') s.fetchSchool.mockResolvedValueOnce(redirected());
    if (stage === 'binary') s.fetchStorage.mockResolvedValueOnce(redirected());
    if (stage === 'callback') s.fetchSchool.mockResolvedValueOnce(json(s.raw)).mockResolvedValueOnce(redirected());
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(stage === 'callback' ? 2 : 1);
    expect(s.fetchStorage).toHaveBeenCalledTimes(stage === 'metadata' ? 0 : 1);
  });

  it.each([401, 403])('requires reconnection after school HTTP %s and stops before bytes', async status => {
    const s = setup();
    s.fetchSchool.mockResolvedValueOnce(new Response('sensitive', { status }));
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it('does not confuse storage rejection with a school-session failure', async () => {
    const s = setup();
    s.fetchStorage.mockResolvedValueOnce(new Response('private signature expired', { status: 403 }));
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(1);
  });

  it.each(['metadata', 'binary', 'callback'] as const)('bounds the %s body before acknowledging transfer', async stage => {
    const s = setup();
    const huge = () => new Response('secret', { headers: { 'content-type': 'application/json', 'content-length': String(1024 * 1024 + 1) } });
    if (stage === 'metadata') s.fetchSchool.mockResolvedValueOnce(huge());
    if (stage === 'binary') s.fetchStorage.mockResolvedValueOnce(huge());
    if (stage === 'callback') s.fetchSchool.mockResolvedValueOnce(json(s.raw)).mockResolvedValueOnce(huge());
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(stage === 'callback' ? 2 : 1);
  });

  it.each(['invalid-json', 'wrong-type', 'truncated', 'compressed', 'oversized-stream'])('rejects %s metadata without exposing it', async kind => {
    const s = setup();
    let response: Response;
    if (kind === 'oversized-stream') response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); controller.close(); } }), { headers: { 'content-type': 'application/json' } });
    else response = new Response(kind === 'invalid-json' ? 'private school JSON {' : JSON.stringify(s.raw), { headers: {
      'content-type': kind === 'wrong-type' ? 'text/html' : 'application/json',
      ...(kind === 'truncated' ? { 'content-length': '9000' } : {}),
      ...(kind === 'compressed' ? { 'content-encoding': 'gzip' } : {}),
    } });
    s.fetchSchool.mockResolvedValueOnce(response);
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ message: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it.each(['authorization', 'claim', 'policy', 'metadata', 'binary', 'callback'] as const)('aborts a stalled %s phase and cannot continue later', async phase => {
    vi.useFakeTimers();
    const s = setup();
    let resume: (() => void) | undefined;
    const stall = <T>(value: T) => new Promise<T>(resolve => { resume = () => resolve(value); });
    if (phase === 'authorization') s.authorize.mockImplementationOnce(() => stall(s.value));
    if (phase === 'claim') s.claim.mockImplementationOnce(() => stall(true));
    if (phase === 'policy') s.resolveStorageTarget.mockImplementationOnce(() => stall({ uploadId: 40, url: STORAGE, mode: 'raw' }));
    if (phase === 'metadata') s.fetchSchool.mockImplementationOnce(() => stall(json(s.raw)));
    if (phase === 'binary') s.fetchStorage.mockImplementationOnce(() => stall(new Response(null, { status: 200 })));
    if (phase === 'callback') s.fetchSchool.mockResolvedValueOnce(json(s.raw)).mockImplementationOnce(() => stall(new Response(null, { status: 204 })));
    const candidate = createTronClassAttachmentUploadCandidate({ ...s.dependencies, timeoutMs: 20 });
    const rejected = expect(candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    const schoolCalls = s.fetchSchool.mock.calls.length;
    const binaryCalls = s.fetchStorage.mock.calls.length;
    resume?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.fetchSchool).toHaveBeenCalledTimes(schoolCalls);
    expect(s.fetchStorage).toHaveBeenCalledTimes(binaryCalls);
    for (const [, request] of [...s.fetchSchool.mock.calls, ...s.fetchStorage.mock.calls]) expect(request!.signal!.aborted).toBe(true);
  });

  it('cancels a stalled metadata response stream and never starts bytes', async () => {
    vi.useFakeTimers();
    const s = setup();
    const cancel = vi.fn();
    s.fetchSchool.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }));
    const candidate = createTronClassAttachmentUploadCandidate({ ...s.dependencies, timeoutMs: 20 });
    const rejected = expect(candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_CANDIDATE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(cancel).toHaveBeenCalled();
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it('stops the authorization source on caller cancellation without claiming or uploading', async () => {
    const s = setup();
    const caller = new AbortController();
    const sourceStopped = vi.fn();
    let started!: () => void;
    const sourceStarted = new Promise<void>(resolve => { started = resolve; });
    s.authorize.mockImplementationOnce((_owner, _scope, signal) => {
      const pending = new Promise<TronClassAttachmentCandidateAuthorization>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          sourceStopped();
          reject(new DOMException('Cancelled', 'AbortError'));
        }, { once: true });
      });
      started();
      return pending;
    });
    const rejected = expect(s.candidate.dispatch(OWNER, s.file, caller.signal))
      .rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_CANCELLED' });
    await sourceStarted;
    caller.abort();
    await rejected;
    expect(sourceStopped).toHaveBeenCalledTimes(1);
    expect(s.authorize.mock.calls[0][2]?.aborted).toBe(true);
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.resolveStorageTarget).not.toHaveBeenCalled();
    expect(s.fetchSchool).not.toHaveBeenCalled();
    expect(s.fetchStorage).not.toHaveBeenCalled();
  });

  it.each(['before-start', 'after-metadata', 'after-binary'] as const)('honors caller cancellation %s without callback/retry', async when => {
    const s = setup();
    const controller = new AbortController();
    if (when === 'before-start') controller.abort();
    if (when === 'after-metadata') s.fetchSchool.mockImplementationOnce(async () => { controller.abort(); return json(s.raw); });
    if (when === 'after-binary') s.fetchStorage.mockImplementationOnce(async () => { controller.abort(); return new Response(null, { status: 200 }); });
    await expect(s.candidate.dispatch(OWNER, s.file, controller.signal)).rejects.toMatchObject({ code: 'TRONCLASS_UPLOAD_CANCELLED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(when === 'before-start' ? 0 : 1);
    expect(s.fetchStorage).toHaveBeenCalledTimes(when === 'after-binary' ? 1 : 0);
  });

  it.each(['after-claim', 'after-metadata', 'after-binary'] as const)('checks binding revision %s and stops the next write', async when => {
    const s = setup();
    let changed = false;
    s.assertCurrent.mockImplementation(async () => { if (changed) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED'); });
    if (when === 'after-claim') s.claim.mockImplementationOnce(async () => { changed = true; return true; });
    if (when === 'after-metadata') s.fetchSchool.mockImplementationOnce(async () => { changed = true; return json(s.raw); });
    if (when === 'after-binary') s.fetchStorage.mockImplementationOnce(async () => { changed = true; return new Response(null, { status: 200 }); });
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(when === 'after-claim' ? 0 : 1);
    expect(s.fetchStorage).toHaveBeenCalledTimes(when === 'after-binary' ? 1 : 0);
  });

  it.each(['switch', 'deadline', 'session'] as const)('rechecks the captured %s after each awaited phase', async kind => {
    const s = setup();
    let at = NOW;
    if (kind === 'deadline') s.value.assignment.deadline = new Date(NOW + 1).toISOString();
    if (kind === 'session') s.value.binding.expiresAt = new Date(NOW + 1).toISOString();
    s.fetchStorage.mockImplementationOnce(async () => {
      if (kind === 'switch') s.enabled.mockReturnValue(false);
      else at = NOW + 2;
      // Mutating the original authorization cannot extend the snapshot.
      s.value.assignment.deadline = '2027-01-01T00:00:00Z';
      s.value.binding.expiresAt = '2027-01-01T00:00:00Z';
      return new Response(null, { status: 200 });
    });
    const candidate = createTronClassAttachmentUploadCandidate({ ...s.dependencies, now: () => at });
    await expect(candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ code: kind === 'switch' ? 'TRONCLASS_CANDIDATE_DISABLED' : kind === 'session' ? 'TRONCLASS_RECONNECT_REQUIRED' : 'TRONCLASS_SUBMISSION_BLOCKED' });
    expect(s.fetchSchool).toHaveBeenCalledTimes(1);
  });

  it.each(['authorization', 'claim', 'policy', 'school', 'storage'])('redacts dependency errors from %s', async phase => {
    const s = setup();
    const error = new Error('synthetic-private-cookie https://storage.example.test/?signature=secret');
    if (phase === 'authorization') s.authorize.mockRejectedValueOnce(error);
    if (phase === 'claim') s.claim.mockRejectedValueOnce(error);
    if (phase === 'policy') s.resolveStorageTarget.mockRejectedValueOnce(error);
    if (phase === 'school') s.fetchSchool.mockRejectedValueOnce(error);
    if (phase === 'storage') s.fetchStorage.mockRejectedValueOnce(error);
    await expect(s.candidate.dispatch(OWNER, s.file)).rejects.toMatchObject({ message: 'TRONCLASS_UPLOAD_UNCONFIRMED' });
  });
});
