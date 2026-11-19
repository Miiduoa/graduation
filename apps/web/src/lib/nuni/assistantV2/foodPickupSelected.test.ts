// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAssistantFoodPickupTarget } from '@campus/shared/src/assistantFoodPickupTarget';
import { confirm, verifyCard } from './actions';
import { V2Error } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { prepareSelectedFoodPickupRequest } from './foodPickupRequest';

const target = { tenantId: 'selected-realm', orderId: 'selected-order', durationMinutes: 20 };
const binding = { ...fixtureBinding, conversationId: 'selected-pickup' };
const signal = () => new AbortController().signal;
function fixture() {
  const f = fixtureAdapter();
  f.adapter.realms = vi.fn(async () => [
    { tenantId: 'fixture-realm', schoolId: binding.schoolId },
    { tenantId: target.tenantId, schoolId: binding.schoolId },
    { tenantId: 'unrelated-realm', schoolId: 'other-school' },
  ]);
  f.adapter.orders = vi.fn(async () => { throw new Error('An explicit source must never query latest orders'); });
  const detail = { id: target.orderId, state: 'preparing', locationId: 'dining-b',
    location: '選定餐廳', requestedPickupAt: '2026-11-04T12:00:00+08:00',
    pickupNumber: 'PRIVATE_PICKUP_NUMBER', customerEmail: 'PRIVATE_CUSTOMER', paymentToken: 'PRIVATE_TOKEN' };
  f.adapter.order = vi.fn(async () => ({ ...detail }));
  const prepare = (options: { writes?: boolean; signal?: AbortSignal } = {}) =>
    prepareSelectedFoodPickupRequest({ target, adapter: f.adapter, binding, secret,
      now, writes: options.writes ?? true, signal: options.signal ?? signal() });
  return { ...f, detail, prepare };
}
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());

it('selects the exact order among multiple workspaces and binds a verified, single calendar write to that source', async () => {
  const f = fixture(), reply = await f.prepare();
  expect(reply).toMatchObject({ dataRead: true, stopReason: '', pickupTarget: target });
  expect(reply.cards).toHaveLength(1);
  expect(reply.answer).toContain('選定訂單');
  expect(reply.answer).toContain('12:00–12:20');
  expect(JSON.stringify(reply)).not.toContain('PRIVATE_');
  expect(f.adapter.order).toHaveBeenCalledExactlyOnceWith(target.tenantId, target.orderId);
  expect(f.adapter.orders).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
  const card = reply.cards[0], proof = { token: card.token, args: card.args };
  expect(verifyCard(binding, proof, secret, now).pickupGuard).toMatchObject(target);
  expect(card).toMatchObject({ sourceBound: 'food-pickup', args: { title: '取餐：選定餐廳',
    date: '2026-11-04', startTime: '12:00', endTime: '12:20', allDay: false } });
  expect(await confirm(binding, proof, secret, now, f.adapter, true, () => now))
    .toMatchObject({ status: 'verified', replay: false });
  f.adapter.order = vi.fn(async () => { throw new Error('Order unavailable after verified write'); });
  expect(await confirm(binding, proof, secret, now, f.adapter, true, () => now))
    .toMatchObject({ status: 'verified', replay: true });
  expect(f.adapter.order).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(1);
  expect(f.orderCalls).toHaveLength(0);
});

it.each([
  { realms: [] },
  { realms: [{ tenantId: target.tenantId, schoolId: 'other-school' }] },
  { realms: [{ tenantId: target.tenantId, schoolId: binding.schoolId },
    { tenantId: target.tenantId, schoolId: binding.schoolId }] },
])('rejects unavailable, wrong-school or duplicated realm evidence before reading any order', async ({ realms }) => {
  const f = fixture();
  f.adapter.realms = async () => realms;
  const ledger = vi.spyOn(f.adapter, 'ledger');
  expect(await f.prepare()).toMatchObject({ cards: [], stopReason: 'FOOD_PICKUP_CHANGED' });
  expect(f.adapter.order).not.toHaveBeenCalled();
  expect(ledger).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});

it('does not replace an inaccessible account-scoped order with another order', async () => {
  const f = fixture(), ledger = vi.spyOn(f.adapter, 'ledger');
  f.adapter.order = vi.fn(async () => { throw new V2Error(403, 'FORBIDDEN'); });
  expect(await f.prepare()).toMatchObject({ cards: [], stopReason: 'FOOD_PICKUP_UNAVAILABLE' });
  expect(f.adapter.order).toHaveBeenCalledExactlyOnceWith(target.tenantId, target.orderId);
  expect(f.adapter.orders).not.toHaveBeenCalled();
  expect(ledger).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});

it.each(['id', 'state', 'time', 'realm-revoked', 'permission-revoked', 'conflict', 'write-gate'] as const)(
  'does not issue a confirmation when %s cannot be verified', async failure => {
    const f = fixture();
    if (failure === 'id') f.detail.id = 'different-order';
    if (failure === 'state') f.detail.state = 'canceled';
    if (failure === 'time') f.detail.requestedPickupAt = '2026-11-04T10:00:00+08:00';
    if (failure === 'realm-revoked') f.adapter.order = async () => {
      f.adapter.realms = async () => [];
      return f.detail;
    };
    if (failure === 'permission-revoked') f.adapter.order = async () => {
      f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
      return f.detail;
    };
    if (failure === 'conflict') f.detail.requestedPickupAt = '2026-11-04T13:00:00+08:00';
    const reply = await f.prepare({ writes: failure !== 'write-gate' });
    expect(reply.cards).toHaveLength(0);
    expect(reply.stopReason).toBe({ id: 'FOOD_PICKUP_UNAVAILABLE', state: 'FOOD_PICKUP_CHANGED',
      time: 'FOOD_PICKUP_PASSED', 'realm-revoked': 'FOOD_PICKUP_CHANGED',
      'permission-revoked': 'ASSISTANT_PERMISSION_DENIED', conflict: 'EVENT_CONFLICT',
      'write-gate': 'WRITES_DISABLED' }[failure]);
    expect(f.writes).toHaveLength(0);
    expect(f.orderCalls).toHaveLength(0);
  },
);

it('stops without a card or a calendar read when the source request is cancelled', async () => {
  const f = fixture(), controller = new AbortController(), ledger = vi.spyOn(f.adapter, 'ledger');
  f.adapter.order = async () => {
    controller.abort();
    return f.detail;
  };
  await expect(f.prepare({ signal: controller.signal })).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
  expect(ledger).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});

it('propagates a session change without disclosing a partial source result', async () => {
  const f = fixture();
  f.adapter.order = async () => { throw new V2Error(409, 'SESSION_CHANGED'); };
  await expect(f.prepare()).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(f.writes).toHaveLength(0);
});

it('rechecks the selected original source at confirmation and rejects an edited pickup time', async () => {
  const f = fixture(), reply = await f.prepare(), card = reply.cards[0];
  f.detail.requestedPickupAt = '2026-11-04T12:30:00+08:00';
  await expect(confirm(binding, { token: card.token, args: card.args }, secret, now,
    f.adapter, true, () => now)).rejects.toMatchObject({ code: 'FOOD_PICKUP_CHANGED' });
  expect(f.writes).toHaveLength(0);
  expect(f.adapter.orders).not.toHaveBeenCalled();
});

it.each([
  null, [], {}, { tenantId: target.tenantId }, { ...target, tenantId: '../another' },
  { ...target, orderId: ' order ' }, { ...target, orderId: 'x'.repeat(101) },
  { ...target, schoolId: 'other-school' }, { ...target, title: 'fabricated' },
  { ...target, role: 'operator' }, { ...target, requestedPickupAt: '2026-11-04T12:00:00Z' },
  { ...target, durationMinutes: '15' }, { ...target, durationMinutes: null },
  { ...target, durationMinutes: 4 }, { ...target, durationMinutes: 121 },
  { ...target, durationMinutes: 15.5 }, { ...target, durationMinutes: Infinity },
])('rejects invalid source selections and fabricated order facts: %j', raw => {
  expect(() => parseAssistantFoodPickupTarget(raw)).toThrow('INVALID_FOOD_PICKUP_TARGET');
});

it('normalizes only the duration default and preserves exact scope and order identifiers', () => {
  expect(parseAssistantFoodPickupTarget({ tenantId: 'Realm_1', orderId: 'Order-2' }))
    .toEqual({ tenantId: 'Realm_1', orderId: 'Order-2', durationMinutes: 15 });
  for (const durationMinutes of [5, 120])
    expect(parseAssistantFoodPickupTarget({ ...target, durationMinutes }).durationMinutes).toBe(durationMinutes);
});
