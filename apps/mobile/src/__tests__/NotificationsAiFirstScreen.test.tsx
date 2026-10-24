import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationsAiFirstScreen from '../screens/NotificationsAiFirstScreen';
import { applyNotificationDestination } from '../utils/applyNotificationDestination';

const mockAuth = {
  user: { uid: 'alice' } as { uid: string } | null,
  profile: { role: 'student' as const, schoolId: 'pu', uid: 'alice' },
};
const mockNavigate = { navigate: jest.fn(), goBack: jest.fn() };
const mockNotifs = {
  notifications: [] as Array<Record<string, unknown>>,
  unreadCount: 0,
  unreadScope: 'loaded' as const,
  loading: false,
  loadingMore: false,
  hasMore: false,
  error: null as string | null,
  markAsRead: jest.fn(async () => true),
  markAllAsRead: jest.fn(async () => true),
  loadMore: jest.fn(async () => undefined),
  reload: jest.fn(),
};

jest.mock('../state/auth', () => ({
  useAuth: () => mockAuth,
}));
jest.mock('../state/notifications', () => ({
  useNotifications: () => mockNotifs,
}));
jest.mock('../utils/applyNotificationDestination', () => ({
  applyNotificationDestination: jest.fn(() => true),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigate,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { uid: 'alice' };
  mockAuth.profile = { role: 'student', schoolId: 'pu', uid: 'alice' };
  mockNotifs.notifications = [];
  mockNotifs.unreadCount = 0;
  mockNotifs.hasMore = false;
  mockNotifs.loading = false;
  mockNotifs.error = null;
  mockNotifs.markAsRead.mockResolvedValue(true);
});

test('does not render hardcoded sample notifications when the inbox is empty', () => {
  const view = render(<NotificationsAiFirstScreen />);
  expect(view.getByText('目前沒有通知')).toBeTruthy();
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
  fireEvent.press(view.getByText('期末報告截止'));
  await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledWith('n1'));
  expect(applyNotificationDestination).toHaveBeenCalledWith(
    expect.objectContaining({
      ok: true,
      mode: 'inboxTask',
      task: expect.objectContaining({
        kind: 'assignment',
        groupId: 'course-a',
        assignmentId: 'homework-a',
      }),
    }),
    expect.objectContaining({ role: 'student' }),
  );
});

test('opens message / event / announcement without inventing destinations', async () => {
  mockNotifs.notifications = [
    {
      id: 'm1',
      type: 'message',
      title: '新訊息',
      body: '你好',
      read: false,
      data: { peerId: 'peer-9' },
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('新訊息'));
  await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledWith('m1'));
  expect(applyNotificationDestination).toHaveBeenCalledWith(
    expect.objectContaining({
      ok: true,
      mode: 'nested',
      screen: 'Chat',
      params: { kind: 'dm', peerId: 'peer-9' },
    }),
    expect.any(Object),
  );
});

test('markAsRead false keeps unread and does not navigate', async () => {
  mockNotifs.markAsRead.mockResolvedValue(false);
  mockNotifs.notifications = [
    {
      id: 'n-fail',
      type: 'message',
      title: '讀取會失敗',
      body: '',
      read: false,
      data: { peerId: 'peer-1' },
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('讀取會失敗'));
  await waitFor(() => expect(view.getByText(/標為已讀失敗/)).toBeTruthy());
  expect(applyNotificationDestination).not.toHaveBeenCalled();
});

test('manual mark-read failure preserves explanation and unread notice', async () => {
  mockNotifs.notifications = [
    {
      id: 'bad',
      type: 'library_due',
      title: '圖書館催還',
      body: '請盡快還書',
      read: false,
      data: {},
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('圖書館催還'));
  await waitFor(() => expect(view.getByText(/尚不支援開啟/)).toBeTruthy());
  mockNotifs.markAsRead.mockResolvedValueOnce(false);
  fireEvent.press(view.getByText('標成已讀'));
  await waitFor(() => expect(view.getByText(/標為已讀失敗/)).toBeTruthy());
  expect(view.getByText(/尚不支援開啟/)).toBeTruthy();
  expect(view.getByText('標成已讀')).toBeTruthy();
});

test('deferred mark-read after account switch does not navigate with old role', async () => {
  const pending = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(pending.promise);
  mockNotifs.notifications = [
    {
      id: 'm1',
      type: 'message',
      title: '跨帳號通知',
      body: '',
      read: false,
      data: { peerId: 'peer-9' },
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('跨帳號通知'));
  mockAuth.user = { uid: 'bob' };
  mockAuth.profile = { role: 'teacher', schoolId: 'nthu', uid: 'bob' };
  view.rerender(<NotificationsAiFirstScreen />);
  await act(async () => pending.resolve(true));
  await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledWith('m1'));
  expect(applyNotificationDestination).not.toHaveBeenCalled();
});

test('school mismatch on grade notice keeps unread without opening homework', async () => {
  mockNotifs.notifications = [
    {
      id: 'g1',
      type: 'grade',
      title: '成績已公布',
      body: '資料庫 A',
      read: false,
      data: { type: 'grade', gradeId: 'grade-9', schoolId: 'nthu', channel: 'grades' },
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('成績已公布'));
  await waitFor(() => expect(view.getByText(/其他學校/)).toBeTruthy());
  expect(mockNotifs.markAsRead).not.toHaveBeenCalled();
  expect(applyNotificationDestination).not.toHaveBeenCalled();
});

test('unknown or malformed destinations keep unread and offer explicit mark-read', async () => {
  mockNotifs.notifications = [
    {
      id: 'bad',
      type: 'library_due',
      title: '圖書館催還',
      body: '請盡快還書',
      read: false,
      data: {},
    },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('圖書館催還'));
  await waitFor(() => expect(view.getByText(/尚不支援開啟/)).toBeTruthy());
  expect(mockNotifs.markAsRead).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('標成已讀'));
  await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledWith('bad'));
});

test('loads earlier pages when hasMore and surfaces loaded unread scope', async () => {
  mockNotifs.notifications = [
    {
      id: 'n1',
      type: 'system',
      title: '系統',
      body: '',
      read: true,
      data: {},
    },
  ];
  mockNotifs.hasMore = true;
  mockNotifs.unreadCount = 0;
  const view = render(<NotificationsAiFirstScreen />);
  expect(view.getByText('1 則已載入')).toBeTruthy();
  fireEvent.press(view.getByText('載入更早的通知'));
  await waitFor(() => expect(mockNotifs.loadMore).toHaveBeenCalled());
});
