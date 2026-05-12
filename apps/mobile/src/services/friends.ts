/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

export type Friendship = {
  id: string;
  schoolId: string;
  fromUid: string;
  toUid: string;
  status: FriendshipStatus;
  createdAt?: any;
  acceptedAt?: any;
};

function col(db: Firestore) {
  return collection(db, 'friendships');
}

export function directionalRequestId(schoolId: string, fromUid: string, toUid: string) {
  return `req_${schoolId}_${fromUid}_${toUid}`;
}

export async function sendFriendRequest(schoolId: string, fromUid: string, toUid: string) {
  if (fromUid === toUid) throw new Error('無法對自己發送好友邀請');
  const db = getDb();
  const id = directionalRequestId(schoolId, fromUid, toUid);
  await setDoc(doc(db, 'friendships', id), {
    schoolId,
    fromUid,
    toUid,
    status: 'pending' as FriendshipStatus,
    createdAt: serverTimestamp(),
  });
}

export async function acceptFriendRequest(friendshipId: string) {
  const db = getDb();
  await updateDoc(doc(db, 'friendships', friendshipId), {
    status: 'accepted',
    acceptedAt: serverTimestamp(),
  });
}

export async function blockFromPending(friendshipId: string) {
  const db = getDb();
  await updateDoc(doc(db, 'friendships', friendshipId), {
    status: 'blocked',
  });
}

export async function listAcceptedFriends(schoolId: string, myUid: string): Promise<Friendship[]> {
  const db = getDb();
  const [a, b] = await Promise.all([
    getDocs(
      query(col(db), where('schoolId', '==', schoolId), where('status', '==', 'accepted'), where('fromUid', '==', myUid)),
    ),
    getDocs(
      query(col(db), where('schoolId', '==', schoolId), where('status', '==', 'accepted'), where('toUid', '==', myUid)),
    ),
  ]);
  const map = new Map<string, Friendship>();
  [...a.docs, ...b.docs].forEach((d) => {
    map.set(d.id, { id: d.id, ...(d.data() as Omit<Friendship, 'id'>) });
  });
  return [...map.values()];
}

export async function listIncomingFriendRequests(schoolId: string, myUid: string): Promise<Friendship[]> {
  const db = getDb();
  let snap;
  try {
    snap = await getDocs(
      query(
        col(db),
        where('schoolId', '==', schoolId),
        where('toUid', '==', myUid),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc'),
        limit(50),
      ),
    );
  } catch {
    snap = await getDocs(
      query(col(db), where('schoolId', '==', schoolId), where('toUid', '==', myUid), where('status', '==', 'pending'), limit(50)),
    );
  }
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Friendship, 'id'>) }));
}

export async function listOutgoingFriendRequests(schoolId: string, myUid: string): Promise<Friendship[]> {
  const db = getDb();
  const snap = await getDocs(
    query(col(db), where('schoolId', '==', schoolId), where('fromUid', '==', myUid), where('status', '==', 'pending'), limit(50)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Friendship, 'id'>) }));
}

export async function getFriendshipBetween(
  schoolId: string,
  a: string,
  b: string,
): Promise<Friendship | null> {
  const db = getDb();
  const ids = [directionalRequestId(schoolId, a, b), directionalRequestId(schoolId, b, a)];
  for (const id of ids) {
    const s = await getDoc(doc(db, 'friendships', id));
    if (s.exists()) return { id: s.id, ...(s.data() as Omit<Friendship, 'id'>) };
  }
  return null;
}
