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
  type Firestore,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export type CampusBoard = {
  id: string;
  name: string;
  slug?: string;
  type?: 'department' | 'course' | 'topic' | 'anon';
  defaultAnonymous?: boolean;
  mods?: string[];
  rules?: string;
  coverImage?: string | null;
  subscriberCount?: number;
  schoolId?: string;
};

export function boardCol(db: Firestore, schoolId: string) {
  return collection(db, 'schools', schoolId, 'boards');
}

export async function listBoards(schoolId: string, max = 40): Promise<CampusBoard[]> {
  const db = getDb();
  const snap = await getDocs(query(boardCol(db, schoolId), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CampusBoard);
}

export async function getBoardById(schoolId: string, boardId: string): Promise<CampusBoard | null> {
  const db = getDb();
  const snap = await getDoc(doc(db, 'schools', schoolId, 'boards', boardId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as object) } as CampusBoard;
}

export function boardSubscriptionId(uid: string, boardId: string) {
  return `${uid}_${boardId}`;
}

export async function subscribeToBoard(uid: string, schoolId: string, boardId: string) {
  const db = getDb();
  await setDoc(doc(db, 'schools', schoolId, 'boardSubs', boardSubscriptionId(uid, boardId)), {
    userId: uid,
    schoolId,
    boardId,
    subscribedAt: serverTimestamp(),
  });
}

export async function unsubscribeFromBoard(uid: string, schoolId: string, boardId: string) {
  const db = getDb();
  await deleteDoc(doc(db, 'schools', schoolId, 'boardSubs', boardSubscriptionId(uid, boardId)));
}

export async function isSubscribedToBoard(uid: string, schoolId: string, boardId: string): Promise<boolean> {
  const db = getDb();
  const snap = await getDocs(
    query(
      collection(db, 'schools', schoolId, 'boardSubs'),
      where('userId', '==', uid),
      where('boardId', '==', boardId),
      limit(1),
    ),
  );
  return !snap.empty;
}
