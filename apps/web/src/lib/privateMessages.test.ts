import { beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer, onSnapshot, runTransaction } from 'firebase/firestore';
import { deriveDmConversationId } from './conversationAccess';
import {
  watchMessagingSession,
  watchPrivateConversations,
  watchConversationContents,
  watchAccountNotifications,
  sendPrivateMessage,
  markConversationRead,
  togglePrivateMessageReaction,
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
    href: '/grades?tab=feedback',
    label: '查看課業成績與回饋',
  });
  expect(
    notificationDestination({
      ...notice,
      type: 'grade',
      data: { courseId: 'cs101', assignmentId: 'hw-1' },
    }),
  ).toEqual({ href: '/course/cs101#assignment-hw-1', label: '前往這份作業' });
  expect(
    notificationDestination({
      ...notice,
      type: 'feedback',
      data: {
        workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
        assignmentId: 'cwa_22222222-2222-4222-8222-222222222222',
      },
    }),
  ).toEqual({
    href: '/classroom/course/cw_11111111-1111-4111-8111-111111111111#assignment-cwa_22222222-2222-4222-8222-222222222222',
    label: '前往這份作業',
  });
  expect(
    notificationDestination({ ...notice, type: 'leave', data: { url: '/fake-approve' } }),
  ).toBeNull();
  expect(
    notificationDestination({ ...notice, type: 'message', data: { conversationId: '../other' } }),
  ).toBeNull();
  expect(
    notificationDestination({
      ...notice,
      type: 'assignment',
      data: { courseId: 'cs101', assignmentId: 'hw-1' },
    }),
  ).toEqual({ href: '/course/cs101#assignment-hw-1', label: '前往這份作業' });
  expect(
    notificationDestination({
      ...notice,
      type: 'assignment_due',
      data: {
        workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
        assignmentId: 'cwa_22222222-2222-4222-8222-222222222222',
      },
    }),
  ).toEqual({
    href: '/classroom/course/cw_11111111-1111-4111-8111-111111111111#assignment-cwa_22222222-2222-4222-8222-222222222222',
    label: '前往這份作業',
  });
  expect(
    notificationDestination({
      ...notice,
      type: 'quiz',
      data: { courseId: 'phys', quizId: 'q1' },
    }),
  ).toEqual({ href: '/course/phys#quiz-q1', label: '前往這份測驗' });
  expect(
    notificationDestination({
      ...notice,
      type: 'assignment',
      data: { courseId: '../other', assignmentId: 'hw-1' },
    }),
  ).toBeNull();
  expect(
    notificationDestination({
      ...notice,
      type: 'assignment',
      data: { courseId: 'cs101' },
    }),
  ).toEqual({ href: '/course/cs101', label: '開啟課程' });
  expect(
    notificationDestination({
      ...notice,
      type: 'assignment_due',
      data: { workspaceId: 'cw_11111111-1111-4111-8111-111111111111' },
    }),
  ).toEqual({
    href: '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
    label: '開啟課程',
  });
  expect(
    notificationDestination({
      ...notice,
      type: 'material',
      data: {
        workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
        materialId: 'cwm_33333333-3333-4333-8333-333333333333',
      },
    }),
  ).toEqual({
    href: '/classroom/course/cw_11111111-1111-4111-8111-111111111111#material-cwm_33333333-3333-4333-8333-333333333333',
    label: '開啟這份教材',
  });
  expect(
    notificationDestination({
      ...notice,
      type: 'announcement',
      data: { announcementId: 'ann-9', schoolId: 'pu' },
    }),
  ).toEqual({ href: '/announcements/ann-9?campus=pu&schoolId=pu', label: '查看公告' });
  expect(
    notificationDestination({
      ...notice,
      type: 'order',
      data: { orderId: 'ord-1', schoolId: 'pu' },
    }),
  ).toEqual({
    href: '/orders?campus=pu&schoolId=pu&orderId=ord-1',
    label: '查看訂單／取餐',
  });
  expect(
    notificationDestination({
      ...notice,
      type: 'live_session',
      data: { groupId: 'cs101', sessionId: 'sess-1' },
    }),
  ).toEqual({
    href: '/course/cs101/attendance?sessionId=sess-1',
    label: '開啟點名',
  });
  expect(
    notificationDestination({
      ...notice,
      type: 'assignment_submission',
      data: { groupId: 'cs101', assignmentId: 'hw-1' },
    }),
  ).toEqual({
    href: '/teacher/course/cs101?assignmentId=hw-1',
    label: '查看待批改繳交',
  });
});

it.each(['leaveRequestId', 'requestId'])('opens an owned leave lookup from the %s notification field', (field) => {
  expect(notificationDestination({
    ...notice, type: 'leave', data: { [field]: 'leave-2026-good-id', schoolId: 'pu' },
  })).toEqual({
    href: '/leave?schoolId=pu&requestId=leave-2026-good-id', label: '查看站內請假紀錄',
  });
});

it('can use the current school for a valid leave ID and never trusts an arbitrary notification URL', () => {
  expect(notificationDestination({
    ...notice, type: 'leave', data: { requestId: 'leave-2026-good-id', url: '/fake-approve' },
  })).toEqual({ href: '/leave?requestId=leave-2026-good-id', label: '查看站內請假紀錄' });
  expect(notificationDestination({
    ...notice, type: 'leave', data: { leaveRequestId: '../invalid', requestId: 'leave-2026-good-id' },
  })).toEqual({ href: '/leave?requestId=leave-2026-good-id', label: '查看站內請假紀錄' });
});

it.each([
  { requestId: '../leave-2026-good-id' },
  { leaveRequestId: 'too-short' },
  { requestId: 'a'.repeat(65) },
  { requestId: 'leave-2026-good-id', schoolId: '../pu' },
  { url: '/fake-approve' },
])('does not construct a leave destination from invalid notification data %s', (data) => {
  expect(notificationDestination({ ...notice, type: 'leave', data })).toBeNull();
});

it('toggles a permitted message reaction with the authenticated school session', async () => {
  const original = tx.get.getMockImplementation()!;
  tx.get.mockImplementation(async (reference: { path: string }) =>
    reference.path === 'conversations/conversation-1/messages/reaction-1'
      ? document('reaction-1', message({ reactions: { '👍': ['bob'] } }))
      : original(reference),
  );
  await togglePrivateMessageReaction(session, 'conversation-1', 'reaction-1', '👍');
  expect(tx.update).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'conversations/conversation-1/messages/reaction-1' }),
    {
      reactions: { '👍': ['bob', 'alice'] },
      updatedAt: 'SERVER_TIMESTAMP',
    },
  );
});

it.each(['school-club-events', 'school-events', 'legacy-events'])(
  'opens an event with its verified %s source and notification campus',
  (source) => {
    expect(
      notificationDestination({
        ...notice,
        type: 'event',
        data: { eventId: 'event-1', source, schoolId: 'pu' },
      }),
    ).toEqual({
      href: `/events/event-1?campus=pu&schoolId=pu&source=${source}`,
      label: '查看活動詳情',
    });
  },
);

it.each([undefined, 'unrecognized', 'https://example.com'])(
  'uses the campus event list when its source is %s',
  (source) => {
    expect(
      notificationDestination({
        ...notice,
        type: 'event',
        data: { eventId: 'event-1', source, schoolId: 'ncnu' },
      }),
    ).toEqual({ href: '/events?campus=ncnu&schoolId=ncnu', label: '查看活動列表' });
  },
);

it('invalid event IDs do not select a different document or arbitrary destination', () => {
  expect(
    notificationDestination({
      ...notice,
      type: 'event',
      data: {
        eventId: '../other',
        source: 'school-events',
        schoolId: 'pu',
        url: 'https://example.com',
      },
    }),
  ).toEqual({ href: '/events?campus=pu&schoolId=pu', label: '查看活動列表' });
});

it.each(['friend_request', 'friend_invite', 'friend_accepted'])(
  'opens existing account-scoped friendships for %s without taking action',
  (type) => {
    expect(
      notificationDestination({ ...notice, type, data: { schoolId: 'ncnu', url: '/fake-accept' } }),
    ).toEqual({ href: '/friends?campus=ncnu&schoolId=ncnu', label: '開啟好友與邀請' });
  },
);

it('opens the notification campus library service without substituting a raw payload URL', () => {
  expect(
    notificationDestination({
      ...notice,
      type: 'library_due',
      data: { schoolId: 'pu', url: '/fake-renew' },
    }),
  ).toEqual({ href: '/library?campus=pu&schoolId=pu', label: '查看本校借閱服務' });
});

it.each(['unknown', 'system', 'group_invite'])(
  'does not offer a circular task action for unsupported %s notifications',
  (type) => {
    expect(notificationDestination({ ...notice, type, data: { url: '/fake-action' } })).toBeNull();
  },
);

it('opens existing DM conversation IDs longer than 128 characters', () => {
  const conversationId = deriveDmConversationId('pu', 'a'.repeat(64), 'b'.repeat(64));
  expect(conversationId).toHaveLength(135);
  expect(
    notificationDestination({ ...notice, type: 'message', data: { conversationId } }),
  ).toEqual({ href: `/dms/${encodeURIComponent(conversationId)}`, label: '開啟對話' });
});

it.each(['.', '..', '../other', ''])(
  'rejects malformed private conversation ID %s',
  (conversationId) => {
    expect(
      notificationDestination({ ...notice, type: 'message', data: { conversationId } }),
    ).toBeNull();
  },
);

it('refuses reactions on messages outside the current school and on recalled messages', async () => {
  const original = tx.get.getMockImplementation()!;
  tx.get.mockImplementation(async (reference: { path: string }) => {
    if (reference.path === 'conversations/conversation-1')
      return document(reference.path, conversation({ schoolId: 'other-school' }));
    if (reference.path.endsWith('/reaction-1'))
      return document('reaction-1', message());
    return original(reference);
  });
  await expect(togglePrivateMessageReaction(session, 'conversation-1', 'reaction-1', '❤️'))
    .rejects.toThrow();
  expect(tx.update).not.toHaveBeenCalled();
  tx.get.mockImplementation(async (reference: { path: string }) =>
    reference.path.endsWith('/reaction-1')
      ? document('reaction-1', message({ recalledAt: '2026-10-08T01:03:00Z' }))
      : original(reference),
  );
  await expect(togglePrivateMessageReaction(session, 'conversation-1', 'reaction-1', '❤️'))
    .rejects.toThrow();
  expect(tx.update).not.toHaveBeenCalled();
});

 it('retains the verified campus in presentation data even when stored at the top level', () => {
  expect(parseNotification('n-1', notification(), 'user', session)).toEqual(
    expect.objectContaining({ data: expect.objectContaining({ schoolId: session.schoolId }) }),
  );
  expect(parseNotification('n-1', notification({ data: { schoolId: 'wrong-campus' } }), 'user', session)).toEqual(
    expect.objectContaining({ data: expect.objectContaining({ schoolId: session.schoolId }) }),
  );
});
