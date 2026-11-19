// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleV2 } from './handler';
import { createAdapter } from './adapter';
import * as actions from './actions';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import type { Adapter, Card, EventArgs, ModelInput, ModelResult } from './contracts';

// Only provider, account identity and persistence are fixed fixtures. The real
// bootstrap, runner, tools, manifest checks, signing and confirmations execute.
const providerCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', () => ({ createAdapter: vi.fn() }));
vi.mock('./groq', async importOriginal => ({
  ...await importOriginal<typeof import('./groq')>(),
  createProviderModel: () => (input: ModelInput) => providerCall(input),
}));

const first: EventArgs = {
  title: '同名讀書', date: '2026-11-06', allDay: false, startTime: '18:00', endTime: '19:00',
};
const second: EventArgs = {
  title: '同名讀書', date: '2026-11-06', endDate: '2026-11-06', allDay: false, startTime: '20:00', endTime: '21:00',
};
const holiday: EventArgs = { title: '個人休息日', date: '2026-11-10', endDate: '2026-11-11', allDay: true };
const session = { sessionHandle: 'ps_' + 'h'.repeat(43), expiresAt: FIXTURE_NOW + 7200000 };
const schoolId = 'fixture-school';
let serial = 0, now: number, account: string, conversationId: string, routeToken: string;
let fixture: ReturnType<typeof fixtureAdapter>;
let signedCards: () => Card[];

function request(action: string, body: object, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json', ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function call(action: string, input: object, headers?: Record<string, string>) {
  const response = await handleV2(request(action, { schoolId, conversationId, ...input }, headers), action);
  return { status: response.status, body: await response.json() };
}
const raw = (card: Card) => ({ token: card.token, args: card.args });
async function initialPlan(events: EventArgs[] = [first, second, holiday]): Promise<Card[]> {
  const bootstrap = await call('ask', { question: '請新增讀書與休息日的行程預覽', history: [], consent: true });
  expect(bootstrap.status).toBe(200);
  expect(bootstrap.body.bootstrap).toBe(true);
  expect(providerCall).not.toHaveBeenCalled();
  conversationId = bootstrap.body.conversationId;
  routeToken = bootstrap.body.routeToken;
  let round = 0;
  providerCall.mockImplementation(async (): Promise<ModelResult> => ({
    message: ++round === 1 ? {
      role: 'assistant', content: '', tool_calls: events.map((event, index) => ({
        id: 'fixture-event-' + index, type: 'function' as const,
        function: { name: 'propose_personal_event', arguments: JSON.stringify(event) },
      })),
    } : { role: 'assistant', content: '固定 fixture：請核對原提議，確認前不會寫入。' },
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }));
  const response = await call('ask', {
    question: '請新增讀書與休息日的行程預覽', history: [], consent: true, routeToken,
  });
  expect(response.status).toBe(200);
  const cards = response.body.cards as Card[];
  expect(cards).toEqual(signedCards());
  expect(cards.every(card => card.tool === 'propose_personal_event')).toBe(true);
  expect(cards.map(card => card.args)).toEqual(events);
  expect(fixture.writes).toHaveLength(0);
  return cards;
}
async function cancelAll(cards: Card[]) {
  for (const card of cards) {
    const response = await call('cancel', raw(card));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'revoked', mutationId: card.mutationId });
  }
}
function shiftInput(cards: Card[], indices = [0, 1], offsetMinutes = 90, protectedIndices: number[] = []) {
  return { routeToken, originalCards: cards.map(raw), shift: {
    mutationIds: indices.map(index => cards[index].mutationId), offsetMinutes,
    protectedMutationIds: protectedIndices.map(index => cards[index].mutationId),
  } };
}
function expectFailure(response: { status: number; body: Record<string, unknown> }, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({ error });
  expect(response.body).not.toHaveProperty('cards');
}
async function expectRevoked(cards: Card[]) {
  for (const card of cards) {
    const result = await call('reconcile', raw(card));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'revoked', mutationId: card.mutationId, retryable: false });
  }
}

beforeEach(() => {
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'true');
  vi.stubEnv('BFF_SESSION_SECRET', FIXTURE_SECRET);
  vi.stubEnv('WEB_PUBLIC_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('FLY_MACHINE_ID', '');
  now = FIXTURE_NOW + ++serial * 60000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch forbidden in plan shift fixture'); }));
  providerCall.mockReset();
  fixture = fixtureAdapter();
  account = 'plan-shift-account-' + serial;
  conversationId = 'bootstrap-shift-hint-' + serial;
  routeToken = '';
  vi.mocked(createAdapter).mockReturnValue({
    adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }), apiCalls: () => 0,
  });
  const signing = vi.spyOn(actions, 'signCard');
  signedCards = () => signing.mock.results.filter(result => result.type === 'return').map(result => result.value as Card);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  { offset: 90, date: '2026-11-06', times: ['19:30', '20:30', '21:30', '22:30'] },
  { offset: -90, date: '2026-11-06', times: ['16:30', '17:30', '18:30', '19:30'] },
  { offset: 1440, date: '2026-11-07', times: ['18:00', '19:00', '20:00', '21:00'] },
  { offset: -1440, date: '2026-11-05', times: ['18:00', '19:00', '20:00', '21:00'] },
])('previews a $offset-minute group shift without model calls or writes and signs a complete ordered replacement', async ({ offset, date, times }) => {
  const old = await initialPlan(), baseline = fixture.snapshot();
  await cancelAll(old);
  const modelCalls = providerCall.mock.calls.length;
  const result = await call('revise', shiftInput(old, [1, 0], offset, [2]));
  expect(result.status).toBe(200);
  const next = result.body.cards as Card[];
  expect(next.map(card => card.args)).toEqual([
    { ...first, date, startTime: times[0], endTime: times[1] },
    { ...second, date, endDate: date, startTime: times[2], endTime: times[3] }, holiday,
  ]);
  expect(next).toEqual(signedCards().slice(old.length));
  expect(new Set(next.map(card => card.mutationId)).size).toBe(3);
  expect(next.every(card => old.every(previous => previous.mutationId !== card.mutationId && previous.token !== card.token))).toBe(true);
  expect(Object.hasOwn(next[0].args, 'endDate')).toBe(false);
  expect(Object.hasOwn(next[1].args, 'endDate')).toBe(true);
  expect(fixture.snapshot()).toEqual(baseline);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  for (const card of old) expectFailure(await call('confirm', raw(card)), 409, 'CONFIRMATION_REVOKED');
  for (const [index, card] of next.entries()) {
    const confirmed = await call('confirm', raw(card));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'verified', mutationId: card.mutationId, record: card.args });
    expect(fixture.writes).toHaveLength(index + 1);
  }
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('moves the selected same-name signed identity across midnight while a locked peer and all-day row stay exact', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const result = await call('revise', shiftInput(old, [1], 240, [0, 2]));
  expect(result.status).toBe(200);
  expect((result.body.cards as Card[]).map(card => card.args)).toEqual([
    first, { ...second, date: '2026-11-07', endDate: '2026-11-07', startTime: '00:00', endTime: '01:00' }, holiday,
  ]);
  expect(providerCall).toHaveBeenCalledTimes(2);
  expect(fixture.writes).toHaveLength(0);
});

it('validates the entire batch before signing when the second shifted event conflicts, then permits one safe retry only', async () => {
  const events = [
    { ...first, date: '2026-11-04' },
    { ...second, date: '2026-11-04', endDate: '2026-11-04', startTime: '22:00', endTime: '23:00' },
  ];
  const old = await initialPlan(events), baseline = fixture.snapshot();
  await cancelAll(old);
  const signedBefore = signedCards().length;
  // First becomes Thursday 05:30–06:30; second hits the real fixture's 09:00–11:00 class.
  expectFailure(await call('revise', shiftInput(old, [0, 1], 690)), 409, 'EVENT_CONFLICT');
  expect(signedCards()).toHaveLength(signedBefore);
  expect(fixture.snapshot()).toEqual(baseline);
  await expectRevoked(old);
  const input = shiftInput(old, [0, 1], 60), retry = await call('revise', input);
  expect(retry.status).toBe(200);
  expect((retry.body.cards as Card[]).map(card => card.args)).toEqual([
    { ...events[0], startTime: '19:00', endTime: '20:00' },
    { ...events[1], endDate: '2026-11-05', startTime: '23:00', endTime: '00:00' },
  ]);
  now += 61000;
  expectFailure(await call('revise', input), 409, 'CONFIRMATION_REVOKED');
  expect(signedCards()).toHaveLength(signedBefore + 2);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(2);
});

it.each(['zero', 'fraction', 'too-large', 'too-negative', 'empty', 'duplicate', 'unknown-id', 'too-many',
  'locked-overlap', 'duplicate-lock', 'unknown-lock', 'missing-locks', 'all-day', 'both-change', 'both-keep', 'extra-field'] as const)(
  'rejects %s shift input atomically with no signing or model call', async scenario => {
    const old = await initialPlan();
    await cancelAll(old);
    const input: Record<string, unknown> = shiftInput(old);
    const shift = input.shift as Record<string, unknown>;
    if (scenario === 'zero') shift.offsetMinutes = 0;
    if (scenario === 'fraction') shift.offsetMinutes = 0.5;
    if (scenario === 'too-large') shift.offsetMinutes = 1441;
    if (scenario === 'too-negative') shift.offsetMinutes = -1441;
    if (scenario === 'empty') shift.mutationIds = [];
    if (scenario === 'duplicate') shift.mutationIds = [old[0].mutationId, old[0].mutationId];
    if (scenario === 'unknown-id') shift.mutationIds = ['unissued-shift-id'];
    if (scenario === 'too-many') shift.mutationIds = Array(17).fill(old[0].mutationId);
    if (scenario === 'locked-overlap') shift.protectedMutationIds = [old[0].mutationId];
    if (scenario === 'duplicate-lock') shift.protectedMutationIds = [old[2].mutationId, old[2].mutationId];
    if (scenario === 'unknown-lock') shift.protectedMutationIds = ['unissued-lock-id'];
    if (scenario === 'missing-locks') delete shift.protectedMutationIds;
    if (scenario === 'all-day') shift.mutationIds = [old[2].mutationId];
    if (scenario === 'both-change') input.change = { mutationId: old[0].mutationId, date: first.date, startTime: '19:00', endTime: '20:00' };
    if (scenario === 'both-keep') input.keepMutationIds = [old[0].mutationId];
    if (scenario === 'extra-field') shift.timeZone = 'UTC';
    const count = signedCards().length;
    expectFailure(await call('revise', input), 422, 'INVALID_PLAN_SHIFT');
    expect(signedCards()).toHaveLength(count);
    expect(fixture.writes).toHaveLength(0);
    expect(providerCall).toHaveBeenCalledTimes(2);
  });

it.each(['missing', 'reordered', 'duplicate', 'tampered'] as const)('rejects a %s complete source even when only the first item moves', async scenario => {
  const old = await initialPlan();
  await cancelAll(old);
  const input = shiftInput(old, [0]);
  if (scenario === 'missing') input.originalCards.pop();
  if (scenario === 'reordered') input.originalCards.reverse();
  if (scenario === 'duplicate') input.originalCards[2] = input.originalCards[1];
  if (scenario === 'tampered') input.originalCards[2].args = { ...input.originalCards[2].args, title: '篡改未移動項' };
  const result = await call('revise', input);
  expect(result.status).toBe(scenario === 'tampered' ? 409 : 422);
  expect(result.body).not.toHaveProperty('cards');
  expect(signedCards()).toHaveLength(old.length);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(2);
});

it('requires every source to be revoked, including protected and unselected rows', async () => {
  const old = await initialPlan();
  expectFailure(await call('revise', shiftInput(old, [0], 30, [1, 2])), 409, 'PLAN_REVISION_UNRESOLVED');
  await cancelAll(old.slice(0, 2));
  expectFailure(await call('revise', shiftInput(old, [0], 30, [1, 2])), 409, 'PLAN_REVISION_UNRESOLVED');
  expect(signedCards()).toHaveLength(old.length);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(2);
});

it('cannot shift a source with an unknown dispatched write or its later verified result', async () => {
  const old = await initialPlan(), originalWrite = fixture.adapter.write;
  let pending: Parameters<Adapter['write']>[0] | undefined;
  const write = vi.spyOn(fixture.adapter, 'write').mockImplementation(async input => {
    pending = structuredClone(input);
    throw new Error('Synthetic unknown remote write');
  });
  expect((await call('confirm', raw(old[0]))).status).toBe(503);
  expectFailure(await call('cancel', raw(old[0])), 503, 'EXECUTION_UNKNOWN');
  await cancelAll(old.slice(1));
  expectFailure(await call('revise', shiftInput(old, [1], 30, [0])), 503, 'EXECUTION_UNKNOWN');
  expect(signedCards()).toHaveLength(old.length);
  await originalWrite(pending!);
  expect((await call('reconcile', raw(old[0]))).body.status).toBe('verified');
  expectFailure(await call('revise', shiftInput(old, [1], 30, [0])), 409, 'PLAN_REVISION_UNRESOLVED');
  expect(write).toHaveBeenCalledTimes(1);
  expect(fixture.writes).toHaveLength(1);
  expect(signedCards()).toHaveLength(old.length);
  expect(providerCall).toHaveBeenCalledTimes(2);
});

it.each(['account', 'school', 'conversation'] as const)('rejects a changed %s scope without signing or writing', async scope => {
  const old = await initialPlan();
  await cancelAll(old);
  const input: Record<string, unknown> = shiftInput(old);
  if (scope === 'account') account += '-other';
  if (scope === 'school') input.schoolId = 'other-fixture-school';
  if (scope === 'conversation') input.conversationId = 'other-conversation';
  expectFailure(await call('revise', input), 409, 'CONFIRMATION_REVOKED');
  expect(signedCards()).toHaveLength(old.length);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(2);
});
