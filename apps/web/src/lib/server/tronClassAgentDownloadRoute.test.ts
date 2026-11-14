// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassRequiredAgentGrant } from '@campus/shared/src/tronClassAgentPermissions';
import { handleTronClassAgentDownload } from './tronClassAgentDownloadRoute';

const input = { courseId: 101, activityId: 202, uploadKey: 'fixture-upload', revision: 'a'.repeat(32) };
const actor = { ownerKey: 'firebase:agent-download-fixture', provider: 'firebase' as const };
const grant: TronClassRequiredAgentGrant = { revision: input.revision, version: 'b'.repeat(32), permissions: { readCourseData: true, downloadMaterials: true, prepareHomework: false }, updatedAt: '2026-11-13T00:00:00.000Z' };
const bytes = Buffer.from('%PDF-private-agent-material');
function fixture() {
  const authenticate = vi.fn(async () => actor);
  const grants = { get: vi.fn(async () => grant), require: vi.fn(async () => grant), assertCurrent: vi.fn(async () => {}) };
  const bindings = { requireBinding: vi.fn(), assertCurrent: vi.fn(async () => {}) };
  const download = vi.fn(async () => ({ bytes, name: '教材.pdf', contentType: 'application/pdf' }));
  const release = vi.fn();
  const acquireSlot = vi.fn(() => release);
  const dependencies = { authenticate, grants, bindings, download, acquireSlot, rateLimit: vi.fn() };
  const request = (body: unknown = input) => handleTronClassAgentDownload(new NextRequest('https://nuni.tw/api/tronclass/agent/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), dependencies);
  return { request, authenticate, grants, bindings, download, acquireSlot, release };
}
beforeEach(() => vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

it('returns the actual bounded attachment after rechecking actor, binding and both Agent scopes', async () => {
  const f = fixture();
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('教材.pdf')}`);
  expect(response.headers.get('cache-control')).toBe('no-store, private');
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  expect(f.grants.require.mock.calls).toEqual([[actor.ownerKey, 'readCourseData'], [actor.ownerKey, 'downloadMaterials']]);
  expect(f.grants.assertCurrent).toHaveBeenCalledWith(actor.ownerKey, grant, 'readCourseData');
  expect(f.grants.assertCurrent).toHaveBeenCalledWith(actor.ownerKey, grant, 'downloadMaterials');
  expect(f.bindings.assertCurrent).toHaveBeenCalledTimes(2);
  expect(f.release).toHaveBeenCalledOnce();
});

it('rejects missing download permission before fetching or allocating bytes', async () => {
  const f = fixture();
  f.grants.require.mockResolvedValueOnce(grant).mockRejectedValueOnce(new NuniError(403, 'TRONCLASS_AGENT_PERMISSION_REQUIRED'));
  const response = await f.request();
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: 'TRONCLASS_AGENT_PERMISSION_REQUIRED' });
  expect(f.download).not.toHaveBeenCalled();
  expect(f.acquireSlot).not.toHaveBeenCalled();
});

it('does not mix two grants when permission was revoked and enabled again', async () => {
  const f = fixture();
  f.grants.require.mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, version: 'c'.repeat(32) });
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'TRONCLASS_AGENT_PERMISSION_CHANGED' });
  expect(f.download).not.toHaveBeenCalled();
});

it('discards already buffered bytes when permission changes during download', async () => {
  const f = fixture();
  f.download.mockImplementation(async () => {
    f.grants.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_AGENT_PERMISSION_CHANGED'));
    return { bytes, name: '教材.pdf', contentType: 'application/pdf' };
  });
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private-agent-material');
  expect(f.release).toHaveBeenCalledOnce();
});

it('checks Agent grants after the final binding verification as well', async () => {
  const f = fixture();
  f.bindings.assertCurrent.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
    f.grants.assertCurrent.mockRejectedValue(new NuniError(403, 'TRONCLASS_AGENT_PERMISSION_REQUIRED'));
  });
  const response = await f.request();
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('private-agent-material');
  expect(f.release).toHaveBeenCalledOnce();
});

it('binds a download to the grant’s school binding revision', async () => {
  const f = fixture();
  expect((await f.request({ ...input, revision: 'c'.repeat(32) })).status).toBe(409);
  expect(f.download).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});

it('does not read another actor’s permission after a nuni session switch', async () => {
  const f = fixture();
  f.authenticate.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, ownerKey: 'firebase:other' });
  const response = await f.request();
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('private-agent-material');
  expect(f.grants.require).not.toHaveBeenCalledWith('firebase:other', expect.anything());
});

it('preserves the original binary route’s scope and URL validation', async () => {
  const f = fixture();
  expect((await f.request({ ...input, ownerKey: 'firebase:other', url: 'https://attacker.test/' })).status).toBe(422);
  expect(f.download).not.toHaveBeenCalled();
});

it('preserves stream cancellation and releases the original resource permit', async () => {
  const f = fixture();
  const response = await f.request();
  expect(f.release).not.toHaveBeenCalled();
  await response.body!.cancel();
  expect(f.release).toHaveBeenCalledOnce();
});

it('honors the emergency switch before auth, grants or school calls', async () => {
  const f = fixture();
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'false');
  expect((await f.request()).status).toBe(503);
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.grants.require).not.toHaveBeenCalled();
  expect(f.download).not.toHaveBeenCalled();
});
