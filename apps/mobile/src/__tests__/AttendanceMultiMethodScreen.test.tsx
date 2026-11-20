import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import AttendanceMultiMethodScreen from '../screens/AttendanceMultiMethodScreen';
import { listAttendanceSessions } from '../data/courseSpaceSource';
import { safeNavigate } from '../utils/safeNavigate';

let mockAuth = { user: { uid: 'student-a' }, profile: { schoolId: 'school-a' } };
let mockSchoolId = 'school-a';
jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId } }) }));
jest.mock('../data/courseSpaceSource', () => ({ listAttendanceSessions: jest.fn() }));
jest.mock('../data/demoCoursesAdapter', () => ({ isDemoCourseId: (id: string) => id === '71378' }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}) }));
jest.mock('../ui/courseChipShell', () => ({ courseChipScrollContentStyle: () => ({}) }));
jest.mock('../ui/components', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ title, subtitle, children }) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, title),
        React.createElement(Text, null, subtitle),
        children,
      ),
    Button: ({ text, onPress }) =>
      React.createElement(
        Pressable,
        { onPress, accessibilityRole: 'button' },
        React.createElement(Text, null, text),
      ),
    LoadingState: ({ subtitle }) => React.createElement(Text, null, subtitle),
  };
});

const session = {
  id: 'live-1',
  groupId: 'course-a',
  groupName: '正式課程',
  active: true,
  startedAt: new Date('2026-10-23T10:00:00Z'),
  endedAt: null,
  source: 'attendance' as const,
  attendeeCount: 3,
};
const route = { params: { courseId: 'course-a', sessionId: 'live-1' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { uid: 'student-a' }, profile: { schoolId: 'school-a' } };
  mockSchoolId = 'school-a';
  jest.mocked(listAttendanceSessions).mockResolvedValue([session]);
});

test('a verified workspace session opens the real classroom without submitting a legacy claim', async () => {
  const view = render(<AttendanceMultiMethodScreen route={route} />);
  fireEvent.press(await view.findByText('進入課堂簽到'));
  expect(listAttendanceSessions).toHaveBeenCalledWith('student-a', 'course-a', 'school-a');
  expect(safeNavigate).toHaveBeenCalledWith({}, 'Classroom', {
    groupId: 'course-a',
    groupName: '正式課程',
    sessionId: 'live-1',
  });
  expect(view.queryByLabelText('QR 簽到 token')).toBeNull();
  expect(view.queryByText('送出簽到')).toBeNull();
  expect(httpsCallable).not.toHaveBeenCalled();
});

test.each(['', 'demo', '71378', 'tc:123'])(
  'unsupported course %s remains explicitly unavailable',
  async (courseId) => {
    const view = render(
      <AttendanceMultiMethodScreen route={{ params: { courseId, sessionId: 'demo-live' } }} />,
    );
    await view.findByText('目前沒有可用的課堂簽到');
    expect(view.queryByText('進入課堂簽到')).toBeNull();
    expect(listAttendanceSessions).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  },
);

test.each([
  { ...session, groupId: 'another-course' },
  { ...session, id: 'another-session' },
  { ...session, active: false },
  { ...session, sourceSystem: 'tronclass' as const },
])(
  'a mismatched, ended or external session cannot become a classroom action: %j',
  async (record) => {
    jest.mocked(listAttendanceSessions).mockResolvedValue([record]);
    const view = render(<AttendanceMultiMethodScreen route={route} />);
    await view.findByText('目前沒有可用的課堂簽到');
    expect(view.queryByText('進入課堂簽到')).toBeNull();
    expect(safeNavigate).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  },
);

test('account and school changes reject the previous pending classroom response', async () => {
  let resolve!: (sessions: (typeof session)[]) => void;
  jest.mocked(listAttendanceSessions).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<AttendanceMultiMethodScreen route={route} />);
  mockAuth = { user: { uid: 'student-b' }, profile: { schoolId: 'school-b' } };
  mockSchoolId = 'school-b';
  jest.mocked(listAttendanceSessions).mockResolvedValueOnce([]);
  view.rerender(<AttendanceMultiMethodScreen route={route} />);
  await view.findByText('目前沒有可用的課堂簽到');
  await act(async () => resolve([session]));
  expect(view.queryByText('進入課堂簽到')).toBeNull();
  expect(view.queryByText('正式課程')).toBeNull();
  expect(listAttendanceSessions).toHaveBeenLastCalledWith('student-b', 'course-a', 'school-b');
});

test('a failed refresh removes the prior classroom action instead of reporting an empty successful response', async () => {
  const view = render(<AttendanceMultiMethodScreen route={route} />);
  await view.findByText('進入課堂簽到');
  jest.mocked(listAttendanceSessions).mockRejectedValueOnce(new Error('permission-denied'));
  fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
  await view.findByText('無法讀取點名紀錄');
  expect(view.queryByText('進入課堂簽到')).toBeNull();
  expect(view.queryByText('目前沒有可用的課堂簽到')).toBeNull();
  expect(httpsCallable).not.toHaveBeenCalled();
});
