import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  beginSavedCampusPlansSignOutCleanup,
  createSavedCampusPlanSession,
  deleteSavedCampusPlan,
  endSavedCampusPlansSignOutCleanup,
  readSavedCampusPlans,
  saveCampusPlan,
  savedCampusPlansStorageKey,
  setCampusPlanStepDone,
  subscribeSavedCampusPlanInvalidation,
  SAVED_CAMPUS_PLAN_LIMIT,
  type SavedCampusPlanScope,
} from '../../services/savedCampusPlans';
import type { CampusEvidencePlan } from '../../services/offlineCampusPlanner';
import { buildOfflineCampusPlan } from '../../services/offlineCampusPlanner';
import { buildCampusStudyAgenda, formatCampusStudyAgenda, resolveStudyWindow } from '../../services/campusStudyAgenda';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), getAllKeys: jest.fn(), multiRemove: jest.fn() },
}));
let mockUuidIndex = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuidIndex).padStart(12, '0')}`,
}));

const read = jest.mocked(AsyncStorage.getItem);
const write = jest.mocked(AsyncStorage.setItem);
const keys = jest.mocked(AsyncStorage.getAllKeys);
const remove = jest.mocked(AsyncStorage.multiRemove);
const persisted = new Map<string, string>();
const scope: SavedCampusPlanScope = { owner: 'firebase:student-a', schoolId: 'pu' };
const question = '幫我安排今天的課表與作業';
const session = () => createSavedCampusPlanSession(() => true);

function sample(title = '資料庫報告'): CampusEvidencePlan {
  return {
    title: '今日優先行動',
    overview: '依 11/6 09:00 的已同步摘要整理。',
    checkedAt: '2026-11-06T01:00:00.000Z',
    steps: [
      { id: 'assignment-0', title, detail: '請開啟作業頁核對截止時間與繳交狀態。',
        evidence: 'authorized-assignments', priority: 'urgent', route: '/classroom',
        dueAt: '2026-11-06T23:59:00+08:00', groupName: '資料庫系統' },
      { id: 'timetable-review', title: '核對今日課表', detail: '第 1–2 節有課。',
        evidence: 'saved-timetable', priority: 'normal', route: '/timetable' },
    ],
    limitations: ['手機副本可能不是最新課表。'],
    agenda: {
      timetableAvailable: true, assignmentsAvailable: true, ignoredCourses: 0,
      days: [{ date: '2026-11-06', label: '11/6（週五）',
        courses: [{ name: '資料庫系統', day: 5, start: 1, end: 2, room: '301' }],
        gaps: [], conflicts: [],
        deadlines: [{ title, groupName: '資料庫系統', dueAt: '2026-11-06T23:59:00+08:00',
          timeLabel: '23:59', overdue: false }],
      }],
      outsideWindow: [{ title: '下週讀書報告', groupName: '資訊管理',
        dueAt: '2026-11-09T23:59:00+08:00', reason: 'after-window' }],
    },
    content: `今日先處理${title}，再核對課表。`,
  };
}

function clockSample(): CampusEvidencePlan {
  const checkedAt = '2026-11-08T00:00:00Z';
  const now = Date.parse(checkedAt);
  const agenda = buildCampusStudyAgenda({ window: resolveStudyWindow('未來七天', now)!, now, courses: [], assignments: null });
  for (const day of agenda.days) day.scheduledClasses = [];
  const overnight = { name: '跨夜實作', room: 'B201', startAt: '2026-11-08T15:30:00Z', endAt: '2026-11-09T01:00:00+08:00' };
  agenda.days[0].scheduledClasses = [
    { name: '週日補課', room: 'A301', startAt: '2026-11-08T09:10:00+08:00', endAt: '2026-11-08T03:00:00Z' },
    overnight,
  ];
  agenda.days[1].scheduledClasses = [{ ...overnight }];
  return {
    title: '七日鐘點安排', overview: '依個人保存的課表逐日核對。', checkedAt,
    steps: [{ id: 'timetable-review', title: '核對個人課表', detail: '週日 09:10–11:00 補課，跨夜實作另列完整日期。',
      evidence: 'saved-timetable', priority: 'normal', route: '/timetable' }],
    limitations: ['課表副本不等於校方即時資料。'], agenda,
    comparisonBasis: { timetableUpdatedAt: '2026-11-07T08:00:00Z',
      assignments: { status: 'unavailable', total: null, checkedAt: null, items: [] } },
    content: formatCampusStudyAgenda(agenda).join('\n'),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidIndex = 0;
  persisted.clear();
  read.mockReset().mockImplementation(async (key) => persisted.get(key) ?? null);
  write.mockReset().mockImplementation(async (key, raw) => { persisted.set(key, raw); });
  keys.mockReset().mockImplementation(async () => [...persisted.keys()]);
  remove.mockReset().mockImplementation(async (items) => { for (const key of items) persisted.delete(key); });
});

afterEach(async () => {
  // Resolve each test's work before ending its session; no store state is cached.
  keys.mockReset().mockImplementation(async () => [...persisted.keys()]);
  remove.mockReset().mockImplementation(async (items) => { for (const key of items) persisted.delete(key); });
  await beginSavedCampusPlansSignOutCleanup();
  endSavedCampusPlansSignOutCleanup();
});

test('a new repository session restores the full dated plan and personal progress', async () => {
  const guard = session();
  const saved = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  expect(saved).toHaveLength(1);
  expect(saved[0].plan).toEqual(sample());
  await setCampusPlanStepDone(scope, saved[0].id, 'assignment-0', true, guard);
  const restored = await readSavedCampusPlans(scope, session());
  expect(restored[0]).toEqual({ ...saved[0], updatedAt: expect.any(String), completedStepIds: ['assignment-0'] });
  restored[0].plan.steps[0].title = '外部修改';
  expect((await readSavedCampusPlans(scope, session()))[0].plan.steps[0].title).toBe('資料庫報告');
});

test('live nuni lookup hints are stripped from every saved assignment position and from restored input', async () => {
  const platformScope = { owner: 'nuni:student-a', schoolId: 'pu' };
  const live = sample();
  const source = { accountId: 'student-a', schoolId: 'pu', academicYear: '115', semester: '1',
    workspaceId: 'cw_00000000-0000-4000-8000-000000000001',
    assignmentId: 'cwa_00000000-0000-4000-8000-000000000001' };
  live.steps[0].nuniSource = source;
  live.agenda!.days[0].deadlines[0].nuniSource = source;
  live.agenda!.outsideWindow[0].nuniSource = source;
  const saved = await saveCampusPlan(platformScope, { question, plan: live }, session());
  expect(saved[0].plan).toEqual(sample());
  expect(live.steps[0].nuniSource).toEqual(source);
  const key = savedCampusPlansStorageKey(platformScope);
  expect(persisted.get(key)).not.toContain('nuniSource');
  const oldInput = JSON.parse(persisted.get(key)!);
  oldInput.plans[0].plan.steps[0].nuniSource = source;
  oldInput.plans[0].plan.agenda.days[0].deadlines[0].nuniSource = source;
  oldInput.plans[0].plan.agenda.outsideWindow[0].nuniSource = source;
  persisted.set(key, JSON.stringify(oldInput));
  expect((await readSavedCampusPlans(platformScope, session()))[0].plan).toEqual(sample());
});

test('a nuni clock plan survives real serialization with Sunday, overnight dates, offsets and explicitly empty days', async () => {
  const platformScope = { owner: 'nuni:student-a', schoolId: 'pu' };
  const plan = clockSample();
  Object.assign(plan.agenda!.days[0].scheduledClasses![0], { authToken: 'secret', url: 'https://private.invalid/class', canWrite: true });
  const saved = await saveCampusPlan(platformScope, { question: '安排未來七天', plan }, session());
  await setCampusPlanStepDone(platformScope, saved[0].id, 'timetable-review', true, session());
  const restored = await readSavedCampusPlans(platformScope, session());
  expect(restored[0].plan).toEqual(clockSample());
  expect(restored[0].completedStepIds).toEqual(['timetable-review']);
  expect(restored[0].plan.agenda!.days[2].scheduledClasses).toEqual([]);
  expect(restored[0].plan.agenda!.days[0].scheduledClasses![0].startAt).toBe('2026-11-08T09:10:00+08:00');
  expect(restored[0].plan.content).toContain('11/8 23:30–11/9 01:00');
  expect(persisted.get(savedCampusPlansStorageKey(platformScope))).not.toMatch(/authToken|canWrite|private.invalid/);
  restored[0].plan.agenda!.days[0].scheduledClasses![0].name = '外部修改';
  expect((await readSavedCampusPlans(platformScope, session()))[0].plan).toEqual(clockSample());
});

test('clock bounds retain all 80 daily occurrences and allow an exactly 24-hour meeting', async () => {
  const plan = clockSample();
  const meeting = { name: '課'.repeat(240), room: '室'.repeat(240),
    startAt: '2026-11-08T00:00:00+08:00', endAt: '2026-11-09T00:00:00+08:00' };
  for (const day of plan.agenda!.days) day.scheduledClasses = [];
  plan.agenda!.days[0].scheduledClasses = Array.from({ length: 80 }, () => ({ ...meeting }));
  await saveCampusPlan(scope, { question, plan }, session());
  const restored = (await readSavedCampusPlans(scope, session()))[0].plan;
  expect(restored.agenda!.days[0].scheduledClasses).toHaveLength(80);
  expect(restored.agenda!.days[0].scheduledClasses![79]).toEqual(meeting);
  expect(restored.agenda!.days[1].scheduledClasses).toEqual([]);
});

test.each<[string, (plan: CampusEvidencePlan) => void]>([
  ['offset-free start', (plan) => { plan.agenda!.days[0].scheduledClasses![0].startAt = '2026-11-08T09:10:00'; }],
  ['date-only end', (plan) => { plan.agenda!.days[0].scheduledClasses![0].endAt = '2026-11-08'; }],
  ['invalid calendar date', (plan) => { plan.agenda!.days[0].scheduledClasses![0].startAt = '2026-02-30T09:10:00+08:00'; }],
  ['invalid timezone offset', (plan) => { plan.agenda!.days[0].scheduledClasses![0].startAt = '2026-11-08T09:10:00+14:30'; }],
  ['zero duration', (plan) => { const item = plan.agenda!.days[0].scheduledClasses![0]; item.endAt = item.startAt; }],
  ['negative duration', (plan) => { plan.agenda!.days[0].scheduledClasses![0].endAt = '2026-11-08T01:00:00Z'; }],
  ['over 24 hours', (plan) => { plan.agenda!.days[0].scheduledClasses![0].endAt = '2026-11-09T01:10:00.001Z'; }],
  ['ending at this day midnight', (plan) => { Object.assign(plan.agenda!.days[0].scheduledClasses![0],
    { startAt: '2026-11-07T15:00:00Z', endAt: '2026-11-07T16:00:00Z' }); }],
  ['starting at next day midnight', (plan) => { Object.assign(plan.agenda!.days[0].scheduledClasses![0],
    { startAt: '2026-11-08T16:00:00Z', endAt: '2026-11-08T17:00:00Z' }); }],
  ['empty name', (plan) => { plan.agenda!.days[0].scheduledClasses![0].name = ' '; }],
  ['oversized name', (plan) => { plan.agenda!.days[0].scheduledClasses![0].name = '課'.repeat(241); }],
  ['oversized room', (plan) => { plan.agenda!.days[0].scheduledClasses![0].room = '室'.repeat(241); }],
  ['missing room', (plan) => { plan.agenda!.days[0].scheduledClasses![0].room = undefined as never; }],
  ['81 meetings', (plan) => { const day = plan.agenda!.days[0]; day.scheduledClasses = Array(81).fill(day.scheduledClasses![0]); }],
  ['sparse meetings', (plan) => { const day = plan.agenda!.days[0]; const rows = Array(2); rows[1] = day.scheduledClasses![0]; day.scheduledClasses = rows; }],
  ['nonarray meetings', (plan) => { plan.agenda!.days[0].scheduledClasses = {} as never; }],
  ['null meetings', (plan) => { plan.agenda!.days[0].scheduledClasses = null as never; }],
  ['mixed period courses', (plan) => { plan.agenda!.days[0].courses = [{ name: '舊節次', day: 0, start: 1, end: 2 }]; }],
  ['mixed period gaps', (plan) => { plan.agenda!.days[0].gaps = [{ start: 3, end: 4 }]; }],
  ['mixed period conflicts', (plan) => { plan.agenda!.days[0].conflicts = [{ start: 1, end: 2 }]; }],
  ['mixed day formats', (plan) => { delete plan.agenda!.days[1].scheduledClasses; }],
  ['unavailable with clock data', (plan) => { plan.agenda!.timetableAvailable = false; }],
  ['unavailable with empty clock arrays', (plan) => {
    plan.agenda!.timetableAvailable = false;
    plan.comparisonBasis!.timetableUpdatedAt = null;
    for (const day of plan.agenda!.days) day.scheduledClasses = [];
  }],
])('invalid clock evidence cannot overwrite existing saved progress: %s', async (_label, change) => {
  const saved = await saveCampusPlan(scope, { question, plan: sample() }, session());
  await setCampusPlanStepDone(scope, saved[0].id, 'assignment-0', true, session());
  const before = persisted.get(savedCampusPlansStorageKey(scope));
  const plan = clockSample();
  change(plan);
  await expect(saveCampusPlan(scope, { question, plan }, session())).rejects.toMatchObject({ code: 'invalid-plan' });
  expect(persisted.get(savedCampusPlansStorageKey(scope))).toBe(before);
  expect((await readSavedCampusPlans(scope, session()))[0].completedStepIds).toEqual(['assignment-0']);
});

test('keys keep account kind, campus and punctuation distinct and use no global fallback', async () => {
  const scopes = [scope,
    { owner: 'firebase:student-b', schoolId: 'pu' },
    { owner: 'nuni:student-a', schoolId: 'pu' },
    { owner: 'firebase:student-a', schoolId: 'nthu' },
    { owner: 'firebase:a:b', schoolId: 'c' },
    { owner: 'firebase:a-b', schoolId: 'c' },
    { owner: 'firebase:a', schoolId: 'b:c' },
    { owner: 'firebase:a', schoolId: 'b-c' },
  ];
  expect(new Set(scopes.map(savedCampusPlansStorageKey)).size).toBe(scopes.length);
  await saveCampusPlan(scope, { question, plan: sample() }, session());
  for (const other of scopes.slice(1)) expect(await readSavedCampusPlans(other, session())).toEqual([]);
  expect(read.mock.calls.every(([key]) => key.startsWith('campus.scope.assistant-plans-v1.'))).toBe(true);
});

test.each([
  { owner: 'anonymous', schoolId: 'pu' }, { owner: 'firebase:', schoolId: 'pu' },
  { owner: 'firebase:a ', schoolId: 'pu' }, { owner: 'firebase:a\u0000', schoolId: 'pu' },
  { owner: 'firebase:a', schoolId: '' }, { owner: 'firebase:a', schoolId: ' pu' },
])('rejects invalid or guest scopes before storage access: %j', async (invalid) => {
  await expect(readSavedCampusPlans(invalid, session())).rejects.toMatchObject({ code: 'invalid-scope' });
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test('saving the same snapshot is idempotent and never resets checked steps', async () => {
  const guard = session();
  const first = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  const marked = await setCampusPlanStepDone(scope, first[0].id, 'assignment-0', true, guard);
  const writes = write.mock.calls.length;
  const duplicate = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  expect(duplicate).toEqual(marked);
  expect(write).toHaveBeenCalledTimes(writes);
  const next = await saveCampusPlan(scope, { question, plan: sample('另一份同序號作業') }, guard);
  expect(next[0].plan.steps[0].id).toBe('assignment-0');
  expect(next[0].id).not.toBe(first[0].id);
  expect(next[0].completedStepIds).toEqual([]);
  expect(next[1].completedStepIds).toEqual(['assignment-0']);
});

test('restoring and saving project known fields instead of persisting tool authority', async () => {
  const plan = sample();
  Object.assign(plan, { execute: 'submitAssignment', authToken: 'private' });
  Object.assign(plan.steps[0], { source: { id: 'old-server-id' }, submitted: true });
  Object.assign(plan.agenda!.days[0].deadlines[0], { source: { id: 'stale-id' } });
  const result = await saveCampusPlan(scope, { question, plan }, session());
  expect(result[0].plan).toEqual(sample());
  expect([...persisted.values()][0]).not.toMatch(/authToken|execute|submitted|old-server-id|stale-id/);
});

test('unconfirmed date text stays unknown in a saved undated assignment', async () => {
  const plan = sample();
  plan.agenda!.outsideWindow = [{ title: '日期未確認', groupName: '', dueAt: '2026-11-10', reason: 'undated' }];
  const result = await saveCampusPlan(scope, { question, plan }, session());
  expect(result[0].plan.agenda!.outsideWindow[0].dueAt).toBeNull();
});

function comparableSample(): CampusEvidencePlan {
  const plan = sample();
  plan.comparisonBasis = {
    assignments: { status: 'complete', checkedAt: '2026-11-06T00:59:00.000Z', total: 1,
      items: [{ identity: ['database', 'report'], title: plan.steps[0].title,
        groupName: '資料庫系統', dueAt: plan.steps[0].dueAt! }],
    },
    timetableUpdatedAt: '2026-11-05T12:00:00.000Z',
  };
  return plan;
}

test('comparison evidence survives restart while unknown authority fields are discarded', async () => {
  const plan = comparableSample();
  Object.assign(plan.comparisonBasis!, { authToken: 'secret', execute: true });
  Object.assign(plan.comparisonBasis!.assignments.items[0], { submitted: true, url: 'https://private.invalid/task' });
  const saved = await saveCampusPlan(scope, { question, plan }, session());
  await setCampusPlanStepDone(scope, saved[0].id, 'assignment-0', true, session());
  const restored = await readSavedCampusPlans(scope, session());
  expect(restored[0].plan).toEqual(comparableSample());
  expect(restored[0].completedStepIds).toEqual(['assignment-0']);
  expect([...persisted.values()][0]).not.toMatch(/authToken|execute|submitted|private.invalid/);
  restored[0].plan.comparisonBasis!.assignments.items[0].identity![0] = 'other-course';
  expect((await readSavedCampusPlans(scope, session()))[0].plan.comparisonBasis!.assignments.items[0].identity)
    .toEqual(['database', 'report']);
});

test('a previously supported full assignment list remains saveable with comparison evidence', async () => {
  const checkedAt = '2026-11-06T01:00:00.000Z';
  const items = Array.from({ length: 400 }, (_, index) => ({
    title: '資'.repeat(40) + index, groupName: '資料庫', dueAt: '2026-11-06T15:59:00.000Z',
    source: { kind: 'group-assignment' as const, groupId: 'database', assignmentId: 'report-' + index },
  }));
  const plan = buildOfflineCampusPlan({ question, uid: 'student-a',
    context: { checkedAt, schoolId: 'pu', schoolName: '靜宜大學',
      timetable: { source: 'not-available', updatedAt: null, courses: [] } },
    snapshot: { userId: 'student-a', schoolId: 'pu', checkedAt,
      schedule: { status: 'unavailable', count: null },
      assignments: { status: 'available', count: 400, items,
        coverage: { complete: true, reason: 'complete', pages: 8 } },
      announcements: { status: 'unavailable', items: [] },
    },
  })!;
  const saved = await saveCampusPlan(scope, { question, plan }, session());
  const restored = await readSavedCampusPlans(scope, session());
  expect(saved).toHaveLength(1);
  expect(restored[0].plan.comparisonBasis!.assignments.items).toHaveLength(400);
  expect(restored[0].plan.agenda!.days[0].deadlines).toHaveLength(400);
  expect(restored[0].plan.comparisonBasis!.assignments.items[399].identity).toEqual(['database', 'report-399']);
});

test.each([
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.total = 0; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.total = 2; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.status = 'unavailable'; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.checkedAt = null; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.checkedAt = '2026-11-07T01:00:00Z'; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.items[0].identity = ['bad/id', 'report']; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.items[0].identity = ['report'] as never; },
  (plan: CampusEvidencePlan) => { const identity = Array(2); identity[1] = 'report'; plan.comparisonBasis!.assignments.items[0].identity = identity as never; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.assignments.items[0].dueAt = '2026-11-08'; },
  (plan: CampusEvidencePlan) => { plan.comparisonBasis!.timetableUpdatedAt = 'unknown'; },
])('malformed comparison evidence cannot replace an existing saved plan (%#)', async (change) => {
  await saveCampusPlan(scope, { question, plan: sample() }, session());
  const before = persisted.get(savedCampusPlansStorageKey(scope));
  const changed = comparableSample();
  change(changed);
  await expect(saveCampusPlan(scope, { question, plan: changed }, session())).rejects.toMatchObject({ code: 'invalid-plan' });
  expect(persisted.get(savedCampusPlansStorageKey(scope))).toBe(before);
  expect((await readSavedCampusPlans(scope, session()))[0].plan).toEqual(sample());
});

test.each([
  (plan: CampusEvidencePlan) => { plan.steps[0].route = 'https://external.invalid' as never; },
  (plan: CampusEvidencePlan) => { plan.steps[1].route = '/classroom'; },
  (plan: CampusEvidencePlan) => { plan.steps[0].evidence = 'model-guess' as never; },
  (plan: CampusEvidencePlan) => { plan.steps[0].priority = 'completed' as never; },
  (plan: CampusEvidencePlan) => { plan.steps.push({ ...plan.steps[0] }); },
  (plan: CampusEvidencePlan) => { plan.steps[0].dueAt = '2026-11-07'; },
  (plan: CampusEvidencePlan) => { plan.steps[0].dueAt = '2026-02-30T12:00:00+08:00'; },
  (plan: CampusEvidencePlan) => { plan.steps[0].dueAt = '2026-11-07T12:00:00+14:30'; },
  (plan: CampusEvidencePlan) => { plan.steps[1].dueAt = '2026-11-07T12:00:00+08:00'; },
  (plan: CampusEvidencePlan) => { plan.checkedAt = '2026-11-06T09:00:00'; },
  (plan: CampusEvidencePlan) => { plan.agenda!.days[0].date = '2026-02-30'; },
  (plan: CampusEvidencePlan) => { plan.agenda!.days[0].courses[0].day = 1; },
  (plan: CampusEvidencePlan) => { plan.agenda!.days[0].gaps = [{ start: 5, end: 4 }]; },
  (plan: CampusEvidencePlan) => { plan.agenda!.days[0].deadlines[0].timeLabel = '24:00'; },
  (plan: CampusEvidencePlan) => { plan.agenda!.assignmentsAvailable = false; },
  (plan: CampusEvidencePlan) => { plan.content = '課'.repeat(70_000); },
])('rejects malformed plans and never truncates an accepted source (%#)', async (change) => {
  const plan = sample();
  change(plan);
  await expect(saveCampusPlan(scope, { question, plan }, session())).rejects.toMatchObject({ code: 'invalid-plan' });
  expect(write).not.toHaveBeenCalled();
});

test.each(['{invalid', '{"version":2,"plans":[]}', 'null', '[]'])('corrupt stores are preserved instead of replaced: %s', async (raw) => {
  persisted.set(savedCampusPlansStorageKey(scope), raw);
  await expect(readSavedCampusPlans(scope, session())).rejects.toMatchObject({ code: 'corrupt-storage' });
  await expect(saveCampusPlan(scope, { question, plan: sample() }, session())).rejects.toMatchObject({ code: 'corrupt-storage' });
  expect(persisted.get(savedCampusPlansStorageKey(scope))).toBe(raw);
  expect(write).not.toHaveBeenCalled();
});

test('an envelope copied under another owner, foreign progress and duplicated ids are rejected', async () => {
  await saveCampusPlan(scope, { question, plan: sample() }, session());
  const original = persisted.get(savedCampusPlansStorageKey(scope))!;
  const other = { owner: 'firebase:student-b', schoolId: 'pu' };
  persisted.set(savedCampusPlansStorageKey(other), original);
  await expect(readSavedCampusPlans(other, session())).rejects.toMatchObject({ code: 'corrupt-storage' });
  const changed = JSON.parse(original);
  changed.plans[0].completedStepIds = ['unrelated-task'];
  persisted.set(savedCampusPlansStorageKey(scope), JSON.stringify(changed));
  await expect(readSavedCampusPlans(scope, session())).rejects.toMatchObject({ code: 'corrupt-storage' });
  const duplicated = JSON.parse(original);
  duplicated.plans.push(duplicated.plans[0]);
  persisted.set(savedCampusPlansStorageKey(scope), JSON.stringify(duplicated));
  await expect(readSavedCampusPlans(scope, session())).rejects.toMatchObject({ code: 'corrupt-storage' });
});

test('the 13th distinct plan is refused without evicting existing progress', async () => {
  const guard = session();
  for (let i = 0; i < SAVED_CAMPUS_PLAN_LIMIT; i++) await saveCampusPlan(scope, { question, plan: sample(`報告 ${i}`) }, guard);
  const before = persisted.get(savedCampusPlansStorageKey(scope));
  await expect(saveCampusPlan(scope, { question, plan: sample('第十三份') }, guard)).rejects.toMatchObject({ code: 'limit-reached' });
  expect(persisted.get(savedCampusPlansStorageKey(scope))).toBe(before);
  expect(await readSavedCampusPlans(scope, guard)).toHaveLength(SAVED_CAMPUS_PLAN_LIMIT);
  await expect(saveCampusPlan(scope, { question, plan: sample('報告 0') }, guard)).resolves.toHaveLength(SAVED_CAMPUS_PLAN_LIMIT);
});

test('aggregate UTF-8 storage limits preserve the previous ledger', async () => {
  const guard = session();
  for (let i = 0; i < 8; i++) await saveCampusPlan(scope, { question, plan: { ...sample(`報告 ${i}`), content: '課'.repeat(35_000) } }, guard);
  const before = persisted.get(savedCampusPlansStorageKey(scope));
  await expect(saveCampusPlan(scope, { question, plan: { ...sample('額外報告'), content: '課'.repeat(35_000) } }, guard))
    .rejects.toMatchObject({ code: 'storage-limit' });
  expect(persisted.get(savedCampusPlansStorageKey(scope))).toBe(before);
});

test('two rapid saves capture original values and a remount read waits for them', async () => {
  const started = deferred<void>();
  const gate = deferred<void>();
  write.mockImplementationOnce(async (key, raw) => { started.resolve(undefined); await gate.promise; persisted.set(key, raw); });
  const plan = sample();
  const guard = session();
  const first = saveCampusPlan(scope, { question, plan }, guard);
  plan.steps[0].title = '稍後才改的名稱';
  const second = saveCampusPlan(scope, { question, plan: sample('第二份報告') }, guard);
  const reloaded = readSavedCampusPlans(scope, session());
  await started.promise;
  expect(write).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  gate.resolve(undefined);
  await Promise.all([first, second]);
  expect((await reloaded).map((entry) => entry.plan.steps[0].title)).toEqual(['第二份報告', '資料庫報告']);
});

test('rapid progress changes merge the latest ledger, then an undo remains undone', async () => {
  const guard = session();
  const [saved] = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  await Promise.all([
    setCampusPlanStepDone(scope, saved.id, 'assignment-0', true, guard),
    setCampusPlanStepDone(scope, saved.id, 'timetable-review', true, guard),
    setCampusPlanStepDone(scope, saved.id, 'assignment-0', false, guard),
  ]);
  expect((await readSavedCampusPlans(scope, guard))[0].completedStepIds).toEqual(['timetable-review']);
  await expect(setCampusPlanStepDone(scope, saved.id, 'no-such-step', true, guard)).rejects.toMatchObject({ code: 'invalid-step' });
});

test('a slow write in one campus does not delay a different account or school', async () => {
  const started = deferred<void>();
  const gate = deferred<void>();
  write.mockImplementationOnce(async (key, raw) => { started.resolve(undefined); await gate.promise; persisted.set(key, raw); });
  const saving = saveCampusPlan(scope, { question, plan: sample() }, session());
  await started.promise;
  const other = { owner: 'firebase:student-b', schoolId: 'nthu' };
  expect(await readSavedCampusPlans(other, session())).toEqual([]);
  gate.resolve(undefined);
  await saving;
});

test('a deferred read cannot return the previous identity or write for it', async () => {
  const original = await saveCampusPlan(scope, { question, plan: sample() }, session());
  const raw = persisted.get(savedCampusPlansStorageKey(scope))!;
  const readGate = deferred<string | null>();
  const started = deferred<void>();
  let current = true;
  const guard = createSavedCampusPlanSession(() => current);
  read.mockImplementationOnce(async () => { started.resolve(undefined); return readGate.promise; });
  const result = readSavedCampusPlans(scope, guard);
  const failure = expect(result).rejects.toMatchObject({ code: 'session-changed' });
  await started.promise;
  current = false;
  readGate.resolve(raw);
  await failure;
  const writes = write.mock.calls.length;
  await expect(setCampusPlanStepDone(scope, original[0].id, 'assignment-0', true, guard)).rejects.toMatchObject({ code: 'session-changed' });
  expect(write).toHaveBeenCalledTimes(writes);
});

test('queued work is rejected before storage when its account changes', async () => {
  const started = deferred<void>();
  const gate = deferred<void>();
  let current = true;
  const guard = createSavedCampusPlanSession(() => current);
  write.mockImplementationOnce(async (key, raw) => { started.resolve(undefined); await gate.promise; persisted.set(key, raw); });
  const first = saveCampusPlan(scope, { question, plan: sample() }, guard);
  const next = saveCampusPlan(scope, { question, plan: sample('舊畫面的另一份') }, guard);
  const failures = [expect(first).rejects.toMatchObject({ code: 'session-changed' }),
    expect(next).rejects.toMatchObject({ code: 'session-changed' })];
  await started.promise;
  current = false;
  gate.resolve(undefined);
  await Promise.all(failures);
  expect(write).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
});

test('failed reads and writes propagate, preserve the accepted record, and leave retry possible', async () => {
  const guard = session();
  const [saved] = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  const before = persisted.get(savedCampusPlansStorageKey(scope));
  write.mockRejectedValueOnce(new Error('disk full'));
  await expect(setCampusPlanStepDone(scope, saved.id, 'assignment-0', true, guard)).rejects.toMatchObject({ code: 'write-failed' });
  expect(persisted.get(savedCampusPlansStorageKey(scope))).toBe(before);
  expect((await setCampusPlanStepDone(scope, saved.id, 'assignment-0', true, guard))[0].completedStepIds).toEqual(['assignment-0']);
  read.mockRejectedValueOnce(new Error('cannot read'));
  await expect(readSavedCampusPlans(scope, guard)).rejects.toMatchObject({ code: 'read-failed' });
  await expect(readSavedCampusPlans(scope, guard)).resolves.toHaveLength(1);
});

test('deleting a plan is durable and an old action cannot recreate it', async () => {
  const guard = session();
  const [saved] = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  expect(await deleteSavedCampusPlan(scope, saved.id, guard)).toEqual([]);
  expect(await readSavedCampusPlans(scope, session())).toEqual([]);
  await expect(setCampusPlanStepDone(scope, saved.id, 'assignment-0', true, guard)).rejects.toMatchObject({ code: 'not-found' });
  const [replacement] = await saveCampusPlan(scope, { question, plan: sample() }, guard);
  expect(replacement.id).not.toBe(saved.id);
});

test('sign-out drains accepted writes before deleting so earlier generic cleanup cannot be undone', async () => {
  const started = deferred<void>();
  const gate = deferred<void>();
  const guard = session();
  write.mockImplementationOnce(async (key, raw) => { started.resolve(undefined); await gate.promise; persisted.set(key, raw); });
  persisted.set('another-feature', 'keep');
  const saving = saveCampusPlan(scope, { question, plan: sample() }, guard);
  const failure = expect(saving).rejects.toMatchObject({ code: 'session-changed' });
  await started.promise;
  const cleanup = beginSavedCampusPlansSignOutCleanup();
  persisted.delete(savedCampusPlansStorageKey(scope)); // Concurrent general logout cleanup ran first.
  await expect(saveCampusPlan(scope, { question, plan: sample('晚到的按鈕') }, guard)).rejects.toMatchObject({ code: 'session-changed' });
  expect(guard()).toBe(false);
  expect(remove).not.toHaveBeenCalled();
  gate.resolve(undefined);
  await Promise.all([failure, cleanup]);
  expect(persisted.has(savedCampusPlansStorageKey(scope))).toBe(false);
  expect(persisted.get('another-feature')).toBe('keep');
  endSavedCampusPlansSignOutCleanup();
  // End of teardown does not revive an old screen, even if Firebase sign-out failed.
  await expect(saveCampusPlan(scope, { question, plan: sample() }, guard)).rejects.toMatchObject({ code: 'session-changed' });
  const nextSession = session();
  expect(await readSavedCampusPlans(scope, nextSession)).toEqual([]);
  await expect(saveCampusPlan(scope, { question, plan: sample() }, nextSession)).resolves.toHaveLength(1);
});

test('a session created during teardown stays revoked after cleanup ends', async () => {
  const cleanup = beginSavedCampusPlansSignOutCleanup();
  const during = session();
  await cleanup;
  endSavedCampusPlansSignOutCleanup();
  await expect(readSavedCampusPlans(scope, during)).rejects.toMatchObject({ code: 'session-changed' });
  expect(read).not.toHaveBeenCalled();
});

test('sign-out invalidates mounted views synchronously without sending plan data', async () => {
  const guard = session();
  const faulty = jest.fn(() => { throw new Error('unmounted view'); });
  const changed = jest.fn(() => { expect(guard()).toBe(false); });
  const removed = jest.fn();
  const stopFaulty = subscribeSavedCampusPlanInvalidation(faulty);
  const stop = subscribeSavedCampusPlanInvalidation(changed);
  const stopRemoved = subscribeSavedCampusPlanInvalidation(removed);
  stopRemoved();
  const cleanup = beginSavedCampusPlansSignOutCleanup();
  expect(faulty).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith();
  expect(removed).not.toHaveBeenCalled();
  await cleanup;
  endSavedCampusPlansSignOutCleanup();
  stopFaulty();
  stop();
});

test('failed sign-out cleanup is reported and stale sessions remain invalid after release', async () => {
  const old = session();
  await saveCampusPlan(scope, { question, plan: sample() }, old);
  remove.mockRejectedValueOnce(new Error('native failed'));
  await expect(beginSavedCampusPlansSignOutCleanup()).rejects.toMatchObject({ code: 'cleanup-failed' });
  endSavedCampusPlansSignOutCleanup();
  await expect(readSavedCampusPlans(scope, old)).rejects.toMatchObject({ code: 'session-changed' });
  await expect(readSavedCampusPlans(scope, session())).resolves.toHaveLength(1);
});
