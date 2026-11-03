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
  togglePrivateMessageReaction,
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
    togglePrivateMessageReaction: vi.fn(),
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
    <MessagingShell title="訊息">
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
  sessionStorage.clear();
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
  vi.mocked(togglePrivateMessageReaction).mockResolvedValue();
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
  expect(screen.getByRole('link', { name: '訊息' }).getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('link', { name: '前往登入' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fmessages',
  );
});

it('keeps the current section clear and allows recovery from an empty conversation search', async () => {
  render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  expect(screen.getByRole('link', { name: '訊息' }).getAttribute('aria-current')).toBe('page');
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
  await screen.findByText('目前沒有訊息');
  view.unmount();
  vi.mocked(watchPrivateConversations).mockImplementationOnce((_session, _receive, fail) => {
    fail('unavailable');
    return vi.fn();
  });
  render(<DmsListPage />);
  await screen.findByText('暫時無法連線');
  expect(screen.queryByText('目前沒有訊息')).toBeNull();
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
  await screen.findByText('目前沒有訊息');
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
  await screen.findByText('目前沒有訊息');
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
  expect(screen.getByRole('log', { name: '對話內容' }).textContent).not.toContain('我的新訊息');
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
it('never persists a previous account conversation draft under the next account key', async () => {
  const previousId = 'draft-isolation-previous';
  const nextId = 'draft-isolation-next';
  const previousKey = `campus-one:dm-draft:alice:pu:${previousId}`;
  const nextKey = `campus-one:dm-draft:new-user:pu:${nextId}`;
  sessionStorage.removeItem(previousKey);
  sessionStorage.removeItem(nextKey);
  const view = render(
    <PrivateConversationView session={{ uid: 'alice', schoolId: 'pu' }} conversationId={previousId} />,
  );
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), {
    target: { value: '只有 alice 能看到的草稿' },
  });
  await waitFor(() => expect(sessionStorage.getItem(previousKey)).toBe('只有 alice 能看到的草稿'));

  const writes = vi.spyOn(Storage.prototype, 'setItem');
  try {
    account.user = { uid: 'new-user' };
    view.rerender(
      <PrivateConversationView session={{ uid: 'new-user', schoolId: 'pu' }} conversationId={nextId} />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe(''),
    );
    expect(writes.mock.calls.some(([key, value]) =>
      key === nextKey && value === '只有 alice 能看到的草稿',
    )).toBe(false);
    expect(sessionStorage.getItem(nextKey)).toBeNull();
    expect(sessionStorage.getItem(previousKey)).toBe('只有 alice 能看到的草稿');
  } finally {
    writes.mockRestore();
    sessionStorage.removeItem(previousKey);
    sessionStorage.removeItem(nextKey);
  }
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
  expect(screen.getByRole('link', { name: '查看課業成績與回饋' }).getAttribute('href')).toBe(
    '/grades?tab=feedback',
  );
  expect(screen.getByText('部分通知尚未標示學校，未列入本頁。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /核准|退回|訂單|回覆|加好友/ })).toBeNull();
});
it('a failed notification read update preserves its unread status until the server confirms', async () => {
  vi.mocked(markAccountNotificationRead).mockRejectedValueOnce(new Error('denied'));
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.click(screen.getAllByRole('button', { name: '標記已讀' })[0]);
  await screen.findByText('未能更新已讀狀態，請稍後再試。');
  fireEvent.click(screen.getByRole('checkbox', { name: '只看未讀' }));
  expect(screen.getByText('成績已公布')).toBeTruthy();
  expect(screen.getByText('2 則未讀（只含已載入）')).toBeTruthy();
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

it('separates unread and read conversations without treating own messages as unread', async () => {
  vi.mocked(watchPrivateConversations).mockImplementation((_session, receive) => {
    receive([
      conversation({ id: 'unread', peerName: '未讀同學' }),
      conversation({ id: 'read', peerName: '已讀同學', lastSenderId: 'alice' }),
    ]);
    return vi.fn();
  });
  render(<DmsListPage />);
  await screen.findByText('未讀同學');
  fireEvent.click(screen.getByRole('button', { name: /未讀 1/ }));
  expect(screen.getByText('未讀同學')).toBeTruthy();
  expect(screen.queryByText('已讀同學')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /全部 2/ }));
  expect(screen.getByText('已讀同學')).toBeTruthy();
});

it('offers a recoverable unread empty state without erasing conversations', async () => {
  vi.mocked(watchPrivateConversations).mockImplementation((_session, receive) => {
    receive([conversation({ lastSenderId: 'alice' })]);
    return vi.fn();
  });
  render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  fireEvent.click(screen.getByRole('button', { name: /未讀 0/ }));
  expect(screen.getByText('所有對話都已讀')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看全部對話' }));
  expect(screen.getByText('真實目錄姓名')).toBeTruthy();
});

it('filters only the loaded thread messages and can restore them', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  const field = screen.getByRole('searchbox', { name: '搜尋此對話' });
  fireEvent.change(field, { target: { value: '不在對話內' } });
  expect(screen.queryByText('伺服器的訊息')).toBeNull();
  expect(screen.getByText('找不到符合的訊息，試著調整關鍵字。')).toBeTruthy();
  fireEvent.change(field, { target: { value: '伺服器' } });
  expect(screen.getByText('伺服器的訊息')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect((field as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('button', { name: '清除搜尋' })).toBeNull();
});

it('recovers an unsent message only for the same browser tab and conversation', async () => {
  const view = render(<Chat id="draft-restoration" />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '待傳送的訊息' } });
  await waitFor(() =>
    expect(sessionStorage.getItem('campus-one:dm-draft:alice:pu:draft-restoration')).toBe('待傳送的訊息'),
  );
  view.unmount();
  render(<Chat id="draft-restoration" />);
  await screen.findByText('伺服器的訊息');
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('待傳送的訊息');
});

it('supports Cmd+Enter to send while preserving the confirmed-send guard', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  const field = screen.getByLabelText('訊息內容');
  fireEvent.change(field, { target: { value: '快捷傳送' } });
  fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(sendPrivateMessage).toHaveBeenCalledTimes(1));
  expect(vi.mocked(sendPrivateMessage).mock.calls[0][3]).toBe('快捷傳送');
});

it('sends reactions to the real conversation with the scoped account and leaves server state authoritative', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.click(screen.getByRole('button', { name: '讚，目前 0 人回應' }));
  await waitFor(() => expect(togglePrivateMessageReaction).toHaveBeenCalledTimes(1));
  expect(togglePrivateMessageReaction).toHaveBeenCalledWith(
    { uid: 'alice', schoolId: 'pu' },
    'opaque_conversation_id_with_underscores',
    'm-1',
    '👍',
  );
  // The server listener, not a local toggle, is the single source of truth.
  expect(screen.getByRole('button', { name: '讚，目前 0 人回應' }).getAttribute('aria-pressed')).toBe('false');
});

it('a failed reaction reports the error instead of claiming it succeeded', async () => {
  vi.mocked(togglePrivateMessageReaction).mockRejectedValueOnce(new Error('network'));
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.click(screen.getByRole('button', { name: '愛心，目前 0 人回應' }));
  await screen.findByText('無法更新表情回應，請確認網路後重試。');
  expect(vi.mocked(togglePrivateMessageReaction)).toHaveBeenCalledTimes(1);
});

it('keeps a reader\'s scroll position when new messages arrive and offers a jump to latest', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  const log = screen.getByRole('log', { name: '對話內容' }) as HTMLOListElement;
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 160 },
  });
  act(() => {
    log.scrollTop = 100;
    fireEvent.scroll(log);
  });
  expect(screen.getByRole('button', { name: '跳到最新訊息' })).toBeTruthy();
  const receive = vi.mocked(watchConversationContents).mock.calls.at(-1)![2];
  act(() => {
    receive({
      conversation: conversation(),
      messages: [
        ...contents().messages,
        {
          id: 'm-2',
          senderId: 'bob',
          content: '最新訊息',
          type: 'text',
          createdAt: '2026-10-08T01:01:00Z',
          recalled: false,
        },
      ],
    });
  });
  expect(log.scrollTop).toBe(100);
  fireEvent.click(screen.getByRole('button', { name: '跳到最新訊息' }));
  expect(log.scrollTop).toBe(800);
  expect(screen.queryByRole('button', { name: '跳到最新訊息' })).toBeNull();
});

it('copies message text only after clipboard confirmation', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.click(screen.getByRole('button', { name: '複製' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('伺服器的訊息'));
  expect(screen.getByRole('button', { name: '已複製' })).toBeTruthy();
});

it('does not claim a failed message copy was successful', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.click(screen.getByRole('button', { name: '複製' }));
  await screen.findByText('無法自動複製訊息，請選取文字後手動複製。');
  expect(screen.queryByRole('button', { name: '已複製' })).toBeNull();
});

it('can send in a new conversation while the previous send is still pending', async () => {
  const oldSend = deferred<void>();
  const nextSend = deferred<void>();
  vi.mocked(sendPrivateMessage)
    .mockReturnValueOnce(oldSend.promise)
    .mockReturnValueOnce(nextSend.promise);
  vi.mocked(newPrivateMessageId).mockImplementation((id) => `request-${id}`);
  const view = render(<Chat id="previous" />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '舊對話訊息' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));

  view.rerender(<Chat id="next" />);
  await screen.findByText('伺服器的訊息');
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '新對話訊息' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  expect(sendPrivateMessage).toHaveBeenNthCalledWith(
    2, { uid: 'alice', schoolId: 'pu' }, 'next', 'request-next', '新對話訊息',
  );
  await act(async () => oldSend.reject(new Error('old failure')));
  expect(screen.queryByText('尚未確認送出，內容已保留。請重新連線後再試。')).toBeNull();
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('新對話訊息');
  expect(screen.getByRole('button', { name: '傳送中…' })).toBeTruthy();
  await act(async () => nextSend.resolve());
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('');
  expect(sessionStorage.getItem('campus-one:dm-draft:alice:pu:previous')).toBe('舊對話訊息');
});

it('resets search and copy feedback when switching conversation', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  const view = render(<Chat id="previous" />);
  await screen.findByText('伺服器的訊息');
  fireEvent.click(screen.getByRole('button', { name: '複製' }));
  await screen.findByRole('button', { name: '已複製' });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋此對話' }), {
    target: { value: '舊對話關鍵字' },
  });
  view.rerender(<Chat id="next" />);
  await screen.findByText('伺服器的訊息');
  expect((screen.getByRole('searchbox', { name: '搜尋此對話' }) as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('button', { name: '已複製' })).toBeNull();
});

it('does not send Cmd+Enter while an IME composition is active', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  const field = screen.getByLabelText('訊息內容');
  fireEvent.change(field, { target: { value: '中文組字中' } });
  fireEvent.keyDown(field, { key: 'Enter', metaKey: true, isComposing: true });
  expect(sendPrivateMessage).not.toHaveBeenCalled();
  expect((field as HTMLTextAreaElement).value).toBe('中文組字中');
});

it('shows source labels and limited coverage without inferring a campus', async () => {
  vi.mocked(watchAccountNotifications).mockImplementation((_session, receive) => {
    const feed = notifications();
    feed.notifications[0].data = { schoolId: 'pu' };
    receive(feed);
    return vi.fn();
  });
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  expect(screen.getByText(/每個來源最多 50 則/)).toBeTruthy();
  expect(screen.getByText(/成績 · 靜宜大學/)).toBeTruthy();
  expect(screen.getByText('其他通知 · 未標示校園')).toBeTruthy();
});
