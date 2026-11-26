// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { NuniTransport, NuniWorkspace } from '@campus/shared/src/nuni';
import { V2Error } from './contracts';
import { readTeachingOverview } from './teacherWorkspaceAdapter';

const schoolId = 'pu', now = Date.parse('2026-11-17T02:00:00.000Z');
const key = (prefix: string, index = 1) => `${prefix}_11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
const accountId = key('pa');
const workspace = (index = 1, role: NuniWorkspace['memberRole'] = 'owner-teacher'): NuniWorkspace => ({
  id: key('cw', index), title: '不可單憑此名稱判斷校園', state: 'active', memberRole: role,
});
const receipt = (index = 1) => ({ workspaceId: key('cw', index), memberRole: 'owner-teacher', membershipActive: true,
  status: 'reviewed', course: { id: key('ccd', index), workspaceId: key('cw', index), schoolId,
    version: 1, verification: 'administrator-reviewed', academicYear: '115', semester: '1',
    title: `已核對課程 ${index}`, courseCode: 'IM101', teacher: '老師', className: 'A' } });
const assignment = (course = 1, item = 1) => ({ id: key('cwa', item), workspaceId: key('cw', course),
  title: '作業標題', state: 'open', createdAt: '2026-11-01T02:00:00.000Z', closedAt: null,
  dueAt: '2026-11-18T20:00:00', unitId: null, unitTitle: null, instructions: 'PRIVATE INSTRUCTION',
  submissionCount: 7, mySubmission: null });
const quiz = (course = 1, item = 1) => ({ id: key('cwq', item), workspaceId: key('cw', course),
  title: '測驗標題', state: 'open', createdAt: '2026-11-01T02:00:00.000Z', closedAt: null,
  dueAt: null, unitId: null, unitTitle: null, prompt: 'PRIVATE PROMPT', responseCount: 5, myResponse: null });

function harness(options: { workspaces?: NuniWorkspace[]; budget?: number;
  override?: (path: string, body: Record<string, unknown> | undefined, call: number) => unknown | Promise<unknown> } = {}) {
  let calls = 0;
  const controller = new AbortController();
  const request = vi.fn<NuniTransport>(async (path, body) => {
    calls++;
    const overridden = await options.override?.(path, body, calls);
    if (overridden !== undefined) return overridden;
    if (path === 'class-workspaces') return { workspaces: options.workspaces ?? [workspace()] };
    const index = Number(String(body?.workspaceId ?? path.split('/')[1]).split('-').at(-1));
    if (path === 'course-access/workspace-course') return receipt(index);
    if (path.endsWith('/assignments')) return { assignments: [assignment(index)] };
    if (path.endsWith('/quizzes')) return { quizzes: [quiz(index)] };
    throw new Error('Unexpected endpoint: ' + path);
  });
  const guard = { beforeRead: vi.fn(() => controller.signal.throwIfAborted()), afterRead: vi.fn(() => controller.signal.throwIfAborted()) };
  return { request, controller, guard, calls: () => calls,
    read: (args: unknown = {}) => readTeachingOverview({ schoolId, accountId, args, request, guard,
      remainingApiCalls: () => (options.budget ?? 11) - calls, now }) };
}

describe('verified teacher course overview', () => {
  it('reads only active owner-teacher workspaces with exact-school receipts before and after the work reads', async () => {
    const f = harness({ workspaces: [workspace(1), workspace(2, 'student'), { ...workspace(3), state: 'archived' }] });
    const result = await f.read();
    expect(f.request.mock.calls.map(call => call[0])).toEqual(['class-workspaces', 'course-access/workspace-course',
      `class-workspaces/${key('cw')}/assignments`, `class-workspaces/${key('cw')}/quizzes`, 'course-access/workspace-course']);
    for (const call of f.request.mock.calls.filter(call => call[0] === 'course-access/workspace-course'))
      expect(call[1]).toEqual({ workspaceId: key('cw'), schoolId });
    expect(result).toMatchObject({ source: 'platform-teaching', status: 'ready', partial: false, unreadCourseCount: 0,
      courses: [{ workspaceId: key('cw'), schoolId, title: '已核對課程 1', memberRole: 'owner-teacher',
        assignments: [{ receivedCount: 7, dueAt: '2026-11-18T12:00:00.000Z' }], quizzes: [{ receivedCount: 5 }] }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|mySubmission|myResponse|prompt|instructions/);
    expect(f.guard.afterRead).toHaveBeenCalled();
  });
  it('keeps aggregate counts independent of the owner’s personal submission and excludes answer content', async () => {
    const f = harness({ override: path => path.endsWith('/assignments') ? { assignments: [{ ...assignment(),
      mySubmission: { assignmentId: key('cwa'), platformAccountId: accountId, displayName: 'PRIVATE NAME',
        body: 'PRIVATE ANSWER', state: 'submitted', submittedAt: '2026-11-16T02:00:00.000Z', teacherFeedback: null, reviewedAt: null } }] } : undefined });
    const result = await f.read();
    expect(result.courses[0].assignments[0].receivedCount).toBe(7);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('does not read co-teacher or unreviewed course contents, and does not report those as empty', async () => {
    const f = harness({ workspaces: [workspace(1), workspace(2, 'co-teacher')], override: path =>
      path === 'course-access/workspace-course' ? { ...receipt(), status: 'unreviewed', course: null } : undefined });
    await expect(f.read()).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SCOPE_UNVERIFIED',
      partial: true, unreadCourseCount: 2, courses: [] });
    expect(f.request.mock.calls.map(call => call[0])).toEqual(['class-workspaces', 'course-access/workspace-course']);
  });
  it('allows a verified empty membership list without inventing a teaching role', async () => {
    const f = harness({ workspaces: [workspace(1, 'student')] });
    await expect(f.read()).resolves.toMatchObject({ status: 'ready', courses: [], partial: false, unreadCourseCount: 0 });
    expect(f.calls()).toBe(1);
  });
  it('rejects a same-title course with a foreign school receipt before any task read', async () => {
    const f = harness({ override: path => path === 'course-access/workspace-course'
      ? { ...receipt(), course: { ...receipt().course, schoolId: 'foreign' } } : undefined });
    await expect(f.read()).rejects.toMatchObject({ code: 'COURSE_INVALID_RESPONSE' });
    expect(f.calls()).toBe(2);
  });
  it.each(['student', 'unreviewed', 'version', 'revoked'] as const)('rejects %s scope changes during the read instead of returning stale teacher data', async change => {
    let scopes = 0;
    const f = harness({ override: path => {
      if (path !== 'course-access/workspace-course' || ++scopes < 2) return;
      if (change === 'student') return { ...receipt(), memberRole: 'student' };
      if (change === 'unreviewed') return { ...receipt(), status: 'unreviewed', course: null };
      if (change === 'version') return { ...receipt(), course: { ...receipt().course, version: 2 } };
      throw new V2Error(404, 'NOT_FOUND');
    } });
    await expect(f.read()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_SCOPE' });
  });
  it('does not expose a partially obtained course when a parallel read denies authorization', async () => {
    const f = harness({ override: path => {
      if (path.endsWith('/assignments')) throw new V2Error(503, 'UPSTREAM_UNAVAILABLE');
      if (path.endsWith('/quizzes')) throw new V2Error(403, 'FORBIDDEN_SCOPE');
    } });
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.calls()).toBe(4);
  });
  it.each([401, 403])('preserves an initial %s failure as an authorization error', async status => {
    const f = harness({ override: () => { throw new V2Error(status, 'FORBIDDEN_SCOPE'); } });
    await expect(f.read()).rejects.toMatchObject({ status });
    expect(f.calls()).toBe(1);
  });
  it('labels an unavailable list rather than returning an empty successful list', async () => {
    const f = harness({ override: () => { throw new V2Error(503, 'UPSTREAM_UNAVAILABLE'); } });
    await expect(f.read()).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE',
      unreadCourseCount: null, courses: [], partial: true });
  });
  it('retains earlier verified courses when a later source is temporarily unavailable', async () => {
    const f = harness({ workspaces: [workspace(1), workspace(2)], override: path => {
      if (path === `class-workspaces/${key('cw', 2)}/assignments`) throw new V2Error(503, 'UPSTREAM_UNAVAILABLE');
    } });
    await expect(f.read()).resolves.toMatchObject({ status: 'ready', partial: true, unreadCourseCount: 1,
      partialReasons: ['source-unavailable'], courses: [{ workspaceId: key('cw') }] });
  });
  it('reserves two API calls for cross-service work and reports unqueried courses', async () => {
    const f = harness({ workspaces: [workspace(1), workspace(2), workspace(3)], budget: 11 });
    const result = await f.read();
    expect(result.courses).toHaveLength(2);
    expect(result).toMatchObject({ partial: true, unreadCourseCount: 1, partialReasons: ['api-budget'] });
    expect(f.calls()).toBe(9);
    expect(f.request.mock.calls.every(call => !call[0].includes(key('cw', 3)) && call[1]?.workspaceId !== key('cw', 3))).toBe(true);
  });
  it('does not start any source read when the shared budget cannot preserve follow-up work', async () => {
    const f = harness({ budget: 2 });
    await expect(f.read()).resolves.toMatchObject({ status: 'unavailable', unavailable: 'API_BUDGET', unreadCourseCount: null });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('caps returned courses even when more API budget is available', async () => {
    const f = harness({ workspaces: [workspace(1), workspace(2), workspace(3), workspace(4)], budget: 30 });
    const result = await f.read();
    expect(result.courses).toHaveLength(3);
    expect(result).toMatchObject({ partial: true, partialReasons: ['course-limit'], unreadCourseCount: 1 });
    expect(f.calls()).toBe(13);
  });
  it('labels truncated work without changing the upstream submission counts', async () => {
    const f = harness({ override: path => path.endsWith('/assignments') ?
      { assignments: Array.from({ length: 6 }, (_, index) => assignment(1, index + 1)) } : undefined });
    const result = await f.read();
    expect(result).toMatchObject({ partial: true, partialReasons: ['work-limit'], unreadCourseCount: 0,
      courses: [{ partial: true, assignments: expect.arrayContaining([expect.objectContaining({ receivedCount: 7 })]) }] });
    expect(result.courses[0].assignments).toHaveLength(5);
  });
  it('rejects mismatched activity scope and duplicates rather than salvaging them', async () => {
    for (const assignments of [[assignment(2)], [assignment(), assignment()]]) {
      const f = harness({ override: path => path.endsWith('/assignments') ? { assignments } : undefined });
      await expect(f.read()).rejects.toBeDefined();
    }
  });
  it('checks cancellation before work starts and after late transport delivery', async () => {
    const before = harness(); before.controller.abort();
    await expect(before.read()).rejects.toBeDefined(); expect(before.request).not.toHaveBeenCalled();
    const after = harness({ override: path => { if (path.endsWith('/quizzes')) after.controller.abort(); } });
    await expect(after.read()).rejects.toBeDefined();
    expect(after.calls()).toBe(4);
  });
  it('rejects model supplied authority before making an API request', async () => {
    const f = harness();
    await expect(f.read({ role: 'teacher', schoolId })).rejects.toMatchObject({ code: 'TEACHING_INVALID_INPUT' });
    expect(f.request).not.toHaveBeenCalled();
  });
});
