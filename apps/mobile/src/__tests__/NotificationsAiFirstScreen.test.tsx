import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationsAiFirstScreen from '../screens/NotificationsAiFirstScreen';
import { applyNotificationDestination } from '../utils/applyNotificationDestination';

const mockAuth = {
  user: { uid: 'alice' } as { uid: string } | null,
  profile: { role: 'student' as const, schoolId: 'pu', uid: 'alice' },
};
let mockFocus: (() => void) | undefined;
let mockBlur: (() => void) | undefined;
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
  useFocusEffect: (callback: () => () => void) => {
    const React = require('react');
    React.useEffect(() => {
      mockFocus = () => {
        mockBlur = callback();
      };
      mockFocus();
      return mockBlur;
    }, [callback]);
  },
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
  mockNotifs.markAllAsRead.mockResolvedValue(true);
  jest.mocked(applyNotificationDestination).mockReturnValue(true);
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

test('markAsRead false keeps unread and opens content with retry', async () => {
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
  await waitFor(() => expect(view.getByText(/已讀還沒同步/)).toBeTruthy());
  expect(view.getByText('未讀')).toBeTruthy();
  expect(applyNotificationDestination).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText(/^重試已讀同步：/));
  await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledTimes(2));
  expect(applyNotificationDestination).toHaveBeenCalledTimes(1);
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

test.each([true, false])(
  'deferred mark-read %s after account switch ignores the old result',
  async (result) => {
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
    await act(async () => pending.resolve(result));
    expect(view.queryByText(/已讀還沒同步/)).toBeNull();
    await waitFor(() => expect(mockNotifs.markAsRead).toHaveBeenCalledWith('m1'));
    expect(applyNotificationDestination).not.toHaveBeenCalled();
  },
);

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

for (const outcome of ['false', 'throw'] as const) {
  test(`navigation ${outcome} reports failure without claiming unread sync succeeded`, async () => {
    mockNotifs.notifications = [
      { id: 'm1', type: 'message', title: '內容通知', read: false, data: { peerId: 'peer-1' } },
    ];
    mockNotifs.markAsRead.mockResolvedValue(false);
    jest.mocked(applyNotificationDestination).mockImplementation(() => {
      if (outcome === 'throw') throw new Error('navigation unavailable');
      return false;
    });
    const view = render(<NotificationsAiFirstScreen />);
    fireEvent.press(view.getByText('內容通知'));
    await waitFor(() => expect(view.getByText(/內容暫時打不開，已讀也還沒同步/)).toBeTruthy());
    expect(view.getByText('未讀')).toBeTruthy();
    expect(view.getByText(/^重試已讀同步：/)).toBeTruthy();
  });
}

test('completion after leaving the screen does not open content', async () => {
  const pending = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(pending.promise);
  mockNotifs.notifications = [
    { id: 'm1', type: 'message', title: '稍後完成', read: false, data: { peerId: 'peer-1' } },
  ];
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('稍後完成'));
  view.unmount();
  await act(async () => pending.resolve(false));
  expect(applyNotificationDestination).not.toHaveBeenCalled();
});

test('blur while still mounted ignores a late read failure', async () => {
  const pending = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(pending.promise);
  mockNotifs.notifications = [
    { id: 'm1', type: 'message', title: '離開清單', read: false, data: { peerId: 'peer-1' } },
  ];
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('離開清單'));
  act(() => mockBlur?.());
  await act(async () => pending.resolve(false));
  expect(applyNotificationDestination).not.toHaveBeenCalled();
  expect(view.queryByText(/已讀還沒同步/)).toBeNull();
});

test('pending optimistic read stays unread and ignores duplicate presses until confirmed', async () => {
  const pending = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(pending.promise);
  mockNotifs.notifications = [
    { id: 'm1', type: 'message', title: '等待確認', read: false, data: { peerId: 'peer-1' } },
  ];
  mockNotifs.unreadCount = 1;
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('等待確認'));
  mockNotifs.notifications = [{ ...mockNotifs.notifications[0], read: true }];
  mockNotifs.unreadCount = 0;
  view.rerender(<NotificationsAiFirstScreen />);
  expect(view.getByText('未讀')).toBeTruthy();
  expect(view.getByText(/1 則未讀/)).toBeTruthy();
  fireEvent.press(view.getByText('等待確認'));
  expect(mockNotifs.markAsRead).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(true));
  expect(view.queryByText('未讀')).toBeNull();
  expect(applyNotificationDestination).toHaveBeenCalledTimes(1);
});

test('rejected read sync still opens content and lets the user retry', async () => {
  mockNotifs.markAsRead.mockRejectedValueOnce(new Error('offline'));
  mockNotifs.notifications = [
    { id: 'm1', type: 'message', title: '離線通知', read: false, data: { peerId: 'peer-1' } },
  ];
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('離線通知'));
  await waitFor(() => expect(view.getByText(/^重試已讀同步：/)).toBeTruthy());
  expect(view.getByText('未讀')).toBeTruthy();
  expect(applyNotificationDestination).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText(/^重試已讀同步：/));
  await waitFor(() => expect(view.queryByText(/^重試已讀同步：/)).toBeNull());
  expect(applyNotificationDestination).toHaveBeenCalledTimes(1);
});

function setupRows() {
  mockNotifs.notifications = ['A', 'B'].map((id) => ({
    id,
    title: `通知${id}`,
    type: 'message',
    read: false,
    data: { peerId: id },
  }));
  mockNotifs.unreadCount = 2;
}

test('blur then successful sync then refocus clears optimistic unread without navigation', async () => {
  setupRows();
  const pending = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(pending.promise);
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('通知A'));
  mockNotifs.notifications[0] = { ...mockNotifs.notifications[0], read: true };
  mockNotifs.unreadCount = 1;
  view.rerender(<NotificationsAiFirstScreen />);
  expect(view.getByLabelText('正在同步已讀：通知A').props.accessibilityState).toEqual({
    busy: true,
    disabled: true,
  });
  expect(view.getAllByText('未讀')).toHaveLength(2);
  act(() => mockBlur?.());
  await act(async () => pending.resolve(true));
  act(() => mockFocus?.());
  expect(view.getAllByText('未讀')).toHaveLength(1);
  expect(view.queryByLabelText('正在同步已讀：通知A')).toBeNull();
  expect(applyNotificationDestination).not.toHaveBeenCalled();
});

test('refocus and press while optimistic write waits preserves original failure and retry', async () => {
  setupRows();
  const pending = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(pending.promise);
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('通知A'));
  mockNotifs.notifications[0] = { ...mockNotifs.notifications[0], read: true };
  mockNotifs.unreadCount = 1;
  view.rerender(<NotificationsAiFirstScreen />);
  act(() => mockBlur?.());
  act(() => mockFocus?.());
  fireEvent.press(view.getByText('通知A'));
  expect(mockNotifs.markAsRead).toHaveBeenCalledTimes(1);
  expect(view.getAllByText('未讀')).toHaveLength(2);
  mockNotifs.notifications[0] = { ...mockNotifs.notifications[0], read: false };
  mockNotifs.unreadCount = 2;
  await act(async () => pending.resolve(false));
  expect(view.getByText('重試已讀同步：通知A')).toBeTruthy();
  expect(applyNotificationDestination).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('重試已讀同步：通知A'));
  await waitFor(() => expect(view.queryByText('重試已讀同步：通知A')).toBeNull());
  expect(mockNotifs.markAsRead).toHaveBeenCalledTimes(2);
});

test('single failure then all-read success clears that batch errors and unread masks', async () => {
  setupRows();
  mockNotifs.markAsRead.mockResolvedValueOnce(false);
  const batch = deferred<boolean>();
  mockNotifs.markAllAsRead.mockReturnValueOnce(batch.promise);
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('通知A'));
  await waitFor(() => expect(view.getByText('重試已讀同步：通知A')).toBeTruthy());
  fireEvent.press(view.getByText('全部已讀'));
  mockNotifs.notifications = mockNotifs.notifications.map((row) => ({ ...row, read: true }));
  mockNotifs.unreadCount = 0;
  view.rerender(<NotificationsAiFirstScreen />);
  expect(view.getAllByText('未讀')).toHaveLength(2);
  await act(async () => batch.resolve(true));
  expect(view.queryByText('未讀')).toBeNull();
  expect(view.queryByText(/重試已讀同步/)).toBeNull();
  expect(view.queryByText(/已讀還沒同步/)).toBeNull();
});

test('interleaved row completion keeps the other row failure and retry', async () => {
  setupRows();
  mockNotifs.markAsRead.mockResolvedValueOnce(false);
  const view = render(<NotificationsAiFirstScreen />);
  fireEvent.press(view.getByText('通知A'));
  await waitFor(() => expect(view.getByText('重試已讀同步：通知A')).toBeTruthy());
  const retry = deferred<boolean>();
  const other = deferred<boolean>();
  mockNotifs.markAsRead.mockReturnValueOnce(retry.promise).mockReturnValueOnce(other.promise);
  fireEvent.press(view.getByText('重試已讀同步：通知A'));
  fireEvent.press(view.getByText('通知B'));
  await act(async () => other.resolve(false));
  await act(async () => retry.resolve(true));
  expect(view.queryByText('重試已讀同步：通知A')).toBeNull();
  expect(view.getByText('重試已讀同步：通知B')).toBeTruthy();
  expect(view.getByText(/已讀還沒同步/)).toBeTruthy();
});

for (const operation of ['single', 'batch'] as const) {
  test.each([true, false])(
    `${operation} completion %s from a previous login preserves confirmed reads after returning`,
    async (result) => {
      setupRows();
      const pending = deferred<boolean>();
      const write = operation === 'single' ? mockNotifs.markAsRead : mockNotifs.markAllAsRead;
      write.mockReturnValueOnce(pending.promise);
      const view = render(<NotificationsAiFirstScreen />);
      fireEvent.press(view.getByText(operation === 'single' ? '通知A' : '全部已讀'));
      mockAuth.user = { uid: 'bob' };
      view.rerender(<NotificationsAiFirstScreen />);
      mockAuth.user = { uid: 'alice' };
      mockNotifs.notifications = mockNotifs.notifications.map((row) => ({ ...row, read: true }));
      mockNotifs.unreadCount = 0;
      view.rerender(<NotificationsAiFirstScreen />);
      expect(view.queryByText('未讀')).toBeNull();
      expect(view.queryByLabelText('正在同步已讀：通知A')).toBeNull();
      await act(async () => pending.resolve(result));
      expect(view.queryByText('未讀')).toBeNull();
      expect(view.queryByText(/則未讀/)).toBeNull();
      expect(view.queryByText(/同步失敗|還沒同步|重試已讀同步/)).toBeNull();
      expect(applyNotificationDestination).not.toHaveBeenCalled();
    },
  );

  for (const nextOperation of ['single', 'batch'] as const) {
    test.each([true, false])(
      `${operation} old completion %s cannot block or release a new ${nextOperation} operation`,
      async (result) => {
        setupRows();
        const oldPending = deferred<boolean>();
        const newPending = deferred<boolean>();
        const oldWrite = operation === 'single' ? mockNotifs.markAsRead : mockNotifs.markAllAsRead;
        const newWrite =
          nextOperation === 'single' ? mockNotifs.markAsRead : mockNotifs.markAllAsRead;
        oldWrite.mockReturnValueOnce(oldPending.promise);
        const view = render(<NotificationsAiFirstScreen />);
        fireEvent.press(view.getByText(operation === 'single' ? '通知A' : '全部已讀'));
        mockAuth.user = { uid: 'bob' };
        view.rerender(<NotificationsAiFirstScreen />);
        mockAuth.user = { uid: 'alice' };
        view.rerender(<NotificationsAiFirstScreen />);
        newWrite.mockReturnValueOnce(newPending.promise);
        const callsBefore = newWrite.mock.calls.length;
        fireEvent.press(view.getByText(nextOperation === 'single' ? '通知A' : '全部已讀'));
        expect(newWrite).toHaveBeenCalledTimes(callsBefore + 1);
        await act(async () => oldPending.resolve(result));
        expect(view.getByLabelText('正在同步已讀：通知A')).toBeTruthy();
        fireEvent.press(view.getByText('通知A'));
        fireEvent.press(view.getByText('全部已讀'));
        expect(newWrite).toHaveBeenCalledTimes(callsBefore + 1);
        expect(view.queryByText(/同步失敗|還沒同步|重試已讀同步/)).toBeNull();
        expect(applyNotificationDestination).not.toHaveBeenCalled();
        mockNotifs.notifications = mockNotifs.notifications.map((row) => ({ ...row, read: true }));
        mockNotifs.unreadCount = 0;
        await act(async () => newPending.resolve(true));
        expect(view.queryByText('未讀')).toBeNull();
      },
    );
  }
}
