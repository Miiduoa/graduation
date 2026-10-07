import { beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import {
  watchMessagingSession,
  watchPrivateConversations,
  watchConversationContents,
  watchAccountNotifications,
  sendPrivateMessage,
  markConversationRead,
  markAccountNotificationRead,
  parseNotification,
  notificationDestination,
  type MessagingSession,
  type AccountNotification,
} from './privateMessages';
const runtime = vi.hoisted(() => ({ uid: 'alice' as string | null, configured: true }));
vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => ({ currentUser: runtime.uid ? { uid: runtime.uid } : null }),
  isFirebaseConfigured: () => runtime.configured,
}));
vi.mock('firebase/firestore', () => ({
  collection: (parent: { path?: string }, ...parts: string[]) => ({
    path: [parent.path, ...parts].filter(Boolean).join('/'),
  }),
  doc: (parent: { path?: string }, ...parts: string[]) => ({
    path: [parent.path, ...parts].filter(Boolean).join('/'),
    id: parts.at(-1) || 'generated-id',
  }),
  where: (...args: unknown[]) => ({ where: args }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  limit: (count: number) => ({ limit: count }),
  query: (ref: object, ...constraints: object[]) => ({ ...ref, constraints }),
  onSnapshot: vi.fn(),
  getDocFromServer: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  arrayUnion: (uid: string) => ({ arrayUnion: uid }),
  FieldPath: class {
    segments: string[];
    constructor(...segments: string[]) {
      this.segments = segments;
    }
  },
}));
const session: MessagingSession = { uid: 'alice', schoolId: 'pu' };
const metadata = { fromCache: false, hasPendingWrites: false };
function document(id: string, row: Record<string, unknown> | null, meta = {}) {
  return {
    id,
    ref: { path: id },
    data: () => row,
    exists: () => row !== null,
    metadata: { ...metadata, ...meta },
  };
}
function querySnapshot(docs: ReturnType<typeof document>[], meta = {}) {
  return { docs, metadata: { ...metadata, ...meta } };
}
function conversation(patch = {}) {
  return {
    schoolId: 'pu',
    type: 'dm',
    memberIds: ['alice', 'bob'],
    lastMessageText: '實際訊息',
    lastMessageAt: '2026-10-08T01:00:00Z',
    ...patch,
  };
}
function message(patch = {}) {
  return {
    conversationId: 'conversation-1',
    senderId: 'bob',
    type: 'text',
    content: '來源內容',
    createdAt: '2026-10-08T01:00:00Z',
    ...patch,
  };
}
function listener(path: string) {
  const calls = vi.mocked(onSnapshot).mock.calls as unknown as [
    { path: string },
    object,
    (snapshot: unknown) => void,
    (error: unknown) => void,
  ][];
  const call = calls.filter((entry) => entry[0].path === path).at(-1);
  if (!call) throw new Error(`Missing ${path}`);
  return { receive: call[2], error: call[3], query: call[0] };
}
const tx = { get: vi.fn(), set: vi.fn(), update: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  runtime.uid = 'alice';
  runtime.configured = true;
  vi.mocked(onSnapshot).mockReturnValue(vi.fn());
  vi.mocked(getDocFromServer).mockResolvedValue(
    document('bob', { displayName: '來源姓名' }) as never,
  );
  tx.get.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'users/alice') return document(path, { schoolId: 'pu' });
    if (path === 'schools/pu/members/alice') return document(path, { status: 'active' });
    if (path === 'conversations/conversation-1') return document(path, conversation());
    return document(path, null);
  });
  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback(tx as never));
});

it('resolves school scope from the server profile and active membership, never a URL or demo role', () => {
  const receive = vi.fn();
  const fail = vi.fn();
  watchMessagingSession('alice', receive, fail);
  listener('users/alice').receive(document('alice', { schoolId: 'pu' }));
  expect(receive).not.toHaveBeenCalled();
  listener('schools/pu/members/alice').receive(document('alice', { status: 'active' }));
  expect(receive).toHaveBeenLastCalledWith(session);
  listener('schools/pu/members/alice').receive(document('alice', { status: 'inactive' }));
  expect(fail).toHaveBeenLastCalledWith('permission');
});

it('does not restore an old school from a late membership listener', () => {
  const receive = vi.fn();
  watchMessagingSession('alice', receive, vi.fn());
  listener('users/alice').receive(document('alice', { schoolId: 'pu' }));
  const old = listener('schools/pu/members/alice');
  listener('users/alice').receive(document('alice', { schoolId: 'another-school' }));
  old.receive(document('alice', { status: 'active' }));
  expect(receive).not.toHaveBeenCalled();
  listener('schools/another-school/members/alice').receive(document('alice', { status: 'active' }));
  expect(receive).toHaveBeenCalledWith({ uid: 'alice', schoolId: 'another-school' });
});

it('conversations query includes UID, current school and DM type; snapshot cache is not presented as live', async () => {
  const receive = vi.fn();
  const fail = vi.fn();
  watchPrivateConversations(session, receive, fail);
  expect(listener('conversations').query).toEqual({
    path: 'conversations',
    constraints: [
      { where: ['type', '==', 'dm'] },
      { where: ['schoolId', '==', 'pu'] },
      { where: ['memberIds', 'array-contains', 'alice'] },
      { orderBy: ['updatedAt', 'desc'] },
      { limit: 100 },
    ],
  });
  listener('conversations').receive(
    querySnapshot([document('conversation-1', conversation())], { fromCache: true }),
  );
  expect(fail).toHaveBeenLastCalledWith('stale');
  expect(receive).not.toHaveBeenCalled();
  listener('conversations').receive(querySnapshot([document('conversation-1', conversation())]));
  await vi.waitFor(() => expect(receive).toHaveBeenCalled());
  expect(receive.mock.calls[0][0][0].peerName).toBe('來源姓名');
});

it.each([{ schoolId: 'other' }, { memberIds: ['mallory', 'bob'] }])(
  'rejects invalid conversation rows instead of leaking another scope: %j',
  (patch) => {
    const receive = vi.fn();
    const fail = vi.fn();
    watchPrivateConversations(session, receive, fail);
    listener('conversations').receive(
      querySnapshot([document('conversation-1', conversation(patch))]),
    );
    expect(receive).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith('permission');
  },
);

it('a revoked conversation clears the child subscription before more messages can be delivered', () => {
  const receive = vi.fn();
  const fail = vi.fn();
  watchConversationContents(session, 'conversation-1', receive, fail);
  listener('conversations/conversation-1').receive(document('conversation-1', conversation()));
  const messages = listener('conversations/conversation-1/messages');
  expect(messages.query).toEqual({
    path: 'conversations/conversation-1/messages',
    constraints: [{ orderBy: ['createdAt', 'desc'] }, { limit: 100 }],
  });
  messages.receive(querySnapshot([document('message-1', message())]));
  expect(receive).toHaveBeenCalledTimes(1);
  listener('conversations/conversation-1').receive(
    document('conversation-1', conversation({ memberIds: ['mallory', 'bob'] })),
  );
  messages.receive(querySnapshot([document('message-2', message({ content: '不可洩漏' }))]));
  expect(receive).toHaveBeenCalledTimes(1);
  expect(fail).toHaveBeenLastCalledWith('permission');
});

it('does not parse membership from conversation IDs or read messages before server membership is confirmed', () => {
  const fail = vi.fn();
  watchConversationContents(session, 'dm_pu_alice_bob', vi.fn(), fail);
  listener('conversations/dm_pu_alice_bob').receive(
    document('dm_pu_alice_bob', conversation({ memberIds: ['mallory', 'bob'] })),
  );
  expect(vi.mocked(onSnapshot).mock.calls).toHaveLength(1);
  expect(fail).toHaveBeenCalledWith('permission');
});

it('sends one atomic canonical message and summary using the authenticated UID and server time', async () => {
  await sendPrivateMessage(session, 'conversation-1', 'request-1', '  真實送出內容  ');
  expect(tx.set).toHaveBeenCalledWith(
    { path: 'conversations/conversation-1/messages/request-1', id: 'request-1' },
    {
      conversationId: 'conversation-1',
      senderId: 'alice',
      content: '真實送出內容',
      type: 'text',
      readBy: ['alice'],
      createdAt: 'SERVER_TIMESTAMP',
    },
  );
  expect(tx.update).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'conversations/conversation-1' }),
    expect.objectContaining({
      lastMessageText: '真實送出內容',
      lastMessageSenderId: 'alice',
      lastMessageAt: 'SERVER_TIMESTAMP',
    }),
  );
});

it('retrying the same request ID is idempotent and a conflicting stored message is rejected', async () => {
  const original = tx.get.getMockImplementation()!;
  tx.get.mockImplementation(async (ref) =>
    ref.path.endsWith('/request-1')
      ? document('request-1', message({ senderId: 'alice', content: '同一封訊息' }))
      : original(ref),
  );
  await sendPrivateMessage(session, 'conversation-1', 'request-1', '同一封訊息');
  expect(tx.set).not.toHaveBeenCalled();
  expect(tx.update).not.toHaveBeenCalled();
  await expect(
    sendPrivateMessage(session, 'conversation-1', 'request-1', '另一封訊息'),
  ).rejects.toMatchObject({ reason: 'permission' });
});

it.each(['wrong-school', 'revoked', 'other-account'])(
  'prevents writes after %s',
  async (change) => {
    if (change === 'other-account') runtime.uid = 'someone-else';
    else {
      const original = tx.get.getMockImplementation()!;
      tx.get.mockImplementation(async (ref) =>
        ref.path === (change === 'wrong-school' ? 'users/alice' : 'schools/pu/members/alice')
          ? document(
              ref.path,
              change === 'wrong-school' ? { schoolId: 'other' } : { status: 'inactive' },
            )
          : original(ref),
      );
    }
    await expect(
      sendPrivateMessage(session, 'conversation-1', 'request-1', '訊息'),
    ).rejects.toMatchObject({ reason: 'permission' });
    expect(tx.set).not.toHaveBeenCalled();
  },
);

it('marking a conversation read uses member-checked messages and only the caller read marker', async () => {
  const original = tx.get.getMockImplementation()!;
  tx.get.mockImplementation(async (ref) =>
    ref.path.endsWith('/message-1') ? document('message-1', message()) : original(ref),
  );
  await markConversationRead(session, 'conversation-1', ['message-1']);
  expect(tx.update).toHaveBeenCalledWith(
    { path: 'message-1' },
    { readBy: { arrayUnion: 'alice' } },
  );
  expect(tx.update.mock.calls.at(-1)?.[1]).toHaveProperty('segments', ['lastReadBy', 'alice']);
});

function notification(patch = {}) {
  return {
    userId: 'alice',
    schoolId: 'pu',
    title: '學校通知',
    body: '通知內容',
    type: 'grade',
    read: false,
    createdAt: '2026-10-08T01:00:00Z',
    ...patch,
  };
}
const notice: AccountNotification = {
  id: 'n-1',
  source: 'global',
  title: '學校通知',
  body: '通知內容',
  type: 'grade',
  read: false,
  createdAt: null,
  data: {},
};
it('keeps only the current owner and school without guessing unscoped notifications', () => {
  expect(
    parseNotification('n-1', notification({ schoolId: 'other' }), 'global', session),
  ).toBeNull();
  expect(parseNotification('n-1', notification({ schoolId: undefined }), 'user', session)).toBe(
    'unscoped',
  );
  expect(() =>
    parseNotification('n-1', notification({ userId: 'bob' }), 'user', session),
  ).toThrow();
});
it('reads both existing notification sources and never hides a source error behind the other one', () => {
  const receive = vi.fn();
  const fail = vi.fn();
  watchAccountNotifications(session, receive, fail);
  listener('users/alice/notifications').receive(querySnapshot([document('n-1', notification())]));
  expect(receive).not.toHaveBeenCalled();
  listener('notifications').error({ code: 'permission-denied' });
  expect(fail).toHaveBeenCalledWith('permission');
  listener('notifications').receive(querySnapshot([]));
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({
      notifications: [expect.objectContaining({ id: 'n-1', source: 'user' })],
    }),
  );
});
it.each(['global', 'user'] as const)(
  'writes the supported %s notification read field without generating a notification',
  async (source) => {
    const original = tx.get.getMockImplementation()!;
    tx.get.mockImplementation(async (ref) =>
      ref.path.endsWith('/n-1') ? document('n-1', notification()) : original(ref),
    );
    await markAccountNotificationRead(session, { ...notice, source });
    expect(tx.update).toHaveBeenCalledWith(
      expect.anything(),
      source === 'global'
        ? { isRead: true, readAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP' }
        : { read: true, readAt: 'SERVER_TIMESTAMP' },
    );
    expect(tx.set).not.toHaveBeenCalled();
  },
);
it('notification destinations only use supported local tasks and never arbitrary URL or approval actions', () => {
  expect(notificationDestination({ ...notice, data: { url: 'javascript:alert(1)' } })).toEqual({
    href: '/grades',
    label: '查看成績',
  });
  expect(
    notificationDestination({ ...notice, type: 'leave', data: { url: '/fake-approve' } }),
  ).toBeNull();
  expect(
    notificationDestination({ ...notice, type: 'message', data: { conversationId: '../other' } }),
  ).toBeNull();
});
