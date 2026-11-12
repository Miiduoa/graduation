// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  NUNI_LOST_FOUND_BODY_LIMIT,
  type NuniLostFoundAction,
} from '@campus/shared/src/nuniLostFound';
import { handleNuni } from './api';
import { SESSION_COOKIE, sealCookie, sessionContext, type PlatformSession } from './server';

const id = 'plf_11111111-1111-4111-8111-111111111111';
const otherId = 'plf_22222222-2222-4222-8222-222222222222';
const session = { sessionHandle: `ps_${'a'.repeat(43)}`, expiresAt: Date.now() + 3600_000 };
const principal = {
  authenticated: true,
  platformAccountId: 'pa_33333333-3333-4333-8333-333333333333',
  isPlatformOperator: false,
};
const fields = {
  type: 'found', title: '藍色雨傘', description: '在圖書館一樓找到，請描述傘柄辨認。',
  category: 'other', location: '圖書館', date: '2026-11-07', contactInfo: '請洽圖書館服務台',
};
const target = { schoolId: 'pu', id };
const inputs: Record<NuniLostFoundAction, Record<string, unknown>> = {
  list: { schoolId: 'pu' },
  get: target,
  create: { ...target, mutationId: 'create-12345678', fields },
  update: { ...target, expectedVersion: 2, mutationId: 'update-12345678', fields },
  resolve: { ...target, expectedVersion: 2, mutationId: 'resolve-12345678' },
  remove: { ...target, expectedVersion: 2, mutationId: 'remove-12345678' },
  export: { schoolId: 'pu' },
};
const actions = Object.keys(inputs) as NuniLostFoundAction[];
const fetcher = vi.fn();

function item(overrides: Record<string, unknown> = {}) {
  return {
    ...fields, ...target, isOwner: true, status: 'open', version: 1,
    createdAt: '2026-11-07T10:00:00.000Z', updatedAt: '2026-11-07T10:00:00.000Z',
    resolvedAt: null, ...overrides,
  };
}
function validResponse(action: NuniLostFoundAction) {
  switch (action) {
    case 'list': return { schoolId: 'pu', items: [item({ contactInfo: undefined })], nextCursor: null };
    case 'export': return { schoolId: 'pu', items: [item()], nextCursor: null };
    case 'remove': return { ...target, removed: true };
    case 'resolve': return { item: item({ version: 3, status: 'resolved', contactInfo: '', resolvedAt: '2026-11-07T10:01:00.000Z', updatedAt: '2026-11-07T10:01:00.000Z' }) };
    case 'update': return { item: item({ version: 3, updatedAt: '2026-11-07T10:01:00.000Z' }) };
    case 'get': return { item: item({ isOwner: false }) };
    default: return { item: item() };
  }
}
type Options = {
  method?: string;
  path?: string;
  segments?: string[];
  origin?: string | null;
  context?: string | null;
  cookie?: boolean | 'tampered';
  session?: PlatformSession;
  headers?: Record<string, string>;
  rawBody?: string | null;
};
function invoke(action = 'list', input: unknown = inputs.list, options: Options = {}) {
  const path = options.path ?? `lost-found/${action}`;
  const method = options.method ?? 'POST';
  const cookieSession = options.session ?? session;
  const headers = new Headers({ 'Content-Type': 'application/json', ...options.headers });
  if (options.origin !== null) headers.set('Origin', options.origin ?? 'https://nuni.tw');
  if (options.context !== null) headers.set('X-Campus-Session', options.context ?? sessionContext(cookieSession));
  if (options.cookie !== false)
    headers.set('Cookie', `${SESSION_COOKIE}=${options.cookie === 'tampered' ? 'tampered' : sealCookie(SESSION_COOKIE, cookieSession)}`);
  const body = options.rawBody === undefined ? JSON.stringify(input) : options.rawBody;
  return handleNuni(new NextRequest(`https://nuni.tw/api/nuni/${path}`, {
    method, headers,
    ...(method === 'GET' || method === 'HEAD' || body === null ? {} : { body }),
  }), options.segments ?? path.split('?')[0].split('/'));
}
beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', 'false');
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'https://nuni.tw');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubEnv('BFF_SESSION_SECRET', 'lost-found-api-test-session-secret-over-32');
  vi.stubGlobal('fetch', fetcher.mockReset());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(actions)('proxies %s through the captured platform session with a private receipt', async (action) => {
  const response = validResponse(action);
  fetcher.mockResolvedValueOnce(Response.json(response));
  const result = await invoke(action, inputs[action]);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(JSON.parse(JSON.stringify(response)));
  expect(result.headers.get('Cache-Control')).toBe('no-store, private');
  expect(result.headers.get('Vary')).toBe('Cookie, X-Campus-Session');
  expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe(`https://api.nuni.tw/v1/auth/platform/lost-found/${action}`);
  expect(request).toMatchObject({
    method: 'POST', cache: 'no-store', redirect: 'error',
    headers: { Authorization: `Platform ${session.sessionHandle}`, 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(request.body)).toEqual(inputs[action]);
});

it.each(actions)('reports an unavailable legacy %s endpoint only after validating the captured session', async (action) => {
  fetcher
    .mockResolvedValueOnce(Response.json({ error: { code: 'AUTH_INVALID', message: 'Private campus auth details' } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json(principal));
  const result = await invoke(action, inputs[action], {
    headers: { Authorization: `Platform ps_${'b'.repeat(43)}` },
  });
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'LOST_FOUND_UNAVAILABLE' });
  expect(result.headers.get('Cache-Control')).toBe('no-store, private');
  expect(result.headers.get('Vary')).toBe('Cookie, X-Campus-Session');
  expect(result.headers.get('Set-Cookie')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [operation, probe] = fetcher.mock.calls;
  expect(operation[0]).toBe(`https://api.nuni.tw/v1/auth/platform/lost-found/${action}`);
  expect(operation[1].method).toBe('POST');
  expect(JSON.parse(operation[1].body)).toEqual(inputs[action]);
  expect(probe[0]).toBe('https://api.nuni.tw/v1/auth/platform/sessions/current');
  expect(probe[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
  expect(probe[1].body).toBeUndefined();
  for (const [, request] of [operation, probe])
    expect(request.headers.Authorization).toBe(`Platform ${session.sessionHandle}`);
});

it('preserves a genuinely expired session after the lost-found endpoint rejects authentication', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ error: { code: 'AUTH_INVALID' } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'PLATFORM_SESSION_INVALID', message: 'Private session details' } }, { status: 401 }));
  const result = await invoke('create', inputs.create);
  expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ error: 'PLATFORM_SESSION_INVALID' });
  expect(result.headers.get('Cache-Control')).toBe('no-store, private');
  expect(result.headers.get('Set-Cookie')).toBeNull();
  expect(fetcher.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
    ['https://api.nuni.tw/v1/auth/platform/lost-found/create', 'POST'],
    ['https://api.nuni.tw/v1/auth/platform/sessions/current', 'GET'],
  ]);
});

it.each([
  null, {}, [], { ...principal, authenticated: false },
  { ...principal, platformAccountId: 'private-invalid-principal' },
  { ...principal, isPlatformOperator: 'false' },
])('fails safely when the legacy 401 session probe returns an unverified principal: %j', async (value) => {
  fetcher
    .mockResolvedValueOnce(Response.json({ error: { code: 'AUTH_INVALID' } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json(value));
  const result = await invoke('update', inputs.update);
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
  expect(result.headers.get('Set-Cookie')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/lost-found/'))).toHaveLength(1);
});

it('does not treat malformed probe JSON as a confirmed session or resend a write', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ error: { code: 'AUTH_INVALID' } }, { status: 401 }))
    .mockResolvedValueOnce(new Response('{private-invalid-json', { headers: { 'Content-Type': 'application/json' } }));
  const result = await invoke('resolve', inputs.resolve);
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('/lost-found/'))).toHaveLength(1);
});

it('keeps a failed session probe bounded and never retries the original removal', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ error: { code: 'AUTH_INVALID' } }, { status: 401 }))
    .mockRejectedValue(new TypeError('Private network and session details'));
  const result = await invoke('remove', inputs.remove);
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
  expect(fetcher.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
    ['https://api.nuni.tw/v1/auth/platform/lost-found/remove', 'POST'],
    ['https://api.nuni.tw/v1/auth/platform/sessions/current', 'GET'],
    ['https://api.nuni.tw/v1/auth/platform/sessions/current', 'GET'],
  ]);
  for (const [, request] of fetcher.mock.calls)
    expect(request.headers.Authorization).toBe(`Platform ${session.sessionHandle}`);
});

it('does not turn an inconclusive forbidden session probe into an authenticated result', async () => {
  fetcher
    .mockResolvedValueOnce(Response.json({ error: { code: 'AUTH_INVALID' } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'FORBIDDEN', message: 'Private backend policy' } }, { status: 403 }));
  const result = await invoke('get', inputs.get);
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ error: 'SERVICE_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  [{ origin: 'https://other.example' }, 403, 'ORIGIN_REJECTED'],
  [{ origin: null }, 403, 'ORIGIN_REJECTED'],
  [{ origin: 'null' }, 403, 'ORIGIN_REJECTED'],
  [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403, 'ORIGIN_REJECTED'],
  [{ cookie: false }, 401, 'SIGN_IN_REQUIRED'],
  [{ cookie: 'tampered' }, 401, 'SIGN_IN_REQUIRED'],
  [{ session: { ...session, expiresAt: 1 } }, 401, 'SIGN_IN_REQUIRED'],
  [{ session: { ...session, pendingLogout: true } }, 401, 'SIGN_IN_REQUIRED'],
  [{ context: null }, 409, 'SESSION_CHANGED'],
  [{ context: 'stale' }, 409, 'SESSION_CHANGED'],
] as const)('rejects an unverified browser request %j before contacting the backend', async (options, status, error) => {
  const result = await invoke('get', inputs.get, options);
  expect(result.status).toBe(status);
  expect(await result.json()).toEqual({ error });
  expect(result.headers.get('Cache-Control')).toBe('no-store, private');
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not treat a native authorization header as a browser session or an account override', async () => {
  const headers = { Authorization: `Platform ps_${'b'.repeat(43)}` };
  expect((await invoke('get', inputs.get, { cookie: false, headers })).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(Response.json(validResponse('get')));
  expect((await invoke('get', inputs.get, { headers })).status).toBe(200);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Platform ${session.sessionHandle}`);
});

it.each(actions)('keeps %s authenticated even when its body is otherwise valid', async (action) => {
  expect((await invoke(action, inputs[action], { cookie: false })).status).toBe(401);
  expect((await invoke(action, inputs[action], { context: 'other-account' })).status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'])('rejects %s instead of turning a read or write into another action', async (method) => {
  expect((await invoke('create', inputs.create, { method })).status).toBe(405);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  ['lost-found', ['lost-found']],
  ['lost-found/list/', ['lost-found', 'list', '']],
  ['lost-found/list/extra', ['lost-found', 'list', 'extra']],
  ['lost-found/admin', ['lost-found', 'admin']],
  ['lost-found/%6cist', ['lost-found', 'list']],
  ['lost-found/list%2Fexport', ['lost-found', 'list/export']],
  ['lost-found/export', ['lost-found', 'get']],
] as const)('rejects an unknown, encoded or mismatched path %s', async (path, segments) => {
  expect((await invoke('list', inputs.list, { path, segments: [...segments] })).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['schoolId=pu', 'schoolId=pu&schoolId=ntu', 'accountId=victim', 'cursor=next', ''])('does not accept URL query fields: %s', async (query) => {
  const path = `lost-found/list?${query || 'unexpected'}`;
  expect((await invoke('list', inputs.list, { path })).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps the existing platform feature gate', async () => {
  vi.stubEnv('CAMPUS_BACKEND', 'firebase');
  expect((await invoke()).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  null, [], {}, { schoolId: 'personal' }, { schoolId: 'pu', platformAccountId: 'victim' },
  { schoolId: 'pu', userId: 'firebase-user' }, { schoolId: 'pu', ownerId: 'victim' },
  { schoolId: 'pu', role: 'admin' }, { schoolId: 'pu', limit: 51 }, { schoolId: 'pu', mine: 'true' },
])('rejects malformed or authority-bearing list input %j', async (input) => {
  const result = await invoke('list', input);
  expect(result.status).toBe(422);
  expect(await result.json()).toEqual({ error: 'LOST_FOUND_INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { ...inputs.create, mutationId: 'short' },
  { ...inputs.create, id: 'legacy-firebase-item' },
  { ...inputs.create, fields: { ...fields, userId: 'victim' } },
  { ...inputs.create, fields: { ...fields, date: '2026-02-30' } },
  { ...inputs.create, fields: { ...fields, photoURL: 'https://other.example/private' } },
])('rejects malformed publication fields before any write: %j', async (input) => {
  expect((await invoke('create', input)).status).toBe(422);
  expect(fetcher).not.toHaveBeenCalled();
});
it('normalizes submitted fields before forwarding and validating their receipt', async () => {
  fetcher.mockResolvedValueOnce(Response.json(validResponse('create')));
  const result = await invoke('create', { ...inputs.create, fields: { ...fields, title: ` ${fields.title} ` } });
  expect(result.status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).fields.title).toBe(fields.title);
});

it.each(['text/plain', 'application/jsonp', 'application/x-www-form-urlencoded'])('rejects a non-JSON media type %s', async (type) => {
  expect((await invoke('list', inputs.list, { headers: { 'Content-Type': type } })).status).toBe(415);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['{"schoolId":', null])('reports invalid request JSON without leaking parser details', async (rawBody) => {
  const result = await invoke('list', {}, { rawBody });
  expect(result.status).toBe(400);
  expect(await result.json()).toEqual({ error: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('bounds actual UTF-8 request bytes and the declared length to 16 KiB', async () => {
  expect((await invoke('list', inputs.list, { headers: { 'Content-Length': String(NUNI_LOST_FOUND_BODY_LIMIT + 1) } })).status).toBe(413);
  const rawBody = JSON.stringify({ schoolId: 'pu', q: '傘'.repeat(6000) });
  expect(rawBody.length).toBeLessThan(NUNI_LOST_FOUND_BODY_LIMIT);
  expect((await invoke('list', {}, { rawBody })).status).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { item: item({ schoolId: 'ntu' }) },
  { item: item({ id: otherId }) },
  { item: item({ userId: 'private-owner-id' }) },
  { item: item({ contactInfo: undefined }) },
  { item: item(), account: { email: 'private@example.test' } },
])('rejects a malformed or cross-scope detail receipt without exposing it', async (response) => {
  fetcher.mockResolvedValueOnce(Response.json(response));
  const result = await invoke('get', inputs.get);
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: 'INVALID_RESPONSE' });
});
it('rejects contact details in list summaries and someone else’s export', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ schoolId: 'pu', items: [item()], nextCursor: null }));
  expect((await invoke()).status).toBe(502);
  fetcher.mockResolvedValueOnce(Response.json({ schoolId: 'pu', items: [item({ isOwner: false })], nextCursor: null }));
  const result = await invoke('export', inputs.export);
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: 'INVALID_RESPONSE' });
});
it('rejects another owner in a mine list, duplicate rows and a stuck pagination cursor', async () => {
  const summary = item({ contactInfo: undefined });
  fetcher.mockResolvedValueOnce(Response.json({ schoolId: 'pu', items: [{ ...summary, isOwner: false }], nextCursor: null }));
  expect((await invoke('list', { schoolId: 'pu', mine: true })).status).toBe(502);
  fetcher.mockResolvedValueOnce(Response.json({ schoolId: 'pu', items: [summary, summary], nextCursor: null }));
  expect((await invoke()).status).toBe(502);
  fetcher.mockResolvedValueOnce(Response.json({ schoolId: 'pu', items: [summary], nextCursor: 'same-cursor' }));
  expect((await invoke('list', { schoolId: 'pu', cursor: 'same-cursor' })).status).toBe(502);
});
it.each([
  ['create', { item: item({ isOwner: false }) }],
  ['create', { item: item({ title: '另一筆刊登' }) }],
  ['create', { item: item({ version: 2 }) }],
  ['update', { item: item({ version: 2 }) }],
  ['update', { item: item({ version: 3, description: '不是送出的內容' }) }],
  ['resolve', { item: item({ version: 3 }) }],
  ['resolve', { item: item({ version: 3, status: 'resolved', resolvedAt: '2026-11-07T10:01:00.000Z' }) }],
  ['remove', { ...target, id: otherId, removed: true }],
  ['remove', { ...target, removed: false }],
] as const)('does not report %s success for the wrong mutation receipt', async (action, response) => {
  fetcher.mockResolvedValueOnce(Response.json(response));
  const result = await invoke(action, inputs[action]);
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: 'INVALID_RESPONSE' });
});
it.each([
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'LOST_FOUND_VERSION_CONFLICT'],
  [409, 'LOST_FOUND_REPLAY_CHANGED'],
  [410, 'LOST_FOUND_REMOVED'],
  [429, 'LOST_FOUND_RATE_LIMITED'],
])('keeps actionable upstream %i errors without private messages', async (status, code) => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: 'Private row and contact details' } }, { status }));
  const result = await invoke('update', inputs.update);
  expect(result.status).toBe(status);
  expect(await result.json()).toEqual({ error: code });
  expect(fetcher).toHaveBeenCalledOnce();
});
