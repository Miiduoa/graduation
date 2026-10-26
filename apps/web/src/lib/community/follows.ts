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
import { getDb } from '@/lib/firebase';

export function followId(schoolId: string, followerUid: string, targetUid: string) {
  return `fol_${schoolId}_${followerUid}_${targetUid}`;
}

function followRef(schoolId: string, followerUid: string, targetUid: string) {
  return doc(getDb(), 'follows', followId(schoolId, followerUid, targetUid));
}

/** Only school-scoped relations owned by the current account are returned. */
export async function listFollowingIds(
  schoolId: string,
  followerUid: string,
  maximum = 200,
): Promise<string[]> {
  const rows = await getDocs(
    query(
      collection(getDb(), 'follows'),
      where('schoolId', '==', schoolId),
      where('followerUid', '==', followerUid),
      limit(Math.max(1, Math.min(maximum, 500))),
    ),
  );
  return rows.docs.flatMap((item) => {
    const record = item.data();
    if (
      record.schoolId !== schoolId ||
      record.followerUid !== followerUid ||
      typeof record.targetUid !== 'string' ||
      !record.targetUid ||
      item.id !== followId(schoolId, followerUid, record.targetUid)
    ) return [];
    return [record.targetUid];
  });
}

export async function followUser(schoolId: string, followerUid: string, targetUid: string) {
  if (!schoolId || !followerUid || !targetUid || followerUid === targetUid)
    throw new Error('INVALID_FOLLOW_TARGET');
  const ref = followRef(schoolId, followerUid, targetUid);
  const isCurrent = (snapshot: Awaited<ReturnType<typeof getDoc>>) => {
    if (!snapshot.exists()) return false;
    const data = snapshot.data() as Record<string, unknown> | undefined;
    return data?.schoolId === schoolId &&
      data?.followerUid === followerUid &&
      data?.targetUid === targetUid;
  };

  if (isCurrent(await getDoc(ref))) return;
  try {
    await setDoc(ref, {
      schoolId,
      followerUid,
      targetUid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    // Another device may have created this exact relation in the meantime.
    const current = await getDoc(ref).catch(() => null);
    if (current && isCurrent(current)) return;
    throw error;
  }
}

export async function unfollowUser(schoolId: string, followerUid: string, targetUid: string) {
  if (!schoolId || !followerUid || !targetUid || followerUid === targetUid)
    throw new Error('INVALID_FOLLOW_TARGET');
  await deleteDoc(followRef(schoolId, followerUid, targetUid));
}
