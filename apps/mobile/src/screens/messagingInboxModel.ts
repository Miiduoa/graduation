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

/** 單則私訊送出狀態：未確認前絕不顯示為已送達。 */
export type DmSendStatus = 'sending' | 'unconfirmed' | 'failed' | 'delivered';

export type DmOutboundDraft = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  status: Exclude<DmSendStatus, 'delivered'>;
  createdAtMs: number;
};

export const DM_SEND_STATUS_LABEL: Record<DmSendStatus, string> = {
  sending: '送出中',
  unconfirmed: '未確認',
  failed: '送出失敗',
  delivered: '已送達',
};

export const DM_SEND_RETRY_LABEL = '重試';

export const DM_SEND_RETRY_A11Y = '重試送出此則訊息';

export const DM_SEND_STATUS_A11Y: Record<Exclude<DmSendStatus, 'delivered'>, string> = {
  sending: '訊息送出中，尚未確認送達',
  unconfirmed: '訊息尚未確認是否送達，可稍後重試',
  failed: '訊息送出失敗，可重試',
};

type PreviewEntry = {
  uid: string;
  status: Exclude<DmSendStatus, 'delivered'>;
  text: string;
  updatedAtMs: number;
};

/** 進程內預覽（非持久離線佇列）：對話列表對齊聊天室未確認狀態。 */
const outboundPreviews = new Map<string, PreviewEntry>();

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

export function canRetryDmSend(status: DmSendStatus): boolean {
  return status === 'failed' || status === 'unconfirmed';
}

export function nextDmSendStatus(
  current: Exclude<DmSendStatus, 'delivered'>,
  event:
    | 'start'
    | 'confirmed'
    | 'known_failure'
    | 'uncertain'
    | 'background'
    | 'retry'
    | 'account_or_scope_changed',
): DmSendStatus | null {
  if (event === 'account_or_scope_changed') return null;
  if (event === 'confirmed') return 'delivered';
  if (event === 'start' || event === 'retry') return 'sending';
  if (event === 'known_failure') return 'failed';
  if (event === 'uncertain' || event === 'background') {
    return current === 'sending' || current === 'unconfirmed' ? 'unconfirmed' : current;
  }
  return current;
}

/**
 * 明確可判定的失敗 → failed（可人工重試）。
 * 其餘（含斷線、逾時、背景中斷）→ unconfirmed，絕不視為已送達。
 */
export function classifyDmSendFailure(error: unknown): 'failed' | 'unconfirmed' {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');

  if (
    code === 'permission-denied' ||
    code === 'invalid-argument' ||
    code === 'failed-precondition' ||
    code === 'not-found' ||
    code === 'resource-exhausted' ||
    code === 'unauthenticated'
  ) {
    return 'failed';
  }

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'cancelled' ||
    code === 'aborted' ||
    code === 'unknown' ||
    /network|timeout|offline|internet|連線|網絡|网络/i.test(message)
  ) {
    return 'unconfirmed';
  }

  return 'unconfirmed';
}

export function dmSendStatusLabel(status: DmSendStatus, read = false): string {
  if (status === 'delivered' && read) return '已讀';
  return DM_SEND_STATUS_LABEL[status];
}

export function inboxPreviewForOutbound(
  text: string,
  status: Exclude<DmSendStatus, 'delivered'>,
): string {
  const body = text.trim().slice(0, 40);
  return `${DM_SEND_STATUS_LABEL[status]} · ${body || '（空白）'}`;
}

export function setOutboundPreview(
  conversationId: string,
  entry: { uid: string; status: Exclude<DmSendStatus, 'delivered'>; text: string },
): void {
  if (!conversationId || !entry.uid) return;
  outboundPreviews.set(conversationId, {
    uid: entry.uid,
    status: entry.status,
    text: entry.text,
    updatedAtMs: Date.now(),
  });
}

export function clearOutboundPreview(conversationId: string, uid?: string | null): void {
  if (!conversationId) return;
  const current = outboundPreviews.get(conversationId);
  if (!current) return;
  if (uid && current.uid !== uid) return;
  outboundPreviews.delete(conversationId);
}

export function clearOutboundPreviewsForUser(uid: string | null | undefined): void {
  if (!uid) {
    outboundPreviews.clear();
    return;
  }
  for (const [id, entry] of outboundPreviews) {
    if (entry.uid === uid) outboundPreviews.delete(id);
  }
}

export function readOutboundPreview(
  conversationId: string,
  uid: string | null | undefined,
): PreviewEntry | null {
  if (!conversationId || !uid) return null;
  const entry = outboundPreviews.get(conversationId);
  if (!entry || entry.uid !== uid) return null;
  return entry;
}

export function conversationListPreview(
  row: InboxConversation,
  uid: string | null | undefined,
): string {
  const pending = readOutboundPreview(row.id, uid);
  if (pending) return inboxPreviewForOutbound(pending.text, pending.status);
  return row.lastMessageText ?? row.lastMessage?.content ?? '(尚無訊息)';
}

export function mergeOutboundWithServerMessages<T extends { id: string }>(
  server: T[],
  outbound: DmOutboundDraft[],
  conversationId: string,
): Array<T | (DmOutboundDraft & { local: true })> {
  const confirmed = new Set(server.map((row) => row.id));
  const pending = outbound
    .filter((row) => row.conversationId === conversationId && !confirmed.has(row.id))
    .map((row) => ({ ...row, local: true as const }));
  return [...server, ...pending];
}

export function pruneConfirmedOutbound(
  outbound: DmOutboundDraft[],
  serverIds: ReadonlySet<string>,
): DmOutboundDraft[] {
  return outbound.filter((row) => !serverIds.has(row.id));
}
