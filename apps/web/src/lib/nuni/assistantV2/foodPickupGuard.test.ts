// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import {
  authenticateCourseworkFollowup, confirm, reconcile, revoke, signCard, verifyCard,
} from './actions';
import { canonical, V2Error, type Card } from './contracts';
import {
  foodPickupEvent, foodPickupGuard, foodPickupGuardForSource,
  readLatestFoodPickup, verifyFoodPickupGuard,
} from './foodPickup';
import {
  fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret,
} from './fixtures';
import { withOperationSignal } from './operation';

const raw = (card: Card) => ({ token: card.token, args: card.args });
function pickupFixture() {
  const f = fixtureAdapter();
  const detail = {
    id: 'order-a', state: 'preparing', locationId: 'dining-a', location: '合成蔬食餐廳',
    requestedPickupAt: '2026-11-04T12:00:00+08:00',
    paymentToken: 'NEVER_PROJECT_PAYMENT', pickupNumber: 'NEVER_PROJECT_PICKUP',
    customer: 'NEVER_PROJECT_CUSTOMER', updatedAt: '2026-11-04T10:25:00+08:00',
  };
  f.adapter.order = vi.fn(async () => structuredClone(detail));
  return { ...f, detail };
}
async function prepare(f = pickupFixture(), minutes = 15) {
  const source = await readLatestFoodPickup(f.adapter, binding, now);
  const event = foodPickupEvent(source, minutes);
  const guard = foodPickupGuardForSource(source, minutes);
  const ledger = await f.adapter.ledger();
  const card = signCard(binding, 'propose_personal_event', event, ledger.revision,
    secret, now, undefined, undefined, undefined, guard);
  return { f, source, event, guard, card };
}

describe('order pickup source selection', () => {
  it('uses the latest creation instant, retains only the required source and does no write', async () => {
    const f = pickupFixture();
    f.adapter.orders = vi.fn(async () => ({ orders: [
      { id: 'order-b', state: 'ready', createdAt: '2026-11-04T10:00:00+08:00' },
      { id: 'order-a', state: 'preparing', createdAt: '2026-11-04T02:20:00Z' },
    ], nextCursor: 'more' }));
    const realms = vi.spyOn(f.adapter, 'realms');
    const source = await readLatestFoodPickup(f.adapter, binding, now);
    expect(source).toEqual({
      tenantId: 'fixture-realm', orderId: 'order-a', locationId: 'dining-a',
      location: '合成蔬食餐廳', requestedPickupAt: '2026-11-04T04:00:00.000Z',
    });
    expect(JSON.stringify(source)).not.toContain('NEVER_PROJECT');
    expect(f.adapter.orders).toHaveBeenCalledWith('fixture-realm', undefined, { limit: 5 });
    expect(f.adapter.order).toHaveBeenCalledExactlyOnceWith('fixture-realm', 'order-a');
    expect(realms).toHaveBeenCalledTimes(2);
    expect(f.writes).toHaveLength(0);
  });

  it.each(['no-realm', 'wrong-school', 'multiple-realms'] as const)(
    'does not select an account or tenant when the scope is %s', async (mode) => {
      const f = pickupFixture();
      f.adapter.realms = vi.fn(async () => mode === 'no-realm' ? [] : mode === 'wrong-school'
        ? [{ tenantId: 'fixture-realm', schoolId: 'other-school' }]
        : ['realm-a', 'realm-b'].map((tenantId) => ({ tenantId, schoolId: binding.schoolId })));
      const orders = vi.spyOn(f.adapter, 'orders');
      await expect(readLatestFoodPickup(f.adapter, binding, now)).rejects.toMatchObject({
        code: mode === 'multiple-realms' ? 'FOOD_PICKUP_AMBIGUOUS' : 'FOOD_PICKUP_UNAVAILABLE',
      });
      expect(orders).not.toHaveBeenCalled();
      expect(f.adapter.order).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing creation timestamp', undefined],
    ['timezone-free creation timestamp', '2026-11-04T10:20:00'],
    ['impossible creation date', '2026-02-30T10:20:00+08:00'],
    ['future creation time', '2026-11-04T10:31:00+08:00'],
  ])('refuses %s instead of guessing latest order', async (_label, createdAt) => {
    const f = pickupFixture();
    f.adapter.orders = async () => ({ orders: [{ id: 'order-a', state: 'ready', createdAt }] });
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_UNAVAILABLE' });
    expect(f.adapter.order).not.toHaveBeenCalled();
  });

  it('refuses tied latest timestamps and duplicate identifiers', async () => {
    const f = pickupFixture();
    f.adapter.orders = async () => ({ orders: ['order-a', 'order-b'].map((id) => ({
      id, state: 'ready', createdAt: '2026-11-04T10:20:00+08:00',
    })) });
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_AMBIGUOUS' });
    f.adapter.orders = async () => ({ orders: [0, 1].map((index) => ({
      id: 'order-a', state: 'ready', createdAt: `2026-11-04T10:2${index}:00+08:00`,
    })) });
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_UNAVAILABLE' });
    expect(f.adapter.order).not.toHaveBeenCalled();
  });

  it.each(['payment-pending', 'awaiting_payment', 'fulfilled', 'canceled', 'rejected',
    'payment-expired', 'cancellation-pending-refund', 'rejection-pending-refund', 'unknown'])(
    'does not skip the latest %s order to create an event for an older order', async (state) => {
      const f = pickupFixture();
      f.detail.state = state;
      await expect(readLatestFoodPickup(f.adapter, binding, now))
        .rejects.toMatchObject({ code: 'FOOD_PICKUP_CHANGED' });
      expect(f.adapter.order).toHaveBeenCalledExactlyOnceWith('fixture-realm', 'order-a');
      expect(f.writes).toHaveLength(0);
    },
  );

  it.each([
    '2026-11-04', '2026-11-04T12:00:00', '2026-02-30T12:00:00+08:00',
    '2026-11-04T24:00:00+08:00', '2026-11-04T12:00:01+08:00',
    '2026-11-04T12:00:00.001+08:00', '2026-11-04T12:00:00+14:01',
  ])('never invents or rounds the pickup time %s', async (requestedPickupAt) => {
    const f = pickupFixture();
    f.detail.requestedPickupAt = requestedPickupAt;
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_UNAVAILABLE' });
  });

  it('rejects past pickup, mismatching source identity and permission lost during detail read', async () => {
    const f = pickupFixture();
    f.detail.requestedPickupAt = '2026-11-04T10:30:00+08:00';
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_PASSED' });
    f.detail.requestedPickupAt = '2026-11-04T12:00:00+08:00';
    f.detail.id = 'other-order';
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_UNAVAILABLE' });
    f.detail.id = 'order-a';
    f.adapter.order = async () => {
      f.adapter.realms = async () => [];
      return f.detail;
    };
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_CHANGED' });
  });

  it('honors cancellation and propagates session changes without retaining a source', async () => {
    const f = pickupFixture(), controller = new AbortController();
    f.adapter.order = async () => {
      controller.abort();
      return f.detail;
    };
    await expect(withOperationSignal(controller.signal, () => readLatestFoodPickup(f.adapter, binding, now)))
      .rejects.toMatchObject({ name: 'AbortError' });
    f.adapter.order = async () => { throw new V2Error(409, 'SESSION_CHANGED'); };
    await expect(readLatestFoodPickup(f.adapter, binding, now))
      .rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });
});

describe('source-bound pickup calendar confirmation', () => {
  it('builds a correctly dated Taiwan event across midnight and bounds duration', async () => {
    const f = pickupFixture();
    f.detail.requestedPickupAt = '2026-11-04T15:50:00Z';
    const source = await readLatestFoodPickup(f.adapter, binding, now);
    expect(foodPickupEvent(source, 20)).toEqual({ title: '取餐：合成蔬食餐廳',
      date: '2026-11-04', endDate: '2026-11-05', allDay: false, startTime: '23:50', endTime: '00:10' });
    for (const minutes of [0, 4, 121, 5.5, NaN])
      expect(() => foodPickupEvent(source, minutes)).toThrow();
    expect(foodPickupGuardForSource(source, 5).durationMinutes).toBe(5);
    expect(foodPickupGuardForSource(source, 120).durationMinutes).toBe(120);
  });

  it('uses canonical source instants and lets valid order progress continue', async () => {
    const { f, source, event, guard } = await prepare();
    f.detail.requestedPickupAt = '2026-11-04T04:00:00.000Z';
    for (const state of ['paid', 'accepted', 'preparing', 'ready']) {
      f.detail.state = state;
      await expect(verifyFoodPickupGuard(f.adapter, binding, guard, event, now)).resolves.toBeUndefined();
    }
    expect(foodPickupGuardForSource({ ...source, requestedPickupAt: '2026-11-04T12:00+08:00' }, 15))
      .toEqual(guard);
  });

  it('writes only the exact source-derived event and returns a read-back receipt', async () => {
    const { f, card, guard } = await prepare();
    expect(card.sourceBound).toBe('food-pickup');
    expect(verifyCard(binding, raw(card), secret, now).pickupGuard).toEqual(guard);
    expect(f.writes).toHaveLength(0);
    const read = vi.spyOn(f.adapter, 'ledger');
    const receipt = parseAssistantCalendarReceipt(
      await confirm(binding, raw(card), secret, now, f.adapter, true, () => now),
      { schoolId: binding.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced' },
    );
    expect(receipt).toMatchObject({ status: 'verified', replay: false });
    expect(read).toHaveBeenCalledTimes(2);
    expect(f.writes).toHaveLength(1);
  });

  it.each(['time', 'location', 'location-id', 'canceled', 'fulfilled', 'permission'] as const)(
    'rejects changed %s before the first calendar write', async (change) => {
      const { f, card } = await prepare();
      if (change === 'time') f.detail.requestedPickupAt = '2026-11-04T12:15:00+08:00';
      if (change === 'location') f.detail.location = '另一家店';
      if (change === 'location-id') f.detail.locationId = 'other-location';
      if (change === 'canceled' || change === 'fulfilled') f.detail.state = change;
      if (change === 'permission') f.adapter.realms = async () => [];
      await expect(confirm(binding, raw(card), secret, now, f.adapter, true, () => now))
        .rejects.toMatchObject({ code: 'FOOD_PICKUP_CHANGED' });
      expect(f.writes).toHaveLength(0);
    },
  );

  it('keeps the original target when a newer order or an additional realm appears', async () => {
    const { f, card } = await prepare();
    f.adapter.orders = vi.fn(async () => ({ orders: [{ id: 'new-order', state: 'ready',
      createdAt: '2026-11-04T10:29:00+08:00' }] }));
    f.adapter.realms = async () => ['fixture-realm', 'new-realm'].map((tenantId) => ({ tenantId, schoolId: binding.schoolId }));
    vi.mocked(f.adapter.order).mockClear();
    await confirm(binding, raw(card), secret, now, f.adapter, true, () => now);
    expect(f.adapter.orders).not.toHaveBeenCalled();
    expect(f.adapter.order).toHaveBeenCalledExactlyOnceWith('fixture-realm', 'order-a');
    expect(f.writes).toHaveLength(1);
  });

  it('checks source access and assistant permission again after source I/O', async () => {
    const { f, card } = await prepare();
    f.adapter.order = async () => {
      f.adapter.realms = async () => [];
      return f.detail;
    };
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true, () => now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_CHANGED' });
    expect(f.writes).toHaveLength(0);
    const second = await prepare();
    second.f.adapter.order = async () => {
      second.f.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
      return second.f.detail;
    };
    await expect(confirm(binding, raw(second.card), secret, now, second.f.adapter, true, () => now))
      .rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(second.f.writes).toHaveLength(0);
  });

  it('checks the actual write time after source I/O', async () => {
    const f = pickupFixture();
    f.detail.requestedPickupAt = '2026-11-04T10:31:00+08:00';
    const { card } = await prepare(f);
    let clock = now;
    f.adapter.order = async () => {
      clock = now + 60_000;
      return f.detail;
    };
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true, () => clock))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_PASSED' });
    expect(f.writes).toHaveLength(0);
  });

  it('replays an exact completed event even after the order changes or cannot be read', async () => {
    const { f, card } = await prepare();
    await confirm(binding, raw(card), secret, now, f.adapter, true, () => now);
    f.detail.state = 'fulfilled';
    f.adapter.order = vi.fn(async () => { throw new Error('offline'); });
    expect(await confirm(binding, raw(card), secret, now, f.adapter, true, () => now))
      .toMatchObject({ status: 'verified', replay: true });
    expect(await reconcile(binding, raw(card), secret, now + 300_001, f.adapter, true))
      .toMatchObject({ status: 'verified', replay: true });
    expect(f.adapter.order).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(1);
  });

  it('recovers a committed write with a lost response without re-reading or rewriting the order', async () => {
    const { f, card } = await prepare();
    const write = f.adapter.write;
    f.adapter.write = async (input) => { await write(input); throw new Error('response lost'); };
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true, () => now)).rejects.toThrow('response lost');
    f.adapter.order = vi.fn(async () => { throw new Error('offline'); });
    expect(await reconcile(binding, raw(card), secret, now, f.adapter, true))
      .toMatchObject({ status: 'verified', replay: true });
    expect(await confirm(binding, raw(card), secret, now, f.adapter, true, () => now))
      .toMatchObject({ status: 'verified', replay: true });
    expect(f.adapter.order).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(1);
  });

  it('supports cancellation and rejects account/school/token tampering before source reads', async () => {
    const { f, card } = await prepare();
    vi.mocked(f.adapter.order).mockClear();
    for (const field of ['account', 'session', 'conversationId', 'schoolId'] as const)
      await expect(confirm({ ...binding, [field]: 'other' }, raw(card), secret, now, f.adapter, true))
        .rejects.toThrow();
    await expect(confirm(binding, { ...raw(card), args: { ...card.args, startTime: '12:05' } }, secret, now, f.adapter, true))
      .rejects.toThrow();
    expect(await revoke(binding, raw(card), secret, now, f.adapter)).toMatchObject({ status: 'revoked' });
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true))
      .rejects.toMatchObject({ code: 'CONFIRMATION_REVOKED' });
    expect(f.adapter.order).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });

  it('does not accept source guards on page cards or mix them with coursework guards', async () => {
    const { card, guard, event } = await prepare();
    expect(() => signCard(binding, 'propose_open_page', { page: 'orders' }, 1, secret, now,
      undefined, undefined, undefined, guard)).toThrow();
    expect(() => signCard(binding, 'propose_personal_event', event, 1, secret, now,
      undefined, undefined, { workspaceId: 'course-a', taskId: 'task-a', kind: 'assignment',
        fingerprint: 'a'.repeat(64), policy: 'study' }, guard)).toThrow();
    expect(() => authenticateCourseworkFollowup(binding, raw(card), secret, now)).toThrow();
    expect(() => foodPickupGuard({ ...guard, durationMinutes: 121 })).toThrow();
    expect(() => foodPickupGuard({ ...guard, unexpected: 'value' })).toThrow();
  });

  it('binds the original duration and source to the reviewed event even in signed metadata', async () => {
    const { f, card } = await prepare();
    const payload = JSON.parse(Buffer.from(card.token.split('.')[0], 'base64url').toString());
    const changed = { ...payload, pickupGuard: { ...payload.pickupGuard, durationMinutes: 30 } };
    const body = Buffer.from(canonical(changed)).toString('base64url');
    const token = body + '.' + createHmac('sha256', secret).update('nuni-assistant-v2-confirm\0' + body).digest('base64url');
    await expect(confirm(binding, { token, args: card.args }, secret, now, f.adapter, true, () => now))
      .rejects.toMatchObject({ code: 'FOOD_PICKUP_CHANGED' });
    expect(f.writes).toHaveLength(0);
  });
});
