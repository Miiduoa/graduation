import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ASSISTANT_CALENDAR_BATCH_MAX_BYTES, ASSISTANT_CALENDAR_BATCH_MAX_PLANS,
  AssistantCalendarBatchError, assistantCalendarBatchStorageKey, cancelAssistantCalendarBatchPlan,
  readAssistantCalendarBatchPlans, saveAssistantCalendarBatchPlan, type AssistantCalendarBatchPlan,
} from '../services/assistantCalendarBatchStore';

const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const scope = { owner: 'firebase:A', schoolId: 'pu' };
const key = assistantCalendarBatchStorageKey(scope);
const createdAt = '2026-11-07T12:00:00.000Z';
const plan = (suffix = 'first'): AssistantCalendarBatchPlan => ({
  id: 'batch_plan_' + suffix, ...scope, createdAt,
  steps: [
    { id: 'batch_step_' + suffix + '_1', event: { title: 'Study English ' + suffix, date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' } },
    { id: 'batch_step_' + suffix + '_2', event: { title: 'Review Database ' + suffix, date: '2099-01-03', allDay: false, startTime: '18:00', endTime: '19:00' } },
  ],
});
const copyWithOtherIds = (source: AssistantCalendarBatchPlan): AssistantCalendarBatchPlan => ({
  ...source, id: source.id + '_copy', steps: source.steps.map((step) => ({ ...step, id: step.id + '_copy' })),
});
const envelope = (plans: readonly AssistantCalendarBatchPlan[]) => ({ version: 1, ...scope, plans });
const seed = async (value: unknown) => {
  await originalSet(key, typeof value === 'string' ? value : JSON.stringify(value));
  jest.clearAllMocks();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('an empty scope only reads its own plan store and creates no operation journal', async () => {
  await originalSet('ai_chat_history', 'private chat');
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toEqual([]);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls).toEqual([[key]]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a preview is immutable plan data with an exact independent readback and no operation authority', async () => {
  const source = plan();
  const saved = await saveAssistantCalendarBatchPlan(source, () => true);
  expect(saved).toEqual(source);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls).toEqual([[key], [key]]);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls).toEqual([[key, JSON.stringify(envelope([source]))]]);
  expect(jest.mocked(AsyncStorage.setItem).mock.invocationCallOrder[0])
    .toBeLessThan(jest.mocked(AsyncStorage.getItem).mock.invocationCallOrder[1]);
  const raw = (await originalGet(key))!;
  for (const forbidden of ['mutationId', 'receipt', 'attemptedAt', 'token', 'conversation', 'authorization'])
    expect(raw).not.toContain('"' + forbidden + '"');
  expect(Object.isFrozen(saved)).toBe(true);
  expect(Object.isFrozen(saved.steps[0].event)).toBe(true);
});

test('the same ordered event set reuses the original plan while reversed order is distinct', async () => {
  const first = plan();
  await saveAssistantCalendarBatchPlan(first, () => true);
  expect(await saveAssistantCalendarBatchPlan(copyWithOtherIds(first), () => true)).toEqual(first);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  const reversed = { ...copyWithOtherIds(first), id: 'batch_reverse_order', steps: [...copyWithOtherIds(first).steps].reverse() };
  expect((await saveAssistantCalendarBatchPlan(reversed, () => true)).id).toBe(reversed.id);
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toHaveLength(2);
});

test.each(['location', 'title', 'endDate'] as const)('canonical %s differences cannot silently change a reused preview', async (field) => {
  const first = plan();
  await saveAssistantCalendarBatchPlan(first, () => true);
  const candidate = copyWithOtherIds(first);
  const changed = {
    ...candidate,
    steps: candidate.steps.map((step, index) => index ? step : {
      ...step, event: { ...step.event, [field]: field === 'location' ? '圖書館' : field === 'title' ? step.event.title.toLowerCase() : step.event.date },
    }),
  };
  await expect(saveAssistantCalendarBatchPlan(changed, () => true)).rejects.toMatchObject({ code: 'batch-conflict' });
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toEqual([first]);
});

test('concurrent saves for the same event set persist one plan', async () => {
  const first = plan();
  const saved = await Promise.all([
    saveAssistantCalendarBatchPlan(first, () => true),
    saveAssistantCalendarBatchPlan(copyWithOtherIds(first), () => true),
  ]);
  expect(saved).toEqual([first, first]);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});

test('plan IDs do not authorize replacement of immutable events, step IDs, or creation time', async () => {
  const first = plan();
  await saveAssistantCalendarBatchPlan(first, () => true);
  for (const changed of [
    { ...first, createdAt: '2026-11-08T12:00:00.000Z' },
    { ...first, steps: first.steps.map((step, index) => index ? step : { ...step, id: step.id + '_changed' }) },
    { ...first, steps: first.steps.map((step, index) => index ? step : { ...step, event: { ...step.event, title: 'Changed' } }) },
  ]) await expect(saveAssistantCalendarBatchPlan(changed, () => true)).rejects.toMatchObject({ code: 'batch-corrupt' });
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toEqual([first]);
});

test('cancellation is monotonic, preserves the full plan, and allows a separate newly reviewed plan', async () => {
  const first = plan();
  await saveAssistantCalendarBatchPlan(first, () => true);
  const cancelled = await cancelAssistantCalendarBatchPlan(first.id, scope, () => true);
  expect(cancelled).toEqual({ ...first, cancelledAt: expect.any(String) });
  expect(await cancelAssistantCalendarBatchPlan(first.id, scope, () => true)).toEqual(cancelled);
  expect(await saveAssistantCalendarBatchPlan(first, () => true)).toEqual(cancelled);
  expect(await saveAssistantCalendarBatchPlan({ ...cancelled, cancelledAt: '2026-12-01T00:00:00.000Z' }, () => true)).toEqual(cancelled);
  const next = copyWithOtherIds(first);
  expect(await saveAssistantCalendarBatchPlan(next, () => true)).toEqual(next);
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toEqual([cancelled, next]);
});

test('other Firebase, platform and school identities cannot read or reuse this plan', async () => {
  await saveAssistantCalendarBatchPlan(plan(), () => true);
  for (const other of [
    { owner: 'firebase:B', schoolId: 'pu' }, { owner: 'nuni:A', schoolId: 'pu' },
    { owner: 'nuni:B', schoolId: 'pu' }, { owner: 'firebase:A', schoolId: 'nthu' },
  ]) {
    expect(await readAssistantCalendarBatchPlans(other, () => true)).toEqual([]);
    await expect(cancelAssistantCalendarBatchPlan(plan().id, other, () => true)).rejects.toMatchObject({ code: 'batch-corrupt' });
  }
  const other = { owner: 'nuni:A', schoolId: 'pu' };
  await originalSet(assistantCalendarBatchStorageKey(other), (await originalGet(key))!);
  await expect(readAssistantCalendarBatchPlans(other, () => true)).rejects.toMatchObject({ code: 'batch-corrupt' });
});

test.each([
  '{broken',
  JSON.stringify({ ...envelope([]), version: 2 }),
  JSON.stringify({ ...envelope([]), owner: 'firebase:B' }),
  JSON.stringify({ ...envelope([]), credentials: 'private content' }),
  JSON.stringify(envelope([{ ...plan(), createdAt: '2026-02-30T12:00:00.000Z' }])),
  JSON.stringify(envelope([{ ...plan(), steps: [plan().steps[0]] }])),
  JSON.stringify(envelope([plan(), plan()])),
  JSON.stringify(envelope([plan(), copyWithOtherIds(plan())])),
])('corrupt storage remains untouched instead of becoming an empty list: %#', async (raw) => {
  await seed(raw);
  await expect(readAssistantCalendarBatchPlans(scope, () => true)).rejects.toMatchObject({ code: 'batch-corrupt' });
  await expect(saveAssistantCalendarBatchPlan(plan('new'), () => true)).rejects.toMatchObject({ code: 'batch-corrupt' });
  expect(await originalGet(key)).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('getters and added operation authority fields are rejected without executing or persisting them', () => {
  const source = plan();
  const getter = jest.fn(() => source.owner);
  const poison = { ...source };
  Object.defineProperty(poison, 'owner', { enumerable: true, get: getter });
  expect(() => saveAssistantCalendarBatchPlan(poison, () => true)).toThrow(AssistantCalendarBatchError);
  expect(getter).not.toHaveBeenCalled();
  expect(() => saveAssistantCalendarBatchPlan({ ...source, mutationId: 'hidden_operation' } as AssistantCalendarBatchPlan, () => true))
    .toThrow(AssistantCalendarBatchError);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['read', 'reject', 'saved-reject', 'readback'] as const)('native %s failures are typed and grant no successful save', async (failure) => {
  let wrote = false;
  jest.mocked(AsyncStorage.getItem).mockImplementation((storageKey) => {
    if (failure === 'read') return Promise.reject(new Error('SECRET native payload'));
    if (failure === 'readback' && wrote) return Promise.resolve(null);
    return originalGet(storageKey);
  });
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    if (failure !== 'reject') { await originalSet(storageKey, value); wrote = true; }
    if (failure === 'reject' || failure === 'saved-reject') throw new Error('SECRET quota payload');
  });
  await expect(saveAssistantCalendarBatchPlan(plan(), () => true)).rejects.toMatchObject({
    code: failure === 'read' ? 'batch-unavailable' : 'batch-write-unverified',
    message: expect.not.stringContaining('SECRET'),
  });
});

test('a scope switch during native persistence hides the late response and never writes another owner', async () => {
  let active = true;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value); active = false;
  });
  await expect(saveAssistantCalendarBatchPlan(plan(), () => active)).rejects.toMatchObject({ code: 'session-changed' });
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.map(([storageKey]) => storageKey)).toEqual([key]);
  expect(await readAssistantCalendarBatchPlans({ owner: 'firebase:B', schoolId: 'pu' }, () => true)).toEqual([]);
});

test('full stores preserve all plans and still permit cancellation without silently evicting history', async () => {
  const plans = Array.from({ length: ASSISTANT_CALENDAR_BATCH_MAX_PLANS }, (_, index) => plan(String(index)));
  await seed(envelope(plans));
  await expect(saveAssistantCalendarBatchPlan(plan('overflow'), () => true)).rejects.toMatchObject({ code: 'batch-full' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await cancelAssistantCalendarBatchPlan(plans[0].id, scope, () => true);
  await expect(saveAssistantCalendarBatchPlan(plan('overflow'), () => true)).rejects.toMatchObject({ code: 'batch-full' });
  const stored = await readAssistantCalendarBatchPlans(scope, () => true);
  expect(stored).toHaveLength(ASSISTANT_CALENDAR_BATCH_MAX_PLANS);
  expect(stored.map((item) => item.id)).toEqual(plans.map((item) => item.id));
});

test('oversized UTF-8 content fails closed before JSON parsing', async () => {
  const raw = '中'.repeat(Math.ceil(ASSISTANT_CALENDAR_BATCH_MAX_BYTES / 3) + 1);
  await seed(raw);
  await expect(readAssistantCalendarBatchPlans(scope, () => true)).rejects.toMatchObject({ code: 'batch-full' });
  expect(await originalGet(key)).toBe(raw);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['read', 'write'] as const)('a stalled native %s is bounded and retains serialization after timeout', async (phase) => {
  jest.useFakeTimers();
  const gate = deferred<string | null>();
  if (phase === 'read') jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => gate.promise);
  else jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (storageKey, value) => {
    await originalSet(storageKey, value); await gate.promise;
  });
  const run = saveAssistantCalendarBatchPlan(plan(), () => true);
  const rejection = expect(run).rejects.toMatchObject({ code: 'batch-timeout' });
  await jest.advanceTimersByTimeAsync(20_001);
  await rejection;
  gate.resolve(null);
  await flush();
  expect(await readAssistantCalendarBatchPlans(scope, () => true)).toHaveLength(phase === 'write' ? 1 : 0);
  if (phase === 'read') expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
