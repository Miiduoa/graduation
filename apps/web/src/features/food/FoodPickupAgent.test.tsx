import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { readAssistantExecutionJournal, saveAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { readPersonalImports } from '@/lib/personalImports';
import type { V2Card } from '@/features/nuni/assistant/types';
import { FoodPickupAgent } from './FoodPickupAgent';
import { FoodOrderDetail } from './FoodOrders';
import type { FoodClient } from './FoodWorkspace';
import { orderFixture, readyOrder } from './foodTestFixtures';
import { matchesFoodPickupTarget, parseFoodPickupReply } from './foodPickupEvidence';

const environment = vi.hoisted(() => ({ schoolId: 'pu', enabled: true }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: environment.schoolId }),
}));
vi.mock('@/components/AssistantEnabledProvider', () => ({ useAssistantEnabled: () => environment.enabled }));
const context = 'a'.repeat(43);
const props = { context, accountId: 'alice', tenantId: 'campus-a', orderId: 'order-1', available: true, suggestion: '這筆訂單下午取餐，可以預覽行程。' };
const tenantSchoolId = 'campus-a';
const scope = { owner: 'platform:alice', schoolId: tenantSchoolId };
const journalScope = { ...scope, context };
const target = { tenantId: props.tenantId, orderId: props.orderId, durationMinutes: 15 };
const NOW = Date.parse('2026-11-18T11:00:00+08:00');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
function cardFor(orderId = props.orderId, tenantId = props.tenantId, mutationId = 'pickup-mutation-one'): V2Card {
  const body = btoa(JSON.stringify({ v: 2, stage: 'execute', tool: 'propose_personal_event', mutationId,
    pickupGuard: { tenantId, orderId, durationMinutes: 15, fingerprint: 'f'.repeat(64) } })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return { tool: 'propose_personal_event', token: body + '.test-signature', sourceBound: 'food-pickup', mutationId,
    schoolId: tenantSchoolId, destination: '個人行事曆（無推播提醒）',
    args: { title: '取餐：蔬食餐廳', date: '2026-11-18', allDay: false, startTime: '12:00', endTime: '12:15' } };
}
function replyFor(card = cardFor()) {
  return { version: 2, dataRead: true, modelCalls: 0, simulation: false, pickupTarget: target,
    answer: '已核對這筆訂單的取餐時間與課表，請確認安排。',
    steps: [{ name: 'get_food_order', status: 'ok', summary: '已核對選定訂單' }], cards: [card], expiresAt: Date.now() + 300000 };
}
const receiptFor = (card = cardFor(), replay = false) => createAssistantCalendarReceipt({
  schoolId: card.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced', revision: 1,
  verifiedAt: new Date(NOW + 1000).toISOString(), replay,
  record: { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events', schoolId: card.schoolId,
    academicYear: '', semester: '', importedAt: new Date(NOW).toISOString(), source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } },
});
const checkFor = (status: 'absent' | 'conflict' | 'revoked', retryable = false, card = cardFor()) => ({
  version: 1, operation: 'calendar.create', status, schoolId: card.schoolId, mutationId: card.mutationId,
  storage: 'synced', revision: 0, checkedAt: new Date(NOW + 1000).toISOString(), authorizationValid: retryable,
  retryable, ...(status === 'revoked' ? { alreadyRevoked: false } : {}),
});
type Call = { action: string; body: Record<string, unknown>; signal?: AbortSignal | null };
function api(handle?: (call: Call) => Promise<Response> | Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { action: url.split('/').at(-1)!, body: init?.body ? JSON.parse(String(init.body)) : {}, signal: init?.signal };
    calls.push(call);
    const handled = handle?.(call);
    if (handled) return handled;
    if (call.action === 'capability') return json({ enabled: true, version: 2, planning: true, writesEnabled: true, ready: false });
    if (call.action === 'pickup-plan') return call.body.routeToken ? json(replyFor())
      : json({ bootstrap: true, conversationId: 'pickup-conversation', routeToken: 'pickup-route' });
    throw new Error('Unexpected ' + call.action);
  }));
  return { calls, actions: () => calls.map(call => call.action) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function preview() {
  const button = await screen.findByRole('button', { name: '預覽這筆取餐安排' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  return screen.findByRole('button', { name: '確認' });
}
beforeEach(() => {
  environment.enabled = true; environment.schoolId = 'pu';
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  localStorage.clear(); sessionStorage.clear();
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (key: string, work: () => unknown) => {
      const next = (queues.get(key) || Promise.resolve()).then(work);
      queues.set(key, next.catch(() => {})); return next;
    },
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('previews the exact selected source without model consent, customer details or any write', async () => {
  const { calls, actions } = api();
  render(<FoodPickupAgent {...props} />);
  expect(actions()).toEqual([]);
  await preview();
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
  for (const call of calls.filter(call => call.action === 'pickup-plan')) {
    expect(call.body).toMatchObject({ schoolId: tenantSchoolId, target });
    expect(Object.keys(call.body)).not.toEqual(expect.arrayContaining(['question', 'history', 'consent', 'title', 'requestedPickupAt', 'location']));
  }
  expect(calls[2].body).toMatchObject({ conversationId: 'pickup-conversation', routeToken: 'pickup-route' });
  expect(readPersonalImports(scope)).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('stores original proof before one confirmed write and mirrors a strictly verified receipt', async () => {
  const pending = deferred<Response>();
  let proofAtDispatch: unknown;
  const { actions } = api(call => {
    if (call.action === 'confirm') { proofAtDispatch = readAssistantExecutionJournal(journalScope); return pending.promise; }
  });
  render(<FoodPickupAgent {...props} />);
  const button = await preview();
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(actions().filter(value => value === 'confirm')).toHaveLength(1));
  expect(proofAtDispatch).toMatchObject([{ conversationId: 'pickup-conversation', card: { token: cardFor().token, sourceBound: 'food-pickup' } }]);
  await act(async () => pending.resolve(json(receiptFor())));
  await screen.findByText('已核對並加入個人行事曆');
  expect(readPersonalImports(scope)).toHaveLength(1);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(screen.getByRole('link', { name: '開啟這筆行程' }).getAttribute('href')).toContain('eventId=pickup-mutation-one');
});

it('recovers only this order after reload by reading the original proof, never writing again', async () => {
  const card = cardFor();
  saveAssistantExecutionJournal(journalScope, { conversationId: 'prior-conversation', card }, () => true);
  const { calls, actions } = api(call => call.action === 'reconcile' ? json(receiptFor(card, true)) : undefined);
  render(<FoodPickupAgent {...props} />);
  await screen.findByText('已核對並加入個人行事曆');
  expect(actions()).toEqual(['reconcile', 'capability']);
  expect(calls[0].body).toMatchObject({ conversationId: 'prior-conversation', token: card.token, args: card.args });
  expect(readPersonalImports(scope)).toHaveLength(1);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('keeps unrelated pending proofs untouched and does not read or retry another order', async () => {
  const other = cardFor('other-order', 'other-tenant', 'other-mutation-one');
  saveAssistantExecutionJournal(journalScope, { conversationId: 'other-conversation', card: other }, () => true);
  const { actions } = api();
  render(<FoodPickupAgent {...props} />);
  await screen.findByRole('link', { name: '前往助理核對原操作' });
  await waitFor(() => expect(actions()).toEqual(['capability']));
  expect((screen.getByRole('button', { name: '預覽這筆取餐安排' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('article', { name: '行程確認卡' })).toBeNull();
  expect(readAssistantExecutionJournal(journalScope)[0].card).toEqual(other);
});

it('does not let unrelated coursework recovery become a selected pickup action', async () => {
  const other = cardFor();
  delete other.sourceBound;
  saveAssistantExecutionJournal(journalScope, { conversationId: 'study-conversation', card: other }, () => true);
  const { actions } = api();
  render(<FoodPickupAgent {...props} />);
  await screen.findByRole('link', { name: '前往助理核對原操作' });
  expect(actions()).toEqual(['capability']);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
});

it('reconciles an uncertain write and never silently retries confirmation', async () => {
  const { actions } = api(call => {
    if (call.action === 'confirm') return Promise.reject(new Error('lost response'));
    if (call.action === 'reconcile') return Promise.reject(new Error('offline'));
  });
  render(<FoodPickupAgent {...props} />);
  fireEvent.click(await preview());
  await screen.findByText('執行結果尚未確認，請核對原操作，避免重複新增。');
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan', 'confirm', 'reconcile']);
  expect(screen.queryByRole('button', { name: '重試原確認' })).toBeNull();
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(readPersonalImports(scope)).toEqual([]);
});

it('stops a source changed proposal only after the original result is read as absent', async () => {
  const { actions } = api(call => {
    if (call.action === 'confirm') return json({ error: 'FOOD_PICKUP_CHANGED' }, 409);
    if (call.action === 'reconcile') return json(checkFor('absent'));
    if (call.action === 'cancel') return json(checkFor('revoked'));
  });
  render(<FoodPickupAgent {...props} />);
  fireEvent.click(await preview());
  fireEvent.click(await screen.findByRole('button', { name: '停止這份未完成安排' }));
  await screen.findByText('已撤銷未執行提議');
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan', 'confirm', 'reconcile', 'cancel']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
  expect(readPersonalImports(scope)).toEqual([]);
});

it('cancels an undispatched preview locally without creating or cancelling an order', async () => {
  const { actions } = api();
  render(<FoodPickupAgent {...props} />);
  await preview(); fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await screen.findByText('已撤銷未執行提議');
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
  expect(readPersonalImports(scope)).toEqual([]);
});

it.each([
  { enabled: false, version: 2, planning: true, writesEnabled: true },
  { enabled: true, version: 1, planning: true, writesEnabled: true },
  { enabled: true, version: 2, planning: false, writesEnabled: true },
  { enabled: true, version: 2, planning: true, writesEnabled: false },
])('requires an enabled exact V2 planning and writing capability: %j', async capability => {
  const { actions } = api(call => call.action === 'capability' ? json(capability) : undefined);
  render(<FoodPickupAgent {...props} />);
  await waitFor(() => expect(actions()).toEqual(['capability']));
  expect((screen.getByRole('button', { name: '預覽這筆取餐安排' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '預覽這筆取餐安排' }));
  expect(actions()).toEqual(['capability']);
});

it.each(['account', 'session', 'order', 'tenant'] as const)('aborts late selected-plan results after changing %s', async changed => {
  const pending = deferred<Response>();
  const { calls } = api(call => call.action === 'pickup-plan' && call.body.routeToken ? pending.promise : undefined);
  const view = render(<FoodPickupAgent {...props} />);
  const button = await screen.findByRole('button', { name: '預覽這筆取餐安排' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(calls).toHaveLength(3));
  view.rerender(<FoodPickupAgent {...props}
    {...(changed === 'account' ? { accountId: 'bob' } : changed === 'session' ? { context: 'b'.repeat(43) }
      : changed === 'order' ? { orderId: 'order-two' } : { tenantId: 'campus-two' })} />);
  expect(calls[2].signal?.aborted).toBe(true);
  await act(async () => pending.resolve(json(replyFor())));
  expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
  expect(readPersonalImports(scope)).toEqual([]);
});

it('plans against the order tenant school even when the browsing campus differs', async () => {
  environment.schoolId = 'nthu';
  const { calls } = api();
  render(<FoodPickupAgent {...props} />);
  await preview();
  for (const call of calls.filter(call => call.action === 'pickup-plan')) {
    expect(call.body).toMatchObject({ schoolId: tenantSchoolId, target });
  }
  expect(calls.some(call => call.body.schoolId === 'nthu')).toBe(false);
});

it('keeps a late selected-plan result when only the browsing campus changes', async () => {
  const pending = deferred<Response>();
  const { calls } = api(call => call.action === 'pickup-plan' && call.body.routeToken ? pending.promise : undefined);
  const view = render(<FoodPickupAgent {...props} />);
  const button = await screen.findByRole('button', { name: '預覽這筆取餐安排' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(calls).toHaveLength(3));
  environment.schoolId = 'nthu';
  view.rerender(<FoodPickupAgent {...props} />);
  expect(calls[2].signal?.aborted).toBe(false);
  await act(async () => pending.resolve(json(replyFor())));
  expect(await screen.findByRole('button', { name: '確認' })).toBeTruthy();
});

it('rejects mismatched target, unsigned-looking source and model-driven replies before confirmation', () => {
  const raw = replyFor();
  for (const value of [
    { ...raw, pickupTarget: { ...target, orderId: 'other' } },
    { ...raw, pickupTarget: { ...target, tenantId: 'other' } },
    { ...raw, modelCalls: 1 },
    { ...raw, simulation: true },
    { ...raw, cards: [{ ...cardFor(), token: 'opaque.token' }] },
    { ...raw, cards: [cardFor('other')] },
    { ...raw, cards: [{ ...cardFor(), sourceBound: undefined }] },
  ]) expect(() => parseFoodPickupReply(value, tenantSchoolId, 'conversation', target)).toThrow();
  expect(matchesFoodPickupTarget(cardFor('other'), target)).toBe(false);
  expect(parseFoodPickupReply(raw, tenantSchoolId, 'conversation', target).cards[0].conversationId).toBe('conversation');
});

it('preserves unknown results when a receipt does not match the reviewed event', async () => {
  const wrong = receiptFor({ ...cardFor(), args: { ...cardFor().args, title: '其他行程' } });
  const { actions } = api(call => ['confirm', 'reconcile'].includes(call.action) ? json(wrong) : undefined);
  render(<FoodPickupAgent {...props} />);
  fireEvent.click(await preview());
  await screen.findByText('執行結果尚未確認，請核對原操作，避免重複新增。');
  expect(readPersonalImports(scope)).toEqual([]);
  expect(readAssistantExecutionJournal(journalScope)).toHaveLength(1);
  expect(actions().filter(value => value === 'confirm')).toHaveLength(1);
});

it('does not dispatch a write when the original proof cannot be retained', async () => {
  const { actions } = api();
  render(<FoodPickupAgent {...props} />);
  const button = await preview();
  const storage: Storage = Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage);
  const original = storage.setItem;
  vi.spyOn(storage, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('campus.assistant-execution.v1:')) throw new Error('disk full');
    return original.call(this, key, value);
  });
  fireEvent.click(button);
  await screen.findByText(/待核對行程未能保留/);
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
  expect(readPersonalImports(scope)).toEqual([]);
});

it('retires an expired never-dispatched preview before any confirmation', async () => {
  const { actions } = api();
  render(<FoodPickupAgent {...props} />);
  const button = await preview();
  vi.mocked(Date.now).mockReturnValue(NOW + 300001);
  fireEvent.click(button);
  await screen.findByText('這份預覽已過期，請重新核對取餐時間。');
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
  expect(readAssistantExecutionJournal(journalScope)).toEqual([]);
});

it('hides invalid or disabled account scopes without any source request', async () => {
  const { actions } = api();
  const view = render(<FoodPickupAgent {...props} context="invalid" />);
  await act(async () => {});
  expect(screen.queryByRole('region', { name: '取餐行程安排' })).toBeNull();
  environment.enabled = false;
  view.rerender(<FoodPickupAgent {...props} />);
  await act(async () => {});
  expect(actions()).toEqual([]);
});

it('disables a new confirmation when the order becomes unavailable while retaining cancellation', async () => {
  const { actions } = api();
  const view = render(<FoodPickupAgent {...props} />);
  await preview();
  view.rerender(<FoodPickupAgent {...props} available={false} />);
  const confirm = screen.getByRole('button', { name: '確認' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(confirm);
  const cancel = screen.getByRole('button', { name: '取消' });
  expect((cancel as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(cancel);
  await screen.findByText('已撤銷未執行提議');
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
});

it('detects an unrelated pending write added after preview and blocks this confirmation', async () => {
  const { actions } = api();
  render(<FoodPickupAgent {...props} />);
  const confirm = await preview();
  saveAssistantExecutionJournal(journalScope, { conversationId: 'other-conversation',
    card: cardFor('order-2', 'campus-a', 'pickup-other-source') }, () => true);
  fireEvent.click(confirm);
  await screen.findByRole('link', { name: '前往助理核對原操作' });
  expect((screen.getByRole('button', { name: '確認' }) as HTMLButtonElement).disabled).toBe(true);
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
  expect(readPersonalImports(scope)).toEqual([]);
});

it('allows read-only recovery when writing is disabled and hides new duration selection for the original card', async () => {
  const card = cardFor();
  saveAssistantExecutionJournal(journalScope, { conversationId: 'prior-conversation', card }, () => true);
  const { actions } = api(call => {
    if (call.action === 'reconcile') return json(checkFor('absent', true));
    if (call.action === 'capability') return json({ enabled: true, version: 2, planning: true, writesEnabled: false });
  });
  render(<FoodPickupAgent {...props} />);
  await screen.findByText('目前未開放儲存行程，先前結果仍可核對。');
  expect((screen.getByRole('button', { name: '重試原確認' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '重新核對結果' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByLabelText('取餐預留時間')).toBeNull();
  expect(actions()).toEqual(['reconcile', 'capability']);
});

it('uses the actual selected order detail as the cross-feature entry point', async () => {
  const order = { ...orderFixture(), state: 'accepted' as const, allowedActions: [] };
  const client = { getOrder: vi.fn().mockResolvedValue(order) } as unknown as FoodClient;
  const { calls } = api();
  render(<FoodOrderDetail client={client} cache={new Map()} accountId={props.accountId} context={context}
    tenantId={props.tenantId} orderId={props.orderId} onChange={async () => {}} onBack={() => {}} />);
  const suggestion = await screen.findByRole('region', { name: 'nuni 建議' });
  expect(suggestion.textContent).toContain(order.locationName);
  expect(suggestion.textContent).toContain('20:00');
  fireEvent.click(within(suggestion).getByRole('button', { name: '預覽這筆取餐安排' }));
  await screen.findByRole('button', { name: '確認' });
  expect(client.getOrder).toHaveBeenCalledWith(props.tenantId, props.orderId);
  expect(calls.filter(call => call.action === 'pickup-plan')).toHaveLength(2);
  expect(calls.at(-1)?.body.target).toEqual(target);
  expect(screen.getByRole('region', { name: '訂單詳情' })).toBeTruthy();
  expect(screen.getByRole('article', { name: '行程確認卡' })).toBeTruthy();
});

it('uses the ready order suggestion to show its valid credential locally in a single click', async () => {
  environment.enabled = false;
  const order = readyOrder();
  const client = { getOrder: vi.fn().mockResolvedValue(order) } as unknown as FoodClient;
  const { actions } = api();
  render(<FoodOrderDetail client={client} cache={new Map()} accountId={props.accountId} context={context}
    tenantId={props.tenantId} orderId={order.id} onChange={async () => {}} onBack={() => {}} />);

  const suggestion = await screen.findByRole('region', { name: 'nuni 建議' });
  expect(suggestion.textContent).toContain(order.locationName);
  expect(screen.queryByText(order.pickup.credential!.token)).toBeNull();
  expect(screen.queryByRole('button', { name: '預覽這筆取餐安排' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '出示取餐憑證' })).toHaveLength(1);
  fireEvent.click(within(suggestion).getByRole('button', { name: '出示取餐憑證' }));
  expect(within(suggestion).getByLabelText('一次性取餐憑證').textContent).toBe(order.pickup.credential!.token);
  expect(actions()).toEqual([]);
});

it('refreshes the same ready order in place when its credential has expired', async () => {
  const order = readyOrder();
  const expired = { ...order, pickup: { ...order.pickup, credential: { ...order.pickup.credential!, expiresAt: new Date(NOW).toISOString() } } };
  const getOrder = vi.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(order);
  const client = { getOrder } as unknown as FoodClient;
  api();
  render(<FoodOrderDetail client={client} cache={new Map()} accountId={props.accountId} context={context}
    tenantId={props.tenantId} orderId={order.id} onChange={async () => {}} onBack={() => {}} />);

  const suggestion = await screen.findByRole('region', { name: 'nuni 建議' });
  expect(screen.queryByRole('button', { name: '出示取餐憑證' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '更新這筆訂單' })).toHaveLength(1);
  fireEvent.click(within(suggestion).getByRole('button', { name: '更新這筆訂單' }));
  await screen.findByRole('button', { name: '出示取餐憑證' });
  expect(getOrder.mock.calls).toEqual([[props.tenantId, order.id], [props.tenantId, order.id]]);
  expect(screen.queryByText(order.pickup.credential!.token)).toBeNull();
});

it.each(['past', 'fulfilled', 'disabled'] as const)('omits the schedule suggestion when %s', async kind => {
  environment.enabled = kind !== 'disabled';
  const order = { ...orderFixture(), state: kind === 'fulfilled' ? 'fulfilled' : 'accepted',
    requestedPickupAt: kind === 'past' ? new Date(NOW - 1).toISOString() : orderFixture().requestedPickupAt };
  const client = { getOrder: vi.fn().mockResolvedValue(order) } as unknown as FoodClient;
  api();
  render(<FoodOrderDetail client={client} cache={new Map()} accountId={props.accountId} context={context}
    tenantId={props.tenantId} orderId={order.id} onChange={async () => {}} onBack={() => {}} />);

  await screen.findByRole('heading', { name: /米飯店 ·/ });
  expect(screen.queryByRole('region', { name: 'nuni 建議' })).toBeNull();
  expect(screen.queryByRole('button', { name: '預覽這筆取餐安排' })).toBeNull();
});

it('replaces the planning suggestion with pickup when the selected order becomes ready', async () => {
  const initial = { ...orderFixture(), state: 'preparing' };
  const getOrder = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(readyOrder());
  const client = { getOrder } as unknown as FoodClient;
  const { actions } = api();
  render(<FoodOrderDetail client={client} cache={new Map()} accountId={props.accountId} context={context}
    tenantId={props.tenantId} orderId={initial.id} onChange={async () => {}} onBack={() => {}} />);
  const first = await screen.findByRole('region', { name: 'nuni 建議' });
  expect(within(first).getByRole('button', { name: '預覽這筆取餐安排' })).toBeTruthy();

  fireEvent(document, new Event('visibilitychange'));
  await screen.findByRole('button', { name: '出示取餐憑證' });
  const suggestion = screen.getByRole('region', { name: 'nuni 建議' });
  expect(within(suggestion).getAllByRole('button').map(button => button.textContent)).toEqual(['出示取餐憑證']);
  const optionalPlan = screen.getByText('安排稍後取餐的時間').closest('details')!;
  expect(optionalPlan.open).toBe(false);
  fireEvent.click(within(optionalPlan).getByText('安排稍後取餐的時間'));
  expect(optionalPlan.open).toBe(true);
  fireEvent.click(within(optionalPlan).getByRole('button', { name: '預覽這筆取餐安排' }));
  await screen.findByRole('button', { name: '確認' });
  expect(actions()).toEqual(['capability', 'pickup-plan', 'pickup-plan']);
});
