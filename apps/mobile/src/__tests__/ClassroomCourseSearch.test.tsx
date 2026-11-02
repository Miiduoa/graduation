import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ClassroomCourseSearch } from '../screens/ClassroomCourseSearch';
import { ClassroomScreen } from '../screens/ClassroomScreen';

const mockList = jest.fn();
const mockNavigate = jest.fn();
const mockSafeNavigate = jest.fn();
const mockRequest = jest.fn();
const nuniSession = {
  session: { context: 'session-a', platformAccountId: 'pa_1' },
  request: mockRequest,
  loading: false,
  pendingLogout: false,
};

jest.mock('../state/nuniSession', () => ({
  useNuniSession: () => nuniSession,
}));
jest.mock('@campus/shared/src/nuni', () => ({
  createNuniClasses: () => ({ list: mockList }),
}));
jest.mock('../utils/safeNavigate', () => ({
  safeNavigate: (...args: unknown[]) => mockSafeNavigate(...args),
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    tokenExpired: false,
    tokenError: false,
    profile: null,
  }),
}));
jest.mock('../firebase', () => ({
  getDb: jest.fn(),
  getFunctionsInstance: jest.fn(),
  isFirebaseMockMode: () => true,
}));
jest.mock('../hooks/useClassroomSession', () => ({
  useClassroomSession: () => ({
    session: null,
    loading: false,
    isTeacher: false,
    canAttend: false,
    qrToken: null,
    qrExpiresAt: null,
    joined: false,
    receipt: null,
    error: null,
    refresh: jest.fn(),
  }),
}));
jest.mock('../hooks/useClassroomFeed', () => ({
  useClassroomFeed: () => ({ items: [], error: null }),
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [null, jest.fn()],
}));
jest.mock('react-native-qrcode-svg', () => () => null);

const courses = [
  {
    id: 'cw_1',
    title: 'Data 資料庫系統',
    state: 'active' as const,
    memberRole: 'student' as const,
  },
  {
    id: 'cw_2',
    title: '互動設計',
    state: 'active' as const,
    memberRole: 'student' as const,
  },
  {
    id: 'cw_3',
    title: '進階資料庫',
    state: 'active' as const,
    memberRole: 'student' as const,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue(courses);
});

test('ClassroomScreen with q prefilters unique, multi and zero matches', async () => {
  const unique = render(
    <ClassroomScreen
      navigation={{ navigate: mockNavigate }}
      route={{ params: { q: '互動設計' } }}
    />,
  );
  await waitFor(() => expect(unique.getByTestId('classroom-query-unique')).toBeTruthy());
  expect(String(unique.getByTestId('classroom-query-status-unique').props.children)).toContain(
    '剛好找到',
  );
  unique.unmount();

  const multi = render(
    <ClassroomCourseSearch query="資料庫" navigation={{ navigate: mockNavigate }} />,
  );
  await waitFor(() => expect(multi.getByTestId('classroom-query-status-multi')).toBeTruthy());
  expect(multi.getByText('Data 資料庫系統')).toBeTruthy();
  expect(multi.getByText('進階資料庫')).toBeTruthy();
  multi.unmount();

  const none = render(
    <ClassroomCourseSearch query="不存在的課程" navigation={{ navigate: mockNavigate }} />,
  );
  await waitFor(() => expect(none.getByTestId('classroom-query-none')).toBeTruthy());
  expect(none.getByText('加入課程')).toBeTruthy();
  await act(async () => {
    fireEvent.press(none.getByText('全部課程'));
  });
  await waitFor(() => expect(none.getByText('Data 資料庫系統')).toBeTruthy());
});
