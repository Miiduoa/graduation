import type { PostLoginContext } from '../../data/postLoginTypes';
import { getDataSource, hasDataSource } from '../../data/source';
import { executeTool } from '../../services/aiAgentTools';
import { executeToolStandard } from '../../services/aiToolRegistry';
import { getInMemoryPostLoginContext } from '../../services/postLoginContextHolder';
import { bindVerifiedSchoolAiScope } from '../../services/verifiedSchoolAiScope';

jest.mock('../../services/postLoginContextHolder', () => ({ getInMemoryPostLoginContext: jest.fn() }));
jest.mock('../../data/source', () => ({ hasDataSource: jest.fn(), getDataSource: jest.fn() }));
jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(), getFunctionsInstance: jest.fn(), getCloudFunctionRegion: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../data/puAIAgentData', () => ({ distillLearnedSkillFromToolSuccess: jest.fn() }));
jest.mock('../../data/puDiningCatalog', () => ({}));
jest.mock('../../services/recommendLunch', () => ({}));
jest.mock('../../services/aiSemanticReasoner', () => ({}));
jest.mock('../../services/aiActiveLearning', () => ({}));
jest.mock('../../services/demoOrdering', () => ({}));
jest.mock('../../data/demoCoursesMock', () => ({}));
jest.mock('../../data/demoUserStories', () => ({}));
jest.mock('../../services/roleEventTargets', () => ({}));
jest.mock('../../services/demoStore', () => ({}));
jest.mock('../../services/roleEventBus', () => ({}));
jest.mock('../../services/demoLeaveReview', () => ({}));
jest.mock('../../services/demoMessageAgent', () => ({}));
jest.mock('../../services/supabaseLmsCache', () => ({
  getAnyCachedCourses: jest.fn(), getAnyCachedGrades: jest.fn(),
  getAnyCachedAnnouncements: jest.fn(), getAnyCachedStudentInfo: jest.fn(),
  getAnyCachedTCCourses: jest.fn(), getAnyCachedTCActivities: jest.fn(),
  getAnyCachedTCAttendance: jest.fn(), getAnyCachedTCTodos: jest.fn(),
  getAnyCachedTCExams: jest.fn(), getAnyCachedTCScoreItems: jest.fn(),
  getAnyCachedTCHomeworkActivities: jest.fn(), getAnyCachedTCDiscussions: jest.fn(),
  getAnyCachedTCMaterials: jest.fn(), getAnyCachedTCCourseMembers: jest.fn(),
  getAnyCachedTCCourseAnnouncements: jest.fn(),
}));

const cache = jest.requireMock('../../services/supabaseLmsCache') as Record<string, jest.Mock>;
const dataSource = {
  listCourses: jest.fn(), listGrades: jest.fn(), getGPA: jest.fn(), listInboxTasks: jest.fn(),
  listAnnouncements: jest.fn(), listEvents: jest.fn(), listNotifications: jest.fn(),
  listCalendarEvents: jest.fn(), createLeaveRequest: jest.fn(), createCalendarEvent: jest.fn(),
};
const identity = { userId: 'owner-a', schoolId: 'pu' };
const schoolTools = [
  'query_courses', 'query_grades', 'query_assignments', 'query_attendance',
  'query_student_info', 'analyze_credits', 'predict_gpa', 'comprehensive_analysis',
  'query_exams', 'query_score_items', 'query_discussions', 'query_materials',
  'query_course_members', 'query_homework_detail', 'query_course_announcements',
];
let currentSession: object;

function bindLogin(userId = identity.userId) {
  const context: PostLoginContext = {
    uid: userId, schoolId: 'pu', origin: 'verified-school-login',
    roles: {
      primaryRole: 'student', subRoles: [], source: 'firestore',
      flags: { isStudent: true, isTeacher: false, isDeptAdmin: false, isAdmin: false },
    },
    latestAnnouncements: [], partialErrors: [], builtAt: '2026-11-06T00:00:00.000Z',
  };
  currentSession = {};
  const session = currentSession;
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
  bindVerifiedSchoolAiScope(context, () => {
    if (currentSession !== session) throw new Error('school session changed');
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  for (const reader of Object.values(cache)) reader.mockResolvedValue(null);
  for (const method of Object.values(dataSource)) method.mockResolvedValue([]);
  dataSource.getGPA.mockResolvedValue(null);
  jest.mocked(hasDataSource).mockReturnValue(false);
  jest.mocked(getDataSource).mockReturnValue(dataSource as unknown as ReturnType<typeof getDataSource>);
  bindLogin();
});
afterEach(() => jest.restoreAllMocks());

test.each(schoolTools)('%s never reads raw school caches for an unverified owner or campus', async (tool) => {
  for (const context of [
    { ...identity, schoolId: 'nthu' }, { ...identity, userId: 'owner-b' }, { schoolId: 'pu' },
  ]) {
    const result = await executeTool(tool, { courseId: '7', schoolId: 'pu', userId: 'owner-a' }, context);
    expect(result).toMatchObject({ success: false, error: 'school_scope_unverified' });
    expect(result.data).toBeUndefined();
  }
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
  expect(await executeTool(tool, { courseId: '7' }, identity)).toMatchObject({
    success: false, error: 'school_scope_unverified',
  });
  for (const reader of Object.values(cache)) expect(reader).not.toHaveBeenCalled();
});

test.each(schoolTools)('%s remains available to the matching verified school login', async (tool) => {
  expect(await executeTool(tool, { courseId: '7' }, identity)).toMatchObject({ success: true });
  expect(Object.values(cache).some(reader => reader.mock.calls.length > 0)).toBe(true);
});

test('returns the verified owner course data', async () => {
  cache.getAnyCachedTCCourses.mockResolvedValue([{ id: 7, name: '本人的正式課程' }]);
  const result = await executeTool('query_courses', {}, identity);
  expect(result.success).toBe(true);
  expect(result.summary).toContain('本人的正式課程');
});

test('keeps non-PU scoped DataSource courses, grades and assignments available', async () => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  dataSource.listCourses.mockResolvedValue([{ id: 'nthu-course', name: '清大課程' }]);
  dataSource.listGrades.mockResolvedValue([{ id: 'nthu-grade', courseName: '清大課程', score: 85 }]);
  dataSource.listInboxTasks.mockResolvedValue([
    { id: 'nthu-task', title: '清大作業', kind: 'assignment', preferredIntent: 'submit', groupName: '清大課程' },
  ]);
  const context = { userId: 'platform-student', schoolId: 'nthu' };
  for (const tool of ['query_courses', 'query_grades', 'query_assignments']) {
    expect(await executeToolStandard(tool, {}, context)).toMatchObject({ success: true });
  }
  expect(dataSource.listCourses).toHaveBeenCalledWith('nthu');
  expect(dataSource.listGrades).toHaveBeenCalledWith('platform-student', undefined, 'nthu');
  expect(dataSource.listInboxTasks).toHaveBeenCalledWith('platform-student', 'nthu');
  for (const reader of Object.values(cache)) expect(reader).not.toHaveBeenCalled();
});

test('allows a guest to query the selected campus through its scoped DataSource', async () => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  dataSource.listCourses.mockResolvedValue([{ id: 'guest-course', name: '訪客個人課程' }]);
  const result = await executeToolStandard('query_courses', {}, { schoolId: 'nthu' });
  expect(result.success).toBe(true);
  expect(result.summary).toContain('訪客個人課程');
  expect(dataSource.listCourses).toHaveBeenCalledWith('nthu');
  for (const reader of Object.values(cache)) expect(reader).not.toHaveBeenCalled();
});

test('keeps an empty day valid when the scoped course source has other courses', async () => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  dataSource.listCourses.mockResolvedValue([
    { id: 'other-day', name: '其他天的課', dayOfWeek: (new Date().getDay() + 1) % 7 },
  ]);
  const result = await executeTool('query_courses', { filter: 'today' }, { schoolId: 'nthu' });
  expect(result).toMatchObject({ success: true, data: [], summary: '今天沒有課程' });
});

test('keeps completed scoped tasks valid when no pending task remains', async () => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  dataSource.listInboxTasks.mockResolvedValue([
    { id: 'done-task', title: '已完成作業', kind: 'assignment', preferredIntent: 'read' },
  ]);
  const result = await executeTool('query_assignments', { status: 'pending' }, { userId: 'student', schoolId: 'nthu' });
  expect(result).toMatchObject({ success: true, data: [], summary: '目前沒有待處理的作業或任務。' });
});

test('reports missing school verification as a recoverable registry precondition', async () => {
  const result = await executeToolStandard('query_grades', {}, { userId: 'owner-b', schoolId: 'nthu' });
  expect(result).toMatchObject({ success: false, error: 'school_scope_unverified', errorCode: 'precondition_failed' });
  expect(result.summary).toContain('請確認校園與登入帳號');
  expect(result.data).toBeUndefined();
});

test.each(['session', 'logout', 'another-account', 'new-login'])('discards late courses after %s and stops further raw reads', async (change) => {
  let finish!: (value: unknown) => void;
  cache.getAnyCachedTCCourses.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = executeTool('query_courses', {}, identity);
  if (change === 'session') currentSession = {};
  if (change === 'logout') jest.mocked(getInMemoryPostLoginContext).mockReturnValue(null);
  if (change === 'another-account') bindLogin('owner-b');
  if (change === 'new-login') bindLogin();
  finish([{ id: 7, name: '舊帳號的私人課程' }]);
  const result = await pending;
  expect(result).toMatchObject({ success: false, error: 'school_scope_unverified' });
  expect(JSON.stringify(result)).not.toContain('舊帳號的私人課程');
  expect(cache.getAnyCachedCourses).not.toHaveBeenCalled();
  expect(dataSource.listCourses).not.toHaveBeenCalled();
});

test('discards an old owner exception before returning or logging its contents', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  let reject!: (reason: Error) => void;
  cache.getAnyCachedGrades.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = executeTool('query_grades', {}, identity);
  bindLogin('owner-b');
  reject(new Error('舊帳號的私人學號及成績'));
  const result = await pending;
  expect(result).toMatchObject({ success: false, error: 'school_scope_unverified' });
  expect(JSON.stringify(result)).not.toContain('舊帳號的私人學號及成績');
  expect(warning).not.toHaveBeenCalled();
});

test('keeps other-campus announcements and events available without the PU cache', async () => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  dataSource.listAnnouncements.mockResolvedValue([{ id: 'notice', title: '清大公告' }]);
  dataSource.listEvents.mockResolvedValue([{ id: 'event', title: '清大活動' }]);
  const context = { schoolId: 'nthu' };
  expect((await executeTool('query_announcements', {}, context)).summary).toContain('清大公告');
  expect((await executeTool('query_events', {}, context)).summary).toContain('清大活動');
  expect(dataSource.listAnnouncements).toHaveBeenCalledWith('nthu');
  expect(dataSource.listEvents).toHaveBeenCalledWith('nthu');
  for (const reader of Object.values(cache)) expect(reader).not.toHaveBeenCalled();
});

test('daily briefing uses the protected entrypoints when a campus has no verified school login', async () => {
  const result = await executeTool('daily_briefing', {}, { userId: 'platform-student', schoolId: 'nthu' });
  expect(result.summary).toContain('學校資料尚未驗證');
  for (const reader of Object.values(cache)) expect(reader).not.toHaveBeenCalled();
});

test('discards a complete briefing after the account changes during its last pending source', async () => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  let finish!: (value: unknown) => void;
  dataSource.listCalendarEvents.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = executeTool('daily_briefing', {}, identity);
  bindLogin('owner-b');
  finish([{ id: 'private-event', title: '舊帳號的私人行程' }]);
  const result = await pending;
  expect(result).toMatchObject({ success: false, error: 'school_scope_unverified' });
  expect(JSON.stringify(result)).not.toContain('舊帳號的私人行程');
});

test.each(['resolve', 'reject'])('does not submit a leave request after its old course lookup %s', async (outcome) => {
  jest.mocked(hasDataSource).mockReturnValue(true);
  let finish!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  cache.getAnyCachedCourses.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
  const pending = executeTool('request_leave', { date: '2026-11-06' }, identity);
  bindLogin('owner-b');
  if (outcome === 'resolve') finish([{ id: 7, name: '舊帳號的私人課程', dayOfWeek: 5 }]);
  else reject(new Error('舊帳號的私人錯誤'));
  expect(await pending).toMatchObject({ success: false, error: 'school_scope_unverified' });
  expect(dataSource.listCourses).not.toHaveBeenCalled();
  expect(dataSource.createLeaveRequest).not.toHaveBeenCalled();
  expect(dataSource.createCalendarEvent).not.toHaveBeenCalled();
});

test('a missing school session cannot turn an unavailable leave timetable into a free day', async () => {
  expect(await executeTool('request_leave', { date: '2026-11-06' }, { userId: 'platform-student', schoolId: 'nthu' }))
    .toMatchObject({ success: false, error: 'school_scope_unverified' });
  expect(cache.getAnyCachedCourses).not.toHaveBeenCalled();
});
