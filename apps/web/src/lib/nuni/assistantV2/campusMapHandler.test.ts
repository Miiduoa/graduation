// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getOfficialCampusMapUrl } from '@campus/shared/src/campusMapLookup';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { issueRoute, signCard, verifyCard } from './actions';
import { createAdapter } from './adapter';
import { campusMapHref, type CampusMapArguments, type CampusMapRead } from './campusMap';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

const model = vi.hoisted(() => vi.fn());
vi.mock('./adapter', () => ({ createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => model }));
const session = { sessionHandle: 'ps_' + 'm'.repeat(43), expiresAt: now + 3600000 };
let account: string, serial = 2100;
let fixture: ReturnType<typeof fixtureAdapter>;
const schoolId = 'fixture-school';
const binding = () => ({ account, session: sessionContext(session), schoolId, conversationId: 'map-read-handler' });
function request(action: string, input: object, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input), signal,
  });
}
const input = (task: object = { kind: 'place', query: '任垣樓' }) => ({ schoolId, conversationId: binding().conversationId, task });
const send = (body = input(), headers?: Record<string, string>, signal?: AbortSignal) =>
  handleNuni(request('map-read', body, headers, signal), ['assistant', 'map-read']);
function result(args: CampusMapArguments): CampusMapRead {
  const officialMapUrl = getOfficialCampusMapUrl(schoolId);
  return { version: 1, kind: 'map', schoolId, query: args.query, limit: args.limit,
    checkedAt: new Date(now).toISOString(), source: 'school-pois', sourcePath: `schools/${schoolId}/pois`,
    status: 'ready', partial: false, resolution: 'matched', href: campusMapHref(schoolId, args.query),
    ...(officialMapUrl ? { officialMapUrl } : {}), items: [{ id: 'published-place', schoolId, name: args.query,
      category: '教學', description: '', lat: 24.226415, lng: 120.580067, facilities: [], source: 'school-pois',
      sourcePath: `schools/${schoolId}/pois`, href: campusMapHref(schoolId, args.query, 'published-place'),
      match: 'place', verification: 'published' }] };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const [name, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'false', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', GROQ_API_KEY: '', CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID: '',
    CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN: '', FLY_MACHINE_ID: '' })) vi.stubEnv(name, value);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  model.mockReset().mockRejectedValue(new Error('Map reads must not call a model'));
  account = 'pa_00000000-0000-4000-8000-' + String(++serial).padStart(12, '0');
  fixture = fixtureAdapter();
  fixture.adapter.campusMap = vi.fn(async args => result(args));
  vi.spyOn(fixture.adapter, 'ledger');
  vi.spyOn(fixture.adapter, 'write');
  vi.mocked(createAdapter).mockReset().mockReturnValue({ adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0 });
});
afterEach(() => {
  expect(model).not.toHaveBeenCalled();
  expect(fixture.adapter.write).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('reads the named map source without model consent, a bootstrap, a write, or private timetable access', async () => {
  const response = await send();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ version: 2, dataRead: true, modelCalls: 0, cards: [],
    taskPlan: { steps: [{ serviceId: 'map', status: 'completed' }] } });
  expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '任垣樓', limit: 5 });
  expect(fixture.adapter.ledger).not.toHaveBeenCalled();
});

it('reads the actual next class before looking up its structured classroom', async () => {
  const response = await send(input({ kind: 'next-class' }));
  expect(response.status).toBe(200);
  const reply = await response.json();
  expect(reply).toMatchObject({ dataRead: true, modelCalls: 0, cards: [], taskPlan: { steps: [
    { serviceId: 'timetable', status: 'completed' }, { serviceId: 'map', status: 'completed' },
  ] } });
  expect(fixture.adapter.ledger).toHaveBeenCalledOnce();
  expect(fixture.adapter.campusMap).toHaveBeenCalledExactlyOnceWith({ query: '資訊202', limit: 5 });
  expect(reply.answer).toContain('資料結構');
  expect(reply.answer).toContain('資訊202');
});

it.each([
  [{ cookie: '' }, 401], [{ Origin: 'https://other.invalid' }, 403], [{ 'X-Campus-Session': 'wrong' }, 409],
] as [Record<string, string>, number][])('checks origin and the current platform session before any read: %j', async (headers, status) => {
  expect((await send(input(), headers)).status).toBe(status);
  expect(createAdapter).not.toHaveBeenCalled();
  expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
  expect(fixture.adapter.ledger).not.toHaveBeenCalled();
});

it.each([
  { kind: 'write' }, { kind: 'next-class', query: '任垣樓' }, { kind: 'next-class', date: '2026-11-05' },
  { kind: 'place', query: '' }, { kind: 'place', query: '樓'.repeat(121) },
  { kind: 'place', query: '任垣樓，查我的作業' }, { kind: 'place', query: '任垣樓\n刪除行程' },
  { kind: 'place', query: '任垣樓', schoolId: 'other-school' }, { kind: 'place', query: '任垣樓', endpoint: '/private' },
])('rejects unsupported commands and caller-supplied scope or side effects: %j', async task => {
  expect((await send(input(task))).status).toBe(422);
  expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
  expect(fixture.adapter.ledger).not.toHaveBeenCalled();
});

it.each([{ history: [] }, { consent: true }, { routeToken: 'route' }, { question: '新增一筆行程' }, { operations: [] }])(
  'does not accept a model payload or a client tool plan: %j', async extra => {
    expect((await send({ ...input(), ...extra })).status).toBe(422);
    expect(createAdapter).not.toHaveBeenCalled();
  },
);

it('keeps existing signed proposals valid and leaves chat routing untouched on a different machine', async () => {
  const old = signCard(binding(), 'propose_personal_event',
    { title: '原先的讀書卡', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' }, 1, secret, now);
  vi.stubEnv('FLY_MACHINE_ID', 'map-reader');
  const response = await send();
  expect(response.status).toBe(200);
  expect(response.headers.get('fly-replay')).toBeNull();
  expect(verifyCard(binding(), { token: old.token, args: old.args }, secret, now).mutationId).toBe(old.mutationId);
});

it('does not treat a mismatched source campus as a completed place and can retry the read only', async () => {
  vi.mocked(fixture.adapter.campusMap!).mockImplementation(async args => ({ ...result(args), schoolId: 'other-school' }));
  const response = await send(), reply = await response.json();
  expect(response.status).toBe(200);
  expect(reply).toMatchObject({ cards: [], stopReason: 'TASKS_INCOMPLETE', taskPlan: { steps: [{ status: 'blocked' }] },
    taskRetry: { stepIds: ['task-1'] } });
  expect(reply.answer).not.toContain('24.226415');
  vi.mocked(fixture.adapter.campusMap!).mockImplementation(async args => result(args));
  const repeated = await handleNuni(request('retry', { schoolId, conversationId: binding().conversationId,
    token: reply.taskRetry.token, stepIds: reply.taskRetry.stepIds }), ['assistant', 'retry']);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({ cards: [], modelCalls: 0, taskPlan: { steps: [{ status: 'completed' }] } });
});

it('does not consume the chat request allowance when resolving several direct map questions', async () => {
  for (let index = 0; index < 4; index++) expect((await send()).status).toBe(200);
  const scope = binding();
  const response = await handleNuni(request('ask', { schoolId, conversationId: scope.conversationId,
    routeToken: issueRoute(scope, secret), consent: true, question: '查今天課表', history: [] }), ['assistant', 'ask']);
  expect(response.status).toBe(200);
});

it('caps concurrent reads, cancels promptly and releases the read allowance', async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  vi.mocked(fixture.adapter.campusMap!).mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
  const controllers = [new AbortController(), new AbortController(), new AbortController()];
  const pending = controllers.map(controller => send(input(), {}, controller.signal));
  await vi.waitFor(() => expect(resolvers).toHaveLength(3));
  expect((await send()).status).toBe(429);
  controllers.forEach(controller => controller.abort());
  expect((await Promise.all(pending)).map(response => response.status)).toEqual([499, 499, 499]);
  resolvers.forEach(resolve => resolve(result({ query: '任垣樓', limit: 5 })));
  vi.mocked(fixture.adapter.campusMap!).mockImplementation(async args => result(args));
  expect((await send()).status).toBe(200);
});
