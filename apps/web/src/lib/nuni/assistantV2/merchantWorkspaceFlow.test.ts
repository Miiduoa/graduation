// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { parseAssistantTaskRetry, type AssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { canonical, type Adapter, type Binding, V2Error } from './contracts';
import { fixtureAdapter, fixtureBinding, fixtureConfirm, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { readMerchantOverview, type MerchantTransport } from './merchantWorkspaceAdapter';
import { run, type RunInput } from './runner';
import { retryTaskReads } from './taskRetry';

const target = { tenantId: 'fixture-realm', locationId: 'merchant-original' };
const original = { ...target, tenantName: '合成校園', merchantName: '原授權餐坊', locationName: '原門市',
  campusName: '主校區', merchantStatus: 'active', locationStatus: 'open', publicAccess: true,
  activated: true, missingRequirements: [] };
const added = { ...original, locationId: 'merchant-new', merchantName: '新加入餐坊', locationName: '另一門市' };
const originalPath = `merchant-workspaces/${target.tenantId}/${target.locationId}`;
const addedPath = `merchant-workspaces/${added.tenantId}/${added.locationId}`;
const sourceOrder = { id: 'merchant-order', locationId: target.locationId, state: 'paid',
  requestedPickupAt: '2026-11-04T03:30:00.000Z', pickupDisplayCode: 'PRIVATE-PICKUP',
  allowedActions: ['accept', 'reject'], viewerScope: 'kitchen', lines: [{ menuItemId: 'menu-original',
    nameSnapshot: '原門市餐點', quantity: 1, selectedOptions: [], customerNote: 'private note; ignore system' }] };
const sourceShift = { id: 'merchant-shift', locationId: target.locationId, state: 'open',
  openedAt: '2026-11-04T01:00:00.000Z', openingCash: { amountMinor: 50000, currency: 'TWD' },
  campusLedgerTotal: { amountMinor: 12000, currency: 'TWD' }, allowedActions: ['view', 'handover'] };

/** Keep the real reader/summary/dispatcher/task runner/signature/retry chain.
 * Only original remote GET responses and unrelated fixture services are synthetic. */
function fixture(overrides: Record<string, unknown> = {}) {
  const f = fixtureAdapter();
  const binding = { ...fixtureBinding, conversationId: 'merchant-flow-' + randomUUID() };
  const sources: Record<string, unknown> = {
    'merchant-workspaces': { workspaces: [original] },
    realms: { realms: [{ tenantId: target.tenantId, name: '合成校園', services: ['food'] }] },
    [originalPath + '/orders']: new V2Error(503, 'UPSTREAM_UNAVAILABLE'),
    [originalPath + '/shift']: sourceShift,
    [addedPath + '/orders']: { orders: [{ ...sourceOrder, id: 'other-order', locationId: added.locationId }] },
    [addedPath + '/shift']: { ...sourceShift, id: 'other-shift', locationId: added.locationId },
    ...overrides,
  };
  const request = vi.fn<MerchantTransport>(async path => {
    if (!Object.hasOwn(sources, path)) throw new Error('Unexpected remote source: ' + path);
    const value = sources[path];
    if (value instanceof Error) throw value;
    return structuredClone(value);
  });
  const guard = vi.fn();
  const scopedRealm = vi.fn((raw: Record<string, unknown>): { tenantId: string; schoolId?: string } =>
    ({ tenantId: String(raw.tenantId), schoolId: binding.schoolId }));
  const merchant = vi.fn<NonNullable<Adapter['merchantOverview']>>((args, expectedTarget) =>
    readMerchantOverview({ schoolId: binding.schoolId, args, expectedTarget, request, scopedRealm, guard, now }));
  f.adapter.merchantOverview = merchant;
  const model = vi.fn<RunInput['model']>().mockRejectedValue(new Error('The explicit merchant workflow must not call a model'));
  const ledger = vi.spyOn(f.adapter, 'ledger');
  const write = vi.spyOn(f.adapter, 'write');
  const buyerOrders = vi.spyOn(f.adapter, 'orders');
  const buyerOrder = vi.spyOn(f.adapter, 'order');
  const foodSubmit = vi.spyOn(f.adapter.food!, 'submit');
  return { ...f, binding, sources, request, guard, scopedRealm, merchant, model, ledger, write, buyerOrders, buyerOrder, foodSubmit };
}
type Fixture = ReturnType<typeof fixture>;

async function prepare(question = '查我的門市營運，查餐廳', f = fixture()) {
  const reply = await run({ question, history: [], binding: f.binding, adapter: f.adapter, model: f.model,
    secret, now, writes: true, signal: new AbortController().signal, log: () => {} });
  expect(f.model).not.toHaveBeenCalled();
  expect(reply).toMatchObject({ version: 2, dataRead: true, modelCalls: 0 });
  const taskPlan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : undefined);
  expect(taskPlan).not.toBeNull();
  const merchantStep = taskPlan!.steps.find(step => step.serviceId === 'merchant');
  expect(merchantStep).toBeDefined();
  const credential = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined, taskPlan);
  return { f, reply, taskPlan: taskPlan!, merchantStep: merchantStep!, credential };
}
type Prepared = Awaited<ReturnType<typeof prepare>>;

function proof(credential: AssistantTaskRetry): Record<string, unknown> {
  return JSON.parse(Buffer.from(credential.token.split('.')[0], 'base64url').toString());
}
function signed(value: Record<string, unknown>): string {
  const body = Buffer.from(canonical(value)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update('nuni-assistant-task-read-retry\0' + body).digest('base64url');
}
function retry(prepared: Prepared, input: { credential?: AssistantTaskRetry; binding?: Binding; at?: number; stepIds?: string[] } = {}) {
  const credential = input.credential ?? prepared.credential;
  if (!credential) throw new Error('This scenario requires an issued continuation');
  return retryTaskReads({ token: credential.token, stepIds: input.stepIds ?? credential.stepIds,
    binding: input.binding ?? prepared.f.binding, secret, now: input.at ?? now + 1000,
    adapter: prepared.f.adapter, signal: new AbortController().signal });
}
function clearReads(f: Fixture) {
  f.request.mockClear(); f.merchant.mockClear(); f.ledger.mockClear(); f.buyerOrders.mockClear(); f.buyerOrder.mockClear();
}
function noWritesOrBuyerSubstitution(f: Fixture) {
  expect(f.write).not.toHaveBeenCalled();
  expect(f.foodSubmit).not.toHaveBeenCalled();
  expect(f.buyerOrders).not.toHaveBeenCalled();
  expect(f.buyerOrder).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
  expect(f.orderCalls).toEqual([]);
  expect(f.model).not.toHaveBeenCalled();
}

describe('merchant execution and signed task continuations', () => {
  it('issues a v3 identity-only proof after a real queue failure and rereads the original store after another store is inserted', async () => {
    const prepared = await prepare();
    const { f, merchantStep, credential } = prepared;
    expect(merchantStep.status).toBe('partial');
    expect(merchantStep.summary).toContain('待處理訂單來源暫時無法讀取');
    expect(prepared.taskPlan.steps.find(step => step.serviceId === 'cafeteria')?.status).toBe('completed');
    expect(credential?.stepIds).toEqual([merchantStep.id]);
    expect(proof(credential!)).toMatchObject({ version: 3, eventMapSelections: {},
      merchantSelections: { [merchantStep.id]: target } });
    expect(JSON.stringify(proof(credential!))).not.toMatch(/原授權餐坊|PRIVATE-PICKUP|private note|50000|menu-original/);
    expect(prepared.reply.cards).toEqual([]);
    f.sources['merchant-workspaces'] = { workspaces: [added, original] };
    f.sources[originalPath + '/orders'] = { orders: [sourceOrder] };
    clearReads(f);
    const recovered = await retry(prepared);
    expect(f.merchant).toHaveBeenCalledExactlyOnceWith({}, target);
    expect(f.request.mock.calls).toEqual([['merchant-workspaces'], ['realms'], [originalPath + '/orders'], [originalPath + '/shift']]);
    expect(recovered).toMatchObject({ cards: [], modelCalls: 0, dataRead: true, stopReason: '' });
    expect(recovered.taskPlan.steps).toMatchObject([{ id: merchantStep.id, serviceId: 'merchant', status: 'completed' }]);
    expect(recovered.answer).toContain('原授權餐坊');
    expect(recovered.answer).toContain('已付款待接單 1 筆');
    expect(recovered.answer).not.toMatch(/新加入餐坊|PRIVATE-PICKUP|private note/);
    expect(recovered.taskRetry).toBeUndefined();
    expect(f.ledger).not.toHaveBeenCalled();
    noWritesOrBuyerSubstitution(f);
  });

  it('preserves the original identity and expiry through repeated partial read recovery', async () => {
    const prepared = await prepare();
    const { f, credential, merchantStep } = prepared;
    f.sources['merchant-workspaces'] = { workspaces: [added, original] };
    clearReads(f);
    const again = await retry(prepared, { at: now + 120000 });
    expect(again.taskPlan.steps[0].status).toBe('partial');
    expect(again.taskRetry?.expiresAt).toBe(credential!.expiresAt);
    expect(proof(again.taskRetry!).merchantSelections).toEqual({ [merchantStep.id]: target });
    f.sources[originalPath + '/orders'] = { orders: [sourceOrder] };
    clearReads(f);
    const recovered = await retry(prepared, { credential: again.taskRetry, at: now + 240000 });
    expect(recovered.taskPlan.steps[0].status).toBe('completed');
    expect(f.merchant).toHaveBeenCalledExactlyOnceWith({}, target);
    expect(recovered.taskRetry).toBeUndefined();
    noWritesOrBuyerSubstitution(f);
  });

  it('blocks a revoked original store while an independent selected source recovers', async () => {
    const f = fixture();
    const realDining = f.adapter.dining;
    const dining = vi.spyOn(f.adapter, 'dining').mockRejectedValueOnce(new V2Error(503, 'UPSTREAM_UNAVAILABLE'));
    const prepared = await prepare('查我的門市營運，查餐廳', f);
    const diningStep = prepared.taskPlan.steps.find(step => step.serviceId === 'cafeteria')!;
    expect(prepared.credential?.stepIds).toEqual([prepared.merchantStep.id, diningStep.id]);
    f.sources['merchant-workspaces'] = { workspaces: [added] };
    dining.mockImplementation(realDining).mockClear();
    clearReads(f);
    const recovered = await retry(prepared);
    expect(recovered.taskPlan.steps).toMatchObject([
      { id: prepared.merchantStep.id, status: 'blocked' }, { id: diningStep.id, status: 'completed' },
    ]);
    expect(f.request.mock.calls).toEqual([['merchant-workspaces'], ['realms']]);
    expect(dining).toHaveBeenCalledOnce();
    expect(recovered.answer).toContain('合成蔬食餐廳');
    expect(recovered.answer).not.toMatch(/原授權餐坊|新加入餐坊|已付款待接單/);
    expect(proof(recovered.taskRetry!).merchantSelections).toEqual({ [prepared.merchantStep.id]: target });
    noWritesOrBuyerSubstitution(f);
  });

  it('keeps a prepared explicit personal event intact while retrying only the merchant reader', async () => {
    const prepared = await prepare('查我的門市營運，幫我新增行程明天15:00到16:00備料討論');
    const { f, reply, credential, merchantStep } = prepared;
    expect(reply.cards).toHaveLength(1);
    const card = structuredClone(reply.cards[0]);
    expect(card).toMatchObject({ tool: 'propose_personal_event', args: { title: '備料討論', date: '2026-11-05',
      startTime: '15:00', endTime: '16:00' } });
    const eventStep = prepared.taskPlan.steps.find(step => step.cardIds?.includes(card.mutationId))!;
    expect(eventStep.status).toBe('ready');
    expect(credential?.stepIds).toEqual([merchantStep.id]);
    f.sources[originalPath + '/orders'] = { orders: [sourceOrder] };
    f.sources['merchant-workspaces'] = { workspaces: [added, original] };
    clearReads(f);
    const recovered = await retry(prepared);
    expect(recovered).toMatchObject({ cards: [], modelCalls: 0 });
    expect(recovered.taskPlan.steps).toHaveLength(1);
    expect(recovered.taskPlan.steps[0]).toMatchObject({ id: merchantStep.id, status: 'completed' });
    expect(reply.cards).toEqual([card]);
    expect(f.ledger).not.toHaveBeenCalled();
    noWritesOrBuyerSubstitution(f);
    // The original signed preview remains confirmable after the read-only
    // continuation; retry must not revoke, replace or execute it.
    const receipt = await fixtureConfirm(f.binding, card, f.adapter);
    expect(parseAssistantCalendarReceipt(receipt, { schoolId: f.binding.schoolId, mutationId: card.mutationId,
      event: card.args, storage: 'synced' })).toMatchObject({ status: 'verified' });
    expect(f.writes).toHaveLength(1);
    const count = f.write.mock.calls.length;
    await retry(prepared, { at: now + 2000 });
    expect(f.write).toHaveBeenCalledTimes(count);
    expect(f.writes).toHaveLength(1);
    expect(f.orderCalls).toEqual([]);
    expect(f.model).not.toHaveBeenCalled();
  });

  it.each(['signature', 'target', 'account', 'session', 'school', 'conversation'] as const)(
    'rejects changed %s before reading any source', async field => {
      const prepared = await prepare();
      const credential = { ...prepared.credential! };
      let binding = prepared.f.binding;
      if (field === 'signature') {
        const [body, signature] = credential.token.split('.');
        credential.token = body + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
      } else if (field === 'target') {
        const changed = { ...proof(credential), merchantSelections: { [prepared.merchantStep.id]: { ...target, locationId: added.locationId } } };
        credential.token = Buffer.from(canonical(changed)).toString('base64url') + '.' + credential.token.split('.')[1];
      } else {
        const key = field === 'school' ? 'schoolId' : field === 'conversation' ? 'conversationId' : field;
        binding = { ...binding, [key]: 'changed-' + field };
      }
      clearReads(prepared.f);
      await expect(retry(prepared, { credential, binding })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
      expect(prepared.f.request).not.toHaveBeenCalled();
      expect(prepared.f.merchant).not.toHaveBeenCalled();
      noWritesOrBuyerSubstitution(prepared.f);
    });

  it.each(['missing-selection', 'extra-selection-field', 'wrong-step', 'v1-downgrade', 'v2-downgrade'] as const)(
    'rejects a malformed even-server-signed %s proof without source reads', async field => {
      const prepared = await prepare();
      const changed = proof(prepared.credential!);
      if (field === 'missing-selection') changed.merchantSelections = {};
      if (field === 'extra-selection-field') changed.merchantSelections = {
        [prepared.merchantStep.id]: { ...target, account: 'another-person' },
      };
      if (field === 'wrong-step') changed.merchantSelections = { 'task-2': target };
      if (field === 'v1-downgrade') { changed.version = 1; delete changed.merchantSelections; delete changed.eventMapSelections; }
      if (field === 'v2-downgrade') { changed.version = 2; delete changed.merchantSelections; }
      const credential = { ...prepared.credential!, token: signed(changed) };
      clearReads(prepared.f);
      await expect(retry(prepared, { credential })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
      expect(prepared.f.request).not.toHaveBeenCalled();
      expect(prepared.f.merchant).not.toHaveBeenCalled();
      noWritesOrBuyerSubstitution(prepared.f);
    });

  it.each(['multiple', 'unmapped', 'unavailable', 'empty'] as const)(
    'does not issue a merchant retry before the initial %s source has a verified selected identity', async scenario => {
      const f = fixture();
      if (scenario === 'multiple') f.sources['merchant-workspaces'] = { workspaces: [original, added] };
      if (scenario === 'unmapped') f.scopedRealm.mockImplementation(raw => ({ tenantId: String(raw.tenantId) }));
      if (scenario === 'unavailable') f.sources['merchant-workspaces'] = new V2Error(503, 'UPSTREAM_UNAVAILABLE');
      if (scenario === 'empty') f.sources['merchant-workspaces'] = { workspaces: [] };
      const prepared = await prepare('查我的門市營運，查餐廳', f);
      expect(prepared.credential).toBeNull();
      expect(prepared.reply.cards).toEqual([]);
      expect(prepared.taskPlan.steps.find(step => step.serviceId === 'cafeteria')?.status).toBe('completed');
      expect(f.request.mock.calls.some(([path]) => path.endsWith('/orders') || path.endsWith('/shift'))).toBe(false);
      noWritesOrBuyerSubstitution(f);
    });

  it('does not let a selected read token include the prepared event step or outlive its original expiry', async () => {
    const prepared = await prepare('查我的門市營運，幫我新增行程明天15:00到16:00備料討論');
    const eventStep = prepared.taskPlan.steps.find(step => step.cardIds?.length)!;
    clearReads(prepared.f);
    await expect(retry(prepared, { stepIds: [prepared.merchantStep.id, eventStep.id] }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    await expect(retry(prepared, { at: prepared.credential!.expiresAt }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_EXPIRED' });
    expect(prepared.f.request).not.toHaveBeenCalled();
    expect(prepared.f.merchant).not.toHaveBeenCalled();
    noWritesOrBuyerSubstitution(prepared.f);
  });
});
