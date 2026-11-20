import type { PostLoginContext } from '../../data/postLoginTypes';
import { executeSmartAction, detectAndExecuteSmartAction, type SmartActionType } from '../../services/aiSmartActions';
import { getInMemoryPostLoginContext } from '../../services/postLoginContextHolder';
import { bindVerifiedSchoolAiScope } from '../../services/verifiedSchoolAiScope';
import * as rawCache from '../../services/supabaseLmsCache';
import { computeRealtimeInsights } from '../../services/aiRealtimeAnalytics';

jest.mock('../../services/postLoginContextHolder', () => ({
  getInMemoryPostLoginContext: jest.fn(() => null),
}));
jest.mock('../../services/postLoginContextFromCaches', () => ({
  resolveActivePostLoginContext: jest.fn(async () => null),
}));
jest.mock('../../services/aiRealtimeAnalytics', () => ({ computeRealtimeInsights: jest.fn() }));
jest.mock('../../services/aiLocalAgent', () => ({ resetAdaptiveLearnedPatternsForTests: jest.fn() }));
jest.mock('../../services/supabaseLmsCache', () => ({
  getAnyCachedCourses: jest.fn(async () => null),
  getAnyCachedGrades: jest.fn(async () => null),
  getAnyCachedTCCourses: jest.fn(async () => null),
  getAnyCachedTCActivities: jest.fn(async () => null),
  getAnyCachedTCAttendance: jest.fn(async () => null),
  getAnyCachedTCTodos: jest.fn(async () => null),
  getAnyCachedStudentInfo: jest.fn(async () => null),
}));

const identity = { userId: 'owner-a', schoolId: 'pu' };
const actions: SmartActionType[] = [
  'query_grades', 'query_schedule', 'query_attendance', 'query_assignments', 'query_credits',
  'query_student_info', 'query_gpa_prediction', 'query_today_schedule', 'query_next_class',
  'query_free_time', 'query_course_load', 'query_risk_analysis', 'suggest_study_plan', 'full_analysis',
];
const rawReaders = [
  rawCache.getAnyCachedCourses, rawCache.getAnyCachedGrades, rawCache.getAnyCachedTCCourses,
  rawCache.getAnyCachedTCActivities, rawCache.getAnyCachedTCAttendance, rawCache.getAnyCachedTCTodos,
  rawCache.getAnyCachedStudentInfo,
];
let currentSession: object;

beforeEach(() => {
  jest.clearAllMocks();
  const context: PostLoginContext = {
    uid: identity.userId, schoolId: identity.schoolId, origin: 'verified-school-login',
    roles: {
      primaryRole: 'student', subRoles: [], source: 'firestore',
      flags: { isStudent: true, isTeacher: false, isDeptAdmin: false, isAdmin: false },
    },
    latestAnnouncements: [], partialErrors: [], builtAt: new Date().toISOString(),
  };
  jest.mocked(getInMemoryPostLoginContext).mockReturnValue(context);
  currentSession = {};
  const session = currentSession;
  bindVerifiedSchoolAiScope(context, () => {
    if (currentSession !== session) throw new Error('school session changed');
  });
});

test.each(actions)('%s skips every raw source for another school, another account, or missing identity', async (action) => {
  for (const scope of [
    { ...identity, schoolId: 'nthu' },
    { ...identity, userId: 'owner-b' },
    { schoolId: 'pu' },
    undefined,
  ]) {
    expect(await executeSmartAction(action, scope)).toMatchObject({ success: false });
  }
  for (const reader of rawReaders) expect(reader).not.toHaveBeenCalled();
  expect(computeRealtimeInsights).not.toHaveBeenCalled();
});

test('unverified smart actions fall through to the normal assistant', async () => {
  expect(await detectAndExecuteSmartAction('查作業', { ...identity, schoolId: 'nthu' })).toBeNull();
  expect(await detectAndExecuteSmartAction('查成績', { ...identity, userId: 'owner-b' })).toBeNull();
});

test('matching verified school login can read its raw assignments', async () => {
  await expect(executeSmartAction('query_assignments', identity)).resolves.toMatchObject({ success: true });
  expect(rawCache.getAnyCachedTCActivities).toHaveBeenCalledTimes(1);
  expect(rawCache.getAnyCachedTCTodos).toHaveBeenCalledTimes(1);
  expect(rawCache.getAnyCachedTCCourses).toHaveBeenCalledTimes(1);
});

test('discards raw data if the school session changes while awaiting cache reads', async () => {
  let finish!: (value: Awaited<ReturnType<typeof rawCache.getAnyCachedTCTodos>>) => void;
  jest.mocked(rawCache.getAnyCachedTCTodos).mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve;
  }));
  const pending = executeSmartAction('query_assignments', identity);
  currentSession = {};
  finish([{
    id: 8, course_id: 3, title: '前一個帳號的私人作業', type: 'homework', status: 'pending',
    description: null, start_time: null, end_time: null, score: null, total_score: null,
    weight: null, score_percentage: null, published: true,
  }]);
  const result = await pending;
  expect(result.success).toBe(false);
  expect(JSON.stringify(result)).not.toContain('前一個帳號的私人作業');
});

test('discards a rejected read error after the school session changes', async () => {
  let rejectRead!: (error: Error) => void;
  jest.mocked(rawCache.getAnyCachedGrades).mockImplementationOnce(() => new Promise((_, reject) => {
    rejectRead = reject;
  }));
  const pending = executeSmartAction('query_grades', identity);
  currentSession = {};
  rejectRead(new Error('前一個帳號的私人學業紀錄'));
  const result = await pending;
  expect(result).toMatchObject({ success: false, title: '學校資料尚未就緒' });
  expect(JSON.stringify(result)).not.toContain('前一個帳號的私人學業紀錄');
});
