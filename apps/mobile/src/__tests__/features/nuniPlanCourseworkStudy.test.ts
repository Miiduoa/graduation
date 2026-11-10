import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import { readNuniPlanCourseworkStudy } from '../../features/nuniPlanCourseworkStudy';
import type { CourseworkRequests } from '../../features/nuniCourseworkFollowUp';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import type { AssistantCalendarContext } from '../../services/assistantCalendarExecution';
import type { NuniPlanAssignmentSource } from '../../services/nuniPlanAssignmentTarget';
import { notifyNuniAssignmentChanged } from '../../services/nuniAssignmentChanges';
import { notifyTimetableChanged } from '../../widgets/timetableChanges';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: null }), isFirebaseMockMode: () => false,
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const workspaceId = 'cw_' + uuid(1);
const assignmentId = 'cwa_' + uuid(1);
const date = '2026-11-09';
const now = Date.parse(date + 'T07:00:00+08:00');
const workspacePath = `class-workspaces/${workspaceId}`;
const assignmentsPath = `${workspacePath}/assignments`;
const target: NuniPlanAssignmentSource = {
  accountId, schoolId: 'pu', academicYear: '115', semester: '1', workspaceId, assignmentId,
};
const source = (): NuniPlanAssignmentSource => ({ ...target });
const course = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'database-meeting', kind: 'timetable', title: '資料庫', schoolId: 'pu',
  academicYear: '115', semester: '1', linkedCourseId: workspaceId,
  dayOfWeek: 1, startPeriod: 1, endPeriod: 2, location: '305',
  batchId: 'test-import', importedAt: '2026-09-01T05:00:00Z',
  source: { type: 'paste', line: 1, rawText: '不應外傳的原始匯入文字' }, ...patch,
});
const workspace = (patch: Partial<NuniWorkspace> = {}): NuniWorkspace => ({
  id: workspaceId, title: '資料庫', state: 'active', memberRole: 'student', ...patch,
});
const assignment = (patch: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: assignmentId, workspaceId, title: '資料模型報告', state: 'open',
  dueAt: date + 'T18:00:00+08:00', createdAt: '2026-11-04T05:00:00Z', closedAt: null,
  instructions: '不應帶進準備行程的私人作業全文', unitId: null, unitTitle: null,
  mySubmission: null, submissionCount: 0, ...patch,
});
const reviewed = (patch: Record<string, unknown> = {}) => ({
  workspaceId, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: 'ccd_' + uuid(1), version: 1, workspaceId, verification: 'administrator-reviewed',
    title: '資料庫', schoolId: 'pu', academicYear: '115', semester: '1',
    courseCode: 'MIS302', teacher: '張老師', className: '資管三甲', ...patch },
});
type TimetableRead = NonNullable<Awaited<ReturnType<typeof readAssistantTimetable>>>;
const timetable = jest.mocked(readAssistantTimetable);
const request = jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>();
const bffRequest = jest.fn<Promise<unknown>, [string]>();
const transport: CourseworkRequests = { request, bffRequest };
let records: PersonalImportRecord[];
let active: boolean;
let platformActive: boolean;
let context: AssistantCalendarContext;
let updatedAt: string | null;
const local = (): TimetableRead => ({ timetable: null, schoolId: 'pu', records, updatedAt });
const input = () => ({ source: source(), context, transport });
const defaultRequest = async (path: string): Promise<unknown> => {
  if (path === workspacePath) return workspace();
  if (path === 'class-workspaces') return { workspaces: [workspace()] };
  if (path === 'course-access/workspace-course') return reviewed();
  throw new Error('Unexpected platform read: ' + path);
};
const flush = async () => { for (let n = 0; n < 80; n++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const manyAssignments = (length: number, includeSelected: boolean) => Array.from({ length }, (_, index) =>
  assignment({ id: includeSelected && index === 0 ? assignmentId : 'cwa_' + uuid(index + 100) }));
const notifyAssignment = (patch: Partial<Parameters<typeof notifyNuniAssignmentChanged>[0]> = {}) =>
  notifyNuniAssignmentChanged({ accountId, workspaceId, assignmentId, context: 'not-a-navigation-token', ...patch });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  jest.clearAllMocks();
  records = [course()];
  updatedAt = '2026-11-08T05:00:00Z';
  active = true; platformActive = true;
  context = { uid: '', schoolId: 'pu', isCurrent: () => active,
    platformTimetable: { accountId, isCurrent: () => platformActive } };
  timetable.mockReset().mockImplementation(async () => local());
  request.mockReset().mockImplementation(defaultRequest);
  bffRequest.mockReset().mockImplementation(async () => ({ assignments: [assignment()] }));
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('uses real target and coursework readers to return one fresh, exact source without a write grant', async () => {
  const result = await readNuniPlanCourseworkStudy(input());
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error(result.message);
  expect(result.assignmentId).toBe(assignmentId);
  expect(result.read).toMatchObject({
    checkedAt: new Date(now).toISOString(), selectedWorkspaceId: workspaceId,
    expectedLinkedWorkspaceId: workspaceId,
    expectedReviewed: { schoolId: 'pu', academicYear: '115', semester: '1', courseCode: 'MIS302' },
    anchor: { uid: '', owner: 'nuni:' + accountId, schoolId: 'pu', updatedAt,
      classes: [{ courseId: 'database-meeting', date, startTime: '08:10', endTime: '10:00', term: '115|1' }] },
    result: { kind: 'assignments', workspace: { id: workspaceId }, limited: false,
      assignments: [{ id: assignmentId, title: '資料模型報告', state: 'open', submittedAt: null }] },
  });
  expect(result.read.anchor.classes).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(workspacePath, undefined);
  expect(request).toHaveBeenCalledWith('class-workspaces', undefined);
  expect(request).toHaveBeenCalledWith('course-access/workspace-course', { workspaceId, schoolId: 'pu' });
  expect(bffRequest).toHaveBeenCalledWith(assignmentsPath);
  expect(JSON.stringify(result)).not.toMatch(/原始匯入文字|私人作業全文|not-a-navigation-token/);
  expect(result).not.toHaveProperty('event');
  expect(result).not.toHaveProperty('proposal');
  expect(result).not.toHaveProperty('draft');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('selects the exact assignment when names and due dates are identical', async () => {
  bffRequest.mockResolvedValue({ assignments: [assignment({ id: 'cwa_' + uuid(2) }), assignment()] });
  const result = await readNuniPlanCourseworkStudy(input());
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') expect(result.assignmentId).toBe(assignmentId);
});

test('keeps explicitly linked unreviewed courses usable after current student and source reads', async () => {
  request.mockImplementation(async (path) => path === 'course-access/workspace-course'
    ? { workspaceId, status: 'unreviewed', membershipActive: true, memberRole: 'student', course: null }
    : defaultRequest(path));
  const result = await readNuniPlanCourseworkStudy(input());
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') {
    expect(result.read.expectedReviewed).toBeUndefined();
    expect(result.read.expectedLinkedWorkspaceId).toBe(workspaceId);
  }
});

test('one workspace with several saved meetings produces one real anchor and tolerates row reordering', async () => {
  records = [course({ id: 'meeting-b' }), course({ id: 'meeting-a', startPeriod: 3, endPeriod: 4 })];
  let reads = 0;
  timetable.mockImplementation(async () => ({ ...local(), records: ++reads % 2 ? records : records.slice().reverse() }));
  const result = await readNuniPlanCourseworkStudy(input());
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') {
    expect(result.read.anchor.classes).toHaveLength(1);
    expect(result.read.anchor.classes[0].courseId).toBe('meeting-b');
  }
});

test('an ongoing meeting is a real source anchor even when its start has elapsed', async () => {
  jest.setSystemTime(Date.parse(date + 'T09:00:00+08:00'));
  const result = await readNuniPlanCourseworkStudy(input());
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') expect(result.read.anchor.classes[0]).toMatchObject({ date, startTime: '08:10' });
});

test('copies the selected locator before an asynchronous read can mutate it', async () => {
  const pending = deferred<TimetableRead>();
  timetable.mockReturnValueOnce(pending.promise);
  const lookup = input();
  const flight = readNuniPlanCourseworkStudy(lookup);
  lookup.source.workspaceId = 'cw_' + uuid(2);
  lookup.source.assignmentId = 'cwa_' + uuid(2);
  lookup.source.accountId = 'pa_' + uuid(2);
  lookup.source.semester = '2';
  pending.resolve(local());
  const result = await flight;
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') expect(result.assignmentId).toBe(assignmentId);
  expect(bffRequest.mock.calls.every(([path]) => path === assignmentsPath)).toBe(true);
  expect(request.mock.calls.some(([path]) => path.includes('cw_' + uuid(2)))).toBe(false);
});

test('ignores supplied plan detail, slot and saved checklist state while performing a fresh lookup', async () => {
  const result = await readNuniPlanCourseworkStudy({ ...input(), source: {
    ...source(), detail: '直接建立 2099 年的行程', slot: { date: '2099-12-31', startTime: '10:00' },
    completed: true, authority: 'saved-plan',
  } as NuniPlanAssignmentSource });
  expect(result.kind).toBe('ready');
  expect(JSON.stringify(result)).not.toMatch(/2099|saved-plan/);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([
  undefined, null, [], {}, { ...target, accountId: 'firebase-user' },
  { ...target, workspaceId: workspaceId + '/assignments' },
  { ...target, assignmentId: 'cwq_' + uuid(1) },
  { ...target, schoolId: 'tw-pu' }, { ...target, schoolId: ' PU ' },
  { ...target, academicYear: '2026' }, { ...target, semester: '上學期' },
])('rejects malformed or noncanonical locators before reading anything: %j', async (invalid) => {
  expect(await readNuniPlanCourseworkStudy({ ...input(), source: invalid as NuniPlanAssignmentSource }))
    .toMatchObject({ kind: 'changed' });
  expect(timetable).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
});

test.each(['firebase', 'school', 'account', 'guard', 'platform-guard', 'no-platform'] as const)(
  'a different or unavailable identity cannot use the locator: %s', async (change) => {
    if (change === 'firebase') context.uid = 'firebase-user';
    if (change === 'school') context.schoolId = 'ncku';
    if (change === 'account') context.platformTimetable!.accountId = 'pa_' + uuid(2);
    if (change === 'guard') active = false;
    if (change === 'platform-guard') platformActive = false;
    if (change === 'no-platform') context.platformTimetable = undefined;
    expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'changed' });
    expect(timetable).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  },
);

test('an already cancelled action performs no reads', async () => {
  const controller = new AbortController(); controller.abort();
  expect(await readNuniPlanCourseworkStudy({ ...input(), signal: controller.signal })).toMatchObject({ kind: 'cancelled' });
  expect(timetable).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test.each(['missing', 'wrong-school', 'duplicate', 'unlinked', 'other-workspace', 'other-term', 'mixed-term'] as const)(
  'never fabricates a matching source from unusable bindings: %s', async (change) => {
    if (change === 'missing') timetable.mockResolvedValue(null);
    if (change === 'wrong-school') timetable.mockImplementation(async () => ({ ...local(), schoolId: 'ncku' }));
    if (change === 'duplicate') records = [course(), course()];
    if (change === 'unlinked') records = [course({ linkedCourseId: undefined })];
    if (change === 'other-workspace') records = [course({ linkedCourseId: 'cw_' + uuid(2) })];
    if (change === 'other-term') records = [course({ academicYear: '114' })];
    if (change === 'mixed-term') records = [course(), course({ id: 'other-term', academicYear: '114' })];
    const result = await readNuniPlanCourseworkStudy(input());
    expect(['changed', 'unavailable']).toContain(result.kind);
    expect(request).not.toHaveBeenCalled();
    expect(bffRequest).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test.each(['unscheduled', 'invalid-clock', 'old-term'] as const)(
  'does not synthesize an occurrence when the linked plan task has no usable recent class: %s', async (reason) => {
    if (reason === 'unscheduled') records = [course({ dayOfWeek: undefined })];
    if (reason === 'invalid-clock') records = [course({ startPeriod: undefined, endPeriod: undefined, startTime: '25:30' })];
    if (reason === 'old-term') jest.setSystemTime(Date.parse('2027-03-01T07:00:00+08:00'));
    const result = await readNuniPlanCourseworkStudy(input());
    expect(result.kind).toBe('unavailable');
    expect(request).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test.each(['link', 'clock', 'term', 'unrelated-row', 'updatedAt'] as const)(
  'detects source and timetable changes across remote reads without relying on a notification: %s', async (change) => {
    bffRequest.mockImplementationOnce(async () => {
      if (change === 'link') records = [course({ linkedCourseId: 'cw_' + uuid(2) })];
      if (change === 'clock') records = [course({ startPeriod: 3, endPeriod: 4 })];
      if (change === 'term') records = [course({ semester: '2' })];
      if (change === 'unrelated-row') records = [course(), course({ id: 'another-course', linkedCourseId: undefined })];
      if (change === 'updatedAt') updatedAt = '2026-11-09T00:01:00Z';
      return { assignments: [assignment()] };
    });
    const result = await readNuniPlanCourseworkStudy(input());
    expect(result.kind).toBe('changed');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  },
);

test.each([1, 2])('rejects more than 100 source rows on assignment read %i instead of using a sliced result', async (readNumber) => {
  if (readNumber === 2) bffRequest.mockResolvedValueOnce({ assignments: [assignment()] });
  bffRequest.mockResolvedValue({ assignments: manyAssignments(101, true) });
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'unavailable' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([1, 2])('rejects duplicate source IDs on assignment read %i', async (readNumber) => {
  if (readNumber === 2) bffRequest.mockResolvedValueOnce({ assignments: [assignment()] });
  bffRequest.mockResolvedValue({ assignments: [assignment(), assignment()] });
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'unavailable' });
});

test.each([1, 2])('does not call an omitted selected assignment completed at the 100-row limit, read %i', async (readNumber) => {
  if (readNumber === 2) bffRequest.mockResolvedValueOnce({ assignments: [assignment()] });
  bffRequest.mockResolvedValue({ assignments: manyAssignments(100, false) });
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'unavailable' });
});

test('a selected assignment present at the source limit is still an exact usable source', async () => {
  bffRequest.mockResolvedValue({ assignments: manyAssignments(100, true) });
  const result = await readNuniPlanCourseworkStudy(input());
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready' && result.read.result.kind === 'assignments') expect(result.read.result.limited).toBe(true);
});

test.each([
  { assignments: [] }, { assignments: [assignment({ id: 'cwa_' + uuid(2) })] },
])('reports a missing exact assignment without selecting another name match: %j', async (value) => {
  bffRequest.mockResolvedValue(value);
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'changed' });
});

test.each([
  {}, { assignments: null }, { assignments: 'unreadable' },
  { assignments: [assignment({ workspaceId: 'cw_' + uuid(2) })] },
])('source failure or malformed rows do not become an empty successful read: %j', async (value) => {
  bffRequest.mockResolvedValue(value);
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'unavailable' });
});

test.each([{ state: 'archived' as const }, { memberRole: 'owner-teacher' as const }])(
  'rejects an inactive or nonstudent membership before reading assignments: %j', async (patch) => {
    request.mockImplementation(async (path) => path === workspacePath ? workspace(patch) : defaultRequest(path));
    expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'changed' });
    expect(bffRequest).not.toHaveBeenCalled();
  },
);

test.each([{ academicYear: '114' }, { semester: '2' }])('refuses a reviewed course in a different source term: %j', async (patch) => {
  request.mockImplementation(async (path) => path === 'course-access/workspace-course' ? reviewed(patch) : defaultRequest(path));
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'changed' });
  expect(bffRequest).not.toHaveBeenCalled();
});

test('keeps directory metadata in the read so a subsequent source recheck can detect a changed class', async () => {
  let directories = 0;
  request.mockImplementation(async (path) => path === 'course-access/workspace-course'
    ? reviewed(++directories === 1 ? {} : { className: '別的班級' }) : defaultRequest(path));
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'changed' });
});

test.each([
  { state: 'closed' as const, closedAt: '2026-11-08T05:00:00Z' },
  { dueAt: null }, { dueAt: date + 'T06:00:00+08:00' },
])('a non-actionable exact assignment is reread before refusing a preparation action: %j', async (patch) => {
  bffRequest.mockResolvedValue({ assignments: [assignment(patch)] });
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: 'changed' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each([401, 403, 404, 503])('handles a real source error %i without producing a source grant', async (status) => {
  request.mockRejectedValue(new NuniError(status, 'UNAVAILABLE'));
  expect(await readNuniPlanCourseworkStudy(input())).toMatchObject({ kind: status === 503 ? 'unavailable' : 'changed' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['timetable', 'workspace', 'assignments'] as const)('bounds the complete lookup when %s stalls', async (stage) => {
  const pending = deferred<unknown>();
  if (stage === 'timetable') timetable.mockReturnValueOnce(pending.promise as Promise<TimetableRead>);
  if (stage === 'workspace') request.mockReturnValueOnce(pending.promise);
  if (stage === 'assignments') bffRequest.mockReturnValueOnce(pending.promise);
  const flight = readNuniPlanCourseworkStudy(input());
  await flush();
  await jest.advanceTimersByTimeAsync(20_000);
  expect(await flight).toMatchObject({ kind: 'unavailable', message: expect.stringContaining('等待時間已過') });
  const reads = request.mock.calls.length + bffRequest.mock.calls.length;
  pending.resolve(stage === 'timetable' ? local() : stage === 'workspace' ? workspace() : { assignments: [assignment()] });
  await flush();
  expect(request.mock.calls.length + bffRequest.mock.calls.length).toBe(reads);
  expect(jest.getTimerCount()).toBe(0);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('cancels an in-flight read immediately and consumes a late rejection', async () => {
  const pending = deferred<unknown>();
  bffRequest.mockReturnValueOnce(pending.promise);
  const controller = new AbortController();
  const flight = readNuniPlanCourseworkStudy({ ...input(), signal: controller.signal });
  await flush();
  expect(bffRequest).toHaveBeenCalled();
  controller.abort();
  expect(await flight).toMatchObject({ kind: 'cancelled' });
  const reads = request.mock.calls.length;
  pending.reject(new Error('late offline result'));
  await flush();
  expect(request.mock.calls.length).toBe(reads);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['account', 'school', 'guard'] as const)('does not continue across an identity change during a read: %s', async (change) => {
  const pending = deferred<unknown>();
  request.mockReturnValueOnce(pending.promise);
  const flight = readNuniPlanCourseworkStudy(input());
  await flush();
  if (change === 'account') context.platformTimetable!.accountId = 'pa_' + uuid(2);
  if (change === 'school') context.schoolId = 'ncku';
  if (change === 'guard') active = false;
  pending.resolve(workspace());
  expect(await flight).toMatchObject({ kind: 'changed' });
  expect(bffRequest).not.toHaveBeenCalled();
});

test.each(['assignment', 'timetable'] as const)('invalidates an in-flight source on a %s change even if the data later looks unchanged', async (change) => {
  const pending = deferred<unknown>();
  bffRequest.mockReturnValueOnce(pending.promise);
  const flight = readNuniPlanCourseworkStudy(input());
  await flush();
  if (change === 'assignment') notifyAssignment(); else notifyTimetableChanged();
  expect(await flight).toMatchObject({ kind: 'changed' });
  pending.resolve({ assignments: [assignment()] });
  await flush();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  { accountId: 'pa_' + uuid(2) }, { workspaceId: 'cw_' + uuid(2) }, { assignmentId: 'cwa_' + uuid(2) },
])('unrelated assignment notifications do not revoke this exact source: %j', async (patch) => {
  const pending = deferred<unknown>();
  bffRequest.mockReturnValueOnce(pending.promise);
  const flight = readNuniPlanCourseworkStudy(input());
  await flush();
  notifyAssignment(patch);
  pending.resolve({ assignments: [assignment()] });
  expect(await flight).toMatchObject({ kind: 'ready' });
});
