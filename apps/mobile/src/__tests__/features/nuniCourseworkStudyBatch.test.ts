import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment, NuniWorkspace } from '@campus/shared/src/nuni';
import {
  createNuniCourseworkStudyBatchChecks, prepareNuniCourseworkStudyBatch,
} from '../../features/nuniCourseworkStudyBatch';
import type { CourseworkRequests } from '../../features/nuniCourseworkFollowUp';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import {
  confirmAssistantCalendarTask, createAssistantCalendarTask, type AssistantCalendarContext,
} from '../../services/assistantCalendarExecution';
import {
  confirmAssistantCalendarBatch, restoreAssistantCalendarBatches,
} from '../../services/assistantCalendarBatchExecution';
import {
  assistantCalendarBatchStorageKey, type AssistantCalendarBatchPlan, type AssistantCalendarBatchStep,
} from '../../services/assistantCalendarBatchStore';
import { assistantCalendarJournalStorageKey, readAssistantCalendarJournal } from '../../services/assistantCalendarJournal';
import type { NuniPlanAssignmentSource } from '../../services/nuniPlanAssignmentTarget';
import { notifyNuniAssignmentChanged } from '../../services/nuniAssignmentChanges';
import {
  appendPersonalImports, loadPersonalImports, personalImportStorageKey, snapshotPersonalImports,
} from '../../services/personalImports';
import { notifyTimetableChanged } from '../../widgets/timetableChanges';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: null }), isFirebaseMockMode: () => false,
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

// Source readers, allocation, preview storage, runner, journal and ledger are
// real. Only transport/native boundaries and the clock are substituted.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const date = '2026-11-09';
const now = Date.parse(date + 'T07:00:00+08:00');
const scope = { owner: 'nuni:' + accountId, schoolId: 'pu' };
const ledgerKey = personalImportStorageKey(scope);
const batchKey = assistantCalendarBatchStorageKey(scope);
const journalKey = assistantCalendarJournalStorageKey(scope);
const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
const timetable = jest.mocked(readAssistantTimetable);
const request = jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>();
const bffRequest = jest.fn<Promise<unknown>, [string]>();
const transport: CourseworkRequests = { request, bffRequest };
const courseNames = ['資料庫', '網頁設計', '系統分析', '統計學'];
const assignmentTitles = ['資料模型報告', '網頁切版', '系統需求文件', '統計練習'];
const source = (index = 0): NuniPlanAssignmentSource => ({
  accountId, schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: 'cw_' + uuid(index + 1), assignmentId: 'cwa_' + uuid(index + 1),
});
const assignmentPath = (index = 0) => `class-workspaces/${source(index).workspaceId}/assignments`;
const course = (index = 0, patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'meeting-' + (index + 1), kind: 'timetable', title: courseNames[index], schoolId: 'pu',
  academicYear: '115', semester: '1', linkedCourseId: source(index).workspaceId,
  dayOfWeek: index < 2 ? 1 : 2, startTime: index % 2 ? '13:00' : '09:00',
  endTime: index % 2 ? '14:00' : '10:00', location: '305',
  teacher: '張老師', courseCode: 'MIS30' + (index + 1), className: '資管三甲',
  batchId: 'fixture', importedAt: '2026-11-01T05:00:00Z',
  source: { type: 'paste', line: index + 1, rawText: '不應外傳的匯入原文' }, ...patch,
});
const assignment = (index = 0, patch: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: source(index).assignmentId, workspaceId: source(index).workspaceId, title: assignmentTitles[index],
  state: 'open', dueAt: (index ? '2026-11-10' : date) + 'T18:00:00+08:00',
  createdAt: '2026-11-04T05:00:00Z', closedAt: null, instructions: '不應外傳的私人作業全文',
  unitId: null, unitTitle: null, mySubmission: null, submissionCount: 0, ...patch,
});
const reviewed = (index = 0, patch: Record<string, unknown> = {}) => ({
  workspaceId: source(index).workspaceId, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: 'ccd_' + uuid(index + 1), version: 1, workspaceId: source(index).workspaceId,
    verification: 'administrator-reviewed', title: courseNames[index], schoolId: 'pu', academicYear: '115', semester: '1',
    courseCode: 'MIS30' + (index + 1), teacher: '張老師', className: '資管三甲', ...patch },
});
const manualEvent = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'manual-event', kind: 'events', title: '個人行程', schoolId: 'pu', academicYear: '', semester: '',
  date, allDay: false, startTime: '16:00', endTime: '16:30', batchId: 'manual-batch',
  importedAt: '2026-11-08T05:00:00Z', source: { type: 'paste', line: 1, rawText: '' }, ...patch,
});
type TimetableRead = NonNullable<Awaited<ReturnType<typeof readAssistantTimetable>>>;
let records: PersonalImportRecord[];
let workspaces: NuniWorkspace[];
let assignments: NuniAssignment[];
let directories: Map<string, ReturnType<typeof reviewed>>;
let active: boolean;
let platformActive: boolean;
let context: AssistantCalendarContext;
const local = (): TimetableRead => ({ timetable: null, schoolId: 'pu', records, updatedAt: '2026-11-08T05:00:00Z' });
function fixtures(count = 2) {
  records = Array.from({ length: count }, (_, i) => course(i));
  workspaces = Array.from({ length: count }, (_, i) => ({
    id: source(i).workspaceId, title: courseNames[i], state: 'active', memberRole: 'student',
  }));
  assignments = Array.from({ length: count }, (_, i) => assignment(i));
  directories = new Map(Array.from({ length: count }, (_, i) => [source(i).workspaceId, reviewed(i)]));
}
async function defaultRequest(path: string, body?: Record<string, unknown>): Promise<unknown> {
  if (path === 'class-workspaces') return { workspaces };
  if (path === 'course-access/workspace-course') {
    if (body?.schoolId !== 'pu' || !directories.has(String(body?.workspaceId))) throw new Error('Unexpected directory scope');
    return directories.get(String(body.workspaceId));
  }
  const workspace = workspaces.find((row) => path === `class-workspaces/${row.id}`);
  if (workspace) return workspace;
  throw new Error('Unexpected platform read: ' + path);
}
async function defaultBff(path: string): Promise<unknown> {
  const workspace = workspaces.find((row) => path === `class-workspaces/${row.id}/assignments`);
  if (!workspace) throw new Error('Unexpected BFF read: ' + path);
  return { assignments: assignments.filter((row) => row.workspaceId === workspace.id) };
}
const ledgerWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === ledgerKey);
const batchWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === batchKey);
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const notifyAssignment = (index = 0) => notifyNuniAssignmentChanged({
  accountId, workspaceId: source(index).workspaceId, assignmentId: source(index).assignmentId,
  context: 'a-different-navigation-context',
});
async function prepared(sources = [source(), source(1)]) {
  const result = await prepareNuniCourseworkStudyBatch({ sources, context, transport });
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error(result.message);
  return result.batch;
}
async function expectNoOperation() {
  expect(ledgerWrites()).toHaveLength(0);
  expect(await readAssistantCalendarJournal(scope, () => true)).toEqual([]);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
  jest.mocked(AsyncStorage.getItem).mockReset().mockImplementation(originalGet);
  jest.mocked(AsyncStorage.setItem).mockReset().mockImplementation(originalSet);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  fixtures(); active = true; platformActive = true;
  context = { uid: '', schoolId: 'pu', isCurrent: () => active,
    platformTimetable: { accountId, isCurrent: () => platformActive } };
  timetable.mockReset().mockImplementation(async () => local());
  request.mockReset().mockImplementation(defaultRequest);
  bffRequest.mockReset().mockImplementation(defaultBff);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('reads every exact source, sorts by deadline and saves only immutable minimal metadata with no write authority', async () => {
  const batch = await prepared([source(1), source()]);
  expect(batch).toMatchObject({ state: 'review', progress: { verified: 0, total: 2, notStarted: 2 },
    plan: { kind: 'coursework-study' } });
  expect(batch.plan.steps.map((step) => step.event)).toEqual([
    { title: '準備：資料模型報告', date, allDay: false, startTime: '10:10', endTime: '10:40' },
    { title: '準備：網頁切版', date, allDay: false, startTime: '10:50', endTime: '11:20' },
  ]);
  expect(batch.plan.steps.map((step) => step.source?.locator)).toEqual([source(), source(1)]);
  for (const step of batch.plan.steps) {
    expect(Object.isFrozen(step.source) && Object.isFrozen(step.source!.locator) && Object.isFrozen(step.source!.expected)).toBe(true);
    expect(step.source!.expected.courseIdentity.length).toBeLessThanOrEqual(2048);
  }
  expect(bffRequest.mock.calls.filter(([path]) => path === assignmentPath())).toHaveLength(2);
  expect(bffRequest.mock.calls.filter(([path]) => path === assignmentPath(1))).toHaveLength(2);
  const raw = (await originalGet(batchKey))!;
  expect(raw).toContain('ccd_' + uuid(1));
  expect(raw).toContain('MIS301');
  expect(raw).not.toMatch(/私人作業全文|匯入原文|anchor|checkedAt|expectedReviewed|writeCheck|mutationId|attemptedAt|receipt/);
  await expectNoOperation();
  expect(jest.getTimerCount()).toBe(0);
});

test('four selected assignments all receive separate buffered slots, never a shortened plan', async () => {
  fixtures(4);
  const batch = await prepared([source(3), source(2), source(1), source()]);
  expect(batch.plan.steps.map((step) => step.event.startTime)).toEqual(['10:10', '10:50', '11:30', '12:10']);
  expect(batch.plan.steps.map((step) => step.source!.locator.assignmentId))
    .toEqual([source().assignmentId, source(3).assignmentId, source(2).assignmentId, source(1).assignmentId]);
  expect(batch.progress).toEqual({ verified: 0, total: 4, notStarted: 4 });
  await expectNoOperation();
});

test('two distinct assignments in one workspace retain their exact IDs', async () => {
  assignments[1] = assignment(1, { workspaceId: source().workspaceId, title: assignments[0].title, dueAt: assignments[0].dueAt });
  const second = { ...source(), assignmentId: assignments[1].id };
  const batch = await prepared([source(), second]);
  expect(batch.plan.steps.map((step) => step.source!.locator)).toEqual([source(), second]);
  expect(batch.plan.steps[0].event.title).toBe(batch.plan.steps[1].event.title);
  expect(batch.plan.steps[0].event.startTime).not.toBe(batch.plan.steps[1].event.startTime);
});

test('captures selected locators and transport methods before its first asynchronous read', async () => {
  const input = [source(), source(1)];
  const selectedTransport = { request, bffRequest };
  const flight = prepareNuniCourseworkStudyBatch({ sources: input, context, transport: selectedTransport });
  input[0].workspaceId = 'cw_' + uuid(99);
  input[0].assignmentId = 'cwa_' + uuid(99);
  input.splice(1);
  selectedTransport.request = jest.fn().mockRejectedValue(new Error('mutated transport'));
  selectedTransport.bffRequest = jest.fn().mockRejectedValue(new Error('mutated transport'));
  const result = await flight;
  expect(result.kind).toBe('ready');
  if (result.kind === 'ready') expect(result.batch.plan.steps.map((step) => step.source!.locator)).toEqual([source(), source(1)]);
  expect(selectedTransport.request).not.toHaveBeenCalled();
  expect(selectedTransport.bffRequest).not.toHaveBeenCalled();
});

test.each([
  ['empty', []], ['one', [source()]], ['too many', [source(), source(1), source(2), source(3), source(4)]],
  ['duplicate', [source(), source()]],
  ['quiz locator', [source(), { ...source(1), assignmentId: 'cwq_' + uuid(2) }]],
  ['school alias', [source(), { ...source(1), schoolId: 'tw-pu' }]],
  ['hidden authority', [source(), { ...source(1), authority: 'execute-saved-plan' }]],
])('rejects invalid selection %s before any source read or preview write', async (_, sources) => {
  expect(await prepareNuniCourseworkStudyBatch({ sources: sources as NuniPlanAssignmentSource[], context, transport }))
    .toMatchObject({ kind: 'blocked' });
  expect(timetable).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('pre-cancelled selection and unavailable transport perform no reads or writes', async () => {
  const controller = new AbortController(); controller.abort();
  expect(await prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport, signal: controller.signal }))
    .toMatchObject({ kind: 'cancelled' });
  expect(await prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport: {} as CourseworkRequests }))
    .toMatchObject({ kind: 'unavailable' });
  expect(request).not.toHaveBeenCalled();
  expect(timetable).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('one closed selected source prevents saving the entire preview and identifies the failing selection', async () => {
  assignments[1] = assignment(1, { state: 'closed', closedAt: '2026-11-08T05:00:00Z' });
  expect(await prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport }))
    .toMatchObject({ kind: 'changed', message: expect.stringContaining('第 2 份') });
  expect(batchWrites()).toHaveLength(0);
  await expectNoOperation();
});

test('when only one source fits before its deadline the result names the unplaced assignment and saves no subset', async () => {
  assignments = assignments.map((row) => ({ ...row, dueAt: date + 'T10:45:00+08:00' }));
  expect(await prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport }))
    .toMatchObject({ kind: 'no-slot', message: expect.stringContaining(assignments[1].title) });
  expect(batchWrites()).toHaveLength(0);
  await expectNoOperation();
});

test('a catalog identity change between the real reader directory calls invalidates the preview', async () => {
  let directoryReads = 0;
  request.mockImplementation(async (path, body) => {
    if (path === 'course-access/workspace-course' && body?.workspaceId === source().workspaceId && ++directoryReads === 2)
      return reviewed(0, { id: 'ccd_' + uuid(99), title: '另一門已審核課程' });
    return defaultRequest(path, body);
  });
  expect(await prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport }))
    .toMatchObject({ kind: 'changed', message: expect.stringContaining('第 1 份') });
  expect(batchWrites()).toHaveLength(0);
  await expectNoOperation();
});

test.each(['assignment', 'timetable', 'personal-import'] as const)(
  'the whole-group lease rejects an earlier finished source becoming stale while another read waits: %s', async (change) => {
    const held = deferred<unknown>();
    bffRequest.mockImplementation((path) => path === assignmentPath(1) ? held.promise : defaultBff(path));
    const flight = prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport });
    await flush();
    expect(bffRequest.mock.calls.filter(([path]) => path === assignmentPath())).toHaveLength(2);
    expect(bffRequest.mock.calls.filter(([path]) => path === assignmentPath(1))).toHaveLength(1);
    if (change === 'assignment') notifyAssignment();
    if (change === 'timetable') notifyTimetableChanged();
    if (change === 'personal-import') await appendPersonalImports(scope, [manualEvent()]);
    expect(await flight).toMatchObject({ kind: 'changed' });
    held.resolve(await defaultBff(assignmentPath(1)));
    await flush();
    expect(batchWrites()).toHaveLength(0);
    expect(ledgerWrites()).toHaveLength(change === 'personal-import' ? 1 : 0);
    expect(await readAssistantCalendarJournal(scope, () => true)).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('cancellation resolves while the transport is still waiting and ignores its late response', async () => {
  const held = deferred<unknown>();
  const controller = new AbortController();
  bffRequest.mockImplementation((path) => path === assignmentPath(1) ? held.promise : defaultBff(path));
  const flight = prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport, signal: controller.signal });
  await flush();
  controller.abort();
  expect(await flight).toMatchObject({ kind: 'cancelled' });
  held.resolve(await defaultBff(assignmentPath(1)));
  await flush();
  expect(batchWrites()).toHaveLength(0);
  await expectNoOperation();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['account', 'school', 'session-guard'] as const)('a late source response cannot save under a changed %s', async (change) => {
  const held = deferred<unknown>();
  bffRequest.mockImplementation((path) => path === assignmentPath(1) ? held.promise : defaultBff(path));
  const flight = prepareNuniCourseworkStudyBatch({ sources: [source(), source(1)], context, transport });
  await flush();
  if (change === 'account') context.platformTimetable!.accountId = 'pa_' + uuid(2);
  if (change === 'school') context.schoolId = 'ncku';
  if (change === 'session-guard') active = false;
  held.resolve(await defaultBff(assignmentPath(1)));
  expect(await flight).toMatchObject({ kind: 'changed' });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test.each(['assignment-title', 'deadline', 'workspace-title', 'catalog-id', 'catalog-title', 'teacher'] as const)(
  'resuming rereads source metadata and rejects a changed %s before creating any operation', async (change) => {
    const batch = await prepared();
    if (change === 'assignment-title') assignments[1] = assignment(1, { title: '改名後的網頁作業' });
    if (change === 'deadline') assignments[1] = assignment(1, { dueAt: '2026-11-10T17:00:00+08:00' });
    if (change === 'workspace-title') workspaces[1] = { ...workspaces[1], title: '另一個課程名稱' };
    if (change === 'catalog-id') directories.set(source(1).workspaceId, reviewed(1, { id: 'ccd_' + uuid(99) }));
    if (change === 'catalog-title') directories.set(source(1).workspaceId, reviewed(1, { title: '另一門已審核課程' }));
    if (change === 'teacher') directories.set(source(1).workspaceId, reviewed(1, { teacher: '王老師' }));
    const checks = createNuniCourseworkStudyBatchChecks(transport);
    expect(await checks.preflight(batch.plan, batch.plan.steps, context))
      .toMatchObject({ kind: 'changed', message: expect.stringContaining('網頁切版') });
    await expectNoOperation();
  },
);

test('preflight keeps all pending sources subscribed until the last exact read has completed', async () => {
  const batch = await prepared();
  const held = deferred<unknown>();
  bffRequest.mockClear().mockImplementation((path) => path === assignmentPath(1) ? held.promise : defaultBff(path));
  const checks = createNuniCourseworkStudyBatchChecks(transport);
  const flight = checks.preflight(batch.plan, batch.plan.steps, context);
  await flush();
  expect(bffRequest.mock.calls.filter(([path]) => path === assignmentPath())).toHaveLength(2);
  notifyAssignment();
  expect(await flight).toMatchObject({ kind: 'changed', message: expect.stringContaining('資料模型報告') });
  held.resolve(await defaultBff(assignmentPath(1)));
  await flush();
  bffRequest.mockImplementation(defaultBff);
  expect(await checks.preflight(batch.plan, batch.plan.steps, context)).toEqual({ kind: 'ready' });
  await expectNoOperation();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['assignment', 'timetable', 'personal-import'] as const)(
  'beforeStep keeps its fresh restriction live until disposal and observes a later %s change', async (change) => {
    const batch = await prepared();
    const checks = createNuniCourseworkStudyBatchChecks(transport);
    const checked = await checks.beforeStep(batch.plan, batch.plan.steps[0], context);
    expect(checked.kind).toBe('ready');
    if (checked.kind !== 'ready') throw new Error(checked.message);
    try {
      const ledger = await snapshotPersonalImports(scope);
      expect(checked.writeCheck.isCurrent()).toBe(true);
      expect(checked.writeCheck.matches(ledger)).toBe(true);
      notifyAssignment(1);
      expect(checked.writeCheck.isCurrent()).toBe(true);
      if (change === 'assignment') notifyAssignment();
      if (change === 'timetable') notifyTimetableChanged();
      if (change === 'personal-import') await appendPersonalImports(scope, [manualEvent()]);
      expect(checked.writeCheck.isCurrent()).toBe(false);
      expect(checked.writeCheck.matches(ledger)).toBe(false);
    } finally { checked.dispose?.(); }
    expect(checked.writeCheck.isCurrent()).toBe(false);
  },
);

test('one reused checks factory holds independent leases for different plans and disposal cannot revoke another step', async () => {
  const first = await prepared();
  assignments[0] = assignment(0, { title: '另一份資料模型安排' });
  const second = await prepared();
  // The second step is unchanged between plans; both leases may be valid, but
  // the runner still serializes actual writes for this account and school.
  const checks = createNuniCourseworkStudyBatchChecks(transport);
  const a = await checks.beforeStep(first.plan, first.plan.steps[1], context);
  const b = await checks.beforeStep(second.plan, second.plan.steps[1], context);
  expect(a.kind).toBe('ready'); expect(b.kind).toBe('ready');
  if (a.kind !== 'ready' || b.kind !== 'ready') throw new Error('Expected two independent source checks');
  try {
    a.dispose?.();
    expect(a.writeCheck.isCurrent()).toBe(false);
    expect(b.writeCheck.isCurrent()).toBe(true);
    notifyAssignment(1);
    expect(b.writeCheck.isCurrent()).toBe(false);
  } finally { a.dispose?.(); b.dispose?.(); }
});

test('a later real meeting of the same course does not invalidate its durable course identity', async () => {
  records.push(course(0, { id: 'another-database-meeting', dayOfWeek: 2 }));
  const batch = await prepared();
  jest.setSystemTime(Date.parse(date + 'T10:05:00+08:00'));
  const checked = await createNuniCourseworkStudyBatchChecks(transport).beforeStep(batch.plan, batch.plan.steps[0], context);
  expect(checked.kind).toBe('ready');
  if (checked.kind === 'ready') checked.dispose?.();
  await expectNoOperation();
});

test.each(['missing-source', 'generic-plan', 'foreign-step', 'changed-event'] as const)(
  'the resolver rejects untrusted persisted routing or mismatched pending steps: %s', async (change) => {
    const batch = await prepared();
    let plan: AssistantCalendarBatchPlan = batch.plan;
    let pending: readonly AssistantCalendarBatchStep[] = batch.plan.steps;
    if (change === 'missing-source') plan = { ...plan, steps: plan.steps.map((step) => ({ id: step.id, event: step.event })) };
    if (change === 'generic-plan') plan = { ...plan, kind: undefined, steps: plan.steps.map((step) => ({ id: step.id, event: step.event })) };
    if (change === 'foreign-step') pending = [{ ...pending[0], id: 'acs_coursework_foreign_step' }];
    if (change === 'changed-event') pending = [{ ...pending[0], event: { ...pending[0].event, startTime: '11:30', endTime: '12:00' } }];
    bffRequest.mockClear(); request.mockClear(); timetable.mockClear();
    expect(await createNuniCourseworkStudyBatchChecks(transport).preflight(plan, pending, context)).toMatchObject({ kind: 'blocked' });
    expect(request).not.toHaveBeenCalled();
    expect(bffRequest).not.toHaveBeenCalled();
    expect(timetable).not.toHaveBeenCalled();
    await expectNoOperation();
  },
);

test('the real runner refreshes evidence after its own first write and restores both source-bound receipts without rewriting', async () => {
  const batch = await prepared();
  const checks = createNuniCourseworkStudyBatchChecks(transport);
  const done = await confirmAssistantCalendarBatch(batch.plan, context, { sourceChecks: checks });
  expect(done).toMatchObject({ state: 'completed', progress: { verified: 2, total: 2, notStarted: 0 } });
  expect(ledgerWrites()).toHaveLength(2);
  expect((await loadPersonalImports(scope)).records.map((row) => row.title)).toEqual(batch.plan.steps.map((step) => step.event.title));
  const journal = await readAssistantCalendarJournal(scope, () => true);
  expect(journal.map((entry) => entry.proposal.origin)).toEqual(batch.plan.steps.map((step) => ({
    kind: 'batch-step', batchId: batch.plan.id, stepId: step.id,
  })));
  const originalIds = journal.map((entry) => entry.proposal.mutationId);
  const restored = (await restoreAssistantCalendarBatches(context))[0];
  expect(restored).toMatchObject({ state: 'completed', progress: { verified: 2 } });
  expect(restored.steps.map((step) => step.state === 'recorded' && step.task.proposal.mutationId)).toEqual(originalIds);
  expect(ledgerWrites()).toHaveLength(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('a source change while reserving the native operation fences the dispatch before a ledger write', async () => {
  const batch = await prepared();
  let invalidated = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await originalSet(key, value);
    if (key === journalKey && !invalidated) { invalidated = true; notifyAssignment(); }
  });
  const stopped = await confirmAssistantCalendarBatch(batch.plan, context, {
    sourceChecks: createNuniCourseworkStudyBatchChecks(transport),
  });
  expect(invalidated).toBe(true);
  expect(stopped).toMatchObject({ state: 'paused', progress: { verified: 0, notStarted: 1 } });
  expect(ledgerWrites()).toHaveLength(0);
  expect((await loadPersonalImports(scope)).records).toEqual([]);
});

test('a stopped partial batch rereads only unstarted sources after restart and requires a new confirmation', async () => {
  const batch = await prepared();
  const controller = new AbortController();
  const paused = await confirmAssistantCalendarBatch(batch.plan, context, {
    sourceChecks: createNuniCourseworkStudyBatchChecks(transport), signal: controller.signal,
    onUpdate: (view) => { if (view.progress.verified === 1 && !controller.signal.aborted) controller.abort(); },
  });
  expect(paused).toMatchObject({ state: 'paused', progress: { verified: 1, notStarted: 1 } });
  const firstId = (await readAssistantCalendarJournal(scope, () => true))[0].proposal.mutationId;
  assignments[0] = assignment(0, { state: 'closed', closedAt: '2026-11-08T05:00:00Z' });
  assignments[1] = assignment(1, { dueAt: '2026-11-10T17:00:00+08:00' });
  const restored = (await restoreAssistantCalendarBatches(context))[0];
  expect(restored).toMatchObject({ state: 'review', progress: { verified: 1, notStarted: 1 } });
  expect(ledgerWrites()).toHaveLength(1);
  bffRequest.mockClear();
  const refused = await confirmAssistantCalendarBatch(restored.plan, context, {
    sourceChecks: createNuniCourseworkStudyBatchChecks(transport),
  });
  expect(refused).toMatchObject({ state: 'paused', progress: { verified: 1, notStarted: 1 },
    stop: { message: expect.stringContaining('網頁切版') } });
  expect(bffRequest.mock.calls.every(([path]) => path === assignmentPath(1))).toBe(true);
  expect(ledgerWrites()).toHaveLength(1);
  assignments[1] = assignment(1);
  const completed = await confirmAssistantCalendarBatch(restored.plan, context, {
    sourceChecks: createNuniCourseworkStudyBatchChecks(transport),
  });
  expect(completed).toMatchObject({ state: 'completed', progress: { verified: 2, notStarted: 0 } });
  expect(ledgerWrites()).toHaveLength(2);
  expect((await readAssistantCalendarJournal(scope, () => true))[0].proposal.mutationId).toBe(firstId);
});

test('a source plan cannot be resumed without a resolver or borrow a generic receipt for the same event', async () => {
  const batch = await prepared();
  expect(await confirmAssistantCalendarBatch(batch.plan, context)).toMatchObject({ state: 'paused', progress: { verified: 0 } });
  await expectNoOperation();
  const ordinary = createAssistantCalendarTask(batch.plan.steps[0].event, context);
  expect((await confirmAssistantCalendarTask(ordinary.proposal, context)).state).toBe('verified');
  const refused = await confirmAssistantCalendarBatch(batch.plan, context, {
    sourceChecks: createNuniCourseworkStudyBatchChecks(transport),
  });
  expect(refused).toMatchObject({ state: 'paused', progress: { verified: 0, notStarted: 2 } });
  expect(ledgerWrites()).toHaveLength(1);
  expect((await readAssistantCalendarJournal(scope, () => true))[0].proposal.origin).toBeUndefined();
});
