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
  title: '同名讀書', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00',
};
const second: EventArgs = {
  title: '同名讀書', date: '2026-11-04', endDate: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00',
};
const holiday: EventArgs = { title: '個人休息日', date: '2026-11-07', endDate: '2026-11-08', allDay: true };
const removed: EventArgs = {
  title: '下週複習', date: '2026-11-09', allDay: false, startTime: '18:00', endTime: '19:00',
};
const session = { sessionHandle: 'ps_' + 's'.repeat(43), expiresAt: FIXTURE_NOW + 7200000 };
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
function selection(cards: Card[], indices = [0]) {
  return { routeToken, originalCards: cards.map(raw), keepMutationIds: indices.map(index => cards[index].mutationId) };
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
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch forbidden in plan selection fixture'); }));
  providerCall.mockReset();
  fixture = fixtureAdapter();
  account = 'plan-selection-account-' + serial;
  conversationId = 'bootstrap-selection-hint-' + serial;
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

it('keeps exact raw arguments in original order with fresh authority and individual idempotent confirmations', async () => {
  const old = await initialPlan([first, second, holiday, removed]), before = fixture.snapshot();
  await cancelAll(old);
  const modelCalls = providerCall.mock.calls.length, write = vi.spyOn(fixture.adapter, 'write');
  const result = await call('revise', selection(old, [2, 1, 0]));
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ version: 2, steps: [], simulation: true });
  const next = result.body.cards as Card[], retained = [first, second, holiday];
  expect(next).toHaveLength(3);
  expect(next).toEqual(signedCards().slice(old.length));
  expect(next.map(card => card.args)).toEqual(retained);
  expect(Object.hasOwn(next[0].args, 'endDate')).toBe(false);
  expect(Object.hasOwn(next[1].args, 'endDate')).toBe(true);
  expect(Object.hasOwn(next[2].args, 'startTime')).toBe(false);
  expect(next.every(card => !old.some(previous => previous.mutationId === card.mutationId || previous.token === card.token))).toBe(true);
  expect(new Set(next.map(card => card.mutationId)).size).toBe(3);
  expect(new Set(next.map(card => card.token)).size).toBe(3);
  expect(write).not.toHaveBeenCalled();
  expect(fixture.snapshot()).toEqual(before);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);

  for (const card of old) expectFailure(await call('confirm', raw(card)), 409, 'CONFIRMATION_REVOKED');
  expect(write).not.toHaveBeenCalled();
  expectFailure(await call('confirm', raw(next[1])), 409, 'PERSONAL_IMPORT_REVISION_CONFLICT');
  expect(write).not.toHaveBeenCalled();
  for (const [index, card] of next.entries()) {
    const confirmed = await call('confirm', raw(card));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      status: 'verified', mutationId: card.mutationId, record: { ...retained[index], id: card.mutationId },
    });
    expect(write).toHaveBeenCalledTimes(index + 1);
    const repeated = await call('confirm', raw(card));
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({ status: 'verified', mutationId: card.mutationId, replay: true });
    for (let check = 0; check < 2; check++) {
      const reconciled = await call('reconcile', raw(card));
      expect(reconciled.status).toBe(200);
      expect(reconciled.body).toMatchObject({ status: 'verified', mutationId: card.mutationId });
    }
    expect(write).toHaveBeenCalledTimes(index + 1);
    expect(fixture.writes).toHaveLength(index + 1);
  }
  const ledger = fixture.snapshot();
  expect(ledger.records).toHaveLength(before.records.length + next.length);
  expect(ledger.records.filter(row => next.some(card => card.mutationId === row.id))).toHaveLength(3);
  expect(ledger.records.some(row => old.some(card => card.mutationId === row.id))).toBe(false);
  expect(ledger.records.some(row => row.title === removed.title)).toBe(false);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  expect(fetch).not.toHaveBeenCalled();
});

it('checks a newly changed ledger and keeps a conflicted source reusable for a different selection', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  // Simulate an independent write in the fixed persistence fixture, never an assistant confirmation.
  const baseline = fixture.snapshot(), template = baseline.records.find(row => row.kind === 'events')!;
  await fixture.adapter.write({
    schoolId, mutationId: 'outside-fixture-write', expectedRevision: baseline.revision,
    records: [...baseline.records, {
      ...template, kind: 'events', id: 'outside-fixture-event', title: '其他來源的行程 fixture',
      date: first.date, allDay: false, startTime: '18:30', endTime: '19:30',
    }],
  });
  const before = fixture.snapshot(), write = vi.spyOn(fixture.adapter, 'write');
  const modelCalls = providerCall.mock.calls.length, signedBefore = signedCards().length;
  expectFailure(await call('revise', selection(old, [0, 2])), 409, 'EVENT_CONFLICT');
  expect(signedCards()).toHaveLength(signedBefore);
  expect(write).not.toHaveBeenCalled();
  expect(fixture.snapshot()).toEqual(before);
  await expectRevoked(old);
  const result = await call('revise', selection(old, [2, 1]));
  expect(result.status).toBe(200);
  expect((result.body.cards as Card[]).map(card => card.args)).toEqual([second, holiday]);
  expect(signedCards()).toHaveLength(signedBefore + 2);
  expect(write).not.toHaveBeenCalled();
  now += 61000; // A later retry must respect the unchanged three requests per minute limit.
  expectFailure(await call('revise', selection(old, [1])), 409, 'CONFIRMATION_REVOKED');
  expect(signedCards()).toHaveLength(signedBefore + 2);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it.each([
  'empty', 'all', 'duplicate', 'unknown', 'not-array', 'non-string-member', 'whitespace-id', 'both', 'neither',
] as const)('rejects %s selection input without new signatures or persistence', async scenario => {
  const old = await initialPlan();
  await cancelAll(old);
  const input: Record<string, unknown> = selection(old), count = signedCards().length;
  const modelCalls = providerCall.mock.calls.length;
  if (scenario === 'empty') input.keepMutationIds = [];
  if (scenario === 'all') input.keepMutationIds = old.map(card => card.mutationId).reverse();
  if (scenario === 'duplicate') input.keepMutationIds = [old[0].mutationId, old[0].mutationId];
  if (scenario === 'unknown') input.keepMutationIds = ['unissued-selection-id'];
  if (scenario === 'not-array') input.keepMutationIds = old[0].mutationId;
  if (scenario === 'non-string-member') input.keepMutationIds = [{ mutationId: old[0].mutationId, extra: true }];
  if (scenario === 'whitespace-id') input.keepMutationIds = [' ' + old[0].mutationId + ' '];
  if (scenario === 'both') input.change = {
    mutationId: old[0].mutationId, date: first.date, startTime: '19:00', endTime: '20:00',
  };
  if (scenario === 'neither') delete input.keepMutationIds;
  expectFailure(await call('revise', input), 422, 'INVALID_PLAN_SELECTION');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  await expectRevoked(old);
});

it('keeps unknown top-level fields behind the existing invalid-input gate', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  expectFailure(await call('revise', { ...selection(old), extra: true }), 422, 'INVALID_INPUT');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('requires the complete original manifest, even when only an early item will be kept', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  const manifests = [old.slice(0, -1), [...old].reverse(), [old[0], old[0], old[2]]];
  for (const [index, manifest] of manifests.entries()) {
    if (index === 2) now += 61000;
    expectFailure(await call('revise', { ...selection(old), originalCards: manifest.map(raw) }),
      422, 'INVALID_PLAN_REVISION');
    expect(signedCards()).toHaveLength(count);
  }
  await expectRevoked(old);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('checks the token and original arguments of omitted source rows as well as retained rows', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  for (const target of ['token', 'arguments'] as const) {
    const input = selection(old, [1]);
    if (target === 'token') input.originalCards[0].token += 'x';
    else input.originalCards[0].args = { ...input.originalCards[0].args, title: '不應接受的來源變更' };
    const result = await call('revise', input);
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toMatch(/^CONFIRMATION_/);
    expect(result.body).not.toHaveProperty('cards');
  }
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('requires cancellation of every source card, including every omitted item', async () => {
  const old = await initialPlan(), count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  expectFailure(await call('revise', selection(old)), 409, 'PLAN_REVISION_UNRESOLVED');
  expect((await call('cancel', raw(old[0]))).status).toBe(200);
  expectFailure(await call('revise', selection(old)), 409, 'PLAN_REVISION_UNRESOLVED');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('cannot omit an unknown write or reuse its source after the late write is reconciled', async () => {
  const old = await initialPlan(), originalWrite = fixture.adapter.write;
  let pending: Parameters<Adapter['write']>[0] | undefined;
  const write = vi.spyOn(fixture.adapter, 'write').mockImplementation(async input => {
    pending = structuredClone(input);
    throw new Error('Fixed fixture response lost before commit');
  });
  expect((await call('confirm', raw(old[0]))).status).toBe(503);
  expect(write).toHaveBeenCalledTimes(1);
  expect(fixture.writes).toHaveLength(0);
  expectFailure(await call('cancel', raw(old[0])), 503, 'EXECUTION_UNKNOWN');
  await cancelAll(old.slice(1));
  const count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  expectFailure(await call('revise', selection(old, [1])), 503, 'EXECUTION_UNKNOWN');
  expect(pending).toBeDefined();
  await originalWrite(pending!);
  const recovered = await call('reconcile', raw(old[0]));
  expect(recovered.status).toBe(200);
  expect(recovered.body).toMatchObject({ status: 'verified', mutationId: old[0].mutationId });
  expectFailure(await call('revise', selection(old, [1])), 409, 'PLAN_REVISION_UNRESOLVED');
  expect(write).toHaveBeenCalledTimes(1);
  expect(fixture.writes).toHaveLength(1);
  expect(signedCards()).toHaveLength(count);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('rejects a different account, school, conversation or expired source before signing', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const owner = account, input = selection(old), count = signedCards().length;
  const modelCalls = providerCall.mock.calls.length, ledger = vi.spyOn(fixture.adapter, 'ledger');
  for (const changed of ['account', 'school', 'conversation'] as const) {
    if (changed === 'account') account = 'another-selection-account';
    const extra = changed === 'school' ? { schoolId: 'another-school' }
      : changed === 'conversation' ? { conversationId: 'another-conversation' } : {};
    const response = await call('revise', { ...input, ...extra });
    expect(response.status).toBe(409);
    expect(response.body).not.toHaveProperty('cards');
    account = owner;
  }
  expect(ledger).not.toHaveBeenCalled();
  now += 300000;
  const expired = await call('revise', input);
  expect(expired.status).toBe(409);
  expect(String(expired.body.error)).toMatch(/^CONFIRMATION_/);
  expect(expired.body).not.toHaveProperty('cards');
  expect(signedCards()).toHaveLength(count);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  expect(fixture.writes).toHaveLength(0);
});

it('preserves authentication, same-origin, session and writes gates for selection requests', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const input = selection(old), count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  for (const [headers, status] of [
    [{ cookie: '' }, 401], [{ Origin: 'https://example.invalid' }, 403], [{ 'X-Campus-Session': 'other-session' }, 409],
  ] as [Record<string, string>, number][]) expect((await call('revise', input, headers)).status).toBe(status);
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'false');
  expectFailure(await call('revise', input), 403, 'ASSISTANT_WRITE_UNAVAILABLE');
  expect(signedCards()).toHaveLength(count);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  expect(fixture.writes).toHaveLength(0);
});
