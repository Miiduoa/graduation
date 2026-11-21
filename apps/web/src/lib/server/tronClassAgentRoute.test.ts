// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassRequiredAgentGrant } from '@campus/shared/src/tronClassAgentPermissions';
import { handleTronClassAgent, type TronClassAgentRouteDependencies } from './tronClassAgentRoute';

const revision = 'a'.repeat(32);
const actor = { ownerKey: 'firebase:agent-route-fixture', provider: 'firebase' as const };
const grant: TronClassRequiredAgentGrant = { revision, version: 'b'.repeat(32), permissions: { readCourseData: true, downloadMaterials: true, prepareHomework: true }, updatedAt: '2026-11-13T00:00:00.000Z' };
function fixture() {
  const authenticate = vi.fn(async () => actor);
  const grants = { get: vi.fn(async () => grant), require: vi.fn(async () => grant), assertCurrent: vi.fn(async () => {}) };
  const read = vi.fn(async () => ({ revision, fetchedAt: '2026-11-13T00:00:00.000Z', courses: [], homework: [], announcements: [], materials: [], errors: [], partial: false }));
  const prepare = vi.fn();
  const dependencies: TronClassAgentRouteDependencies = { authenticate, grants, read, prepare, rateLimit: vi.fn() };
  const request = (body: unknown, options: { query?: string; headers?: Record<string, string>; method?: string } = {}) =>
    handleTronClassAgent(new NextRequest(`https://nuni.tw/api/tronclass/agent${options.query ?? ''}`, {
      method: options.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
      ...(options.method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }), dependencies);
  return { request, dependencies, authenticate, grants, read, prepare };
}
beforeEach(() => vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

it('authenticates and reauthenticates the same actor, returning private no-store data', async () => {
  const f = fixture();
  const response = await f.request({ action: 'ask', question: 'TronClass 課程' });
  expect(response.status).toBe(200);
  expect(f.authenticate).toHaveBeenCalledTimes(2);
  expect(f.read).toHaveBeenCalledWith(actor.ownerKey, {});
  expect(response.headers.get('cache-control')).toBe('no-store, private');
  expect(response.headers.get('vary')).toContain('Authorization');
  expect(await response.json()).toMatchObject({ source: 'tronclass', revision, grantVersion: grant.version, intent: 'courses' });
});

it('rejects unauthenticated requests before grants or school access', async () => {
  const f = fixture();
  f.authenticate.mockRejectedValue(new NuniError(401, 'SIGN_IN_REQUIRED'));
  expect((await f.request({ action: 'ask', question: 'TronClass 作業' })).status).toBe(401);
  expect(f.grants.require).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});

it.each([
  { action: 'ask', question: 'TronClass 課程', ownerKey: 'firebase:other' },
  { action: 'ask', question: 'TronClass 教材', url: 'https://other.test' },
  { action: 'ask', question: 'TronClass 作業', courseId: '101' },
  { action: 'ask', question: 'TronClass 作業', homeworkId: 201 },
  { action: 'ask', question: 'TronClass 作業', courseId: -1 },
  { action: 'ask', question: 'TronClass 作業', grantVersion: grant.version },
  { action: 'ask', question: '一般問題' },
  { action: 'ask', question: 'TronClass '.repeat(150) },
  { action: 'prepare', courseId: 101, homeworkId: 201, confirmed: true },
  { action: 'submit', courseId: 101, homeworkId: 201 },
  { action: 'reconcile', operationId: 'other-private-operation' },
  { action: 'capability', cookies: { secret: 'value' } },
])('rejects caller-owned scopes, unbounded questions and unimplemented writers: %j', async (body) => {
  const f = fixture();
  expect((await f.request(body)).status).toBe(422);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled();
});

it('rejects query parameters and oversized JSON before accessing private data', async () => {
  const f = fixture();
  expect((await f.request({ action: 'capability' }, { query: '?ownerKey=other' })).status).toBe(422);
  expect((await f.request({ action: 'ask', question: 'x'.repeat(8192) })).status).toBe(413);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.grants.get).not.toHaveBeenCalled();
});

it('discards source output if the nuni session changes or expires during a read', async () => {
  const f = fixture();
  f.authenticate.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, ownerKey: 'firebase:other' });
  const response = await f.request({ action: 'ask', question: 'TronClass 作業' });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: 'SESSION_CHANGED' });
  expect(f.grants.require).toHaveBeenCalledWith(actor.ownerKey, 'readCourseData');
});

it('does not expose upstream cookies, passwords or raw exception bodies', async () => {
  const f = fixture();
  f.read.mockRejectedValue(new Error('Cookie: private-cookie Password: secret-school-password'));
  const response = await f.request({ action: 'ask', question: 'TronClass 作業' });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/private-cookie|secret-school-password/);
});

it('shows grant denial as a permission error instead of fetching school data', async () => {
  const f = fixture();
  f.grants.require.mockRejectedValue(new NuniError(403, 'TRONCLASS_AGENT_PERMISSION_REQUIRED'));
  const response = await f.request({ action: 'ask', question: 'TronClass 作業' });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: 'TRONCLASS_AGENT_PERMISSION_REQUIRED', message: expect.stringContaining('權限') });
  expect(f.read).not.toHaveBeenCalled();
});

it('supports permission-aware capability reads without school calls', async () => {
  const f = fixture();
  const response = await f.request({ action: 'capability' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ source: 'tronclass', capabilities: { submitHomework: false } });
  expect(f.read).not.toHaveBeenCalled();
  expect(f.authenticate).toHaveBeenCalledTimes(2);
});

it('honors the integration emergency switch before authentication or any data access', async () => {
  const f = fixture();
  vi.stubEnv('TRONCLASS_INTEGRATION_ENABLED', 'false');
  expect((await f.request({ action: 'capability' })).status).toBe(503);
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.grants.get).not.toHaveBeenCalled();
});
