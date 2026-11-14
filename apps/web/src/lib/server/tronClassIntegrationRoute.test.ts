// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { handleTronClassIntegration, type TronClassRouteDependencies } from './tronClassIntegrationRoute';

vi.mock('./tronClassIntegrationSource', () => ({ createTronClassIntegrationReader: vi.fn() }));
vi.mock('./tronClassSubmission', () => ({ getDefaultTronClassSubmissionService: vi.fn() }));

const revision = 'a'.repeat(32);
const operationId = 'operation-1234567890';
const fileId = 'attachment-1234567890';
const ownerKey = 'platform:pa_00000000-0000-4000-8000-000000000001';
const disconnected = { schoolId: 'pu', connected: false, revision: null, account: null, userName: null, expiresAt: null };

function setup() {
  const bindings = {
    getStatus: vi.fn().mockResolvedValue(disconnected),
    connect: vi.fn().mockResolvedValue({ ...disconnected, connected: true, revision, account: '410000001' }),
    disconnect: vi.fn().mockResolvedValue({ ...disconnected, revision }),
    requireBinding: vi.fn(), assertCurrent: vi.fn().mockResolvedValue(undefined),
  };
  const submissions = { prepare: vi.fn(), upload: vi.fn(), submit: vi.fn(), reconcile: vi.fn() };
  const authenticate = vi.fn().mockResolvedValue({ ownerKey, provider: 'platform' });
  const read = vi.fn().mockResolvedValue({ revision, fetchedAt: '2026-11-13T00:00:00.000Z', courses: [], homework: [], errors: [], partial: false });
  const getSubmissions = vi.fn().mockResolvedValue(submissions);
  const dependencies = { bindings, authenticate, read, submissions: getSubmissions, rateLimit: vi.fn() } as unknown as TronClassRouteDependencies;
  const request = (input: unknown, headers: Record<string, string> = {}) => handleTronClassIntegration(new NextRequest('https://nuni.tw/api/tronclass', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw', ...headers }, body: JSON.stringify(input),
  }), dependencies);
  return { request, dependencies, authenticate, bindings, submissions, getSubmissions, read };
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

it('preserves passwords exactly for the login adapter and omits them from its response', async () => {
  const { request, bindings } = setup();
  const response = await request({ action: 'connect', schoolId: 'pu', account: '410000001', password: ' password with spaces ', expectedRevision: null });
  expect(bindings.connect).toHaveBeenCalledWith(ownerKey, { schoolId: 'pu', account: '410000001', password: ' password with spaces ', expectedRevision: null });
  expect(JSON.stringify(await response.json())).not.toMatch(/password|cookie/);
});

it.each([
  { action: 'status', ownerKey: 'other-account' },
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

it('reconciliation uses only the recorded operation, never a new payload', async () => {
  const { request, submissions } = setup();
  submissions.reconcile.mockResolvedValue({ status: 'unknown', operationId, receipt: null });
  expect((await request({ action: 'reconcile', operationId, revision })).status).toBe(200);
  expect(submissions.reconcile).toHaveBeenCalledWith(ownerKey, { operationId, revision });
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
  const { dependencies, submissions, bindings } = setup();
  submissions.upload.mockResolvedValue({ fileId, name: '報告.pdf', contentType: 'application/pdf', size: 3, sha256: 'a'.repeat(64), status: 'uploaded' });
  const params = new URLSearchParams({ courseId: '101', homeworkId: '201', revision, operationId, fileId, name: '報告.pdf' });
  const response = await handleTronClassIntegration(new NextRequest(`https://nuni.tw/api/tronclass?${params}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: new Uint8Array([1, 2, 3]),
  }), dependencies);
  expect(response.status).toBe(200);
  expect(bindings.assertCurrent).toHaveBeenCalledWith(ownerKey, revision);
  expect(submissions.upload).toHaveBeenCalledWith(ownerKey, expect.objectContaining({ name: '報告.pdf', courseId: 101, homeworkId: 201, fileId }));
});

it('rejects an oversized upload before calling the provider', async () => {
  const { dependencies, submissions } = setup();
  const params = new URLSearchParams({ courseId: '101', homeworkId: '201', revision, operationId, fileId, name: 'report.pdf' });
  const response = await handleTronClassIntegration(new NextRequest(`https://nuni.tw/api/tronclass?${params}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(10 * 1024 * 1024 + 1) }, body: new Uint8Array([1]),
  }), dependencies);
  expect(response.status).toBe(413);
  expect(submissions.upload).not.toHaveBeenCalled();
});

it('honours the integration emergency switch before any school or auth access', async () => {
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'false');
  const { request, authenticate, read } = setup();
  expect((await request({ action: 'sync' })).status).toBe(503);
  expect(authenticate).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
