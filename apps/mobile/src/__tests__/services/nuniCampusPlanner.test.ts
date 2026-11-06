import AsyncStorage from '@react-native-async-storage/async-storage';
import { classMeetingKey, type ClassException, type PersonalImportRecord } from '@campus/shared';
import { CourseAccessError } from '@campus/shared/src/courseAccess';
import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { buildNuniCampusPlan, isNuniCampusPlanningQuestion } from '../../services/nuniCampusPlanner';
import { copyCampusEvidencePlan } from '../../services/savedCampusPlanValidation';
import { compareCampusPlans } from '../../services/campusPlanComparison';
import { createSavedCampusPlanSession, readSavedCampusPlans, saveCampusPlan, setCampusPlanStepDone } from '../../services/savedCampusPlans';
import type { CampusEvidencePlan } from '../../services/offlineCampusPlanner';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}` }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const now = Date.parse('2026-11-06T01:00:00.000Z');
const checkedAt = new Date(now).toISOString();
const question = '幫我安排未來七天的課表與作業';
const workspace = (n = 1, patch: Partial<NuniWorkspace> = {}): NuniWorkspace => ({
  id: 'cw_' + uuid(n), title: '資料庫', state: 'active', memberRole: 'student', ...patch,
});
const record = (n = 1, patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: `imported-${n}`, kind: 'timetable', schoolId: 'pu', title: '資料庫',
  academicYear: '115', semester: '1', dayOfWeek: 5, startTime: '10:10', endTime: '12:00', location: '305',
  linkedCourseId: workspace(n).id, importedAt: '2026-11-01T05:00:00Z', batchId: 'fixture',
  source: { type: 'paste', line: 1, rawText: '不可出現在計畫的原始個資' }, ...patch,
});
const source = (...records: PersonalImportRecord[]) => ({
  timetable: null, schoolId: 'pu', records, updatedAt: '2026-11-01T05:00:00Z',
});
const assignment = (n = 1, fields: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: 'cwa_' + uuid(n), workspaceId: workspace().id, title: '作業 ' + n,
  createdAt: '2026-11-04T05:00:00Z', closedAt: null, dueAt: '2026-11-06T23:59:00+08:00',
  instructions: '不可出現在計畫的作業全文', state: 'open', unitId: null, unitTitle: null,
  mySubmission: null, submissionCount: 0, ...fields,
});
const reviewed = (id: string, fields: Record<string, unknown> = {}) => ({
  workspaceId: id, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: 'ccd_' + uuid(1), version: 1, workspaceId: id, verification: 'administrator-reviewed',
    title: '資料庫', schoolId: 'pu', academicYear: '115', semester: '1', teacher: '張老師',
    courseCode: 'MIS302', className: '資管三甲', ...fields },
});
const read = jest.mocked(readAssistantTimetable);
const input = {
  question, schoolId: 'pu', now,
  platformTimetable: { accountId, isCurrent: jest.fn<boolean, []>() },
  isCurrent: jest.fn<boolean, []>(),
  request: jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>(),
  bffRequest: jest.fn<Promise<unknown>, [string]>(),
};
const persisted = new Map<string, string>();

beforeEach(() => {
  jest.resetAllMocks();
  persisted.clear();
  input.isCurrent.mockReturnValue(true);
  input.platformTimetable.isCurrent.mockReturnValue(true);
  read.mockResolvedValue(source(record()));
  input.request.mockImplementation(async (path, body) => path === 'class-workspaces'
    ? { workspaces: [workspace()] } : reviewed(String(body?.workspaceId)));
  input.bffRequest.mockResolvedValue({ assignments: [assignment()] });
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => persisted.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => { persisted.set(key, value); });
});

async function plan(overrides: Partial<typeof input> = {}): Promise<CampusEvidencePlan> {
  const result = await buildNuniCampusPlan({ ...input, ...overrides });
  expect(result).not.toBeNull();
  return result!;
}

test('builds seven Taiwan dates from imported records without a legacy timetable and saves a true planner roundtrip', async () => {
  const result = await plan();
  expect(result.agenda?.days.map((day) => day.date)).toEqual([
    '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
  ]);
  expect(result.agenda?.days[0]).toMatchObject({ courses: [], gaps: [], conflicts: [], scheduledClasses: [
    { name: '資料庫', room: '305', startAt: '2026-11-06T02:10:00.000Z', endAt: '2026-11-06T04:00:00.000Z' },
  ], deadlines: [{ title: '作業 1', timeLabel: '23:59' }] });
  expect(result.agenda?.days.slice(1).every((day) => day.scheduledClasses?.length === 0)).toBe(true);
  expect(result.comparisonBasis?.assignments).toEqual({
    status: 'complete', checkedAt, total: 1,
    items: [{ identity: [workspace().id, assignment().id], title: '作業 1', groupName: '資料庫', dueAt: assignment().dueAt }],
  });
  expect(copyCampusEvidencePlan(result)).toEqual(result);
  expect(result.content).toContain('10:10');
  expect(result.content).not.toMatch(/第\d+節|不可出現在|group-assignment/);
  expect(read).toHaveBeenCalledWith('', 'pu', input.platformTimetable);
  expect(input.request.mock.calls).toEqual([
    ['class-workspaces'], ['course-access/workspace-course', { workspaceId: workspace().id, schoolId: 'pu' }],
  ]);
  expect(input.bffRequest.mock.calls).toEqual([[`class-workspaces/${workspace().id}/assignments`]]);
  const scope = { owner: `nuni:${accountId}`, schoolId: 'pu' };
  const session = createSavedCampusPlanSession(() => true);
  const saved = await saveCampusPlan(scope, { question, plan: result }, session);
  await setCampusPlanStepDone(scope, saved[0].id, result.steps[0].id, true, session);
  const restored = await readSavedCampusPlans(scope, createSavedCampusPlanSession(() => true));
  expect(restored[0].plan).toEqual(result);
  expect(restored[0].completedStepIds).toEqual([result.steps[0].id]);
  expect(await readSavedCampusPlans({ owner: `nuni:${accountId}`, schoolId: 'ncku' }, session)).toEqual([]);
});

function exception(row: PersonalImportRecord, fields: Partial<ClassException>): ClassException {
  return { id: 'change-' + row.id, courseKey: classMeetingKey(row), original: row,
    originalDate: '2026-11-06', kind: 'cancel', createdAt: checkedAt, ...fields };
}

test('uses saved one-day cancellation, Sunday room changes and overnight makeup occurrences on both dates', async () => {
  const friday = record();
  const sunday = record(2, { dayOfWeek: 7, title: '週日專題', startTime: '13:00', endTime: '14:00' });
  const moved = record(3, { title: '夜間實驗' });
  read.mockResolvedValue(source(
    { ...friday, classExceptions: [exception(friday, {})] },
    { ...sunday, classExceptions: [exception(sunday, { originalDate: '2026-11-08', kind: 'room', location: '901' })] },
    { ...moved, classExceptions: [exception(moved, { kind: 'move', date: '2026-11-07', endDate: '2026-11-08',
      startTime: '23:00', endTime: '01:00', location: '實驗室' })] },
  ));
  const result = await plan();
  expect(result.agenda?.days[0].scheduledClasses).toEqual([]);
  const overnight = { name: '夜間實驗', room: '實驗室', startAt: '2026-11-07T15:00:00.000Z', endAt: '2026-11-07T17:00:00.000Z' };
  expect(result.agenda?.days[1].scheduledClasses).toEqual([overnight]);
  expect(result.agenda?.days[2].scheduledClasses).toEqual([overnight,
    { name: '週日專題', room: '901', startAt: '2026-11-08T05:00:00.000Z', endAt: '2026-11-08T06:00:00.000Z' }]);
  expect(copyCampusEvidencePlan(result)).toEqual(result);
});

test('keeps full source identity for closed/submitted and outside-window items while only open unsubmitted work becomes a task', async () => {
  const done = assignment(2, { mySubmission: { assignmentId: assignment(2).id, platformAccountId: accountId,
    displayName: '學生', body: '不可出現在計畫的繳交全文', state: 'submitted', submittedAt: checkedAt,
    teacherFeedback: null, reviewedAt: null } });
  const closed = assignment(3, { state: 'closed', closedAt: checkedAt });
  const later = assignment(4, { dueAt: '2026-12-01T23:59:00+08:00' });
  const overdue = assignment(5, { dueAt: '2026-11-05T23:59:00+08:00' });
  const undated = assignment(6, { dueAt: null });
  input.bffRequest.mockResolvedValue({ assignments: [done, later, undated, closed, overdue, assignment()] });
  const result = await plan();
  expect(result.steps.filter((step) => step.evidence === 'authorized-assignments').map((step) => [step.title, step.priority])).toEqual([
    ['作業 5', 'overdue'], ['作業 1', 'urgent'], ['作業 6', 'verify'],
  ]);
  expect(result.agenda?.days.flatMap((day) => day.deadlines).map((item) => item.title)).toEqual(['作業 1']);
  expect(result.agenda?.outsideWindow.map((item) => item.title).sort()).toEqual(['作業 4', '作業 5', '作業 6']);
  expect(result.comparisonBasis?.assignments.items).toHaveLength(6);
  expect(JSON.stringify(result)).not.toMatch(/不可出現在|mySubmission|instructions|group-assignment|platformAccountId/);
  expect(copyCampusEvidencePlan(result)).toEqual(result);
});

test.each([null, source(record(1, { linkedCourseId: undefined }))])('does not infer workspace authority from a name or from a missing scoped timetable: %j', async (timetable) => {
  read.mockResolvedValue(timetable);
  const result = await plan();
  expect(input.request).not.toHaveBeenCalled();
  expect(input.bffRequest).not.toHaveBeenCalled();
  expect(result.comparisonBasis?.assignments.status).toBe('unavailable');
  expect(result.limitations.join(' ')).toContain(timetable ? '尚未連結' : '尚無法確認');
  expect(copyCampusEvidencePlan(result)).toEqual(result);
});

test.each([
  { state: 'archived' as const }, { memberRole: 'owner-teacher' as const }, { memberRole: 'co-teacher' as const },
])('a linked workspace still needs active student membership: %j', async (patch) => {
  input.request.mockResolvedValue({ workspaces: [workspace(1, patch), workspace(2)] });
  const result = await plan();
  expect(input.request).toHaveBeenCalledTimes(1);
  expect(input.bffRequest).not.toHaveBeenCalled();
  expect(result.comparisonBasis?.assignments.status).toBe('unavailable');
  expect(result.limitations.join(' ')).toContain('不是有效學生課程');
});

test.each([{ schoolId: 'ncku' }, { academicYear: '114' }, { semester: '2' }, { workspaceId: workspace(2).id }])(
  'rejects contradictory reviewed course metadata before any assignment read: %j', async (patch) => {
    input.request.mockImplementation(async (path, body) => path === 'class-workspaces'
      ? { workspaces: [workspace()] } : reviewed(String(body?.workspaceId), patch));
    const result = await plan();
    expect(input.bffRequest).not.toHaveBeenCalled();
    expect(result.comparisonBasis?.assignments.status).toBe('unavailable');
    expect(result.limitations.join(' ')).toContain('學校、學期');
  },
);

test('does not include a differently scoped saved timetable or an earlier-term binding', async () => {
  read.mockResolvedValueOnce({ ...source(record(1, { schoolId: 'ncku' })), schoolId: 'ncku' });
  expect((await plan()).agenda?.timetableAvailable).toBe(false);
  read.mockResolvedValue(source(record(1, { academicYear: '114' })));
  const result = await plan();
  expect(input.request).not.toHaveBeenCalled();
  expect(result.agenda?.timetableAvailable).toBe(false);
  expect(result.agenda?.days.every((day) => day.scheduledClasses === undefined)).toBe(true);
});

test('an unreviewed explicit binding is disclosed and never marked complete', async () => {
  input.request.mockImplementation(async (path, body) => path === 'class-workspaces' ? { workspaces: [workspace()] }
    : { workspaceId: body?.workspaceId, status: 'unreviewed', course: null, memberRole: 'student', membershipActive: true });
  const result = await plan();
  expect(result.comparisonBasis?.assignments).toMatchObject({ status: 'partial', total: null, items: [{ title: '作業 1' }] });
  expect(result.limitations.join(' ')).toContain('尚未經課程目錄核對');
});

test.each(['memberships', 'assignments', 'foreign-receipt', 'wrong-workspace'])('rejects ambiguous or foreign %s evidence', async (kind) => {
  if (kind === 'memberships') input.request.mockResolvedValue({ workspaces: [workspace(), workspace()] });
  if (kind === 'assignments') input.bffRequest.mockResolvedValue({ assignments: [assignment(), assignment()] });
  if (kind === 'wrong-workspace') input.bffRequest.mockResolvedValue({ assignments: [assignment(1, { workspaceId: workspace(2).id })] });
  if (kind === 'foreign-receipt') input.bffRequest.mockResolvedValue({ assignments: [assignment(1, { mySubmission: {
    assignmentId: assignment().id, platformAccountId: 'pa_' + uuid(2), displayName: '別人', body: 'private',
    state: 'submitted', submittedAt: checkedAt, teacherFeedback: null, reviewedAt: null,
  } })] });
  const result = await plan();
  expect(result.comparisonBasis?.assignments).toEqual({ status: 'unavailable', checkedAt: null, total: null, items: [] });
  expect(result.agenda?.assignmentsAvailable).toBe(false);
});

test('a failed source keeps successful student work partial and unlinked same-name workspaces stay unread', async () => {
  read.mockResolvedValue(source(record(), record(2), record(3, { linkedCourseId: undefined })));
  input.request.mockImplementation(async (path, body) => path === 'class-workspaces'
    ? { workspaces: [workspace(), workspace(2), workspace(3)] } : reviewed(String(body?.workspaceId)));
  input.bffRequest.mockImplementation(async (path) => {
    if (path.includes(workspace(2).id)) throw new NuniError(403, 'FORBIDDEN');
    return { assignments: [assignment()] };
  });
  const result = await plan();
  expect(result.comparisonBasis?.assignments).toMatchObject({ status: 'partial', total: null, items: [{ title: '作業 1' }] });
  expect(input.bffRequest.mock.calls.flat().join(' ')).not.toContain(workspace(3).id);
  expect(result.limitations.join(' ')).toMatch(/未依同名自動配對/);
  expect(copyCampusEvidencePlan(result)).toEqual(result);
});

test('retains at most 400 source assignments, labels 100-row pages partial and compares full identities beyond top steps', async () => {
  read.mockResolvedValue(source(...Array.from({ length: 5 }, (_, n) => record(n + 1))));
  input.request.mockImplementation(async (path, body) => path === 'class-workspaces'
    ? { workspaces: Array.from({ length: 5 }, (_, n) => workspace(n + 1)) } : reviewed(String(body?.workspaceId)));
  input.bffRequest.mockImplementation(async (path) => ({ assignments: Array.from({ length: 100 }, (_, n) => assignment(n + 1, {
    workspaceId: path.split('/')[1], title: `練習 ${n + 1}`, dueAt: n === 99 ? '2026-12-01T23:59:00+08:00' : assignment().dueAt,
  })) }));
  const first = await plan();
  expect(first.comparisonBasis?.assignments).toMatchObject({ status: 'partial', total: null });
  expect(first.comparisonBasis?.assignments.items).toHaveLength(400);
  expect(first.limitations.join(' ')).toContain('100 筆上限');
  expect(first.limitations.join(' ')).toContain('前 400 筆');
  expect(first.agenda!.days.flatMap((day) => day.deadlines).length + first.agenda!.outsideWindow.length).toBe(400);
  expect(copyCampusEvidencePlan(first)).toEqual(first);
  input.bffRequest.mockImplementation(async (path) => ({ assignments: Array.from({ length: 100 }, (_, n) => assignment(n + 1, {
    workspaceId: path.split('/')[1], title: `練習 ${n + 1}`,
    dueAt: n === 49 ? '2026-11-06T13:00:00+08:00' : n === 99 ? '2026-12-01T23:59:00+08:00' : assignment().dueAt,
  })) }));
  const second = await plan({ now: now + 60_000 });
  const comparison = compareCampusPlans(first, second);
  expect(comparison.changes.filter((item) => item.category === 'assignment' && item.kind === 'changed')).toHaveLength(4);
});

test('a late-listed workspace urgent pending task survives the 400-row cap ahead of closed and submitted work', async () => {
  read.mockResolvedValue(source(...Array.from({ length: 5 }, (_, n) => record(n + 1))));
  input.request.mockImplementation(async (path, body) => path === 'class-workspaces'
    ? { workspaces: Array.from({ length: 5 }, (_, n) => workspace(n + 1)) } : reviewed(String(body?.workspaceId)));
  input.bffRequest.mockImplementation(async (path) => {
    const workspaceId = path.split('/')[1];
    return { assignments: workspaceId === workspace(5).id
      ? [assignment(999, { workspaceId, title: '下一堂前截止的急件', dueAt: '2026-11-06T09:30:00+08:00' })]
      : Array.from({ length: 100 }, (_, n) => assignment(n + 1, { workspaceId, state: 'closed', closedAt: checkedAt })) };
  });
  const result = await plan();
  expect(result.comparisonBasis?.assignments.items).toHaveLength(400);
  expect(result.comparisonBasis?.assignments.status).toBe('partial');
  expect(result.comparisonBasis?.assignments.items[0].identity).toEqual([workspace(5).id, assignment(999).id]);
  expect(result.steps[0]).toMatchObject({ title: '下一堂前截止的急件', priority: 'urgent' });
  expect(result.agenda?.days[0].deadlines).toHaveLength(1);
});

test('caps queried workspaces and limits parallel course requests', async () => {
  read.mockResolvedValue(source(...Array.from({ length: 14 }, (_, n) => record(n + 1))));
  let active = 0;
  let maximum = 0;
  input.request.mockImplementation(async (path, body) => {
    if (path === 'class-workspaces') return { workspaces: Array.from({ length: 14 }, (_, n) => workspace(n + 1)) };
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    return reviewed(String(body?.workspaceId));
  });
  input.bffRequest.mockResolvedValue({ assignments: [] });
  const result = await plan();
  expect(input.bffRequest).toHaveBeenCalledTimes(12);
  expect(maximum).toBeLessThanOrEqual(3);
  expect(result.comparisonBasis?.assignments).toMatchObject({ status: 'partial', total: null, items: [] });
  expect(result.limitations.join(' ')).toContain('最多查詢 12 門');
});

test.each(['local', 'memberships', 'directory', 'assignments'])('discards a scope change during %s without returning private data', async (stage) => {
  if (stage === 'local') read.mockImplementationOnce(async () => { input.isCurrent.mockReturnValue(false); return source(record()); });
  if (stage === 'memberships') input.request.mockImplementationOnce(async () => {
    input.platformTimetable.isCurrent.mockReturnValue(false); return { workspaces: [workspace()] };
  });
  if (stage === 'directory') input.request.mockImplementation(async (path, body) => {
    if (path === 'class-workspaces') return { workspaces: [workspace()] };
    input.isCurrent.mockReturnValue(false); return reviewed(String(body?.workspaceId));
  });
  if (stage === 'assignments') input.bffRequest.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false); return { assignments: [assignment()] };
  });
  expect(await buildNuniCampusPlan(input)).toBeNull();
  if (stage !== 'assignments') expect(input.bffRequest).not.toHaveBeenCalled();
});

test.each([new NuniError(401, 'UNAUTHENTICATED'), new CourseAccessError('SESSION_EXPIRED', 401)])(
  'rejects a revoked session even if local account predicates have not changed: %j', async (error) => {
    input.request.mockRejectedValue(error);
    expect(await buildNuniCampusPlan(input)).toBeNull();
    expect(input.bffRequest).not.toHaveBeenCalled();
  },
);

test('one revoked parallel membership read stops the other workers before assignment requests', async () => {
  read.mockResolvedValue(source(record(), record(2), record(3)));
  const release: Array<() => void> = [];
  input.request.mockImplementation(async (path, body) => {
    if (path === 'class-workspaces') return { workspaces: [workspace(), workspace(2), workspace(3)] };
    if (body?.workspaceId === workspace().id) throw new NuniError(401, 'UNAUTHENTICATED');
    return new Promise((resolve) => { release.push(() => resolve(reviewed(String(body?.workspaceId)))); });
  });
  expect(await buildNuniCampusPlan(input)).toBeNull();
  expect(release).toHaveLength(2);
  release.forEach((resolve) => resolve());
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('does not return a plan after cancellation or a timetable rebind while assignments were loading', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await buildNuniCampusPlan({ ...input, signal: controller.signal })).toBeNull();
  expect(read).not.toHaveBeenCalled();
  read.mockResolvedValueOnce(source(record())).mockResolvedValueOnce(source(record(1, { linkedCourseId: workspace(2).id })));
  expect(await buildNuniCampusPlan(input)).toBeNull();
});

test('an unreadable or over-limit daily timetable never turns incomplete dates into confirmed empty days', async () => {
  read.mockResolvedValue(source(record(1, { startTime: '25:00' })));
  let result = await plan();
  expect(result.agenda?.timetableAvailable).toBe(false);
  expect(result.agenda?.days.every((day) => !('scheduledClasses' in day))).toBe(true);
  expect(result.comparisonBasis?.timetableUpdatedAt).toBeNull();
  read.mockResolvedValue(source(...Array.from({ length: 81 }, (_, n) => record(1, { id: `row-${n}` }))));
  result = await plan();
  expect(result.agenda?.timetableAvailable).toBe(false);
  expect(copyCampusEvidencePlan(result)).toEqual(result);
});

test.each(['幫我安排未來七天的課表與作業', '本週學習計畫', '明天作業優先順序', '下週讀書計畫'])('recognizes a read-only study plan: %s', (text) => {
  expect(isNuniCampusPlanningQuestion(text)).toBe(true);
});
test.each(['幫我安排今天作業並直接提交', '下一堂課在哪裡', '幫我發訊息給老師', '有什麼作業'])('does not reinterpret a mutation or a course lookup as a plan: %s', (text) => {
  expect(isNuniCampusPlanningQuestion(text)).toBe(false);
});
