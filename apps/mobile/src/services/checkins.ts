/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  deleteDoc,
  doc,
  query,
  collection,
  serverTimestamp,
  setDoc,
  where,
  limit,
  getDocs,
} from 'firebase/firestore';
import { getDb } from '../firebase';

/** LBS「誰在同一 POI」：presence 過期由客戶端與 TTL 過濾。 */
export async function heartbeatCheckIn(
  uid: string,
  schoolId: string,
  poiId: string,
  ttlMs = 15 * 60 * 1000,
) {
  const db = getDb();
  const sessionId = `${uid}_${poiId}_${Date.now().toString(36)}`;
  await setDoc(doc(db, 'schools', schoolId, 'lbsPresence', sessionId), {
    uid,
    schoolId,
    poiId,
    startedAt: serverTimestamp(),
    expiresAt: Date.now() + ttlMs,
  });
  return sessionId;
}

export async function clearPresence(schoolId: string, sessionId: string) {
  const db = getDb();
  await deleteDoc(doc(db, 'schools', schoolId, 'lbsPresence', sessionId));
}

export async function peersAtPoi(schoolId: string, poiId: string): Promise<{ uid: string }[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(collection(db, 'schools', schoolId, 'lbsPresence'), where('poiId', '==', poiId), limit(80)),
    );
    const map = new Map<string, boolean>();
    const now = Date.now();
    snap.docs.forEach((d) => {
      const x = d.data() as { uid?: string; expiresAt?: number };
      if (x.uid && (!x.expiresAt || x.expiresAt > now)) map.set(x.uid, true);
    });
    return [...map.keys()].map((uid) => ({ uid }));
  } catch {
    return [];
  }
}
