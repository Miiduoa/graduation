// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirm, reconcile, revoke, signCard } from './actions';
import { createAdapter } from './adapter';
import { createTools } from './tools';
import { run } from './runner';
import type { Adapter, Card, Model } from './contracts';
import {
  fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret,
} from './fixtures';

const readStore = vi.hoisted(() => vi.fn());
vi.mock('../platformAssistantPermissionStore', () => ({
  readPlatformAssistantPermissions: readStore,
}));

const event = { title: '讀書', date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00' };
const cart = {
  tenantId: 'fixture-realm', locationId: 'dining-a', requestedPickupAt: '2026-11-04T12:00:00+08:00',
  items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
};
const raw = (card: Card) => ({ token: card.token, args: card.args });
const all = { createPersonalEvent: true, prepareFoodOrder: true };
const none = { createPersonalEvent: false, prepareFoodOrder: false };
const signedEvent = () => signCard(binding, 'propose_personal_event', event, 1, secret, now);
const toolsFor = (adapter: Adapter) => createTools(adapter, binding, secret, now, true);
async function foodCard(adapter: Adapter) {
  const tools = toolsFor(adapter);
  await tools.call('get_food_locations', {});
  await tools.call('propose_food_order', cart);
  return tools.cards[0];
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  readStore.mockReset();
});

describe('account permission proposal boundary', () => {
  it.each([
    ['propose_personal_event', event],
    ['propose_study_plan', { date: event.date }],
    ['propose_food_order', cart],
    ['reorder_last_food_order', {}],
  ])('does not produce a %s card when its permission is off', async (name, args) => {
    const f = fixtureAdapter(true);
    f.adapter.permissions = async () => none;
    const tools = toolsFor(f.adapter);
    await expect(tools.call(String(name), args)).rejects.toMatchObject({ status: 403, code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(tools.cards).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
    expect(f.orderCalls).toHaveLength(0);
  });

  it('keeps existing actions available without a reader, without blocking read-only tools or opening a page', async () => {
    const f = fixtureAdapter();
    delete f.adapter.permissions;
    const tools = toolsFor(f.adapter);
    await expect(tools.call('propose_personal_event', event)).resolves.toBeTruthy();
    expect(tools.cards).toHaveLength(1);
    await expect(tools.call('get_calendar', { from: event.date, to: event.date })).resolves.toBeTruthy();
    await tools.call('propose_open_page', { page: 'calendar' });
    await expect(confirm(binding, raw(tools.cards[1]), secret, now, f.adapter, true)).resolves.toMatchObject({ href: expect.stringContaining('/calendar') });
    expect(f.writes).toHaveLength(0);
  });

  it('keeps calendar and food grants independent', async () => {
    const f = fixtureAdapter();
    let permissions = { ...all, prepareFoodOrder: false };
    f.adapter.permissions = async () => permissions;
    await toolsFor(f.adapter).call('propose_personal_event', event);
    await expect(toolsFor(f.adapter).call('propose_food_order', cart)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    permissions = { ...all, createPersonalEvent: false };
    expect((await foodCard(f.adapter)).tool).toBe('propose_food_order');
    await expect(toolsFor(f.adapter).call('propose_study_plan', { date: event.date })).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
  });

  it('rechecks cached proposal calls and removes cards after revocation', async () => {
    const f = fixtureAdapter();
    let granted = true;
    f.adapter.permissions = async () => ({ ...all, createPersonalEvent: granted });
    const tools = toolsFor(f.adapter);
    await tools.call('propose_personal_event', event);
    expect(tools.cards).toHaveLength(1);
    granted = false;
    await expect(tools.call('propose_personal_event', event)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(tools.cards).toHaveLength(0);
    granted = true;
    expect((await tools.call('propose_personal_event', event)).cached).toBe(false);
    expect(tools.cards).toHaveLength(1);
  });

  it('does not issue an event card when permission is revoked while its ledger is loading', async () => {
    const f = fixtureAdapter(), read = f.adapter.ledger;
    let granted = true;
    f.adapter.permissions = async () => ({ ...all, createPersonalEvent: granted });
    f.adapter.ledger = async () => { granted = false; return read(); };
    const tools = toolsFor(f.adapter);
    await expect(tools.call('propose_personal_event', event)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(tools.cards).toHaveLength(0);
  });

  it('does not issue a food card when permission is revoked while its menu is loading', async () => {
    const f = fixtureAdapter(), menu = f.adapter.food!.menu;
    let granted = true;
    f.adapter.permissions = async () => ({ ...all, prepareFoodOrder: granted });
    f.adapter.food!.menu = async (...args) => { granted = false; return menu(...args); };
    const tools = toolsFor(f.adapter);
    await tools.call('get_food_locations', {});
    await expect(tools.call('propose_food_order', cart)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(tools.cards).toHaveLength(0);
  });
});

describe('execution, revocation and read-only recovery', () => {
  it('blocks an old calendar card after revocation while allowing reconciliation and cancellation', async () => {
    const f = fixtureAdapter(), card = signedEvent();
    f.adapter.permissions = async () => none;
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(await reconcile(binding, raw(card), secret, now, f.adapter, true)).toMatchObject({ status: 'absent', authorizationValid: false, retryable: false });
    expect(await revoke(binding, raw(card), secret, now, f.adapter)).toMatchObject({ status: 'revoked', retryable: false });
    expect(f.writes).toHaveLength(0);
  });

  it('rechecks calendar permission after ledger I/O immediately before writing', async () => {
    const f = fixtureAdapter(), card = signedEvent(), read = f.adapter.ledger;
    let granted = true;
    f.adapter.permissions = async () => ({ ...all, createPersonalEvent: granted });
    f.adapter.ledger = async () => { granted = false; return read(); };
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(f.writes).toHaveLength(0);
  });

  it('retains verified receipts after revocation without another write', async () => {
    const f = fixtureAdapter(), card = signedEvent();
    await confirm(binding, raw(card), secret, now, f.adapter, true);
    f.adapter.permissions = async () => none;
    expect(await reconcile(binding, raw(card), secret, now, f.adapter, true)).toMatchObject({ status: 'verified', replay: true });
    expect(await revoke(binding, raw(card), secret, now, f.adapter)).toMatchObject({ status: 'verified', replay: true });
    expect(f.writes).toHaveLength(1);
  });

  it('keeps existing execution available on a reader outage', async () => {
    const f = fixtureAdapter(), card = signedEvent();
    f.adapter.permissions = async () => { throw new Error('database unavailable'); };
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).resolves.toBeTruthy();
    expect(f.writes).toHaveLength(1);
  });

  it.each([false, true])('blocks old food cards in both page and submit modes (ordering=%s)', async (ordering) => {
    const f = fixtureAdapter(ordering), card = await foodCard(f.adapter);
    f.adapter.permissions = async () => none;
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(await revoke(binding, raw(card), secret, now, f.adapter)).toMatchObject({ revoked: true });
    expect(f.orderCalls).toHaveLength(0);
  });

  it('rechecks food permission after fresh menu pricing before submission', async () => {
    const f = fixtureAdapter(true), card = await foodCard(f.adapter), menu = f.adapter.food!.menu;
    let granted = true;
    f.adapter.permissions = async () => ({ ...all, prepareFoodOrder: granted });
    f.adapter.food!.menu = async (...args) => { granted = false; return menu(...args); };
    await expect(confirm(binding, raw(card), secret, now, f.adapter, true)).rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(f.orderCalls).toHaveLength(0);
  });
});

describe('production reader and assistant feedback', () => {
  it('uses only the verified principal account and reads fresh permissions each time', async () => {
    const account = 'pa_11111111-1111-4111-8111-111111111111';
    vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authenticated: true, platformAccountId: account, isPlatformOperator: false })));
    readStore.mockResolvedValueOnce({ scope: 'platform-account', accountId: account, revision: 1, permissions: all })
      .mockResolvedValueOnce({ scope: 'platform-account', accountId: account, revision: 2, permissions: none });
    const source = createAdapter({ sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: now + 3600000 }, 'pu', new AbortController().signal);
    await expect(source.adapter.permissions!()).rejects.toMatchObject({ status: 401 });
    expect(readStore).not.toHaveBeenCalled();
    await source.principal();
    expect(await source.adapter.permissions!()).toEqual(all);
    expect(await source.adapter.permissions!()).toEqual(none);
    expect(readStore.mock.calls).toEqual([[account], [account]]);
  });

  it('reports denied settings with a real settings link and no invented confirmation card', async () => {
    const f = fixtureAdapter();
    f.adapter.permissions = async () => none;
    const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
    let calls = 0;
    const model: Model = async () => ++calls === 1 ? {
      message: { role: 'assistant', tool_calls: [{ id: 'event', type: 'function', function: { name: 'propose_personal_event', arguments: JSON.stringify(event) } }] }, usage,
    } : { message: { role: 'assistant', content: '已幫你建立行程，請按確認卡。' }, usage };
    const result = await run({
      question: '幫我新增個人行程，今晚20:00到21:00讀書', history: [], binding, adapter: f.adapter,
      secret, now, model, writes: true, signal: new AbortController().signal, log: () => {},
    });
    expect(result.cards).toHaveLength(0);
    expect(result.answer).toContain('/settings?section=assistant');
    expect(result.answer).toContain('權限尚未開啟');
    expect(result.answer).not.toContain('已幫你建立行程');
    expect(result.steps.filter((step) => step.name === 'propose_personal_event')).toHaveLength(1);
    expect(f.writes).toHaveLength(0);
  });

  it('never prepares a fallback food cart from a loaded menu when permission is denied', async () => {
    const f = fixtureAdapter();
    f.adapter.permissions = async () => none;
    const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
    let calls = 0;
    const model: Model = async () => {
      calls++;
      if (calls <= 2) {
        const name = calls === 1 ? 'get_food_locations' : 'get_food_menu';
        const args = calls === 1 ? {} : { tenantId: cart.tenantId, locationId: cart.locationId };
        return { message: { role: 'assistant', tool_calls: [{ id: 'food-' + calls, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, usage };
      }
      return { message: { role: 'assistant', content: '已備好餐點，請前往 /food?tenant=fixture-realm&location=dining-a&items=veggie.1.regular' }, usage };
    };
    const result = await run({
      question: '幫我點一份不辣的蔬菜便當', history: [], binding, adapter: f.adapter,
      secret, now, model, writes: true, signal: new AbortController().signal, log: () => {},
    });
    expect(result.steps).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'get_food_menu', status: 'ok' })]));
    expect(result.cards).toHaveLength(0);
    expect(result.answer).toContain('/food');
    expect(result.answer).toContain('/settings?section=assistant');
    expect(result.answer).not.toContain('items=');
    expect(result.answer).not.toContain('已備好餐點');
    expect(f.orderCalls).toHaveLength(0);
  });
});
