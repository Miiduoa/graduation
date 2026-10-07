import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import TeacherTodayScreen from '../screens/TeacherTodayScreen';
import { loadTeacherHome } from '../data/teacherHome';
import { startAttendanceSession } from '../data/courseSpaceSource';
import { safeNavigate } from '../utils/safeNavigate';

let mockAuth = {
  user: { uid: 'teacher-a' },
  profile: { schoolId: 'school-a', role: 'teacher', roleGroup: 'teacher' },
};
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'school-a' } }) }));
jest.mock('../data/teacherHome', () => ({ loadTeacherHome: jest.fn() }));
jest.mock('../data/courseSpaceSource', () => ({ startAttendanceSession: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'attendance-request-1' }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

function result(name = '教師 A 的課程') {
  return {
    courses: [{ id: name, groupId: name, name, role: 'instructor' }],
    tasks: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    user: { uid: 'teacher-a' },
    profile: { schoolId: 'school-a', role: 'teacher', roleGroup: 'teacher' },
  };
  jest.mocked(loadTeacherHome).mockResolvedValue(result());
});

test('replacing the account immediately hides the previous teacher course and ignores late responses', async () => {
  const lateA = deferred<ReturnType<typeof result>>();
  const loadB = deferred<ReturnType<typeof result>>();
  const view = render(<TeacherTodayScreen />);
  await view.findByText('教師 A 的課程');
  jest
    .mocked(loadTeacherHome)
    .mockReturnValueOnce(lateA.promise)
    .mockReturnValueOnce(loadB.promise);
  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  mockAuth = { ...mockAuth, user: { uid: 'teacher-b' } };
  view.rerender(<TeacherTodayScreen />);
  expect(view.queryByText('教師 A 的課程')).toBeNull();
  await act(async () => {
    lateA.resolve(result('過期回應'));
  });
  expect(view.queryByText('過期回應')).toBeNull();
  await act(async () => {
    loadB.resolve(result('教師 B 的課程'));
  });
  expect(view.getByText('教師 B 的課程')).toBeTruthy();
});

test('changing school under the same account cannot keep previous school results', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  const view = render(<TeacherTodayScreen />);
  await view.findByText('教師 A 的課程');
  jest.mocked(loadTeacherHome).mockReturnValueOnce(pending.promise);
  mockAuth = { ...mockAuth, profile: { ...mockAuth.profile, schoolId: 'school-b' } };
  view.rerender(<TeacherTodayScreen />);
  expect(view.queryByText('教師 A 的課程')).toBeNull();
  await act(async () => {
    pending.resolve(result('新學校課程'));
  });
  expect(loadTeacherHome).toHaveBeenLastCalledWith('teacher-a', 'school-b');
  expect(view.getByText('新學校課程')).toBeTruthy();
});

test('a refresh permission failure removes old actions and offers a retry', async () => {
  const view = render(<TeacherTodayScreen />);
  await view.findByText('教師 A 的課程');
  jest.mocked(loadTeacherHome).mockRejectedValueOnce(new Error('permission-denied'));
  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  await view.findByText('無法讀取教學資料。請確認登入狀態與網路連線後重試。');
  expect(view.queryByText('教師 A 的課程')).toBeNull();
  expect(view.queryByText('尚未加入授課課程')).toBeNull();
  fireEvent.press(view.getByText('重新讀取'));
  await view.findByText('教師 A 的課程');
});

test('starting attendance prevents duplicate taps, retries the same request and opens only the confirmed session', async () => {
  const attempt = deferred<Awaited<ReturnType<typeof startAttendanceSession>>>();
  jest.mocked(startAttendanceSession).mockReturnValueOnce(attempt.promise);
  const view = render(<TeacherTodayScreen />);
  const button = await view.findByRole('button', { name: '教師 A 的課程，開始點名' });
  fireEvent.press(button);
  fireEvent.press(button);
  expect(startAttendanceSession).toHaveBeenCalledTimes(1);
  expect(safeNavigate).not.toHaveBeenCalled();
  await act(async () => {
    attempt.reject(new Error('timeout'));
  });
  await view.findByText('無法開始「教師 A 的課程」的點名，請確認連線後重試。');
  jest.mocked(startAttendanceSession).mockResolvedValueOnce({ success: true, sessionId: 'live-1' });
  fireEvent.press(view.getByRole('button', { name: '教師 A 的課程，開始點名' }));
  await waitFor(() =>
    expect(safeNavigate).toHaveBeenCalledWith({}, 'Classroom', {
      groupId: '教師 A 的課程',
      groupName: '教師 A 的課程',
      sessionId: 'live-1',
    }),
  );
  expect(jest.mocked(startAttendanceSession).mock.calls[0][0]).toEqual(
    jest.mocked(startAttendanceSession).mock.calls[1][0],
  );
});

test('a late attendance response after account switch never opens the old teacher session', async () => {
  const pending = deferred<Awaited<ReturnType<typeof startAttendanceSession>>>();
  jest.mocked(startAttendanceSession).mockReturnValueOnce(pending.promise);
  const view = render(<TeacherTodayScreen />);
  fireEvent.press(await view.findByRole('button', { name: '教師 A 的課程，開始點名' }));
  mockAuth = { ...mockAuth, user: { uid: 'teacher-b' } };
  jest.mocked(loadTeacherHome).mockResolvedValueOnce(result('教師 B 的課程'));
  view.rerender(<TeacherTodayScreen />);
  await view.findByText('教師 B 的課程');
  await act(async () => {
    pending.resolve({ success: true, sessionId: 'old-live' });
  });
  expect(safeNavigate).not.toHaveBeenCalled();
});

test('a workspace gradebook link retains its data source when other LMS providers are configured', async () => {
  const view = render(<TeacherTodayScreen />);
  fireEvent.press(await view.findByRole('button', { name: '教師 A 的課程，成績簿' }));
  expect(safeNavigate).toHaveBeenCalledWith({}, 'CourseGradebook', {
    groupId: '教師 A 的課程',
    groupName: '教師 A 的課程',
    sourceSystem: 'workspace',
  });
});
