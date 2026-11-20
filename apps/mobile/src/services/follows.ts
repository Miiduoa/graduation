/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export type FollowDoc = {
  schoolId: string;
  followerUid: string;
  targetUid: string;
  createdAt?: any;
};

export function followId(schoolId: string, followerUid: string, targetUid: string) {
  return `fol_${schoolId}_${followerUid}_${targetUid}`;
}

export async function followUser(schoolId: string, followerUid: string, targetUid: string) {
  const db = getDb();
  if (followerUid === targetUid) throw new Error('無法追蹤自己');
  if (!schoolId || !followerUid || !targetUid || followerUid === targetUid)
    throw new Error('INVALID_FOLLOW_TARGET');
  const ref = doc(db, 'follows', followId(schoolId, followerUid, targetUid));
  const matches = (snapshot: Awaited<ReturnType<typeof getDocFromServer>>) => {
    if (!snapshot.exists()) return false;
    const saved = snapshot.data() as FollowDoc | undefined;
    return saved?.schoolId === schoolId &&
      saved?.followerUid === followerUid &&
      saved?.targetUid === targetUid;
  };
  try {
    // Missing follows are not readable under the owner/school rules. Create
    // first; the rules reject updates and preserve the existing timestamp.
    await setDoc(ref, {
      schoolId,
      followerUid,
      targetUid,
      createdAt: serverTimestamp(),
    } satisfies FollowDoc);
  } catch (error) {
    const current = await getDocFromServer(ref).catch(() => null);
    if (current && matches(current)) return;
    throw error;
  }
}

export async function unfollowUser(schoolId: string, followerUid: string, targetUid: string) {
  if (!schoolId || !followerUid || !targetUid || followerUid === targetUid)
    throw new Error('INVALID_FOLLOW_TARGET');
  const db = getDb();
  const id = followId(schoolId, followerUid, targetUid);
  await deleteDoc(doc(db, 'follows', id));
}

export async function isFollowing(schoolId: string, followerUid: string, targetUid: string) {
  const db = getDb();
  const s = await getDoc(doc(db, 'follows', followId(schoolId, followerUid, targetUid)));
  return s.exists() &&
    s.data()?.schoolId === schoolId &&
    s.data()?.followerUid === followerUid &&
    s.data()?.targetUid === targetUid;
}

/** 粗略追蹤中清單（限制筆數，需複合索引） */
export async function listFollowingIds(
  schoolId: string,
  followerUid: string,
  max = 200,
  options: { throwOnError?: boolean } = {},
): Promise<string[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, 'follows'),
        where('schoolId', '==', schoolId),
        where('followerUid', '==', followerUid),
        limit(Math.max(1, Math.min(max, 500))),
      ),
    );
    return snap.docs.flatMap((item) => {
      const record = item.data() as FollowDoc;
      if (
        record.schoolId !== schoolId ||
        record.followerUid !== followerUid ||
        typeof record.targetUid !== 'string' ||
        !record.targetUid ||
        item.id !== followId(schoolId, followerUid, record.targetUid)
      ) return [];
      return [record.targetUid];
    });
  } catch (error) {
    if (options.throwOnError) throw error;
    return [];
  }
}

export async function listFollowersIds(schoolId: string, targetUid: string, max = 200): Promise<string[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, 'follows'),
        where('schoolId', '==', schoolId),
        where('targetUid', '==', targetUid),
        limit(max),
      ),
    );
    return snap.docs.map((d) => (d.data() as FollowDoc).followerUid);
  } catch {
    return [];
  }
}

