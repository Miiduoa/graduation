import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseAssistantWorkSessionIntent } from '@campus/shared/src/assistantWorkSessionIntent';
import type { PersonalImportRecord } from '@campus/shared/src/imports/types';
import { answerNuniWorkSession } from '../../features/nuniWorkSession';
import { confirmAssistantCalendarTask, type AssistantCalendarContext } from '../../services/assistantCalendarExecution';
import { assistantCalendarJournalStorageKey } from '../../services/assistantCalendarJournal';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { loadPersonalImports, personalImportStorageKey } from '../../services/personalImports';
import { notifyTimetableChanged } from '../../widgets/timetableChanges';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('../../firebase', () => ({
  isFirebaseMockMode: () => false, getAuthInstance: () => ({ currentUser: null }),
}));

const date = '2026-11-09'; // Monday
const schoolId = 'pu';
const accountId = 'pa_00000000-0000-4000-8000-000000000069';
const scope = { owner: 'nuni:' + accountId, schoolId };
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
let current = true;
const permission = jest.fn(async () => ({
  scope: 'platform-account', accountId, revision: 1,
  permissions: { createPersonalEvent: true, prepareFoodOrder: false },
}));
const context: AssistantCalendarContext = {
  uid: '', schoolId, platformTimetable: { accountId, isCurrent: () => current }, isCurrent: () => current,
};
const course = (id: string, startPeriod: number, endPeriod: number): PersonalImportRecord => ({
  kind: 'timetable', id, schoolId, title: '課程' + id, startPeriod, endPeriod, dayOfWeek: 1,
  academicYear: '115', semester: '1', batchId: 'courses',
  importedAt: '2026-09-01T05:00:00Z', source: { type: 'paste', line: 1, rawText: '' },
});
function serve(records: PersonalImportRecord[]) {
  jest.mocked(readAssistantTimetable).mockResolvedValue({ schoolId, timetable: null, records, updatedAt: null });
}
function ask(question: string, signal?: AbortSignal) {
  const intent = parseAssistantWorkSessionIntent(question);
  if (!intent) throw new Error('Invalid test intent: ' + question);
  return answerNuniWorkSession(intent, context, signal, permission);
}
async function seedBusyEvent(startTime: string, endTime: string) {
  const importedAt = '2026-11-08T08:00:00.000Z';
  await originalSet(personalImportStorageKey(scope), JSON.stringify({
    version: 1,
    records: [{
      kind: 'events', id: 'existing', batchId: 'existing-batch', schoolId, title: '私事',
      academicYear: '', semester: '', date, startTime, endTime, allDay: false, importedAt,
      source: { type: 'paste', line: 1, rawText: '' },
    }],
    batches: [{ id: 'existing-batch', createdAt: importedAt, count: 1 }],
  }));
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(Date.parse(date + 'T07:00:00+08:00'));
  current = true;
  permission.mockReset().mockResolvedValue({ scope: 'platform-account', accountId, revision: 1,
    permissions: { createPersonalEvent: true, prepareFoodOrder: false } });
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  serve([course('morning', 1, 2), course('afternoon', 5, 6)]);
});
afterEach(() => { jest.useRealTimers(); });

test.each(['備課', '盤點', '社團籌備', '行政會議', '維護檢查'])(
  '%s can find an hour between known classes and around a personal event without writing', async title => {
    await seedBusyEvent('10:10', '10:35');
    const result = await ask('找今天10:00到13:00一小時' + title);
    expect(result.content).toContain(title);
    expect(result.content).toContain('10:45');
    expect(result.content).toContain('11:45');
    expect(result.calendarTask).toBeUndefined();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test('prepare confirms the precise reviewed interval once, then returns to the original operation on repeat', async () => {
  const request = '安排今天10:00到13:00一小時備課';
  const planned = await ask(request);
  expect(planned.calendarTask?.state).toBe('review');
  const proposal = planned.calendarTask!.proposal;
  expect(proposal.event).toMatchObject({ date, startTime: '10:10', endTime: '11:10', allDay: false });
  expect(await loadPersonalImports(scope)).toMatchObject({ records: [] });
  expect((await confirmAssistantCalendarTask(proposal, context)).state).toBe('verified');
  expect((await confirmAssistantCalendarTask(proposal, context)).state).toBe('verified');
  const repeated = await ask(request);
  expect(repeated.calendarTask?.state).not.toBe('review');
  if (repeated.calendarTask) expect(repeated.calendarTask.proposal.mutationId).toBe(proposal.mutationId);
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('ordinary confirmation rechecks the exact selected time after a class is added', async () => {
  const { calendarTask } = await ask('安排今天10:00到13:00半小時盤點');
  expect(calendarTask?.state).toBe('review');
  serve([course('morning', 1, 2), course('added', 3, 3), course('afternoon', 5, 6)]);
  notifyTimetableChanged();
  const result = await confirmAssistantCalendarTask(calendarTask!.proposal, context);
  expect(result.state).toBe('blocked');
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});

test('a new personal engagement at confirmation cannot shift the original slot', async () => {
  const { calendarTask } = await ask('安排今天10:00到13:00半小時社團籌備');
  await seedBusyEvent('10:20', '10:50');
  expect((await confirmAssistantCalendarTask(calendarTask!.proposal, context)).state).toBe('blocked');
  expect((await loadPersonalImports(scope)).records.map(row => row.id)).toEqual(['existing']);
});

test.each(['missing', 'untimed', 'wrong-school', 'wrong-term', 'past', 'occupied'] as const)(
  '%s evidence cannot produce a work-session draft', async problem => {
    if (problem === 'missing') jest.mocked(readAssistantTimetable).mockResolvedValue(null);
    if (problem === 'untimed') serve([course('morning', 1, 2), course('afternoon', 5, 6),
      { ...course('undated', 3, 3), dayOfWeek: undefined }]);
    if (problem === 'wrong-school') serve([course('morning', 1, 2), { ...course('foreign', 5, 6), schoolId: 'nthu' }]);
    if (problem === 'wrong-term') serve([course('first', 1, 2), course('second', 5, 6)].map(row => ({ ...row, academicYear: '114' })));
    if (problem === 'past') jest.setSystemTime(Date.parse(date + 'T19:00:00+08:00'));
    if (problem === 'occupied') await seedBusyEvent('09:00', '13:00');
    const result = await ask('安排今天10:00到13:00一小時行政會議');
    expect(result.calendarTask).toBeUndefined();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test('a cancelled or changed platform session yields no calendar draft', async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = await ask('安排今天10:00到13:00一小時維護檢查', controller.signal).catch(() => null);
  expect(cancelled?.calendarTask).toBeUndefined();
  current = false;
  const changed = await ask('安排今天10:00到13:00一小時維護檢查').catch(() => null);
  expect(changed?.calendarTask).toBeUndefined();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('revoked, missing and wrong-account permission cannot mint a review or save a previously prepared task', async () => {
  const request = '安排今天10:00到13:00半小時盤點';
  const { calendarTask } = await ask(request);
  expect(calendarTask?.state).toBe('review');
  permission.mockResolvedValue({ scope: 'platform-account', accountId, revision: 2,
    permissions: { createPersonalEvent: false, prepareFoodOrder: true } });
  expect((await confirmAssistantCalendarTask(calendarTask!.proposal, context)).state).toBe('blocked');
  expect((await ask(request)).calendarTask).toBeUndefined();
  permission.mockResolvedValue({ scope: 'platform-account', accountId: accountId.replace(/9$/, '8'), revision: 2,
    permissions: { createPersonalEvent: true, prepareFoodOrder: true } });
  expect((await ask(request)).calendarTask).toBeUndefined();
  expect((await answerNuniWorkSession(parseAssistantWorkSessionIntent(request)!, context)).calendarTask).toBeUndefined();
  expect(await loadPersonalImports(scope)).toMatchObject({ records: [] });
});

test('find does not require permission to create an event', async () => {
  permission.mockRejectedValue(new Error('offline'));
  expect((await ask('找今天10:00到13:00一小時備課')).content).toContain('10:10');
  expect(permission).not.toHaveBeenCalled();
});

test('a timetable revision during journal reservation cannot authorize a stale save or an automatic replacement', async () => {
  const request = '安排今天10:00到13:00半小時盤點';
  const { calendarTask } = await ask(request);
  expect(calendarTask?.state).toBe('review');
  let notified = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (!notified && key === assistantCalendarJournalStorageKey(scope)) {
      notified = true;
      notifyTimetableChanged();
    }
  });
  expect((await confirmAssistantCalendarTask(calendarTask!.proposal, context)).state).toBe('blocked');
  expect(notified).toBe(true);
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
  expect((await ask(request)).calendarTask?.state).not.toBe('review');
});

test('two pending versions of one request cannot save distinct slots in the same window', async () => {
  const request = '安排今天10:00到13:00半小時盤點';
  const first = (await ask(request)).calendarTask!;
  await seedBusyEvent('10:10', '11:00');
  const later = (await ask(request)).calendarTask!;
  expect(later.proposal.event.startTime).toBe('11:10');
  await AsyncStorage.removeItem(personalImportStorageKey(scope));
  expect((await confirmAssistantCalendarTask(first.proposal, context)).state).toBe('verified');
  expect((await confirmAssistantCalendarTask(later.proposal, context)).state).toBe('blocked');
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
});

test('a slow permission service cannot leave a pending preview or create a late review card', async () => {
  let release!: () => void;
  permission.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    return { scope: 'platform-account', accountId, revision: 1,
      permissions: { createPersonalEvent: true, prepareFoodOrder: false } };
  });
  const preview = ask('安排今天10:00到13:00半小時備料');
  await jest.advanceTimersByTimeAsync(10_001);
  const result = await preview;
  expect(result.calendarTask).toBeUndefined();
  expect(result.serviceSelection?.serviceIds).toEqual(['assistant-permissions']);
  release();
  expect((await loadPersonalImports(scope)).records).toHaveLength(0);
});
