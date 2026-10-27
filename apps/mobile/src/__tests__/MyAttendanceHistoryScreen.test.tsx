import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import MyAttendanceHistoryScreen from '../screens/MyAttendanceHistoryScreen';
import { loadMyVerifiedAttendanceHistory } from '../services/verifiedAttendanceHistory';
import { safeNavigate } from '../utils/safeNavigate';

let mockAuth = { user: { uid: 'student-a' }, profile: { schoolId: 'school-a' }, loading: false };
jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'school-a' } }) }));
jest.mock('../ui/courseChipShell', () => ({ courseChipScrollContentStyle: () => ({}) }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}) }));
jest.mock('../services/verifiedAttendanceHistory', () => ({
  loadMyVerifiedAttendanceHistory: jest.fn(),
  summarizeVerifiedAttendance: (courses: Array<{ sessions: Array<{ status: string }> }>) => {
    const sessions = courses.flatMap((course) => course.sessions);
    return {
      sessions: sessions.length,
      confirmed: sessions.filter((row) => row.status === 'present' || row.status === 'late').length,
      excused: sessions.filter((row) => row.status === 'excused').length,
      absent: sessions.filter((row) => row.status === 'absent').length,
      unconfirmed: sessions.filter((row) => row.status === 'unconfirmed').length,
      unavailable: sessions.filter((row) => row.status === 'unavailable').length,
    };
  },
}));

const course = {
  courseId: 'course-a',
  courseName: '資料結構',
  error: false,
  sessions: [
    {
      sessionId: 'session-1',
      active: false,
      startedAt: new Date('2026-10-27T01:00:00Z'),
      status: 'present' as const,
      checkedInAt: new Date('2026-10-27T01:03:00Z'),
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'student-a' }, profile: { schoolId: 'school-a' }, loading: false };
  jest.mocked(loadMyVerifiedAttendanceHistory).mockResolvedValue([course]);
});

test('shows only confirmed session counts and routes to the real course', async () => {
  const view = render(<MyAttendanceHistoryScreen />);
  expect(await view.findByText('資料結構')).toBeTruthy();
  expect(view.getByText('已確認的簽到')).toBeTruthy();
  expect(loadMyVerifiedAttendanceHistory).toHaveBeenCalledWith('student-a', 'school-a');
  fireEvent.press(view.getByLabelText('展開資料結構點名紀錄'));
  expect(view.getByText('已確認簽到')).toBeTruthy();
  fireEvent.press(view.getByText('前往課堂簽到'));
  expect(safeNavigate).toHaveBeenCalledWith({}, 'AttendanceMultiMethod', { courseId: 'course-a' });
});

test('a missing receipt is not shown as attendance or absence', async () => {
  jest.mocked(loadMyVerifiedAttendanceHistory).mockResolvedValue([
    { ...course, sessions: [{ ...course.sessions[0], status: 'unconfirmed', checkedInAt: null }] },
  ]);
  const view = render(<MyAttendanceHistoryScreen />);
  await view.findByText('資料結構');
  fireEvent.press(view.getByLabelText('展開資料結構點名紀錄'));
  expect(view.getByText('尚無簽到紀錄')).toBeTruthy();
  expect(view.queryByText('已登記缺席')).toBeNull();
});

test('stale account responses cannot appear after switching the login', async () => {
  let finish!: (result: [typeof course]) => void;
  jest.mocked(loadMyVerifiedAttendanceHistory).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve; }),
  );
  const view = render(<MyAttendanceHistoryScreen />);
  mockAuth = { user: { uid: 'student-b' }, profile: { schoolId: 'school-a' }, loading: false };
  jest.mocked(loadMyVerifiedAttendanceHistory).mockResolvedValueOnce([]);
  view.rerender(<MyAttendanceHistoryScreen />);
  await view.findByText('目前沒有可驗證的課堂點名');
  await act(async () => finish([course]));
  expect(view.queryByText('資料結構')).toBeNull();
});
