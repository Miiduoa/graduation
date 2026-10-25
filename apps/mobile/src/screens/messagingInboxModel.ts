import { isConversationUnread } from '../utils/conversationAccess';

type TimestampLike = Date | string | number | { seconds: number; nanoseconds?: number } | null;

export type InboxConversation = {
  id: string;
  type: string;
  schoolId?: string;
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: TimestampLike;
  lastMessageSenderId?: string;
  lastMessage?: { senderId?: string; content?: string };
  lastReadBy?: Record<string, TimestampLike>;
};

export function schoolConversations<T extends InboxConversation>(
  rows: T[],
  uid: string | null | undefined,
  schoolId: string | null | undefined,
): T[] {
  if (!uid || !schoolId) return [];
  return rows.filter(
    (row) =>
      row.type === 'dm' &&
      row.schoolId === schoolId &&
      Array.isArray(row.memberIds) &&
      row.memberIds.length === 2 &&
      new Set(row.memberIds).size === 2 &&
      row.memberIds.includes(uid),
  );
}

export function unreadConversation(row: InboxConversation, uid: string | null | undefined): boolean {
  if (!uid || !(row.lastMessageText || row.lastMessage?.content)) return false;
  return isConversationUnread({
    uid,
    lastMessageAt: row.lastMessageAt ?? null,
    lastReadAt: row.lastReadBy?.[uid] ?? null,
    lastMessageSenderId: row.lastMessageSenderId ?? row.lastMessage?.senderId,
  });
}

export function filterInbox<T extends InboxConversation & { peerName: string }>(
  rows: T[],
  uid: string | null | undefined,
  search: string,
  onlyUnread: boolean,
  demoUnread?: (row: T) => boolean,
): T[] {
  const phrase = search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (onlyUnread && !(demoUnread ? demoUnread(row) : unreadConversation(row, uid))) return false;
    return (
      !phrase ||
      `${row.peerName} ${row.lastMessageText ?? ''}`.toLocaleLowerCase().includes(phrase)
    );
  });
}
