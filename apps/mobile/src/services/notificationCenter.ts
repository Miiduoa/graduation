/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export type InAppNotification = {
  id: string;
  title: string;
  body: string;
  category?: string;
  read?: boolean;
  createdAt?: any;
};

function notifCollection(uid: string) {
  const db = getDb();
  return collection(db, 'users', uid, 'notifications');
}

export function subscribeInAppNotifications(
  uid: string,
  cb: (rows: InAppNotification[]) => void,
  max = 50,
): () => void {
  const db = getDb();
  const q = query(notifCollection(uid), orderBy('createdAt', 'desc'), limit(max));
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InAppNotification, 'id'>),
        })),
      ),
    () => cb([]),
  );
}

export async function markNotificationRead(uid: string, notificationId: string): Promise<void> {
  await updateDoc(doc(getDb(), 'users', uid, 'notifications', notificationId), {
    read: true,
  });
}
