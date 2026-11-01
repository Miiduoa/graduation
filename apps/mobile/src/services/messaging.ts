import {
  collection,
  addDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDb } from '../firebase';

/** 與網頁私訊相同的內容長度上限。 */
export const CHAT_MESSAGE_CONTENT_MAX = 4000;

export async function appendChatMessage(
  conversationId: string,
  senderId: string,
  payload: Record<string, unknown> & { content: string; type?: string },
) {
  const db = getDb();
  await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
    senderId,
    readBy: [senderId],
    type: payload.type ?? 'text',
    createdAt: serverTimestamp(),
    ...payload,
  });
  await updateDoc(doc(db, 'conversations', conversationId), {
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessageText: String(payload.content ?? '').slice(0, 140),
  });
}

/** 與 Web `newPrivateMessageId` 相同：先取文件 id，重試可沿用而不另建一則。 */
export function newChatMessageId(conversationId: string): string {
  return doc(collection(getDb(), 'conversations', conversationId, 'messages')).id;
}

/**
 * 以固定 messageId 交易寫入（create-only，對齊網頁 `sendPrivateMessage`）。
 * 同 sender／content 已存在則視為成功重放；摘要含巢狀 lastMessage。不改 schema／rules。
 */
export async function sendChatMessageIdempotent(input: {
  conversationId: string;
  messageId: string;
  senderId: string;
  content: string;
  type?: string;
}): Promise<{ id: string; replayed: boolean }> {
  const body = input.content.trim();
  if (!body) throw new Error('訊息內容不可空白');
  if (body.length > CHAT_MESSAGE_CONTENT_MAX) {
    throw Object.assign(new Error(`訊息不可超過 ${CHAT_MESSAGE_CONTENT_MAX} 字`), {
      code: 'invalid-argument',
    });
  }

  const db = getDb();
  const conversationRef = doc(db, 'conversations', input.conversationId);
  const messageRef = doc(db, 'conversations', input.conversationId, 'messages', input.messageId);
  let replayed = false;

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(messageRef);
    if (existing.exists()) {
      const data = existing.data() as { senderId?: string; content?: string };
      if (data.senderId === input.senderId && data.content === body) {
        replayed = true;
        return;
      }
      throw Object.assign(new Error('此訊息編號已被其他內容使用'), {
        code: 'failed-precondition',
      });
    }

    const stamp = serverTimestamp();
    const message = {
      conversationId: input.conversationId,
      senderId: input.senderId,
      content: body,
      type: input.type ?? 'text',
      readBy: [input.senderId],
      createdAt: stamp,
    };
    tx.set(messageRef, message);
    tx.update(conversationRef, {
      lastMessage: { id: input.messageId, ...message },
      lastMessageText: body.slice(0, 50),
      lastMessageAt: stamp,
      lastMessageSenderId: input.senderId,
      updatedAt: stamp,
      [`typingUsers.${input.senderId}`]: null,
    });
  });

  return { id: input.messageId, replayed };
}

export async function toggleMessageReaction(
  conversationId: string,
  messageId: string,
  uid: string,
  emoji: string,
) {
  const db = getDb();
  const mref = doc(db, 'conversations', conversationId, 'messages', messageId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(mref);
    if (!snap.exists()) return;
    const data = snap.data() as { reactions?: Record<string, string[]> };
    const reactions = { ...(data.reactions ?? {}) };
    const arr = [...(reactions[emoji] ?? [])];
    const i = arr.indexOf(uid);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(uid);
    if (arr.length === 0) delete reactions[emoji];
    else reactions[emoji] = arr;
    tx.update(mref, { reactions, updatedAt: serverTimestamp() });
  });
}

export async function recallChatMessage(conversationId: string, messageId: string, senderId: string) {
  const db = getDb();
  const mref = doc(db, 'conversations', conversationId, 'messages', messageId);
  const s = await getDoc(mref);
  if (!s.exists() || (s.data() as { senderId?: string }).senderId !== senderId) return;
  await updateDoc(mref, {
    recalledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
