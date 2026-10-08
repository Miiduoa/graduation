import {
  arrayUnion,
  collection,
  doc,
  FieldPath,
  getDocFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type SnapshotMetadata,
  type Transaction,
} from 'firebase/firestore';
import { getAuth, getDb, isFirebaseConfigured } from './firebase';

export type MessagingSession = { uid: string; schoolId: string };
export type MessagingFailure = 'permission' | 'unavailable' | 'stale';
export class MessagingError extends Error {
  constructor(public readonly reason: MessagingFailure) {
    super(reason);
  }
}
export type PrivateConversation = {
  id: string;
  memberIds: string[];
  peerUid: string;
  peerName: string | null;
  preview: string;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  lastReadAt: string | null;
};
export type PrivateMessage = {
  id: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string | null;
  recalled: boolean;
};
export type ConversationContents = {
  conversation: PrivateConversation;
  messages: PrivateMessage[];
};
export type AccountNotification = {
  id: string;
  source: 'user' | 'global';
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string | null;
  data: Record<string, unknown>;
};
export type NotificationFeed = { notifications: AccountNotification[]; unscopedCount: number };
type Fail = (reason: MessagingFailure) => void;
function reason(error: unknown): MessagingFailure {
  if (error instanceof MessagingError) return error.reason;
  return (error as { code?: string })?.code === 'permission-denied' ? 'permission' : 'unavailable';
}
function key(value: string) {
  if (!value || value.includes('/')) throw new MessagingError('permission');
  return value;
}
function assertUser(uid: string) {
  if (!isFirebaseConfigured()) throw new MessagingError('unavailable');
  if (!uid || getAuth()?.currentUser?.uid !== uid) throw new MessagingError('permission');
}
function confirmed(metadata: SnapshotMetadata) {
  if (metadata.fromCache) throw new MessagingError('stale');
  return !metadata.hasPendingWrites;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function messageTime(value: unknown): string | null {
  const stamp = value as { toDate?: () => Date } | null;
  const date =
    typeof stamp?.toDate === 'function'
      ? stamp.toDate()
      : typeof value === 'string'
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function parseConversation(
  id: string,
  row: DocumentData,
  session: MessagingSession,
): PrivateConversation {
  const members: unknown = row.memberIds;
  if (
    row.schoolId !== session.schoolId ||
    row.type !== 'dm' ||
    !Array.isArray(members) ||
    members.length !== 2 ||
    members.some((uid) => typeof uid !== 'string' || !uid) ||
    new Set(members).size !== 2 ||
    !members.includes(session.uid)
  )
    throw new MessagingError('permission');
  return {
    id,
    memberIds: members,
    peerUid: members.find((uid) => uid !== session.uid)!,
    peerName: null,
    preview: text(row.lastMessageText) || text(row.lastMessage?.content),
    lastMessageAt: messageTime(row.lastMessageAt ?? row.updatedAt),
    lastSenderId: text(row.lastMessageSenderId) || text(row.lastMessage?.senderId) || null,
    lastReadAt: messageTime(object(row.lastReadBy)[session.uid]),
  };
}
function parseMessage(
  id: string,
  row: DocumentData,
  conversation: PrivateConversation,
): PrivateMessage {
  if (
    !conversation.memberIds.includes(row.senderId) ||
    (row.conversationId && row.conversationId !== conversation.id)
  )
    throw new MessagingError('permission');
  if (typeof row.content !== 'string') throw new MessagingError('unavailable');
  return {
    id,
    senderId: row.senderId,
    content: row.content,
    type: text(row.type) || 'text',
    createdAt: messageTime(row.createdAt),
    recalled: !!row.recalledAt,
  };
}
export function watchMessagingSession(
  uid: string,
  receive: (session: MessagingSession) => void,
  fail: Fail,
) {
  assertUser(uid);
  let active = true;
  let generation = 0;
  let stopMembership: (() => void) | undefined;
  const reject = (error: unknown) => {
    if (active) fail(reason(error));
  };
  const stopProfile = onSnapshot(
    doc(getDb(), 'users', key(uid)),
    { includeMetadataChanges: true },
    (profile) => {
      if (!active) return;
      const request = ++generation;
      stopMembership?.();
      stopMembership = undefined;
      try {
        assertUser(uid);
        if (!confirmed(profile.metadata)) return;
        const schoolId = text(profile.data()?.schoolId);
        if (!profile.exists() || !schoolId) throw new MessagingError('permission');
        fail('stale');
        stopMembership = onSnapshot(
          doc(getDb(), 'schools', key(schoolId), 'members', uid),
          { includeMetadataChanges: true },
          (member) => {
            if (!active || request !== generation) return;
            try {
              assertUser(uid);
              if (!confirmed(member.metadata)) return;
              if (!member.exists() || member.data()?.status !== 'active')
                throw new MessagingError('permission');
              if (active) receive({ uid, schoolId });
            } catch (error) {
              reject(error);
            }
          },
          (error) => {
            if (request === generation) reject(error);
          },
        );
      } catch (error) {
        reject(error);
      }
    },
    (error) => {
      generation += 1;
      stopMembership?.();
      stopMembership = undefined;
      reject(error);
    },
  );
  return () => {
    active = false;
    generation += 1;
    stopProfile();
    stopMembership?.();
  };
}
async function peerName(session: MessagingSession, uid: string): Promise<string | null> {
  try {
    const profile = await getDocFromServer(
      doc(getDb(), 'schools', session.schoolId, 'directory', key(uid)),
    );
    return text(profile.data()?.displayName) || null;
  } catch {
    return null;
  }
}
export function watchPrivateConversations(
  session: MessagingSession,
  receive: (rows: PrivateConversation[]) => void,
  fail: Fail,
) {
  assertUser(session.uid);
  let active = true;
  let generation = 0;
  const stop = onSnapshot(
    query(
      collection(getDb(), 'conversations'),
      where('type', '==', 'dm'),
      where('schoolId', '==', session.schoolId),
      where('memberIds', 'array-contains', session.uid),
      orderBy('updatedAt', 'desc'),
      limit(100),
    ),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!active) return;
      const request = ++generation;
      try {
        assertUser(session.uid);
        if (!confirmed(snapshot.metadata)) return;
        const rows = snapshot.docs.map((entry) =>
          parseConversation(entry.id, entry.data(), session),
        );
        void Promise.all(
          rows.map(async (row) => ({ ...row, peerName: await peerName(session, row.peerUid) })),
        ).then((named) => {
          if (!active || request !== generation) return;
          try {
            assertUser(session.uid);
            receive(named);
          } catch (error) {
            fail(reason(error));
          }
        });
      } catch (error) {
        if (active) fail(reason(error));
      }
    },
    (error) => {
      generation += 1;
      if (active) fail(reason(error));
    },
  );
  return () => {
    active = false;
    generation += 1;
    stop();
  };
}
export function watchConversationContents(
  session: MessagingSession,
  id: string,
  receive: (contents: ConversationContents) => void,
  fail: Fail,
) {
  assertUser(session.uid);
  key(id);
  let active = true;
  let generation = 0;
  let stopMessages: (() => void) | undefined;
  let conversation: PrivateConversation | null = null;
  let messages: PrivateMessage[] | null = null;
  const emit = () => {
    if (active && conversation && messages) receive({ conversation, messages });
  };
  const reject = (error: unknown) => {
    stopMessages?.();
    stopMessages = undefined;
    conversation = null;
    messages = null;
    generation += 1;
    if (active) fail(reason(error));
  };
  const stop = onSnapshot(
    doc(getDb(), 'conversations', id),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!active) return;
      try {
        assertUser(session.uid);
        if (!confirmed(snapshot.metadata)) return;
        if (!snapshot.exists()) throw new MessagingError('permission');
        const parsed = parseConversation(id, snapshot.data(), session);
        const request = generation;
        conversation = { ...parsed, peerName: conversation?.peerName ?? null };
        void peerName(session, parsed.peerUid).then((name) => {
          if (
            active &&
            conversation &&
            request === generation &&
            getAuth()?.currentUser?.uid === session.uid
          ) {
            conversation = { ...conversation, peerName: name };
            emit();
          }
        });
        if (!stopMessages)
          stopMessages = onSnapshot(
            query(
              collection(getDb(), 'conversations', id, 'messages'),
              orderBy('createdAt', 'desc'),
              limit(100),
            ),
            { includeMetadataChanges: true },
            (snapshot) => {
              try {
                assertUser(session.uid);
                if (!confirmed(snapshot.metadata)) return;
                if (!conversation) throw new MessagingError('permission');
                messages = snapshot.docs
                  .map((entry) => parseMessage(entry.id, entry.data(), conversation!))
                  .reverse();
                emit();
              } catch (error) {
                reject(error);
              }
            },
            reject,
          );
        emit();
      } catch (error) {
        reject(error);
      }
    },
    reject,
  );
  return () => {
    active = false;
    generation += 1;
    stop();
    stopMessages?.();
  };
}
async function transactionSession(transaction: Transaction, session: MessagingSession) {
  assertUser(session.uid);
  const [profile, member] = await Promise.all([
    transaction.get(doc(getDb(), 'users', session.uid)),
    transaction.get(doc(getDb(), 'schools', session.schoolId, 'members', session.uid)),
  ]);
  assertUser(session.uid);
  if (
    !profile.exists() ||
    profile.data()?.schoolId !== session.schoolId ||
    !member.exists() ||
    member.data()?.status !== 'active'
  )
    throw new MessagingError('permission');
}
export function newPrivateMessageId(conversationId: string) {
  return doc(collection(getDb(), 'conversations', key(conversationId), 'messages')).id;
}
export async function sendPrivateMessage(
  session: MessagingSession,
  conversationId: string,
  messageId: string,
  content: string,
) {
  assertUser(session.uid);
  const body = content.trim();
  if (!body || body.length > 4000) throw new MessagingError('unavailable');
  const conversationRef = doc(getDb(), 'conversations', key(conversationId));
  const messageRef = doc(collection(conversationRef, 'messages'), key(messageId));
  await runTransaction(getDb(), async (transaction) => {
    await transactionSession(transaction, session);
    const [conversation, existing] = await Promise.all([
      transaction.get(conversationRef),
      transaction.get(messageRef),
    ]);
    if (!conversation.exists()) throw new MessagingError('permission');
    parseConversation(conversationId, conversation.data(), session);
    assertUser(session.uid);
    if (existing.exists()) {
      if (existing.data()?.senderId !== session.uid || existing.data()?.content !== body)
        throw new MessagingError('permission');
      return;
    }
    const stamp = serverTimestamp();
    const message = {
      conversationId,
      senderId: session.uid,
      content: body,
      type: 'text',
      readBy: [session.uid],
      createdAt: stamp,
    };
    transaction.set(messageRef, message);
    transaction.update(conversationRef, {
      lastMessage: { id: messageId, ...message },
      lastMessageText: body.slice(0, 50),
      lastMessageAt: stamp,
      lastMessageSenderId: session.uid,
      updatedAt: stamp,
    });
  });
  assertUser(session.uid);
}
export async function markConversationRead(
  session: MessagingSession,
  conversationId: string,
  messageIds: string[],
) {
  assertUser(session.uid);
  const reference = doc(getDb(), 'conversations', key(conversationId));
  await runTransaction(getDb(), async (transaction) => {
    await transactionSession(transaction, session);
    const conversation = await transaction.get(reference);
    if (!conversation.exists()) throw new MessagingError('permission');
    const parsed = parseConversation(conversationId, conversation.data(), session);
    const messages = await Promise.all(
      [...new Set(messageIds)]
        .slice(0, 100)
        .map((id) => transaction.get(doc(collection(reference, 'messages'), key(id)))),
    );
    assertUser(session.uid);
    for (const message of messages) {
      if (!message.exists()) continue;
      parseMessage(message.id, message.data(), parsed);
      transaction.update(message.ref, { readBy: arrayUnion(session.uid) });
    }
    transaction.update(reference, new FieldPath('lastReadBy', session.uid), serverTimestamp());
  });
  assertUser(session.uid);
}
export function parseNotification(
  id: string,
  row: DocumentData,
  source: AccountNotification['source'],
  session: MessagingSession,
): AccountNotification | 'unscoped' | null {
  if (
    (source === 'global' && row.userId !== session.uid) ||
    (row.userId && row.userId !== session.uid)
  )
    throw new MessagingError('permission');
  const data = object(row.data);
  const schoolId = text(row.schoolId) || text(data.schoolId);
  if (!schoolId) return 'unscoped';
  if (schoolId !== session.schoolId) return null;
  if (typeof row.title !== 'string' || typeof row.body !== 'string')
    throw new MessagingError('unavailable');
  return {
    id,
    source,
    title: row.title,
    body: row.body,
    type: text(row.type) || text(row.category) || 'system',
    read: row.read === true || row.isRead === true,
    createdAt: messageTime(row.createdAt),
    data,
  };
}
export function watchAccountNotifications(
  session: MessagingSession,
  receive: (feed: NotificationFeed) => void,
  fail: Fail,
) {
  assertUser(session.uid);
  let active = true;
  const sources: Partial<Record<AccountNotification['source'], NotificationFeed>> = {};
  const listen = (source: AccountNotification['source']) =>
    onSnapshot(
      source === 'user'
        ? query(
            collection(getDb(), 'users', session.uid, 'notifications'),
            orderBy('createdAt', 'desc'),
            limit(50),
          )
        : query(
            collection(getDb(), 'notifications'),
            where('userId', '==', session.uid),
            orderBy('createdAt', 'desc'),
            limit(50),
          ),
      { includeMetadataChanges: true },
      (snapshot) => {
        try {
          assertUser(session.uid);
          if (!confirmed(snapshot.metadata)) return;
          const parsed = snapshot.docs.map((entry) =>
            parseNotification(entry.id, entry.data(), source, session),
          );
          sources[source] = {
            notifications: parsed.filter(
              (row): row is AccountNotification => !!row && row !== 'unscoped',
            ),
            unscopedCount: parsed.filter((row) => row === 'unscoped').length,
          };
          if (active && sources.user && sources.global)
            receive({
              notifications: [...sources.user.notifications, ...sources.global.notifications].sort(
                (a, b) =>
                  (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0),
              ),
              unscopedCount: sources.user.unscopedCount + sources.global.unscopedCount,
            });
        } catch (error) {
          delete sources[source];
          if (active) fail(reason(error));
        }
      },
      (error) => {
        delete sources[source];
        if (active) fail(reason(error));
      },
    );
  const user = listen('user');
  const global = listen('global');
  return () => {
    active = false;
    user();
    global();
  };
}
export async function markAccountNotificationRead(
  session: MessagingSession,
  notification: AccountNotification,
) {
  assertUser(session.uid);
  const reference =
    notification.source === 'user'
      ? doc(getDb(), 'users', session.uid, 'notifications', key(notification.id))
      : doc(getDb(), 'notifications', key(notification.id));
  await runTransaction(getDb(), async (transaction) => {
    await transactionSession(transaction, session);
    const snapshot = await transaction.get(reference);
    const parsed = snapshot.exists()
      ? parseNotification(snapshot.id, snapshot.data(), notification.source, session)
      : null;
    if (!parsed || parsed === 'unscoped') throw new MessagingError('permission');
    assertUser(session.uid);
    transaction.update(
      reference,
      notification.source === 'user'
        ? { read: true, readAt: serverTimestamp() }
        : { isRead: true, readAt: serverTimestamp(), updatedAt: serverTimestamp() },
    );
  });
  assertUser(session.uid);
}
export function notificationDestination(
  notification: AccountNotification,
): { href: string; label: string } | null {
  if (notification.type === 'announcement') return { href: '/announcements', label: '查看公告' };
  if (notification.type === 'grade') return { href: '/grades', label: '查看成績' };
  if (
    notification.type === 'message' &&
    typeof notification.data.conversationId === 'string' &&
    notification.data.conversationId &&
    !notification.data.conversationId.includes('/')
  )
    return {
      href: `/dms/${encodeURIComponent(notification.data.conversationId)}`,
      label: '開啟對話',
    };
  if (
    notification.type === 'assignment' &&
    typeof notification.data.courseId === 'string' &&
    notification.data.courseId &&
    !notification.data.courseId.includes('/')
  )
    return { href: `/course/${encodeURIComponent(notification.data.courseId)}`, label: '開啟課程' };
  return null;
}
