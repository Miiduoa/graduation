// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { parseAssistantTaskRetry, type AssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { fixtureAdapter, fixtureBinding, fixtureConfirm, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';
import { retryTaskReads } from './taskRetry';

afterEach(() => vi.restoreAllMocks());

async function prepare(question: string, fixture = fixtureAdapter()) {
  const binding = { ...fixtureBinding, conversationId: 'retry-recovery-' + randomUUID() };
  const model = vi.fn().mockRejectedValue(new Error('A structured read recovery must not call a model'));
  const reply = await run({ question, history: [], binding, adapter: fixture.adapter, secret, now,
    writes: true, signal: new AbortController().signal, model, log: () => {} });
  const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : undefined);
  const credential = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined, plan);
  expect(model).not.toHaveBeenCalled();
  if (!plan || !credential) throw new Error('The fixture must prepare a task plan with a failed read');
  return { binding, fixture, reply, plan, credential, model };
}

function retry(prepared: Awaited<ReturnType<typeof prepare>>, credential: AssistantTaskRetry, at = now + 1000) {
  return retryTaskReads({ token: credential.token, stepIds: credential.stepIds, binding: prepared.binding,
    secret, now: at, adapter: prepared.fixture.adapter, signal: new AbortController().signal });
}

it.each([
  { name: 'fixture ordering enabled', ordering: true, paymentRequired: false, expectedOrders: 1 },
  { name: 'ordering disabled', ordering: false, paymentRequired: false, expectedOrders: 0 },
  { name: 'payment required', ordering: true, paymentRequired: true, expectedOrders: 0 },
])('preserves the original reorder card through read retries and confirmation replay: $name', async ({ ordering, paymentRequired, expectedOrders }) => {
  const fixture = fixtureAdapter(ordering);
  fixture.adapter.food!.paymentRequired = paymentRequired;
  const transit = fixture.adapter.transit;
  const transitRead = vi.spyOn(fixture.adapter, 'transit').mockRejectedValueOnce(new Error('Bus source unavailable'));
  const orders = vi.spyOn(fixture.adapter, 'orders');
  const order = vi.spyOn(fixture.adapter, 'order');
  const menu = vi.spyOn(fixture.adapter.food!, 'menu');
  const submit = vi.spyOn(fixture.adapter.food!, 'submit');
  const prepared = await prepare('跟上次一樣的午餐，查公車', fixture);
  expect(prepared.reply.cards).toHaveLength(1);
  const card = prepared.reply.cards[0], originalCard = structuredClone(card);
  const foodStep = prepared.plan.steps.find(step => step.serviceId === 'food');
  const busStep = prepared.plan.steps.find(step => step.serviceId === 'bus');
  expect(card).toMatchObject({ tool: 'propose_food_order', args: { mode: expectedOrders ? 'order' : 'page' } });
  expect(foodStep).toMatchObject({ status: 'ready', cardIds: [card.mutationId] });
  expect(busStep).toMatchObject({ status: 'blocked' });
  expect(prepared.credential.stepIds).toEqual([busStep!.id]);
  expect(fixture.orderCalls).toHaveLength(0);

  transitRead.mockImplementation(transit).mockClear();
  orders.mockClear();
  order.mockClear();
  menu.mockClear();
  const recovered = await retry(prepared, prepared.credential);
  expect(recovered).toMatchObject({ cards: [], modelCalls: 0, dataRead: true, stopReason: '' });
  expect(recovered.taskPlan.steps).toEqual([
    expect.objectContaining({ id: busStep!.id, serviceId: 'bus', status: 'completed' }),
  ]);
  expect(recovered.taskRetry).toBeUndefined();
  expect(transitRead).toHaveBeenCalledOnce();
  expect(orders).not.toHaveBeenCalled();
  expect(order).not.toHaveBeenCalled();
  expect(menu).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(prepared.reply.cards).toEqual([originalCard]);
  expect(fixture.orderCalls).toHaveLength(0);

  const confirmed = await fixtureConfirm(prepared.binding, originalCard, fixture.adapter);
  const confirmedAgain = await fixtureConfirm(prepared.binding, originalCard, fixture.adapter);
  if (expectedOrders) {
    expect(confirmed).toMatchObject({ confirmed: true, replay: false, mutationId: card.mutationId });
    expect(confirmedAgain).toMatchObject({ confirmed: true, replay: true, mutationId: card.mutationId });
    expect(fixture.orderCalls[0]).toMatchObject({ mutationId: card.mutationId });
  } else {
    expect(confirmed).toMatchObject({ href: card.args.href, reason: card.args.reason });
    expect(confirmedAgain).toEqual(confirmed);
    expect(submit).not.toHaveBeenCalled();
  }
  expect(fixture.orderCalls).toHaveLength(expectedOrders);

  orders.mockClear();
  order.mockClear();
  menu.mockClear();
  submit.mockClear();
  const replayedRead = await retry(prepared, prepared.credential, now + 2000);
  expect(replayedRead.cards).toEqual([]);
  expect(replayedRead.taskPlan.steps).toHaveLength(1);
  expect(replayedRead.taskPlan.steps[0]).toMatchObject({ id: busStep!.id, status: 'completed' });
  expect(orders).not.toHaveBeenCalled();
  expect(order).not.toHaveBeenCalled();
  expect(menu).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(fixture.orderCalls).toHaveLength(expectedOrders);
  expect(fixture.writes).toHaveLength(0);
  expect(prepared.model).not.toHaveBeenCalled();
});

it('renews a newly failed coursework dependency without extending expiry, then recovers both reads', async () => {
  const fixture = fixtureAdapter();
  const readWork = fixture.adapter.work, readMaterials = fixture.adapter.materials;
  const work = vi.spyOn(fixture.adapter, 'work');
  const materials = vi.spyOn(fixture.adapter, 'materials').mockRejectedValueOnce(new Error('Materials unavailable'));
  const dining = vi.spyOn(fixture.adapter, 'dining');
  const prepared = await prepare('查未交作業，找相關教材，查餐廳', fixture);
  const workStep = prepared.plan.steps.find(step => step.label === '查待繳作業與測驗');
  const materialStep = prepared.plan.steps.find(step => step.label === '找課程教材');
  expect(workStep).toMatchObject({ status: 'completed' });
  expect(materialStep).toMatchObject({ status: 'blocked', dependsOn: [workStep!.id] });
  expect(prepared.credential.stepIds).toEqual([materialStep!.id]);
  expect(prepared.reply.cards).toEqual([]);

  work.mockRejectedValue(new Error('Coursework unavailable during retry')).mockClear();
  materials.mockImplementation(readMaterials).mockClear();
  dining.mockClear();
  const failedAgain = await retry(prepared, prepared.credential, now + 120000);
  expect(failedAgain).toMatchObject({ cards: [], modelCalls: 0, dataRead: true, stopReason: 'TASKS_INCOMPLETE' });
  expect(failedAgain.taskPlan.steps).toEqual([
    expect.objectContaining({ id: workStep!.id, status: 'partial', dependsOn: [] }),
    expect.objectContaining({ id: materialStep!.id, status: 'blocked', dependsOn: [workStep!.id] }),
  ]);
  expect(work).toHaveBeenCalledOnce();
  // The old successful coursework result must not authorize a stale material lookup.
  expect(materials).not.toHaveBeenCalled();
  expect(dining).not.toHaveBeenCalled();
  expect(failedAgain.answer).not.toContain('樹與圖講義');
  const renewed = parseAssistantTaskRetry(failedAgain.taskRetry, failedAgain.taskPlan);
  expect(renewed).toMatchObject({ stepIds: [workStep!.id, materialStep!.id], expiresAt: prepared.credential.expiresAt });
  expect(renewed?.token).not.toBe(prepared.credential.token);
  if (!renewed) throw new Error('Both incomplete reads must remain recoverable');

  work.mockImplementation(readWork).mockClear();
  const recovered = await retry(prepared, renewed, now + 240000);
  expect(recovered).toMatchObject({ cards: [], modelCalls: 0, dataRead: true, stopReason: '' });
  expect(recovered.taskPlan.steps).toEqual([
    expect.objectContaining({ id: workStep!.id, status: 'completed', dependsOn: [] }),
    expect.objectContaining({ id: materialStep!.id, status: 'completed', dependsOn: [workStep!.id] }),
  ]);
  expect(recovered.taskRetry).toBeUndefined();
  expect(recovered.answer).toContain('樹與圖講義');
  expect(work).toHaveBeenCalledOnce();
  expect(materials).toHaveBeenCalledExactlyOnceWith('course-a', undefined);
  expect(dining).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.orderCalls).toHaveLength(0);
  expect(prepared.model).not.toHaveBeenCalled();
});
