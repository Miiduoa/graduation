import type { PersonalImportRecord } from '@campus/shared';
import { NuniError, type NuniQuiz, type NuniQuizResponse, type NuniWorkspace } from '@campus/shared/src/nuni';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { readNuniPlanQuizTarget, type NuniPlanQuizSource } from '../../services/nuniPlanAssignmentTarget';

jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const workspaceId = 'cw_' + uuid(1);
const quizId = 'cwq_' + uuid(1);
const source: NuniPlanQuizSource = {
  accountId, schoolId: 'pu', academicYear: '115', semester: '1', workspaceId, quizId,
};
const record: PersonalImportRecord = {
  kind: 'timetable', schoolId: 'pu', id: 'linked-database', title: '資料庫管理',
  batchId: 'fixture', academicYear: '115', semester: '1', linkedCourseId: workspaceId,
  importedAt: '2026-09-01T05:00:00Z', source: { type: 'paste', line: 1, rawText: '私人匯入原文' },
};
const snapshot = (...records: PersonalImportRecord[]) => ({
  timetable: null, schoolId: 'pu', updatedAt: record.importedAt, records,
});
const workspace = (fields: Partial<NuniWorkspace> = {}): NuniWorkspace => ({
  id: workspaceId, title: '資料庫管理', state: 'active', memberRole: 'student', ...fields,
});
const reviewed = (fields: Record<string, unknown> = {}) => ({
  workspaceId, status: 'reviewed', membershipActive: true, memberRole: 'student',
  course: { id: 'ccd_' + uuid(1), version: 1, workspaceId, verification: 'administrator-reviewed',
    title: '資料庫管理', schoolId: 'pu', academicYear: '115', semester: '1', courseCode: 'MIS302',
    teacher: '張老師', className: '資管三甲', ...fields },
});
const quiz = (n: number, fields: Partial<NuniQuiz> = {}): NuniQuiz => ({
  id: 'cwq_' + uuid(n), workspaceId, title: '關聯模型練習', prompt: '只在測驗頁顯示的題目內容',
  createdAt: '2026-11-04T05:00:00Z', closedAt: null, dueAt: '2026-11-08T10:00:00Z',
  state: 'open', unitId: null, unitTitle: null, myResponse: null, responseCount: 0, ...fields,
});
const receipt = (fields: Partial<NuniQuizResponse> = {}): NuniQuizResponse => ({
  quizId, platformAccountId: accountId, displayName: '測試學生', answer: '私人的作答內容',
  state: 'submitted', submittedAt: '2026-11-05T05:00:00Z', teacherFeedback: null, reviewedAt: null, ...fields,
});
const ready = {
  kind: 'ready', params: { tab: 'courses', workspaceId, assignmentId: quizId, assistantAccountId: accountId },
};
const workspacePath = `class-workspaces/${workspaceId}`;
const quizzesPath = `${workspacePath}/quizzes`;
const read = jest.mocked(readAssistantTimetable);
const readQuizzes = jest.fn<Promise<unknown>, []>();
const input = {
  source, accountId, schoolId: 'pu', isCurrent: jest.fn<boolean, []>(),
  request: jest.fn<Promise<unknown>, [string, Record<string, unknown>?]>(),
  bffRequest: jest.fn<Promise<unknown>, [string]>(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  input.isCurrent.mockReturnValue(true);
  read.mockResolvedValue(snapshot(record));
  input.request.mockImplementation(async (path, body) => {
    if (path === workspacePath && body === undefined) return workspace();
    if (path === 'course-access/workspace-course') return reviewed();
    if (path === quizzesPath && body === undefined) return readQuizzes();
    throw new Error('Unexpected platform request: ' + path);
  });
  readQuizzes.mockResolvedValue({ quizzes: [quiz(2), quiz(1)] });
  input.bffRequest.mockRejectedValue(new Error('Quiz reads must use the platform transport'));
});

afterEach(() => { expect(input.bffRequest).not.toHaveBeenCalled(); });

test('opens the selected quiz among namesakes through the real quiz parser without carrying private content', async () => {
  const result = await readNuniPlanQuizTarget(input);
  expect(result).toEqual(ready);
  expect(input.request.mock.calls).toEqual([
    [workspacePath], ['course-access/workspace-course', { workspaceId, schoolId: 'pu' }],
    [quizzesPath],
  ]);
  expect(input.bffRequest).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toContain('題目內容');
  expect(JSON.stringify(input.request.mock.calls)).not.toContain('私人匯入原文');
});

test('a renamed, rescheduled and already answered quiz remains reviewable by its exact ID', async () => {
  readQuizzes.mockResolvedValue({ quizzes: [quiz(2), quiz(1, {
    title: '老師重新命名的測驗', dueAt: '2026-11-09T10:00:00Z', state: 'closed',
    closedAt: '2026-11-07T02:00:00Z', responseCount: 1, myResponse: receipt(),
  })] });
  const result = await readNuniPlanQuizTarget(input);
  expect(result).toEqual(ready);
  expect(JSON.stringify(result)).not.toContain('作答內容');
  expect(input.request.mock.calls.filter(([path]) => path === quizzesPath)).toEqual([[quizzesPath]]);
});

test.each([
  { quizId: 'cwa_' + uuid(1) },
  { quizId: undefined, assignmentId: 'cwa_' + uuid(1) },
  { quizId: 'quiz-0' },
])('a quiz locator cannot reuse an assignment ID or display position: %j', async (patch) => {
  expect(await readNuniPlanQuizTarget({ ...input, source: { ...source, ...patch } })).toEqual({ kind: 'changed' });
  expect(read).not.toHaveBeenCalled();
  expect(input.request).not.toHaveBeenCalled();
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('a different account or school cannot reuse an earlier quiz locator', async () => {
  expect(await readNuniPlanQuizTarget({ ...input, accountId: 'pa_' + uuid(2) })).toEqual({ kind: 'session-changed' });
  expect(await readNuniPlanQuizTarget({ ...input, schoolId: 'nthu' })).toEqual({ kind: 'changed' });
  expect(read).not.toHaveBeenCalled();
  expect(input.request).not.toHaveBeenCalled();
});

test.each([{ state: 'archived' as const }, { memberRole: 'co-teacher' as const }])(
  'fresh student membership is required before reading quizzes: %j', async (patch) => {
    input.request.mockResolvedValue(workspace(patch));
    expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'changed' });
    expect(input.request.mock.calls).toEqual([[workspacePath]]);
    expect(readQuizzes).not.toHaveBeenCalled();
    expect(input.bffRequest).not.toHaveBeenCalled();
  },
);

test.each([
  [reviewed({ semester: '2' }), 'changed'],
  [reviewed({ schoolId: 'nthu' }), 'unavailable'],
  [{ ...reviewed(), membershipActive: false }, 'unavailable'],
] as const)('a contradictory directory cannot authorize a quiz lookup: %j', async (detail, kind) => {
  input.request.mockImplementation(async (path) => path === workspacePath ? workspace() : detail);
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind });
  expect(readQuizzes).not.toHaveBeenCalled();
  expect(input.bffRequest).not.toHaveBeenCalled();
});

test('a missing exact quiz is not replaced by a same-name quiz', async () => {
  readQuizzes.mockResolvedValue({ quizzes: [quiz(2)] });
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'changed' });
});

test.each([
  { quizId: 'cwq_' + uuid(2) },
  { platformAccountId: 'pa_' + uuid(2) },
])('a response belonging to another quiz or student invalidates the read: %j', async (patch) => {
  readQuizzes.mockResolvedValue({ quizzes: [quiz(1, { myResponse: receipt(patch) })] });
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'unavailable' });
  expect(read).toHaveBeenCalledTimes(1);
});

test.each([
  [quiz(1), quiz(1)],
  [quiz(1, { workspaceId: 'cw_' + uuid(2) })],
])('duplicate or foreign-workspace quiz rows never produce a target: %j', async (...quizzes) => {
  readQuizzes.mockResolvedValue({ quizzes });
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'unavailable' });
});

test('a capped list distinguishes an unseen quiz from a confirmed exact target and rejects overflow', async () => {
  readQuizzes.mockResolvedValueOnce({ quizzes: Array.from({ length: 99 }, (_, n) => quiz(n + 2)) });
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'changed' });
  readQuizzes.mockResolvedValueOnce({ quizzes: Array.from({ length: 100 }, (_, n) => quiz(n + 2)) });
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'unavailable' });
  readQuizzes.mockResolvedValueOnce({ quizzes: Array.from({ length: 100 }, (_, n) => quiz(n + 1)) });
  expect(await readNuniPlanQuizTarget(input)).toEqual(ready);
  readQuizzes.mockResolvedValueOnce({ quizzes: Array.from({ length: 101 }, (_, n) => quiz(n + 1)) });
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'unavailable' });
});

test('deleting the timetable binding while the quiz read is pending invalidates the result', async () => {
  read.mockResolvedValueOnce(snapshot(record)).mockResolvedValueOnce(snapshot());
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'changed' });
  expect(input.request.mock.calls.filter(([path]) => path === quizzesPath)).toEqual([[quizzesPath]]);
  expect(read).toHaveBeenCalledTimes(2);
});

test('mutating a source object during the initial storage read cannot retarget the selected quiz', async () => {
  const mutable = { ...source };
  read.mockImplementationOnce(async () => {
    mutable.quizId = 'cwq_' + uuid(2);
    mutable.workspaceId = 'cw_' + uuid(2);
    return snapshot(record);
  });
  expect(await readNuniPlanQuizTarget({ ...input, source: mutable })).toEqual(ready);
  expect(input.request.mock.calls.filter(([path]) => path === quizzesPath)).toEqual([[quizzesPath]]);
});

test.each(['cancelled', 'session-changed'] as const)('a late quiz response is discarded after %s', async (kind) => {
  const started = deferred<void>();
  const response = deferred<unknown>();
  const controller = new AbortController();
  readQuizzes.mockImplementationOnce(() => { started.resolve(); return response.promise; });
  const pending = readNuniPlanQuizTarget({ ...input, signal: controller.signal });
  await started.promise;
  if (kind === 'cancelled') controller.abort();
  else input.isCurrent.mockReturnValue(false);
  response.resolve({ quizzes: [quiz(1)] });
  expect(await pending).toEqual({ kind });
  expect(read).toHaveBeenCalledTimes(1);
});

test('an expired quiz session is distinguished from a retryable network failure', async () => {
  readQuizzes.mockRejectedValueOnce(new NuniError(401, 'UNAUTHENTICATED'));
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'session-changed' });
  readQuizzes.mockRejectedValueOnce(new NuniError(0, 'NETWORK_ERROR'));
  expect(await readNuniPlanQuizTarget(input)).toEqual({ kind: 'unavailable' });
  expect(await readNuniPlanQuizTarget(input)).toEqual(ready);
  expect(input.request.mock.calls.filter(([path]) => path === workspacePath)).toHaveLength(3);
  expect(input.request.mock.calls.filter(([path]) => path === quizzesPath)).toEqual([[quizzesPath], [quizzesPath], [quizzesPath]]);
});
