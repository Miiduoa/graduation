import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import DmsListPage from '@/app/dms/page';
import MessagesPage from '@/app/messages/page';
import { MessagingShell, PrivateConversationView } from './Messaging';
import {
  watchMessagingSession,
  watchPrivateConversations,
  watchConversationContents,
  watchAccountNotifications,
  sendPrivateMessage,
  newPrivateMessageId,
  markConversationRead,
  markAccountNotificationRead,
  type PrivateConversation,
  type ConversationContents,
  type NotificationFeed,
} from '@/lib/privateMessages';
const account = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('@/lib/firebase', () => ({ getAuth: () => ({ currentUser: account.user }) }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/privateMessages', async (original) => {
  const actual = await original<typeof import('@/lib/privateMessages')>();
  return {
    ...actual,
    watchMessagingSession: vi.fn(),
    watchPrivateConversations: vi.fn(),
    watchConversationContents: vi.fn(),
    watchAccountNotifications: vi.fn(),
    sendPrivateMessage: vi.fn(),
    newPrivateMessageId: vi.fn(),
    markConversationRead: vi.fn(),
    markAccountNotificationRead: vi.fn(),
  };
});
function conversation(patch: Partial<PrivateConversation> = {}): PrivateConversation {
  return {
    id: 'opaque_conversation_id_with_underscores',
    memberIds: ['alice', 'bob'],
    peerUid: 'bob',
    peerName: '真實目錄姓名',
    preview: '真實最近訊息',
    lastMessageAt: '2026-10-08T01:00:00Z',
    lastSenderId: 'bob',
    lastReadAt: null,
    ...patch,
  };
}
function contents(): ConversationContents {
  return {
    conversation: conversation(),
    messages: [
      {
        id: 'm-1',
        senderId: 'bob',
        content: '伺服器的訊息',
        type: 'text',
        createdAt: '2026-10-08T01:00:00Z',
        recalled: false,
      },
    ],
  };
}
function notifications(): NotificationFeed {
  return {
    notifications: [
      {
        id: 'n-1',
        source: 'user',
        title: '成績已公布',
        body: '請查看本人成績。',
        type: 'grade',
        read: false,
        createdAt: null,
        data: {},
      },
      {
        id: 'n-2',
        source: 'global',
        title: '請假待確認',
        body: '請至原校務服務確認。',
        type: 'leave',
        read: false,
        createdAt: null,
        data: {},
      },
    ],
    unscopedCount: 1,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function Chat({ id = 'opaque_conversation_id_with_underscores' }: { id?: string }) {
  return (
    <MessagingShell title="私人對話">
      {(session) => (
        <PrivateConversationView
          key={`${session.uid}:${session.schoolId}:${id}`}
          session={session}
          conversationId={id}
        />
      )}
    </MessagingShell>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  account.user = { uid: 'alice' };
  account.loading = false;
  vi.mocked(watchMessagingSession).mockImplementation((uid, receive) => {
    receive({ uid, schoolId: 'pu' });
    return vi.fn();
  });
  vi.mocked(watchPrivateConversations).mockImplementation((_session, receive) => {
    receive([conversation()]);
    return vi.fn();
  });
  vi.mocked(watchConversationContents).mockImplementation((_session, _id, receive) => {
    receive(contents());
    return vi.fn();
  });
  vi.mocked(watchAccountNotifications).mockImplementation((_session, receive) => {
    receive(notifications());
    return vi.fn();
  });
  vi.mocked(newPrivateMessageId).mockReturnValue('request-id');
  vi.mocked(sendPrivateMessage).mockResolvedValue();
  vi.mocked(markConversationRead).mockResolvedValue();
  vi.mocked(markAccountNotificationRead).mockResolvedValue();
});

it('uses the authenticated account and real directory content instead of demo role or fake recipients', async () => {
  localStorage.setItem('demoRole', 'admin');
  render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  expect(screen.getByText('真實最近訊息')).toBeTruthy();
  expect(watchPrivateConversations).toHaveBeenCalledWith(
    { uid: 'alice', schoolId: 'pu' },
    expect.any(Function),
    expect.any(Function),
  );
  expect(screen.queryByRole('button', { name: /^新對話|核准|刪除/ })).toBeNull();
  expect(screen.getByRole('link', { name: /真實目錄姓名/ }).getAttribute('href')).toBe(
    '/dms/opaque_conversation_id_with_underscores',
  );
});
it('logged-out visitors do not subscribe to private data', async () => {
  account.user = null;
  render(<MessagesPage />);
  await screen.findByText('登入後查看訊息');
  expect(watchMessagingSession).not.toHaveBeenCalled();
  expect(watchAccountNotifications).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '通知' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '私人對話' }).getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('link', { name: '前往登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmessages',
  );
});

it('keeps the current section clear and allows recovery from an empty conversation search', async () => {
  render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  expect(screen.getByRole('link', { name: '私人對話' }).getAttribute('aria-current')).toBe('page');
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋對話' }), {
    target: { value: '不存在的對話' },
  });
  expect(screen.queryByText('真實目錄姓名')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(screen.getByText('真實目錄姓名')).toBeTruthy();
});

it('allows returning to all notifications when the unread filter has no results', async () => {
  vi.mocked(watchAccountNotifications).mockImplementation((_session, receive) => {
    receive({
      notifications: notifications().notifications.map((row) => ({ ...row, read: true })),
      unscopedCount: 0,
    });
    return vi.fn();
  });
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.click(screen.getByRole('checkbox', { name: '只看未讀' }));
  expect(screen.queryByText('成績已公布')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看全部通知' }));
  expect(screen.getByText('成績已公布')).toBeTruthy();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('successful empty conversations stay empty and an error remains distinct', async () => {
  vi.mocked(watchPrivateConversations).mockImplementationOnce((_session, receive) => {
    receive([]);
    return vi.fn();
  });
  const view = render(<DmsListPage />);
  await screen.findByText('目前沒有私人對話');
  view.unmount();
  vi.mocked(watchPrivateConversations).mockImplementationOnce((_session, _receive, fail) => {
    fail('unavailable');
    return vi.fn();
  });
  render(<DmsListPage />);
  await screen.findByText('暫時無法連線');
  expect(screen.queryByText('目前沒有私人對話')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新連線' }));
  await screen.findByText('真實目錄姓名');
});
it('a permission or stale event removes previously loaded private conversation content', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  const fail = vi.mocked(watchConversationContents).mock.calls.at(-1)![3];
  act(() => fail('permission'));
  expect(screen.queryByText('伺服器的訊息')).toBeNull();
  expect(screen.getByText('目前無法開啟這些資料')).toBeTruthy();
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).disabled).toBe(true);
});
it('changing accounts clears names immediately and ignores old callback deliveries', async () => {
  const view = render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  const old = vi.mocked(watchPrivateConversations).mock.calls.at(-1)![1];
  vi.mocked(watchPrivateConversations).mockImplementationOnce((_session, receive) => {
    receive([]);
    return vi.fn();
  });
  account.user = { uid: 'other-user' };
  view.rerender(<DmsListPage />);
  expect(screen.queryByText('真實目錄姓名')).toBeNull();
  act(() => old([conversation({ peerName: '不該出現的舊姓名' })]));
  expect(screen.queryByText('不該出現的舊姓名')).toBeNull();
  await screen.findByText('目前沒有私人對話');
});
it('a server school switch remounts the conversation reader without retaining the old school content', async () => {
  render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  const session = vi.mocked(watchMessagingSession).mock.calls.at(-1)![1];
  vi.mocked(watchPrivateConversations).mockImplementationOnce((_session, receive) => {
    receive([]);
    return vi.fn();
  });
  act(() => session({ uid: 'alice', schoolId: 'another-school' }));
  expect(screen.queryByText('真實目錄姓名')).toBeNull();
  await screen.findByText('目前沒有私人對話');
});
it('sending waits for the confirmed write and a double click cannot duplicate it', async () => {
  const sent = deferred<void>();
  vi.mocked(sendPrivateMessage).mockReturnValueOnce(sent.promise);
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '我的新訊息' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  fireEvent.click(screen.getByRole('button', { name: '傳送中…' }));
  expect(sendPrivateMessage).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('我的新訊息');
  expect(screen.getByRole('list', { name: '對話內容' }).textContent).not.toContain('我的新訊息');
  await act(async () => sent.resolve());
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('');
});
it('a send failure retains the draft and retry reuses its message ID', async () => {
  vi.mocked(sendPrivateMessage).mockRejectedValueOnce(new Error('offline'));
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  await screen.findByText('尚未確認送出，內容已保留。請重新連線後再試。');
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('保留草稿');
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  await waitFor(() =>
    expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe(''),
  );
  expect(newPrivateMessageId).toHaveBeenCalledTimes(1);
  expect(vi.mocked(sendPrivateMessage).mock.calls.map((call) => call[2])).toEqual([
    'request-id',
    'request-id',
  ]);
});
it('an old pending send cannot clear the new account draft or produce its feedback', async () => {
  const sent = deferred<void>();
  vi.mocked(sendPrivateMessage).mockReturnValueOnce(sent.promise);
  const view = render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '舊草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  account.user = { uid: 'new-user' };
  view.rerender(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '新帳號的草稿' } });
  await act(async () => sent.reject(new Error('old failure')));
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('新帳號的草稿');
  expect(screen.queryByText('尚未確認送出，內容已保留。請重新連線後再試。')).toBeNull();
});
it('read-marker errors remain visible without clearing unread content optimistically', async () => {
  vi.mocked(markConversationRead).mockRejectedValueOnce(new Error('denied'));
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.click(screen.getByRole('button', { name: '標記已讀' }));
  await screen.findByText('未能更新已讀狀態，請稍後再試。');
  expect(screen.getByText('伺服器的訊息')).toBeTruthy();
});
it('notifications contain real task links and no local approval, purchase or reply simulation', async () => {
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  expect(screen.getByRole('link', { name: '查看成績' }).getAttribute('href')).toBe('/grades');
  expect(screen.getByText('部分通知尚未標示學校，未列入本頁。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /核准|退回|訂單|回覆|加好友/ })).toBeNull();
});
it('a failed notification read update preserves its unread status until the server confirms', async () => {
  vi.mocked(markAccountNotificationRead).mockRejectedValueOnce(new Error('denied'));
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.click(screen.getAllByRole('button', { name: '標記已讀' })[0]);
  await screen.findByText('未能更新已讀狀態，請稍後再試。');
  expect(screen.getAllByText('未讀')).toHaveLength(2);
});
it('logout removes notifications and old subscription errors cannot restore them', async () => {
  const view = render(<MessagesPage />);
  await screen.findByText('成績已公布');
  const old = vi.mocked(watchAccountNotifications).mock.calls.at(-1)![1];
  account.user = null;
  view.rerender(<MessagesPage />);
  expect(screen.queryByText('成績已公布')).toBeNull();
  act(() => old(notifications()));
  expect(screen.queryByText('成績已公布')).toBeNull();
});
