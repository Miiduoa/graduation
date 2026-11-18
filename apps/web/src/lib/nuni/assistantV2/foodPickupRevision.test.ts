// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginProposal, revoke, signCard } from './actions';
import { directPlanRevision, selectPlanRevision, shiftPlanRevision } from './directPlanRevision';
import { foodPickupEvent, foodPickupGuardForSource } from './foodPickup';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import type { Card } from './contracts';

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => vi.restoreAllMocks());
const raw = (card: Card) => ({ token: card.token, args: card.args });

it.each(['precise', 'subset', 'shift'] as const)('%s cannot strip the signed order dependency', async path => {
  const f = fixtureAdapter(), binding = { ...fixtureBinding, conversationId: 'pickup-revision-' + path };
  const source = { tenantId: 'fixture-realm', orderId: 'order-a', locationId: 'dining-a',
    location: '合成蔬食餐廳', requestedPickupAt: '2026-11-04T12:00:00+08:00' };
  const sequence = beginProposal(binding, now);
  const first = signCard(binding, 'propose_personal_event', {
    title: '其他行程', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '18:30',
  }, 1, secret, now, sequence);
  const pickup = signCard(binding, 'propose_personal_event', foodPickupEvent(source, 15), 2,
    secret, now, sequence, first, undefined, foodPickupGuardForSource(source, 15));
  const originals = [first, pickup];
  for (const card of originals) await revoke(binding, raw(card), secret, now, f.adapter);
  const ledger = vi.spyOn(f.adapter, 'ledger');
  const result = path === 'precise'
    ? directPlanRevision(binding, originals.map(raw), { mutationId: pickup.mutationId,
      date: '2026-11-04', startTime: '12:30', endTime: '12:45' }, secret, f.adapter)
    : path === 'subset'
      ? selectPlanRevision(binding, originals.map(raw), [pickup.mutationId], secret, f.adapter)
      : shiftPlanRevision(binding, originals.map(raw), {
        mutationIds: [pickup.mutationId], protectedMutationIds: [first.mutationId], offsetMinutes: 30,
      }, secret, f.adapter);
  await expect(result).rejects.toMatchObject({ code: 'FOOD_PICKUP_SOURCE_BOUND' });
  expect(ledger).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});
