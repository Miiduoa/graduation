import { NuniError, type NuniAssignment, type NuniWorkspace } from '@campus/shared/src/nuni';
import type { PersonalImportRecord } from '@campus/shared';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { readNuniClassCoursework } from '../../services/nuniClassCoursework';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const course = (n: number, fields: Partial<NuniWorkspace> = {}): NuniWorkspace => ({
  id: 'cw_' + uuid(n), title: '資料庫', state: 'active', memberRole: 'student', ...fields,
});
const occurrence = {
  courseId: 'imported-db', name: '資料庫', date: '2026-11-05', term: '115|1', room: '305',
  startTime: '08:10', endTime: '10:00',
};
const record: PersonalImportRecord = {
  kind: 'timetable', schoolId: 'pu', id: occurrence.courseId, title: occurrence.name,
  batchId: 'fixture', academicYear: '115', semester: '1', dayOfWeek: 4, startPeriod: 1, endPeriod: 2,
  location: '305', importedAt: '2026-09-01T05:00:00Z', source: { type: 'paste', line: 1, rawText: '' },
};
const source = (...records: PersonalImportRecord[]) => ({
  timetable: null, schoolId: 'pu', updatedAt: record.importedAt, records,
});
const assignment = (n: number, fields: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: 'cwa_' + uuid(n), workspaceId: course(1).id, title: '練習 ' + n,
  createdAt: '2026-11-04T05:00:00Z', closedAt: null, dueAt: '2026-11-05T10:00:00Z',
  instructions: '不傳給助理的全文', state: 'open', unitId: null, unitTitle: null,
  mySubmission: null, submissionCount: 0, ...fields,
});
const input = {
  occurrence, accountId, schoolId: 'pu', isCurrent: jest.fn<boolean, []>(),
  request: jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>(), bffRequest: jest.fn<Promise<unknown>, [string]>(),
};
const unreviewed = (id: unknown) => ({
  workspaceId: id, memberRole: 'student', membershipActive: true, status: 'unreviewed', course: null,
});
const reviewed = (id: string, fields: Record<string, unknown> = {}) => ({
  workspaceId: id, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: 'ccd_' + uuid(1), version: 1, workspaceId: id, verification: 'administrator-reviewed',
    title: '資料庫', schoolId: 'pu', academicYear: '115', semester: '1', teacher: '張老師', courseCode: 'MIS302', className: '資管三甲', ...fields },
});
const read = jest.mocked(readAssistantTimetable);
const linked = { ...record, linkedCourseId: course(1).id };
beforeEach(() => {
  jest.resetAllMocks();
  input.isCurrent.mockReturnValue(true);
  read.mockResolvedValue(source(linked));
  input.request.mockResolvedValue({ workspaces: [course(1)] });
  input.bffRequest.mockResolvedValue({ assignments: [] });
});

test('reads only the bound, active student workspace even when its name differs; presents pending work before submitted', async () => {
  input.request.mockResolvedValue({ workspaces: [course(2), course(1, { title: '資料庫 A 班' })] });
  const done = assignment(2, { mySubmission: {
    assignmentId: assignment(2).id, platformAccountId: accountId, displayName: '測試學生',
    body: '私人的繳交內容', state: 'submitted', submittedAt: '2026-11-01T12:00:00+08:00',
    teacherFeedback: null, reviewedAt: null,
  } });
  input.bffRequest.mockResolvedValue({ assignments: [done, assignment(1)] });
  const result = await readNuniClassCoursework(input);
  expect(result).toEqual({
    kind: 'assignments', workspace: { id: course(1).id, title: '資料庫 A 班' }, limited: false,
    assignments: [assignment(1), done].map(({ id, title, dueAt, state, mySubmission }) => ({
      id, title, dueAt, state, submittedAt: mySubmission?.submittedAt ?? null,
    })),
  });
  expect(input.request.mock.calls).toEqual([['class-workspaces']]);
  expect(input.bffRequest.mock.calls).toEqual([[`class-workspaces/${course(1).id}/assignments`]]);
  expect(read).toHaveBeenCalledWith('', 'pu', expect.objectContaining({ accountId }));
});

test.each([1, 2])('unlinked timetable with %d name matches needs explicit confirmation, never fetches every course', async (count) => {
  read.mockResolvedValue(source(record));
  const matches = [course(1), course(2)].slice(0, count);
  input.request.mockImplementation(async (path, body) => path !== 'class-workspaces' ? unreviewed(body?.workspaceId) : { workspaces: [
    ...matches, course(3, { state: 'archived' }), course(4, { memberRole: 'co-teacher' }), course(5, { title: '資料庫系統' }),
  ] });
  expect(await readNuniClassCoursework(input)).toEqual({
    kind: 'choose', workspaces: matches.map(({ id, title }) => ({ id, title })),
  });
  expect(input.bffRequest).not.toHaveBeenCalled();
  const selected = matches[count - 1];
  expect(await readNuniClassCoursework({ ...input, selectedWorkspaceId: selected.id })).toEqual({
    kind: 'assignments', workspace: { id: selected.id, title: selected.title }, assignments: [], limited: false,
  });
  expect(input.request.mock.calls.filter(([path]) => path === 'class-workspaces')).toHaveLength(2);
  expect(input.bffRequest.mock.calls).toEqual([[`class-workspaces/${selected.id}/assignments`]]);
});

test.each([[], [course(1, { state: 'archived' }), course(2)], [course(1, { memberRole: 'owner-teacher' }), course(2)]])(
  'stale binding never substitutes a different same-name workspace', async (...courses) => {
    input.request.mockResolvedValue({ workspaces: courses });
    expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unlinked' });
    expect(input.bffRequest).not.toHaveBeenCalled();
  },
);

test('checks a selected suggestion against its new membership and the current saved link', async () => {
  input.request.mockResolvedValue({ workspaces: [course(1), course(2)] });
  expect(await readNuniClassCoursework({ ...input, selectedWorkspaceId: course(2).id })).toEqual({ kind: 'changed' });
  read.mockResolvedValue(source(record));
  input.request.mockResolvedValue({ workspaces: [course(2, { title: '經濟學' })] });
  expect(await readNuniClassCoursework({ ...input, selectedWorkspaceId: course(2).id })).toEqual({ kind: 'changed' });
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test.each([
  { title: '更改的課程' }, { schoolId: 'ncku' }, { semester: '2' }, { startPeriod: 2 }, { endPeriod: 3 },
])('rejects a changed timetable occurrence before contacting the platform: %j', async (override) => {
  read.mockResolvedValue(source({ ...linked, ...override }));
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'changed' });
  expect(input.request).not.toHaveBeenCalled();
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('does not present the fetched assignments if the timetable was rebound in flight', async () => {
  read.mockResolvedValueOnce(source(linked)).mockResolvedValueOnce(source({ ...linked, linkedCourseId: course(2).id }));
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'changed' });
  expect(input.bffRequest).toHaveBeenCalledTimes(1);
});

test.each(['local', 'memberships', 'assignments'])('drops responses after context change during %s', async (stage) => {
  if (stage === 'local') read.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false);
    return source(linked);
  });
  if (stage === 'memberships') input.request.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false);
    return { workspaces: [course(1)] };
  });
  if (stage === 'assignments') input.bffRequest.mockImplementationOnce(async () => {
    input.isCurrent.mockReturnValue(false);
    return { assignments: [] };
  });
  await expect(readNuniClassCoursework(input)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(input.bffRequest).toHaveBeenCalledTimes(stage === 'assignments' ? 1 : 0);
});

test('keeps unavailable, empty and source-capped results separate', async () => {
  read.mockRejectedValueOnce(new Error('cache broken'));
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unavailable' });
  expect(input.request).not.toHaveBeenCalled();
  input.bffRequest.mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN'));
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unavailable' });
  expect(await readNuniClassCoursework(input)).toMatchObject({ kind: 'assignments', assignments: [], limited: false });
  input.bffRequest.mockResolvedValueOnce({ assignments: Array.from({ length: 100 }, (_, n) => assignment(n + 1)) });
  expect(await readNuniClassCoursework(input)).toMatchObject({ kind: 'assignments', limited: true });
});

test('rejects wrong-workspace assignment rows, foreign submission receipts and duplicate assignment IDs', async () => {
  input.bffRequest.mockResolvedValueOnce({ assignments: [assignment(1, { workspaceId: course(2).id })] });
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unavailable' });
  const foreign = assignment(1, { mySubmission: {
    assignmentId: assignment(1).id, platformAccountId: 'pa_' + uuid(3), displayName: '另一帳號',
    body: '不可讀取', state: 'submitted', submittedAt: '2026-11-05T05:00:00Z', teacherFeedback: null, reviewedAt: null,
  } });
  input.bffRequest.mockResolvedValueOnce({ assignments: [foreign] });
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unavailable' });
  input.bffRequest.mockResolvedValueOnce({ assignments: [assignment(1), assignment(1)] });
  expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unavailable' });
});

test('enriches duplicates from verified directory metadata and sends only the canonical school and workspace IDs', async () => {
  read.mockResolvedValue(source(record));
  const [a, b] = [course(1), course(2)];
  input.request.mockImplementation(async (path, body) => {
    if (path === 'class-workspaces') return { workspaces: [a, b] };
    return body?.workspaceId === b.id ? unreviewed(b.id) : reviewed(a.id, { academicYear: '2026', semester: '上學期' });
  });
  expect(await readNuniClassCoursework({ ...input, schoolId: 'tw-pu' })).toEqual({
    kind: 'choose', workspaces: [
      { id: a.id, title: a.title, reviewed: { schoolId: 'pu', academicYear: '115', semester: '1',
        teacher: '張老師', courseCode: 'MIS302', className: '資管三甲' } },
      { id: b.id, title: b.title },
    ],
  });
  expect(input.request.mock.calls).toEqual([
    ['class-workspaces'],
    ['course-access/workspace-course', { workspaceId: a.id, schoolId: 'pu' }],
    ['course-access/workspace-course', { workspaceId: b.id, schoolId: 'pu' }],
  ]);
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('bounds optional directory reads on slow requests, denial and large numbers of duplicate titles', async () => {
  jest.useFakeTimers();
  try {
    read.mockResolvedValue(source(record));
    input.request.mockImplementation(async (path, body) => {
      if (path === 'class-workspaces') return { workspaces: [course(1), course(2)] };
      if (body?.workspaceId === course(1).id) throw new NuniError(403, 'FORBIDDEN');
      return new Promise(() => {});
    });
    const pending = readNuniClassCoursework(input);
    await jest.advanceTimersByTimeAsync(2501);
    expect(await pending).toEqual({ kind: 'choose', workspaces: [{ id: course(2).id, title: '資料庫' }] });
    input.request.mockReset().mockResolvedValue({ workspaces: [1, 2, 3, 4, 5].map(n => course(n)) });
    expect(await readNuniClassCoursework(input)).toEqual({ kind: 'unlinked' });
    expect(input.request.mock.calls).toEqual([['class-workspaces']]);
    expect(input.bffRequest).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test.each([{ academicYear: '114' }, { semester: '2' }, { schoolId: 'ncku' }, { workspaceId: course(3).id }, { title: '會計' }])(
  'excludes contradictory reviewed metadata, including membership changes after a suggestion: %j', async (invalid) => {
    read.mockResolvedValue(source(record));
    const [a, b] = [course(1), course(2)];
    input.request.mockImplementation(async (path, body) => path === 'class-workspaces' ? { workspaces: [a, b] }
      : body?.workspaceId === a.id ? reviewed(a.id) : reviewed(b.id, invalid));
    const result = await readNuniClassCoursework(input);
    expect(result).toMatchObject({ kind: 'choose', workspaces: [{ id: a.id, reviewed: { teacher: '張老師' } }] });
    input.request.mockImplementation(async (path) => path === 'class-workspaces' ? { workspaces: [a] } : reviewed(a.id, invalid));
    expect(await readNuniClassCoursework({ ...input, selectedWorkspaceId: a.id })).toEqual({ kind: 'changed' });
    expect(input.bffRequest).not.toHaveBeenCalled();
  },
);

test('does not silently downgrade a confirmed, reviewed choice if the displayed teacher or its verification changed', async () => {
  read.mockResolvedValue(source(record));
  const a = course(1);
  const expectedReviewed = { schoolId: 'pu', academicYear: '115', semester: '1', courseCode: 'MIS302', teacher: '張老師', className: '資管三甲' };
  for (const detail of [unreviewed(a.id), reviewed(a.id, { teacher: '林老師' })]) {
    input.request.mockImplementation(async (path) => path === 'class-workspaces' ? { workspaces: [a] } : detail);
    expect(await readNuniClassCoursework({ ...input, selectedWorkspaceId: a.id, expectedReviewed })).toEqual({ kind: 'changed' });
  }
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('a repeat query against an earlier explicit link stops if the saved link was removed or replaced', async () => {
  for (const current of [record, { ...record, linkedCourseId: course(2).id }]) {
    read.mockResolvedValue(source(current));
    expect(await readNuniClassCoursework({ ...input, expectedLinkedWorkspaceId: course(1).id })).toEqual({ kind: 'changed' });
  }
  expect(input.request).not.toHaveBeenCalled();
});
