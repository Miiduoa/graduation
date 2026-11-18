// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassActor } from './tronClassIntegrationAuth';
import type { TronClassSubmissionAttachmentDownloadInput } from './tronClassSubmissionAttachmentDownload';
import { handleTronClassSubmissionAttachmentDownload, type TronClassSubmissionAttachmentDownloadRouteDependencies } from './tronClassSubmissionAttachmentDownloadRoute';
import { handleTronClassMaterialDownload } from './tronClassMaterialDownloadRoute';

const input: TronClassSubmissionAttachmentDownloadInput = {
  courseId: 101, homeworkId: 202, submissionId: '401', uploadId: 501, revision: 'a'.repeat(32),
};
const actor: TronClassActor = { ownerKey: 'firebase:history-route-fixture', provider: 'firebase' };
const bytes = Buffer.from('%PDF-private-submission');
const path = '/api/tronclass/submission-attachment';
function jsonRequest(body: unknown = input, options: { path?: string; query?: string; headers?: Record<string, string>; method?: string; signal?: AbortSignal } = {}) {
  return new NextRequest(`https://nuni.tw${options.path ?? path}${options.query ?? ''}`, {
    method: options.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
    ...(options.method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: options.signal,
  });
}
function fixture() {
  const authenticate = vi.fn(async (): Promise<TronClassActor> => actor);
  const bindings = { requireBinding: vi.fn(), assertCurrent: vi.fn(async () => {}) };
  const download = vi.fn<NonNullable<TronClassSubmissionAttachmentDownloadRouteDependencies['download']>>(async () => ({
    bytes, name: '第一版報告.pdf', contentType: 'application/pdf',
  }));
  const release = vi.fn();
  const acquireSlot = vi.fn(() => release);
  const dependencies = { authenticate, bindings, download, acquireSlot, rateLimit: vi.fn() };
  const request = (body: unknown = input, options: Parameters<typeof jsonRequest>[1] = {},
    overrides: TronClassSubmissionAttachmentDownloadRouteDependencies = {}) =>
    handleTronClassSubmissionAttachmentDownload(jsonRequest(body, options), { ...dependencies, ...overrides });
  return { request, dependencies, authenticate, bindings, download, acquireSlot, release };
}
beforeEach(() => vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true'));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it('returns a private forced attachment only after actor and binding rechecks', async () => {
  const f = fixture();
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('第一版報告.pdf')}`);
  expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('cache-control')).toBe('no-store, private, no-transform');
  expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
  expect(response.headers.get('content-security-policy')).toBe('sandbox');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe('Cookie, X-Campus-Session, Authorization');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  expect(f.bindings.assertCurrent).toHaveBeenCalledTimes(2);
  expect(f.download).toHaveBeenCalledExactlyOnceWith(actor.ownerKey, input, expect.any(AbortSignal));
  expect(f.release).not.toHaveBeenCalled();
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(f.release).toHaveBeenCalledOnce();
});

it('authenticates before reading bindings, acquiring slots or contacting school', async () => {
  const f = fixture();
  f.authenticate.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  const response = await f.request();
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ message: '請先登入 nuni，再下載作業附件。' });
  expect(f.bindings.assertCurrent).not.toHaveBeenCalled();
  expect(f.acquireSlot).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});

it.each([
  { userId: 999 }, { ownerKey: 'firebase:other' }, { url: 'https://other.test/private' },
  { submissionId: 401 }, { submissionId: '0401' }, { uploadId: '../501' }, { revision: 'stale' },
])('rejects caller-controlled identity, URL or invalid selectors: %j', async patch => {
  const f = fixture();
  expect((await f.request({ ...input, ...patch })).status).toBe(422);
  expect(f.acquireSlot).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});

it('rejects unsupported methods, query parameters, types and excessive bodies before any provider call', async () => {
  const f = fixture();
  expect((await f.request(input, { method: 'GET' })).status).toBe(405);
  expect((await f.request(input, { query: '?studentId=999' })).status).toBe(422);
  expect((await f.request(input, { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
  expect((await f.request({ ...input, extra: 'x'.repeat(8192) })).status).toBe(413);
  expect(f.acquireSlot).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});

it.each([
  { ...actor, ownerKey: 'firebase:other' }, { ...actor, provider: 'platform' as const },
])('discards already fetched bytes when the actor changes to %j', async changed => {
  const f = fixture();
  f.authenticate.mockResolvedValueOnce(actor).mockResolvedValueOnce(changed);
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private-submission');
  expect(f.release).toHaveBeenCalledOnce();
});

it('discards bytes when the binding is revoked after school finishes', async () => {
  const f = fixture();
  f.bindings.assertCurrent.mockResolvedValueOnce().mockRejectedValueOnce(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private-submission');
  expect(f.release).toHaveBeenCalledOnce();
});

it('uses attachment-specific errors and never returns raw provider secrets', async () => {
  const f = fixture();
  f.download.mockRejectedValueOnce(new NuniError(403, 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED'))
    .mockRejectedValueOnce(new Error('Cookie: private-session; school-password'));
  const denied = await f.request();
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ message: '目前無法下載這個繳交版本的附件，請重新讀取繳交紀錄。' });
  const failure = await f.request();
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toMatch(/private-session|school-password/);
  expect(f.release).toHaveBeenCalledTimes(2);
});

it('does not acquire a slot or call a provider for an already cancelled request', async () => {
  const f = fixture();
  const response = await f.request(input, { signal: AbortSignal.abort() });
  expect(response.status).toBe(504);
  expect(f.acquireSlot).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});

it('does not start a provider if cancellation arrives during the initial binding check', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.bindings.assertCurrent.mockImplementation(async () => { controller.abort(); });
  const response = await f.request(input, { signal: controller.signal });
  expect(response.status).toBe(504);
  expect(f.download).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});

it('passes cancellation to the downloader and releases the slot without returning bytes', async () => {
  const f = fixture();
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  f.download.mockImplementation((_owner, _input, signal) => new Promise((_resolve, reject) => {
    started();
    signal!.addEventListener('abort', () => reject(new NuniError(504, 'TRONCLASS_DOWNLOAD_TIMEOUT')), { once: true });
  }));
  const pending = f.request(input, { signal: controller.signal });
  await ready;
  controller.abort();
  expect((await pending).status).toBe(504);
  expect(f.release).toHaveBeenCalledOnce();
});

it('shares the two buffered-download slots with material downloads and releases them on cancellation', async () => {
  const f = fixture();
  const materialInput = { courseId: 101, activityId: 202, uploadKey: 'fixture', revision: input.revision };
  const material = await handleTronClassMaterialDownload(jsonRequest(materialInput, { path: '/api/tronclass/material-download' }), {
    authenticate: f.authenticate, bindings: f.bindings, rateLimit: vi.fn(),
    download: async () => ({ bytes, name: 'material.pdf', contentType: 'application/pdf' }),
  });
  const history = await f.request(input, {}, { acquireSlot: undefined });
  const denied = await f.request(input, {}, { acquireSlot: undefined });
  expect([material.status, history.status, denied.status]).toEqual([200, 200, 429]);
  expect(f.download).toHaveBeenCalledOnce();
  await material.body!.cancel();
  await history.body!.cancel();
  const replacement = await f.request(input, {}, { acquireSlot: undefined });
  expect(replacement.status).toBe(200);
  await replacement.body!.cancel();
});

it('shares the same per-owner rate limit with material downloads', async () => {
  const f = fixture();
  f.authenticate.mockResolvedValue({ ...actor, ownerKey: 'firebase:shared-history-download-quota' });
  const materialInput = { courseId: 101, activityId: 202, uploadKey: 'fixture', revision: input.revision };
  for (let n = 0; n < 6; n++) {
    const response = await handleTronClassMaterialDownload(jsonRequest(materialInput), {
      authenticate: f.authenticate, bindings: f.bindings, acquireSlot: f.acquireSlot,
      download: async () => ({ bytes, name: 'material.pdf', contentType: 'application/pdf' }),
    });
    expect(response.status).toBe(200);
    await response.body!.cancel();
  }
  for (let n = 0; n < 6; n++) {
    const response = await f.request(input, {}, { rateLimit: undefined });
    expect(response.status).toBe(200);
    await response.body!.cancel();
  }
  expect((await f.request(input, {}, { rateLimit: undefined })).status).toBe(429);
  expect(f.download).toHaveBeenCalledTimes(6);
});

it('honors the emergency integration switch before authentication or school access', async () => {
  const f = fixture();
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'false');
  expect((await f.request()).status).toBe(503);
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});
