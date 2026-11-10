import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment } from '@campus/shared/src/nuni';
import {
  confirmCourseworkStudyDraft, findCourseworkStudyDrafts,
  type CourseworkStudyDraft, type CourseworkStudyResult,
} from '../../features/nuniCourseworkStudy';
import type { CourseworkRead } from '../../features/nuniCourseworkFollowUp';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import {
  confirmAssistantCalendarTask, createAssistantCalendarTask, type AssistantCalendarContext,
} from '../../services/assistantCalendarExecution';
import {
  findCourseworkStudyBatchSlots, recheckCourseworkStudySlot, recheckCourseworkStudyTime,
  type CourseworkStudySlot,
} from '../../services/courseworkStudyAvailability';
import { assistantCalendarJournalStorageKey, readAssistantCalendarJournal } from '../../services/assistantCalendarJournal';
import {
  loadPersonalImports, mutatePersonalImportLedger, personalImportStorageKey,
  type PersonalImportLedger, type PersonalImportScope,
} from '../../services/personalImports';
import { notifyNuniAssignmentChanged } from '../../services/nuniAssignmentChanges';
import { notifyTimetableChanged } from '../../widgets/timetableChanges';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: { uid: 'campus-a' } }),
  isFirebaseMockMode: () => false,
}));

const date = '2026-11-09'; // Monday, in the 115|1 term.
const now = Date.parse(date + 'T07:00:00+08:00');
const at = (clock: string, day = date) => Date.parse(day + 'T' + clock + ':00+08:00');
const uuid = (value: number) => '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const workspaceId = 'cw_' + uuid(1);
const assignmentId = 'cwa_' + uuid(1);
let accountId = '';
let schoolId = 'pu';
let active = true;
let sequence = 4000;
let courses: PersonalImportRecord[] = [];
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const timetable = jest.mocked(readAssistantTimetable);
const transport = { request: jest.fn(), bffRequest: jest.fn() };
type TimetableRead = NonNullable<Awaited<ReturnType<typeof readAssistantTimetable>>>;

const course = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  kind: 'timetable', schoolId: 'pu', id: 'imported-db', title: '資料庫',
  batchId: 'fixture', academicYear: '115', semester: '1', dayOfWeek: 1,
  startPeriod: 1, endPeriod: 2, location: '305', linkedCourseId: workspaceId,
  importedAt: '2026-09-01T05:00:00Z', source: { type: 'paste', line: 1, rawText: '' },
  ...patch,
});
const occurrence = {
  courseId: 'imported-db', name: '資料庫', date, term: '115|1',
  room: '305', startTime: '08:10', endTime: '10:00',
};
const assignment = (patch: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: assignmentId, workspaceId, title: '期末資料模型',
  createdAt: '2026-11-04T05:00:00Z', closedAt: null,
  dueAt: date + 'T18:00:00+08:00', instructions: '私人的作業全文', state: 'open',
  unitId: null, unitTitle: null, mySubmission: null, submissionCount: 0, ...patch,
});
const event = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  kind: 'events', schoolId: 'pu', id: 'existing-personal-event', title: '個人安排',
  batchId: 'existing-event-batch', academicYear: '', semester: '',
  date, allDay: false, startTime: '10:00', endTime: '13:10',
  importedAt: '2026-11-08T05:00:00Z', source: { type: 'paste', line: 1, rawText: '' },
  ...patch,
});
function read(rows = [assignment()]): CourseworkRead {
  return {
    anchor: { uid: '', owner: 'nuni:' + accountId, schoolId, classes: [{ ...occurrence }], updatedAt: null },
    checkedAt: new Date().toISOString(),
    result: {
      kind: 'assignments', limited: false, workspace: { id: workspaceId, title: '資料庫 A 班' },
      assignments: rows.map((row) => ({
        id: row.id, title: row.title, dueAt: row.dueAt,
        state: row.state, submittedAt: row.mySubmission?.submittedAt ?? null,
      })),
    },
  };
}
function source(rows = courses): TimetableRead {
  return { timetable: null, schoolId: 'pu', updatedAt: '2026-11-08T05:00:00Z', records: rows };
}
function context(): AssistantCalendarContext {
  const account = accountId, school = schoolId;
  const valid = () => active && accountId === account && schoolId === school;
  return {
    uid: '', schoolId: school, isCurrent: valid,
    platformTimetable: { accountId: account, isCurrent: valid },
  };
}
const scope = (): PersonalImportScope => ({ owner: 'nuni:' + accountId, schoolId });
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls
  .filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
const flush = async () => { for (let index = 0; index < 80; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function ledger(rows: PersonalImportRecord[]): PersonalImportLedger {
  return {
    version: 1, records: rows,
    batches: [...new Set(rows.map((row) => row.batchId))].map((id) => ({
      id, createdAt: '2026-11-08T05:00:00Z', count: rows.filter((row) => row.batchId === id).length,
    })),
  };
}
async function seed(rows: PersonalImportRecord[], target = scope()) {
  await originalSet(personalImportStorageKey(target), JSON.stringify(ledger(rows)));
}
async function suggestions(snapshot = read(), id = assignmentId) {
  const result = await findCourseworkStudyDrafts(snapshot, id, context());
  expect(result.kind).toBe('available');
  if (result.kind !== 'available') throw new Error('Expected an available preparation preview: ' + result.message);
  expect(result.drafts.length).toBeGreaterThan(0);
  return result;
}
function expectNoSave(result: CourseworkStudyResult) {
  if (result.kind === 'calendar') expect(result.task.state).toBe('blocked');
  else expect(['blocked', 'changed', 'unavailable']).toContain(result.kind);
  expect(ledgerWrites()).toHaveLength(0);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  accountId = 'pa_' + uuid(++sequence); schoolId = 'pu'; active = true;
  courses = [
    course(),
    course({ id: 'imported-network', title: '網路管理', startPeriod: 5, endPeriod: 6, linkedCourseId: undefined }),
  ];
  timetable.mockImplementation(async () => source());
  transport.request.mockResolvedValue({
    workspaces: [{ id: workspaceId, title: '資料庫 A 班', state: 'active', memberRole: 'student' }],
  });
  transport.bffRequest.mockResolvedValue({ assignments: [assignment()] });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('finding creates only immutable previews between known classes, with no network or operation writes', async () => {
  const result = await suggestions();
  expect(result.drafts.length).toBeLessThanOrEqual(3);
  expect(result.checkedAt).toBe(new Date(now).toISOString());
  expect(result.drafts[0].event).toMatchObject({
    title: '準備：期末資料模型', date, allDay: false, startTime: '10:10', endTime: '10:40',
  });
  expect(new Set(result.drafts.map((draft) => JSON.stringify(draft.event))).size).toBe(result.drafts.length);
  for (const draft of result.drafts) {
    expect(draft.source).toMatchObject({ owner: scope().owner, schoolId, workspaceId, assignmentId });
    expect(draft.availability).toMatchObject({ checkedAt: result.checkedAt, summary: expect.any(String) });
    expect(draft.availability!.summary.trim()).not.toBe('');
    expect(Object.isFrozen(draft) && Object.isFrozen(draft.event) && Object.isFrozen(draft.source)).toBe(true);
    expect(Object.isFrozen(draft.availability)).toBe(true);
    const start = at(draft.event.startTime!, draft.event.date);
    const end = at(draft.event.endTime!, draft.event.date);
    expect(start).toBeGreaterThanOrEqual(at('10:10'));
    expect(end).toBeLessThanOrEqual(at('13:00'));
    expect(end - start).toBe(30 * 60_000);
    expect(start % (5 * 60_000)).toBe(0);
  }
  expect(transport.request).not.toHaveBeenCalled();
  expect(transport.bffRequest).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test.each(['missing', 'unreadable', 'wrong-school', 'wrong-term', 'missing-weekday', 'invalid-clock'] as const)(
  '%s timetable evidence does not become an empty or available day', async (problem) => {
    if (problem === 'missing') timetable.mockResolvedValue(null);
    if (problem === 'unreadable') timetable.mockRejectedValue(new Error('native timetable unavailable'));
    if (problem === 'wrong-school') timetable.mockResolvedValue({ ...source(), schoolId: 'ncku' });
    if (problem === 'wrong-term') courses = courses.map((row) => ({ ...row, academicYear: '114' }));
    if (problem === 'missing-weekday') courses.push(course({ id: 'unplaced', dayOfWeek: undefined }));
    if (problem === 'invalid-clock') courses.push(course({
      id: 'malformed', startPeriod: undefined, endPeriod: undefined, startTime: '25:00', endTime: '26:00',
    }));
    expect(await findCourseworkStudyDrafts(read(), assignmentId, context())).toMatchObject({ kind: 'unavailable' });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test.each(['single-class', 'adjacent-classes', 'buffer-too-short'] as const)(
  '%s provides no complete 30-minute suggestion with both class buffers', async (problem) => {
    if (problem === 'single-class') courses = [course()];
    if (problem === 'adjacent-classes') courses = [
      course(), course({ id: 'next', title: '下一堂', startPeriod: 3, endPeriod: 4 }),
    ];
    if (problem === 'buffer-too-short') courses = [
      course(), course({ id: 'next', title: '下一堂', startPeriod: undefined, endPeriod: undefined,
        startTime: '10:45', endTime: '11:30' }),
    ];
    expect(await findCourseworkStudyDrafts(read(), assignmentId, context())).toMatchObject({ kind: 'no-slot' });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test('a corrupt personal calendar is unavailable instead of being treated as an empty calendar', async () => {
  await originalSet(personalImportStorageKey(scope()), '{not-json');
  expect(await findCourseworkStudyDrafts(read(), assignmentId, context())).toMatchObject({ kind: 'unavailable' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a failed personal-calendar read cannot establish availability', async () => {
  const key = personalImportStorageKey(scope());
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (storageKey) => {
    if (storageKey === key) throw new Error('native ledger unavailable');
    return originalGet(storageKey);
  });
  expect(await findCourseworkStudyDrafts(read(), assignmentId, context())).toMatchObject({ kind: 'unavailable' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['same-day', 'overnight', 'all-day', 'multiple-days'] as const)(
  '%s personal events block the otherwise available between-class window', async (kind) => {
    const row = kind === 'same-day' ? event()
      : kind === 'overnight' ? event({ date: '2026-11-08', endDate: date, startTime: '23:00' })
        : event({
          date: kind === 'multiple-days' ? '2026-11-08' : date,
          endDate: kind === 'multiple-days' ? '2026-11-10' : undefined,
          allDay: true, startTime: undefined, endTime: undefined,
        });
    await seed([row]);
    expect(await findCourseworkStudyDrafts(read(), assignmentId, context())).toMatchObject({ kind: 'no-slot' });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test('an all-day event ending exclusively at this midnight does not block this day', async () => {
  await seed([event({ date: '2026-11-08', endDate: date, allDay: true, startTime: undefined, endTime: undefined })]);
  expect((await suggestions()).drafts[0].event.startTime).toBe('10:10');
});

test('a partly occupied gap yields complete options after the event, without overlapping it', async () => {
  await seed([event({ endTime: '11:00' })]);
  const result = await suggestions();
  for (const draft of result.drafts) {
    expect(at(draft.event.startTime!, draft.event.date)).toBeGreaterThanOrEqual(at('11:00'));
    expect(at(draft.event.endTime!, draft.event.date)).toBeLessThanOrEqual(at('13:00'));
  }
});

test('the lookup respects a pending ledger mutation instead of suggesting from its prior empty state', async () => {
  const release = deferred<void>();
  const externalWrite = mutatePersonalImportLedger(scope(), () => true, async () => {
    await release.promise;
    return { ledger: ledger([event()]), result: undefined };
  });
  await flush();
  let settled = false;
  const work = findCourseworkStudyDrafts(read(), assignmentId, context());
  void work.then(() => { settled = true; });
  await flush();
  expect(settled).toBe(false);
  release.resolve();
  await externalWrite;
  expect((await work).kind).not.toBe('available');
  expect(ledgerWrites()).toHaveLength(1); // Only the external mutation.
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test('the entire preparation period must fit before the exact deadline', async () => {
  const tooSoon = read([assignment({ dueAt: date + 'T10:39:59+08:00' })]);
  expect(await findCourseworkStudyDrafts(tooSoon, assignmentId, context())).toMatchObject({ kind: 'no-slot' });
  const justEnough = await suggestions(read([assignment({ dueAt: date + 'T10:40:00+08:00' })]));
  expect(justEnough.drafts).toHaveLength(1);
  expect(justEnough.drafts[0].event.endTime).toBe('10:40');
});

test('the earliest future start rounds forward on the five-minute grid', async () => {
  jest.setSystemTime(at('10:12') + 1000);
  expect((await suggestions()).drafts[0].event).toMatchObject({ startTime: '10:15', endTime: '10:45' });
});

test('a far deadline never expands the requested seven-day planning horizon', async () => {
  const result = await suggestions(read([assignment({ dueAt: '2026-12-31T18:00:00+08:00' })]));
  for (const draft of result.drafts) {
    expect(at(draft.event.startTime!, draft.event.date)).toBeGreaterThan(now);
    expect(at(draft.event.endTime!, draft.event.date)).toBeLessThanOrEqual(now + 7 * 86_400_000);
  }
});

test('same-title assignments retain the selected source ID through actual confirmation and readback', async () => {
  const second = assignment({ id: 'cwa_' + uuid(2) });
  const snapshot = read([assignment(), second]);
  const result = await suggestions(snapshot, second.id);
  expect(result.drafts.every((draft) => draft.source.assignmentId === second.id)).toBe(true);
  transport.bffRequest.mockResolvedValue({ assignments: [assignment(), second] });
  const saved = await confirmCourseworkStudyDraft(result.drafts[0], context(), transport);
  expect(saved).toMatchObject({ kind: 'calendar', task: { state: 'verified' } });
  expect(ledgerWrites()).toHaveLength(1);
});

test('confirmation uses the real source resolver and executor, then reads back the same saved record', async () => {
  const draft = (await suggestions()).drafts[0];
  const result = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(result).toMatchObject({ kind: 'calendar', sourceCheckedAt: expect.any(String), task: { state: 'verified' } });
  if (result.kind !== 'calendar' || result.task.state !== 'verified') throw new Error('Expected a verified native save');
  const saved = await loadPersonalImports(scope());
  expect(saved.records).toHaveLength(1);
  expect(saved.records[0]).toEqual(result.task.receipt.record);
  expect(saved.records[0].source.rawText).toBe('');
  expect(ledgerWrites()).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(1);
  expect(transport.request.mock.calls).toEqual([['class-workspaces']]);
  expect(transport.bffRequest.mock.calls).toEqual([['class-workspaces/' + workspaceId + '/assignments']]);
});

test.each(['renamed', 'deadline', 'closed', 'removed'] as const)(
  'fresh source %s blocks the suggested event before any calendar write', async (problem) => {
    const draft = (await suggestions()).drafts[0];
    const latest = problem === 'renamed' ? assignment({ title: '已更新的資料模型' })
      : problem === 'deadline' ? assignment({ dueAt: date + 'T17:00:00+08:00' })
        : assignment({ state: 'closed', closedAt: date + 'T07:01:00+08:00' });
    transport.bffRequest.mockResolvedValue({ assignments: problem === 'removed' ? [] : [latest] });
    const result = await confirmCourseworkStudyDraft(draft, context(), transport);
    expectNoSave(result);
    expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
  },
);

test('a newly saved class in the suggested window prevents confirmation of the old preview', async () => {
  const draft = (await suggestions()).drafts[0];
  courses = [...courses, course({ id: 'new-class', title: '新增的課', startPeriod: 3, endPeriod: 3 })];
  expectNoSave(await confirmCourseworkStudyDraft(draft, context(), transport));
});

test('an unreadable timetable at confirmation cannot reuse the preview availability', async () => {
  const draft = (await suggestions()).drafts[0];
  timetable.mockRejectedValue(new Error('timetable no longer readable'));
  expectNoSave(await confirmCourseworkStudyDraft(draft, context(), transport));
});

test('a personal event saved after preview prevents writing the stale suggestion', async () => {
  const draft = (await suggestions()).drafts[0];
  await seed([event()]);
  expectNoSave(await confirmCourseworkStudyDraft(draft, context(), transport));
});

test('a personal event appearing during source refresh is checked again before dispatch', async () => {
  const draft = (await suggestions()).drafts[0];
  const pending = deferred<{ assignments: NuniAssignment[] }>();
  transport.bffRequest.mockReturnValueOnce(pending.promise);
  const work = confirmCourseworkStudyDraft(draft, context(), transport);
  await flush();
  expect(transport.bffRequest).toHaveBeenCalledTimes(1);
  await seed([event()]);
  pending.resolve({ assignments: [assignment()] });
  expectNoSave(await work);
});

test('a timetable change while journal reservation is saving closes the final write guard', async () => {
  const draft = (await suggestions()).drafts[0];
  const key = assistantCalendarJournalStorageKey(scope());
  let notified = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key && !notified) {
      notified = true;
      courses = [...courses, course({ id: 'late-class', title: '臨時加課', startPeriod: 3, endPeriod: 3 })];
      notifyTimetableChanged();
    }
  });
  expectNoSave(await confirmCourseworkStudyDraft(draft, context(), transport));
  expect(notified).toBe(true);
});

test('a now-elapsed suggested start cannot be shifted or confirmed silently', async () => {
  const draft = (await suggestions()).drafts[0];
  jest.setSystemTime(at(draft.event.startTime!, draft.event.date));
  expectNoSave(await confirmCourseworkStudyDraft(draft, context(), transport));
});

test('the same suggested draft shares one confirmation and the own calendar notification does not erase its receipt', async () => {
  const draft = (await suggestions()).drafts[0];
  const access = context();
  const first = confirmCourseworkStudyDraft(draft, access, transport);
  const second = confirmCourseworkStudyDraft(draft, access, transport);
  expect(second).toBe(first);
  expect(await first).toMatchObject({ kind: 'calendar', task: { state: 'verified' } });
  expect(ledgerWrites()).toHaveLength(1);
});

test('an unknown native result is recovered only by the original ID without another availability or source lookup', async () => {
  const draft = (await suggestions()).drafts[0];
  const key = personalImportStorageKey(scope());
  let written = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value);
    if (storageKey === key) { written = true; throw new Error('lost native save reply'); }
  });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (storageKey) => {
    if (storageKey === key && written) throw new Error('readback temporarily unavailable');
    return originalGet(storageKey);
  });
  const initial = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(initial).toMatchObject({ kind: 'calendar', task: { state: 'unknown' } });
  if (initial.kind !== 'calendar') throw new Error('Expected the original operation');
  const sourceReads = transport.bffRequest.mock.calls.length;
  timetable.mockClear().mockRejectedValue(new Error('availability should not be queried on recovery'));
  jest.mocked(AsyncStorage.getItem).mockImplementation(originalGet);
  const next = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(next).toMatchObject({
    kind: 'calendar', task: { state: 'verified', proposal: { mutationId: initial.task.proposal.mutationId } },
  });
  expect(timetable).not.toHaveBeenCalled();
  expect(transport.bffRequest).toHaveBeenCalledTimes(sourceReads);
  expect(ledgerWrites()).toHaveLength(1);
});

test('JSON restoration of a suggested draft does not restore confirmation authority', async () => {
  const draft = (await suggestions()).drafts[0];
  const clone = JSON.parse(JSON.stringify(draft)) as CourseworkStudyDraft;
  jest.mocked(AsyncStorage.getItem).mockClear();
  timetable.mockClear();
  expect(await confirmCourseworkStudyDraft(clone, context(), transport)).toMatchObject({ kind: 'blocked' });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(timetable).not.toHaveBeenCalled();
  expect(transport.request).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a pre-aborted lookup does not touch the timetable or calendar', async () => {
  const abort = new AbortController();
  abort.abort();
  expect(await findCourseworkStudyDrafts(read(), assignmentId, context(), { signal: abort.signal }))
    .toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['abort', 'account', 'school', 'source', 'timetable'] as const)(
  '%s while finding slots prevents a late timetable response from producing an actionable preview', async (change) => {
    const before = source();
    const target = scope();
    const pending = deferred<TimetableRead>();
    timetable.mockReturnValueOnce(pending.promise);
    const abort = new AbortController();
    const work = findCourseworkStudyDrafts(read(), assignmentId, context(), { signal: abort.signal });
    await flush();
    expect(timetable).toHaveBeenCalled();
    if (change === 'abort') abort.abort();
    if (change === 'account') accountId = 'pa_' + uuid(9999);
    if (change === 'school') schoolId = 'ncku';
    if (change === 'source') notifyNuniAssignmentChanged({ accountId, context: 'a'.repeat(43), workspaceId, assignmentId });
    if (change === 'timetable') notifyTimetableChanged();
    pending.resolve(before);
    expect(await work).toMatchObject({ kind: 'blocked' });
    expect(ledgerWrites()).toHaveLength(0);
    expect(await readAssistantCalendarJournal(target, () => true)).toHaveLength(0);
  },
);

test('a timed-out availability read returns promptly and ignores its late result', async () => {
  const pending = deferred<TimetableRead>();
  timetable.mockReturnValueOnce(pending.promise);
  const work = findCourseworkStudyDrafts(read(), assignmentId, context());
  await flush();
  expect(timetable).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(20_001);
  expect(await work).toMatchObject({ kind: 'unavailable' });
  pending.resolve(source());
  await flush();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

const batchSources = (count = 2, dueAt = date + 'T18:00:00+08:00') =>
  Array.from({ length: count }, (_, index) => ({ id: `selected-${index + 1}`, dueAt }));
const fixedTime = () => ({ date, startTime: '10:10', endTime: '10:40' });
const calendarEvent = (slot: CourseworkStudySlot, title: string) => ({
  title, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, allDay: false,
});

test('allocates four exact sources from one snapshot by deadline, including several buffered slots in one gap', async () => {
  const result = await findCourseworkStudyBatchSlots(context(), [
    { id: 'last', dueAt: date + 'T18:00:00+08:00' },
    { id: 'second', dueAt: date + 'T12:00:00+08:00' },
    { id: 'first', dueAt: date + 'T10:40:00+08:00' },
    { id: 'third', dueAt: date + 'T13:00:00+08:00' },
  ]);
  expect(result.kind).toBe('available');
  if (result.kind !== 'available') throw new Error(result.message);
  expect(result.slots.map(({ id, slot }) => [id, slot.date, slot.startTime, slot.endTime])).toEqual([
    ['first', date, '10:10', '10:40'], ['second', date, '10:50', '11:20'],
    ['third', date, '11:30', '12:00'], ['last', date, '12:10', '12:40'],
  ]);
  expect(result.checkedAt).toBe(new Date(now).toISOString());
  expect(result.slots.every(({ slot }) => slot.checkedAt === result.checkedAt)).toBe(true);
  expect(Object.isFrozen(result.slots) && result.slots.every((item) =>
    Object.isFrozen(item) && Object.isFrozen(item.slot))).toBe(true);
  expect(timetable).toHaveBeenCalledTimes(1);
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.filter(([key]) => key === personalImportStorageKey(scope()))).toHaveLength(1);
  expect(transport.request).not.toHaveBeenCalled();
  expect(transport.bffRequest).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test('captures all selected IDs and deadlines before an asynchronous batch lookup can be retargeted', async () => {
  const pending = deferred<TimetableRead>();
  timetable.mockReturnValueOnce(pending.promise);
  const selected = batchSources();
  const work = findCourseworkStudyBatchSlots(context(), selected);
  selected[0].id = 'replacement';
  selected[0].dueAt = date + 'T07:00:00+08:00';
  selected[1] = { id: 'also-replaced', dueAt: '2026-01-01' };
  selected.push({ id: 'unexpected-third', dueAt: date + 'T18:00:00+08:00' });
  await flush();
  pending.resolve(source());
  const result = await work;
  expect(result.kind).toBe('available');
  if (result.kind === 'available') expect(result.slots.map(({ id }) => id)).toEqual(['selected-1', 'selected-2']);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a batch excludes existing personal events and their margins before allocating peers', async () => {
  await seed([event({ startTime: '10:30', endTime: '11:00' })]);
  const result = await findCourseworkStudyBatchSlots(context(), batchSources());
  expect(result.kind).toBe('available');
  if (result.kind === 'available') expect(result.slots.map(({ slot }) => [slot.startTime, slot.endTime])).toEqual([
    ['11:10', '11:40'], ['11:50', '12:20'],
  ]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('insufficient room never returns a shrunken batch or writes a partial plan', async () => {
  const result = await findCourseworkStudyBatchSlots(context(), batchSources(4, date + 'T11:20:00+08:00'));
  expect(result).toMatchObject({ kind: 'no-slot', unplacedIds: ['selected-3', 'selected-4'] });
  expect(result).not.toHaveProperty('slots');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test('a deadline one second before a complete slot cannot be rounded later or silently omitted', async () => {
  expect(await findCourseworkStudyBatchSlots(context(), [
    { id: 'due-soon', dueAt: date + 'T10:39:59+08:00' }, ...batchSources(1),
  ])).toMatchObject({ kind: 'no-slot', unplacedIds: ['due-soon'] });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([
  [], batchSources(1), batchSources(5), [batchSources()[0], batchSources()[0]],
  [{ id: '', dueAt: date + 'T18:00:00+08:00' }, batchSources()[1]],
  [{ id: 'hidden\u200bsource', dueAt: date + 'T18:00:00+08:00' }, batchSources()[1]],
].map((selected) => ({ selected })))(
  'rejects an invalid selection before looking for batch availability: %j', async ({ selected }) => {
  expect(await findCourseworkStudyBatchSlots(context(), selected)).toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([
  '2026-11-09', '2026-11-09T18:00:00', '2026-02-30T18:00:00+08:00',
  '2026-11-09T25:00:00+08:00', '2026-11-09T18:00:60+08:00', '2026-11-09T18:00:00+14:30',
])('both batch finding and fixed-time rechecks reject an unverified exact deadline: %s', async (dueAt) => {
  expect(await findCourseworkStudyBatchSlots(context(), batchSources(2, dueAt))).toMatchObject({ kind: 'blocked' });
  expect(await recheckCourseworkStudyTime(fixedTime(), dueAt, context())).toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('an elapsed selected deadline prevents the whole batch before any availability read', async () => {
  const selected = batchSources(); selected[1].dueAt = date + 'T07:00:00+08:00';
  expect(await findCourseworkStudyBatchSlots(context(), selected))
    .toMatchObject({ kind: 'no-slot', unplacedIds: ['selected-2'] });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test('a far deadline does not let a batch use the following Monday beyond the seven-day window', async () => {
  jest.setSystemTime(at('18:00'));
  expect(await findCourseworkStudyBatchSlots(context(), batchSources(2, '2026-12-31T18:00:00+08:00')))
    .toMatchObject({ kind: 'no-slot', unplacedIds: ['selected-1', 'selected-2'] });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['incomplete-timetable', 'unreadable-timetable', 'corrupt-calendar'] as const)(
  'batch and fixed-time reads do not treat %s as an empty calendar', async (problem) => {
    if (problem === 'incomplete-timetable') courses.push(course({ id: 'unplaced', dayOfWeek: undefined }));
    if (problem === 'unreadable-timetable') timetable.mockRejectedValue(new Error('native unavailable'));
    if (problem === 'corrupt-calendar') await originalSet(personalImportStorageKey(scope()), '{not-json');
    expect(await findCourseworkStudyBatchSlots(context(), batchSources())).toMatchObject({ kind: 'unavailable' });
    expect(await recheckCourseworkStudyTime(fixedTime(), assignment().dueAt!, context())).toMatchObject({ kind: 'unavailable' });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test('a serialized slot is not a proof; its fixed time can only obtain a restriction after fresh evidence reads', async () => {
  const result = await findCourseworkStudyBatchSlots(context(), batchSources());
  if (result.kind !== 'available') throw new Error(result.message);
  const copied = JSON.parse(JSON.stringify(result.slots[0].slot)) as CourseworkStudySlot;
  timetable.mockClear(); jest.mocked(AsyncStorage.getItem).mockClear();
  expect(await recheckCourseworkStudySlot(copied, context())).toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  const checked = await recheckCourseworkStudyTime(copied, assignment().dueAt!, context());
  expect(checked.kind).toBe('ready');
  if (checked.kind === 'ready') {
    expect(checked.writeCheck.isCurrent()).toBe(true);
    expect(checked.writeCheck.matches(await loadPersonalImports(scope()))).toBe(true);
  }
  expect(timetable).toHaveBeenCalledTimes(1);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(checked).not.toHaveProperty('proposal');
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test('a persisted time is captured before its fresh evidence read and cannot be changed while waiting', async () => {
  const pending = deferred<TimetableRead>();
  timetable.mockReturnValueOnce(pending.promise);
  const time = fixedTime();
  const work = recheckCourseworkStudyTime(time, assignment().dueAt!, context());
  time.date = '2026-12-31'; time.startTime = '08:00'; time.endTime = '08:30';
  await flush(); pending.resolve(source());
  const result = await work;
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') {
    jest.setSystemTime(at('10:10'));
    expect(result.writeCheck.isCurrent()).toBe(false);
  }
});

test.each([
  { date: '2026-02-30' }, { date: '2026/11/09' }, { startTime: '25:00' }, { endTime: '24:00' },
  { startTime: '10:1' }, { startTime: '10:10:00' }, { endTime: '10:39' }, { endTime: '11:10' },
  { startTime: '10:11', endTime: '10:41' }, { startTime: '23:50', endTime: '00:20' },
])('rejects malformed, shortened or off-policy persisted times before a read: %j', async (patch) => {
  expect(await recheckCourseworkStudyTime({ ...fixedTime(), ...patch }, assignment().dueAt!, context()))
    .toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test.each([
  { time: { date, startTime: '07:00', endTime: '07:30' }, dueAt: date + 'T18:00:00+08:00' },
  { time: { date: '2026-11-16', startTime: '10:10', endTime: '10:40' }, dueAt: '2026-12-31T18:00:00+08:00' },
  { time: { date, startTime: '10:10', endTime: '10:40' }, dueAt: date + 'T10:39:59+08:00' },
])('cannot restore a slot outside its future seven-day deadline window: %j', async ({ time, dueAt }) => {
  expect(await recheckCourseworkStudyTime(time, dueAt, context())).toMatchObject({ kind: 'changed' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['new-class', 'new-event', 'blank-day'] as const)(
  'fixed-time validation checks current availability instead of trusting a saved slot: %s', async (change) => {
    const time = fixedTime();
    if (change === 'new-class') courses.push(course({ id: 'new-class', startPeriod: 3, endPeriod: 3 }));
    if (change === 'new-event') await seed([event()]);
    if (change === 'blank-day') time.date = '2026-11-10';
    expect(await recheckCourseworkStudyTime(time, '2026-11-12T18:00:00+08:00', context())).toMatchObject({ kind: 'changed' });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test('each batch step can obtain a fresh ledger check after its predecessor really saves and reads back', async () => {
  const allocated = await findCourseworkStudyBatchSlots(context(), batchSources());
  if (allocated.kind !== 'available') throw new Error(allocated.message);
  const [first, second] = allocated.slots.map(({ slot }) => slot);
  const firstCheck = await recheckCourseworkStudyTime(first, assignment().dueAt!, context());
  const staleSecondCheck = await recheckCourseworkStudyTime(second, assignment().dueAt!, context());
  if (firstCheck.kind !== 'ready' || staleSecondCheck.kind !== 'ready') throw new Error('Expected fresh restrictions');
  const firstTask = createAssistantCalendarTask(calendarEvent(first, '第一份作業準備'), context());
  expect(await confirmAssistantCalendarTask(firstTask.proposal, context(), firstCheck.writeCheck))
    .toMatchObject({ state: 'verified' });
  expect(staleSecondCheck.writeCheck.isCurrent()).toBe(false);
  const secondCheck = await recheckCourseworkStudyTime(second, assignment().dueAt!, context());
  if (secondCheck.kind !== 'ready') throw new Error(secondCheck.message);
  expect(secondCheck.writeCheck.matches(await loadPersonalImports(scope()))).toBe(true);
  const secondTask = createAssistantCalendarTask(calendarEvent(second, '第二份作業準備'), context());
  expect(await confirmAssistantCalendarTask(secondTask.proposal, context(), secondCheck.writeCheck))
    .toMatchObject({ state: 'verified' });
  expect(ledgerWrites()).toHaveLength(2);
  expect((await loadPersonalImports(scope())).records.map((row) => [row.startTime, row.endTime]))
    .toEqual([['10:10', '10:40'], ['10:50', '11:20']]);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(2);
});

test('the fixed-time write restriction detects even an unnotified nonoverlapping ledger change inside the executor', async () => {
  const checked = await recheckCourseworkStudyTime(fixedTime(), assignment().dueAt!, context());
  if (checked.kind !== 'ready') throw new Error(checked.message);
  await seed([event({ startTime: '18:00', endTime: '19:00' })]);
  expect(checked.writeCheck.matches(await loadPersonalImports(scope()))).toBe(false);
  const task = createAssistantCalendarTask({ title: '準備行程', ...fixedTime(), allDay: false }, context());
  expect(await confirmAssistantCalendarTask(task.proposal, context(), checked.writeCheck)).toMatchObject({ state: 'blocked' });
  expect(ledgerWrites()).toHaveLength(0);
  expect((await loadPersonalImports(scope())).records).toHaveLength(1);
});

test.each(['abort', 'account', 'school', 'timetable'] as const)(
  'a completed fixed-time check cannot authorize a later write after %s changes', async (change) => {
    const abort = new AbortController();
    const checked = await recheckCourseworkStudyTime(fixedTime(), assignment().dueAt!, context(), { signal: abort.signal });
    if (checked.kind !== 'ready') throw new Error(checked.message);
    if (change === 'abort') abort.abort();
    if (change === 'account') accountId = 'pa_' + uuid(9999);
    if (change === 'school') schoolId = 'ncku';
    if (change === 'timetable') notifyTimetableChanged();
    expect(checked.writeCheck.isCurrent()).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test.each(['batch', 'fixed-time'] as const)('a pre-aborted %s lookup performs no evidence reads', async (kind) => {
  const abort = new AbortController(); abort.abort();
  const result = kind === 'batch'
    ? await findCourseworkStudyBatchSlots(context(), batchSources(), { signal: abort.signal })
    : await recheckCourseworkStudyTime(fixedTime(), assignment().dueAt!, context(), { signal: abort.signal });
  expect(result).toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
});

test.each(['batch', 'fixed-time'] as const)('the complete %s evidence read has a deadline and ignores a late result', async (kind) => {
  const pending = deferred<TimetableRead>();
  timetable.mockReturnValueOnce(pending.promise);
  const work = kind === 'batch' ? findCourseworkStudyBatchSlots(context(), batchSources())
    : recheckCourseworkStudyTime(fixedTime(), assignment().dueAt!, context());
  await flush();
  expect(timetable).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(20_001);
  expect(await work).toMatchObject({ kind: 'unavailable' });
  pending.resolve(source());
  await flush();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
