import {
  canonical,
  date,
  eventArgs,
  fail,
  hash,
  id,
  object,
  type Adapter,
  type Binding,
  type EventArgs,
  type FoodPickupGuard,
} from './contracts';
import { operationSignal } from './operation';

const MINUTE = 60_000;
const PICKUP_STATES = new Set(['paid', 'accepted', 'preparing', 'ready']);

/** Minimal source projection; no price, customer, payment or pickup credential. */
export type FoodPickupSource = {
  tenantId: string;
  orderId: string;
  locationId: string;
  location: string;
  /** Canonical UTC instant, with exact minute precision. */
  requestedPickupAt: string;
};

function sourceId(raw: unknown): string {
  try { return id(raw); } catch { return fail('FOOD_PICKUP_UNAVAILABLE', 502); }
}

/** Date.parse alone accepts date-only strings, local times and normalized dates. */
function sourceTime(raw: unknown, minutePrecision = false): number {
  if (typeof raw !== 'string') return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(raw);
  if (!match || /[+-]14:(?!00)/.test(match[6])) return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  try { date(match[1]); } catch { return fail('FOOD_PICKUP_UNAVAILABLE', 502); }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp) || (minutePrecision &&
      (Number(match[4] || 0) !== 0 || /[1-9]/.test(match[5] || '') || timestamp % MINUTE !== 0)))
    return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  return timestamp;
}

function duration(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 5 || Number(value) > 120)
    return fail('INVALID_INPUT', 422);
  return Number(value);
}

function sourceProjection(raw: FoodPickupSource): FoodPickupSource {
  const value = object(raw);
  if (typeof value.location !== 'string' || !value.location.trim() ||
      value.location.length > 120 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.location))
    return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  return {
    tenantId: sourceId(value.tenantId),
    orderId: sourceId(value.orderId),
    locationId: sourceId(value.locationId),
    location: value.location.trim(),
    requestedPickupAt: new Date(sourceTime(value.requestedPickupAt, true)).toISOString(),
  };
}

function pickupSource(raw: unknown, tenantId: string, orderId: string, now: number): FoodPickupSource {
  if (!Number.isFinite(now)) return fail('INVALID_INPUT', 422);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  const value = raw as Record<string, unknown>;
  if (value.id !== orderId) return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  if (typeof value.state !== 'string' || !PICKUP_STATES.has(value.state))
    return fail('FOOD_PICKUP_CHANGED', 409);
  const source = sourceProjection({
    tenantId, orderId,
    locationId: value.locationId as string,
    location: value.location as string,
    requestedPickupAt: value.requestedPickupAt as string,
  });
  if (Date.parse(source.requestedPickupAt) <= now) return fail('FOOD_PICKUP_PASSED', 409);
  return source;
}

async function schoolRealms(adapter: Adapter, binding: Binding) {
  operationSignal()?.throwIfAborted();
  const realms = await adapter.realms();
  operationSignal()?.throwIfAborted();
  if (!Array.isArray(realms)) return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  return realms.filter((realm) => realm && realm.schoolId === binding.schoolId)
    .map((realm) => ({ tenantId: sourceId(realm.tenantId) }));
}

async function verifyRealm(adapter: Adapter, binding: Binding, tenantId: string) {
  const realms = await schoolRealms(adapter, binding);
  if (realms.filter((realm) => realm.tenantId === tenantId).length !== 1)
    return fail('FOOD_PICKUP_CHANGED', 403);
}

/** Resolve latest only once. A cancelled latest order never selects an older one. */
export async function readLatestFoodPickup(
  adapter: Adapter, binding: Binding, now: number,
): Promise<FoodPickupSource> {
  if (!Number.isFinite(now)) return fail('INVALID_INPUT', 422);
  const realms = await schoolRealms(adapter, binding);
  if (!realms.length) return fail('FOOD_PICKUP_UNAVAILABLE', 403);
  if (realms.length !== 1) return fail('FOOD_PICKUP_AMBIGUOUS', 409);
  const tenantId = realms[0].tenantId;
  const result = await adapter.orders(tenantId, undefined, { limit: 5 });
  operationSignal()?.throwIfAborted();
  if (!result || !Array.isArray(result.orders) || result.orders.length > 5)
    return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  if (!result.orders.length) return fail('FOOD_PICKUP_UNAVAILABLE', 404);
  const orders = result.orders.map((row) => {
    if (!row || typeof row !== 'object') return fail('FOOD_PICKUP_UNAVAILABLE', 502);
    const createdAt = sourceTime(row.createdAt);
    if (createdAt > now) return fail('FOOD_PICKUP_UNAVAILABLE', 502);
    return { id: sourceId(row.id), createdAt };
  }).sort((a, b) => b.createdAt - a.createdAt);
  if (new Set(orders.map((row) => row.id)).size !== orders.length)
    return fail('FOOD_PICKUP_UNAVAILABLE', 502);
  if (orders.length > 1 && orders[0].createdAt === orders[1].createdAt)
    return fail('FOOD_PICKUP_AMBIGUOUS', 409);
  const orderId = orders[0].id;
  const source = pickupSource(await adapter.order(tenantId, orderId), tenantId, orderId, now);
  operationSignal()?.throwIfAborted();
  await verifyRealm(adapter, binding, tenantId);
  return source;
}

export function foodPickupEvent(raw: FoodPickupSource, durationMinutes: number): EventArgs {
  const source = sourceProjection(raw), minutes = duration(durationMinutes);
  const start = Date.parse(source.requestedPickupAt);
  const localStart = new Date(start + 8 * 60 * MINUTE).toISOString();
  const localEnd = new Date(start + (8 * 60 + minutes) * MINUTE).toISOString();
  // Keep the full location in the guard while fitting the calendar title limit.
  let title = '取餐：';
  for (const character of source.location) {
    if (title.length + character.length > 120) break;
    title += character;
  }
  return eventArgs({
    title, date: localStart.slice(0, 10), allDay: false,
    startTime: localStart.slice(11, 16), endTime: localEnd.slice(11, 16),
    ...(localStart.slice(0, 10) === localEnd.slice(0, 10) ? {} : { endDate: localEnd.slice(0, 10) }),
  });
}

export function foodPickupGuard(raw: unknown): FoodPickupGuard {
  const value = object(raw, ['tenantId', 'orderId', 'fingerprint', 'durationMinutes']);
  if (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint))
    return fail('CONFIRMATION_INVALID', 409);
  return {
    tenantId: id(value.tenantId), orderId: id(value.orderId),
    fingerprint: value.fingerprint, durationMinutes: duration(value.durationMinutes),
  };
}

export function foodPickupGuardForSource(raw: FoodPickupSource, durationMinutes: number): FoodPickupGuard {
  const source = sourceProjection(raw);
  return {
    tenantId: source.tenantId, orderId: source.orderId,
    fingerprint: hash(source), durationMinutes: duration(durationMinutes),
  };
}

/** Re-read the original source, never rerun a mutable latest-order selection. */
export async function verifyFoodPickupGuard(
  adapter: Adapter, binding: Binding, raw: FoodPickupGuard, event: EventArgs, now: number,
): Promise<void> {
  const guard = foodPickupGuard(raw);
  await verifyRealm(adapter, binding, guard.tenantId);
  const source = pickupSource(await adapter.order(guard.tenantId, guard.orderId),
    guard.tenantId, guard.orderId, now);
  operationSignal()?.throwIfAborted();
  await verifyRealm(adapter, binding, guard.tenantId);
  if (hash(source) !== guard.fingerprint ||
      canonical(foodPickupEvent(source, guard.durationMinutes)) !== canonical(eventArgs(event)))
    return fail('FOOD_PICKUP_CHANGED', 409);
}
