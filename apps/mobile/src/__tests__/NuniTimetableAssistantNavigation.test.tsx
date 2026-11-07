import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { act, cleanupAsync, fireEvent, fireEventAsync, render, renderAsync, waitFor, within } from '@testing-library/react-native/pure';
import * as Notifications from 'expo-notifications';
import { PersonalEventReminderBridge } from '../components/PersonalEventReminderBridge';
import { publicNavigationRef, markPublicNavigationReady, markPublicNavigationUnready } from '../app/publicNavigation';
import { __resetPersonalEventReminderNavigationForTests } from '../services/personalEventReminderNavigation';
import { NuniSessionProvider } from '../state/nuniSession';
import { PreAuthStack } from '../screens/PreAuthStack';
import { MeStack } from '../screens/MeStack';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
import { personalImportStorageKey } from '../services/personalImports';
import type { NuniAssignment, NuniQuiz } from '@campus/shared/src/nuni';
import * as assignmentFileSubmit from '../screens/nuni/assignmentFileSubmit';
import * as nuniPlanAssignmentTarget from '../services/nuniPlanAssignmentTarget';
import type { StoredTimetable } from '../services/personalTimetable';

const account = 'pa_11111111-1111-4111-8111-111111111111';
let mockSchoolSelectionReady = true;
const mockSchool = { id: 'pu', name: '靜宜大學' };
let mockStored: string | null;
const mockRequest = jest.fn();
const mockAssignmentBff = jest.fn();
jest.unmock('@react-navigation/native');
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('expo-secure-store', () => ({
  isAvailableAsync: async () => true,
  getItemAsync: async () => mockStored,
  deleteItemAsync: async () => { mockStored = null; },
}));
jest.mock('../services/nuniClient', () => ({
  ...jest.requireActual('../services/nuniClient'),
  nuniPlatformRequest: (...args: unknown[]) => mockRequest(...args),
  nuniBffRequest: (...args: unknown[]) => mockAssignmentBff(...args),
}));
let mockAuthUser: { uid: string; displayName?: string } | null = null;
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    loading: false,
    profile: mockAuthUser ? { uid: mockAuthUser.uid, displayName: mockAuthUser.displayName || '同學', role: 'student' } : null,
    profileLoading: false,
    error: '',
    signOutWithWarning: jest.fn(),
  }),
}));
jest.mock('../app/rootNavigation', () => ({
  ...jest.requireActual('../app/rootNavigation'),
  rootNavigateNested: jest.fn(),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool, selectionReady: mockSchoolSelectionReady }) }));
jest.mock('../state/theme', () => ({
  useThemeMode: () => ({ mode: 'light' }),
  useTheme: () => require('../ui/theme').getCurrentTheme(),
}));
jest.mock('../components/SchoolBrowsingControl', () => ({ SchoolBrowsingControl: () => null }));
jest.mock('../components/SchoolPortalImport', () => ({ SchoolPortalImportEntry: () => null }));
jest.mock('../components/TodayTimetablePanel', () => ({ TodayTimetablePanel: () => null }));
jest.mock('../services/schoolLoginAvailability', () => ({
  isSchoolLoginEntryAvailable: () => false, loadSchoolLoginProviderKinds: async () => [],
}));
jest.mock('../firebase', () => ({
  getAuthInstance: jest.fn(() => { throw Error('unexpected Firebase auth lookup'); }),
  getDb: jest.fn(() => { throw Error('unexpected Firestore lookup'); }),
  getFunctionsInstance: jest.fn(() => { throw Error('unexpected Firebase Functions lookup'); }),
}));

const initialState = AppState.currentState;
const realSetTimeout = global.setTimeout;
beforeEach(async () => {
  jest.useFakeTimers({ now: new Date('2026-11-05T09:45:00+08:00'), doNotFake: [
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
    'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'hrtime',
  ] });
  AppState.currentState = 'active';
  mockStored = JSON.stringify({
    platformAccountId: account, sessionHandle: 'ps_' + 'a'.repeat(43),
    expiresAt: Date.now() + 3_600_000, pendingLogout: false,
  });
  mockAssignmentBff.mockReset().mockRejectedValue(new Error('unexpected assignment BFF request'));
  mockRequest.mockReset().mockImplementation(async (path) => {
    if (path !== 'sessions/current') throw Error('unexpected request: ' + path);
    return { authenticated: true, platformAccountId: account, isPlatformOperator: false };
  });
  await AsyncStorage.clear();
  const saved: StoredTimetable = {
    schoolId: 'pu', shareWithFriends: false, updatedAt: '2026-11-04T05:00:00Z',
    meta: { school: '', className: '', credits: 0, title: '', year: '115', semester: '1' },
    courses: [{ id: 'db', name: '資料庫管理', room: '主顧 305', teacher: '', color: 'blue', day: 4, start: 1, end: 2 }],
  };
  const other = 'nuni:pa_22222222-2222-4222-8222-222222222222';
  await AsyncStorage.multiSet([
    [`campus-one-personal-timetable:nuni:${account}:pu`, JSON.stringify(saved)],
    [`campus-one-personal-timetable:${other}:pu`, JSON.stringify({
      ...saved, courses: [{ ...saved.courses[0], room: '另一個帳號的教室' }],
    })],
  ]);
});
afterEach(async () => {
  await cleanupAsync();
  mockSchoolSelectionReady = true;
  mockAuthUser = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.setTimeout = realSetTimeout;
  AppState.currentState = initialState;
});

test('from the signed-in public landing to the exact saved class and back, using only platform-owned local data', async () => {
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const unhandled = jest.fn();
  const screen = render(
    <NuniSessionProvider>
      <NavigationContainer ref={navigation} onUnhandledAction={unhandled}>
        <PreAuthStack />
      </NavigationContainer>
    </NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  await screen.findByText('資料庫管理');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  fireEvent.press(screen.getByText('現在有課嗎？'));
  const result = await screen.findByRole('button', { name: /在課表中查看資料庫管理/ });
  fireEvent.press(result);
  await screen.findByText('2026-11-05 · 08:10–10:00 · 主顧 305');
  expect(navigation.getCurrentRoute()).toMatchObject({ name: 'PersonalTimetable', params: {
    reminderScope: JSON.stringify({ owner: 'nuni:' + account, schoolId: 'pu' }),
    courseId: 'manual:db', term: '115|1', startAt: Date.parse('2026-11-05T08:10:00+08:00'),
  } });
  act(() => navigation.goBack());
  await screen.findByRole('button', { name: /在課表中查看資料庫管理/ });
  const firebase = jest.requireMock('../firebase');
  expect(firebase.getAuthInstance).not.toHaveBeenCalled();
  expect(firebase.getDb).not.toHaveBeenCalled();
  expect(firebase.getFunctionsInstance).not.toHaveBeenCalled();
  expect(mockRequest.mock.calls.map(([path]) => path)).toEqual(['sessions/current']);
  expect(screen.queryByText(/另一個帳號的教室/)).toBeNull();
  expect(jest.mocked(AsyncStorage.getItem).mock.calls.some(([key]) => key.includes('pa_22222222'))).toBe(false);
  expect(unhandled).not.toHaveBeenCalled();
});

test('signed-out landing has no timetable assistant shortcut and a restored private route requires a session', async () => {
  mockStored = null;
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  await screen.findByRole('button', { name: '登入或建立帳號' });
  expect(screen.queryByRole('button', { name: '開啟課表助理' })).toBeNull();
  act(() => navigation.navigate('NuniTimetableAssistant'));
  await screen.findByRole('button', { name: '前往 nuni 帳號' });
  expect(screen.queryByText('資料庫管理')).toBeNull();
  expect(mockRequest).not.toHaveBeenCalled();
});

test('a signed-in student can enter the same assistant directly from the workspace header', async () => {
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '回到我的 nuni' }));
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
  fireEvent.press(await screen.findByRole('button', { name: '問課表' }));
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  await screen.findByText('資料庫管理');
});

test('returning to the foreground keeps an unexpired conversation', async () => {
  const listeners: Array<(state: string) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() };
  });
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  fireEvent.press(await screen.findByText('現在有課嗎？'));
  await screen.findByRole('button', { name: /在課表中查看資料庫管理/ });
  let accept!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve; }));
  await act(async () => { for (const listener of listeners) listener('active'); });
  expect(screen.getByRole('button', { name: /在課表中查看資料庫管理/ })).toBeTruthy();
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  await act(async () => accept({ authenticated: true, platformAccountId: account, isPlatformOperator: false }));
  expect(screen.getByRole('button', { name: /在課表中查看資料庫管理/ })).toBeTruthy();
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
});

test('a conversation left open at session expiry hides the previous class and can return to the account page', async () => {
  const now = Date.now();
  let expire: (() => void) | undefined;
  global.setTimeout = ((callback, delay, ...args) => {
    if (delay === 30_000) expire = () => callback(...args);
    return realSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;
  mockStored = JSON.stringify({ ...JSON.parse(mockStored!), expiresAt: now + 30_000 });
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  fireEvent.press(await screen.findByText('現在有課嗎？'));
  await screen.findByRole('button', { name: /在課表中查看資料庫管理/ });
  expect(expire).toBeDefined();
  jest.setSystemTime(now + 30_000);
  await act(async () => { expire!(); });
  const accountLink = await screen.findByRole('button', { name: '前往 nuni 帳號' });
  expect(screen.queryByText('資料庫管理')).toBeNull();
  expect(mockStored).toBeNull();
  expect(mockRequest.mock.calls.map(([path]) => path)).toEqual(['sessions/current']);
  fireEvent.press(accountLink);
  expect(navigation.getCurrentRoute()?.name).toBe('NuniWorkspace');
});

async function linkedWorkspaceFixture() {
  const course = {
    id: 'cw_11111111-1111-4111-8111-111111111111', title: '資料庫管理', memberRole: 'student', state: 'active',
  };
  const other = { ...course, id: 'cw_22222222-2222-4222-8222-222222222222' };
  const assignment: NuniAssignment = {
    id: 'cwa_11111111-1111-4111-8111-111111111111', workspaceId: course.id, title: '小考報告',
    instructions: '請上傳這週的關聯模型。', state: 'open', unitId: null, unitTitle: null, closedAt: null,
    createdAt: '2026-11-03T08:00:00Z', dueAt: '2026-11-06T08:00:00Z', submissionCount: 0, mySubmission: null,
  };
  await AsyncStorage.removeItem(`campus-one-personal-timetable:nuni:${account}:pu`);
  await AsyncStorage.setItem(personalImportStorageKey({ owner: `nuni:${account}`, schoolId: 'pu' }), JSON.stringify({
    version: 1, batches: [], records: [{
      id: 'import-db', batchId: 'batch-db', kind: 'timetable', title: course.title, location: '主顧 305',
      schoolId: 'pu', academicYear: '115', semester: '1', dayOfWeek: 4, startPeriod: 1, endPeriod: 2,
      importedAt: '2026-11-02T08:00:00Z', source: { type: 'paste', line: 1, rawText: '資料庫管理' },
      linkedCourseId: course.id,
    }],
  }));
  mockRequest.mockImplementation(async (path) => {
    if (path === 'sessions/current') return { authenticated: true, platformAccountId: account, isPlatformOperator: false };
    if (path === 'class-workspaces') return { workspaces: [other, course] };
    if (path === `class-workspaces/${course.id}`) return course;
    if (path === `class-workspaces/${course.id}/materials/page`) return { materials: [], nextCursor: null };
    if (path === `class-workspaces/${course.id}/quizzes`) return { quizzes: [] };
    throw Error('unexpected direct read ' + path);
  });
  mockAssignmentBff.mockImplementation(async (path) => {
    if (path === `class-workspaces/${course.id}/assignments`) return { assignments: [assignment] };
    throw Error('unexpected assignment read ' + path);
  });
  return { course, other, assignment };
}

async function linkedPlanningFixture() {
  const fixture = await linkedWorkspaceFixture();
  const direct = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (path, session, input, ...rest) => {
    if (path === 'course-access/workspace-course') {
      expect(input).toEqual({ workspaceId: fixture.course.id, schoolId: 'pu' });
      return {
        workspaceId: fixture.course.id, memberRole: 'student', membershipActive: true,
        status: 'reviewed', course: {
          id: 'ccd_11111111-1111-4111-8111-111111111111', workspaceId: fixture.course.id,
          version: 1, verification: 'administrator-reviewed', schoolId: 'pu', academicYear: '115', semester: '1',
          title: fixture.course.title, courseCode: 'MIS302', teacher: '張老師', className: '資管三甲',
        },
      };
    }
    return direct(path, session, input, ...rest);
  });
  const decoy: NuniAssignment = {
    ...fixture.assignment, id: 'cwa_33333333-3333-4333-8333-333333333333',
    instructions: '另一份同名作業，不能代替目標作業。', state: 'closed', closedAt: '2026-11-04T08:00:00Z',
  };
  const assignmentPath = `class-workspaces/${fixture.course.id}/assignments`;
  mockAssignmentBff.mockImplementation(async (path) => {
    if (path === assignmentPath) return { assignments: [decoy, fixture.assignment] };
    throw Error('unexpected assignment read ' + path);
  });
  return { ...fixture, decoy, assignmentPath };
}

async function openPlatformWeekPlan() {
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const unhandled = jest.fn();
  const screen = await renderAsync(
    <NuniSessionProvider>
      <NavigationContainer ref={navigation} onUnhandledAction={unhandled}>
        <PreAuthStack />
      </NavigationContainer>
    </NuniSessionProvider>,
  );
  await fireEventAsync.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  await fireEventAsync.press(await screen.findByRole('button', { name: '規劃未來七天' }));
  await screen.findByText('接下來七天的學習行動');
  const actions = await screen.findAllByRole('button', { name: '查看這份作業' });
  return { screen, navigation, unhandled, openAssignment: actions[0] };
}

async function linkedPlanningQuizFixture() {
  const fixture = await linkedPlanningFixture();
  const quiz: NuniQuiz = {
    id: 'cwq_55555555-5555-4555-8555-555555555555', workspaceId: fixture.course.id,
    title: fixture.assignment.title, prompt: '原本的測驗題目，只在課程頁顯示。',
    state: 'open', closedAt: null, createdAt: '2026-11-03T08:00:00Z', dueAt: '2026-11-06T07:00:00Z',
    unitId: null, unitTitle: null, responseCount: 0, myResponse: null,
  };
  const decoyQuiz: NuniQuiz = { ...quiz, id: 'cwq_66666666-6666-4666-8666-666666666666',
    prompt: '另一份同名測驗，不能代替指定測驗。', state: 'closed', closedAt: '2026-11-04T08:00:00Z' };
  const quizPath = `class-workspaces/${fixture.course.id}/quizzes`;
  const direct = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (path, ...args) => path === quizPath ? { quizzes: [decoyQuiz, quiz] } : direct(path, ...args));
  return { ...fixture, quiz, decoyQuiz, quizPath };
}

test('a mixed plan opens the exact quiz through its real platform reader and receiver without choosing a namesake assignment', async () => {
  const { course, other, assignment, quiz, decoyQuiz, quizPath, assignmentPath } = await linkedPlanningQuizFixture();
  const { screen, navigation, unhandled } = await openPlatformWeekPlan();
  expect(mockAssignmentBff.mock.calls.map(([path]) => path)).toEqual([assignmentPath]);
  expect(screen.queryByText(quiz.prompt)).toBeNull();
  const updated: NuniQuiz = { ...quiz, title: '小考報告：最新測驗', dueAt: '2026-11-06T06:00:00Z',
    prompt: '最新測驗要求：請解釋正規化與索引的差異。' };
  const direct = mockRequest.getMockImplementation()!;
  let resolveFresh!: (value: unknown) => void;
  let quizReads = 0;
  mockRequest.mockImplementation(async (path, ...args) => {
    if (path !== quizPath) return direct(path, ...args);
    quizReads++;
    if (quizReads === 1) return new Promise((resolve) => { resolveFresh = resolve; });
    return { quizzes: [decoyQuiz, updated] };
  });
  await fireEventAsync.press((await screen.findAllByRole('button', { name: '查看這份測驗' }))[0]);
  await waitFor(() => expect(resolveFresh).toBeDefined());
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  expect(screen.queryByLabelText('測驗作答區：' + updated.title)).toBeNull();
  await act(async () => resolveFresh({ quizzes: [decoyQuiz, updated] }));
  await screen.findByLabelText('測驗作答區：' + updated.title);
  const selected = within(screen.getByTestId(`quiz-${quiz.id}`));
  expect(selected.getByText(updated.prompt)).toBeTruthy();
  expect(screen.queryByLabelText('作業繳交區：' + assignment.title)).toBeNull();
  expect(within(screen.getByTestId(`quiz-${decoyQuiz.id}`)).queryByLabelText('測驗作答區：' + decoyQuiz.title)).toBeNull();
  expect(navigation.getCurrentRoute()).toMatchObject({ name: 'NuniWorkspace', params: {
    tab: 'courses', workspaceId: course.id, assignmentId: quiz.id, assistantAccountId: account,
  } });
  expect(quizReads).toBeGreaterThanOrEqual(2);
  expect([...mockRequest.mock.calls, ...mockAssignmentBff.mock.calls].some(([path]) => path.includes(other.id))).toBe(false);
  expect(mockRequest.mock.calls.filter(([path]) => path === quizPath).every(([, , body]) => body === undefined)).toBe(true);
  expect(mockAssignmentBff.mock.calls.every(([path, , body]) => path === assignmentPath && body === undefined)).toBe(true);
  expect(unhandled).not.toHaveBeenCalled();
  await act(async () => navigation.goBack());
  await screen.findByText('接下來七天的學習行動');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
});

test('the real quiz receiver reports removal after verification and leaves an identically named quiz unfocused', async () => {
  const { course, quiz, decoyQuiz, quizPath } = await linkedPlanningQuizFixture();
  const { screen, navigation, unhandled } = await openPlatformWeekPlan();
  const direct = mockRequest.getMockImplementation()!;
  let quizReads = 0;
  mockRequest.mockImplementation(async (path, ...args) => {
    if (path !== quizPath) return direct(path, ...args);
    return { quizzes: ++quizReads === 1 ? [decoyQuiz, quiz] : [decoyQuiz] };
  });
  await fireEventAsync.press((await screen.findAllByRole('button', { name: '查看這份測驗' }))[0]);
  await screen.findByText('找不到這份測驗。可能已被老師刪除，或你沒有查看權限。請從測驗列表選擇其他測驗。');
  expect(navigation.getCurrentRoute()).toMatchObject({ name: 'NuniWorkspace', params: {
    workspaceId: course.id, assignmentId: quiz.id, assistantAccountId: account,
  } });
  expect(screen.getByTestId(`quiz-${decoyQuiz.id}`)).toBeTruthy();
  expect(screen.queryByTestId(`quiz-${quiz.id}`)).toBeNull();
  expect(screen.queryByLabelText('測驗作答區：' + quiz.title)).toBeNull();
  expect(quizReads).toBeGreaterThanOrEqual(2);
  expect(unhandled).not.toHaveBeenCalled();
});

test('a platform plan freshly checks its exact assignment and the real receiver focuses the updated record', async () => {
  const { course, other, assignment, decoy, assignmentPath } = await linkedPlanningFixture();
  const { screen, navigation, unhandled, openAssignment } = await openPlatformWeekPlan();
  expect(mockAssignmentBff.mock.calls.map(([path]) => path)).toEqual([assignmentPath]);
  const latest: NuniAssignment = {
    ...assignment, title: '小考報告：更新要求', instructions: '最新要求：請補上關聯模型與資料字典。',
    dueAt: '2026-11-06T09:00:00Z',
  };
  let resolveFresh!: (value: unknown) => void;
  let readsAfterPlan = 0;
  mockAssignmentBff.mockImplementation(async (path) => {
    if (path !== assignmentPath) throw Error('unexpected assignment read ' + path);
    readsAfterPlan += 1;
    if (readsAfterPlan === 1) return new Promise((resolve) => { resolveFresh = resolve; });
    return { assignments: [decoy, latest] };
  });
  await fireEventAsync.press(openAssignment);
  await waitFor(() => expect(resolveFresh).toBeDefined());
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  expect(screen.queryByLabelText('作業繳交區：' + latest.title)).toBeNull();
  await act(async () => resolveFresh({ assignments: [decoy, latest] }));

  await screen.findByLabelText('作業繳交區：' + latest.title);
  const target = within(screen.getByTestId(`assignment-${assignment.id}`));
  expect(target.getByText(latest.instructions)).toBeTruthy();
  expect(target.getByLabelText('作業繳交區：' + latest.title)).toBeTruthy();
  expect(within(screen.getByTestId(`assignment-${decoy.id}`)).queryByLabelText('作業繳交區：' + decoy.title)).toBeNull();
  expect(readsAfterPlan).toBeGreaterThanOrEqual(2);
  expect(navigation.getCurrentRoute()).toMatchObject({
    name: 'NuniWorkspace', params: {
      tab: 'courses', workspaceId: course.id, assignmentId: assignment.id, assistantAccountId: account,
    },
  });
  expect([...mockRequest.mock.calls, ...mockAssignmentBff.mock.calls].some(([path]) => path.includes(other.id))).toBe(false);
  expect(mockAssignmentBff.mock.calls.every(([, , input]) => input === undefined)).toBe(true);
  expect(unhandled).not.toHaveBeenCalled();

  await act(async () => navigation.goBack());
  await screen.findByText('接下來七天的學習行動');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  expect(screen.queryByText('已收到伺服器繳交紀錄。')).toBeNull();
});

test('leaving a pending exact-assignment check for the course overview prevents late navigation, including after returning', async () => {
  const lookup = jest.spyOn(nuniPlanAssignmentTarget, 'readNuniPlanAssignmentTarget');
  const { course, other, assignment, decoy, assignmentPath } = await linkedPlanningFixture();
  const direct = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation(async (path, ...args) => path === `class-workspaces/${other.id}/quizzes`
    ? { quizzes: [] } : direct(path, ...args));
  const { screen, navigation, unhandled } = await openPlatformWeekPlan();
  const assistantKey = navigation.getCurrentRoute()!.key;
  const otherAssignmentPath = `class-workspaces/${other.id}/assignments`;

  for (const returnBeforeReply of [false, true]) {
    let resolveFresh!: (value: unknown) => void;
    let deferFresh = true;
    let overviewRead = false;
    mockAssignmentBff.mockImplementation(async (path) => {
      if (path === otherAssignmentPath) return { assignments: [] };
      if (path !== assignmentPath) throw Error('unexpected assignment read ' + path);
      if (deferFresh) {
        deferFresh = false;
        return new Promise((resolve) => { resolveFresh = resolve; });
      }
      overviewRead = true;
      return { assignments: [decoy, assignment] };
    });
    await fireEventAsync.press((await screen.findAllByRole('button', { name: '查看這份作業' }))[0]);
    await waitFor(() => expect(resolveFresh).toBeDefined());
    const pendingLookup = lookup.mock.results[lookup.mock.results.length - 1];
    expect(pendingLookup.type).toBe('return');
    expect(screen.getByRole('button', { name: '正在核對作業…' })).toBeDisabled();

    await fireEventAsync.press(screen.getByRole('button', { name: '開啟課程與作業核對' }));
    await screen.findByText('我的課程');
    await screen.findAllByRole('button', { name: course.title });
    await waitFor(() => expect(overviewRead).toBe(true));
    const destination = navigation.getCurrentRoute();
    expect(destination).toMatchObject({ name: 'NuniWorkspace', params: { tab: 'courses' } });
    expect(destination?.params).toEqual({ tab: 'courses' });
    // A new workspace is pushed above the existing assistant. The pending
    // button stays mounted, so this exercises blur rather than unmount cleanup.
    expect(navigation.getRootState().routes.some((route) =>
      route.key === assistantKey && route.name === 'NuniTimetableAssistant')).toBe(true);
    expect(screen.queryByLabelText('作業繳交區：' + assignment.title)).toBeNull();
    if (returnBeforeReply) {
      await act(async () => navigation.goBack());
      await screen.findByText('接下來七天的學習行動');
      expect(navigation.getCurrentRoute()?.key).toBe(assistantKey);
    }

    await act(async () => {
      resolveFresh({ assignments: [decoy, assignment] });
      // Observe the real reader's promise, including its final binding read;
      // no arbitrary delay or mocked resolver hides a late navigation.
      await pendingLookup.value;
    });
    if (!returnBeforeReply) {
      expect(navigation.getCurrentRoute()).toEqual(destination);
      expect(screen.getByText('我的課程')).toBeTruthy();
      expect(screen.queryByLabelText('作業繳交區：' + assignment.title)).toBeNull();
      await act(async () => navigation.goBack());
    }
    await screen.findByText('接下來七天的學習行動');
    expect(navigation.getCurrentRoute()?.key).toBe(assistantKey);
    expect(screen.queryByRole('button', { name: '正在核對作業…' })).toBeNull();
    expect(screen.queryByLabelText('作業繳交區：' + assignment.title)).toBeNull();
  }
  expect(mockAssignmentBff.mock.calls.every(([path, session, input]) =>
    [assignmentPath, otherAssignmentPath].includes(path) && session === 'ps_' + 'a'.repeat(43) && input === undefined)).toBe(true);
  expect(unhandled).not.toHaveBeenCalled();
});

test('the real receiver rejects assignment params produced by a plan after the platform account changes', async () => {
  const { course, assignment } = await linkedPlanningFixture();
  const { screen, navigation, openAssignment } = await openPlatformWeekPlan();
  await fireEventAsync.press(openAssignment);
  await screen.findByLabelText('作業繳交區：' + assignment.title);
  const params = navigation.getCurrentRoute()?.params as PreAuthStackParamList['NuniWorkspace'];
  expect(params).toMatchObject({ workspaceId: course.id, assignmentId: assignment.id, assistantAccountId: account });
  await screen.unmountAsync();

  const nextAccount = 'pa_22222222-2222-4222-8222-222222222222';
  const nextCourse = { ...course, id: 'cw_44444444-4444-4444-8444-444444444444', title: '目前帳號的課程' };
  const nextHandle = 'ps_' + 'b'.repeat(43);
  const nextAssignmentPath = `class-workspaces/${nextCourse.id}/assignments`;
  mockStored = JSON.stringify({
    platformAccountId: nextAccount, sessionHandle: nextHandle,
    expiresAt: Date.now() + 3_600_000, pendingLogout: false,
  });
  mockRequest.mockReset().mockImplementation(async (path) => {
    if (path === 'sessions/current') return { authenticated: true, platformAccountId: nextAccount, isPlatformOperator: false };
    if (path === 'class-workspaces') return { workspaces: [nextCourse] };
    throw Error('a previous-account target must not be read: ' + path);
  });
  mockAssignmentBff.mockReset().mockImplementation(async (path, session, input) => {
    // The receiver may load the current account's overview, never the prior plan's target.
    if (path === nextAssignmentPath && session === nextHandle && input === undefined) return { assignments: [] };
    throw Error('a previous-account assignment must not be read: ' + path);
  });
  const restored = await renderAsync(
    <NuniSessionProvider>
      <NavigationContainer initialState={{ index: 0, routes: [{ name: 'NuniWorkspace', params }] }}>
        <PreAuthStack />
      </NavigationContainer>
    </NuniSessionProvider>,
  );
  await restored.findByText('已切換 nuni 帳號，請從目前帳號的課程重新選擇作業。');
  await restored.findByText(nextCourse.title);
  expect(restored.queryByLabelText('作業繳交區：' + assignment.title)).toBeNull();
  expect(restored.queryByText(assignment.instructions)).toBeNull();
  expect(mockRequest.mock.calls.some(([path]) => path.includes(course.id))).toBe(false);
  expect(mockAssignmentBff.mock.calls.every(([path, session, input]) =>
    path === nextAssignmentPath && session === nextHandle && input === undefined)).toBe(true);
});

test('the real receiver reports an assignment removed after fresh verification instead of focusing a same-name item', async () => {
  const { course, assignment, decoy, assignmentPath } = await linkedPlanningFixture();
  const { screen, navigation, unhandled, openAssignment } = await openPlatformWeekPlan();
  let readsAfterPlan = 0;
  mockAssignmentBff.mockImplementation(async (path) => {
    if (path !== assignmentPath) throw Error('unexpected assignment read ' + path);
    readsAfterPlan += 1;
    return { assignments: readsAfterPlan === 1 ? [decoy, assignment] : [decoy] };
  });
  await fireEventAsync.press(openAssignment);
  await screen.findByText('找不到這份作業。可能已被老師刪除，或你沒有查看權限。請從作業列表選擇其他作業。');
  expect(navigation.getCurrentRoute()).toMatchObject({
    name: 'NuniWorkspace', params: { workspaceId: course.id, assignmentId: assignment.id, assistantAccountId: account },
  });
  expect(screen.getByTestId(`assignment-${decoy.id}`)).toBeTruthy();
  expect(screen.queryByTestId(`assignment-${assignment.id}`)).toBeNull();
  expect(screen.queryByLabelText('作業繳交區：' + assignment.title)).toBeNull();
  expect(readsAfterPlan).toBeGreaterThanOrEqual(2);
  expect(mockAssignmentBff.mock.calls.every(([, , input]) => input === undefined)).toBe(true);
  expect(unhandled).not.toHaveBeenCalled();
});

test('the assistant opens the exact assignment in the linked workspace even when another joined class has the same name', async () => {
  const { course, other, assignment } = await linkedWorkspaceFixture();
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  fireEvent.press(await screen.findByText('現在有課嗎？'));
  const ask = await screen.findByRole('button', { name: '查這堂課的作業' });
  expect(mockRequest.mock.calls.map(([path]) => path)).toEqual(['sessions/current']);
  expect(mockAssignmentBff).not.toHaveBeenCalled();
  fireEvent.press(ask);
  const target = await screen.findByRole('button', { name: /查看作業.*小考報告/ });
  expect(mockRequest.mock.calls.map(([path]) => path)).toEqual(['sessions/current', 'class-workspaces']);
  expect(mockAssignmentBff.mock.calls.map(([path]) => path)).toEqual([`class-workspaces/${course.id}/assignments`]);
  fireEvent.press(target);
  await screen.findByLabelText('作業繳交區：小考報告');
  expect(screen.getByText(assignment.instructions)).toBeTruthy();
  expect(navigation.getCurrentRoute()).toMatchObject({
    name: 'NuniWorkspace', params: { tab: 'courses', workspaceId: course.id, assignmentId: assignment.id, assistantAccountId: account },
  });
  expect([...mockRequest.mock.calls, ...mockAssignmentBff.mock.calls].every(([path, , body]) =>
    !path.includes(other.id) && body === undefined)).toBe(true);
  act(() => navigation.goBack());
  await screen.findByRole('button', { name: /查看作業.*小考報告/ });
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
});

test('opening an assistant link from another account drops the previous course and assignment targets', async () => {
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  await screen.findByRole('button', { name: '開啟課表助理' });
  const previousCourse = 'cw_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  act(() => navigation.navigate('NuniWorkspace', {
    tab: 'courses', workspaceId: previousCourse, assignmentId: 'cwa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    assistantAccountId: 'pa_22222222-2222-4222-8222-222222222222',
  }));
  await screen.findByText('已切換 nuni 帳號，請從目前帳號的課程重新選擇作業。');
  expect([...mockRequest.mock.calls, ...mockAssignmentBff.mock.calls].some(([path]) => path.includes(previousCourse))).toBe(false);
});

test('a confirmed submission and withdrawal invalidate the chat receipt until the exact assignment is checked again', async () => {
  jest.spyOn(assignmentFileSubmit, 'assignmentFileSubmitEnabledNative').mockReturnValue(true);
  const { course, assignment } = await linkedWorkspaceFixture();
  const other = { ...assignment, id: 'cwa_33333333-3333-4333-8333-333333333333', title: '讀書心得' };
  const listPath = `class-workspaces/${course.id}/assignments`;
  const itemPath = `${listPath}/${assignment.id}`;
  const body = '只留在工作區的繳交內容';
  const submittedAt = '2026-11-05T01:45:00Z';
  let submitted = false;
  mockAssignmentBff.mockImplementation(async (path, _session, input) => {
    if (path === `${itemPath}/submit-files` && input?.body === body) submitted = true;
    else if (path === `${itemPath}/withdraw-submission` && input?.submittedAt === submittedAt) submitted = false;
    else if (path !== listPath) throw Error(`unexpected BFF route: ${path}`);
    const item: NuniAssignment = { ...assignment, mySubmission: submitted ? {
      assignmentId: assignment.id, platformAccountId: account, displayName: '測試學生',
      body, state: 'submitted', submittedAt, teacherFeedback: null, reviewedAt: null,
    } : null };
    return path === listPath ? { assignments: [other, item] } : item;
  });
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  fireEvent.press(await screen.findByText('現在有課嗎？'));
  fireEvent.press(await screen.findByRole('button', { name: '查這堂課的作業' }));
  fireEvent.press(await screen.findByRole('button', { name: /查看作業.*小考報告/ }));
  await screen.findByLabelText('作業繳交區：小考報告');
  fireEvent.changeText(screen.getByLabelText('作業內容：小考報告'), body);
  fireEvent.press(within(screen.getByTestId(`assignment-${assignment.id}`)).getByRole('button', { name: '繳交作業' }));
  await screen.findByText('已收到伺服器繳交紀錄。');
  act(() => navigation.goBack());
  const checkAgain = async (status: RegExp) => {
    const refresh = (await screen.findAllByRole('button', { name: '重新核對繳交紀錄' })).at(-1)!;
    const reads = mockAssignmentBff.mock.calls.filter(([path]) => path === listPath).length;
    fireEvent.press(refresh);
    await screen.findByText(status);
    expect(mockAssignmentBff.mock.calls.filter(([path]) => path === listPath)).toHaveLength(reads + 1);
    expect(screen.queryByText(body)).toBeNull();
  };
  await checkAgain(/^繳交於 /);
  fireEvent.press(screen.getAllByRole('button', { name: /查看作業.*小考報告/ }).at(-1)!);
  fireEvent.press(await screen.findByRole('button', { name: '撤回繳交' }));
  await screen.findByText('已撤回，截止前可以重新繳交。');
  act(() => navigation.goBack());
  await checkAgain(/^尚無繳交紀錄 · 仍在收件$/);
  expect(submitted).toBe(false);
});

test('after opening a namesake from an older list, a spoken receipt question follows that item across navigation', async () => {
  const { course, assignment } = await linkedWorkspaceFixture();
  const secondId = 'cwa_33333333-3333-4333-8333-333333333333';
  const second: NuniAssignment = { ...assignment, id: secondId, dueAt: null, mySubmission: {
    assignmentId: secondId, platformAccountId: account, displayName: '測試學生', state: 'submitted',
    body: '工作區內的私密作答', teacherFeedback: null, reviewedAt: null, submittedAt: '2026-11-03T06:08:09Z',
  } };
  mockAssignmentBff.mockResolvedValue({ assignments: [assignment, second] });
  const navigation = createNavigationContainerRef<PreAuthStackParamList>();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  fireEvent.press(await screen.findByText('現在有課嗎？'));
  fireEvent.press(await screen.findByRole('button', { name: '查這堂課的作業' }));
  fireEvent.press(await screen.findByRole('button', { name: '哪個最急？' }));
  fireEvent.press(await screen.findByRole('button', { name: /查看先前的作業：小考報告，已繳交/ }));
  await screen.findByLabelText('作業繳交區：小考報告');
  expect(navigation.getCurrentRoute()?.params).toMatchObject({ workspaceId: course.id, assignmentId: secondId });
  act(() => navigation.goBack());
  const reads = mockAssignmentBff.mock.calls.length;
  const oldSnapshots = await screen.findAllByText(/^繳交於 .*下午2:08:09/);
  fireEvent.changeText(screen.getByLabelText('詢問校園助理'), '我交了嗎？');
  await act(async () => fireEvent.press(screen.getByText('送出問題')));
  expect(screen.getAllByText(/^繳交於 .*下午2:08:09/)).toHaveLength(oldSnapshots.length + 1);
  expect(screen.queryByText(second.mySubmission!.body)).toBeNull();
  expect(mockAssignmentBff).toHaveBeenCalledTimes(reads);
  fireEvent.press(screen.getByRole('button', { name: /查看作業：小考報告，已繳交/ }));
  expect(navigation.getCurrentRoute()?.params).toMatchObject({ workspaceId: course.id, assignmentId: secondId });
});


test('a confirmed reminder survives a cold start and takes the student to the exact submission area', async () => {
  const { course, other, assignment } = await linkedWorkspaceFixture();
  const scheduled: Notifications.NotificationRequestInput[] = [];
  const permissions = jest.mocked(Notifications.getPermissionsAsync);
  const schedule = jest.mocked(Notifications.scheduleNotificationAsync);
  permissions.mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  schedule.mockImplementation(async (request) => { scheduled.push(request); return request.identifier!; });
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(async () =>
    scheduled as Notifications.NotificationRequest[]);
  const screen = await renderAsync(
    <NuniSessionProvider><NavigationContainer><PreAuthStack /></NavigationContainer></NuniSessionProvider>,
  );
  await fireEventAsync.press(await screen.findByRole('button', { name: '開啟課表助理' }));
  await fireEventAsync.press(await screen.findByText('現在有課嗎？'));
  await fireEventAsync.press(await screen.findByRole('button', { name: '查這堂課的作業' }));
  await fireEventAsync.press(await screen.findByRole('button', { name: '提醒我交這份' }));
  const confirm = await screen.findByRole('button', { name: '確認設定提醒' });
  expect(permissions).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  await fireEventAsync.press(confirm);
  await screen.findByText('已設定這份作業的手機提醒。');
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(scheduled[0].trigger).toMatchObject({ date: new Date('2026-11-06T07:00:00Z') });
  expect(scheduled[0].content.data).toEqual({ category: 'nuni_assignment_due', lookupToken: expect.any(String) });
  await screen.unmountAsync();

  const response = { notification: { request: scheduled[0] }, actionIdentifier: 'default' } as Notifications.NotificationResponse;
  const last = jest.mocked(Notifications.getLastNotificationResponseAsync);
  last.mockResolvedValue(response);
  jest.mocked(Notifications.clearLastNotificationResponseAsync).mockImplementation(async () => { last.mockResolvedValue(null); });
  // A delivered notification is no longer in the OS scheduled queue.
  scheduled.length = 0;
  jest.setSystemTime(new Date('2026-11-06T07:01:00Z'));
  mockStored = JSON.stringify({
    platformAccountId: account, sessionHandle: 'ps_' + 'b'.repeat(43),
    expiresAt: Date.now() + 3_600_000, pendingLogout: false,
  });
  __resetPersonalEventReminderNavigationForTests();
  markPublicNavigationUnready();
  const unhandled = jest.fn();
  mockSchoolSelectionReady = false;
  const app = () => (
    <NuniSessionProvider>
      <PersonalEventReminderBridge />
      <NavigationContainer ref={publicNavigationRef} onReady={markPublicNavigationReady} onUnhandledAction={unhandled}>
        <PreAuthStack />
      </NavigationContainer>
    </NuniSessionProvider>
  );
  const restored = await renderAsync(app());
  try {
    await restored.findByRole('button', { name: '開啟課表助理' });
    expect(publicNavigationRef.getCurrentRoute()?.name).toBe('LoginLanding');
    expect(Notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
    mockSchoolSelectionReady = true;
    await restored.rerenderAsync(app());
    await restored.findByLabelText('作業繳交區：小考報告');
    expect(publicNavigationRef.getCurrentRoute()).toMatchObject({ name: 'NuniWorkspace', params: {
      tab: 'courses', workspaceId: course.id, assignmentId: assignment.id, assistantAccountId: account,
    } });
    expect(restored.getByText(assignment.instructions)).toBeTruthy();
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
    expect([...mockRequest.mock.calls, ...mockAssignmentBff.mock.calls].some(([path]) => path.includes(other.id))).toBe(false);
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    await restored.unmountAsync();
    markPublicNavigationUnready();
    __resetPersonalEventReminderNavigationForTests();
  }
});

test('campus me stack opens the same verified timetable assistant', async () => {
  mockAuthUser = { uid: 'firebase-a', displayName: '同學' };
  const navigation = createNavigationContainerRef();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><MeStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByText('開啟課表助理'));
  await screen.findByText('資料庫管理');
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
});

test('campus me stack workspace header opens the assistant', async () => {
  mockAuthUser = { uid: 'firebase-a', displayName: '同學' };
  const navigation = createNavigationContainerRef();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><MeStack /></NavigationContainer></NuniSessionProvider>,
  );
  fireEvent.press(await screen.findByText('課程、店家與 Google 帳號'));
  fireEvent.press(await screen.findByRole('button', { name: '問課表' }));
  expect(navigation.getCurrentRoute()?.name).toBe('NuniTimetableAssistant');
  await screen.findByText('資料庫管理');
});

test('campus me stack requires a verified nuni session for the timetable assistant', async () => {
  mockAuthUser = { uid: 'firebase-a', displayName: '同學' };
  mockStored = null;
  const navigation = createNavigationContainerRef();
  const screen = render(
    <NuniSessionProvider><NavigationContainer ref={navigation}><MeStack /></NavigationContainer></NuniSessionProvider>,
  );
  await screen.findByText('課程、店家與 Google 帳號');
  expect(screen.queryByText('開啟課表助理')).toBeNull();
  act(() => navigation.navigate('NuniTimetableAssistant' as never));
  await screen.findByRole('button', { name: '前往 nuni 帳號' });
  expect(screen.queryByText('資料庫管理')).toBeNull();
});
