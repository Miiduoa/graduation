/* eslint-disable @typescript-eslint/no-explicit-any */
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
