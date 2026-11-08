import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDataSource, getDataSourceEvidence, hasDataSource } from '../../data/source';
import { getHybridSourceStatus } from '../../data/hybridSource';
import type { CourseGradebookData, CourseSpace, InboxTask } from '../../data/types';
import { getAuthInstance, hasUsableFirebaseConfig, isFirebaseMockMode } from '../../firebase';
import { executeToolStandard, type ToolExecutionContext } from '../../services/aiToolRegistry';
import { isDevelopmentDemoSession } from '../../services/release';
import { getVerifiedSchoolAiScope, isVerifiedSchoolAiScopeCurrent } from '../../services/verifiedSchoolAiScope';
import { buildFullAIContext } from '../../services/aiContextBuilder';
import { buildWideAISnapshot } from '../../services/aiDataInventory';
import { getDemoCoursesForUid, getDemoScoreItemsByCourse } from '../../data/demoCoursesMock';

jest.mock('../../data/source', () => ({
  getDataSource: jest.fn(), getDataSourceEvidence: jest.fn(), hasDataSource: jest.fn(),
}));
jest.mock('../../data/hybridSource', () => ({ getHybridSourceStatus: jest.fn() }));
jest.mock('../../firebase', () => ({
  getAuthInstance: jest.fn(), hasUsableFirebaseConfig: jest.fn(), isFirebaseMockMode: jest.fn(),
  getFirebaseApp: jest.fn(), getFunctionsInstance: jest.fn(), getCloudFunctionRegion: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../services/aiAgentTools', () => ({ executeTool: jest.fn() }));
jest.mock('../../services/release', () => ({ isDevelopmentDemoSession: jest.fn() }));
jest.mock('../../services/verifiedSchoolAiScope', () => ({
  getVerifiedSchoolAiScope: jest.fn(), isVerifiedSchoolAiScopeCurrent: jest.fn(),
}));
jest.mock('../../services/demoOrdering', () => ({}));
jest.mock('../../services/demoLeaveReview', () => ({}));
jest.mock('../../services/demoMessageAgent', () => ({}));
jest.mock('../../services/aiContextBuilder', () => ({ buildFullAIContext: jest.fn() }));
jest.mock('../../services/aiDataInventory', () => ({
  buildWideAISnapshot: jest.fn(),
  AI_DATA_INVENTORY: [
    { key: 'courses', label: '課程' }, { key: 'notifications', label: '通知' },
    { key: 'notes', label: '筆記' }, { key: 'creditAudit', label: '畢業學分' },
  ],
}));
jest.mock('../../data/demoCoursesMock', () => ({
  getDemoCoursesForUid: jest.fn((uid: string) => uid === 'demo_guest' ? [] : [
    { id: 71378, name: '固定示範課程', instructor: '示範教師' },
  ]),
  getDemoScoreItemsByCourse: jest.fn(() => [
    { id: 'demo-score', name: '示範成績', weight: 100, totalScore: 100, studentScore: 85 },
  ]),
  getDemoHomeworksByCourse: jest.fn(() => []),
  getDemoExamsByCourse: jest.fn(() => []),
}));

const context: ToolExecutionContext = { userId: 'student-a', schoolId: 'nthu', role: 'student' };
const tools = ['grade_predict_what_if', 'study_plan_today', 'urgent_notifications', 'ai_full_context', 'ai_data_inventory'];
const source = { listCourseSpaces: jest.fn(), listInboxTasks: jest.fn(), getCourseGradebook: jest.fn() };
const auth = { currentUser: { uid: 'student-a' } as { uid: string } | null };
const course: CourseSpace = {
  id: 'course-1', groupId: 'course-1', schoolId: 'nthu', name: '清大本人的課程',
  unreadCount: 0, assignmentCount: 1, dueSoonCount: 1, quizCount: 0, moduleCount: 0,
  activeSessionId: null, latestDueAt: null,
};
const ownTask: InboxTask = {
  id: 'task-1', groupId: 'course-1', groupName: course.name, kind: 'assignment',
  title: '清大真實作業', subtitle: '課程來源的待辦內容', preferredIntent: 'submit', priority: 0,
};
let gradebook: CourseGradebookData;

function selectSchool(schoolId: string | null) {
  jest.mocked(getHybridSourceStatus).mockReturnValue({
    preferRealApi: true, fallbackToMock: false, registeredSchools: [], schoolContextId: schoolId,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.currentUser = { uid: 'student-a' };
  jest.mocked(hasDataSource).mockReturnValue(true);
  jest.mocked(getDataSource).mockReturnValue(source as unknown as ReturnType<typeof getDataSource>);
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'firebase', sourceLabel: 'real' });
  selectSchool('nthu');
  jest.mocked(getAuthInstance).mockReturnValue(auth as unknown as ReturnType<typeof getAuthInstance>);
  jest.mocked(hasUsableFirebaseConfig).mockReturnValue(true);
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(isDevelopmentDemoSession).mockReturnValue(false);
  jest.mocked(getVerifiedSchoolAiScope).mockReturnValue(null);
  jest.mocked(isVerifiedSchoolAiScopeCurrent).mockReturnValue(true);
  source.listCourseSpaces.mockResolvedValue([course]);
  source.listInboxTasks.mockResolvedValue([{
    ...ownTask, dueAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
  }]);
  gradebook = {
    groupName: course.name, finalScoresPublished: false, finalScoresPublishedAt: null,
    assignments: [
      { id: 'midterm', title: '期中', weight: 40, dueAt: null, gradesPublished: true, averageScore: null },
      { id: 'final', title: '期末', weight: 60, dueAt: null, gradesPublished: false, averageScore: null },
    ],
    rows: [
      {
        uid: 'another-student', displayName: '另一位同學', finalScore: 99, passingScore: 60,
        result: 'pass', published: true, publishedAt: new Date(), gradedAssignments: 2, totalAssignments: 2,
        assignmentBreakdown: [
          { assignmentId: 'midterm', title: '期中', weight: 40, grade: 99, dueAt: null, isLate: false, submittedAt: null },
        ],
      },
      {
        uid: 'student-a', displayName: '本人', finalScore: null, passingScore: 60,
        result: 'pending', published: false, publishedAt: null, gradedAssignments: 1, totalAssignments: 2,
        assignmentBreakdown: [
          { assignmentId: 'midterm', title: '期中', weight: 40, grade: 70, dueAt: null, isLate: false, submittedAt: null },
          { assignmentId: 'final', title: '期末', weight: 60, grade: 99, dueAt: null, isLate: false, submittedAt: null },
        ],
      },
    ],
  };
  source.getCourseGradebook.mockImplementation(async () => gradebook);
});

test.each(tools)('%s uses the current non-PU member source without demo data', async (tool) => {
  const result = await executeToolStandard(tool, { courseId: course.id }, context);
  if (!result.success) throw new Error(result.summary);
  expect(result.success).toBe(true);
  expect(source.listCourseSpaces).toHaveBeenCalledWith('student-a', 'nthu');
  if (tool !== 'grade_predict_what_if') expect(source.listInboxTasks).toHaveBeenCalledWith('student-a', 'nthu');
  expect(JSON.stringify(result)).not.toContain('固定示範課程');
  expect(getDemoCoursesForUid).not.toHaveBeenCalled();
  expect(getDemoScoreItemsByCourse).not.toHaveBeenCalled();
  expect(buildFullAIContext).not.toHaveBeenCalled();
  expect(buildWideAISnapshot).not.toHaveBeenCalled();
  expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
});

test.each(tools)('%s reports an unavailable source instead of treating a guest as demo', async (tool) => {
  const result = await executeToolStandard(tool, { courseId: '71378' }, { schoolId: 'nthu' });
  expect(result).toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
  expect(getDemoCoursesForUid).not.toHaveBeenCalled();
});

test.each(tools)('%s cannot present mock DataSource rows as a real account', async (tool) => {
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'mock', sourceLabel: 'mock' });
  const result = await executeToolStandard(tool, { courseId: course.id }, context);
  expect(result).toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
});

test.each(['ncnu', null])('a stale tool school cannot start a query when the selected school is %s', async (schoolId) => {
  selectSchool(schoolId);
  for (const tool of tools) {
    expect(await executeToolStandard(tool, { courseId: course.id }, context))
      .toMatchObject({ success: false, errorCode: 'precondition_failed' });
  }
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
  expect(source.listInboxTasks).not.toHaveBeenCalled();
});

test('grade simulation selects only the owner row and published component scores', async () => {
  const result = await executeToolStandard('grade_predict_what_if', { courseId: course.id }, context);
  expect(source.getCourseGradebook).toHaveBeenCalledWith(course.groupId);
  expect(result.data).toMatchObject({ earnedSoFar: 28, weightUsed: 40, likelyCase: 70, worstCase: 28, bestCase: 88, letterGrade: null });
  expect(JSON.stringify(result)).not.toMatch(/另一位同學|another-student|99/);

  const changed = await executeToolStandard('grade_predict_what_if', {
    courseId: course.id, overrides: JSON.stringify([{ itemId: 'final', assumedScore: 80 }]),
  }, context);
  expect(changed.data).toMatchObject({ likelyCase: 76 });
});

test('a course from another school or outside membership cannot open its gradebook', async () => {
  source.listCourseSpaces.mockResolvedValue([{ ...course, schoolId: 'pu' }]);
  expect(await executeToolStandard('grade_predict_what_if', { courseId: course.id }, context))
    .toMatchObject({ success: false, errorCode: 'not_found' });
  expect(source.getCourseGradebook).not.toHaveBeenCalled();
});

test.each([NaN, -1, undefined])('missing or invalid source weights %s cannot produce a prediction', async (weight) => {
  gradebook.assignments[0].weight = weight as number;
  expect(await executeToolStandard('grade_predict_what_if', { courseId: course.id }, context))
    .toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(getDemoScoreItemsByCourse).not.toHaveBeenCalled();
});

test.each([
  'invalid-json', '[{"itemId":"demo-score","assumedScore":80}]', '[{"itemId":"final","assumedScore":101}]',
])('invalid assumptions %s ask for a valid course component', async (overrides) => {
  expect(await executeToolStandard('grade_predict_what_if', { courseId: course.id, overrides }, context))
    .toMatchObject({ success: false, errorCode: 'missing_info' });
});

test('another student score does not replace an unavailable personal score', async () => {
  gradebook.rows = gradebook.rows.filter((row) => row.uid !== context.userId);
  expect(await executeToolStandard('grade_predict_what_if', { courseId: course.id }, context))
    .toMatchObject({ success: false, errorCode: 'missing_info' });
});

test('planning and notifications retain only selected-campus member tasks', async () => {
  source.listCourseSpaces.mockResolvedValue([course, { ...course, groupId: 'foreign', schoolId: 'pu' }]);
  source.listInboxTasks.mockResolvedValue([
    ownTask, { ...ownTask, id: 'foreign-task', groupId: 'foreign', title: '其他學校的私人作業' },
    { ...ownTask, id: 'stranger-task', groupId: 'stranger', title: '未加入課程的作業' },
    { ...ownTask, id: 'done-task', title: '已完成作業', preferredIntent: 'review' },
  ]);
  const plan = await executeToolStandard('study_plan_today', {}, context);
  expect(plan.data).toMatchObject({ priorityCount: 1, totalMinutes: 25, topTasks: [{ title: ownTask.title }] });
  expect(plan.summary).toContain('25 分鐘');
  const notices = await executeToolStandard('urgent_notifications', {}, context);
  expect(notices.data).toEqual([expect.objectContaining({ title: ownTask.title, severity: 'critical' })]);
  expect(JSON.stringify([plan, notices])).not.toMatch(/其他學校|未加入課程|已完成作業/);
});

test('empty real membership produces empty context and marks unqueried domains', async () => {
  source.listCourseSpaces.mockResolvedValue([]);
  const full = await executeToolStandard('ai_full_context', {}, context);
  expect(full.data).toMatchObject({ courses: [], today: { priorityCount: 0 }, urgentNotifications: [] });
  const inventory = await executeToolStandard('ai_data_inventory', {}, context);
  if (!inventory.success) throw new Error(inventory.summary);
  expect(inventory.data).toMatchObject({ domains: expect.arrayContaining([
    { key: 'courses', label: '已加入課程', status: 'loaded', scope: 'joined_course_memberships', fields: ['id', 'name'] },
    expect.objectContaining({ key: 'notifications', label: '課程待辦優先提醒', scope: 'course_inbox' }),
    { key: 'notes', label: '筆記', status: 'not_loaded' },
    { key: 'creditAudit', label: '畢業學分', status: 'not_loaded' },
  ]) });
  expect(JSON.stringify([full, inventory])).not.toMatch(/5 門|所有 domain 已串接|風險/);
});

test.each(['account', 'data-source', 'evidence', 'school', 'clear-school'])('discards a delayed personal source after %s changes', async (change) => {
  let finish!: (value: CourseSpace[]) => void;
  source.listCourseSpaces.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = executeToolStandard('ai_full_context', {}, context);
  if (change === 'account') auth.currentUser = { uid: 'student-b' };
  if (change === 'data-source') jest.mocked(getDataSource).mockReturnValue({ ...source } as unknown as ReturnType<typeof getDataSource>);
  if (change === 'evidence') jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'firebase', sourceLabel: 'real' });
  if (change === 'school') selectSchool('ncnu');
  if (change === 'clear-school') selectSchool(null);
  finish([course]);
  expect(await pending).toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(source.listInboxTasks).not.toHaveBeenCalled();
});

test('discards a late private error when the account changes', async () => {
  let reject!: (reason: Error) => void;
  source.listCourseSpaces.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = executeToolStandard('ai_full_context', {}, context);
  auth.currentUser = { uid: 'student-b' };
  reject(new Error('舊帳號的私人學號與課程'));
  const result = await pending;
  expect(result).toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(JSON.stringify(result)).not.toContain('舊帳號的私人學號與課程');
});

test('PU hybrid academic reads require the existing verified school binding', async () => {
  selectSchool('pu');
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'hybrid', sourceLabel: 'real' });
  const result = await executeToolStandard('study_plan_today', {}, { ...context, schoolId: 'pu' });
  expect(result).toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
});

test.each(tools)('%s accepts a matching verified PU source', async (tool) => {
  selectSchool('pu');
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'hybrid', sourceLabel: 'real' });
  jest.mocked(getVerifiedSchoolAiScope).mockReturnValue({} as NonNullable<ReturnType<typeof getVerifiedSchoolAiScope>>);
  source.listCourseSpaces.mockResolvedValue([{ ...course, schoolId: 'pu' }]);
  const result = await executeToolStandard(tool, { courseId: course.id }, { ...context, schoolId: 'pu' });
  expect(result.success).toBe(true);
  expect(source.listCourseSpaces).toHaveBeenCalledWith('student-a', 'pu');
});

test.each([
  ['gradebook', 'account'], ['inbox', 'account'], ['gradebook', 'school'], ['inbox', 'school'],
])('discards the %s result if %s changes after course lookup', async (stage, change) => {
  let started!: () => void;
  let finish!: (value: unknown) => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const method = stage === 'gradebook' ? source.getCourseGradebook : source.listInboxTasks;
  method.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  });
  const tool = stage === 'gradebook' ? 'grade_predict_what_if' : 'ai_full_context';
  const pending = executeToolStandard(tool, { courseId: course.id }, context);
  await ready;
  if (change === 'account') auth.currentUser = { uid: 'student-b' };
  else selectSchool('ncnu');
  finish(stage === 'gradebook' ? gradebook : [ownTask]);
  const result = await pending;
  expect(result).toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(result.data).toBeUndefined();
});

test('a signed-out Firebase session cannot read the previous account source', async () => {
  auth.currentUser = null;
  expect(await executeToolStandard('ai_full_context', {}, context))
    .toMatchObject({ success: false, errorCode: 'precondition_failed' });
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
});

test('a verified PU source is discarded if its binding changes while loading', async () => {
  selectSchool('pu');
  jest.mocked(getDataSourceEvidence).mockReturnValue({ mode: 'hybrid', sourceLabel: 'real' });
  jest.mocked(getVerifiedSchoolAiScope).mockReturnValue({} as NonNullable<ReturnType<typeof getVerifiedSchoolAiScope>>);
  let finish!: (value: CourseSpace[]) => void;
  source.listCourseSpaces.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = executeToolStandard('ai_full_context', {}, { ...context, schoolId: 'pu' });
  jest.mocked(isVerifiedSchoolAiScopeCurrent).mockReturnValue(false);
  finish([{ ...course, schoolId: 'pu' }]);
  expect(await pending).toMatchObject({ success: false, errorCode: 'precondition_failed' });
});

test.each(tools)('%s preserves explicitly enabled demo data with a visible label', async (tool) => {
  jest.mocked(isDevelopmentDemoSession).mockReturnValue(true);
  const result = await executeToolStandard(tool, { courseId: '71378' }, {
    userId: 'demo_student_kuchih', schoolId: 'tw-pu', role: 'student',
  });
  if (!result.success) throw new Error(result.summary);
  expect(result.success).toBe(true);
  expect(result.summary).toContain('示範資料');
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
  expect(buildFullAIContext).not.toHaveBeenCalled();
  expect(buildWideAISnapshot).not.toHaveBeenCalled();
  expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
});

test('the explicit demo guest retains the existing empty course permissions', async () => {
  jest.mocked(isDevelopmentDemoSession).mockReturnValue(true);
  const result = await executeToolStandard('ai_full_context', {}, {
    userId: 'demo_guest', schoolId: 'pu', role: 'guest' as ToolExecutionContext['role'],
  });
  if (!result.success) throw new Error(result.summary);
  expect(result).toMatchObject({ success: true, data: { source: 'demo', courses: [] } });
  expect(result.summary).toContain('示範資料');
  expect(source.listCourseSpaces).not.toHaveBeenCalled();
  expect(source.listInboxTasks).not.toHaveBeenCalled();
  expect(source.getCourseGradebook).not.toHaveBeenCalled();
  expect(getDataSource).not.toHaveBeenCalled();
  expect(buildFullAIContext).not.toHaveBeenCalled();
  expect(buildWideAISnapshot).not.toHaveBeenCalled();
  expect(AsyncStorage.getAllKeys).not.toHaveBeenCalled();
});

test.each([
  { userId: 'guest', schoolId: 'pu', demo: true },
  { userId: 'demo_unknown', schoolId: 'pu', demo: true },
  { userId: 'demo_student_kuchih', schoolId: 'pu', demo: true },
  { userId: 'demo_guest', schoolId: 'nthu', demo: true },
  { userId: 'demo_guest', schoolId: 'pu', demo: false },
])('denies academic tools to a guest outside the explicit demo guest scope: %j', async ({ demo, ...identity }) => {
  jest.mocked(isDevelopmentDemoSession).mockReturnValue(demo);
  for (const tool of tools) {
    expect(await executeToolStandard(tool, { courseId: '71378' }, {
      ...identity, role: 'guest' as ToolExecutionContext['role'],
    })).toMatchObject({ success: false, errorCode: 'role_denied' });
  }
  expect(getDataSource).not.toHaveBeenCalled();
  expect(getDemoCoursesForUid).not.toHaveBeenCalled();
});

test.each([
  { userId: 'demo_unknown', schoolId: 'pu' },
  { userId: 'demo_student_kuchih', schoolId: 'nthu' },
])('an unknown or cross-school demo identity cannot load demo courses', async (identity) => {
  jest.mocked(isDevelopmentDemoSession).mockReturnValue(true);
  expect(await executeToolStandard('ai_full_context', {}, identity)).toMatchObject({ success: false });
  expect(getDemoCoursesForUid).not.toHaveBeenCalled();
});

test('a demo-looking uid in a release session cannot activate demonstration data', async () => {
  expect(await executeToolStandard('ai_full_context', {}, { userId: 'demo_student_kuchih', schoolId: 'pu' }))
    .toMatchObject({ success: false });
  expect(getDemoCoursesForUid).not.toHaveBeenCalled();
});
