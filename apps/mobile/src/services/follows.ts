/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  const id = followId(schoolId, followerUid, targetUid);
  await setDoc(doc(db, 'follows', id), {
    schoolId,
    followerUid,
    targetUid,
    createdAt: serverTimestamp(),
  } satisfies FollowDoc);
}

export async function unfollowUser(schoolId: string, followerUid: string, targetUid: string) {
  const db = getDb();
  const id = followId(schoolId, followerUid, targetUid);
  await deleteDoc(doc(db, 'follows', id));
}

export async function isFollowing(schoolId: string, followerUid: string, targetUid: string) {
  const db = getDb();
  const s = await getDoc(doc(db, 'follows', followId(schoolId, followerUid, targetUid)));
  return s.exists();
}

/** 粗略追蹤中清單（限制筆數，需複合索引） */
export async function listFollowingIds(schoolId: string, followerUid: string, max = 200): Promise<string[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, 'follows'),
        where('schoolId', '==', schoolId),
        where('followerUid', '==', followerUid),
        limit(max),
      ),
    );
    return snap.docs.map((d) => (d.data() as FollowDoc).targetUid);
  } catch {
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

