import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import LearnAiFirstScreen from '../screens/LearnAiFirstScreen';
import MeAiFirstScreen from '../screens/MeAiFirstScreen';
import OnBusModeScreen from '../screens/OnBusModeScreen';
import { loadStudentHome } from '../data/studentHome';
import { firebaseSource } from '../data/firebaseSource';
import { isFirebaseMockMode } from '../firebase';
import { safeNavigate } from '../utils/safeNavigate';
import type { BusRoute, CourseSpace, InboxTask } from '../data/types';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
let mockRoute = {
  params: { routeId: 'route-1', vehicleId: 'unverified-vehicle', alightStopId: 'stop-2' },
};
let mockAuth: {
  user: { uid: string; email: string; displayName?: string } | null;
  profile: {
    uid: string;
    schoolId: string;
    role: string;
    displayName: string;
    department?: string;
    studentId?: string;
  } | null;
  profileLoading: boolean;
  signOutWithWarning: jest.Mock;
};

jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ isStudent: true }) }));
jest.mock('../data/studentHome', () => ({ loadStudentHome: jest.fn() }));
jest.mock('../data/firebaseSource', () => ({ firebaseSource: { listBusRoutes: jest.fn() } }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: jest.fn(() => false) }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), impactAsync: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

function home(name = '實際課程') {
  const course: CourseSpace = {
    id: 'course-1',
    groupId: 'group-1',
    name,
    unreadCount: 0,
    assignmentCount: 0,
    dueSoonCount: 0,
    quizCount: 0,
    moduleCount: 0,
    activeSessionId: null,
    latestDueAt: null,
  };
  return { courses: [course], tasks: [] as InboxTask[] };
}
function bus(name = '學校發布的路線'): BusRoute {
  return {
    id: 'route-1',
    name,
    schedule: [],
    stops: [
      { id: 'stop-1', name: '起點站', lat: 24, lng: 120, order: 0 },
      { id: 'stop-2', name: '目的地站', lat: 24.01, lng: 120.01, order: 1 },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { uid: 'student-a', email: 'student-a@example.edu' },
    profile: {
      uid: 'student-a',
      schoolId: 'school-a',
      role: 'student',
      displayName: '陳同學',
      department: '資訊系',
      studentId: 'A123',
    },
    profileLoading: false,
    signOutWithWarning: jest.fn().mockResolvedValue(true),
  };
  mockRoute = {
    params: { routeId: 'route-1', vehicleId: 'unverified-vehicle', alightStopId: 'stop-2' },
  };
  jest.mocked(loadStudentHome).mockResolvedValue(home());
  jest.mocked(firebaseSource.listBusRoutes).mockResolvedValue([bus()]);
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('learning lists real memberships and navigates using their group IDs, never a sample course', async () => {
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('實際課程');
  expect(loadStudentHome).toHaveBeenCalledWith('student-a', 'school-a');
  expect(view.queryByText(/今天 3 堂課|Lab 3|即時運算|週一 · 共 3 堂/)).toBeNull();
  fireEvent.press(view.getByText('課程成績'));
  expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'CourseGradebook', {
    groupId: 'group-1',
    groupName: '實際課程',
    sourceSystem: 'workspace',
  });
  fireEvent.press(view.getByText('課程動態'));
  expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'GroupDetail', {
    groupId: 'group-1',
  });
});

test('learning failures expose retry and do not become a zero-work success', async () => {
  jest.mocked(loadStudentHome).mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('無法讀取課程與待辦，請確認登入狀態與網路後重試。');
  expect(view.queryByText(/尚未加入課程|目前沒有可列出/)).toBeNull();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('實際課程');
});

test('learning masks old account data synchronously and ignores its pending response', async () => {
  const old = deferred<ReturnType<typeof home>>();
  const next = deferred<ReturnType<typeof home>>();
  jest.mocked(loadStudentHome).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<LearnAiFirstScreen />);
  mockAuth.user = { uid: 'student-b', email: 'student-b@example.edu' };
  mockAuth.profile = {
    uid: 'student-b',
    schoolId: 'school-b',
    role: 'student',
    displayName: '新同學',
  };
  view.rerender(<LearnAiFirstScreen />);
  await act(async () => old.resolve(home('舊帳號課程')));
  expect(view.queryByText('舊帳號課程')).toBeNull();
  await act(async () => next.resolve(home('新帳號課程')));
  expect(view.getByText('新帳號課程')).toBeTruthy();
});

test('learning excludes tasks outside current memberships and opens a verified session ID', async () => {
  const result = home();
  result.tasks = [
    {
      id: 'live-1',
      groupId: 'group-1',
      groupName: '實際課程',
      kind: 'live',
      title: '進行中的點名',
      subtitle: '',
      priority: 0,
      sessionId: 'session-1',
    },
    {
      id: 'foreign',
      groupId: 'other-group',
      groupName: '其他課程',
      kind: 'assignment',
      title: '不可列出的任務',
      subtitle: '',
      priority: 0,
    },
  ];
  jest.mocked(loadStudentHome).mockResolvedValue(result);
  const view = render(<LearnAiFirstScreen />);
  await view.findByText('進行中的點名');
  expect(view.queryByText('不可列出的任務')).toBeNull();
  fireEvent.press(view.getByText('進行中的點名'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'Classroom', {
    groupId: 'group-1',
    groupName: '實際課程',
    sessionId: 'session-1',
  });
});

test('bus uses published school routes without pretending to know a vehicle position or arrival', async () => {
  const share = jest.spyOn(Share, 'share');
  const view = render(<OnBusModeScreen />);
  await view.findByText('學校發布的路線');
  expect(firebaseSource.listBusRoutes).toHaveBeenCalledWith('school-a');
  expect(view.getByText('預計下車：目的地站')).toBeTruthy();
  expect(view.getByText('目前未提供車輛即時追蹤')).toBeTruthy();
  expect(view.queryByText(/目前往|分鐘抵達|已到站|分享位置|司機 ·/)).toBeNull();
  jest.useFakeTimers();
  act(() => jest.advanceTimersByTime(120000));
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  jest.useRealTimers();
  fireEvent.press(view.getByText('起點站'));
  expect(view.getByText('預計下車：起點站')).toBeTruthy();
});

test('a bus route absent from the backend never falls back to a bundled campus simulation', async () => {
  mockRoute.params.routeId = 'campus-a';
  jest.mocked(firebaseSource.listBusRoutes).mockResolvedValue([]);
  const view = render(<OnBusModeScreen />);
  await view.findByText('找不到可用的路線資料');
  expect(view.queryByText(/校園 A|下一站|車牌/)).toBeNull();
});

test('bus errors remain errors and a school change removes previously loaded route information', async () => {
  const view = render(<OnBusModeScreen />);
  await view.findByText('學校發布的路線');
  jest.mocked(firebaseSource.listBusRoutes).mockRejectedValueOnce(new Error('offline'));
  mockAuth.profile = { ...mockAuth.profile!, schoolId: 'school-b' };
  view.rerender(<OnBusModeScreen />);
  expect(view.queryByText('學校發布的路線')).toBeNull();
  await view.findByText('目前無法讀取這條路線，請確認登入狀態與網路後重試。');
  expect(view.queryByText('預計下車：目的地站')).toBeNull();
});

test('mock Firebase mode cannot turn on bus tracking or read live routes', async () => {
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  const view = render(<OnBusModeScreen />);
  await view.findByText('目前無法讀取這條路線，請確認登入狀態與網路後重試。');
  expect(firebaseSource.listBusRoutes).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('my account uses the signed-in profile without invented grades, identity or demo tools', () => {
  const view = render(<MeAiFirstScreen />);
  expect(view.getByText('陳同學')).toBeTruthy();
  expect(view.getByText('資訊系 · 學號 A123')).toBeTruthy();
  expect(view.getByText('student-a@example.edu')).toBeTruthy();
  expect(view.queryByText(/王小明|3\.63|61%|78|明年 6 月|seed|示範工具|12 場/)).toBeNull();
  fireEvent.press(view.getByText('課程與成績'));
  expect(safeNavigate).toHaveBeenCalledWith(mockNavigation, 'LearnHome');
  fireEvent.press(view.getByText('個人資料'));
  expect(safeNavigate).toHaveBeenLastCalledWith(mockNavigation, 'ProfileEdit');
});

test('confirming logout calls the real sign-out flow without navigating to a fake login state', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<MeAiFirstScreen />);
  fireEvent.press(view.getByText('登出'));
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '登出')?.onPress?.());
  expect(mockAuth.signOutWithWarning).toHaveBeenCalledTimes(1);
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('a logout confirmation belonging to an old account cannot sign out the new account', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const view = render(<MeAiFirstScreen />);
  fireEvent.press(view.getByText('登出'));
  const confirm = alert.mock.calls[0][2]?.find((item) => item.text === '登出')?.onPress;
  mockAuth.user = { uid: 'student-b', email: 'student-b@example.edu' };
  view.rerender(<MeAiFirstScreen />);
  expect(view.queryByText('陳同學')).toBeNull();
  expect(view.queryByText('資訊系 · 學號 A123')).toBeNull();
  await act(async () => confirm?.());
  expect(mockAuth.signOutWithWarning).not.toHaveBeenCalled();
});

test('a rejected sign-out stays on the account page and reports the failure', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  mockAuth.signOutWithWarning.mockRejectedValueOnce(new Error('offline'));
  const view = render(<MeAiFirstScreen />);
  fireEvent.press(view.getByText('登出'));
  await act(async () => alert.mock.calls[0][2]?.find((item) => item.text === '登出')?.onPress?.());
  expect(alert).toHaveBeenLastCalledWith('無法登出', '請稍後重試。');
  expect(view.getByText('陳同學')).toBeTruthy();
  expect(safeNavigate).not.toHaveBeenCalled();
});
