// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { confirm } from './actions';
import { V2Error } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { prepareFoodPickupRequest } from './foodPickupRequest';
import { run } from './runner';

const question = '把我最近一筆訂單的取餐時間加入行事曆，預留15分鐘';
const binding = { ...fixtureBinding, conversationId: 'pickup-request' };
const signal = () => new AbortController().signal;
function fixture() {
  const f = fixtureAdapter();
  f.adapter.order = vi.fn(async () => ({ id: 'order-a', state: 'preparing',
    locationId: 'dining-a', location: '合成蔬食餐廳', requestedPickupAt: '2026-11-04T12:00:00+08:00' }));
  return f;
}
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

it.each([
  { phrase: question, endTime: '12:15' },
  { phrase: question.replace('15分鐘', '30分鐘'), endTime: '12:30' },
])('completes a source-bound pickup calendar request after confirmation: $phrase', async ({ phrase, endTime }) => {
  const f = fixture(), model = vi.fn().mockRejectedValue(new Error('provider unavailable'));
  const courses = vi.spyOn(f.adapter, 'courses');
  const result = await run({ question: phrase, history: [], binding, adapter: f.adapter, model,
    secret, now, writes: true, signal: signal(), log: () => {} });
  expect(result).toMatchObject({ dataRead: true, modelCalls: 0, stopReason: '' });
  expect(result.cards).toHaveLength(1);
  const card = result.cards[0];
  expect(card).toMatchObject({ sourceBound: 'food-pickup', tool: 'propose_personal_event', args: {
    title: '取餐：合成蔬食餐廳', date: '2026-11-04', startTime: '12:00', endTime, allDay: false,
  } });
  expect(card.token.length).toBeLessThanOrEqual(2048);
  expect(result.answer).toContain(`12:00–${endTime}`);
  expect(result.answer).toContain('目前尚未加入行事曆');
  expect(model).not.toHaveBeenCalled();
  expect(courses).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
  expect(f.orderCalls).toHaveLength(0);
  const raw = { token: card.token, args: card.args };
  expect(await confirm(binding, raw, secret, now, f.adapter, true))
    .toMatchObject({ status: 'verified', replay: false, record: card.args });
  expect(await confirm(binding, raw, secret, now, f.adapter, true))
    .toMatchObject({ status: 'verified', replay: true });
  expect(f.writes).toHaveLength(1);
  expect(f.orderCalls).toHaveLength(0);
});

it('uses the requested duration and records a cross-midnight end date', async () => {
  const f = fixture();
  f.adapter.order = async () => ({ id: 'order-a', state: 'paid', locationId: 'dining-a',
    location: '晚餐店', requestedPickupAt: '2026-11-04T23:50:00+08:00' });
  const result = await prepareFoodPickupRequest({ question: question.replace('15分鐘', '30分鐘'),
    binding, adapter: f.adapter, secret, now, writes: true, signal: signal() });
  expect(result?.cards[0].args).toMatchObject({ date: '2026-11-04', endDate: '2026-11-05',
    startTime: '23:50', endTime: '00:20' });
  expect(result?.answer).toContain('23:50–2026-11-05 00:20');
});

it.each([
  question + '，順便幫我取消訂單',
  '退掉昨天訂單，確認取餐時間是否已加入行事曆',
  '幫我把最近一筆訂單的取餐時間記到行事曆',
])('intercepts unsupported pickup requests before source reads, writes, or model calls: %s', async phrase => {
  const f = fixture(), model = vi.fn();
  const orders = vi.spyOn(f.adapter, 'orders'), ledger = vi.spyOn(f.adapter, 'ledger');
  const result = await run({ question: phrase, history: [], binding,
    adapter: f.adapter, model, secret, now, writes: true, signal: signal(), log: () => {} });
  expect(result).toMatchObject({ dataRead: true, cards: [], stopReason: 'INVALID_FOOD_PICKUP_REQUEST' });
  expect(orders).not.toHaveBeenCalled();
  expect(ledger).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});

it.each(['permission', 'source', 'conflict', 'incomplete', 'write-gate'] as const)(
  'keeps a %s failure as a source-bound result with no guessed substitute', async failure => {
    const f = fixture(), model = vi.fn();
    if (failure === 'permission') f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
    if (failure === 'source') f.adapter.order = async () => { throw new V2Error(503, 'UPSTREAM_UNAVAILABLE'); };
    if (failure === 'conflict') f.adapter.order = async () => ({ id: 'order-a', state: 'ready',
      locationId: 'dining-a', location: '店家', requestedPickupAt: '2026-11-04T13:00:00+08:00' });
    if (failure === 'incomplete') {
      const read = f.adapter.ledger;
      f.adapter.ledger = async () => {
        const data = await read();
        data.records.push({ ...data.records[0], id: 'missing-time', startTime: undefined, endTime: undefined });
        return data;
      };
    }
    const result = await run({ question, history: [], binding, adapter: f.adapter, model,
      secret, now, writes: failure !== 'write-gate', signal: signal(), log: () => {} });
    expect(result).toMatchObject({ dataRead: true, cards: [], modelCalls: 0 });
    expect(result.stopReason).toBe({ permission: 'ASSISTANT_PERMISSION_DENIED', source: 'FOOD_PICKUP_UNAVAILABLE',
      conflict: 'EVENT_CONFLICT', incomplete: 'SCHEDULE_INCOMPLETE', 'write-gate': 'WRITES_DISABLED' }[failure]);
    expect(model).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
    expect(f.orderCalls).toHaveLength(0);
  },
);

it('ends the entire request on a session change instead of returning private partial data', async () => {
  const f = fixture(), model = vi.fn();
  f.adapter.order = async () => { throw new V2Error(409, 'SESSION_CHANGED'); };
  await expect(run({ question, history: [], binding, adapter: f.adapter, model,
    secret, now, writes: true, signal: signal(), log: () => {} }))
    .rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(model).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});

it.each(['整理訂單', '核對訂單取餐時間'])('preserves an explicitly timed ordinary appointment titled %s', async title => {
  const f = fixture(), model = vi.fn(), orders = vi.spyOn(f.adapter, 'orders');
  const result = await run({ question: `幫我新增個人行程明天 19:00 到 20:00 ${title}`,
    history: [], binding, adapter: f.adapter, model, secret, now, writes: true,
    signal: signal(), log: () => {} });
  expect(result.cards[0]).toMatchObject({ tool: 'propose_personal_event', args: { title,
    date: '2026-11-05', startTime: '19:00', endTime: '20:00' } });
  expect(result.cards[0].sourceBound).toBeUndefined();
  expect(orders).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
});
