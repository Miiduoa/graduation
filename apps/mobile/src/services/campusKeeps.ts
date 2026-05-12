/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { getDb } from '../firebase';

export type KeepItem = {
  id: string;
  kind?: 'text' | 'link' | 'chat_message' | 'image';
  preview: string;
  payload?: Record<string, unknown>;
  createdAt?: any;
};

export async function saveKeep(uid: string, item: Omit<KeepItem, 'id'> & { kind?: KeepItem['kind'] }) {
  const db = getDb();
  return addDoc(collection(db, 'users', uid, 'keeps'), {
    ...item,
    createdAt: serverTimestamp(),
  });
}

export async function deleteKeep(uid: string, keepId: string) {
  await deleteDoc(doc(getDb(), 'users', uid, 'keeps', keepId));
}
