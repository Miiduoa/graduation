import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationsAiFirstScreen from '../screens/NotificationsAiFirstScreen';
import { navigateFromInboxTask } from '../services/inboxActions';

const mockNavigate = { navigate: jest.fn(), goBack: jest.fn() };
const mockNotifs = {
  notifications: [] as Array<Record<string, unknown>>,
  unreadCount: 0,
  loading: false,
  error: null as string | null,
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  reload: jest.fn(),
};

jest.mock('../state/auth', () => ({
  useAuth: () => ({ profile: { role: 'student' } }),
}));
jest.mock('../state/notifications', () => ({
  useNotifications: () => mockNotifs,
}));
jest.mock('../services/inboxActions', () => ({
  navigateFromInboxTask: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigate,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifs.notifications = [];
  mockNotifs.unreadCount = 0;
  mockNotifs.loading = false;
  mockNotifs.error = null;
});

test('does not render hardcoded sample notifications when the inbox is empty', () => {
  const view = render(<NotificationsAiFirstScreen />);
  expect(view.getByText('目前沒有通知')).toBeTruthy();
  expect(view.queryByText('陳老師（資料庫）')).toBeNull();
  expect(view.queryByText('今天 12 則通知')).toBeNull();
});

test('opens an assignment notification with its ids instead of a class feed', async () => {
  mockNotifs.notifications = [
    {
      id: 'n1',
      type: 'assignment',
      title: '期末報告截止',
      body: '請於週五前繳交',
      read: false,
      createdAt: '2026-10-19T02:00:00.000Z',
      data: { groupId: 'course-a', assignmentId: 'homework-a', groupName: '資料結構' },
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  expect(view.getByText('期末報告截止')).toBeTruthy();
  expect(view.queryByText('陳老師延長期末報告')).toBeNull();
  fireEvent.press(view.getByText('期末報告截止'));
  await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledWith('n1'));
  expect(navigateFromInboxTask).toHaveBeenCalledWith(
    mockNavigate,
    expect.objectContaining({
      kind: 'assignment',
      groupId: 'course-a',
      assignmentId: 'homework-a',
    }),
    { role: 'student', isTeachingRole: false },
  );
});
