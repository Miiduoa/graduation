import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { safeNavigate } from '../utils/safeNavigate';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ isTeacher: false, isAdmin: false, isDepartmentHead: false }),
}));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../services/gamificationEngine', () => ({ earnXP: jest.fn() }));
jest.mock('../services/smartAttendanceEngine', () => ({
  getAttendanceCourses: jest.fn(async () => []),
  getActiveSessions: jest.fn(async () => []),
  getActiveSessionsForStudent: jest.fn(async () => []),
  getAllSessions: jest.fn(async () => []),
  getStudentAnalytics: jest.fn(async () => ({ overallRate: 0 })),
  getLeaveRequests: jest.fn(async () => []),
  getHighRiskStudents: jest.fn(async () => []),
}));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])(
  'an empty attendance list opens native courses without requesting school login (teacher: %s)',
  async (isTeacher) => {
    const navigation = { navigate: jest.fn() };
    const view = render(
      <AttendanceScreen navigation={navigation} route={{ params: { isTeacher } }} />,
    );
    const openCourses = await view.findByRole('button', { name: '前往 nuni 課程' });
    expect(view.queryByText(/登入 E 校園|學校帳號|重新連線/)).toBeNull();
    fireEvent.press(openCourses);
    expect(safeNavigate).toHaveBeenCalledWith(navigation, 'NuniWorkspace', { tab: 'courses' });
  },
);
