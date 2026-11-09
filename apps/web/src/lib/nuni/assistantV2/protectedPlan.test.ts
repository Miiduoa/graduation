// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleV2 } from './handler';
import { createAdapter } from './adapter';
import { beginProposal, confirm, issueRoute, signCard, verifyCard } from './actions';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import type { Binding, Card, EventArgs } from './contracts';
import type { RunInput } from './runner';

const { runCall, providerCall } = vi.hoisted(() => ({ runCall: vi.fn(), providerCall: vi.fn() }));
vi.mock('./adapter', () => ({ createAdapter: vi.fn() }));
vi.mock('./runner', async importOriginal => ({
  ...await importOriginal<typeof import('./runner')>(), run: runCall,
}));
vi.mock('./groq', async importOriginal => ({
  ...await importOriginal<typeof import('./groq')>(), createProviderModel: () => providerCall,
}));

const first: EventArgs = { title: '保留的英文閱讀', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' };
const second: EventArgs = { title: '可調整的程式練習', date: '2026-11-04', allDay: false, startTime: '19:00', endTime: '20:00' };
const changed: EventArgs = { ...second, startTime: '20:00', endTime: '21:00' };
const protectedPlan = { originalEvents: [first, second], protectedIndices: [0] };
const session = { sessionHandle: 'ps_' + 'p'.repeat(43), expiresAt: FIXTURE_NOW + 3600000 };
const rawCard = (card: Card) => ({ token: card.token, args: card.args });
let serial = 0;
let binding: Binding;
let fixture: ReturnType<typeof fixtureAdapter>;

function request(action: string, body: object, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST',
    headers: { cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function askPayload(protection: unknown = protectedPlan, routed = true) {
  return { schoolId: binding.schoolId, conversationId: binding.conversationId,
    question: '第二項改成20:00，保留第一項', history: [], consent: true,
    ...(routed ? { routeToken: issueRoute(binding, FIXTURE_SECRET) } : {}),
    ...(protection === undefined ? {} : { planProtection: protection }),
  };
}
function signEvents(events: EventArgs[], scope = binding): Card[] {
  const sequence = beginProposal(scope, FIXTURE_NOW);
  const cards: Card[] = [];
  for (const [index, event] of events.entries())
    cards.push(signCard(scope, 'propose_personal_event', event, index + 1, FIXTURE_SECRET,
      FIXTURE_NOW, sequence, cards.at(-1)));
  return cards;
}
function result(cards: Card[]) {
  return { answer: 'PRIVATE_CANDIDATE_ANSWER', cards, steps: [], version: 2,
    modelCalls: 0, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    stopReason: '', simulation: true };
}

beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'true');
  vi.stubEnv('BFF_SESSION_SECRET', FIXTURE_SECRET);
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('FLY_MACHINE_ID', '');
  vi.spyOn(Date, 'now').mockReturnValue(FIXTURE_NOW);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  runCall.mockReset();
  providerCall.mockReset();
  fixture = fixtureAdapter();
  binding = { account: 'protected-plan-account-' + ++serial, session: sessionContext(session),
    conversationId: 'protected-plan-conversation-' + serial, schoolId: 'fixture-school' };
  vi.mocked(createAdapter).mockReturnValue({ adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: binding.account, isPlatformOperator: false }), apiCalls: () => 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  { name: 'null payload', plan: null },
  { name: 'partial exact duplicate group', plan: { originalEvents: [first, first, second], protectedIndices: [0] } },
  { name: 'out-of-range index', plan: { originalEvents: [first, second], protectedIndices: [2] } },
  { name: 'unexpected payload field', plan: { ...protectedPlan, token: 'PRIVATE_INPUT_TOKEN' } },
])('rejects $name before bootstrap or planning and leaves the old authorization intact', async ({ plan }) => {
  const [old] = signEvents([first]);
  const response = await handleV2(request('ask', askPayload(plan, false)), 'ask');
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: 'INVALID_PLAN_PROTECTION',
    message: '保留項目設定無效，請重新選擇要保留的原提議內容。' });
  expect(runCall).not.toHaveBeenCalled();
  expect(providerCall).not.toHaveBeenCalled();
  expect(verifyCard(binding, rawCard(old), FIXTURE_SECRET, FIXTURE_NOW).mutationId).toBe(old.mutationId);
  expect(fixture.writes).toHaveLength(0);
});

it.each([true, false])('preserving every item leaves the old preview untouched without planning (routed=%s)', async routed => {
  const old = signEvents([first, second]);
  const response = await handleV2(request('ask', askPayload({ ...protectedPlan, protectedIndices: [0, 1] }, routed)), 'ask');
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: 'PLAN_ALREADY_PRESERVED',
    message: '已選擇保留全部項目，不需要重新預覽；原提議沒有變更。' });
  expect(runCall).not.toHaveBeenCalled();
  expect(providerCall).not.toHaveBeenCalled();
  for (const card of old)
    expect(verifyCard(binding, rawCard(card), FIXTURE_SECRET, FIXTURE_NOW).mutationId).toBe(card.mutationId);
  expect(fixture.writes).toHaveLength(0);
});

it.each([
  { name: 'missing protected event', events: [changed] },
  { name: 'changed protected time', events: [{ ...first, startTime: '17:00', endTime: '18:00' }, changed] },
  { name: 'duplicated protected event', events: [first, first, changed] },
  { name: 'renamed protected-time shadow', events: [first, { ...first, title: '另一個名稱' }, changed] },
  { name: 'empty candidate', events: [] },
])('retires internal signed cards for $name before returning a fixed error and never writes', async ({ events }) => {
  let internal: Card[] = [];
  const [old] = signEvents([first]);
  runCall.mockImplementation(async (input: RunInput) => {
    // Also cover an internally signed card omitted from an empty final result.
    internal = signEvents(events.length ? events : [first], input.binding);
    input.log?.({ event: 'assistant.completed', stage: 'ask', status: 200 });
    return result(events.length ? internal : []);
  });
  const response = await handleV2(request('ask', askPayload()), 'ask');
  expect(response.status).toBe(422);
  const body = await response.json();
  expect(body).toEqual({ error: 'PLAN_PROTECTION_MISMATCH',
    message: '新提議未完整保留指定項目，這次預覽已停止。請調整修改條件後重新預覽。' });
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_CANDIDATE|mutationId|cards|token|answer|保留的英文閱讀/);
  for (const card of [old, ...internal])
    await expect(confirm(binding, rawCard(card), FIXTURE_SECRET, FIXTURE_NOW, fixture.adapter, true))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).toContain('PLAN_PROTECTION_MISMATCH');
  expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/PRIVATE_CANDIDATE|保留的英文閱讀/);
});

it('rejects a mixed-service candidate and also retires its internally captured page token', async () => {
  let internal: Card[] = [];
  runCall.mockImplementation(async (input: RunInput) => {
    const sequence = beginProposal(input.binding, FIXTURE_NOW);
    internal = [
      signCard(input.binding, 'propose_personal_event', first, 1, FIXTURE_SECRET, FIXTURE_NOW, sequence),
      signCard(input.binding, 'propose_open_page', { page: 'calendar' }, 0, FIXTURE_SECRET, FIXTURE_NOW, sequence),
    ];
    return result(internal);
  });
  const response = await handleV2(request('ask', askPayload()), 'ask');
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: 'PLAN_PROTECTION_MISMATCH' });
  for (const card of internal)
    await expect(confirm(binding, rawCard(card), FIXTURE_SECRET, FIXTURE_NOW, fixture.adapter, true))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
  expect(fixture.writes).toHaveLength(0);
});

it('returns fresh valid signed cards unchanged and requires explicit confirmation for each write', async () => {
  const old = signEvents([first, second]);
  let internal: Card[] = [];
  runCall.mockImplementation(async (input: RunInput) => {
    internal = signEvents([first, changed], input.binding);
    return result(internal);
  });
  const response = await handleV2(request('ask', askPayload()), 'ask');
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.cards).toEqual(internal);
  expect(internal.map(card => card.args)).toEqual([first, changed]);
  expect(fixture.writes).toHaveLength(0);
  for (const [index, card] of internal.entries()) {
    expect(card.token).not.toBe(old[index].token);
    expect(card.mutationId).not.toBe(old[index].mutationId);
    const confirmed = await handleV2(request('confirm', { schoolId: binding.schoolId,
      conversationId: binding.conversationId, ...rawCard(card) }), 'confirm');
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ status: 'verified', mutationId: card.mutationId,
      record: { ...[first, changed][index], id: card.mutationId } });
    expect(fixture.writes).toHaveLength(index + 1);
  }
  expect(fixture.writes.map(write => write.mutationId)).toEqual(internal.map(card => card.mutationId));
  expect(providerCall).not.toHaveBeenCalled();
});

it('keeps protected asks behind origin, session and route-owner authentication', async () => {
  for (const [headers, status] of [[{ Origin: 'https://example.invalid' }, 403], [{ cookie: '' }, 401],
    [{ 'X-Campus-Session': 'different' }, 409]] as [Record<string, string>, number][]) {
    expect((await handleV2(request('ask', askPayload(), headers), 'ask')).status).toBe(status);
  }
  const routeToken = issueRoute({ ...binding, account: 'another-account' }, FIXTURE_SECRET);
  expect((await handleV2(request('ask', { ...askPayload(), routeToken }), 'ask')).status).toBe(409);
  expect(runCall).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
});
