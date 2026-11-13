// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassDownloadSlots, handleTronClassMaterialDownload } from './tronClassMaterialDownloadRoute';

const input = { courseId: 101, activityId: 202, uploadKey: 'fixture-upload', revision: 'a'.repeat(32) };
const actor = { ownerKey: 'firebase:download-fixture', provider: 'firebase' as const };
const binary = Buffer.from('%PDF-private-class');
function fixture() {
  const authenticate = vi.fn(async () => actor);
  const bindings = { requireBinding: vi.fn(), assertCurrent: vi.fn(async () => {}) };
  const download = vi.fn(async () => ({ bytes: binary, name: '第一週講義.pdf', contentType: 'application/pdf' }));
  const release = vi.fn();
  const acquireSlot = vi.fn(() => release);
  const dependencies = { authenticate, bindings, download, acquireSlot, rateLimit: vi.fn() };
  const request = (body: unknown = input, options: { query?: string; headers?: Record<string, string>; method?: string } = {}) =>
    handleTronClassMaterialDownload(new NextRequest(`https://nuni.tw/api/tronclass/material-download${options.query ?? ''}`, {
      method: options.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
      ...(options.method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }), dependencies);
  return { request, dependencies, authenticate, bindings, download, acquireSlot, release };
}
beforeEach(() => vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

it('returns a private attachment with a UTF-8 filename after actor and binding rechecks', async () => {
  const f = fixture();
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(binary);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('第一週講義.pdf')}`);
  expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
  expect(response.headers.get('cache-control')).toBe('no-store, private');
  expect(response.headers.get('content-length')).toBe(String(binary.length));
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toBe('sandbox');
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  expect(f.bindings.assertCurrent).toHaveBeenCalledTimes(2);
  expect(f.download).toHaveBeenCalledWith(actor.ownerKey, input, expect.any(AbortSignal));
  expect(f.release).toHaveBeenCalledOnce();
});

it('does not call school or acquire a download slot before authentication', async () => {
  const f = fixture();
  f.authenticate.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  expect((await f.request()).status).toBe(401);
  expect(f.download).not.toHaveBeenCalled();
  expect(f.acquireSlot).not.toHaveBeenCalled();
});

it.each([
  { ...input, url: 'https://attacker.test/private' },
  { ...input, ownerKey: 'firebase:other' },
  { ...input, uploadKey: '../other' },
  { ...input, revision: 'stale' },
  { ...input, courseId: '101' },
])('rejects caller-controlled ownership, URLs, and malformed scope: %j', async (body) => {
  const f = fixture();
  expect((await f.request(body)).status).toBe(422);
  expect(f.download).not.toHaveBeenCalled();
});

it('rejects query parameters and bodies larger than 8 KiB before school access', async () => {
  const f = fixture();
  expect((await f.request(input, { query: '?url=https://other.test/' })).status).toBe(422);
  expect((await f.request({ ...input, padding: 'x'.repeat(8192) })).status).toBe(413);
  expect(f.download).not.toHaveBeenCalled();
});

it('discards bytes if the nuni actor changes while the file is being fetched', async () => {
  const f = fixture();
  f.authenticate.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, ownerKey: 'firebase:other' });
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private-class');
  expect(f.release).toHaveBeenCalledOnce();
});

it('discards bytes if the school binding changes during the final actor check', async () => {
  const f = fixture();
  f.bindings.assertCurrent.mockResolvedValueOnce().mockRejectedValueOnce(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private-class');
  expect(f.release).toHaveBeenCalledOnce();
});

it('releases a slot after a provider failure and never exposes upstream secrets', async () => {
  const f = fixture();
  f.download.mockRejectedValue(new Error('Cookie: private-cookie; school-password'));
  const response = await f.request();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/private-cookie|school-password/);
  expect(f.release).toHaveBeenCalledOnce();
});

it('honors the emergency integration switch without school or auth access', async () => {
  const f = fixture();
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'false');
  expect((await f.request()).status).toBe(503);
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});

it('limits each process to two buffered downloads and releases permits exactly once', () => {
  const acquire = createTronClassDownloadSlots(2);
  const first = acquire();
  const second = acquire();
  expect(acquire).toThrow(expect.objectContaining({ status: 429, code: 'TRONCLASS_DOWNLOAD_BUSY' }));
  first(); first();
  const replacement = acquire();
  expect(acquire).toThrow(expect.objectContaining({ status: 429 }));
  replacement(); second();
  expect(acquire).not.toThrow();
});

it('returns 429 when both download slots are occupied and does not run the provider', async () => {
  const f = fixture();
  f.acquireSlot.mockImplementation(() => { throw new NuniError(429, 'TRONCLASS_DOWNLOAD_BUSY'); });
  expect((await f.request()).status).toBe(429);
  expect(f.download).not.toHaveBeenCalled();
  expect(f.release).not.toHaveBeenCalled();
});

it('holds a download slot until a slow response is consumed or cancelled', async () => {
  const f = fixture();
  f.download.mockResolvedValue({ bytes: Buffer.alloc(128 * 1024 + 1), name: 'large.pdf', contentType: 'application/pdf' });
  const response = await f.request();
  expect(f.release).not.toHaveBeenCalled();
  const reader = response.body!.getReader();
  expect((await reader.read()).value?.byteLength).toBe(64 * 1024);
  expect(f.release).not.toHaveBeenCalled();
  await reader.cancel();
  expect(f.release).toHaveBeenCalledOnce();
  reader.releaseLock();

  const completed = fixture();
  completed.download.mockResolvedValue({ bytes: Buffer.alloc(128 * 1024 + 1), name: 'large.pdf', contentType: 'application/pdf' });
  const completeResponse = await completed.request();
  expect(completed.release).not.toHaveBeenCalled();
  expect((await completeResponse.arrayBuffer()).byteLength).toBe(128 * 1024 + 1);
  expect(completed.release).toHaveBeenCalledOnce();
});

it('reclaims a permit when the client never consumes or cancels its response', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    const response = await f.request();
    expect(f.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.release).toHaveBeenCalledOnce();
    await expect(response.arrayBuffer()).rejects.toThrow('Download cancelled');
  } finally { vi.useRealTimers(); }
});
