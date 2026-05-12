/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  doc,
  increment,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export type CampusReply = {
  id: string;
  content: string;
  anonymous?: boolean;
  aliasSnapshot?: string;
  authorUid?: string | null;
  parentReplyId?: string | null;
  depth?: number;
  createdAt?: unknown;
};

export async function addCampusReply(
  schoolId: string,
  postId: string,
  payload: {
    anonymous: boolean;
    aliasSnapshot?: string;
    authorUid?: string;
    content: string;
    parentReplyId?: string | null;
    depth?: number;
  },
) {
  const db = getDb();
  const replies = collection(db, 'schools', schoolId, 'campusPosts', postId, 'replies');
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const row: Record<string, unknown> = {
    content: payload.content,
    anonymous: payload.anonymous,
    parentReplyId: payload.parentReplyId ?? null,
    depth: typeof payload.depth === 'number' ? payload.depth : 0,
    createdAt: serverTimestamp(),
  };
  if (payload.anonymous) {
    row.aliasSnapshot = payload.aliasSnapshot ?? '';
  } else {
    row.authorUid = payload.authorUid;
  }

  const replyRef = doc(replies);
  const batch = writeBatch(db);
  batch.set(replyRef, row);
  batch.update(postRef, { commentCount: increment(1), updatedAt: serverTimestamp() });
  return batch.commit();
}

export async function listCampusReplies(schoolId: string, postId: string): Promise<CampusReply[]> {
  const db = getDb();
  const replies = collection(db, 'schools', schoolId, 'campusPosts', postId, 'replies');
  try {
    const snap = await getDocs(query(replies, orderBy('createdAt', 'asc'), limit(120)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusReply, 'id'>) }));
  } catch {
    const snap = await getDocs(query(replies, limit(120)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusReply, 'id'>) }));
  }
}
