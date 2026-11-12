import { classMeetingKey, type PersonalImportRecord } from '@campus/shared';
import type { NuniAssignment, NuniQuiz } from '@campus/shared/src/nuni';
import { askCampusAssistant } from '../../features/campusAssistant';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import { nuniAssistantDataIntent } from '../../services/nuniAssistantDataRead';

const mockCallable = jest.fn();
let mockUid: string | null = null;
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: jest.fn(() => ({ currentUser: mockUid ? { uid: mockUid } : null })),
  getFunctionsInstance: jest.fn(() => ({})), isFirebaseMockMode: () => false,
}));
jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));
jest.mock('../../services/localLLMInference', () => ({
  localLLM: { getRuntimeAvailability: jest.fn(), generate: jest.fn() },
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const accountId = 'pa_' + uuid(1);
const workspaceId = 'cw_' + uuid(1);
const checkedAt = '2026-11-12T03:00:00Z';
const record: PersonalImportRecord = {
  id: 'db', kind: 'timetable', schoolId: 'pu', title: '資料庫管理',
  academicYear: '115', semester: '1', dayOfWeek: 4, startTime: '13:10', endTime: '15:00',
  location: '任垣305', courseCode: 'MIS302', teacher: '張老師', className: '資管三甲',
  linkedCourseId: workspaceId, importedAt: checkedAt, batchId: 'fixture',
  source: { type: 'paste', line: 1, rawText: '不應出現在回答中的匯入原文' },
};
const source = (records = [record]) => ({ timetable: null, schoolId: 'pu', records, updatedAt: checkedAt });
const assignment = (n: number, fields: Partial<NuniAssignment> = {}): NuniAssignment => ({
  id: 'cwa_' + uuid(n), workspaceId, title: `資料模型作業 ${n}`, dueAt: '2026-11-13T23:59:00+08:00',
  createdAt: '2026-11-01T03:00:00Z', state: 'open', closedAt: null, mySubmission: null,
  instructions: '不應送給模型的作業全文', submissionCount: 0, unitId: null, unitTitle: null, ...fields,
});
const quiz = (n: number, fields: Partial<NuniQuiz> = {}): NuniQuiz => ({
  id: 'cwq_' + uuid(n), workspaceId, title: `資料庫測驗 ${n}`, dueAt: '2026-11-13T23:59:00+08:00',
  createdAt: '2026-11-01T03:00:00Z', state: 'open', closedAt: null, myResponse: null,
  prompt: '測驗題目不得放入清單', responseCount: 0, unitId: null, unitTitle: null, ...fields,
});
let quizzes: NuniQuiz[] = [];
const request = jest.fn();
const bffRequest = jest.fn();
const read = jest.mocked(readAssistantTimetable);
let current = true;
let platformCurrent = true;
const input = (content: string) => ({
  scope: { uid: '', schoolId: 'pu' },
  platformTimetable: { accountId, isCurrent: () => platformCurrent },
  courseworkRequests: { request, bffRequest },
  messages: [{ role: 'user' as const, content }], isCurrent: () => current, mode: 'device' as const,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: Date.parse(checkedAt) });
  mockUid = null;
  quizzes = [];
  current = true; platformCurrent = true;
  read.mockResolvedValue(source());
  request.mockImplementation(async (path) => {
    if (path === 'class-workspaces') return { workspaces: [{ id: workspaceId, title: '資料庫管理', state: 'active', memberRole: 'student' }] };
    if (path.endsWith('/quizzes')) return { quizzes };
    return { workspaceId, status: 'reviewed', membershipActive: true, memberRole: 'student', course: {
      id: 'ccd_' + uuid(1), version: 1, workspaceId, verification: 'administrator-reviewed',
      schoolId: 'pu', academicYear: '115', semester: '1', title: record.title,
      courseCode: record.courseCode, teacher: record.teacher, className: record.className,
    } };
  });
  bffRequest.mockResolvedValue({ assignments: [assignment(1)] });
});
afterEach(() => { jest.useRealTimers(); });

test.each(['今天有哪些課？', '幫我查今天的課表', '我今天要上什麼課？'])(
  '%s answers saved course names, clock times and rooms without opening a page', async (question) => {
    const result = await askCampusAssistant(input(question));
    expect(result.content).toContain('資料庫管理');
    expect(result.content).toContain('13:10–15:00');
    expect(result.content).toContain('任垣305');
    expect(result.serviceSelection).toBeUndefined();
    expect(result.route).toBeUndefined();
    expect(result.tool).toBe('platform-data');
    expect(read).toHaveBeenCalledWith('', 'pu', expect.objectContaining({ accountId }));
    expect(request).not.toHaveBeenCalled();
    expect(bffRequest).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
    expect(jest.requireMock('../../services/localLLMInference').localLLM.generate).not.toHaveBeenCalled();
  },
);

test('direct date summaries preserve saved cancellations and single-day room changes', async () => {
  const second = { ...record, id: 'networks', title: '網路管理', startTime: '15:10', endTime: '17:00' };
  read.mockResolvedValue(source([
    { ...record, classExceptions: [{ id: 'cancel-db', courseKey: classMeetingKey(record), original: record,
      originalDate: '2026-11-12', kind: 'cancel', createdAt: checkedAt }] },
    { ...second, classExceptions: [{ id: 'room-networks', courseKey: classMeetingKey(second), original: second,
      originalDate: '2026-11-12', kind: 'room', location: '新教室402', createdAt: checkedAt }] },
  ]));
  const result = await askCampusAssistant(input('今天有哪些課？'));
  expect(result.content).not.toContain('資料庫管理');
  expect(result.content).toContain('網路管理');
  expect(result.content).toContain('新教室402');
});

test('pending assignments use real scoped transports and receipts, including work beyond seven days', async () => {
  const submitted = assignment(2, { title: '已繳交項目' });
  submitted.mySubmission = { assignmentId: submitted.id, platformAccountId: accountId, displayName: '學生',
    body: '繳交內容不得輸出', state: 'submitted', submittedAt: checkedAt, teacherFeedback: null, reviewedAt: null };
  bffRequest.mockResolvedValue({ assignments: [submitted,
    assignment(3, { title: '已關閉項目', state: 'closed', closedAt: checkedAt }),
    assignment(4, { title: '期末專題', dueAt: '2026-12-20T23:59:00+08:00' }), assignment(1)] });
  const result = await askCampusAssistant(input('我還有哪些作業待交？'));
  expect(result.content).toContain('待交作業有 2 筆');
  expect(result.content).toContain('資料模型作業 1');
  expect(result.content).toContain('11/13');
  expect(result.content).toContain('期末專題');
  expect(result.content).toContain('另有 1 筆符合條件的作業未交且已關閉');
  expect(result.content).not.toMatch(/已繳交項目|已關閉項目|繳交內容|作業全文|匯入原文/);
  expect(result.serviceSelection).toBeUndefined();
  expect(bffRequest).toHaveBeenCalledWith(`class-workspaces/${workspaceId}/assignments`);
  expect(request).toHaveBeenCalledWith('course-access/workspace-course', { workspaceId, schoolId: 'pu' });
  expect(read).not.toHaveBeenCalled();
  expect(mockCallable).not.toHaveBeenCalled();
});

test('a deadline lookup filters the authorized data by the requested Taiwan date', async () => {
  bffRequest.mockResolvedValue({ assignments: [
    assignment(1, { title: '明天截止' }),
    assignment(2, { title: '今天截止', dueAt: '2026-11-12T23:59:00+08:00' }),
    assignment(3, { title: '未填期限', dueAt: null }),
  ] });
  const result = await askCampusAssistant(input('明天有哪些作業要交？'));
  expect(result.content).toContain('待交作業有 1 筆');
  expect(result.content).toContain('明天截止');
  expect(result.content).not.toContain('今天截止');
  expect(result.content).toContain('另有 1 筆未提供截止時間');
});

test('denied student membership does not read assignment data or claim there are zero tasks', async () => {
  request.mockResolvedValue({ workspaces: [{ id: workspaceId, title: '資料庫管理', state: 'active', memberRole: 'owner-teacher' }] });
  const result = await askCampusAssistant(input('我有哪些待交作業？'));
  expect(bffRequest).not.toHaveBeenCalled();
  expect(result.content).toMatch(/無法|不能|尚未|沒有可讀取/);
  expect(result.content).not.toContain('待交作業有 0 筆');
});

test('an assignment source failure remains unavailable even when quizzes return successfully', async () => {
  bffRequest.mockRejectedValue(new Error('offline'));
  const result = await askCampusAssistant(input('我有哪些待交作業？'));
  expect(result.content).toMatch(/無法|不能|尚未/);
  expect(result.content).not.toContain('待交作業有 0 筆');
});

test.each(['scope', 'platform'] as const)('late personal reads after a %s change are discarded', async (kind) => {
  let finish!: (value: ReturnType<typeof source>) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = askCampusAssistant(input('今天有哪些課？'));
  await Promise.resolve();
  if (kind === 'scope') current = false;
  else platformCurrent = false;
  finish(source());
  await expect(pending).rejects.toMatchObject({ code: 'session-changed' });
});

test('cancelling a direct lookup settles without waiting for its storage read', async () => {
  const controller = new AbortController();
  let finish!: (value: ReturnType<typeof source>) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = askCampusAssistant({ ...input('今天有哪些課？'), signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  finish(source());
});

test.each(['幫我修改課表', '幫我交作業', '把我的課表分享給同學', '關閉課表提醒', '請幫我安排明天讀書', '解釋作業系統是什麼'])(
  '%s is not swallowed by the read-only lookup', (question) => {
    expect(nuniAssistantDataIntent(question)).toBeNull();
  },
);

test('unsupported calendar ranges stay with the existing workflow without reading another date', async () => {
  expect(nuniAssistantDataIntent('下下週的課表有哪些？')).toBeNull();
  const result = await askCampusAssistant(input('下下週的課表有哪些？'));
  expect(result.tool).not.toBe('platform-data');
  expect(read).not.toHaveBeenCalled();
});

test.each([null, { ...source(), schoolId: 'nthu' }])('missing or wrong-school saved data does not become a free day', async (saved) => {
  read.mockResolvedValue(saved);
  const result = await askCampusAssistant(input('今天有哪些課？'));
  expect(result.content).toContain('沒有可核對');
  expect(result.content).not.toContain('沒有排課');
  expect(result.content).not.toContain('資料庫管理');
});

test('platform data and its preceding request are not forwarded to a later cloud model', async () => {
  mockUid = 'campus-a';
  mockCallable.mockResolvedValue({ data: { content: '一般回答', run: { status: 'completed' }, actions: [] } });
  await askCampusAssistant({
    scope: { uid: mockUid, schoolId: 'pu' }, isCurrent: () => true, mode: 'campus',
    messages: [
      { role: 'user', content: '我有哪些待交作業？' },
      { role: 'assistant', tool: 'platform-data', content: '私人資料庫作業：11/13 截止' },
      { role: 'user', content: '請解釋二分搜尋' },
    ],
  });
  expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({
    messages: [{ role: 'user', content: '請解釋二分搜尋' }],
  }));
});

test('students can read joined-course assignments before importing or linking a timetable', async () => {
  read.mockResolvedValue(null);
  const result = await askCampusAssistant(input('我有哪些待交作業？'));
  expect(result.content).toContain('資料模型作業 1');
  expect(read).not.toHaveBeenCalled();
});

test.each(['測驗何時截止？', '我有哪些待答測驗？'])(
  '%s reads quiz tasks and never substitutes assignment results', async (question) => {
    quizzes = [quiz(1)];
    const result = await askCampusAssistant(input(question));
    expect(result.tool).toBe('platform-data');
    expect(result.content).toContain('待作答測驗有 1 筆');
    expect(result.content).toContain('資料庫測驗 1');
    expect(result.content).toContain('參考期限');
    expect(result.content).not.toContain('資料模型作業 1');
    expect(result.content).not.toContain('待交作業');
    expect(request).toHaveBeenCalledWith(`class-workspaces/${workspaceId}/quizzes`, undefined);
  },
);

test('a dated quiz lookup filters quiz deadlines without including answered or out-of-range quizzes', async () => {
  const answered = quiz(3);
  answered.myResponse = { quizId: answered.id, platformAccountId: accountId, displayName: '學生',
    answer: '不應出現在清單的作答', state: 'submitted', submittedAt: checkedAt, teacherFeedback: null, reviewedAt: null };
  quizzes = [quiz(1), quiz(2, { dueAt: '2026-11-12T23:59:00+08:00' }), answered];
  const result = await askCampusAssistant(input('明天有哪些測驗？'));
  expect(result.content).toContain('待作答測驗有 1 筆');
  expect(result.content).toContain('資料庫測驗 1');
  expect(result.content).not.toContain('資料庫測驗 2');
  expect(result.content).not.toContain('資料庫測驗 3');
});

test.each([
  '資料庫今天課表', '上午有哪些課？', '今天下午有哪些課？', '今天10點以後的課表',
  '今天和明天有哪些課？', '週五和週六有哪些課？', '星期幾有課？',
  '資料庫的測驗何時截止？', '今天和明天有哪些測驗？', '作業和測驗何時截止？',
])('%s preserves unsupported subject/date/time conditions for the existing flow', async (question) => {
  expect(nuniAssistantDataIntent(question)).toBeNull();
  const result = await askCampusAssistant(input(question));
  expect(result.tool).not.toBe('platform-data');
  expect(read).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test.each(['星期五有哪些課？', '本週五的課表'])('%s uses the requested weekday, not the entire week', async (question) => {
  read.mockResolvedValue(source([record, { ...record, id: 'friday', dayOfWeek: 5, title: '資訊管理', startTime: '09:10', endTime: '11:00' }]));
  const result = await askCampusAssistant(input(question));
  expect(result.content).toContain('資訊管理');
  expect(result.content).toContain('2026-11-13');
  expect(result.content).not.toContain('資料庫管理');
  expect(result.content).not.toContain('2026-11-12');
});
