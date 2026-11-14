// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildPlanRevisionQuestion } from '@/features/nuni/assistant/planRevision';
import { handleV2 } from './handler';
import { createAdapter } from './adapter';
import * as actions from './actions';
import { fixtureAdapter, FIXTURE_NOW, FIXTURE_SECRET } from './fixtures';
import { sealCookie, SESSION_COOKIE, sessionContext } from '../server';
import { V2Error, type Binding, type Card, type EventArgs, type ModelInput, type ModelResult, type Obj } from './contracts';

// Only identity/storage adapters and the provider are fixed fixtures. The real
// runner, createTools, conflict checks, signing, handler and confirmation execute.
const providerCall = vi.hoisted(() => vi.fn());
vi.mock('./adapter', () => ({ createAdapter: vi.fn() }));
vi.mock('./groq', async importOriginal => ({
  ...await importOriginal<typeof import('./groq')>(),
  createProviderModel: () => (input: ModelInput) => providerCall(input),
}));

const first: EventArgs = {
  title: '保留的英文閱讀', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00',
};
const second: EventArgs = {
  title: '可調整的程式練習', date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00',
};
const session = { sessionHandle: 'ps_' + 'r'.repeat(43), expiresAt: FIXTURE_NOW + 3600000 };
let serial = 0;
let now: number;
let binding: Binding;
let fixture: ReturnType<typeof fixtureAdapter>;
let internallySigned: Card[];
let observedInputs: Pick<ModelInput, 'messages' | 'tools'>[];

function request(action: string, body: object, signal?: AbortSignal) {
  return new NextRequest('http://localhost:3000/api/nuni/assistant/' + action, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    headers: {
      cookie: `${SESSION_COOKIE}=${sealCookie(SESSION_COOKIE, session)}`,
      'X-Campus-Session': sessionContext(session), Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
const rawCard = (card: Card) => ({ token: card.token, args: card.args });
function originalCards(events: EventArgs[]): Card[] {
  const sequence = actions.beginProposal(binding, now);
  const cards: Card[] = [];
  for (const event of events) cards.push(actions.signCard(binding, 'propose_personal_event', event,
    fixture.snapshot().revision + cards.length, FIXTURE_SECRET, now, sequence, cards.at(-1)));
  return cards;
}
function model(events: Obj[], tool = 'propose_personal_event', rounds = [events], onSecond?: () => never) {
  let calls = 0;
  providerCall.mockImplementation(async (input: ModelInput): Promise<ModelResult> => {
    observedInputs.push(structuredClone({ messages: input.messages, tools: input.tools }));
    calls++;
    if (calls === 2 && onSecond) onSecond();
    return { message: calls <= rounds.length ? { role: 'assistant', content: '', tool_calls: rounds[calls - 1].map((event, index) => ({
      id: 'fixture-proposal-' + calls + '-' + index, type: 'function',
      function: { name: tool, arguments: JSON.stringify(event) },
    })) } : { role: 'assistant', content: '固定模型：候選已整理，尚未寫入。' },
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
  });
}
async function preview(events: Obj[], options: { original?: EventArgs[]; indices?: number[]; instruction?: string; revision?: boolean; tool?: string; rounds?: Obj[][]; providerFault?: 'unauthorized' | 'abort' } = {}) {
  const original = options.original ?? [first, second], indices = options.indices ?? [0];
  const old = originalCards(original);
  internallySigned = [];
  const controller = new AbortController();
  model(events, options.tool, options.rounds, options.providerFault ? () => {
    if (options.providerFault === 'abort') controller.abort();
    throw new V2Error(401, 'SESSION_EXPIRED');
  } : undefined);
  const question = options.revision === false ? '請提供個人事件預覽' : buildPlanRevisionQuestion({
    question: '固定 fixture 原提議', reply: { answer: '固定 fixture 原提議', steps: [], cards: old },
  }, options.instruction ?? '調整第二項的開始與結束時間，保留已選項目。', indices);
  const response = await handleV2(request('ask', {
    schoolId: binding.schoolId, conversationId: binding.conversationId,
    question, history: [], consent: true, routeToken: actions.issueRoute(binding, FIXTURE_SECRET),
    ...(options.revision === false ? {} : { planProtection: { originalEvents: original, protectedIndices: indices } }),
  }, controller.signal), 'ask');
  return { response, body: await response.json(), old, signed: [...internallySigned], aborted: controller.signal.aborted };
}
function advertisedTools(): string[] {
  const input = observedInputs[0];
  return (input?.tools ?? []).map(raw => (raw as { function: { name: string } }).function.name);
}
function modelObserved(code: string) {
  return observedInputs.some(input => input.messages.some(message => message.content?.includes(code)));
}
async function assertRetired(cards: Card[]) {
  const outcomes: string[] = [];
  for (const card of cards) {
    try {
      await actions.confirm(binding, rawCard(card), FIXTURE_SECRET, now, fixture.adapter, true);
      outcomes.push('UNEXPECTED_CONFIRM_SUCCESS');
    } catch (error) {
      outcomes.push(String((error as { code?: string }).code || error));
    }
  }
  expect.soft(outcomes).toEqual(cards.map(() => 'CONFIRMATION_REVOKED'));
  expect(fixture.writes).toHaveLength(0);
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
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External fetch is forbidden in this service fixture'); }));
  providerCall.mockReset();
  observedInputs = [];
  fixture = fixtureAdapter();
  binding = { account: 'revision-runner-account-' + serial, session: sessionContext(session),
    conversationId: 'revision-runner-conversation-' + serial, schoolId: 'fixture-school' };
  vi.mocked(createAdapter).mockReturnValue({ adapter: fixture.adapter,
    principal: async () => ({ platformAccountId: binding.account, isPlatformOperator: false }), apiCalls: () => 0 });
  internallySigned = [];
  const sign = actions.signCard;
  vi.spyOn(actions, 'signCard').mockImplementation((...args: Parameters<typeof actions.signCard>) => {
    const card = sign(...args); // Observe only; never replace or edit a real signed card.
    internallySigned.push(card);
    return card;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('rejects a real revision whose moved event overlaps its protected event and retires every internally signed token', async () => {
  const result = await preview([first, { ...second, startTime: '18:30', endTime: '19:30' }]);
  expect.soft(advertisedTools()).toContain('propose_personal_event');
  expect.soft(modelObserved('EVENT_CONFLICT')).toBe(true);
  expect.soft(result.response.status).toBe(422);
  expect.soft(result.body).toMatchObject({ error: 'PLAN_REVISION_TIME_CONFLICT' });
  expect.soft(result.body.cards).toBeUndefined();
  expect.soft(result.signed.map(card => card.args)).toEqual([first]);
  expect(fixture.writes).toHaveLength(0);
  await assertRetired([...result.old, ...result.signed]);
});

it('rejects overlap between two unprotected new events even when the protected event survives intact', async () => {
  const one = { ...second, startTime: '20:00', endTime: '21:00' };
  const two = { ...second, title: '新增筆記整理', startTime: '20:30', endTime: '21:30' };
  const result = await preview([first, one, two]);
  expect.soft(modelObserved('EVENT_CONFLICT')).toBe(true);
  expect.soft(result.response.status).toBe(422);
  expect.soft(result.body).toMatchObject({ error: 'PLAN_REVISION_TIME_CONFLICT' });
  expect.soft(result.body.cards).toBeUndefined();
  expect.soft(result.signed.map(card => card.args)).toEqual([first, one]);
  await assertRetired([...result.old, ...result.signed]);
});

it('treats empty protection indices as revision context and rejects a partially proposed overlapping plan', async () => {
  const result = await preview([first, { ...second, startTime: '18:30', endTime: '19:30' }], { indices: [] });
  expect.soft(modelObserved('EVENT_CONFLICT')).toBe(true);
  expect.soft(result.response.status).toBe(422);
  expect.soft(result.body).toMatchObject({ error: 'PLAN_REVISION_TIME_CONFLICT' });
  expect.soft(result.body.cards).toBeUndefined();
  await assertRetired([...result.old, ...result.signed]);
});

it.each([
  { error: 'INVALID_INPUT', event: { ...second, startTime: '25:00' } },
  { error: 'EVENT_START_PASSED', event: { ...second, startTime: '08:00', endTime: '09:00' } },
])('rejects an $error partial revision instead of releasing its valid protected card', async ({ event, error }) => {
  const result = await preview([first, event]);
  expect.soft(modelObserved(error)).toBe(true);
  expect.soft(result.response.status).toBe(422);
  expect.soft(result.body).toMatchObject({ error: 'PLAN_REVISION_INCOMPLETE' });
  expect.soft(result.body.cards).toBeUndefined();
  await assertRetired([...result.old, ...result.signed]);
});

it('rejects an overlap on the next day of a same-name cross-day protected event', async () => {
  const overnight = { ...first, title: '同名讀書', startTime: '23:00', endDate: '2026-11-05', endTime: '01:00' };
  const later = { ...second, title: '同名讀書', date: '2026-11-05', startTime: '02:00', endTime: '03:00' };
  const result = await preview([overnight, { ...later, startTime: '00:30', endTime: '01:30' }],
    { original: [overnight, later] });
  expect.soft(modelObserved('EVENT_CONFLICT')).toBe(true);
  expect.soft(result.response.status).toBe(422);
  expect.soft(result.body).toMatchObject({ error: 'PLAN_REVISION_TIME_CONFLICT' });
  expect.soft(result.body.cards).toBeUndefined();
  await assertRetired([...result.old, ...result.signed]);
});

it.each(['same-day', 'cross-day'] as const)(
  'accepts adjacent %s intervals and writes only when each fresh card is manually confirmed',
  async scenario => {
    const before = scenario === 'same-day' ? [first, second] : [
      { ...first, title: '保留的跨日英文閱讀', startTime: '23:00', endDate: '2026-11-05', endTime: '01:00' },
      { ...second, title: '次日程式練習', date: '2026-11-05', startTime: '02:00', endTime: '03:00' },
    ];
    const after = scenario === 'same-day' ? [first, { ...second, startTime: '19:00', endTime: '20:00' }] : [
      before[0], { ...before[1], startTime: '01:00', endTime: '02:00' },
    ];
    const result = await preview(after, { original: before });
    expect(result.response.status).toBe(200);
    expect(result.body.cards).toEqual(result.signed);
    expect(result.body.cards.map((card: Card) => card.args)).toEqual(after);
    expect(modelObserved('EVENT_CONFLICT')).toBe(false);
    expect(fixture.writes).toHaveLength(0);
    for (const old of result.old)
      await expect(actions.confirm(binding, rawCard(old), FIXTURE_SECRET, now, fixture.adapter, true))
        .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
    for (const [index, card] of result.signed.entries()) {
      const confirmed = await handleV2(request('confirm', { schoolId: binding.schoolId,
        conversationId: binding.conversationId, ...rawCard(card) }), 'confirm');
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toMatchObject({ status: 'verified', mutationId: card.mutationId,
        record: { ...after[index], id: card.mutationId } });
      expect(fixture.writes).toHaveLength(index + 1);
    }
  },
);

it('keeps ordinary asks without revision context on the existing partial-result policy', async () => {
  const result = await preview([first, { ...second, startTime: '18:30', endTime: '19:30' }], { revision: false });
  expect(result.response.status).toBe(200);
  expect(result.body.cards.map((card: Card) => card.args)).toEqual([first]);
  expect(result.body.steps).toContainEqual(expect.objectContaining({
    name: 'propose_personal_event', status: 'error', summary: 'EVENT_CONFLICT',
  }));
  expect(modelObserved('EVENT_CONFLICT')).toBe(true);
  expect(fixture.writes).toHaveLength(0);
});

it('never releases a preserved prefix from a study-tool revision that cannot complete the requested plan', async () => {
  const a = { ...first, title: '寫作業：樹與圖作業' };
  const b = { ...second, title: '寫作業：程式練習', startTime: '19:00', endTime: '20:00' };
  const result = await preview([
    { date: a.date, taskIds: ['task-urgent'], from: '18:00', to: '19:00', minMinutes: 60 },
    { date: a.date, taskIds: ['task-next'], from: '18:00', to: '19:00', minMinutes: 60 },
  ], { original: [a, b], tool: 'propose_study_plan', instruction: '第二筆改到18:00至19:00，第一筆保留原樣。' });
  // The recorded baseline advertised this tool and hit real EVENT_CONFLICT
  // after signing A. Explicit revision mode rejects this automatic task planner.
  expect.soft(advertisedTools()).not.toContain('propose_study_plan');
  expect.soft(modelObserved('UNKNOWN_TOOL')).toBe(true);
  expect.soft(result.response.status).toBe(422);
  expect.soft(result.body).toMatchObject({ error: 'PLAN_REVISION_INCOMPLETE' });
  expect.soft(result.body.cards).toBeUndefined();
  expect(fixture.writes).toHaveLength(0);
  await assertRetired([...result.old, ...result.signed]);
});

it('retains proposal tools for a second model round instead of stopping after the first protected card', async () => {
  const next = { ...second, startTime: '19:00', endTime: '20:00' };
  const result = await preview([first, next], { rounds: [[first], [next]] });
  expect(result.response.status).toBe(200);
  expect(result.body.cards.map((card: Card) => card.args)).toEqual([first, next]);
  expect(providerCall).toHaveBeenCalledTimes(3);
  const secondInput = observedInputs[1];
  expect((secondInput.tools as { function: { name: string } }[]).map(tool => tool.function.name))
    .toContain('propose_personal_event');
  expect(fixture.writes).toHaveLength(0);
});

it.each(['寫給家人的信', 'A1 讀書會／公車300研究'])('preserves raw cross-day fields and title %s across model rounds while only the second event moves to tomorrow', async title => {
  const overnight = { ...first, title, startTime: '23:00', endDate: '2026-11-05', endTime: '01:00' };
  const moved = { ...second, date: '2026-11-05' };
  expect(actions.eventInterval(overnight)).toEqual([
    Date.parse('2026-11-04T15:00:00Z'), Date.parse('2026-11-04T17:00:00Z'),
  ]);
  const result = await preview([overnight, moved], {
    original: [overnight, second], instruction: '只把第二項移到明晚20:00至21:00，第一項保持原樣。',
    rounds: [[overnight], [moved]],
  });
  expect(result.response.status).toBe(200);
  expect(result.body.cards.map((card: Card) => card.args)).toEqual([overnight, moved]);
  expect(result.body.cards[0].args.title).toBe(title);
  expect(result.body.answer).toContain('確認前不會寫入');
  expect(result.body.cards[0].args).toMatchObject({ date: '2026-11-04', endDate: '2026-11-05' });
  expect(fixture.writes).toHaveLength(0);
});

it('carries unchanged same-name events at distinct times while a differently named event changes', async () => {
  const a = { ...first, title: '同名讀書' }, b = { ...second, title: '同名讀書' };
  const c = { ...second, title: '整理筆記', startTime: '21:00', endTime: '22:00' };
  const moved = { ...c, startTime: '22:00', endTime: '23:00' };
  const result = await preview([a, b, moved], {
    original: [a, b, c], instruction: '前兩項保持原樣，只把第三項移到22:00至23:00。',
  });
  expect(result.response.status).toBe(200);
  expect(result.body.cards.map((card: Card) => card.args)).toEqual([a, b, moved]);
  expect(fixture.writes).toHaveLength(0);
});

it('rejects an empty unprotected revision without falling back to unrelated assignments', async () => {
  const result = await preview([], { indices: [], rounds: [] });
  expect(result.response.status).toBe(422);
  expect(result.body).toMatchObject({ error: 'PLAN_REVISION_INCOMPLETE' });
  expect(result.body.cards).toBeUndefined();
  expect(result.signed).toEqual([]);
  await assertRetired(result.old);
});

it('does not let a successful revision bypass expiry or revive its superseded source tokens', async () => {
  const result = await preview([first, { ...second, startTime: '19:00', endTime: '20:00' }]);
  expect(result.response.status).toBe(200);
  expect(result.signed).toHaveLength(2);
  now += 300000;
  for (const card of result.signed) {
    const response = await handleV2(request('confirm', {
      schoolId: binding.schoolId, conversationId: binding.conversationId, ...rawCard(card),
    }), 'confirm');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'CONFIRMATION_INVALID' });
  }
  await assertRetired(result.old);
});

it.each(['unauthorized', 'abort'] as const)('retires internal cards after a second-round provider %s failure without permitting a write', async providerFault => {
  const result = await preview([first], { providerFault });
  expect(providerCall).toHaveBeenCalledTimes(2);
  expect(result.signed.map(card => card.args)).toEqual([first]);
  expect(result.aborted).toBe(providerFault === 'abort');
  // Real runner currently turns these post-evidence failures into stopReason;
  // this exercises the atomic incomplete-result guard, not a mocked run throw.
  expect(result.response.status).toBe(422);
  expect(result.body).toMatchObject({ error: 'PLAN_REVISION_INCOMPLETE' });
  expect(result.body.cards).toBeUndefined();
  expect(fixture.writes).toHaveLength(0);
  await assertRetired([...result.old, ...result.signed]);
});
