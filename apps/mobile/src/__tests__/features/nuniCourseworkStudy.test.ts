import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment } from '@campus/shared/src/nuni';
import { prepareCourseworkStudyDraft, confirmCourseworkStudyDraft, type CourseworkStudyDraft } from '../../features/nuniCourseworkStudy';
import type { CourseworkRead } from '../../features/nuniCourseworkFollowUp';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { createAssistantCalendarTask, confirmAssistantCalendarTask, type AssistantCalendarContext } from '../../services/assistantCalendarExecution';
import { readAssistantCalendarJournal } from '../../services/assistantCalendarJournal';
import { loadPersonalImports, personalImportStorageKey } from '../../services/personalImports';
import { notifyNuniAssignmentChanged } from '../../services/nuniAssignmentChanges';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('../../firebase', () => ({ getAuthInstance: () => ({ currentUser: { uid: 'campus-a' } }), isFirebaseMockMode: () => false }));
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const workspaceId = `cw_${uuid(1)}`;
const assignmentId = `cwa_${uuid(1)}`;
let accountId = '';
let schoolId = 'pu';
let active = true;
let sequence = 100;
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const timetable = jest.mocked(readAssistantTimetable);
const transport = { request: jest.fn(), bffRequest: jest.fn() };
const occurrence = {
  courseId: 'imported-db', name: '資料庫', date: '2026-11-05', term: '115|1', room: '305', startTime: '08:10', endTime: '10:00',
};
const record: PersonalImportRecord = {
  kind: 'timetable', schoolId: 'pu', id: occurrence.courseId, title: occurrence.name,
  batchId: 'fixture', academicYear: '115', semester: '1', dayOfWeek: 4, startPeriod: 1, endPeriod: 2,
  location: '305', linkedCourseId: workspaceId, importedAt: '2026-09-01T05:00:00Z',
  source: { type: 'paste', line: 1, rawText: '' },
};
const assignment = (fields: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: assignmentId, workspaceId, title: '期末資料模型', createdAt: '2026-11-04T05:00:00Z',
  closedAt: fields.state === 'closed' ? '2026-11-08T05:00:00Z' : null,
  dueAt: '2099-01-03T10:00:00Z', instructions: '私人的作業全文', state: 'open',
  unitId: null, unitTitle: null, mySubmission: null, submissionCount: 0, ...fields,
});
function read(rows = [assignment()]): CourseworkRead {
  return { anchor: { uid: '', owner: `nuni:${accountId}`, schoolId, classes: [{ ...occurrence }], updatedAt: null },
    checkedAt: new Date().toISOString(), result: { kind: 'assignments', limited: false,
      workspace: { id: workspaceId, title: '資料庫 A 班' },
      assignments: rows.map((row) => ({ id: row.id, title: row.title, dueAt: row.dueAt,
        state: row.state, submittedAt: row.mySubmission?.submittedAt ?? null })),
    } };
}
function context(): AssistantCalendarContext {
  const account = accountId, school = schoolId;
  const valid = () => active && accountId === account && schoolId === school;
  return { uid: '', schoolId: school, isCurrent: valid, platformTimetable: { accountId: account, isCurrent: valid } };
}
const time = { date: '2099-01-02', startTime: '19:00', endTime: '19:30' };
const scope = () => ({ owner: `nuni:${accountId}`, schoolId });
const prepare = (snapshot = read(), id = assignmentId) => prepareCourseworkStudyDraft(snapshot, id, time, context());
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key.startsWith('campus.personal-imports.v1:'));
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear(); jest.clearAllMocks();
  accountId = `pa_${uuid(++sequence)}`; schoolId = 'pu'; active = true;
  timetable.mockResolvedValue({ timetable: null, schoolId, updatedAt: record.importedAt, records: [record] });
  transport.request.mockResolvedValue({ workspaces: [{ id: workspaceId, title: '資料庫 A 班', state: 'active', memberRole: 'student' }] });
  transport.bffRequest.mockResolvedValue({ assignments: [assignment()] });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('preview is immutable and has no storage, network or generic operation; confirmation saves and verifies the real row', async () => {
  const draft = prepare();
  expect(Object.isFrozen(draft) && Object.isFrozen(draft.event) && Object.isFrozen(draft.source)).toBe(true);
  expect(draft.event).toEqual({ title: '準備：期末資料模型', ...time, allDay: false });
  expect(draft.source).toMatchObject({ owner: scope().owner, schoolId: 'pu', workspaceId, assignmentId,
    dueAt: assignment().dueAt, title: assignment().title });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(transport.request).not.toHaveBeenCalled(); expect(transport.bffRequest).not.toHaveBeenCalled();
  const result = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(result).toMatchObject({ kind: 'calendar', sourceCheckedAt: expect.any(String), task: { state: 'verified' } });
  if (result.kind !== 'calendar' || result.task.state !== 'verified') throw new Error('expected an actual receipt');
  const ledger = await loadPersonalImports(scope());
  expect(ledger.records).toHaveLength(1);
  expect(ledger.records[0]).toEqual(result.task.receipt.record);
  expect(ledger.records[0].source.rawText).toBe('');
  expect(ledgerWrites()).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(1);
  expect(transport.request.mock.calls).toEqual([['class-workspaces']]);
  expect(transport.bffRequest.mock.calls).toEqual([[`class-workspaces/${workspaceId}/assignments`]]);
});

test('later mutation of the caller snapshot cannot change the frozen source used for confirmation', async () => {
  const snapshot = read(); const draft = prepare(snapshot);
  if (snapshot.result.kind !== 'assignments') throw new Error('fixture');
  snapshot.result.assignments[0].id = 'replacement';
  snapshot.anchor.classes[0].courseId = 'replacement-course';
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'calendar', task: { state: 'verified' } });
});

test('a JSON copy cannot restore a preview capability', async () => {
  const copied = JSON.parse(JSON.stringify(prepare())) as CourseworkStudyDraft;
  expect(await confirmCourseworkStudyDraft(copied, context(), transport)).toMatchObject({ kind: 'blocked' });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(transport.request).not.toHaveBeenCalled();
});

test.each([
  null, '2099-01-03', '2099-01-03T18:00:00', '2099-02-30T18:00:00+08:00',
  '2099-01-03T25:00:00+08:00', '2099-01-03T18:00:60+08:00', '2099-01-03T18:00:00+25:00',
])('a deadline without a valid date, exact clock and explicit timezone is not actionable: %s', (dueAt) => {
  expect(() => prepare(read([assignment({ dueAt })]))).toThrow(/明確截止時間/);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([
  { date: '2099-02-30' }, { date: '2020-01-02' }, { startTime: '19:30' },
  { startTime: '25:00' }, { date: '2099-01-03' },
])('invalid, elapsed or post-deadline study windows cannot be previewed: %j', (change) => {
  expect(() => prepareCourseworkStudyDraft(read(), assignmentId, { ...time, ...change }, context())).toThrow();
});

test.each(['owner', 'school', 'changed', 'duplicate', 'checkedAt', 'closed', 'submitted'] as const)(
  'invalid source %s cannot create a draft', (problem) => {
    const snapshot = read();
    if (snapshot.result.kind !== 'assignments') throw new Error('fixture');
    if (problem === 'owner') snapshot.anchor.owner = 'nuni:other';
    if (problem === 'school') snapshot.anchor.schoolId = 'ncku';
    if (problem === 'changed') snapshot.changedAssignmentId = assignmentId;
    if (problem === 'duplicate') snapshot.result.assignments.push({ ...snapshot.result.assignments[0] });
    if (problem === 'checkedAt') snapshot.checkedAt = '2026-11-08';
    if (problem === 'closed') snapshot.result.assignments[0].state = 'closed';
    if (problem === 'submitted') snapshot.result.assignments[0].submittedAt = '2026-11-08T05:00:00Z';
    expect(() => prepare(snapshot)).toThrow();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test.each([
  { title: '改名的作業' }, { dueAt: '2099-01-04T10:00:00Z' }, { state: 'closed' as const },
])('fresh assignment changes prevent any operation attempt: %j', async (change) => {
  const draft = prepare();
  transport.bffRequest.mockResolvedValue({ assignments: [assignment(change)] });
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'changed' });
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
  expect(ledgerWrites()).toHaveLength(0);
});

test('a fresh actual submission receipt prevents a new study operation', async () => {
  const draft = prepare();
  transport.bffRequest.mockResolvedValue({ assignments: [assignment({ mySubmission: {
    assignmentId, platformAccountId: accountId, displayName: '學生', body: '私人的繳交內容', state: 'submitted',
    submittedAt: '2026-11-08T05:00:00Z', teacherFeedback: null, reviewedAt: null,
  } })] });
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'changed' });
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test.each(['membership', 'binding', 'missing'] as const)('lost %s never switches to a different same-name source', async (problem) => {
  const draft = prepare();
  if (problem === 'membership') transport.request.mockResolvedValue({ workspaces: [] });
  if (problem === 'binding') timetable.mockResolvedValue({ timetable: null, schoolId, updatedAt: record.importedAt,
    records: [{ ...record, linkedCourseId: `cw_${uuid(2)}` }] });
  if (problem === 'missing') transport.bffRequest.mockResolvedValue({ assignments: [assignment({ id: `cwa_${uuid(2)}` })] });
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'changed' });
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});

test('source unavailability makes no attempt and allows a new explicit review after a successful refresh', async () => {
  const draft = prepare(); transport.bffRequest.mockRejectedValueOnce(new Error('network unavailable'));
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'unavailable' });
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
  expect(await confirmCourseworkStudyDraft(prepare(), context(), transport)).toMatchObject({ kind: 'calendar', task: { state: 'verified' } });
  expect(ledgerWrites()).toHaveLength(1);
});

test('double pressing the same draft shares one source read and one ledger write', async () => {
  const draft = prepare(); const access = context();
  const first = confirmCourseworkStudyDraft(draft, access, transport);
  const second = confirmCourseworkStudyDraft(draft, access, transport);
  expect(second).toBe(first);
  expect(await first).toMatchObject({ kind: 'calendar', task: { state: 'verified' } });
  expect(transport.bffRequest).toHaveBeenCalledTimes(1); expect(ledgerWrites()).toHaveLength(1);
});

test('different same-name assignments cannot borrow a concurrent or persisted completion', async () => {
  const second = assignment({ id: `cwa_${uuid(2)}` });
  const snapshot = read([assignment(), second]);
  const firstDraft = prepare(snapshot); const secondDraft = prepare(snapshot, second.id);
  const pending = deferred<{ assignments: NuniAssignment[] }>(); transport.bffRequest.mockReturnValueOnce(pending.promise);
  const first = confirmCourseworkStudyDraft(firstDraft, context(), transport);
  const blocked = await confirmCourseworkStudyDraft(secondDraft, context(), transport);
  expect(blocked).toMatchObject({ kind: 'blocked' });
  await flush(); pending.resolve({ assignments: [assignment(), second] });
  expect(await first).toMatchObject({ kind: 'calendar', task: { state: 'verified' } });
  expect(await confirmCourseworkStudyDraft(secondDraft, context(), transport)).toMatchObject({ kind: 'blocked' });
  expect(transport.bffRequest).toHaveBeenCalledTimes(1); expect(ledgerWrites()).toHaveLength(1);
});

test('a generic matching receipt is never presented as this assignment source completing a new action', async () => {
  const draft = prepare();
  const generic = createAssistantCalendarTask(draft.event, context());
  await confirmAssistantCalendarTask(generic.proposal, context());
  const result = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(result).toMatchObject({ kind: 'blocked' });
  expect(transport.bffRequest).not.toHaveBeenCalled(); expect(ledgerWrites()).toHaveLength(1);
});

test('a generic action winning the ledger race cannot turn into borrowed source evidence', async () => {
  const draft = prepare();
  transport.bffRequest.mockImplementationOnce(async () => {
    const generic = createAssistantCalendarTask(draft.event, context());
    await confirmAssistantCalendarTask(generic.proposal, context());
    return { assignments: [assignment()] };
  });
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'blocked' });
  expect(ledgerWrites()).toHaveLength(1);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(1);
});

test('an unknown native result is rechecked using only the original operation ID, without another source read or append', async () => {
  const draft = prepare(); const key = personalImportStorageKey(scope()); let written = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (storageKey, value) => {
    await originalSet(storageKey, value); if (storageKey === key) { written = true; throw new Error('lost native reply'); }
  });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (storageKey) => {
    if (storageKey === key && written) throw new Error('temporarily unreadable');
    return originalGet(storageKey);
  });
  const initial = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(initial).toMatchObject({ kind: 'calendar', task: { state: 'unknown' } });
  if (initial.kind !== 'calendar') throw new Error('missing original operation');
  jest.mocked(AsyncStorage.getItem).mockImplementation(originalGet);
  const next = await confirmCourseworkStudyDraft(draft, context(), transport);
  expect(next).toMatchObject({ kind: 'calendar', task: { state: 'verified', proposal: { mutationId: initial.task.proposal.mutationId } } });
  expect(ledgerWrites()).toHaveLength(1); expect(transport.bffRequest).toHaveBeenCalledTimes(1);
});

test('a source change before confirmation invalidates the preview even if a later transport response would look unchanged', async () => {
  const draft = prepare();
  notifyNuniAssignmentChanged({ accountId, context: 'a'.repeat(43), workspaceId, assignmentId });
  expect(await confirmCourseworkStudyDraft(draft, context(), transport)).toMatchObject({ kind: 'changed' });
  expect(AsyncStorage.getItem).not.toHaveBeenCalled(); expect(transport.request).not.toHaveBeenCalled();
});

test.each(['abort', 'source', 'account', 'school'] as const)('a %s while reading the source prevents any late write', async (interruption) => {
  const draft = prepare(); const access = context(); const originalScope = scope();
  const pending = deferred<{ assignments: NuniAssignment[] }>(); transport.bffRequest.mockReturnValueOnce(pending.promise);
  const abort = new AbortController(); const work = confirmCourseworkStudyDraft(draft, access, transport, { signal: abort.signal });
  await flush(); expect(transport.bffRequest).toHaveBeenCalledTimes(1);
  if (interruption === 'abort') abort.abort();
  if (interruption === 'source') notifyNuniAssignmentChanged({ accountId, context: 'a'.repeat(43), workspaceId, assignmentId });
  if (interruption === 'account') accountId = `pa_${uuid(9999)}`;
  if (interruption === 'school') schoolId = 'ncku';
  pending.resolve({ assignments: [assignment()] });
  expect(await work).toMatchObject({ kind: interruption === 'source' ? 'changed' : 'blocked' });
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(originalScope, () => true)).toHaveLength(0);
});

test('a timed-out source returns promptly and its late response never creates an operation', async () => {
  jest.useFakeTimers();
  const draft = prepare(); const pending = deferred<{ assignments: NuniAssignment[] }>();
  transport.bffRequest.mockReturnValueOnce(pending.promise);
  const work = confirmCourseworkStudyDraft(draft, context(), transport);
  await flush(); expect(transport.bffRequest).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(20_001);
  expect(await work).toMatchObject({ kind: 'unavailable' });
  pending.resolve({ assignments: [assignment()] }); await flush();
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope(), () => true)).toHaveLength(0);
});
