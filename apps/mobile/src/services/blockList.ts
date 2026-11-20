/* eslint-disable @typescript-eslint/no-explicit-any */
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../firebase';

export async function blockUser(uid: string, blockedUid: string): Promise<void> {
  const db = getDb();
  await setDoc(doc(db, 'users', uid, 'blockedUsers', blockedUid), {
    blockedUid,
    createdAt: new Date().toISOString(),
  });
}

export async function unblockUser(uid: string, blockedUid: string): Promise<void> {
  const db = getDb();
  await deleteDoc(doc(db, 'users', uid, 'blockedUsers', blockedUid));
}

export async function isUserBlocked(uid: string, targetUid: string): Promise<boolean> {
  const db = getDb();
  const mine = await getDoc(doc(db, 'users', uid, 'blockedUsers', targetUid));
  if (mine.exists()) return true;
  const reverse = await getDoc(doc(db, 'users', targetUid, 'blockedUsers', uid));
  return reverse.exists();
}
