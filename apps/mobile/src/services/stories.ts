/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../firebase';

export function storiesCollection(db = getDb()) {
  return collection(db, 'campusStories');
}

export type StoryKind = 'image' | 'video' | 'text';

export type CampusStoryDoc = {
  id: string;
  schoolId: string;
  authorUid: string;
  kind: StoryKind;
  text?: string;
  mediaUrl?: string | null;
  bgColor?: string;
  poiId?: string | null;
  poiName?: string | null;
  createdAt?: unknown;
  expiresAt?: number;
  viewCount?: number;
};

export async function publishStory(payload: {
  schoolId: string;
  authorUid: string;
  kind: StoryKind;
  text?: string;
  mediaUrl?: string | null;
  bgColor?: string;
  poiId?: string | null;
  poiName?: string | null;
  expiresAtMs: number;
}): Promise<string> {
  const db = getDb();
  const ref = await addDoc(storiesCollection(db), {
    schoolId: payload.schoolId,
    authorUid: payload.authorUid,
    kind: payload.kind,
    text: payload.text ?? '',
    mediaUrl: payload.mediaUrl ?? null,
    bgColor: payload.bgColor ?? '#000000',
    poiId: payload.poiId ?? null,
    poiName: payload.poiName ?? null,
    createdAt: serverTimestamp(),
    expiresAt: payload.expiresAtMs,
    viewCount: 0,
  });
  return ref.id;
}

export async function listActiveStoriesForSchool(
  schoolId: string,
  lim = 80,
): Promise<CampusStoryDoc[]> {
  const db = getDb();
  const now = Date.now();
  try {
    const snap = await getDocs(
      query(
        storiesCollection(db),
        where('schoolId', '==', schoolId),
        orderBy('createdAt', 'desc'),
        limit(lim),
      ),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CampusStoryDoc, 'id'>) }))
      .filter((s) => (typeof s.expiresAt === 'number' ? s.expiresAt > now : true));
  } catch {
    // 缺索引 fallback：不排序
    try {
      const snap = await getDocs(
        query(storiesCollection(db), where('schoolId', '==', schoolId), limit(lim)),
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CampusStoryDoc, 'id'>) }))
        .filter((s) => (typeof s.expiresAt === 'number' ? s.expiresAt > now : true));
    } catch {
      return [];
    }
  }
}

export async function markStoryViewed(storyId: string, viewerUid: string) {
  const db = getDb();
  const viewRef = doc(db, 'campusStories', storyId, 'storyViews', viewerUid);
  const exists = await getDoc(viewRef);
  if (exists.exists()) return;
  await setDoc(viewRef, {
    viewerUid,
    viewedAt: serverTimestamp(),
  });
  // 累加 viewCount（best-effort）
  try {
    await updateDoc(doc(db, 'campusStories', storyId), { viewCount: increment(1) });
  } catch {
    /* ignore */
  }
}

export async function deleteMyStory(storyId: string) {
  await deleteDoc(doc(getDb(), 'campusStories', storyId));
}

/** 把同一作者的 story 群組起來，給 HomeFeed 上方的 Story Bar 用 */
export type StoryAuthorGroup = {
  authorUid: string;
  stories: CampusStoryDoc[];
  latestAt: number;
  isMine?: boolean;
};

export function groupStoriesByAuthor(
  stories: CampusStoryDoc[],
  viewerUid?: string,
): StoryAuthorGroup[] {
  const map = new Map<string, StoryAuthorGroup>();
  for (const s of stories) {
    const uid = s.authorUid;
    const t = tsToMillis(s.createdAt);
    const prev = map.get(uid);
    if (prev) {
      prev.stories.push(s);
      if (t && t > prev.latestAt) prev.latestAt = t;
    } else {
      map.set(uid, {
        authorUid: uid,
        stories: [s],
        latestAt: t ?? 0,
        isMine: viewerUid != null && viewerUid === uid,
      });
    }
  }
  for (const grp of map.values()) {
    grp.stories.sort((a, b) => (tsToMillis(a.createdAt) ?? 0) - (tsToMillis(b.createdAt) ?? 0));
  }
  return [...map.values()].sort((a, b) => {
    if (a.isMine && !b.isMine) return -1;
    if (!a.isMine && b.isMine) return 1;
    return b.latestAt - a.latestAt;
  });
}

function tsToMillis(t: unknown): number | undefined {
  if (t != null && typeof (t as { toMillis?: () => number }).toMillis === 'function') {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  return undefined;
}
