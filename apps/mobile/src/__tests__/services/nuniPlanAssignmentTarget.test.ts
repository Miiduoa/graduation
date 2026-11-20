import type { PersonalImportRecord } from '@campus/shared';
import { CourseAccessError } from '@campus/shared/src/courseAccess';
import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { readNuniPlanAssignmentTarget, type NuniPlanAssignmentSource } from '../../services/nuniPlanAssignmentTarget';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const workspaceId = 'cw_' + uuid(1);
const assignmentId = 'cwa_' + uuid(1);
const target: NuniPlanAssignmentSource = {
  accountId, schoolId: 'pu', academicYear: '115', semester: '1', workspaceId, assignmentId,
};
const record: PersonalImportRecord = {
  kind: 'timetable', schoolId: 'pu', id: 'saved-database', title: '資料庫',
  batchId: 'fixture', academicYear: '115', semester: '1', linkedCourseId: workspaceId,
  importedAt: '2026-09-01T05:00:00Z', source: { type: 'paste', line: 1, rawText: '不傳給伺服器的匯入內容' },
};
const snapshot = (...records: PersonalImportRecord[]) => ({
  timetable: null, schoolId: 'pu', updatedAt: record.importedAt, records,
});
const workspace = (fields: Partial<NuniWorkspace> = {}): NuniWorkspace => ({
  id: workspaceId, title: '資料庫新名稱', state: 'active', memberRole: 'student', ...fields,
});
const assignment = (n: number, fields: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: 'cwa_' + uuid(n), workspaceId, title: '同名作業', createdAt: '2026-11-04T05:00:00Z',
  closedAt: null, dueAt: '2026-11-08T10:00:00Z', instructions: '不應出現在導覽參數的作業全文',
  state: 'open', unitId: null, unitTitle: null, mySubmission: null, submissionCount: 0, ...fields,
});
const reviewed = (fields: Record<string, unknown> = {}) => ({
  workspaceId, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: 'ccd_' + uuid(1), version: 1, workspaceId, verification: 'administrator-reviewed',
    title: '資料庫', schoolId: 'pu', academicYear: '115', semester: '1', courseCode: 'MIS302',
    teacher: '張老師', className: '資管三甲', ...fields },
});
const unreviewed = () => ({
  workspaceId, status: 'unreviewed', membershipActive: true, memberRole: 'student', course: null,
});
const ready = {
  kind: 'ready', params: { tab: 'courses', workspaceId, assignmentId, assistantAccountId: accountId },
};
const input = {
  source: target, accountId, schoolId: 'pu', isCurrent: jest.fn<boolean, []>(),
  request: jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>(),
  bffRequest: jest.fn<Promise<unknown>, [string]>(),
};
const read = jest.mocked(readAssistantTimetable);
const workspacePath = `class-workspaces/${workspaceId}`;
const assignmentsPath = `${workspacePath}/assignments`;

beforeEach(() => {
  jest.resetAllMocks();
  input.isCurrent.mockReturnValue(true);
  read.mockResolvedValue(snapshot(record));
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace() : reviewed());
  input.bffRequest.mockResolvedValue({ assignments: [assignment(2), assignment(1)] });
});

test('rechecks the exact saved workspace and assignment despite identical display names and deadlines', async () => {
  const result = await readNuniPlanAssignmentTarget(input);
  expect(result).toEqual(ready);
  expect(input.request.mock.calls).toEqual([
    [workspacePath], ['course-access/workspace-course', { workspaceId, schoolId: 'pu' }],
  ]);
  expect(input.bffRequest.mock.calls).toEqual([[assignmentsPath]]);
  expect(read.mock.calls).toEqual(Array.from({ length: 2 }, () => [
    '', 'pu', { accountId, isCurrent: input.isCurrent },
  ]));
  expect(JSON.stringify(result)).not.toContain('全文');
  expect(JSON.stringify(input.request.mock.calls)).not.toContain('匯入內容');
});

test('supports record-only, unscheduled imports and repeated meetings without inventing an occurrence', async () => {
  const second = { ...record, id: 'saved-database-second', dayOfWeek: 2 as const, startTime: '13:00', endTime: '14:00' };
  read.mockResolvedValueOnce(snapshot(record, second)).mockResolvedValueOnce(snapshot(second, record));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
});

test('can open a linked unreviewed workspace only after fresh student membership and directory reads', async () => {
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace() : unreviewed());
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
  expect(input.request.mock.calls).toHaveLength(2);
});

test('normalizes existing import term aliases but requires canonical source references', async () => {
  read.mockResolvedValue(snapshot({ ...record, academicYear: '2026', semester: '上學期' }));
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace()
    : reviewed({ academicYear: '2026', semester: '上學期' }));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
});

test.each([
  { source: undefined }, { source: null }, { source: [] },
  { source: { ...target, accountId: '' } },
  { source: { ...target, workspaceId: workspaceId + '/assignments' } },
  { source: { ...target, assignmentId: 'cwq_' + uuid(1) } },
  { source: { ...target, assignmentId: 'assignment-0' } },
  { source: { ...target, schoolId: 'tw-pu' } },
  { source: { ...target, schoolId: ' PU ' } },
  { source: { ...target, academicYear: '2026' } },
  { source: { ...target, academicYear: '115學年度' } },
  { source: { ...target, semester: '上學期' } },
  { source: { ...target, semester: '3' } },
])('rejects malformed or noncanonical source before local or remote reads: %j', async (override) => {
  expect(await readNuniPlanAssignmentTarget({ ...input, ...override } as typeof input)).toEqual({ kind: 'changed' });
  expect(read).not.toHaveBeenCalled();
  expect(input.request).not.toHaveBeenCalled();
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('a different account or selected school cannot reuse a live reference', async () => {
  expect(await readNuniPlanAssignmentTarget({ ...input, accountId: 'pa_' + uuid(2) })).toEqual({ kind: 'session-changed' });
  expect(await readNuniPlanAssignmentTarget({ ...input, schoolId: 'ncku' })).toEqual({ kind: 'changed' });
  expect(read).not.toHaveBeenCalled();
  expect(input.request).not.toHaveBeenCalled();
});

test('a stale session or an already cancelled tap performs no source reads', async () => {
  input.isCurrent.mockReturnValue(false);
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'session-changed' });
  input.isCurrent.mockReturnValue(true);
  const controller = new AbortController();
  controller.abort();
  expect(await readNuniPlanAssignmentTarget({ ...input, signal: controller.signal })).toEqual({ kind: 'cancelled' });
  expect(read).not.toHaveBeenCalled();
  expect(input.request).not.toHaveBeenCalled();
});

test.each([
  null, snapshot(), snapshot({ ...record, linkedCourseId: undefined }),
  snapshot({ ...record, linkedCourseId: 'cw_' + uuid(2) }),
  snapshot({ ...record, schoolId: 'ncku' }),
  snapshot({ ...record, academicYear: '114' }),
  snapshot({ ...record, semester: '2' }),
  snapshot({ ...record, semester: '' }),
  snapshot(record, record),
  snapshot(record, { ...record, linkedCourseId: 'cw_' + uuid(2) }),
  { ...snapshot(record), schoolId: 'ncku' },
])('does not substitute same-name courses when the current saved binding is absent or ambiguous: %j', async (local) => {
  read.mockResolvedValue(local);
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
  expect(input.request).not.toHaveBeenCalled();
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test.each([{ academicYear: '114' }, { semester: '2' }, { schoolId: 'ncku' }])(
  'a workspace linked across incompatible scopes is ambiguous even if one row matches: %j', async (scope) => {
    read.mockResolvedValue(snapshot(record, { ...record, id: 'other-link', ...scope }));
    expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
    expect(input.request).not.toHaveBeenCalled();
  },
);

test.each([{ state: 'archived' as const }, { memberRole: 'owner-teacher' as const }, { memberRole: 'co-teacher' as const }])(
  'requires current active student membership before directory or assignment reads: %j', async (fields) => {
    input.request.mockResolvedValue(workspace(fields));
    expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
    expect(input.request.mock.calls).toEqual([[workspacePath]]);
    expect(input.bffRequest).not.toHaveBeenCalled();
  },
);

test('does not accept a membership response for another workspace', async () => {
  input.request.mockResolvedValue(workspace({ id: 'cw_' + uuid(2) }));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test.each([{ academicYear: '114' }, { semester: '2' }])('reviewed directory term must match the exact saved source: %j', async (fields) => {
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace() : reviewed(fields));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test.each([
  reviewed({ schoolId: 'ncku' }), reviewed({ workspaceId: 'cw_' + uuid(2) }),
  { ...reviewed(), workspaceId: 'cw_' + uuid(2) },
  { ...reviewed(), membershipActive: false },
])('rejects contradictory directory identity or membership: %j', async (detail) => {
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace() : detail);
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('an unreviewed directory must still confirm student membership', async () => {
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace()
    : { ...unreviewed(), memberRole: 'co-teacher' });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('does not replace a missing exact assignment with another identical display row', async () => {
  input.bffRequest.mockResolvedValue({ assignments: [assignment(2)] });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
});

test.each([
  [assignment(1), assignment(1)],
  [assignment(1), assignment(2), assignment(2)],
  [assignment(1, { workspaceId: 'cw_' + uuid(2) })],
  [assignment(1), assignment(2, { workspaceId: 'cw_' + uuid(2) })],
])('rejects duplicate or foreign-workspace rows rather than choosing a plausible target: %j', async (...assignments) => {
  input.bffRequest.mockResolvedValue({ assignments });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
});

test.each(['account', 'assignment'])('rejects a submission receipt for the wrong %s', async (mismatch) => {
  input.bffRequest.mockResolvedValue({ assignments: [assignment(1, { mySubmission: {
    assignmentId: mismatch === 'assignment' ? 'cwa_' + uuid(2) : assignmentId,
    platformAccountId: mismatch === 'account' ? 'pa_' + uuid(2) : accountId,
    displayName: '學生', body: '私人繳交內容', state: 'submitted', submittedAt: '2026-11-05T05:00:00Z',
    teacherFeedback: null, reviewedAt: null,
  } })] });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
});

test('fresh renamed, rescheduled, closed and submitted work remains reviewable by the same true ID', async () => {
  input.bffRequest.mockResolvedValue({ assignments: [assignment(1, {
    title: '老師已更名的作業', dueAt: '2026-12-01T10:00:00Z', state: 'closed', closedAt: '2026-11-06T05:00:00Z',
    mySubmission: { assignmentId, platformAccountId: accountId, displayName: '學生', body: '私人繳交內容',
      state: 'submitted', submittedAt: '2026-11-05T05:00:00Z', teacherFeedback: '已批改', reviewedAt: '2026-11-06T04:00:00Z' },
  })] });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
});

test('distinguishes a missing row in a bounded complete list from a capped list, and never slices an overflow', async () => {
  input.bffRequest.mockResolvedValueOnce({ assignments: Array.from({ length: 99 }, (_, n) => assignment(n + 2)) });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
  input.bffRequest.mockResolvedValueOnce({ assignments: Array.from({ length: 100 }, (_, n) => assignment(n + 2)) });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
  input.bffRequest.mockResolvedValueOnce({ assignments: Array.from({ length: 100 }, (_, n) => assignment(n + 1)) });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
  input.bffRequest.mockResolvedValueOnce({ assignments: Array.from({ length: 101 }, (_, n) => assignment(n + 1)) });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
});

test.each([
  null, snapshot(), snapshot({ ...record, linkedCourseId: undefined }),
  snapshot({ ...record, linkedCourseId: 'cw_' + uuid(2) }),
  snapshot({ ...record, semester: '2' }), snapshot({ ...record, id: 'replacement-local-record' }),
  snapshot(record, { ...record, id: 'added-meeting' }),
])('rechecks the binding after network reads and rejects a changed or replaced source: %j', async (latest) => {
  read.mockResolvedValueOnce(snapshot(record)).mockResolvedValueOnce(latest);
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
  expect(input.bffRequest).toHaveBeenCalledTimes(1);
});

test('unrelated imports and display changes do not invalidate an unchanged explicit binding', async () => {
  read.mockResolvedValueOnce(snapshot(record)).mockResolvedValueOnce(snapshot(
    { ...record, title: '改名', startTime: '14:00', endTime: '15:00' },
    { ...record, id: 'other', linkedCourseId: 'cw_' + uuid(2) },
  ));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
});

test('captures the source IDs before awaiting storage so a mutated reference cannot redirect the tap', async () => {
  const source = { ...target };
  read.mockImplementationOnce(async () => {
    source.assignmentId = 'cwa_' + uuid(2);
    source.workspaceId = 'cw_' + uuid(2);
    return snapshot(record);
  });
  expect(await readNuniPlanAssignmentTarget({ ...input, source })).toEqual(ready);
  expect(input.bffRequest.mock.calls).toEqual([[assignmentsPath]]);
});

test.each(['local', 'membership', 'directory', 'assignments', 'recheck'])('drops late results after a session change during %s', async (stage) => {
  if (stage === 'local') read.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false); return snapshot(record);
  });
  if (stage === 'membership') input.request.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false); return workspace();
  });
  if (stage === 'directory') input.request.mockImplementation(async (path) => {
    if (path === workspacePath) return workspace();
    input.isCurrent.mockReturnValue(false); return reviewed();
  });
  if (stage === 'assignments') input.bffRequest.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false); return { assignments: [assignment(1)] };
  });
  if (stage === 'recheck') read.mockResolvedValueOnce(snapshot(record)).mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false); return snapshot(record);
  });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'session-changed' });
  expect(input.bffRequest).toHaveBeenCalledTimes(['assignments', 'recheck'].includes(stage) ? 1 : 0);
});

test.each(['local', 'membership', 'directory', 'assignments', 'recheck'])('cancellation during %s prevents later reads and navigation', async (stage) => {
  const controller = new AbortController();
  if (stage === 'local') read.mockImplementationOnce(async () => {
    controller.abort(); return snapshot(record);
  });
  if (stage === 'membership') input.request.mockImplementationOnce(async () => {
    controller.abort(); return workspace();
  });
  if (stage === 'directory') input.request.mockImplementation(async (path) => {
    if (path === workspacePath) return workspace();
    controller.abort(); return reviewed();
  });
  if (stage === 'assignments') input.bffRequest.mockImplementationOnce(async () => {
    controller.abort(); return { assignments: [assignment(1)] };
  });
  if (stage === 'recheck') read.mockResolvedValueOnce(snapshot(record)).mockImplementationOnce(async () => {
    controller.abort(); return snapshot(record);
  });
  expect(await readNuniPlanAssignmentTarget({ ...input, signal: controller.signal })).toEqual({ kind: 'cancelled' });
  expect(input.bffRequest).toHaveBeenCalledTimes(['assignments', 'recheck'].includes(stage) ? 1 : 0);
});

test.each([
  ['membership', new NuniError(401, 'UNAUTHENTICATED')],
  ['directory', new CourseAccessError('UNAUTHENTICATED', 401)],
  ['assignments', new NuniError(401, 'UNAUTHENTICATED')],
  ['assignments', new NuniError(409, 'SESSION_CHANGED')],
] as const)('reports expired sessions separately from retryable reads at %s', async (stage, error) => {
  if (stage === 'membership') input.request.mockRejectedValueOnce(error);
  if (stage === 'directory') input.request.mockImplementation(async (path) => {
    if (path === workspacePath) return workspace();
    throw error;
  });
  if (stage === 'assignments') input.bffRequest.mockRejectedValueOnce(error);
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'session-changed' });
});

test.each([new NuniError(403, 'FORBIDDEN'), new NuniError(404, 'NOT_FOUND'), new CourseAccessError('COURSE_FORBIDDEN', 403)])(
  'does not navigate after authorization is denied: %j', async (error) => {
    input.request.mockRejectedValueOnce(error);
    expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'changed' });
    expect(input.bffRequest).not.toHaveBeenCalled();
  },
);

test('a retryable source failure can retry the same target without retaining authority', async () => {
  input.bffRequest.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
  expect(await readNuniPlanAssignmentTarget(input)).toEqual(ready);
  expect(input.request.mock.calls.filter(([path]) => path === workspacePath)).toHaveLength(2);
});

test.each(['local', 'directory', 'recheck'])('unavailable %s evidence never falls back to stale plan authority', async (stage) => {
  if (stage === 'local') read.mockRejectedValueOnce(new Error('storage unavailable'));
  if (stage === 'directory') input.request.mockImplementation(async (path) => {
    if (path === workspacePath) return workspace();
    throw new Error('network unavailable');
  });
  if (stage === 'recheck') read.mockResolvedValueOnce(snapshot(record)).mockRejectedValueOnce(new Error('storage unavailable'));
  expect(await readNuniPlanAssignmentTarget(input)).toEqual({ kind: 'unavailable' });
  expect(input.bffRequest).toHaveBeenCalledTimes(stage === 'recheck' ? 1 : 0);
});
