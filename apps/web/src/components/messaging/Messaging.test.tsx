import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import DmsListPage from '@/app/dms/page';
import MessagesPage from '@/app/messages/page';
import { MessagingShell, PrivateConversationView } from './Messaging';
import { confirmDmPhoto, readDmPhoto, uploadDmPhoto } from '@/lib/dmPhotos';
vi.mock('@/lib/dmPhotos', async (original) => ({
  ...await original<typeof import('@/lib/dmPhotos')>(),
  confirmDmPhoto: vi.fn(), readDmPhoto: vi.fn(), uploadDmPhoto: vi.fn(),
}));
import {
  watchMessagingSession,
  watchPrivateConversations,
  watchConversationContents,
  watchAccountNotifications,
  sendPrivateMessage,
  sendPreparedPrivateMessage,
  watchNewPrivateConversation,
  type PreparedPrivateConversation,
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
  SiteShell: ({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) => <main><p>{subtitle}</p>{children}</main>,
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
    sendPreparedPrivateMessage: vi.fn(),
    watchNewPrivateConversation: vi.fn(),
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
function Chat({ id = 'opaque_conversation_id_with_underscores', prepared }: { id?: string; prepared?: PreparedPrivateConversation }) {
  return (
    <MessagingShell title="訊息">
      {(session) => (
        <PrivateConversationView
          key={`${session.uid}:${session.schoolId}:${id}`}
          session={session}
          conversationId={id}
          prepared={prepared}
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
  vi.mocked(sendPreparedPrivateMessage).mockResolvedValue();
  vi.mocked(watchNewPrivateConversation).mockImplementation((_session, _prepared, receive) => {
    receive(contents());
    return vi.fn();
  });
  vi.mocked(markConversationRead).mockResolvedValue();
  vi.mocked(togglePrivateMessageReaction).mockResolvedValue();
  vi.mocked(markAccountNotificationRead).mockResolvedValue();
});

it('uses the authenticated account and real directory content instead of demo role or fake recipients', async () => {
  localStorage.setItem('demoRole', 'admin');
  render(<DmsListPage />);
  await screen.findByText('真實目錄姓名');
  expect(screen.getByText('接著上次的話題，與校園裡的人保持聯繫。')).toBeTruthy();
  expect(screen.getByText('真實最近訊息')).toBeTruthy();
  expect(watchPrivateConversations).toHaveBeenCalledWith(
    { uid: 'alice', schoolId: 'pu' },
    expect.any(Function),
    expect.any(Function),
  );
  expect(screen.queryByRole('button', { name: /^新對話|核准|刪除/ })).toBeNull();
  expect(screen.getByRole('link', { name: '新增訊息' }).getAttribute('href')).toBe('/dms/new');
  expect(screen.getByRole('link', { name: /真實目錄姓名/ }).getAttribute('href')).toBe(
    '/dms/opaque_conversation_id_with_underscores',
  );
});
it('logged-out visitors do not subscribe to private data', async () => {
  account.user = null;
  render(<MessagesPage />);
  await screen.findByText('登入後查看訊息');
  expect(screen.getByText('課程、活動與服務的新消息，都在這裡。')).toBeTruthy();
  expect(watchMessagingSession).not.toHaveBeenCalled();
  expect(watchAccountNotifications).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '通知' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: '訊息' }).getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('link', { name: '連結學校帳號' }).getAttribute('href')).toBe(
    '/login?reconnect=school&returnUrl=%2Fmessages',
  );
  expect(screen.getByText(/Google 平台登入不會自動連結校內帳號/)).toBeTruthy();
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
it.each(['unavailable', 'stale'] as const)('%s preserves loaded history while reconnecting without photo authorization', async (failure) => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  const fail = vi.mocked(watchConversationContents).mock.lastCall![3];
  act(() => fail(failure));
  expect(screen.getByText('伺服器的訊息')).toBeTruthy();
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '加入照片' }) as HTMLButtonElement).disabled).toBe(true);
  vi.mocked(watchConversationContents).mockImplementationOnce(() => vi.fn());
  fireEvent.click(screen.getAllByRole('button', { name: '重新連線' })[0]);
  expect(screen.getByText('伺服器的訊息')).toBeTruthy();
  const receive = vi.mocked(watchConversationContents).mock.lastCall![2];
  act(() => receive(contents()));
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).disabled).toBe(false);
  expect(screen.getByRole('button', { name: '加入照片' })).toBeTruthy();
});
it('a permission event removes previously loaded private conversation content', async () => {
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
  expect(screen.getByText('請假 · 未標示校園')).toBeTruthy();
});

it('combines notification text, type and unread filters with recoverable empty results', async () => {
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  const search = screen.getByRole('searchbox', { name: '搜尋通知' });
  fireEvent.change(search, { target: { value: '原校務服務' } });
  expect(screen.getByText('請假待確認')).toBeTruthy();
  expect(screen.queryByText('成績已公布')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('顯示 1 / 2 則通知');
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(search);
  fireEvent.change(screen.getByRole('combobox', { name: '通知類型' }), {
    target: { value: 'course' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: '只看未讀' }));
  expect(screen.getByText('成績已公布')).toBeTruthy();
  expect(screen.queryByText('請假待確認')).toBeNull();
  fireEvent.change(search, { target: { value: '不存在' } });
  expect(screen.getByText('找不到符合的通知')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect((search as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('all');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText('請假待確認')).toBeTruthy();
});

it('restores filters when returning to notifications in the same tab and account', async () => {
  const view = render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '成績' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'course' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '只看未讀' }));
  view.unmount();
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('成績');
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('course');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText('請假待確認')).toBeNull();
  expect(markAccountNotificationRead).not.toHaveBeenCalled();
});

it('clears notification filters on account changes and ignores the old feed', async () => {
  const view = render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '成績' } });
  const oldReceive = vi.mocked(watchAccountNotifications).mock.calls.at(-1)![1];
  vi.mocked(watchAccountNotifications).mockImplementationOnce((_session, receive) => {
    receive({ notifications: [], unscopedCount: 0 });
    return vi.fn();
  });
  account.user = { uid: 'next-user' };
  view.rerender(<MessagesPage />);
  await screen.findByText('目前沒有本校通知');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  act(() => oldReceive(notifications()));
  expect(screen.queryByText('成績已公布')).toBeNull();
  expect(sessionStorage.getItem('campus-one:notification-filters:next-user:pu')).toBeNull();
  expect(JSON.parse(sessionStorage.getItem('campus-one:notification-filters:alice:pu')!).q).toBe(
    '成績',
  );
});

it('restores only the current school notification filters', async () => {
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '成績' } });
  const receiveSession = vi.mocked(watchMessagingSession).mock.calls.at(-1)![1];
  act(() => receiveSession({ uid: 'alice', schoolId: 'ncnu' }));
  await screen.findByText('請假待確認');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  act(() => receiveSession({ uid: 'alice', schoolId: 'pu' }));
  await screen.findByText('成績已公布');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('成績');
  expect(screen.queryByText('請假待確認')).toBeNull();
});

it('preserves the filter while retrying a failed notification feed', async () => {
  render(<MessagesPage />);
  await screen.findByText('成績已公布');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '成績' } });
  const fail = vi.mocked(watchAccountNotifications).mock.calls.at(-1)![2];
  act(() => fail('unavailable'));
  expect(screen.getByText('暫時無法連線')).toBeTruthy();
  expect(screen.queryByText('找不到符合的通知')).toBeNull();
  expect(screen.queryByText('成績已公布')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新連線' }));
  await screen.findByText('成績已公布');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('成績');
  expect(screen.queryByText('請假待確認')).toBeNull();
});

it('keeps notification filtering usable when tab storage is unavailable', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  try {
    render(<MessagesPage />);
    await screen.findByText('成績已公布');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '請假' } });
    expect(screen.getByText('請假待確認')).toBeTruthy();
    expect(screen.queryByText('成績已公布')).toBeNull();
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it('keeps unsupported notifications readable without a link back to the current inbox', async () => {
  render(<MessagesPage />);
  await screen.findByText('請假待確認');
  expect(screen.getByText('這則通知目前沒有可開啟的服務連結。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '開啟通知中心' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '標記已讀' })).toHaveLength(2);
});

it('labels a story reply in the conversation and removes its context after recall', async () => {
  const thread = contents();
  thread.messages[0].isStoryReply = true;
  vi.mocked(watchConversationContents).mockImplementation((_session, _id, receive) => {
    receive(thread);
    return vi.fn();
  });
  render(<Chat />);
  await screen.findByText('回覆了限時動態');
  expect(screen.getByText('伺服器的訊息')).toBeTruthy();
  const receive = vi.mocked(watchConversationContents).mock.calls.at(-1)![2];
  act(() => receive({ ...thread, messages: [{ ...thread.messages[0], recalled: true }] }));
  expect(screen.getByText('訊息已收回')).toBeTruthy();
  expect(screen.queryByText('回覆了限時動態')).toBeNull();
  expect(screen.queryByText('伺服器的訊息')).toBeNull();
});

const photoId = 'privatePhotoMessage0001';
function selectPhoto(loaded = true) {
  fireEvent.change(screen.getByLabelText('選擇私訊照片'), {
    target: { files: [new File(['pic'], '校園.jpg', { type: 'image/jpeg' })] },
  });
  if (loaded) fireEvent.load(screen.getByRole('img', { name: '待傳送照片預覽' }));
}
function showPhotoMessage() {
  const thread = contents();
  const row = { ...thread.messages[0], id: photoId, type: 'image', content: '照片',
    attachmentPath: 'conversations/previous/photos/hash/sent.jpg' };
  vi.mocked(watchConversationContents).mockImplementation((_session, id, receive) => {
    receive(id === 'previous' ? { ...thread, messages: [row] } : thread);
    return vi.fn();
  });
  return { thread, row };
}

it('previews and removes a local photo without disturbing a text draft or sending a request', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '文字草稿' } });
  fireEvent.change(screen.getByLabelText('選擇私訊照片'), {
    target: { files: [new File(['gif'], 'bad.gif', { type: 'image/gif' })] },
  });
  expect(screen.getByRole('alert').textContent).toMatch(/JPG、PNG 或 WebP/);
  expect(screen.queryByRole('img')).toBeNull();
  const release = vi.spyOn(URL, 'revokeObjectURL');
  selectPhoto();
  expect(screen.getByRole('img', { name: '待傳送照片預覽' }).getAttribute('src')).toMatch(/^blob:/);
  fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
  expect(screen.queryByRole('img')).toBeNull();
  expect(release).toHaveBeenCalled();
  release.mockRestore();
  expect(uploadDmPhoto).not.toHaveBeenCalled();
  expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe('文字草稿');
});

it.each([
  'javascript:alert(1)',
  'data:image/svg+xml,<svg onload="alert(1)"/>',
  'https://example.test/photo.jpg',
  '<img src=x onerror="alert(1)">',
  'photo.jpg',
])('never assigns a non-blob preview URL to img src: %s', async (url) => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce(url);
  const release = vi.spyOn(URL, 'revokeObjectURL');
  try {
    render(<Chat />);
    await screen.findByText('伺服器的訊息');
    selectPhoto(false);
    expect(create).toHaveBeenCalledWith(expect.any(File));
    expect(screen.getByRole('img', { name: '待傳送照片預覽' }).getAttribute('src')).toBeNull();
    expect((screen.getByRole('button', { name: '讀取照片中…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(uploadDmPhoto).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
    expect(release).toHaveBeenCalledWith(url);
  } finally {
    create.mockRestore();
    release.mockRestore();
  }
});

it('requires confirmation, suppresses duplicate clicks and retries a lost receipt without uploading again', async () => {
  vi.mocked(newPrivateMessageId).mockReturnValue(photoId);
  const path = 'conversations/previous/photos/hash/photo.jpg';
  vi.mocked(uploadDmPhoto).mockResolvedValue(path);
  const first = deferred<void>();
  vi.mocked(confirmDmPhoto).mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
  render(<Chat id="previous" />);
  await screen.findByText('伺服器的訊息');
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  fireEvent.click(screen.getByRole('button', { name: '照片傳送中…' }));
  const scope = { viewerUid: 'alice', schoolId: 'pu', conversationId: 'previous', messageId: photoId };
  await waitFor(() => expect(confirmDmPhoto).toHaveBeenCalledWith(scope, path, expect.anything()));
  expect(screen.queryByText('照片已傳送')).toBeNull();
  await act(async () => first.reject(new Error('ack lost')));
  expect(screen.getByRole('img', { name: '待傳送照片預覽' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新傳送照片' }));
  await screen.findByText('照片已傳送');
  expect(confirmDmPhoto).toHaveBeenCalledTimes(2);
  expect(confirmDmPhoto).toHaveBeenLastCalledWith(scope, path, expect.anything());
  expect(newPrivateMessageId).toHaveBeenCalledTimes(1);
  expect(uploadDmPhoto).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('img')).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it('requests each chat photo on demand, hides upon recall and drops image failures', async () => {
  const { thread, row } = showPhotoMessage();
  vi.mocked(readDmPhoto).mockResolvedValue({ url: 'https://some-image.test/signed', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  render(<Chat id="previous" />);
  const open = await screen.findByRole('button', { name: '查看照片' });
  expect(readDmPhoto).not.toHaveBeenCalled();
  fireEvent.click(open);
  let photo = await screen.findByRole('img', { name: '對話中的照片' });
  expect(photo.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(readDmPhoto).toHaveBeenCalledWith({ viewerUid: 'alice', schoolId: 'pu', conversationId: 'previous', messageId: photoId },
    row.attachmentPath, expect.anything());
  fireEvent.click(screen.getByRole('button', { name: '收合照片' }));
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看照片' }));
  photo = await screen.findByRole('img', { name: '對話中的照片' });
  fireEvent.error(photo);
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看照片' }));
  await screen.findByRole('img', { name: '對話中的照片' });
  expect(readDmPhoto).toHaveBeenCalledTimes(3);
  const receive = vi.mocked(watchConversationContents).mock.calls.at(-1)![2];
  act(() => receive({ ...thread, messages: [{ ...row, recalled: true }] }));
  expect(screen.getByText('訊息已收回')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', { name: '查看照片' })).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it('discards a pending photo read and pending upload when switching conversations', async () => {
  showPhotoMessage();
  const read = deferred<{ url: string; expiresAt: string }>();
  const upload = deferred<string>();
  vi.mocked(readDmPhoto).mockReturnValueOnce(read.promise);
  vi.mocked(uploadDmPhoto).mockReturnValueOnce(upload.promise);
  const view = render(<Chat id="previous" />);
  fireEvent.click(await screen.findByRole('button', { name: '查看照片' }));
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  const oldRead = vi.mocked(readDmPhoto).mock.lastCall![2];
  const oldUpload = vi.mocked(uploadDmPhoto).mock.lastCall![2];
  view.rerender(<Chat id="next" />);
  await screen.findByText('伺服器的訊息');
  expect(oldRead.aborted && oldUpload.aborted).toBe(true);
  await act(async () => {
    read.resolve({ url: 'https://old-private.test/secret', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    upload.resolve('conversations/previous/photos/hash/photo.jpg');
  });
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText('照片已傳送')).toBeNull();
  expect(confirmDmPhoto).not.toHaveBeenCalled();
});

it('closes an expired photo and requests a fresh grant if the viewer opens it again', async () => {
  showPhotoMessage();
  render(<Chat id="previous" />);
  const button = await screen.findByRole('button', { name: '查看照片' });
  vi.useFakeTimers();
  try {
    vi.mocked(readDmPhoto).mockImplementation(async () => ({
      url: 'https://some-image.test/view', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole('img', { name: '對話中的照片' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_001));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('檢視時間已結束，可以再次開啟。')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '查看照片' })));
    expect(screen.getByRole('img', { name: '對話中的照片' })).toBeTruthy();
    expect(readDmPhoto).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it('retains a local photo through a stale connection and retries a failed upload with the same message ID', async () => {
  vi.mocked(newPrivateMessageId).mockReturnValue(photoId);
  vi.mocked(uploadDmPhoto).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('conversations/previous/photos/hash/photo.jpg');
  vi.mocked(confirmDmPhoto).mockResolvedValueOnce(undefined);
  render(<Chat id="previous" />);
  await screen.findByText('伺服器的訊息');
  selectPhoto();
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await screen.findByRole('button', { name: '重新傳送照片' });
  const [, , receive, fail] = vi.mocked(watchConversationContents).mock.lastCall!;
  act(() => fail('stale'));
  expect(screen.getByRole('img', { name: '待傳送照片預覽' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '重新傳送照片' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => receive(contents()));
  fireEvent.click(screen.getByRole('button', { name: '重新傳送照片' }));
  await screen.findByText('照片已傳送');
  expect(newPrivateMessageId).toHaveBeenCalledTimes(1);
  expect(vi.mocked(uploadDmPhoto).mock.calls.map(([scope]) => scope.messageId)).toEqual([photoId, photoId]);
});

it('discards an unreadable local preview before upload and lets the user pick a replacement', async () => {
  render(<Chat />);
  await screen.findByText('伺服器的訊息');
  selectPhoto(false);
  expect((screen.getByRole('button', { name: '讀取照片中…' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.error(screen.getByRole('img', { name: '待傳送照片預覽' }));
  expect(screen.getByRole('alert').textContent).toContain('無法讀取這張照片');
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('button', { name: '加入照片' })).toBeTruthy();
  expect(uploadDmPhoto).not.toHaveBeenCalled();
  selectPhoto();
  expect((screen.getByRole('button', { name: '傳送照片' }) as HTMLButtonElement).disabled).toBe(false);
});

it('closes a visible photo on pagehide and ignores old reads after hiding and reopening the tab', async () => {
  showPhotoMessage();
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const first = deferred<{ url: string; expiresAt: string }>();
  const second = deferred<{ url: string; expiresAt: string }>();
  const grant = { url: 'https://image.test/private', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  vi.mocked(readDmPhoto).mockResolvedValueOnce(grant).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  try {
    render(<Chat id="previous" />);
    fireEvent.click(await screen.findByRole('button', { name: '查看照片' }));
    const displayed = await screen.findByRole('img', { name: '對話中的照片' });
    act(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    expect(displayed.getAttribute('src')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看照片' }));
    const oldSignal = vi.mocked(readDmPhoto).mock.lastCall![2];
    visibility.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '查看照片' }));
    expect(readDmPhoto).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    fireEvent.click(screen.getByRole('button', { name: '查看照片' }));
    const newSignal = vi.mocked(readDmPhoto).mock.lastCall![2];
    await act(async () => first.resolve(grant));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: '正在開啟…' })).toBeTruthy();
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(newSignal.aborted).toBe(true);
    await act(async () => second.resolve(grant));
    expect(screen.queryByRole('img')).toBeNull();
  } finally {
    visibility.mockRestore();
  }
});

it.each([undefined, true, false])('routes UI text sends through the member flow only for established conversations (exists=%s)', async (exists) => {
  const prepared = exists === undefined ? undefined : {
    conversationId: 'dm_pu_alice_bob', peerUid: 'bob', peerName: null, exists,
  };
  // An existing thread may be returned by prepare's fallback after the peer transfers schools.
  render(<Chat id="dm_pu_alice_bob" prepared={prepared} />);
  await screen.findByText('伺服器的訊息');
  fireEvent.change(screen.getByLabelText('訊息內容'), { target: { value: '繼續對話' } });
  fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));
  await waitFor(() => expect((screen.getByLabelText('訊息內容') as HTMLTextAreaElement).value).toBe(''));
  if (exists === false) {
    expect(sendPreparedPrivateMessage).toHaveBeenCalledWith(
      { uid: 'alice', schoolId: 'pu' }, prepared, 'request-id', '繼續對話', expect.any(AbortSignal),
    );
    expect(sendPrivateMessage).not.toHaveBeenCalled();
  } else {
    expect(sendPrivateMessage).toHaveBeenCalledWith(
      { uid: 'alice', schoolId: 'pu' }, 'dm_pu_alice_bob', 'request-id', '繼續對話',
    );
    expect(sendPreparedPrivateMessage).not.toHaveBeenCalled();
  }
});
