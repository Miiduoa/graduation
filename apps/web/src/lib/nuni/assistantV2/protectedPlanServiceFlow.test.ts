// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildPlanRevisionQuestion } from '@/features/nuni/assistant/planRevision';
import { handleV2 } from './handler';
import { createAdapter } from './adapter';
import * as actions from './actions';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import type { Adapter, Card, EventArgs, ModelInput, ModelResult } from './contracts';

// In-process service integration: only the provider, account and database are
// fixtures. Bootstrap, runner, tools, signing and execution checks are real;
// persistence and its CAS/idempotency behavior use the fixture database.
const providerCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', () => ({ createAdapter: vi.fn() }));
vi.mock('./groq', async importOriginal => ({
  ...await importOriginal<typeof import('./groq')>(),
  createProviderModel: () => (input: ModelInput) => providerCall(input),
}));

const first: EventArgs = {
  title: '英文閱讀', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00',
};
const second: EventArgs = {
  title: '程式練習', date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00',
};
const originalQuestion = '請新增英文閱讀與程式練習的行程預覽';
const session = { sessionHandle: 'ps_' + 's'.repeat(43), expiresAt: FIXTURE_NOW + 7200000 };
const schoolId = 'fixture-school';
let serial = 0;
let now: number;
let account: string;
let conversationId: string;
let routeToken: string;
let fixture: ReturnType<typeof fixtureAdapter>;
let signedCards: () => Card[];
let observedInputs: Pick<ModelInput, 'messages' | 'tools'>[];

function request(action: string, body: object) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
async function call(action: string, input: object) {
  const response = await handleV2(request(action, { schoolId, conversationId, ...input }), action);
  return { status: response.status, body: await response.json() };
}
const cardInput = (card: Card) => ({ token: card.token, args: card.args });

async function bootstrap() {
  const response = await call('ask', { question: originalQuestion, history: [], consent: true });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ bootstrap: true });
  expect(providerCall).not.toHaveBeenCalled();
  expect(signedCards()).toEqual([]);
  expect(fixture.writes).toEqual([]);
  conversationId = response.body.conversationId;
  routeToken = response.body.routeToken;
}
async function askEvents(events: EventArgs[], original?: Card[], instruction = '第一項保留原樣，修改第二項的時段。') {
  const signedBefore = signedCards().length;
  let round = 0;
  providerCall.mockImplementation(async (input: ModelInput): Promise<ModelResult> => {
    observedInputs.push(structuredClone({ messages: input.messages, tools: input.tools }));
    return {
      message: ++round === 1 ? {
        role: 'assistant', content: '', tool_calls: events.map((event, index) => ({
          id: 'fixed-event-' + index, type: 'function',
          function: { name: 'propose_personal_event', arguments: JSON.stringify(event) },
        })),
      } : { role: 'assistant', content: '固定 fixture：請核對預覽，確認前不會寫入。' },
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
  });
  const response = await call('ask', {
    question: original ? buildPlanRevisionQuestion({
      question: originalQuestion, reply: { answer: '固定原提議', cards: original, steps: [] },
    }, instruction, [0]) : originalQuestion,
    history: [], consent: true, routeToken,
    ...(original ? { planProtection: { originalEvents: original.map(card => card.args), protectedIndices: [0] } } : {}),
  });
  return { ...response, signed: signedCards().slice(signedBefore) };
}
async function initialPlan() {
  await bootstrap();
  const result = await askEvents([first, second]);
  expect(result.status).toBe(200);
  expect(result.body.cards).toEqual(result.signed);
  expect(result.signed.map(card => card.args)).toEqual([first, second]);
  expect(fixture.writes).toHaveLength(0);
  return result.signed;
}
async function cancelOriginal(original: Card[]) {
  for (const card of original) {
    const response = await call('cancel', cardInput(card));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'revoked', mutationId: card.mutationId, retryable: false });
  }
  expect(fixture.writes).toHaveLength(0);
}
async function expectRetired(cards: Card[]) {
  for (const card of cards) {
    const response = await call('confirm', cardInput(card));
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: 'CONFIRMATION_REVOKED' });
  }
}
async function revisedPlan() {
  const old = await initialPlan();
  await cancelOriginal(old);
  const after = [first, { ...second, startTime: '19:00', endTime: '20:00' }];
  const result = await askEvents(after, old);
  expect(result.status).toBe(200);
  expect(result.body.cards).toEqual(result.signed);
  expect(result.signed.map(card => card.args)).toEqual(after);
  expect(fixture.writes).toHaveLength(0);
  return { old, cards: result.signed };
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
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch is forbidden in this fixture'); }));
  providerCall.mockReset();
  observedInputs = [];
  fixture = fixtureAdapter();
  account = 'service-flow-account-' + serial;
  conversationId = 'bootstrap-hint-' + serial;
  routeToken = '';
  vi.mocked(createAdapter).mockReturnValue({
    adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: account, isPlatformOperator: false }),
    apiCalls: () => 0,
  });
  // Observe real return values only: never replace signCard or its behavior.
  const signing = vi.spyOn(actions, 'signCard');
  signedCards = () => signing.mock.results.filter(result => result.type === 'return').map(result => result.value as Card);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('retires every failed candidate across identical and changed revision retries, then confirms and reconciles each fresh card exactly once', async () => {
  const before = fixture.snapshot();
  const write = vi.spyOn(fixture.adapter, 'write');
  const old = await initialPlan();
  await cancelOriginal(old);
  const rejected: Card[] = [];
  const overlap = [first, { ...second, startTime: '18:30', endTime: '19:30' }];
  const instruction = '第一項保留原樣，第二項改到18:30至19:30。';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await askEvents(overlap, old, instruction);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: 'PLAN_REVISION_TIME_CONFLICT' });
    expect(result.body).not.toHaveProperty('cards');
    expect(result.signed.map(card => card.args)).toEqual([first]);
    rejected.push(...result.signed);
    await expectRetired([...old, ...rejected]);
    expect(write).not.toHaveBeenCalled();
    expect(fixture.snapshot()).toEqual(before);
    // Keep the same account/conversation and respect the actual per-minute quota.
    now += 61000;
  }
  expect(observedInputs.some(input => input.messages.some(message => message.content?.includes('EVENT_CONFLICT')))).toBe(true);
  const changed = [first, { ...second, startTime: '19:00', endTime: '20:00' }];
  const result = await askEvents(changed, old, '第一項保留原樣，第二項改到19:00至20:00。');
  expect(result.status).toBe(200);
  expect(result.body.cards).toEqual(result.signed);
  expect(result.signed.map(card => card.args)).toEqual(changed);
  const everyCard = [...old, ...rejected, ...result.signed];
  expect(new Set(everyCard.map(card => card.mutationId)).size).toBe(everyCard.length);
  expect(new Set(everyCard.map(card => card.token)).size).toBe(everyCard.length);
  await expectRetired([...old, ...rejected]);
  expect(write).not.toHaveBeenCalled();

  // Even a valid second card cannot bypass its signed predecessor/CAS.
  const outOfOrder = await call('confirm', cardInput(result.signed[1]));
  expect(outOfOrder.status).toBe(409);
  expect(outOfOrder.body).toMatchObject({ error: 'PERSONAL_IMPORT_REVISION_CONFLICT' });
  expect(write).not.toHaveBeenCalled();
  for (const [index, card] of result.signed.entries()) {
    const confirmed = await call('confirm', cardInput(card));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'verified', replay: false, mutationId: card.mutationId,
      record: { ...changed[index], id: card.mutationId } });
    for (const action of ['confirm', 'reconcile', 'reconcile']) {
      const repeated = await call(action, cardInput(card));
      expect(repeated.status).toBe(200);
      expect(repeated.body).toMatchObject({ status: 'verified', replay: true, mutationId: card.mutationId });
    }
    expect(write).toHaveBeenCalledTimes(index + 1);
    expect(fixture.writes).toHaveLength(index + 1);
  }
  await expectRetired([...old, ...rejected]);
  expect(fixture.snapshot().records).toEqual([...before.records,
    ...result.signed.map(card => actions.eventRecord(card.args as EventArgs, schoolId, card.mutationId, now))]);
});

it('rejects a nonconflicting model change to a protected event and retires every signed replacement', async () => {
  const before = fixture.snapshot();
  const write = vi.spyOn(fixture.adapter, 'write');
  const old = await initialPlan();
  await cancelOriginal(old);
  const candidate = [
    { ...first, startTime: '18:30', endTime: '19:30' },
    { ...second, startTime: '21:00', endTime: '22:00' },
  ];
  const result = await askEvents(candidate, old, '第一項保留原樣，只把第二項改到21:00至22:00。');
  expect(result.status).toBe(422);
  expect(result.body).toMatchObject({ error: 'PLAN_PROTECTION_MISMATCH' });
  expect(result.body).not.toHaveProperty('cards');
  expect(result.body).not.toHaveProperty('answer');
  // Both events pass the real tool's interval checks and are actually signed;
  // the independent preservation validator must reject the complete candidate.
  expect(result.signed.map(card => card.args)).toEqual(candidate);
  expect(observedInputs.some(input => input.messages.some(message => message.content?.includes('EVENT_CONFLICT')))).toBe(false);
  await expectRetired([...old, ...result.signed]);
  expect(write).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.snapshot()).toEqual(before);
});

it('does not redispatch a revised event while its first write outcome is unknown, and only reconciles its eventual commit', async () => {
  const { old, cards } = await revisedPlan();
  const card = cards[0];
  const originalWrite = fixture.adapter.write;
  let dispatched: Parameters<Adapter['write']>[0] | undefined;
  const write = vi.spyOn(fixture.adapter, 'write').mockImplementation(async input => {
    dispatched ??= structuredClone(input);
    throw new Error('Fixture connection lost before the commit becomes visible');
  });
  const modelCalls = providerCall.mock.calls.length;
  const firstAttempt = await call('confirm', cardInput(card));
  expect(firstAttempt.status).toBe(503);
  expect(write).toHaveBeenCalledTimes(1);
  const absent = await call('reconcile', cardInput(card));
  expect(absent.status).toBe(200);
  expect(absent.body).toMatchObject({ status: 'absent', mutationId: card.mutationId, retryable: false });

  const repeated = await call('confirm', cardInput(card));
  expect(repeated.status).toBe(503);
  expect(repeated.body).toMatchObject({ error: 'EXECUTION_UNKNOWN' });
  // Count dispatches, not just fixture.writes: the fixture database deduplicates IDs.
  expect.soft(write).toHaveBeenCalledTimes(1);
  expect(fixture.writes).toHaveLength(0);
  for (const action of ['cancel', 'reconcile']) {
    const unknown = await call(action, cardInput(card));
    expect(unknown.status).toBe(503);
    expect(unknown.body).toMatchObject({ error: 'EXECUTION_UNKNOWN' });
  }
  expect(dispatched).toBeDefined();
  await originalWrite(dispatched!); // Fixed database fixture completes the original dispatch.
  for (const action of ['reconcile', 'reconcile']) {
    const recovered = await call(action, cardInput(card));
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ status: 'verified', replay: true, mutationId: card.mutationId });
  }
  await expectRetired([...old, card]);
  expect.soft(write).toHaveBeenCalledTimes(1);
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.snapshot().records.filter(row => row.id === card.mutationId)).toHaveLength(1);
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
});

it.each(['account', 'school'] as const)('rejects revised-card confirmation and read-back under another %s before ledger access', async scope => {
  const { old, cards } = await revisedPlan();
  const card = cards[0], owner = account;
  const read = vi.spyOn(fixture.adapter, 'ledger');
  const write = vi.spyOn(fixture.adapter, 'write');
  const modelCalls = providerCall.mock.calls.length;
  if (scope === 'account') account = 'other-account';
  const extra = scope === 'school' ? { schoolId: 'other-school' } : {};
  for (const action of ['confirm', 'cancel', 'reconcile']) {
    const response = await call(action, { ...cardInput(card), ...extra });
    expect(response.status).toBe(409);
  }
  const otherAsk = await call('ask', { question: originalQuestion, consent: true, history: [], routeToken, ...extra });
  expect(otherAsk.status).toBe(409);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(providerCall).toHaveBeenCalledTimes(modelCalls);
  account = owner;
  await expectRetired(old);
  const originalScope = await call('reconcile', cardInput(card));
  expect(originalScope.status).toBe(200);
  expect(originalScope.body).toMatchObject({ status: 'absent', mutationId: card.mutationId, retryable: true });
  expect(write).not.toHaveBeenCalled();
});
