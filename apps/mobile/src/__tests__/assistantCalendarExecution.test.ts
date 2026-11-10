import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { parseAssistantCalendarIntent } from '../services/assistantCalendarIntent';
import {
  assistantCalendarOwner, createAssistantCalendarTask, confirmAssistantCalendarTask, recheckAssistantCalendarTask,
  restoreAssistantCalendarTasks, findPersistedAssistantCalendarTask,
  type AssistantCalendarContext,
} from '../services/assistantCalendarExecution';
import { deletePersonalImport, loadPersonalImports, mutatePersonalImportLedger, personalImportStorageKey } from '../services/personalImports';
import {
  assistantCalendarJournalStorageKey, readAssistantCalendarJournal, reserveAssistantCalendarAttempt,
} from '../services/assistantCalendarJournal';

let mockUid = 'A';
let mockFake = false;
jest.mock('../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockUid ? { uid: mockUid } : null }),
  isFirebaseMockMode: () => mockFake,
}));
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const event = { title: '英文讀書', date: '2099-01-02', allDay: false, startTime: '19:00', endTime: '20:00' };
const context = (): AssistantCalendarContext => ({ uid: 'A', schoolId: 'pu', isCurrent: () => true });
const scope = { owner: 'firebase:A', schoolId: 'pu' };
const key = personalImportStorageKey(scope);
const journalKey = assistantCalendarJournalStorageKey(scope);
const ledgerWrites = (target = key) => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([storageKey]) => storageKey === target);
const ledgerReads = () => jest.mocked(AsyncStorage.getItem).mock.calls.filter(([storageKey]) => storageKey === key);
const existing = (overrides: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  ...event, id: 'existing-row', batchId: 'existing-batch', kind: 'events', schoolId: 'pu',
  academicYear: '', semester: '', importedAt: '2026-11-06T12:00:00.000Z',
  source: { type: 'paste', line: 1, rawText: '' }, ...overrides,
});
const seed = async (records: PersonalImportRecord[], batches = records.map((row) => ({
  id: row.batchId, createdAt: row.importedAt, count: 1,
}))) => {
  await AsyncStorage.setItem(key, JSON.stringify({ version: 1, records, batches }));
  jest.mocked(AsyncStorage.setItem).mockClear();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUid = 'A'; mockFake = false;
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('explicit appointment language', () => {
  const now = Date.parse('2026-12-31T16:10:00Z'); // Taiwan is already January 1.
  test.each([
    ['幫我明天 19:00 到 20:00 安排英文讀書', '2027-01-02', '19:00'],
    ['請幫我安排後天 9:00-10:00 資料庫複習', '2027-01-03', '09:00'],
    ['新增個人行程 2027/1/3 09:00 至 10:00 的英文讀書。', '2027-01-03', '09:00'],
    ['今天 19:00～20:00 加入我的行事曆英文讀書', '2027-01-01', '19:00'],
  ])('%s resolves only its explicit Taiwan date and time', (question, date, startTime) => {
    expect(parseAssistantCalendarIntent(question, now)).toMatchObject({ kind: 'draft', event: {
      date, startTime, allDay: false,
    } });
  });
  test.each([
    '幫我明天安排英文讀書', '依課表安排未來七天讀書計畫', '明天 19:00 到 20:00 有空嗎？',
    '不要幫我明天 19:00 到 20:00 安排英文讀書', '「幫我明天 19:00 到 20:00 安排英文讀書」是什麼意思？',
    '幫我明天 19:00 到 20:00 安排英文讀書，然後送出作業',
    '幫我明天 19:00 到 20:00 安排英文讀書並且提醒我',
    '幫我明天 19:00 到 20:00 安排英文讀書 不用了',
  ])('leaves non-create or compound intent untouched: %s', (question) => {
    expect(parseAssistantCalendarIntent(question, now)).toBeNull();
  });
  test.each([
    '安排2027-02-30 19:00 到 20:00 英文讀書', '幫我明天 20:00 到 19:00 安排英文讀書',
    '幫我明天 25:00 到 26:00 安排英文讀書', '幫我今天 00:01 到 01:00 安排英文讀書',
  ])('invalid dates, clocks and past starts return a clarification, not a guessed event: %s', (question) => {
    expect(parseAssistantCalendarIntent(question, now)?.kind).toBe('invalid');
  });
});

test('creating a review draft does not read or write storage and requires the live authenticated owner', () => {
  const task = createAssistantCalendarTask(event, context());
  expect(task).toMatchObject({ state: 'review', proposal: { owner: 'firebase:A', schoolId: 'pu', event } });
  expect(task.proposal.mutationId).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  mockUid = 'B';
  expect(() => createAssistantCalendarTask(event, context())).toThrow();
  mockFake = true;
  expect(assistantCalendarOwner({ ...context(), uid: '' })).toBeNull();
  expect(assistantCalendarOwner({ ...context(), platformTimetable: { accountId: 'platform-a', isCurrent: () => true } })).toBeNull();
});

test('confirm writes exactly the reviewed row, reads it back, and preserves unrelated records', async () => {
  const grade = existing({ id: 'grade-row', kind: 'grades', title: '資料庫', grade: 'A', credits: 3,
    academicYear: '115', semester: '1', date: undefined, allDay: undefined, startTime: undefined, endTime: undefined });
  await seed([grade]);
  const task = createAssistantCalendarTask(event, context());
  const result = await confirmAssistantCalendarTask(task.proposal, context());
  expect(result.state).toBe('verified');
  if (result.state !== 'verified') throw new Error('missing receipt');
  expect(result.receipt).toMatchObject({ status: 'verified', storage: 'device', replay: false,
    mutationId: task.proposal.mutationId, record: { ...event, id: task.proposal.mutationId,
      batchId: task.proposal.mutationId, source: { type: 'paste', name: '助理行程', line: 1, rawText: '' } } });
  expect(ledgerWrites()).toHaveLength(1);
  expect(ledgerReads()).toHaveLength(2); // locked read, then independent readback
  const stored = await loadPersonalImports(scope);
  expect(stored.records).toEqual([JSON.parse(JSON.stringify(grade)), result.receipt.record]);
  expect(stored.batches.at(-1)).toEqual({ id: task.proposal.mutationId, createdAt: task.proposal.createdAt, count: 1 });
});

test('parallel confirmations and later rechecks share one ID and never append twice', async () => {
  const task = createAssistantCalendarTask(event, context());
  const results = await Promise.all([confirmAssistantCalendarTask(task.proposal, context()), confirmAssistantCalendarTask(task.proposal, context())]);
  expect(results.map((result) => result.state)).toEqual(['verified', 'verified']);
  expect(ledgerWrites()).toHaveLength(1);
  expect((await recheckAssistantCalendarTask(task.proposal, context())).state).toBe('verified');
  expect(ledgerWrites()).toHaveLength(1);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('platform storage is isolated from both Firebase and other platform accounts or schools', async () => {
  const platform = { ...context(), uid: '', platformTimetable: { accountId: 'platform-a', isCurrent: () => true } };
  const task = createAssistantCalendarTask(event, platform);
  expect((await confirmAssistantCalendarTask(task.proposal, platform)).state).toBe('verified');
  const platformScope = { owner: 'nuni:platform-a', schoolId: 'pu' };
  const writtenKeys = new Set(jest.mocked(AsyncStorage.setItem).mock.calls.map(([storageKey]) => storageKey));
  expect(writtenKeys).toEqual(new Set([personalImportStorageKey(platformScope), assistantCalendarJournalStorageKey(platformScope)]));
  for (const other of [scope, { owner: 'nuni:platform-b', schoolId: 'pu' }, { owner: 'nuni:platform-a', schoolId: 'nthu' }]) {
    expect((await loadPersonalImports(other)).records).toEqual([]);
  }
});

test('a native bridge that saves then rejects still produces a verified readback receipt', async () => {
  const task = createAssistantCalendarTask(event, context());
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key) throw new Error('native response lost');
  });
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('verified');
  expect(ledgerWrites()).toHaveLength(1);
});

test('a rejected write without a row remains unknown; every later confirm or check only reads', async () => {
  const task = createAssistantCalendarTask(event, context());
  jest.mocked(AsyncStorage.setItem).mockImplementation((storageKey, value) =>
    storageKey === key ? Promise.reject(new Error('device storage full')) : originalSet(storageKey, value));
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('unknown');
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('unknown');
  expect((await recheckAssistantCalendarTask(task.proposal, context())).state).toBe('unknown');
  expect(ledgerWrites()).toHaveLength(1);
});

test('an acknowledged row whose saved content differs cannot be overwritten or claimed complete', async () => {
  const task = createAssistantCalendarTask(event, context());
  await confirmAssistantCalendarTask(task.proposal, context());
  const ledger = await loadPersonalImports(scope);
  await seed([{ ...ledger.records[0], title: '已自行修改的名稱' }]);
  const result = await recheckAssistantCalendarTask(task.proposal, context());
  expect(result).toMatchObject({ state: 'unknown', message: expect.stringContaining('內容與確認草稿不同') });
  expect(ledgerWrites()).toHaveLength(0);
});

test('unavailable rechecks preserve an existing receipt, but cannot resurrect completion after a verified absence', async () => {
  const task = createAssistantCalendarTask(event, context());
  const verified = await confirmAssistantCalendarTask(task.proposal, context());
  if (verified.state !== 'verified') throw new Error('missing receipt');
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('temporarily unavailable'));
  const failed = await recheckAssistantCalendarTask(task.proposal, context(), verified);
  expect(failed).toMatchObject({ state: 'verified', receipt: verified.receipt, warning: expect.stringContaining('這次無法重新讀取') });
  const stored = await loadPersonalImports(scope);
  await deletePersonalImport(scope, stored.records[0]);
  const absent = await recheckAssistantCalendarTask(task.proposal, context(), verified);
  expect(absent).toMatchObject({ state: 'unknown', reason: 'absent', lastVerified: verified.receipt });
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('temporarily unavailable'));
  const stillAbsent = await recheckAssistantCalendarTask(task.proposal, context(), absent);
  expect(stillAbsent).toMatchObject({ state: 'unknown', reason: 'unavailable', lastVerified: verified.receipt });
  expect(ledgerWrites()).toHaveLength(2); // original create and explicit user deletion
});

test('a deleted row with retained operation batch metadata is never recreated', async () => {
  const task = createAssistantCalendarTask(event, context());
  await seed([], [{ id: task.proposal.mutationId, createdAt: task.proposal.createdAt, count: 1 }]);
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('blocked');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect((await loadPersonalImports(scope)).records).toEqual([]);
});

test('malformed storage is preserved and never turned into an empty successful calendar', async () => {
  await AsyncStorage.setItem(key, '{broken');
  jest.mocked(AsyncStorage.setItem).mockClear();
  const task = createAssistantCalendarTask(event, context());
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('unknown');
  expect(await AsyncStorage.getItem(key)).toBe('{broken');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([
  { title: '其他讀書會', startTime: '19:30', endTime: '21:00' },
  { title: '跨日活動', date: '2099-01-01', endDate: '2099-01-03', startTime: '23:00', endTime: '01:00' },
  { title: '全天活動', allDay: true, startTime: undefined, endTime: undefined },
  { title: '跨日全天', date: '2099-01-01', endDate: '2099-01-03', allDay: true, startTime: undefined, endTime: undefined },
])('overlapping personal event blocks a different title, including timed and all-day spans: $title', async (overrides) => {
  await seed([existing(overrides)]);
  const task = createAssistantCalendarTask(event, context());
  expect(await confirmAssistantCalendarTask(task.proposal, context())).toMatchObject({ state: 'blocked', message: expect.stringContaining('重疊') });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([
  { title: '較早行程', startTime: '18:00', endTime: '19:00' },
  { title: '較晚行程', startTime: '20:00', endTime: '21:00' },
  { title: '前一天全天', date: '2099-01-01', endDate: '2099-01-02', allDay: true, startTime: undefined, endTime: undefined },
])('adjacent intervals and the exclusive all-day end do not block: $title', async (overrides) => {
  await seed([existing(overrides)]);
  const task = createAssistantCalendarTask(event, context());
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('verified');
  expect(ledgerWrites()).toHaveLength(1);
});

test('a semantic duplicate with another ID is blocked instead of being duplicated', async () => {
  await seed([existing()]);
  const task = createAssistantCalendarTask(event, context());
  expect(await confirmAssistantCalendarTask(task.proposal, context())).toMatchObject({ state: 'blocked', message: expect.stringContaining('相同名稱') });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['before', 'after'] as const)('scope change %s native write discards the old response and cannot write the new owner', async (when) => {
  let active = true;
  const access = { ...context(), isCurrent: () => active };
  const task = createAssistantCalendarTask(event, access);
  const pending = deferred<string | null>();
  if (when === 'before') jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => pending.promise);
  else jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key) { active = false; mockUid = 'B'; }
  });
  const run = confirmAssistantCalendarTask(task.proposal, access);
  if (when === 'before') { await flush(); active = false; mockUid = 'B'; pending.resolve(null); }
  await expect(run).rejects.toMatchObject({ code: 'session-changed' });
  expect(ledgerWrites().map(([storageKey]) => storageKey)).toEqual(when === 'before' ? [] : [key]);
});

test('a timeout while queued prevents a future write and permanently limits that ID to checking', async () => {
  jest.useFakeTimers();
  const gate = deferred<void>();
  const earlier = mutatePersonalImportLedger(scope, () => true, async (ledger) => {
    await gate.promise; return { ledger, result: undefined };
  });
  const task = createAssistantCalendarTask(event, context());
  const run = confirmAssistantCalendarTask(task.proposal, context());
  await flush();
  await jest.advanceTimersByTimeAsync(20_001);
  expect((await run).state).toBe('unknown');
  gate.resolve(); await earlier; await flush();
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('unknown');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('the durable attempt and its independent readback precede the only ledger write', async () => {
  const task = createAssistantCalendarTask(event, context());
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    if (storageKey === key) {
      const journal = JSON.parse((await originalGet(journalKey))!);
      expect(journal.entries).toMatchObject([{ proposal: task.proposal }]);
      const firstSet = jest.mocked(AsyncStorage.setItem).mock.calls.findIndex(([item]) => item === journalKey);
      const writeOrder = jest.mocked(AsyncStorage.setItem).mock.invocationCallOrder[firstSet];
      expect(jest.mocked(AsyncStorage.getItem).mock.calls.some(([item], index) =>
        item === journalKey && jest.mocked(AsyncStorage.getItem).mock.invocationCallOrder[index] > writeOrder)).toBe(true);
    }
    return originalSet(storageKey, value);
  });
  expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('verified');
  expect(ledgerWrites()).toHaveLength(1);
});

test.each(['read', 'corrupt', 'quota', 'readback'] as const)(
  'journal %s failure prevents any ledger mutation and consumes this confirmation',
  async (failure) => {
    const task = createAssistantCalendarTask(event, context());
    let wroteJournal = false;
    if (failure === 'corrupt') await originalSet(journalKey, '{broken');
    jest.mocked(AsyncStorage.getItem).mockImplementation((storageKey) => {
      if (storageKey === journalKey && failure === 'read') return Promise.reject(new Error('private native payload'));
      if (storageKey === journalKey && failure === 'readback' && wroteJournal) return Promise.resolve(null);
      return originalGet(storageKey);
    });
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
      if (storageKey === journalKey && failure === 'quota') throw new Error('private quota payload');
      await originalSet(storageKey, value);
      if (storageKey === journalKey) wroteJournal = true;
    });
    const result = await confirmAssistantCalendarTask(task.proposal, context());
    expect(result).toMatchObject({ state: 'blocked', message: expect.not.stringContaining('private') });
    expect(ledgerWrites()).toHaveLength(0);
    jest.mocked(AsyncStorage.getItem).mockImplementation(originalGet);
    jest.mocked(AsyncStorage.setItem).mockImplementation(originalSet);
    expect((await confirmAssistantCalendarTask(task.proposal, context())).state).toBe('unknown');
    expect(ledgerWrites()).toHaveLength(0);
  },
);

test('a deserialized review proposal cannot acquire write authority, even without a journal entry', async () => {
  const task = createAssistantCalendarTask(event, context());
  const clone = JSON.parse(JSON.stringify(task.proposal));
  expect((await confirmAssistantCalendarTask(clone, context())).state).toBe('unknown');
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toEqual([]);
});

test('a saved attempt before a crash restores the same absent operation and never re-creates it', async () => {
  const task = createAssistantCalendarTask(event, context());
  await reserveAssistantCalendarAttempt(task.proposal, () => true);
  jest.clearAllMocks();
  const restored = await restoreAssistantCalendarTasks(context());
  expect(restored).toMatchObject([{ state: 'unknown', reason: 'absent', proposal: task.proposal }]);
  expect((await confirmAssistantCalendarTask(restored[0].proposal, context())).state).toBe('unknown');
  const next = createAssistantCalendarTask(event, context());
  const repeated = await confirmAssistantCalendarTask(next.proposal, context());
  expect(repeated).toMatchObject({ state: 'unknown', reason: 'absent', proposal: task.proposal });
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
});

test('two fresh proposals still use one ID after an ambiguous first ledger write', async () => {
  const first = createAssistantCalendarTask(event, context());
  const second = createAssistantCalendarTask(event, context());
  jest.mocked(AsyncStorage.setItem).mockImplementation((storageKey, value) =>
    storageKey === key ? Promise.reject(new Error('response unknown')) : originalSet(storageKey, value));
  const results = await Promise.all([
    confirmAssistantCalendarTask(first.proposal, context()),
    confirmAssistantCalendarTask(second.proposal, context()),
  ]);
  expect(results).toMatchObject([
    { state: 'unknown', proposal: first.proposal },
    { state: 'unknown', proposal: first.proposal },
  ]);
  expect(ledgerWrites()).toHaveLength(1);
});

test.each(['delete', 'edit'] as const)('restoring a verified event after %s preserves history without rebuilding', async (change) => {
  const task = createAssistantCalendarTask(event, context());
  const verified = await confirmAssistantCalendarTask(task.proposal, context());
  if (verified.state !== 'verified') throw new Error('missing receipt');
  const ledger = await loadPersonalImports(scope);
  if (change === 'delete') {
    await deletePersonalImport(scope, ledger.records[0]);
    expect((await loadPersonalImports(scope)).batches).toEqual([]);
  } else await seed([{ ...ledger.records[0], location: '使用者已修改的地點' }]);
  jest.clearAllMocks();
  const restored = await restoreAssistantCalendarTasks(context());
  expect(restored).toMatchObject([{ state: 'unknown', reason: change === 'delete' ? 'absent' : 'changed',
    proposal: task.proposal, lastVerified: verified.receipt }]);
  const repeated = await findPersistedAssistantCalendarTask(event, context());
  expect(repeated).toMatchObject({ state: 'unknown', proposal: task.proposal, lastVerified: verified.receipt });
  const fresh = createAssistantCalendarTask(event, context());
  expect(await confirmAssistantCalendarTask(fresh.proposal, context())).toMatchObject({ state: 'unknown', proposal: task.proposal });
  expect(ledgerWrites()).toHaveLength(0);
});

test.each([
  { title: 'study english' }, { title: 'Study   English' },
  { endDate: event.date }, { location: '新地點' },
])('a normalized re-ask keeps the original unknown proposal exactly: %#', async (change) => {
  const originalEvent = { ...event, title: 'Study English' };
  const task = createAssistantCalendarTask(originalEvent, context());
  await reserveAssistantCalendarAttempt(task.proposal, () => true);
  const found = await findPersistedAssistantCalendarTask({ ...originalEvent, ...change }, context());
  expect(found).toMatchObject({ state: 'unknown', proposal: task.proposal });
  expect(ledgerWrites()).toHaveLength(0);
});

test('a failed negative journal update followed by unavailable storage cannot revive old completion on restart', async () => {
  const task = createAssistantCalendarTask(event, context());
  const verified = await confirmAssistantCalendarTask(task.proposal, context());
  if (verified.state !== 'verified') throw new Error('missing receipt');
  await deletePersonalImport(scope, (await loadPersonalImports(scope)).records[0]);
  jest.mocked(AsyncStorage.setItem).mockImplementation((storageKey, value) =>
    storageKey === journalKey ? Promise.reject(new Error('journal unavailable')) : originalSet(storageKey, value));
  expect(await recheckAssistantCalendarTask(task.proposal, context(), verified))
    .toMatchObject({ state: 'unknown', reason: 'absent', lastVerified: verified.receipt });
  expect((await readAssistantCalendarJournal(scope, () => true))[0].observation?.state).toBe('verified');
  jest.mocked(AsyncStorage.setItem).mockImplementation(originalSet);
  jest.mocked(AsyncStorage.getItem).mockImplementation((storageKey) =>
    storageKey === key ? Promise.reject(new Error('ledger unavailable')) : originalGet(storageKey));
  expect(await restoreAssistantCalendarTasks(context()))
    .toMatchObject([{ state: 'unknown', reason: 'unavailable', lastVerified: verified.receipt }]);
});

test('empty restore has no ledger work, while a nonempty restore shares one snapshot and one journal update', async () => {
  expect(await restoreAssistantCalendarTasks(context())).toEqual([]);
  expect(ledgerReads()).toHaveLength(0);
  for (let index = 0; index < 4; index++) {
    const task = createAssistantCalendarTask({ ...event, title: '讀書 ' + index }, context());
    await reserveAssistantCalendarAttempt(task.proposal, () => true);
  }
  jest.clearAllMocks();
  const restored = await restoreAssistantCalendarTasks(context());
  expect(restored).toHaveLength(4);
  expect(restored.every((task) => task.state === 'unknown')).toBe(true);
  expect(ledgerReads()).toHaveLength(1);
  expect(ledgerWrites()).toHaveLength(0);
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.filter(([storageKey]) => storageKey === journalKey)).toHaveLength(1);
});

test('the journal can retain an attempt whose reviewed start expires while its durable write is pending', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2099-01-02T10:59:59.000Z'));
  const task = createAssistantCalendarTask(event, context()); // 19:00 Taiwan, one second ahead.
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === journalKey) jest.setSystemTime(new Date('2099-01-02T11:00:00.001Z'));
  });
  expect(await confirmAssistantCalendarTask(task.proposal, context()))
    .toMatchObject({ state: 'blocked', message: expect.stringContaining('開始時間已經過了') });
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toHaveLength(1);
  expect((await restoreAssistantCalendarTasks(context()))[0].proposal.mutationId).toBe(task.proposal.mutationId);
  expect(ledgerWrites()).toHaveLength(0);
});

test('a known exact receipt survives a journal observation that never responds before the overall deadline', async () => {
  jest.useFakeTimers();
  const gate = deferred<void>();
  let journalWrites = 0;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === journalKey && ++journalWrites === 2) await gate.promise;
  });
  const task = createAssistantCalendarTask(event, context());
  const run = confirmAssistantCalendarTask(task.proposal, context());
  await flush();
  await jest.advanceTimersByTimeAsync(20_001);
  const result = await run;
  expect(result).toMatchObject({ state: 'verified', receipt: { mutationId: task.proposal.mutationId },
    warning: expect.stringContaining('本次核對結果尚未更新') });
  expect(ledgerWrites()).toHaveLength(1);
  gate.resolve();
  await flush();
});

test('restore has one overall deadline across journal and ledger reads, preserving historical receipts only', async () => {
  const task = createAssistantCalendarTask(event, context());
  const verified = await confirmAssistantCalendarTask(task.proposal, context());
  if (verified.state !== 'verified') throw new Error('missing receipt');
  const rawJournal = await originalGet(journalKey);
  const rawLedger = await originalGet(key);
  jest.useFakeTimers();
  const journalGate = deferred<string | null>();
  const ledgerGate = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementation((storageKey) =>
    storageKey === journalKey ? journalGate.promise : storageKey === key ? ledgerGate.promise : originalGet(storageKey));
  jest.clearAllMocks();
  const run = restoreAssistantCalendarTasks(context());
  await jest.advanceTimersByTimeAsync(15_000);
  journalGate.resolve(rawJournal);
  await flush();
  await jest.advanceTimersByTimeAsync(5_001);
  expect(await run).toMatchObject([{ state: 'unknown', reason: 'unavailable', lastVerified: verified.receipt }]);
  expect(ledgerWrites()).toHaveLength(0);
  ledgerGate.resolve(rawLedger);
  await flush();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a stuck journal restore throws a safe timeout instead of allowing an empty-history new draft', async () => {
  jest.useFakeTimers();
  const gate = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => gate.promise);
  const run = findPersistedAssistantCalendarTask(event, context());
  const rejection = expect(run).rejects.toMatchObject({ code: 'journal-timeout' });
  await jest.advanceTimersByTimeAsync(20_001);
  await rejection;
  gate.resolve(null);
  await flush();
  expect(ledgerWrites()).toHaveLength(0);
  expect(ledgerReads()).toHaveLength(0);
});
