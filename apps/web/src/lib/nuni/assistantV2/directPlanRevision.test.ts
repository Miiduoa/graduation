// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleV2 } from './handler';
import { createAdapter } from './adapter';
import * as actions from './actions';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { V2Error, type Adapter, type Card, type EventArgs, type ModelInput, type ModelResult } from './contracts';

// Provider, identity and persistence are fixed fixtures. The real handler,
// runner, tools, signing and execution checks run without remote requests.
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
const session = { sessionHandle: 'ps_' + 'd'.repeat(43), expiresAt: FIXTURE_NOW + 7200000 };
const schoolId = 'fixture-school';
let serial = 0, now: number, account: string, conversationId: string, routeToken: string;
let fixture: ReturnType<typeof fixtureAdapter>;
let signedCards: () => Card[];

function request(action: string, body: object, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST',
    ...(signal ? { signal } : {}),
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
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function initialPlan(events: EventArgs[] = [first, second], mixed = false): Promise<Card[]> {
  const bootstrap = await call('ask', { question: '請新增讀書與休息日的行程預覽', history: [], consent: true });
  expect(bootstrap.status).toBe(200);
  expect(bootstrap.body.bootstrap).toBe(true);
  expect(providerCall).not.toHaveBeenCalled();
  conversationId = bootstrap.body.conversationId;
  routeToken = bootstrap.body.routeToken;
  let round = 0;
  providerCall.mockImplementation(async (): Promise<ModelResult> => ({
    message: ++round === 1 ? {
      role: 'assistant', content: '', tool_calls: [
        ...events.map((event, index) => ({
          id: 'fixture-event-' + index, type: 'function' as const,
          function: { name: 'propose_personal_event', arguments: JSON.stringify(event) },
        })),
        ...(mixed ? [{ id: 'fixture-page', type: 'function' as const,
          function: { name: 'propose_open_page', arguments: JSON.stringify({ page: 'calendar' }) } }] : []),
      ],
    } : { role: 'assistant', content: '固定 fixture：請核對原提議，確認前不會寫入。' },
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }));
  const response = await call('ask', {
    question: '請新增讀書與休息日的行程預覽', history: [], consent: true, routeToken,
  });
  expect(response.status).toBe(200);
  const cards = response.body.cards as Card[];
  expect(cards).toEqual(signedCards());
  expect(cards.filter(card => card.tool === 'propose_personal_event').map(card => card.args)).toEqual(events);
  expect(fixture.writes).toHaveLength(0);
  return cards;
}
async function cancelAll(cards: Card[]) {
  for (const card of cards) {
    const response = await call('cancel', raw(card));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject(card.tool === 'propose_personal_event'
      ? { status: 'revoked', mutationId: card.mutationId } : { revoked: true });
  }
}
function revision(cards: Card[], index = 1, change: Partial<{
  date: string; endDate: string; startTime: string; endTime: string;
}> = {}) {
  return { routeToken, originalCards: cards.map(raw), change: {
    mutationId: cards[index].mutationId, date: '2026-11-04', startTime: '19:00', endTime: '20:00', ...change,
  } };
}
const expectFailure = (response: { status: number; body: Record<string, unknown> }, status: number, error: string) => {
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({ error });
  expect(response.body).not.toHaveProperty('cards');
};
async function expectRetired(cards: Card[]) {
  for (const card of cards)
    expectFailure(await call('confirm', raw(card)), 409, 'CONFIRMATION_REVOKED');
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
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch forbidden in direct revision fixture'); }));
  providerCall.mockReset();
  fixture = fixtureAdapter();
  account = 'direct-revision-account-' + serial;
  conversationId = 'bootstrap-hint-' + serial;
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

it('directly changes the selected same-name event across midnight while preserving order and other raw fields until individual confirmation', async () => {
  const old = await initialPlan([first, second, holiday]), before = fixture.snapshot();
  await cancelAll(old);
  const modelCalls = providerCall.mock.calls.length;
  const write = vi.spyOn(fixture.adapter, 'write');
  const input = revision(old, 1, { startTime: '23:00', endDate: '2026-11-05', endTime: '01:00' });
  const result = await call('revise', input);
  expect(result.status).toBe(200);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  const next = result.body.cards as Card[];
  const after = [first, { ...second, startTime: '23:00', endDate: '2026-11-05', endTime: '01:00' }, holiday];
  expect(next.map(card => card.args)).toEqual(after);
  expect(next).toEqual(signedCards().slice(old.length));
  expect(next.every(card => !old.some(previous => previous.token === card.token || previous.mutationId === card.mutationId))).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(fixture.snapshot()).toEqual(before);
  await expectRetired(old);
  expectFailure(await call('confirm', raw(next[1])), 409, 'PERSONAL_IMPORT_REVISION_CONFLICT');
  for (const [index, card] of next.entries()) {
    const confirmed = await call('confirm', raw(card));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'verified', mutationId: card.mutationId,
      record: { ...after[index], id: card.mutationId } });
    expect(write).toHaveBeenCalledTimes(index + 1);
    expect(fixture.writes).toHaveLength(index + 1);
  }
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('keeps the complete revoked source reusable after a conflict, then rejects replay after one successful replacement', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const modelCalls = providerCall.mock.calls.length, signedBefore = signedCards().length;
  const write = vi.spyOn(fixture.adapter, 'write');
  expectFailure(await call('revise', revision(old, 1, { startTime: '18:30', endTime: '19:30' })), 409, 'EVENT_CONFLICT');
  expectFailure(await call('revise', revision(old, 1, { startTime: '08:00', endTime: '09:00' })), 409, 'EVENT_START_PASSED');
  expect(signedCards()).toHaveLength(signedBefore);
  expect(write).not.toHaveBeenCalled();
  for (const card of old) {
    const check = await call('reconcile', raw(card));
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ status: 'revoked', mutationId: card.mutationId });
  }
  now += 61000; // Preserve the real account rate limit while exercising a later retry.
  const input = revision(old);
  const result = await call('revise', input);
  expect(result.status).toBe(200);
  expect((result.body.cards as Card[]).map(card => card.args)).toEqual([
    first, { ...second, startTime: '19:00', endTime: '20:00' },
  ]);
  expect(signedCards()).toHaveLength(signedBefore + 2);
  expectFailure(await call('revise', input), 409, 'CONFIRMATION_REVOKED');
  expect(signedCards()).toHaveLength(signedBefore + 2);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  expect(write).not.toHaveBeenCalled();
});

it.each(['missing-tail', 'reordered', 'duplicate', 'mixed'] as const)('rejects the %s source manifest instead of silently revising a subset', async scenario => {
  const old = await initialPlan([first, second], scenario === 'mixed');
  await cancelAll(old);
  const modelCalls = providerCall.mock.calls.length, count = signedCards().length;
  const input = revision(old);
  if (scenario === 'missing-tail') input.originalCards.pop();
  if (scenario === 'reordered') input.originalCards.reverse();
  if (scenario === 'duplicate') input.originalCards[1] = input.originalCards[0];
  expectFailure(await call('revise', input), 422, 'INVALID_PLAN_REVISION');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it.each(['token', 'arguments'] as const)('rejects tampered original %s without signing replacements', async target => {
  const old = await initialPlan();
  await cancelAll(old);
  const input = revision(old), count = signedCards().length;
  if (target === 'token') input.originalCards[0].token += 'x';
  else input.originalCards[0].args = { ...input.originalCards[0].args, title: '未經同意改名' };
  const result = await call('revise', input);
  expect(result.status).toBe(409);
  expect(String(result.body.error)).toMatch(/^CONFIRMATION_/);
  expect(result.body).not.toHaveProperty('cards');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
});

it('requires all original cards to be revoked before any replacement is signed', async () => {
  const old = await initialPlan(), count = signedCards().length;
  expectFailure(await call('revise', revision(old)), 409, 'PLAN_REVISION_UNRESOLVED');
  expect((await call('cancel', raw(old[0]))).status).toBe(200);
  expectFailure(await call('revise', revision(old)), 409, 'PLAN_REVISION_UNRESOLVED');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
});

it('rejects unknown writes, and still refuses a previously dispatched source after its late result is reconciled', async () => {
  const old = await initialPlan(), originalWrite = fixture.adapter.write;
  let pending: Parameters<Adapter['write']>[0] | undefined;
  const write = vi.spyOn(fixture.adapter, 'write').mockImplementation(async input => {
    pending = structuredClone(input);
    throw new Error('Fixture response lost before commit');
  });
  const confirmed = await call('confirm', raw(old[0]));
  expect(confirmed.status).toBe(503);
  expect(write).toHaveBeenCalledTimes(1);
  expectFailure(await call('cancel', raw(old[0])), 503, 'EXECUTION_UNKNOWN');
  expect((await call('cancel', raw(old[1]))).status).toBe(200);
  const count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  expectFailure(await call('revise', revision(old)), 503, 'EXECUTION_UNKNOWN');
  expect(pending).toBeDefined();
  await originalWrite(pending!);
  const recovered = await call('reconcile', raw(old[0]));
  expect(recovered.status).toBe(200);
  expect(recovered.body).toMatchObject({ status: 'verified', mutationId: old[0].mutationId });
  expectFailure(await call('revise', revision(old)), 409, 'PLAN_REVISION_UNRESOLVED');
  expect(write).toHaveBeenCalledTimes(1);
  expect(fixture.writes).toHaveLength(1);
  expect(signedCards()).toHaveLength(count);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it.each(['unchanged', 'all-day-target'] as const)('rejects an %s edit without replacing source authority', async scenario => {
  const old = await initialPlan([first, second, holiday]);
  await cancelAll(old);
  const count = signedCards().length;
  const input = scenario === 'unchanged'
    ? revision(old, 1, { startTime: '20:00', endTime: '21:00' })
    : revision(old, 2);
  expectFailure(await call('revise', input), 422,
    scenario === 'unchanged' ? 'PLAN_REVISION_UNCHANGED' : 'INVALID_PLAN_REVISION');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  expect((await call('reconcile', raw(old[0]))).body).toMatchObject({ status: 'revoked' });
});

it('rejects another account, school, conversation or expired source without creating cards', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const owner = account, input = revision(old), count = signedCards().length;
  const modelCalls = providerCall.mock.calls.length, read = vi.spyOn(fixture.adapter, 'ledger');
  for (const scope of ['account', 'school', 'conversation'] as const) {
    if (scope === 'account') account = 'another-account';
    const extra = scope === 'school' ? { schoolId: 'another-school' }
      : scope === 'conversation' ? { conversationId: 'another-conversation' } : {};
    const rejected = await call('revise', { ...input, ...extra });
    expect(rejected.status).toBe(409);
    expect(rejected.body).not.toHaveProperty('cards');
    account = owner;
  }
  expect(read).not.toHaveBeenCalled();
  now += 300000;
  const expired = await call('revise', input);
  expect(expired.status).toBe(409);
  expect(String(expired.body.error)).toMatch(/^CONFIRMATION_/);
  expect(signedCards()).toHaveLength(count);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  expect(fixture.writes).toHaveLength(0);
});

it('preserves authentication, same-origin, session and writes gates without a provider call', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const input = revision(old), modelCalls = providerCall.mock.calls.length, count = signedCards().length;
  for (const [headers, status] of [
    [{ cookie: '' }, 401], [{ Origin: 'https://example.invalid' }, 403], [{ 'X-Campus-Session': 'other-session' }, 409],
  ] as [Record<string, string>, number][]) {
    expect((await call('revise', input, headers)).status).toBe(status);
  }
  vi.stubEnv('CAMPUS_ASSISTANT_V2_WRITES_ENABLED', 'false');
  expectFailure(await call('revise', input), 403, 'ASSISTANT_WRITE_UNAVAILABLE');
  expect(signedCards()).toHaveLength(count);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  expect(fixture.writes).toHaveLength(0);
});

it('allows only one concurrent replacement of the same complete source proposal', async () => {
  const old = await initialPlan();
  await cancelAll(old);
  const input = revision(old), count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  const entered = deferred(), release = deferred();
  const read = fixture.adapter.ledger;
  vi.spyOn(fixture.adapter, 'ledger').mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return read();
  });
  const firstRequest = call('revise', input);
  await entered.promise;
  const secondRequest = call('revise', input);
  release.resolve();
  const results = await Promise.all([firstRequest, secondRequest]);
  expect(results.map(result => result.status).sort()).toEqual([200, 429]);
  expect(results.find(result => result.status === 429)!.body).toMatchObject({ error: 'ASSISTANT_BUSY' });
  expect(results.find(result => result.status === 429)!.body).not.toHaveProperty('cards');
  expect(signedCards()).toHaveLength(count + old.length);
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it('checks a complete multi-item source with one ledger read within the unchanged twelve-call budget', async () => {
  const events = Array.from({ length: 8 }, (_, index) => ({
    ...first, title: '讀書 ' + (index + 1), date: '2026-11-' + String(index + 10),
  }));
  const old = await initialPlan(events);
  await cancelAll(old);
  const read = fixture.adapter.ledger;
  let apiCalls = 0;
  const consume = () => { if (++apiCalls > 12) throw new V2Error(429, 'API_BUDGET_EXCEEDED'); };
  const ledger = vi.spyOn(fixture.adapter, 'ledger').mockImplementation(async () => { consume(); return read(); });
  vi.mocked(createAdapter).mockReturnValue({
    adapter: fixture.adapter, apiCalls: () => apiCalls,
    principal: async () => { consume(); return { platformAccountId: account, isPlatformOperator: false }; },
  });
  const modelCalls = providerCall.mock.calls.length;
  const response = await call('revise', revision(old, 7, {
    date: events[7].date, startTime: '19:00', endTime: '20:00',
  }));
  expect(response.status).toBe(200);
  expect(response.body.cards).toHaveLength(8);
  expect(ledger).toHaveBeenCalledTimes(1);
  expect(apiCalls).toBe(2); // One principal check and one authoritative batch read.
  expect(fixture.writes).toHaveLength(0);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it.each(['expired', 'aborted'] as const)('does not rotate or sign if the source becomes %s during the ledger read', async scenario => {
  const old = await initialPlan();
  await cancelAll(old);
  const count = signedCards().length, modelCalls = providerCall.mock.calls.length;
  const controller = new AbortController(), read = fixture.adapter.ledger;
  vi.spyOn(fixture.adapter, 'ledger').mockImplementationOnce(async () => {
    if (scenario === 'expired') now += 300000;
    else controller.abort();
    return read();
  });
  const response = await handleV2(request('revise', {
    schoolId, conversationId, ...revision(old),
  }, {}, controller.signal), 'revise');
  const result = { status: response.status, body: await response.json() };
  expectFailure(result, scenario === 'expired' ? 409 : 499,
    scenario === 'expired' ? 'CONFIRMATION_INVALID' : 'ABORTED');
  expect(signedCards()).toHaveLength(count);
  expect(fixture.writes).toHaveLength(0);
  if (scenario === 'aborted') {
    for (const card of old)
      expect((await call('reconcile', raw(card))).body).toMatchObject({ status: 'revoked' });
    expect((await call('revise', revision(old))).status).toBe(200);
    expect(signedCards()).toHaveLength(count + old.length);
  }
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});
