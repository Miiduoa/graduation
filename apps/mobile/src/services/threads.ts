/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  deleteDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
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
  deleted?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
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

/** 編輯自己留言（Rules 限制 authorUid === request.auth.uid） */
export async function updateCampusReply(
  schoolId: string,
  postId: string,
  replyId: string,
  content: string,
) {
  const db = getDb();
  const ref = doc(db, 'schools', schoolId, 'campusPosts', postId, 'replies', replyId);
  await updateDoc(ref, { content, updatedAt: serverTimestamp() });
}

/** 軟刪除：保留節點維持討論串結構，但內容替換為「（已刪除）」並標記。 */
export async function softDeleteCampusReply(
  schoolId: string,
  postId: string,
  replyId: string,
) {
  const db = getDb();
  const replyRef = doc(db, 'schools', schoolId, 'campusPosts', postId, 'replies', replyId);
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const batch = writeBatch(db);
  batch.update(replyRef, {
    deleted: true,
    content: '（此留言已被作者刪除）',
    updatedAt: serverTimestamp(),
  });
  batch.update(postRef, { commentCount: increment(-1), updatedAt: serverTimestamp() });
  await batch.commit();
}

/** 硬刪除：沒有子留言時可直接 delete（會中斷討論串顯示） */
export async function deleteCampusReply(
  schoolId: string,
  postId: string,
  replyId: string,
) {
  const db = getDb();
  const ref = doc(db, 'schools', schoolId, 'campusPosts', postId, 'replies', replyId);
  await deleteDoc(ref);
}
