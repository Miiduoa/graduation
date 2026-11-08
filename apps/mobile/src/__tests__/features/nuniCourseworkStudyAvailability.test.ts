import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment } from '@campus/shared/src/nuni';
import {
  confirmCourseworkStudyDraft, findCourseworkStudyDrafts,
  type CourseworkStudyDraft, type CourseworkStudyResult,
} from '../../features/nuniCourseworkStudy';
import type { CourseworkRead } from '../../features/nuniCourseworkFollowUp';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import type { AssistantCalendarContext } from '../../services/assistantCalendarExecution';
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
