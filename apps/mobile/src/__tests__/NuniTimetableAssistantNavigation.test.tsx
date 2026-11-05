import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native/pure';
import { NuniSessionProvider } from '../state/nuniSession';
import { PreAuthStack } from '../screens/PreAuthStack';
import type { PreAuthStackParamList } from '../screens/preAuthTypes';
import { personalImportStorageKey } from '../services/personalImports';
import type { StoredTimetable } from '../services/personalTimetable';

const account = 'pa_11111111-1111-4111-8111-111111111111';
const mockSchool = { id: 'pu', name: '靜宜大學' };
let mockStored: string | null;
const mockRequest = jest.fn();
const mockAssignmentBff = jest.fn();
jest.unmock('@react-navigation/native');
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
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
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
afterEach(() => {
  cleanup();
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

test('the assistant opens the exact assignment in the linked workspace even when another joined class has the same name', async () => {
  const course = {
    id: 'cw_11111111-1111-4111-8111-111111111111', title: '資料庫管理', memberRole: 'student', state: 'active',
  };
  const other = { ...course, id: 'cw_22222222-2222-4222-8222-222222222222' };
  const assignment = {
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
