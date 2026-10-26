import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb } from '@/lib/firebase';

function bookmarkCollection(uid: string, schoolId: string) {
  return collection(getDb(), 'users', uid, 'schools', schoolId, 'campusPostBookmarks');
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
  if ((await getDoc(ref)).exists()) return;
  await setDoc(ref, { schoolId, postId, createdAt: serverTimestamp() });
}

export async function removeCampusPostBookmark(uid: string, schoolId: string, postId: string) {
  await deleteDoc(bookmarkDoc(uid, schoolId, postId));
}
