import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AssistantCalendarEvent } from '@campus/shared/src/assistantExecution';
import {
  cancelRemainingAssistantCalendarBatch, confirmAssistantCalendarBatch, prepareAssistantCalendarBatch,
  recheckAssistantCalendarBatch, restoreAssistantCalendarBatches, restoreAssistantCalendarWorkspace,
  updateAssistantCalendarBatchTask, type AssistantCalendarBatchView,
} from '../services/assistantCalendarBatchExecution';
import { assistantCalendarBatchStorageKey, readAssistantCalendarBatchPlans } from '../services/assistantCalendarBatchStore';
import {
  confirmAssistantCalendarTask, createAssistantCalendarTask, type AssistantCalendarContext, type AssistantCalendarTask,
} from '../services/assistantCalendarExecution';
import { assistantCalendarJournalStorageKey, readAssistantCalendarJournal } from '../services/assistantCalendarJournal';
import { deletePersonalImport, loadPersonalImports, personalImportStorageKey } from '../services/personalImports';

let mockUid = 'A';
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  isFirebaseMockMode: () => false,
}));
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const scope = { owner: 'firebase:A', schoolId: 'pu' };
const ledgerKey = personalImportStorageKey(scope);
const journalKey = assistantCalendarJournalStorageKey(scope);
const batchKey = assistantCalendarBatchStorageKey(scope);
const context = (): AssistantCalendarContext => ({ uid: 'A', schoolId: 'pu', isCurrent: () => true });
const events = [
  { title: '英文讀書', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' },
  { title: '資料庫複習', date: '2099-01-03', allDay: false, startTime: '19:00', endTime: '20:00' },
  { title: '統計練習', date: '2099-01-04', allDay: false, startTime: '19:00', endTime: '20:00' },
];
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === ledgerKey);
const ledgerReads = () => jest.mocked(AsyncStorage.getItem).mock.calls.filter(([key]) => key === ledgerKey);
const seedOperation = async (event: AssistantCalendarEvent = events[0]) => {
  const task = createAssistantCalendarTask(event, context());
  const result = await confirmAssistantCalendarTask(task.proposal, context());
  if (result.state !== 'verified') throw new Error('Missing seeded receipt');
  return result;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let index = 0; index < 80; index++) await Promise.resolve(); };

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUid = 'A';
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('prepare persists only the reviewed plan and restores all steps without minting operations', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  expect(prepared).toMatchObject({ state: 'review', progress: { verified: 0, total: 3, notStarted: 3 } });
  expect(prepared.plan.steps.map((step) => step.event)).toEqual(events);
  expect(ledgerWrites()).toHaveLength(0);
  expect(ledgerReads()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toEqual([]);
  const raw = (await originalGet(batchKey))!;
  expect(raw).not.toMatch(/mutationId|attemptedAt|receipt|authorization/);
  const restored = await restoreAssistantCalendarBatches(context());
  expect(restored).toEqual([prepared]);
  expect(ledgerWrites()).toHaveLength(0);
});

test('one explicit confirmation writes in order, holds the UI lock between steps, and recovers receipts read-only', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const updates: AssistantCalendarBatchView[] = [];
  const done = await confirmAssistantCalendarBatch(prepared.plan, context(), { onUpdate: (view) => updates.push(view) });
  expect(done).toMatchObject({ state: 'completed', progress: { verified: 3, total: 3, notStarted: 0 } });
  expect(updates.slice(0, -1).every((view) => view.state === 'running' || view.state === 'completed')).toBe(true);
  expect(updates[0].state).toBe('running');
  expect(ledgerWrites().map(([, raw]) => JSON.parse(raw).records.at(-1).title)).toEqual(events.map((event) => event.title));
  const ids = done.steps.map((step) => step.state === 'recorded' ? step.task.proposal.mutationId : '');
  expect(new Set(ids).size).toBe(3);
  jest.clearAllMocks();
  const restored = (await restoreAssistantCalendarBatches(context()))[0];
  expect(restored.progress.verified).toBe(3);
  expect(restored.steps.map((step) => step.state === 'recorded' ? step.task.proposal.mutationId : '')).toEqual(ids);
  expect(ledgerWrites()).toHaveLength(0);
});

test('an unknown second write stops the third; late commit is rechecked and only a new confirmation writes the remainder', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  let dispatches = 0;
  let lateLedger = '';
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === ledgerKey && ++dispatches === 2) { lateLedger = value; throw new Error('native result unknown'); }
    await originalSet(key, value);
  });
  const paused = await confirmAssistantCalendarBatch(prepared.plan, context());
  expect(paused).toMatchObject({ state: 'paused', progress: { verified: 1, notStarted: 1 },
    steps: [{ state: 'recorded', task: { state: 'verified' } }, { state: 'recorded', task: { state: 'unknown' } }, { state: 'not-started' }] });
  const originalIds = (await readAssistantCalendarJournal(scope, () => true)).map((entry) => entry.proposal.mutationId);
  expect(originalIds).toHaveLength(2);
  expect((await confirmAssistantCalendarBatch(prepared.plan, context())).state).toBe('paused');
  expect(dispatches).toBe(2);
  await originalSet(ledgerKey, lateLedger);
  const checked = await recheckAssistantCalendarBatch(prepared.plan, context());
  expect(checked).toMatchObject({ state: 'review', progress: { verified: 2, notStarted: 1 } });
  expect(dispatches).toBe(2);
  const completed = await confirmAssistantCalendarBatch(prepared.plan, context());
  expect(completed.state).toBe('completed');
  expect(dispatches).toBe(3);
  expect((await readAssistantCalendarJournal(scope, () => true)).slice(0, 2).map((entry) => entry.proposal.mutationId)).toEqual(originalIds);
});

test('a saved-then-rejected native response can continue only after the original single executor verifies it', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  let writes = 0;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === ledgerKey && ++writes === 2) throw new Error('response lost after persistence');
  });
  expect(await confirmAssistantCalendarBatch(prepared.plan, context())).toMatchObject({ state: 'completed', progress: { verified: 3 } });
  expect(writes).toBe(3);
  expect((await loadPersonalImports(scope)).records).toHaveLength(3);
});

test('a receipt persistence warning preserves verified progress but stops all later dispatch', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  let journalWrites = 0;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === journalKey && ++journalWrites === 2) throw new Error('observation quota unavailable');
    await originalSet(key, value);
  });
  const paused = await confirmAssistantCalendarBatch(prepared.plan, context());
  expect(paused).toMatchObject({ state: 'paused', stop: { reason: 'warning' }, progress: { verified: 1, notStarted: 2 },
    steps: [{ state: 'recorded', task: { state: 'verified', receipt: { status: 'verified' }, warning: expect.any(String) } },
      { state: 'not-started' }, { state: 'not-started' }] });
  expect(ledgerWrites()).toHaveLength(1);
});

test('all pending events are preflighted before the first write, including a conflict in a later step', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const conflict = {
    ...events[2], title: '其他已存在的行程', startTime: '19:30', endTime: '20:30',
    id: 'manual_existing_row', batchId: 'manual_existing_batch', kind: 'events', schoolId: 'pu',
    academicYear: '', semester: '', importedAt: '2026-11-07T12:00:00.000Z',
    source: { type: 'paste', line: 1, rawText: '' },
  };
  await originalSet(ledgerKey, JSON.stringify({ version: 1, records: [conflict],
    batches: [{ id: conflict.batchId, createdAt: conflict.importedAt, count: 1 }] }));
  jest.clearAllMocks();
  expect(await confirmAssistantCalendarBatch(prepared.plan, context()))
    .toMatchObject({ state: 'paused', stop: { reason: 'preflight', message: expect.stringContaining('重疊') } });
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toEqual([]);
});

test('completed past steps do not prevent a newly confirmed continuation of future steps', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2099-01-02T10:00:00.000Z'));
  const prepared = await prepareAssistantCalendarBatch(events, context());
  await seedOperation();
  jest.setSystemTime(new Date('2099-01-03T10:00:00.000Z'));
  jest.clearAllMocks();
  const continued = await confirmAssistantCalendarBatch(prepared.plan, context());
  expect(continued).toMatchObject({ state: 'completed', progress: { verified: 3 } });
  expect(ledgerWrites()).toHaveLength(2);
  expect(ledgerWrites().map(([, value]) => JSON.parse(value).records.at(-1).title)).toEqual(events.slice(1).map((event) => event.title));
});

test('a later read failure never claims that an already saved first event was rolled back', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) =>
    key === batchKey && ledgerWrites().length ? Promise.reject(new Error('SECRET native message')) : originalGet(key));
  const paused = await confirmAssistantCalendarBatch(prepared.plan, context());
  expect(paused).toMatchObject({ state: 'paused', progress: { verified: 1, notStarted: 2 },
    stop: { reason: 'unavailable', message: expect.stringContaining('已保存的行程') } });
  expect(paused.stop?.message).not.toMatch(/這次不會新增行程|SECRET/);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('a changed immutable payload or missing persisted plan cannot be confirmed using only a matching ID', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const changed = { ...prepared.plan, steps: prepared.plan.steps.map((step, index) => index ? step : {
    ...step, event: { ...step.event, location: '未檢視的新地點' },
  }) };
  await expect(confirmAssistantCalendarBatch(changed, context())).rejects.toMatchObject({ code: 'batch-corrupt' });
  await AsyncStorage.removeItem(batchKey);
  await expect(confirmAssistantCalendarBatch(prepared.plan, context())).rejects.toMatchObject({ code: 'batch-corrupt' });
  expect(ledgerWrites()).toHaveLength(0);
});

test('a cancelled partial plan retains completed receipts and cannot be resumed through a stale uncancelled view', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const first = await seedOperation();
  jest.clearAllMocks();
  const cancelled = await cancelRemainingAssistantCalendarBatch(prepared.plan, context());
  expect(cancelled).toMatchObject({ state: 'cancelled', progress: { verified: 1, notStarted: 2 }, plan: { cancelledAt: expect.any(String) } });
  expect((await confirmAssistantCalendarBatch(prepared.plan, context())).state).toBe('cancelled');
  expect((await loadPersonalImports(scope)).records[0].id).toBe(first.proposal.mutationId);
  expect(ledgerWrites()).toHaveLength(0);
});

test('abort fences pending work, rejects a concurrent run, and never publishes a late native response', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const gate = deferred<void>();
  const entered = deferred<void>();
  const updates: AssistantCalendarBatchView[] = [];
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === ledgerKey) { entered.resolve(); await gate.promise; }
  });
  const controller = new AbortController();
  const run = confirmAssistantCalendarBatch(prepared.plan, context(), { signal: controller.signal, onUpdate: (view) => updates.push(view) });
  await entered.promise;
  await expect(confirmAssistantCalendarBatch(prepared.plan, context())).rejects.toMatchObject({ code: 'batch-busy' });
  controller.abort();
  const stopped = await run;
  expect(stopped).toMatchObject({ state: 'paused', stop: { reason: 'aborted' }, progress: { notStarted: 2 },
    steps: [{ state: 'recorded', task: { state: 'unknown' } }, { state: 'not-started' }, { state: 'not-started' }] });
  const published = updates.length;
  gate.resolve();
  await flush();
  expect(updates).toHaveLength(published);
  expect(ledgerWrites()).toHaveLength(1);
  expect((await readAssistantCalendarBatchPlans(scope, () => true))[0].cancelledAt).toBeUndefined();
  const checked = await recheckAssistantCalendarBatch(prepared.plan, context());
  expect(checked).toMatchObject({ state: 'review', progress: { verified: 1, notStarted: 2 } });
  expect(ledgerWrites()).toHaveLength(1);
});

test('persisting cancellation fences the active run before waiting for its current native write', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const gate = deferred<void>();
  const entered = deferred<void>();
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === ledgerKey) { entered.resolve(); await gate.promise; }
  });
  const run = confirmAssistantCalendarBatch(prepared.plan, context());
  await entered.promise;
  const cancellation = cancelRemainingAssistantCalendarBatch(prepared.plan, context());
  await flush();
  expect(JSON.parse((await originalGet(batchKey))!).plans[0].cancelledAt).toEqual(expect.any(String));
  gate.resolve();
  const [stopped, cancelled] = await Promise.all([run, cancellation]);
  expect(stopped.state).toBe('paused');
  expect(cancelled).toMatchObject({ state: 'cancelled', progress: { verified: 1, notStarted: 2 } });
  expect(ledgerWrites()).toHaveLength(1);
});

test('an owner change after dispatch cannot publish an old result or start another step', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const updates: AssistantCalendarBatchView[] = [];
  let publishedBeforeSwitch = 0;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === ledgerKey) { publishedBeforeSwitch = updates.length; mockUid = 'B'; }
  });
  await expect(confirmAssistantCalendarBatch(prepared.plan, context(), { onUpdate: (view) => updates.push(view) }))
    .rejects.toMatchObject({ code: 'session-changed' });
  expect(updates).toHaveLength(publishedBeforeSwitch);
  expect(ledgerWrites()).toHaveLength(1);
  expect((await loadPersonalImports({ owner: 'firebase:B', schoolId: 'pu' })).records).toEqual([]);
});

test('canonical identity does not falsely complete a different reviewed location or overwrite the original event', async () => {
  const requested = [{ ...events[0], location: '教室' }, events[1]];
  const prepared = await prepareAssistantCalendarBatch(requested, context());
  const actual = await seedOperation({ ...events[0], location: '圖書館' });
  jest.clearAllMocks();
  const projected = updateAssistantCalendarBatchTask(prepared, actual);
  expect(projected).toMatchObject({ state: 'paused', progress: { verified: 0, notStarted: 1 },
    steps: [{ state: 'recorded', task: { state: 'unknown', reason: 'changed', lastVerified: actual.receipt } }, { state: 'not-started' }] });
  expect(await confirmAssistantCalendarBatch(prepared.plan, context())).toMatchObject({ state: 'paused', progress: { verified: 0 } });
  expect(ledgerWrites()).toHaveLength(0);
  expect((await loadPersonalImports(scope)).records[0].location).toBe('圖書館');
});

test('cross-card negative evidence removes stale batch completion while other scopes and cancellation remain intact', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  const actual = await seedOperation();
  const verified = updateAssistantCalendarBatchTask(prepared, actual);
  const absent: AssistantCalendarTask = { proposal: actual.proposal, state: 'unknown', reason: 'absent',
    message: '目前沒有原行程', lastVerified: actual.receipt };
  expect(updateAssistantCalendarBatchTask(verified, absent)).toMatchObject({ state: 'paused', progress: { verified: 0 } });
  const foreign = { ...absent, proposal: { ...absent.proposal, owner: 'firebase:B' } };
  expect(updateAssistantCalendarBatchTask(verified, foreign)).toBe(verified);
  const cancelled = await cancelRemainingAssistantCalendarBatch(prepared.plan, context());
  expect(updateAssistantCalendarBatchTask(cancelled, absent).state).toBe('cancelled');
});

test('combined restore uses one operation snapshot for all batches and single cards after a deletion', async () => {
  const first = await prepareAssistantCalendarBatch(events.slice(0, 2), context());
  await prepareAssistantCalendarBatch([events[0], events[2]], context());
  const actual = await seedOperation();
  await deletePersonalImport(scope, (await loadPersonalImports(scope)).records[0]);
  jest.clearAllMocks();
  const workspace = await restoreAssistantCalendarWorkspace(context());
  expect(workspace.tasks).toMatchObject([{ state: 'unknown', reason: 'absent', lastVerified: actual.receipt }]);
  expect(workspace.batches).toHaveLength(2);
  for (const batch of workspace.batches) {
    expect(batch).toMatchObject({ state: 'paused', progress: { verified: 0 },
      steps: [{ state: 'recorded', task: { state: 'unknown', reason: 'absent' } }, { state: 'not-started' }] });
    if (batch.steps[0].state === 'recorded') expect(batch.steps[0].task).toBe(workspace.tasks[0]);
  }
  expect(workspace.batches[0].plan.id).toBe(first.plan.id);
  expect(ledgerReads()).toHaveLength(1);
  expect(ledgerWrites()).toHaveLength(0);
});

test('plan-store failure preserves fresh single receipts, while journal failure cannot become unstarted steps', async () => {
  await prepareAssistantCalendarBatch(events, context());
  const actual = await seedOperation();
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) =>
    key === batchKey ? Promise.reject(new Error('private plan error')) : originalGet(key));
  const workspace = await restoreAssistantCalendarWorkspace(context());
  expect(workspace).toMatchObject({ tasks: [{ state: 'verified', proposal: actual.proposal }], batches: [], batchError: expect.any(String) });
  expect(workspace.batchError).not.toContain('private');
  await expect(restoreAssistantCalendarBatches(context())).rejects.toMatchObject({ code: 'batch-unavailable' });
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) =>
    key === journalKey ? Promise.reject(new Error('private journal error')) : originalGet(key));
  await expect(restoreAssistantCalendarWorkspace(context())).rejects.toMatchObject({ code: 'batch-unavailable' });
});

test('a hanging batch-store read is isolated from successfully restored single evidence within the recovery deadline', async () => {
  await prepareAssistantCalendarBatch(events, context());
  const actual = await seedOperation();
  jest.useFakeTimers();
  const gate = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) => key === batchKey ? gate.promise : originalGet(key));
  const run = restoreAssistantCalendarWorkspace(context());
  await jest.advanceTimersByTimeAsync(20_001);
  expect(await run).toMatchObject({ tasks: [{ state: 'verified', proposal: actual.proposal }], batches: [], batchError: expect.any(String) });
  gate.resolve(await originalGet(batchKey));
  await flush();
});

test('the entire run stops at eighty seconds even when each individual read responds within its own deadline', async () => {
  const prepared = await prepareAssistantCalendarBatch(events, context());
  jest.useFakeTimers();
  jest.mocked(AsyncStorage.getItem).mockImplementation((key) => new Promise<string | null>((resolve, reject) => {
    setTimeout(() => { void originalGet(key).then(resolve, reject); }, 15_000);
  }));
  const run = confirmAssistantCalendarBatch(prepared.plan, context());
  await jest.advanceTimersByTimeAsync(80_001);
  expect(await run).toMatchObject({ state: 'paused', stop: { reason: 'timeout' } });
  expect(ledgerWrites()).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(ledgerWrites()).toHaveLength(0);
});
