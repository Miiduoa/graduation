// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { handleNuni } from '../api';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { issueRoute, signCard, verifyCard } from './actions';
import { createAdapter } from './adapter';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { publicEventArgs, publicEventFingerprint, publicEventHref, publicEventSourcePath, type PublicEventSourceItem } from './publicEvent';

const model = vi.hoisted(() => vi.fn());
vi.mock('./adapter', () => ({ createAdapter: vi.fn() }));
vi.mock('./groq', async original => ({ ...(await original<typeof import('./groq')>()), createProviderModel: () => model }));
const session = { sessionHandle: 'ps_' + 'e'.repeat(43), expiresAt: now + 3600000 };
const schoolId = 'fixture-school';
const target = { schoolId, source: 'school-club-events' as const, id: 'selected-event' };
const item: PublicEventSourceItem = { ...target, title: '特別選取的第二場活動',
  startsAt: '2026-11-04T12:00:00.000Z', endsAt: '2026-11-04T13:00:00.000Z', href: publicEventHref(target) };
let account: string, fixture: ReturnType<typeof fixtureAdapter>;
const binding = (conversationId = 'original-chat') => ({ account, session: sessionContext(session), schoolId, conversationId });
function request(action: string, input: object, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input), signal,
  });
}
const send = (action: string, input: object, headers?: Record<string, string>, signal?: AbortSignal) =>
  handleNuni(request(action, input, headers, signal), ['assistant', action]);
async function bootstrap() {
  const response = await send('event-preview', { schoolId, conversationId: 'client-hint-only', event: target });
  expect(response.status).toBe(200);
  const route = await response.json();
  expect(route).toMatchObject({ bootstrap: true, conversationId: expect.any(String), routeToken: expect.any(String) });
  expect(route.conversationId).not.toBe('client-hint-only');
  return { schoolId, conversationId: route.conversationId as string, routeToken: route.routeToken as string, event: target };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  for (const [name, value] of Object.entries({ CAMPUS_BACKEND: 'nuni', CAMPUS_ASSISTANT_ENABLED: 'true',
    CAMPUS_ASSISTANT_V2_ENABLED: 'true', CAMPUS_ASSISTANT_V2_WRITES_ENABLED: 'true', BFF_SESSION_SECRET: secret,
    WEB_PUBLIC_ORIGIN: 'http://localhost:3000', GROQ_API_KEY: '', FLY_MACHINE_ID: '' })) vi.stubEnv(name, value);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  model.mockReset().mockRejectedValue(new Error('Selected event preparation must not call a model'));
  account = 'pa_' + randomUUID();
  fixture = fixtureAdapter();
  fixture.adapter.publicEvent = vi.fn(async () => ({ version: 1, target, sourcePath: publicEventSourcePath(target),
    checkedAt: new Date(now).toISOString(), status: 'ready', item,
    fingerprint: publicEventFingerprint(item), args: publicEventArgs(item, now) }));
  vi.spyOn(fixture.adapter, 'write');
  vi.mocked(createAdapter).mockReset().mockReturnValue({ adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0 });
});
afterEach(() => { expect(model).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('bootstraps an independent source action and uses the existing signed confirmation and receipt flow', async () => {
  const old = signCard(binding(), 'propose_personal_event',
    { title: '原先的讀書卡', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' }, 1, secret, now);
  const input = await bootstrap();
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  expect(fixture.adapter.write).not.toHaveBeenCalled();
  const response = await send('event-preview', input), reply = await response.json();
  expect(response.status).toBe(200);
  expect(reply).toMatchObject({ version: 2, campusEventPreview: true, dataRead: true, modelCalls: 0,
    cards: [{ tool: 'propose_personal_event', args: { title: item.title, startTime: '20:00', endTime: '21:00' } }],
    eventTargets: [{ ...item, checkedAt: new Date(now).toISOString() }] });
  expect(fixture.adapter.publicEvent).toHaveBeenCalledExactlyOnceWith(target);
  expect(fixture.adapter.write).not.toHaveBeenCalled();
  expect(verifyCard(binding(), { token: old.token, args: old.args }, secret, now).mutationId).toBe(old.mutationId);
  const card = reply.cards[0];
  const confirmed = await send('confirm', { schoolId, conversationId: input.conversationId, token: card.token, args: card.args });
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({ status: 'verified', mutationId: card.mutationId });
  expect(fixture.adapter.write).toHaveBeenCalledOnce();
});

it.each([
  [{ cookie: '' }, 401], [{ Origin: 'https://other.invalid' }, 403], [{ 'X-Campus-Session': 'wrong' }, 409],
] as [Record<string, string>, number][])('validates the platform login and request origin first: %j', async (headers, status) => {
  const response = await send('event-preview', { schoolId, conversationId: 'x', event: target }, headers);
  expect(response.status).toBe(status);
  expect(createAdapter).not.toHaveBeenCalled();
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
});

it.each([
  { ...target, schoolId: 'another-school' }, { ...target, source: 'users' },
  { ...target, id: '../private' }, { ...target, title: '不要用這個客戶端標題' },
  { ...target, startsAt: item.startsAt }, { ...target, href: 'https://other.invalid' },
])('does not accept another scope or caller-supplied calendar facts %j', async event => {
  const response = await send('event-preview', { schoolId, conversationId: 'x', event });
  expect([403, 422]).toContain(response.status);
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
});

it('does not let event preparation reuse or take over a chat route', async () => {
  const response = await send('event-preview', { schoolId, conversationId: binding().conversationId,
    routeToken: issueRoute(binding(), secret), event: target });
  expect(response.status).toBe(409);
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  const route = await bootstrap();
  const chat = await send('ask', { schoolId, conversationId: route.conversationId, routeToken: route.routeToken,
    question: '查今天課表', history: [], consent: true });
  expect(chat.status).toBe(409);
});

it('binds the isolated route to the account and session, even before source reads', async () => {
  const route = await bootstrap();
  account = 'pa_' + randomUUID();
  expect((await send('event-preview', route)).status).toBe(409);
  expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
});

it('keeps missing source availability truthful with no card or model request', async () => {
  const route = await bootstrap();
  fixture.adapter.publicEvent = vi.fn(async () => ({ version: 1, target, sourcePath: publicEventSourcePath(target),
    checkedAt: new Date(now).toISOString(), status: 'unavailable', unavailable: 'MISSING_END_TIME' }));
  const response = await send('event-preview', route);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ campusEventPreview: true, cards: [], stopReason: 'CAMPUS_EVENT_TIME_REQUIRED',
    eventTargets: [], dataRead: true, modelCalls: 0 });
  expect(fixture.adapter.write).not.toHaveBeenCalled();
});

it('shares the structured-preview allowance, and stops before reading after the limit', async () => {
  for (let index = 0; index < 3; index++) {
    const route = await bootstrap();
    expect((await send('event-preview', route)).status).toBe(200);
  }
  const route = await bootstrap();
  const response = await send('event-preview', route);
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ error: 'LOCAL_ACCOUNT_LIMIT' });
  expect(fixture.adapter.publicEvent).toHaveBeenCalledTimes(3);
  expect(fixture.adapter.write).not.toHaveBeenCalled();
});

it('routes subsequent event preparation back to its issuer without creating replacement authority', async () => {
  vi.stubEnv('FLY_MACHINE_ID', 'event-owner');
  const route = await bootstrap();
  vi.stubEnv('FLY_MACHINE_ID', 'another-machine');
  vi.mocked(createAdapter).mockClear();
  const response = await send('event-preview', route);
  expect(response.status).toBe(409);
  expect(response.headers.get('fly-replay')).toBe('instance=event-owner');
  expect(createAdapter).not.toHaveBeenCalled();
});
