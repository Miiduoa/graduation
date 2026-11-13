// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { handleTronClassAgentPermissions } from './tronClassAgentPermissionsRoute';
import type { TronClassActor } from './tronClassIntegrationAuth';

const ownerKey = 'platform:pa_permission_fixture';
const grant = { revision: 'a'.repeat(32), version: 'b'.repeat(32),
  permissions: { readCourseData: true, downloadMaterials: false, prepareHomework: false }, updatedAt: '2026-11-13T09:00:00Z' };
function request(body: unknown = { action: 'status' }, query = '') {
  return new NextRequest(`https://nuni.tw/api/tronclass/agent-permissions${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://nuni.tw' }, body: JSON.stringify(body),
  });
}
function setup() {
  const authenticate = vi.fn(async (): Promise<TronClassActor> => ({ ownerKey, provider: 'platform' }));
  const grants = { get: vi.fn(async () => grant), set: vi.fn(async () => grant),
    require: vi.fn(async () => grant), assertCurrent: vi.fn(async () => {}) };
  const rateLimit = vi.fn();
  return { authenticate, grants, rateLimit };
}
afterEach(() => vi.unstubAllEnvs());

describe('TronClass Agent permission HTTP boundary', () => {
  it('returns only the authenticated owner grant without caching', async () => {
    const deps = setup();
    const result = await handleTronClassAgentPermissions(request(), deps);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(grant);
    expect(deps.grants.get).toHaveBeenCalledWith(ownerKey);
    expect(deps.authenticate).toHaveBeenCalledTimes(2);
    expect(result.headers.get('cache-control')).toContain('no-store');
  });

  it('updates the authenticated scope and forwards the expected revision/version', async () => {
    const deps = setup();
    const input = { revision: grant.revision, expectedVersion: null, permissions: grant.permissions };
    expect((await handleTronClassAgentPermissions(request({ action: 'set', ...input }), deps)).status).toBe(200);
    expect(deps.grants.set).toHaveBeenCalledWith(ownerKey, input);
  });

  it.each([{ action: 'status', ownerKey: 'firebase:other' }, { action: 'status', revision: grant.revision },
    { action: 'set', ...grant, expectedVersion: null }, { action: 'submit' }, []])('rejects unrelated input %#', async (body) => {
    const deps = setup();
    expect((await handleTronClassAgentPermissions(request(body), deps)).status).toBe(422);
    expect(deps.grants.get).not.toHaveBeenCalled();
    expect(deps.grants.set).not.toHaveBeenCalled();
  });

  it('rejects query parameters and oversized JSON before a grant change', async () => {
    const deps = setup();
    expect((await handleTronClassAgentPermissions(request({ action: 'status' }, '?owner=x'), deps)).status).toBe(422);
    expect((await handleTronClassAgentPermissions(request({ action: 'set', permissions: 'x'.repeat(9000) }), deps)).status).toBe(413);
    expect(deps.grants.set).not.toHaveBeenCalled();
  });

  it('does not read grants when authentication fails', async () => {
    const deps = setup();
    deps.authenticate.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
    expect((await handleTronClassAgentPermissions(request(), deps)).status).toBe(401);
    expect(deps.grants.get).not.toHaveBeenCalled();
  });

  it('does not expose a stale result after the app session changes', async () => {
    const deps = setup();
    deps.authenticate.mockResolvedValueOnce({ ownerKey, provider: 'platform' }).mockResolvedValueOnce({ ownerKey: 'platform:pa_other', provider: 'platform' });
    const response = await handleTronClassAgentPermissions(request(), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'SESSION_CHANGED' });
  });

  it('keeps upstream exception details and cookies out of the response', async () => {
    const deps = setup();
    deps.grants.get.mockRejectedValue(new Error('private-school-cookie private-password'));
    const response = await handleTronClassAgentPermissions(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private-school-cookie|private-password/);
  });

  it('honors the integration stop switch before performing any action', async () => {
    vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'false');
    const deps = setup();
    expect((await handleTronClassAgentPermissions(request(), deps)).status).toBe(503);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });
});
