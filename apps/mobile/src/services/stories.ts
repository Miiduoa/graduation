/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export function storiesCollection(db = getDb()) {
  return collection(db, 'campusStories');
}

export async function publishStory(payload: {
  schoolId: string;
  authorUid: string;
  kind: 'image' | 'video' | 'text';
  text?: string;
  mediaUrl?: string | null;
  bgColor?: string;
  poiId?: string | null;
  expiresAtMs: number;
}) {
  const db = getDb();
  await addDoc(storiesCollection(db), {
    schoolId: payload.schoolId,
    authorUid: payload.authorUid,
    kind: payload.kind,
    text: payload.text ?? '',
    mediaUrl: payload.mediaUrl ?? null,
    bgColor: payload.bgColor ?? '#1a1a2e',
    poiId: payload.poiId ?? null,
    createdAt: serverTimestamp(),
    expiresAt: payload.expiresAtMs,
    viewCount: 0,
  });
}

export async function listActiveStoriesForSchool(schoolId: string, lim = 50) {
  const db = getDb();
  const now = Date.now();
  try {
    const snap = await getDocs(query(storiesCollection(db), where('schoolId', '==', schoolId), limit(lim)));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s: any) => (typeof s.expiresAt === 'number' ? s.expiresAt > now : true));
  } catch {
    return [];
  }
}

export async function markStoryViewed(storyId: string, viewerUid: string) {
  const db = getDb();
  await setDoc(doc(db, 'campusStories', storyId, 'storyViews', viewerUid), {
    viewerUid,
    viewedAt: serverTimestamp(),
  });
}

export async function deleteMyStory(storyId: string) {
  await deleteDoc(doc(getDb(), 'campusStories', storyId));
}
