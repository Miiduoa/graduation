import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AttendanceLiveScreen from '../screens/AttendanceLiveScreen';
import { SESSION_FOCUS_MISSING } from '../screens/sessionDeepLink';
import { getSessionById, subscribeToSession } from '../services/smartAttendanceEngine';

jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: { uid: 'student-a', displayName: '同學' },
    profile: { displayName: '同學' },
  }),
}));
jest.mock('../ui/useThemeStyleSheet', () => ({
  useThemeStyleSheet: (create: (theme: unknown) => unknown) =>
    create(require('../ui/theme').theme),
}));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));
jest.mock('../ui/PureQRCode', () => ({ PureQRCode: () => null }));
jest.mock('../services/gamificationEngine', () => ({ earnXP: jest.fn() }));
jest.mock('../services/smartAttendanceEngine', () => ({
  getSessionById: jest.fn(),
  checkIn: jest.fn(),
  endSession: jest.fn(),
  generateRotatingQR: jest.fn(() => 'qr'),
  subscribeToSession: jest.fn(() => jest.fn()),
  updateStudentStatus: jest.fn(),
  getStatusColor: () => '#0a0',
  getStatusLabel: (status: string) => status,
}));

const session = {
  id: 'live-1',
  courseId: 'course-a',
  courseName: '資料結構',
  courseCode: 'CS101',
  teacherId: 'teacher-a',
  teacherName: '王老師',
  sessionDate: '2026-11-02',
  startTime: Date.now() - 60_000,
  endTime: null,
  location: '教室',
  mode: 'number_code' as const,
  status: 'active' as const,
  qrSecret: 'secret',
  numberCode: '123456',
  lateThresholdMinutes: 10,
  totalStudents: 1,
  presentCount: 0,
  lateCount: 0,
  absentCount: 1,
  excusedCount: 0,
  records: [
    {
      studentId: 'student-a',
      studentName: '同學',
      status: 'absent' as const,
      checkInTime: null,
    },
  ],
  createdAt: Date.now(),
};

const navigation = { goBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSessionById).mockResolvedValue(session);
  jest.mocked(subscribeToSession).mockImplementation((_id, cb) => {
    cb(session);
    return jest.fn();
  });
});

test('帶有效 sessionId 時載入並顯示該場點名', async () => {
  const view = render(
    <AttendanceLiveScreen
      route={{ params: { sessionId: 'live-1', isTeacher: false } }}
      navigation={navigation}
    />,
  );
  await waitFor(() => expect(view.getAllByText('資料結構').length).toBeGreaterThan(0));
  expect(view.queryByText(SESSION_FOCUS_MISSING)).toBeNull();
  expect(getSessionById).toHaveBeenCalledWith('live-1');
});

test('sessionId 無效時給友善提示且不壞頁', async () => {
  const view = render(
    <AttendanceLiveScreen
      route={{ params: { sessionId: '../bad', isTeacher: false } }}
      navigation={navigation}
    />,
  );
  await waitFor(() => expect(view.getByText(SESSION_FOCUS_MISSING)).toBeTruthy());
  expect(getSessionById).not.toHaveBeenCalled();
});

test('載入中不誤報找不到；載入後找不到場次才提示', async () => {
  let resolveSession: (value: typeof session | null) => void = () => {};
  jest.mocked(getSessionById).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
  );
  jest.mocked(subscribeToSession).mockReturnValue(jest.fn());

  const view = render(
    <AttendanceLiveScreen
      route={{ params: { sessionId: 'missing-live', isTeacher: true } }}
      navigation={navigation}
    />,
  );
  expect(view.getByText('載入點名資料...')).toBeTruthy();
  expect(view.queryByText(SESSION_FOCUS_MISSING)).toBeNull();

  await act(async () => {
    resolveSession(null);
  });
  await waitFor(() => expect(view.getByText(SESSION_FOCUS_MISSING)).toBeTruthy());
});

test('isTeacher 字串 true 仍顯示老師結束點名操作', async () => {
  const view = render(
    <AttendanceLiveScreen
      route={{ params: { sessionId: 'live-1', isTeacher: 'true' as unknown as boolean } }}
      navigation={navigation}
    />,
  );
  await waitFor(() => expect(view.getByText('結束點名')).toBeTruthy());
});
