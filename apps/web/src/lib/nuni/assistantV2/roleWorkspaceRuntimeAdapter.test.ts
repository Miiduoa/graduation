// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from './adapter';
import { withOperationSignal } from './operation';

type Role = 'teacher' | 'merchant';
const roles = ['teacher', 'merchant'] as const;
const api = 'https://api.nuni.tw/v1/auth/platform/';
const schoolId = 'pu';
const key = (prefix: string, index = 1) => `${prefix}_11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
const account = key('pa'), otherAccount = key('pa', 2);
const session = { sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: Date.now() + 3600000 };
const principal = (platformAccountId = account) => ({ authenticated: true, platformAccountId, isPlatformOperator: false });
const workspaceId = key('cw');
const teacherWorkspace = { id: workspaceId, title: '授課標題', state: 'active', memberRole: 'owner-teacher' };
const courseReceipt = { workspaceId, memberRole: 'owner-teacher', membershipActive: true, status: 'reviewed',
  course: { id: key('ccd'), workspaceId, schoolId, version: 1, verification: 'administrator-reviewed',
    academicYear: '115', semester: '1', title: '已核對授課', courseCode: 'IM101', teacher: '老師', className: 'A' } };
const assignment = { id: key('cwa'), workspaceId, title: '近期作業', state: 'open',
  createdAt: '2026-11-01T02:00:00.000Z', closedAt: null, dueAt: '2026-11-18T20:00:00+08:00',
  unitId: null, unitTitle: null, instructions: 'PRIVATE TEACHER INSTRUCTIONS', submissionCount: 7, mySubmission: null };
const quiz = { id: key('cwq'), workspaceId, title: '近期測驗', state: 'open',
  createdAt: '2026-11-01T02:00:00.000Z', closedAt: null, dueAt: null,
  unitId: null, unitTitle: null, prompt: 'PRIVATE TEACHER QUESTION', responseCount: 3, myResponse: null };
const merchantTarget = { tenantId: 'school-one', locationId: 'location-one' };
const merchantWorkspace = { ...merchantTarget, tenantName: '靜宜大學', merchantName: '已授權餐坊',
  locationName: '第一門市', campusName: '主校區', merchantStatus: 'active', locationStatus: 'open',
  publicAccess: true, activated: true, missingRequirements: [] };
const merchantBase = `merchant-workspaces/${merchantTarget.tenantId}/${merchantTarget.locationId}`;
const order = { id: 'order-one', locationId: merchantTarget.locationId, state: 'ready',
  requestedPickupAt: '2026-11-17T07:30:00.000Z', pickupDisplayCode: 'PRIVATE PICKUP CODE',
  allowedActions: ['fulfill-pickup'], viewerScope: 'kitchen', lines: [{ menuItemId: 'menu-one',
    nameSnapshot: '餐點', quantity: 1, selectedOptions: [], customerNote: 'PRIVATE CUSTOMER NOTE' }] };
const shift = { id: 'shift-one', locationId: merchantTarget.locationId, state: 'open',
  openedAt: '2026-11-17T00:00:00.000Z', openingCash: { amountMinor: 50000, currency: 'TWD' },
  campusLedgerTotal: { amountMinor: 12000, currency: 'TWD' }, allowedActions: ['view', 'handover'] };
const firstPath: Record<Role, string> = { teacher: 'class-workspaces', merchant: 'merchant-workspaces' };
const finalPath: Record<Role, string> = { teacher: `class-workspaces/${workspaceId}/quizzes`, merchant: merchantBase + '/shift' };

function fixture(overrides: Record<string, unknown> = {}) {
  const sources: Record<string, unknown> = {
    'sessions/current': principal(),
    'class-workspaces': { workspaces: [teacherWorkspace] },
    'course-access/workspace-course': courseReceipt,
    [`class-workspaces/${workspaceId}/assignments`]: { assignments: [assignment] },
    [`class-workspaces/${workspaceId}/quizzes`]: { quizzes: [quiz] },
    'merchant-workspaces': { workspaces: [merchantWorkspace] },
    realms: { realms: [{ tenantId: 'school-one', name: '靜宜大學', services: ['food'] }] },
    [merchantBase + '/orders']: { orders: [order] },
    [merchantBase + '/shift']: shift,
    'social/feed': { items: [], nextCursor: null },
    ...overrides,
  };
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (!url.startsWith(api)) throw new Error('Unexpected API audience: ' + url);
    const path = url.slice(api.length).split('?')[0];
    if (!Object.hasOwn(sources, path)) throw new Error('Unexpected source route: ' + path);
    const value = sources[path];
    return value instanceof Response ? value.clone() : Response.json(structuredClone(value));
  });
  vi.stubGlobal('fetch', fetcher);
  return { sources, fetcher };
}
function read(source: ReturnType<typeof createAdapter>, role: Role, args: unknown = {}) {
  return role === 'teacher' ? source.adapter.teachingOverview!(args as never)
    : source.adapter.merchantOverview!(args as never);
}
function paths() {
  return vi.mocked(fetch).mock.calls.map(([input]) => String(input).slice(api.length).split('?')[0]);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_REALM_MAP', JSON.stringify({ pu: ['school-one'] }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('role readers through the verified production adapter', () => {
  it.each(roles)('requires a verified principal before the %s reader can use the network', async role => {
    fixture();
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await expect(read(source, role)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetch).not.toHaveBeenCalled();
    await source.principal();
    const result = await read(source, role);
    expect(result).toMatchObject({ source: role === 'teacher' ? 'platform-teaching' : 'platform-merchant',
      schoolId, status: 'ready', partial: false });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|openingCash|campusLedgerTotal|customerNote|mySubmission|myResponse/);
    const expectedPaths = role === 'teacher'
      ? ['sessions/current', 'class-workspaces', 'course-access/workspace-course',
        `class-workspaces/${workspaceId}/assignments`, `class-workspaces/${workspaceId}/quizzes`, 'course-access/workspace-course']
      : ['sessions/current', 'merchant-workspaces', 'realms', merchantBase + '/orders', merchantBase + '/shift'];
    expect(paths()).toEqual(expectedPaths);
    expect(source.apiCalls()).toBe(expectedPaths.length);
    expect(source.adapter.remainingApiCalls!()).toBe(12 - expectedPaths.length);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      const isScopeRead = String(url).endsWith('/course-access/workspace-course');
      expect(init).toMatchObject({ method: isScopeRead ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
      expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Platform ' + session.sessionHandle,
        ...(isScopeRead ? { 'Content-Type': 'application/json' } : {}) });
      if (isScopeRead) expect(JSON.parse(String(init?.body))).toEqual({ workspaceId, schoolId });
      else expect(init).not.toHaveProperty('body');
      expect(String(url) + String(init?.body ?? '')).not.toMatch(/pa_|ps_|Firebase|Cookie|\/feedback|\/submissions|\/responses|\/handover|\/activate|\/accept|\/refund/);
    }
  });

  it.each(roles)('rejects caller-supplied %s account, school and role authority before consuming API budget', async role => {
    fixture();
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    for (const input of [{ schoolId: 'foreign' }, { accountId: otherAccount }, { role: 'admin' },
      { workspaceId }, { cursor: 'another-page' }, { tenantId: 'someone-else' }])
      await expect(read(source, role, input)).rejects.toMatchObject({ status: 422 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(source.apiCalls()).toBe(1);
  });

  it('binds teacher response identities to the verified account instead of accepting another person’s nested submission', async () => {
    fixture({ [`class-workspaces/${workspaceId}/assignments`]: { assignments: [{ ...assignment,
      mySubmission: { assignmentId: key('cwa'), platformAccountId: otherAccount, displayName: 'PRIVATE PERSON',
        body: 'PRIVATE ANSWER', state: 'submitted', submittedAt: '2026-11-16T02:00:00.000Z', teacherFeedback: null, reviewedAt: null } }] } });
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    await expect(source.adapter.teachingOverview!({})).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
    expect(paths().filter(path => path === 'course-access/workspace-course')).toHaveLength(1);
    expect(paths()).not.toContain(`class-workspaces/${workspaceId}/assignments/${key('cwa')}/submissions`);
  });

  it('rejects an otherwise valid teacher scope receipt belonging to another school before reading its activities', async () => {
    fixture({ 'course-access/workspace-course': { ...courseReceipt, course: { ...courseReceipt.course, schoolId: 'nthu' } } });
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    await expect(source.adapter.teachingOverview!({})).rejects.toMatchObject({ code: 'COURSE_INVALID_RESPONSE' });
    expect(paths()).toEqual(['sessions/current', 'class-workspaces', 'course-access/workspace-course']);
  });

  it('does not replace merchant school mapping with a same-name or same-ID public realm', async () => {
    fixture({ 'merchant-workspaces': { workspaces: [{ ...merchantWorkspace, tenantId: schoolId }] },
      realms: { realms: [{ tenantId: schoolId, name: '靜宜大學', services: ['food'] }] } });
    vi.stubEnv('CAMPUS_ASSISTANT_V2_REALM_MAP', '{}');
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    await expect(source.adapter.merchantOverview!({})).resolves.toMatchObject({ status: 'unavailable',
      unavailable: 'SCOPE_UNAVAILABLE', selected: null, workspaces: [], scopeUnresolved: true });
    expect(paths()).toEqual(['sessions/current', 'merchant-workspaces', 'realms']);
  });

  it('preserves an explicit foreign realm school instead of overriding it with the local environment map', async () => {
    fixture({ realms: { realms: [{ tenantId: 'school-one', schoolId: 'nthu', name: '靜宜大學', services: ['food'] }] } });
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    await expect(source.adapter.merchantOverview!({})).resolves.toMatchObject({ status: 'ready',
      schoolId, workspaceCount: 0, selected: null, workspaces: [] });
    expect(paths()).toEqual(['sessions/current', 'merchant-workspaces', 'realms']);
  });

  it('revalidates a signed merchant selection in the production adapter and rejects a different authorized store', async () => {
    const { sources } = fixture();
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    sources['merchant-workspaces'] = { workspaces: [{ ...merchantWorkspace, locationId: 'new-location' }, merchantWorkspace] };
    const result = await source.adapter.merchantOverview!({}, merchantTarget);
    expect(result).toMatchObject({ status: 'ready', query: {}, selected: merchantWorkspace, workspaceCount: 2 });
    sources['merchant-workspaces'] = { workspaces: [{ ...merchantWorkspace, locationId: 'new-location' }] };
    vi.mocked(fetch).mockClear();
    await expect(source.adapter.merchantOverview!({}, merchantTarget)).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_SCOPE' });
    expect(paths()).toEqual(['merchant-workspaces', 'realms']);
  });

  it.each(roles)('preserves initial and late authorization denials for the %s source without fallback', async role => {
    for (const status of [401, 403]) {
      for (const path of [firstPath[role], finalPath[role]]) {
        fixture({ [path]: Response.json({ error: 'ROLE_SOURCE_DENIED' }, { status }) });
        const source = createAdapter(session, schoolId, new AbortController().signal);
        await source.principal();
        await expect(read(source, role)).rejects.toMatchObject({ status, code: 'ROLE_SOURCE_DENIED' });
        if (path === firstPath[role]) expect(paths()).toEqual(['sessions/current', path]);
        else expect(paths()).not.toContain(role === 'teacher' ? 'merchant-workspaces' : 'class-workspaces');
        expect(paths().every(path => !path.startsWith('realms/') && !path.includes('public/'))).toBe(true);
      }
    }
  });

  it.each(roles)('discards the old principal if refreshing it fails before another %s read', async role => {
    for (const response of [Response.json({ error: 'PLATFORM_SESSION_INVALID' }, { status: 401 }),
      Response.json({ authenticated: true, platformAccountId: otherAccount, isPlatformOperator: 'yes' })]) {
      const { sources } = fixture();
      const source = createAdapter(session, schoolId, new AbortController().signal);
      await source.principal();
      sources['sessions/current'] = response;
      await expect(source.principal()).rejects.toBeDefined();
      const priorCalls = vi.mocked(fetch).mock.calls.length;
      await expect(read(source, role)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
      expect(fetch).toHaveBeenCalledTimes(priorCalls);
      expect(paths()).toEqual(['sessions/current', 'sessions/current']);
    }
  });

  it.each(roles)('rejects a late %s response after the verified account changes', async role => {
    const { sources } = fixture();
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    const started = deferred<void>(), response = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(async () => { started.resolve(); return response.promise; });
    const pending = read(source, role);
    const rejected = expect(pending).rejects.toMatchObject({ status: 401, code: 'SESSION_CHANGED' });
    await started.promise;
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(principal(otherAccount)));
    await source.principal();
    response.resolve(Response.json(sources[firstPath[role]]));
    await rejected;
    expect(paths()).toEqual(['sessions/current', firstPath[role], 'sessions/current']);
  });

  it.each(roles)('stops %s work when the request or scoped operation was cancelled before any source read', async role => {
    for (const scope of ['request', 'operation']) {
      fixture();
      const request = new AbortController(), operation = new AbortController();
      const source = createAdapter(session, schoolId, request.signal);
      await source.principal();
      (scope === 'request' ? request : operation).abort();
      await expect(withOperationSignal(operation.signal, () => read(source, role))).rejects.toBeDefined();
      expect(paths()).toEqual(['sessions/current']);
    }
  });

  it.each(roles)('rejects valid %s data delivered after request or operation cancellation', async role => {
    for (const scope of ['request', 'operation']) {
      const { sources } = fixture();
      const request = new AbortController(), operation = new AbortController();
      const source = createAdapter(session, schoolId, request.signal);
      await source.principal();
      vi.mocked(fetch).mockImplementationOnce(async () => {
        (scope === 'request' ? request : operation).abort();
        return Response.json(sources[firstPath[role]]);
      });
      await expect(withOperationSignal(operation.signal, () => read(source, role))).rejects.toBeDefined();
      expect(paths()).toEqual(['sessions/current', firstPath[role]]);
    }
  });

  it('uses one shared API budget across teacher, merchant and public reads without resetting the budget per role', async () => {
    fixture();
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    await expect(source.adapter.teachingOverview!({})).resolves.toMatchObject({ status: 'ready', partial: false });
    expect(source.apiCalls()).toBe(6);
    await expect(source.adapter.merchantOverview!({})).resolves.toMatchObject({ status: 'ready', partial: false });
    expect(source.apiCalls()).toBe(10);
    expect(source.adapter.remainingApiCalls!()).toBe(2);
    await expect(source.adapter.teachingOverview!({})).resolves.toMatchObject({ status: 'unavailable',
      unavailable: 'API_BUDGET', partial: true, courses: [] });
    expect(fetch).toHaveBeenCalledTimes(10);
    await source.adapter.publicSocial!({});
    await source.adapter.publicSocial!({});
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(source.adapter.remainingApiCalls!()).toBe(0);
    await expect(source.adapter.merchantOverview!({})).rejects.toMatchObject({ status: 429, code: 'API_BUDGET_EXCEEDED' });
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(source.adapter.remainingApiCalls!()).toBe(0);
  });

  it('stops a merchant read before orders when earlier real requests have exhausted its remaining API budget', async () => {
    fixture();
    const source = createAdapter(session, schoolId, new AbortController().signal);
    await source.principal();
    for (let index = 0; index < 9; index++) await source.adapter.publicSocial!({});
    expect(source.adapter.remainingApiCalls!()).toBe(2);
    await expect(source.adapter.merchantOverview!({})).rejects.toMatchObject({ status: 429, code: 'API_BUDGET_EXCEEDED' });
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(paths().slice(-2)).toEqual(['merchant-workspaces', 'realms']);
    expect(paths()).not.toContain(merchantBase + '/orders');
    expect(paths()).not.toContain(merchantBase + '/shift');
  });
});
