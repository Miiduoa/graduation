import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';
import { getCampusPostById, type CampusPostDoc } from './firestore';

export const BOOKMARK_UNAVAILABLE_COPY = '收藏功能暫時無法使用';

function bookmarkCollection(uid: string, schoolId: string) {
  return collection(getDb(), 'users', uid, 'campusPostBookmarks', schoolId, 'posts');
}

function bookmarkDoc(uid: string, schoolId: string, postId: string) {
  return doc(bookmarkCollection(uid, schoolId), postId);
}

export async function listCampusPostBookmarkIds(
  uid: string,
  schoolId: string,
  maximum = 60,
): Promise<string[]> {
  const snap = await getDocs(
    query(bookmarkCollection(uid, schoolId), orderBy('createdAt', 'desc'), limit(maximum)),
  );
  return snap.docs
    .filter((item) => {
      const data = item.data();
      return data.postId === item.id && data.schoolId === schoolId;
    })
    .map((item) => item.id);
}

export async function saveCampusPostBookmark(uid: string, schoolId: string, postId: string) {
  const ref = bookmarkDoc(uid, schoolId, postId);
  // A second device may already have saved the post; writes are create-only.
  if ((await getDocFromServer(ref)).exists()) return;
  try {
    await setDoc(ref, { schoolId, postId, createdAt: serverTimestamp() });
  } catch (error) {
    // Two devices can both read an empty bookmark before one of them creates it.
    // Our rules reject updates, so verify whether the other write already won.
    const current = await getDocFromServer(ref).catch(() => null);
    if (current?.exists() && current.data()?.schoolId === schoolId && current.data()?.postId === postId)
      return;
    throw error;
  }
}

export async function removeCampusPostBookmark(uid: string, schoolId: string, postId: string) {
  await deleteDoc(bookmarkDoc(uid, schoolId, postId));
}

/** Resolve saved posts outside the recent feed window. Only confirmed missing or deleted posts are omitted; read failures remain retryable. */
export async function loadCampusPostBookmarks(
  uid: string,
  schoolId: string,
  maximum = 40,
): Promise<{ ids: string[]; posts: CampusPostDoc[] }> {
  const ids = await listCampusPostBookmarkIds(uid, schoolId, maximum);
  const settled = await Promise.allSettled(ids.map((id) => getCampusPostById(schoolId, id)));
  // Revoked access must not be masked by an earlier network failure.
  const failures = settled.filter((result) => result.status === 'rejected');
  const denied = failures.find((result) => {
    const code = (result.reason as { code?: string })?.code ?? '';
    return code.endsWith('permission-denied') || code.endsWith('unauthenticated');
  });
  if (denied) throw denied.reason;
  if (failures.length) throw failures[0].reason;
  const posts: CampusPostDoc[] = [];
  for (const result of settled) {
    if (
      result.status === 'fulfilled' &&
      result.value &&
      result.value.schoolId === schoolId
    ) {
      posts.push(result.value);
    }
  }
  return { ids, posts };
}

/** Read one specific bookmark so detail pages do not depend on the list window. */
export async function isCampusPostBookmarked(uid: string, schoolId: string, postId: string) {
  const snapshot = await getDocFromServer(bookmarkDoc(uid, schoolId, postId));
  return snapshot.exists() &&
    snapshot.data()?.schoolId === schoolId &&
    snapshot.data()?.postId === postId;
}
