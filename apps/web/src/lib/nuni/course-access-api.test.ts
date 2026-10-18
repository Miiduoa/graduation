// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext } from './server';
const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const directoryId = 'ccd_11111111-1111-4111-8111-111111111111';
const fetcher = vi.fn();
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const course = { id: directoryId, workspaceId, version: 1, verification: 'administrator-reviewed', schoolId: 'pu', academicYear: '115', semester: '1', title: '資料庫', courseCode: 'CS301', teacher: '經核對老師', className: '三甲' };
const receipt = { status: 'reviewed', workspaceId, memberRole: 'student', membershipActive: true, course };
function invoke(options: { origin?: string; cookie?: boolean } = {}) {
  return handleNuni(new NextRequest('https://nuni.tw/api/nuni/course-access/workspace-course', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: options.origin ?? 'https://nuni.tw',
      'X-Campus-Session': sessionContext(session), ...(options.cookie === false ? {} : { Cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}` }) },
    body: JSON.stringify({ workspaceId, schoolId: 'pu' }),
  }), ['course-access', 'workspace-course']);
}
function reply(value: unknown) { fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/sessions/current')
  ? { authenticated: true, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', isPlatformOperator: false } : value)); }
beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni'); vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'course-access-test-session-secret-over-32'); vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('returns scoped reviewed metadata through the authenticated exact BFF endpoint', async () => {
  reply({ ...receipt, privateEvidence: 'not-public' });
  const result = await invoke();
  expect(result.status).toBe(200); expect(await result.json()).toEqual(receipt);
  expect(fetcher.mock.calls.some(([url]) => url === 'https://api.nuni.tw/v1/auth/platform/course-access/workspace-course')).toBe(true);
});
it.each([{ course: { ...course, schoolId: 'other' } }, { workspaceId: 'cw_22222222-2222-4222-8222-222222222222' }, { membershipActive: false }])('rejects mismatched readback %j', async extra => {
  reply({ ...receipt, ...extra }); expect((await invoke()).status).toBe(502);
});
it('preserves unreviewed status without trusting returned teacher metadata', async () => {
  reply({ ...receipt, status: 'unreviewed', course: null });
  const result = await invoke(); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ status: 'unreviewed', course: null });
});
it('requires the same origin and authenticated session', async () => {
  reply(receipt); expect((await invoke({ origin: 'https://other.example' })).status).toBe(403);
  expect((await invoke({ cookie: false })).status).toBe(401);
});
