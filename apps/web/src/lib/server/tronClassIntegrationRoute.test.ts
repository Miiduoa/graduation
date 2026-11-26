// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { handleTronClassIntegration, type TronClassRouteDependencies } from './tronClassIntegrationRoute';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { TRONCLASS_MAX_FILE_BYTES } from './tronClassSubmission';

vi.mock('./tronClassIntegrationSource', () => ({ createTronClassIntegrationReader: vi.fn(), createTronClassCourseIndexReader: vi.fn() }));
vi.mock('./tronClassSubmission', async (importOriginal) => ({
  ...await importOriginal<typeof import('./tronClassSubmission')>(),
  getDefaultTronClassSubmissionService: vi.fn(),
}));

const revision = 'a'.repeat(32);
const operationId = 'operation-1234567890';
const fileId = 'attachment-1234567890';
const ownerKey = 'platform:pa_00000000-0000-4000-8000-000000000001';
const disconnected = { schoolId: 'pu', connected: false, revision: null, account: null, userName: null, expiresAt: null };

function setup({ attachmentWritesEnabled = false } = {}) {
  const bindings = {
    getStatus: vi.fn().mockResolvedValue(disconnected),
    connect: vi.fn().mockResolvedValue({ ...disconnected, connected: true, revision, account: '410000001' }),
    disconnect: vi.fn().mockResolvedValue({ ...disconnected, revision }),
    requireBinding: vi.fn(), assertCurrent: vi.fn().mockResolvedValue(undefined),
  };
  const submissions = {
    assertAttachmentWritesEnabled: vi.fn(() => {
      if (!attachmentWritesEnabled) throw new NuniError(503, 'TRONCLASS_WRITES_DISABLED');
    }),
    prepare: vi.fn(), upload: vi.fn(), submit: vi.fn(), reconcile: vi.fn(), cancelPreparation: vi.fn(),
  };
  const authenticate = vi.fn().mockResolvedValue({ ownerKey, provider: 'platform' });
  const read = vi.fn().mockResolvedValue({ revision, fetchedAt: '2026-11-13T00:00:00.000Z', courses: [], homework: [], errors: [], partial: false });
  const courses = vi.fn().mockResolvedValue({ kind: 'course-index', revision, fetchedAt: '2026-11-18T00:00:00.000Z', courses: [], errors: [], partial: false });
  const getSubmissions = vi.fn().mockResolvedValue(submissions);
  const dependencies = { bindings, authenticate, read, courses, submissions: getSubmissions, rateLimit: vi.fn() } as unknown as TronClassRouteDependencies;
  const request = (input: unknown, headers: Record<string, string> = {}) => handleTronClassIntegration(new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw', ...headers }, body: JSON.stringify(input),
  }), dependencies);
  return { request, dependencies, authenticate, bindings, submissions, getSubmissions, read, courses };
}

beforeEach(() => vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

it('gets status for the verified platform account without asking for a school portal', async () => {
  const { request, bindings } = setup();
  const response = await request({ action: 'status' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(disconnected);
  expect(bindings.getStatus).toHaveBeenCalledWith(ownerKey);
  expect(response.headers.get('cache-control')).toBe('no-store, private');
});

it('requires authentication before any binding or school access', async () => {
  const { request, authenticate, read, bindings } = setup();
  authenticate.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  const response = await request({ action: 'sync' });
  expect(response.status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  expect(bindings.getStatus).not.toHaveBeenCalled();
});

it('passes request cancellation to the sync reader separately from caller-supplied scope', async () => {
  const { dependencies, read } = setup();
  const controller = new AbortController();
  const request = new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw' },
    body: JSON.stringify({ action: 'sync', courseId: 101, revision }), signal: controller.signal,
  });
  const response = await handleTronClassIntegration(request, dependencies);
  expect(response.status).toBe(200);
  expect(read).toHaveBeenCalledExactlyOnceWith(ownerKey, { courseId: 101, revision }, request.signal);
  controller.abort();
  expect(read.mock.calls[0][2].aborted).toBe(true);
});

it('passes the actual connection request signal to school binding', async () => {
  const { dependencies, bindings } = setup();
  const controller = new AbortController();
  const input = { schoolId: 'pu', account: '410000001', password: 'private-test-password', expectedRevision: null };
  const request = new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw' },
    body: JSON.stringify({ action: 'connect', ...input }), signal: controller.signal,
  });
  expect((await handleTronClassIntegration(request, dependencies)).status).toBe(200);
  expect(bindings.connect).toHaveBeenCalledExactlyOnceWith(ownerKey, input, request.signal);
  controller.abort();
  expect(bindings.connect.mock.calls[0][2].aborted).toBe(true);
});

it('reports canceled binding separately from incorrect school credentials', async () => {
  const { request, bindings } = setup();
  bindings.connect.mockRejectedValue(new NuniError(499, 'TRONCLASS_LOGIN_CANCELLED'));
  const response = await request({ action: 'connect', schoolId: 'pu', account: '410000001', password: 'private-test-password', expectedRevision: null });
  expect(response.status).toBe(499);
  expect(await response.json()).toEqual({ error: 'TRONCLASS_LOGIN_CANCELLED', message: '已取消這次 TronClass 連接。' });
});

it('passes prepare cancellation to the submission reader without adding a client-controlled field', async () => {
  const { dependencies, submissions } = setup();
  submissions.prepare.mockResolvedValue({ canSubmit: false });
  const controller = new AbortController();
  const request = new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw' },
    body: JSON.stringify({ action: 'prepare', courseId: 101, homeworkId: 202, revision }), signal: controller.signal,
  });
  expect((await handleTronClassIntegration(request, dependencies)).status).toBe(200);
  expect(submissions.prepare).toHaveBeenCalledExactlyOnceWith(ownerKey, { courseId: 101, homeworkId: 202, revision }, request.signal);
  controller.abort();
  expect(submissions.prepare.mock.calls[0][2].aborted).toBe(true);
});

it('loads only the authenticated course index and forwards cancellation without creating a submission service', async () => {
  const { dependencies, courses, read, getSubmissions, authenticate } = setup();
  const controller = new AbortController();
  const request = new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw' },
    body: JSON.stringify({ action: 'courses' }), signal: controller.signal,
  });
  const response = await handleTronClassIntegration(request, dependencies);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ kind: 'course-index', courses: [], partial: false });
  expect(courses).toHaveBeenCalledExactlyOnceWith(ownerKey, request.signal, undefined);
  expect(authenticate).toHaveBeenCalledTimes(2);
  expect(read).not.toHaveBeenCalled();
  expect(getSubmissions).not.toHaveBeenCalled();
  controller.abort();
  expect(courses.mock.calls[0][1].aborted).toBe(true);
});

it.each(['before binding load', 'after binding load'])('rejects a course index after rebinding %s without calling the school', async (stage) => {
  const { request, dependencies, bindings } = setup();
  const { createTronClassCourseIndexReader } = await vi.importActual<typeof import('./tronClassIntegrationSource')>('./tronClassIntegrationSource');
  const original = { revision, userId: 12, cookies: { session: 'session-a-fixture' } };
  const replacement = { revision: 'b'.repeat(32), userId: 34, cookies: { session: 'session-b-fixture' } };
  let current = original;
  bindings.requireBinding.mockImplementation(async () => {
    if (stage === 'before binding load') current = replacement;
    const loaded = current;
    current = replacement;
    return loaded;
  });
  bindings.assertCurrent.mockImplementation(async (_owner, expected) => {
    if (expected !== current.revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
  });
  const source = {
    fetchCourses: vi.fn().mockResolvedValue([]),
    fetchHomeworkPage: vi.fn(), fetchActivities: vi.fn(),
    fetchCourseAnnouncements: vi.fn(), fetchSiteAnnouncements: vi.fn(),
  } satisfies LmsReadonlySource;
  dependencies.courses = createTronClassCourseIndexReader({ bindings, source });

  const stale = await request({ action: 'courses', revision });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: 'TRONCLASS_BINDING_CHANGED' });
  expect(source.fetchCourses).not.toHaveBeenCalled();

  const unscoped = await request({ action: 'courses' });
  expect(unscoped.status).toBe(200);
  expect(await unscoped.json()).toMatchObject({ revision: replacement.revision });
  expect(source.fetchCourses).toHaveBeenCalledTimes(2);
  expect(source.fetchCourses).toHaveBeenCalledWith(replacement.cookies, { userId: 34, status: 'ongoing' }, expect.anything());
});

it('requires authentication before loading a course index', async () => {
  const { request, authenticate, courses } = setup();
  authenticate.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  expect((await request({ action: 'courses' })).status).toBe(401);
  expect(courses).not.toHaveBeenCalled();
});

it('keeps course-picker reads separate from the six-sync budget while limiting both and total requests', async () => {
  const { request, dependencies, authenticate, read, courses } = setup();
  delete dependencies.rateLimit;
  authenticate.mockResolvedValue({ ownerKey: 'platform:pa_course_index_quota_fixture', provider: 'platform' });
  // Opening the workspace reads the directory and overview; five subsequent
  // course choices must retain the same full-sync allowance as before.
  expect((await request({ action: 'courses' })).status).toBe(200);
  expect((await request({ action: 'sync' })).status).toBe(200);
  for (const courseId of [101, 102, 103, 104, 105]) {
    expect((await request({ action: 'sync', courseId, revision })).status).toBe(200);
  }
  expect((await request({ action: 'sync', courseId: 106, revision })).status).toBe(429);
  expect(read).toHaveBeenCalledTimes(6);
  for (let attempt = 0; attempt < 5; attempt++) {
    expect((await request({ action: 'courses' })).status).toBe(200);
  }
  expect((await request({ action: 'courses' })).status).toBe(429);
  expect(courses).toHaveBeenCalledTimes(6);
  // Both buckets still consume the overall owner budget, including rejected
  // attempts. Fourteen requests above leave forty-six ordinary status reads.
  for (let attempt = 0; attempt < 46; attempt++) {
    expect((await request({ action: 'status' })).status).toBe(200);
  }
  expect((await request({ action: 'status' })).status).toBe(429);
});

it('preserves passwords exactly for the login adapter and omits them from its response', async () => {
  const { request, bindings } = setup();
  const response = await request({ action: 'connect', schoolId: 'pu', account: '410000001', password: ' password with spaces ', expectedRevision: null });
  expect(bindings.connect).toHaveBeenCalledWith(ownerKey, { schoolId: 'pu', account: '410000001', password: ' password with spaces ', expectedRevision: null }, expect.any(AbortSignal));
  expect(JSON.stringify(await response.json())).not.toMatch(/password|cookie/);
});

it.each([
  { action: 'status', ownerKey: 'other-account' },
  { action: 'courses', ownerKey: 'other-account' },
  { action: 'courses', courseId: 101 },
  { action: 'courses', revision: null },
  { action: 'courses', revision: 'invalid' },
  { action: 'sync', schoolId: 'attacker' },
  { action: 'sync', courseId: '101' },
  { action: 'sync', courseId: 1.5 },
  { action: 'connect', schoolId: 'pu', account: '410000001', password: 'secret', expectedRevision: null, host: 'https://attacker.test' },
  { action: 'disconnect', expectedRevision: null, cookies: {} },
])('rejects caller-controlled ownership, hosts or malformed scopes: %j', async (input) => {
  const { request, read, bindings, getSubmissions } = setup();
  expect((await request(input)).status).toBe(422);
  expect(read).not.toHaveBeenCalled();
  expect(bindings.connect).not.toHaveBeenCalled();
  expect(bindings.disconnect).not.toHaveBeenCalled();
  expect(getSubmissions).not.toHaveBeenCalled();
});

it('requires the exact preview confirmation before submission', async () => {
  const { request, submissions } = setup();
  const response = await request({ action: 'submit', courseId: 101, homeworkId: 201, revision, operationId, content: '作業', attachments: [], confirmed: false });
  expect(response.status).toBe(422);
  expect(submissions.submit).not.toHaveBeenCalled();
});

it('returns verification pending as unknown and never resends a submission automatically', async () => {
  const { request, submissions } = setup();
  submissions.submit.mockResolvedValue({ status: 'unknown', operationId, receipt: null });
  const response = await request({ action: 'submit', courseId: 101, homeworkId: 201, revision, operationId, content: '作業', attachments: [], confirmed: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'unknown', operationId, receipt: null });
  expect(submissions.submit).toHaveBeenCalledTimes(1);
});

it('forwards the actual request cancellation signal to final submission', async () => {
  const { dependencies, submissions } = setup();
  const controller = new AbortController();
  submissions.submit.mockResolvedValue({ status: 'unknown', operationId, receipt: null });
  const request = new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
    body: JSON.stringify({ action: 'submit', courseId: 101, homeworkId: 201, revision, operationId,
      content: '作業', attachments: [], confirmed: true }),
  });
  expect((await handleTronClassIntegration(request, dependencies)).status).toBe(200);
  const actualSignal = submissions.submit.mock.calls[0][2];
  expect(actualSignal).toBe(request.signal);
  controller.abort();
  expect(actualSignal.aborted).toBe(true);
});

it('reconciliation uses only the recorded operation, never a new payload', async () => {
  const { request, submissions } = setup();
  submissions.reconcile.mockResolvedValue({ status: 'unknown', operationId, receipt: null });
  expect((await request({ action: 'reconcile', operationId, revision })).status).toBe(200);
  expect(submissions.reconcile).toHaveBeenCalledWith(ownerKey, { operationId, revision });
  expect(submissions.submit).not.toHaveBeenCalled();
});

it('stops only the authenticated owner preparation through a separate scoped action', async () => {
  const { request, submissions } = setup();
  const scope = { courseId: 101, homeworkId: 201, operationId, revision };
  const expected = { status: 'cancelled', operationId, courseId: 101, homeworkId: 201 };
  submissions.cancelPreparation.mockResolvedValue(expected);
  const response = await request({ action: 'cancel-preparation', ...scope });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);
  expect(submissions.cancelPreparation).toHaveBeenCalledExactlyOnceWith(ownerKey, scope);
  expect(submissions.submit).not.toHaveBeenCalled();
  expect(submissions.upload).not.toHaveBeenCalled();
  expect(submissions.reconcile).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toBe('no-store, private');
});

it.each([
  { courseId: '101' }, { homeworkId: 0 }, { operationId: 'short' }, { revision: null },
  { ownerKey: 'firebase:other' }, { studentId: 999 }, { content: 'replacement' },
  { action: ['cancel-preparation'] },
])('rejects malformed or broadened cancellation scope: %j', async change => {
  const { request, submissions } = setup();
  const response = await request({ action: 'cancel-preparation', courseId: 101, homeworkId: 201, operationId, revision, ...change });
  expect(response.status).toBe(422);
  expect(submissions.cancelPreparation).not.toHaveBeenCalled();
});

it('does not return a cancellation after the nuni session changes', async () => {
  const { request, submissions, authenticate } = setup();
  submissions.cancelPreparation.mockResolvedValue({ status: 'cancelled', courseId: 101, homeworkId: 201, operationId });
  authenticate.mockResolvedValueOnce({ ownerKey, provider: 'platform' })
    .mockResolvedValueOnce({ ownerKey: 'platform:pa_other', provider: 'platform' });
  const response = await request({ action: 'cancel-preparation', courseId: 101, homeworkId: 201, operationId, revision });
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('cancelled');
});

it('returns an acknowledged version confirmation without inventing a legacy submitted-at receipt', async () => {
  const { request, submissions } = setup();
  const confirmed = { status: 'confirmed', operationId, receipt: null, confirmation: {
    kind: 'acknowledged-readback', source: 'tronclass', schoolId: 'pu', operationId,
    submissionId: 301, courseId: 101, homeworkId: 201,
    confirmedAt: '2026-11-18T05:00:00.000Z', sourceRecordedAt: null,
  } };
  submissions.reconcile.mockResolvedValue(confirmed);
  const response = await request({ action: 'reconcile', operationId, revision });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(confirmed);
  expect(response.headers.get('cache-control')).toBe('no-store, private');
  expect(response.headers.get('vary')).toContain('Authorization');
  expect(submissions.submit).not.toHaveBeenCalled();
  expect(submissions.upload).not.toHaveBeenCalled();
});

it('discards even a confirmed school version when the authenticated nuni owner changes during reconciliation', async () => {
  const { request, submissions, authenticate } = setup();
  submissions.reconcile.mockResolvedValue({ status: 'confirmed', operationId, receipt: null,
    confirmation: { submissionId: 301, privateTestMarker: 'must-not-escape' } });
  authenticate.mockResolvedValueOnce({ ownerKey, provider: 'platform' })
    .mockResolvedValueOnce({ ownerKey: 'platform:pa_other', provider: 'platform' });
  const response = await request({ action: 'reconcile', operationId, revision });
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('must-not-escape');
  expect(submissions.submit).not.toHaveBeenCalled();
});

it('discards a school result if the nuni session was revoked while reading', async () => {
  const { request, authenticate, read } = setup();
  read.mockResolvedValue({ homework: [{ title: 'private-homework' }] });
  authenticate.mockResolvedValueOnce({ ownerKey, provider: 'platform' }).mockRejectedValueOnce(new NuniError(401, 'SIGN_IN_REQUIRED'));
  const response = await request({ action: 'sync' });
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain('private-homework');
});

it('does not expose upstream exception bodies or session secrets', async () => {
  const { request, read } = setup();
  read.mockRejectedValue(new Error('Cookie: secret-cookie Password: private-pass'));
  const response = await request({ action: 'sync' });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/secret-cookie|private-pass/);
});

it('accepts an authenticated bounded raw upload with a checked binding version', async () => {
  const { dependencies, submissions, bindings } = setup({ attachmentWritesEnabled: true });
  submissions.upload.mockResolvedValue({ fileId, name: '報告.pdf', contentType: 'application/pdf', size: 3, sha256: 'a'.repeat(64), status: 'uploaded' });
  const params = new URLSearchParams({ courseId: '101', homeworkId: '201', revision, operationId, fileId, name: '報告.pdf' });
  const response = await handleTronClassIntegration(new NextRequest(`https://nuni.tw/api/tronclass?${params}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: new Uint8Array([1, 2, 3]),
  }), dependencies);
  expect(response.status).toBe(200);
  expect(bindings.assertCurrent).toHaveBeenCalledWith(ownerKey, revision);
  expect(submissions.upload).toHaveBeenCalledWith(ownerKey, expect.objectContaining({ name: '報告.pdf', courseId: 101, homeworkId: 201, fileId }), expect.any(AbortSignal));
});

function uploadRequest(headers: Record<string, string> = {}) {
  const params = new URLSearchParams({ courseId: '101', homeworkId: '201', revision, operationId, fileId, name: 'report.pdf' });
  return new NextRequest(`https://nuni.tw/api/tronclass?${params}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf', ...headers }, body: new Uint8Array([1]),
  });
}

it('rejects an oversized declared Content-Length before accessing the body or provider', async () => {
  const { dependencies, submissions, bindings, getSubmissions } = setup({ attachmentWritesEnabled: true });
  const request = uploadRequest({ 'Content-Length': String(TRONCLASS_MAX_FILE_BYTES + 1) });
  const body = vi.spyOn(request, 'body', 'get');
  const response = await handleTronClassIntegration(request, dependencies);
  expect(response.status).toBe(413);
  expect(body).not.toHaveBeenCalled();
  expect(getSubmissions).not.toHaveBeenCalled();
  expect(bindings.assertCurrent).not.toHaveBeenCalled();
  expect(submissions.upload).not.toHaveBeenCalled();
});

it('rejects an upload with writes disabled before accessing the body or binding', async () => {
  const { dependencies, submissions, bindings } = setup();
  const request = uploadRequest();
  const body = vi.spyOn(request, 'body', 'get');
  const response = await handleTronClassIntegration(request, dependencies);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'TRONCLASS_WRITES_DISABLED' });
  expect(body).not.toHaveBeenCalled();
  expect(bindings.assertCurrent).not.toHaveBeenCalled();
  expect(submissions.upload).not.toHaveBeenCalled();
});

it('rejects the third concurrent upload before accessing its body and releases slots after failure', async () => {
  const { dependencies, submissions } = setup({ attachmentWritesEnabled: true });
  let releaseUploads!: () => void;
  const pending = new Promise<void>((resolve) => { releaseUploads = resolve; });
  submissions.upload.mockImplementation(async () => {
    await pending;
    throw new Error('fixture upload failure');
  });
  const first = handleTronClassIntegration(uploadRequest(), dependencies);
  const second = handleTronClassIntegration(uploadRequest(), dependencies);
  try {
    await vi.waitFor(() => expect(submissions.upload).toHaveBeenCalledTimes(2));
    const request = uploadRequest();
    const body = vi.spyOn(request, 'body', 'get');
    const response = await handleTronClassIntegration(request, dependencies);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: 'TRONCLASS_UPLOAD_BUSY' });
    expect(body).not.toHaveBeenCalled();
  } finally {
    releaseUploads();
    await Promise.all([first, second]);
  }
  expect((await first).status).toBe(503);
  expect((await second).status).toBe(503);
  submissions.upload.mockResolvedValue({ status: 'uploaded' });
  expect((await handleTronClassIntegration(uploadRequest(), dependencies)).status).toBe(200);
});

it.each([undefined, 'false', 'TRUE'])('requires explicit integration opt-in before any school or auth access (%s)', async (flag) => {
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', flag);
  const { request, authenticate, read } = setup();
  expect((await request({ action: 'sync' })).status).toBe(503);
  expect(authenticate).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
