/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getDb } from '../firebase';

export async function submitCampusReport(payload: {
  schoolId: string;
  reporterUid: string;
  targetType: 'post' | 'reply' | 'user' | 'message' | 'story';
  targetId: string;
  reason: string;
  detail?: string;
}) {
  const db = getDb();
  return addDoc(collection(db, 'campusReports'), {
    ...payload,
    createdAt: serverTimestamp(),
    status: 'open',
  });
}
