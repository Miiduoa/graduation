// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { createAdapter } from './adapter';
import { confirm } from './actions';
import { prepareFoodPickupRequest, prepareSelectedFoodPickupRequest } from './foodPickupRequest';
import { fixtureAdapter, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import type { Binding, Ledger, Obj } from './contracts';

const permissions = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../platformAssistantPermissionStore', () => ({
  readPlatformAssistantPermissions: permissions.read,
}));

const account = 'pa_22222222-2222-4222-8222-222222222222';
const binding: Binding = {
  account, schoolId: 'fixture-school', session: 'fixture-session', conversationId: 'pickup-http-flow',
};
const question = '把我最近一筆訂單的取餐時間加入行事曆，預留15分鐘';
const signal = () => new AbortController().signal;
type HttpCall = { method: string; path: string; query: string; body?: Obj };

beforeEach(() => {
  vi.stubEnv('NUNI_API_BASE_URL', 'https://pickup-fixture.invalid');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  permissions.read.mockReset();
  permissions.read.mockImplementation(async (accountId: string) => {
    expect(accountId).toBe(account);
    return { scope: 'platform-account', accountId, revision: 1,
      permissions: { createPersonalEvent: true, prepareFoodOrder: false } };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function httpFixture() {
  let ledger: Ledger = await fixtureAdapter().adapter.ledger();
  const calls: HttpCall[] = [];
  const order = {
    id: 'order-a', state: 'preparing', locationId: 'dining-a', locationName: '合成蔬食餐廳',
    createdAt: '2026-11-04T10:20:00+08:00', requestedPickupAt: '2026-11-04T12:00:00+08:00',
    pickup: { displayCode: 'PRIVATE_PICKUP_CODE' }, paymentToken: 'PRIVATE_PAYMENT_TOKEN',
    lines: [], updatedAt: '2026-11-04T10:25:00+08:00',
  };
  const state = { newestId: 'order-a', sessionChanged: false, multiWorkspace: false };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://pickup-fixture.invalid');
    expect(url.pathname.startsWith('/v1/auth/platform/')).toBe(true);
    expect(init.headers).toMatchObject({ Accept: 'application/json', Authorization: 'Platform fixture-session' });
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const path = url.pathname.replace('/v1/auth/platform/', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) as Obj : undefined;
    calls.push({ method, path, query: url.search, ...(body ? { body } : {}) });
    if (path === 'sessions/current' && method === 'GET') return Response.json({
      authenticated: true, platformAccountId: account, isPlatformOperator: false,
    });
    if (path === 'realms' && method === 'GET') return Response.json({ realms: [
      { tenantId: 'other-realm', schoolId: 'other-school' },
      { tenantId: 'fixture-realm', schoolId: binding.schoolId },
      ...(state.multiWorkspace ? [{ tenantId: 'second-school-realm', schoolId: binding.schoolId }] : []),
    ] });
    if (path === 'realms/fixture-realm/food/orders' && method === 'GET') {
      expect(url.search).toBe('?limit=5');
      return Response.json({ orders: [{ id: state.newestId, state: order.state,
        locationName: order.locationName, locationId: order.locationId, createdAt: order.createdAt }], nextCursor: null });
    }
    if (path === 'realms/fixture-realm/food/orders/order-a' && method === 'GET')
      return state.sessionChanged
        ? Response.json({ error: 'SESSION_CHANGED' }, { status: 409 }) : Response.json(order);
    if (path === 'personal-imports/read' && method === 'POST') {
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(body).toEqual({ schoolId: binding.schoolId });
      return Response.json(ledger);
    }
    if (path === 'personal-imports/write' && method === 'POST') {
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(body).toMatchObject({ schoolId: binding.schoolId, expectedRevision: ledger.revision });
      expect(body?.mutationId).toMatch(/^av2_[a-f0-9]{32}$/);
      ledger = { schoolId: binding.schoolId, revision: ledger.revision + 1,
        records: body!.records as Ledger['records'], updatedAt: new Date(now).toISOString() };
      return Response.json(ledger);
    }
    throw new Error(`Unexpected HTTP operation: ${method} ${path}`);
  }));
  async function fresh() {
    const source = createAdapter({ sessionHandle: binding.session, expiresAt: now + 3_600_000 },
      binding.schoolId, signal());
    expect(await source.principal()).toEqual({ platformAccountId: account, isPlatformOperator: false });
    return source;
  }
  async function preview() {
    const source = await fresh();
    const reply = await prepareFoodPickupRequest({ question, adapter: source.adapter,
      binding, secret, now, writes: true, signal: signal() });
    return { source, reply };
  }
  async function previewSelected() {
    const source = await fresh();
    const reply = await prepareSelectedFoodPickupRequest({
      target: { tenantId: 'fixture-realm', orderId: 'order-a', durationMinutes: 20 },
      adapter: source.adapter, binding, secret, now, writes: true, signal: signal(),
    });
    return { source, reply };
  }
  return { calls, order, state, fresh, preview, previewSelected, ledger: () => ledger };
}

it('uses authenticated scoped HTTP reads, a fresh confirmation budget and one verified calendar write', async () => {
  const f = await httpFixture();
  const initial = structuredClone(f.ledger());
  const { source: previewSource, reply } = await f.preview();
  expect(reply?.cards).toHaveLength(1);
  const card = reply!.cards[0], raw = { token: card.token, args: card.args };
  expect(reply).toMatchObject({ dataRead: true, stopReason: '' });
  expect(card).toMatchObject({ sourceBound: 'food-pickup', args: {
    title: '取餐：合成蔬食餐廳', date: '2026-11-04', startTime: '12:00', endTime: '12:15', allDay: false,
  } });
  expect(JSON.stringify(reply)).not.toContain('PRIVATE_');
  expect(f.ledger()).toEqual(initial);
  expect(previewSource.apiCalls()).toBe(6);
  expect(previewSource.adapter.remainingApiCalls?.()).toBe(6);
  expect(f.calls.map(call => `${call.method} ${call.path}${call.query}`)).toEqual([
    'GET sessions/current', 'GET realms', 'GET realms/fixture-realm/food/orders?limit=5',
    'GET realms/fixture-realm/food/orders/order-a', 'GET realms', 'POST personal-imports/read',
  ]);

  // A new HTTP request must re-authenticate and get a new bounded API budget.
  // Its source remains the reviewed ID even if the latest-order list has moved.
  f.state.newestId = 'newer-order';
  f.order.state = 'ready';
  const split = f.calls.length;
  const confirmationSource = await f.fresh();
  expect(confirmationSource.apiCalls()).toBe(1);
  const receipt = parseAssistantCalendarReceipt(
    await confirm(binding, raw, secret, now, confirmationSource.adapter, true, () => now),
    { schoolId: binding.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced' },
  );
  expect(receipt).toMatchObject({ status: 'verified', replay: false, revision: initial.revision + 1 });
  expect(confirmationSource.apiCalls()).toBe(7);
  expect(confirmationSource.adapter.remainingApiCalls?.()).toBe(5);
  expect(f.calls.slice(split).map(call => `${call.method} ${call.path}`)).toEqual([
    'GET sessions/current', 'POST personal-imports/read', 'GET realms',
    'GET realms/fixture-realm/food/orders/order-a', 'GET realms',
    'POST personal-imports/write', 'POST personal-imports/read',
  ]);
  expect(f.ledger().records.filter(row => row.id === card.mutationId)).toEqual([receipt.record]);
  expect(f.ledger().records.filter(row => row.id !== card.mutationId)).toEqual(initial.records);
  f.order.state = 'fulfilled';
  const replaySource = await f.fresh();
  expect(await confirm(binding, raw, secret, now, replaySource.adapter, true, () => now))
    .toMatchObject({ status: 'verified', replay: true });
  expect(replaySource.apiCalls()).toBe(2);
  expect(f.calls.filter(call => call.path === 'personal-imports/write')).toHaveLength(1);
  expect(f.calls.filter(call => call.path.includes('/food/')).every(call => call.method === 'GET')).toBe(true);
  expect(f.calls.some(call => call.path.includes('other-realm') || call.path.includes('newer-order'))).toBe(false);
});

it('rejects changed authoritative pickup data on the next authenticated request before writing', async () => {
  const f = await httpFixture(), initial = structuredClone(f.ledger());
  const { reply } = await f.preview();
  const card = reply!.cards[0];
  f.order.requestedPickupAt = '2026-11-04T12:20:00+08:00';
  const source = await f.fresh();
  await expect(confirm(binding, { token: card.token, args: card.args }, secret, now,
    source.adapter, true, () => now)).rejects.toMatchObject({ status: 409, code: 'FOOD_PICKUP_CHANGED' });
  expect(f.calls.filter(call => call.path === 'personal-imports/write')).toHaveLength(0);
  expect(f.ledger()).toEqual(initial);
  expect(f.calls.filter(call => call.path.includes('/food/')).every(call => call.method === 'GET')).toBe(true);
});

it('propagates an upstream session change without exposing partial order data or preparing a card', async () => {
  const f = await httpFixture();
  f.state.sessionChanged = true;
  await expect(f.preview()).rejects.toMatchObject({ status: 409, code: 'SESSION_CHANGED' });
  expect(f.calls.some(call => call.path.startsWith('personal-imports/'))).toBe(false);
  expect(f.calls.filter(call => call.path.includes('/food/')).every(call => call.method === 'GET')).toBe(true);
});

it('uses the selected account-scoped HTTP order across multiple workspaces without enumerating or mutating orders', async () => {
  const f = await httpFixture(), initial = structuredClone(f.ledger());
  f.state.multiWorkspace = true;
  f.state.newestId = 'different-latest-order';
  const { source, reply } = await f.previewSelected();
  expect(reply).toMatchObject({ dataRead: true, stopReason: '',
    pickupTarget: { tenantId: 'fixture-realm', orderId: 'order-a', durationMinutes: 20 } });
  expect(reply.cards).toHaveLength(1);
  expect(reply.cards[0].args).toMatchObject({ startTime: '12:00', endTime: '12:20' });
  expect(JSON.stringify(reply)).not.toContain('PRIVATE_');
  expect(source.apiCalls()).toBe(5);
  expect(f.calls.map(call => `${call.method} ${call.path}${call.query}`)).toEqual([
    'GET sessions/current', 'GET realms', 'GET realms/fixture-realm/food/orders/order-a',
    'GET realms', 'POST personal-imports/read',
  ]);
  expect(f.ledger()).toEqual(initial);
  const card = reply.cards[0], confirmation = await f.fresh();
  expect(await confirm(binding, { token: card.token, args: card.args }, secret, now,
    confirmation.adapter, true, () => now)).toMatchObject({ status: 'verified', replay: false });
  expect(f.calls.filter(call => call.path === 'personal-imports/write')).toHaveLength(1);
  expect(f.calls.some(call => call.path.includes('second-school-realm') ||
    call.path.includes('different-latest-order') || call.path.endsWith('/food/orders'))).toBe(false);
  expect(f.calls.filter(call => call.path.includes('/food/')).every(call => call.method === 'GET')).toBe(true);
});
