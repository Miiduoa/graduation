// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';
const fetcher = vi.fn();
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const snapshot = { schoolId: 'pu', revision: 0, updatedAt: null, records: [] };
function invoke(action = 'read', body: unknown = { schoolId: 'pu' }, opts: { origin?: string; cookie?: boolean; context?: string; method?: string } = {}) {
  return handleNuni(new NextRequest(`https://nuni.tw/api/nuni/personal-imports/${action}`, {
    method: opts.method || 'POST', headers: { 'Content-Type': 'application/json', Origin: opts.origin || 'https://nuni.tw',
      'X-Campus-Session': opts.context || sessionContext(session), ...(opts.cookie === false ? {} : { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` }) },
    ...(opts.method === 'GET' ? {} : { body: JSON.stringify(body) }),
  }), ['personal-imports', action]);
}
beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni'); vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'import-sync-test-session-secret-over-32'); vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset().mockImplementation(async () => Response.json(snapshot)));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('uses the pinned platform endpoint and returns private no-store responses', async () => {
  const result = await invoke(); expect(result.status).toBe(200); expect(await result.json()).toEqual(snapshot);
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(fetcher.mock.calls[0][0]).toBe('https://api.nuni.tw/v1/auth/platform/personal-imports/read');
});
it('requires the same origin, cookie, session context and POST', async () => {
  expect((await invoke('read', { schoolId: 'pu' }, { origin: 'https://other.example' })).status).toBe(403);
  expect((await invoke('read', { schoolId: 'pu' }, { cookie: false })).status).toBe(401);
  expect((await invoke('read', { schoolId: 'pu' }, { context: 'stale' })).status).toBe(409);
  expect((await invoke('read', {}, { method: 'GET' })).status).toBe(405);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([{ schoolId: 'personal' }, { schoolId: 'pu', platformAccountId: 'victim' }, { schoolId: 'pu', expectedRevision: -1, mutationId: 'mutation-1', records: [] }, { schoolId: 'pu', expectedRevision: 1, mutationId: 'mutation-1', records: [{ schoolId: 'ntu' }] }])('rejects invalid sync input %j', async body => {
  const result = await invoke('expectedRevision' in body ? 'write' : 'read', body); expect(result.status).toBe(422); expect(fetcher).not.toHaveBeenCalled();
});
it('preserves revision conflict and rejects a cross-school upstream response', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code: 'PERSONAL_IMPORT_REVISION_CONFLICT' } }, { status: 409 }));
  expect((await invoke('write', { schoolId: 'pu', expectedRevision: 0, mutationId: 'mutation-1', records: [] })).status).toBe(409);
  fetcher.mockResolvedValueOnce(Response.json({ ...snapshot, schoolId: 'ntu' })); expect((await invoke()).status).toBeGreaterThanOrEqual(500);
});
it('rejects requests over the bounded input size before forwarding', async () => {
  expect((await invoke('read', { schoolId: 'pu', padding: 'x'.repeat(8 * 1024 * 1024 + 17000) })).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});
