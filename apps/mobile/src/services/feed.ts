/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  increment,
  runTransaction,
  arrayUnion,
  arrayRemove,
  doc,
  writeBatch,
  type Timestamp,
  type DocumentReference,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export type CampusPostDoc = {
  id: string;
  schoolId: string;
  boardId: string;
  anonymous: boolean;
  aliasSnapshot?: string;
  authorUid?: string | null;
  title: string;
  content: string;
  tags?: string[];
  kind?: 'standard' | 'thread';
  mediaUrls?: string[];
  mentions?: string[];
  likes?: number;
  likedBy?: string[];
  commentCount?: number;
  pinned?: boolean;
  createdAt?: Timestamp | Date | unknown;
  updatedAt?: Timestamp | Date | unknown;
};

function postsCol(db: ReturnType<typeof getDb>, schoolId: string) {
  return collection(db, 'schools', schoolId, 'campusPosts');
}

export async function fetchRecentCampusPosts(
  schoolId: string,
  boardId?: string,
  lim = 30,
): Promise<CampusPostDoc[]> {
  const db = getDb();
  try {
    const qb = query(
      postsCol(db, schoolId),
      ...(boardId ? [where('boardId', '==', boardId)] : []),
      orderBy('createdAt', 'desc'),
      limit(lim),
    );
    const snap = await getDocs(qb);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusPostDoc, 'id'>) }));
  } catch {
    const snap = await getDocs(query(postsCol(db, schoolId), limit(Math.min(lim, 25))));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CampusPostDoc, 'id'>) }));
  }
}

/** 簡化熱度：近期 + likes + replies 權重（純前端排序備用）。 */
export function rankFeedPosts(posts: CampusPostDoc[], topN = 40): CampusPostDoc[] {
  const now = Date.now();
  const score = (p: CampusPostDoc) => {
    const ms = tsToMillis(p.createdAt);
    const ageHr = ms ? Math.max(1, (now - ms) / 3600000) : 24;
    const likes =
      typeof p.likes === 'number'
        ? p.likes
        : Array.isArray(p.likedBy)
          ? p.likedBy.length
          : 0;
    const replies = typeof p.commentCount === 'number' ? p.commentCount : 0;
    return (likes + replies * 2 + (p.pinned ? 80 : 0)) / Math.pow(ageHr + 2, 1.35);
  };
  return [...posts].sort((a, b) => score(b) - score(a)).slice(0, topN);
}

function tsToMillis(t: unknown): number | undefined {
  if (t != null && typeof (t as { toMillis?: () => number }).toMillis === 'function') {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (t instanceof Date) return t.getTime();
  const s = typeof t === 'string' ? Date.parse(t) : NaN;
  return Number.isFinite(s) ? s : undefined;
}

/** 會員對貼文的 heart：交易內決定 toggle，避免並發誤判。需 Rules 放行 campusPostLikeReactionOk。 */
export async function toggleCampusPostLike(schoolId: string, postId: string, userId: string) {
  const db = getDb();
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists()) throw new Error('貼文不存在');
    const d = snap.data() as Record<string, unknown>;
    const likedArr = Array.isArray(d.likedBy) ? (d.likedBy as string[]) : [];
    const liked = likedArr.includes(userId);
    if (liked) {
      tx.update(postRef, {
        likedBy: arrayRemove(userId),
        likes: increment(-1),
        updatedAt: serverTimestamp(),
      });
    } else {
      tx.update(postRef, {
        likedBy: arrayUnion(userId),
        likes: increment(1),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function createCampusPost(input: {
  schoolId: string;
  boardId: string;
  title: string;
  content: string;
  anonymous: boolean;
  aliasSnapshot?: string;
  authorUid?: string;
  tags?: string[];
  mentions?: string[];
  mediaUrls?: string[];
  kind?: 'standard' | 'thread';
}): Promise<DocumentReference> {
  const db = getDb();
  const ref = postsCol(db, input.schoolId);
  const base: Record<string, unknown> = {
    schoolId: input.schoolId,
    boardId: input.boardId,
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    kind: input.kind ?? 'standard',
    likes: 0,
    likedBy: [],
    commentCount: 0,
    pinned: false,
    mentions: input.mentions ?? [],
    mediaUrls: input.mediaUrls ?? [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.anonymous) {
    base.anonymous = true;
    base.aliasSnapshot = (input.aliasSnapshot ?? '匿名使用者').trim() || '匿名使用者';
    return addDoc(ref, base);
  }
  base.anonymous = false;
  base.authorUid = input.authorUid;
  return addDoc(ref, base);
}

/** 編輯自己的貼文（標題/內文/標籤/媒體）。Rules 應限制 authorUid === request.auth.uid。 */
export async function updateCampusPost(
  schoolId: string,
  postId: string,
  patch: {
    title?: string;
    content?: string;
    tags?: string[];
    mediaUrls?: string[];
  },
) {
  const db = getDb();
  const ref = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (typeof patch.title === 'string') data.title = patch.title;
  if (typeof patch.content === 'string') data.content = patch.content;
  if (Array.isArray(patch.tags)) data.tags = patch.tags;
  if (Array.isArray(patch.mediaUrls)) data.mediaUrls = patch.mediaUrls;
  await updateDoc(ref, data);
}

/** 刪除自己貼文：同步刪掉子集合 replies（先撈出 ID 再批次刪，避免單次 batch 上限）。 */
export async function deleteCampusPost(schoolId: string, postId: string) {
  const db = getDb();
  const postRef = doc(db, 'schools', schoolId, 'campusPosts', postId);
  const repliesCol = collection(db, 'schools', schoolId, 'campusPosts', postId, 'replies');
  const replySnap = await getDocs(query(repliesCol, limit(400)));
  let batch = writeBatch(db);
  let count = 0;
  for (const r of replySnap.docs) {
    batch.delete(r.ref);
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  batch.delete(postRef);
  await batch.commit();
}

export async function getCampusPostById(
  schoolId: string,
  postId: string,
): Promise<CampusPostDoc | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, 'schools', schoolId, 'campusPosts', postId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<CampusPostDoc, 'id'>) };
}
