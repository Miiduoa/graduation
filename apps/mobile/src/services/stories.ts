import { assertPrivateFileNamespace } from '@campus/shared/src/privateFileMedia';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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

export function reserveStoryId(): string {
  return doc(storiesCollection()).id;
}

export async function publishStory(storyId: string, payload: {
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
  if (payload.mediaUrl) assertPrivateFileNamespace(payload.mediaUrl, `schools/${payload.schoolId}/stories/${storyId}`);
  const ref = doc(storiesCollection(), storyId);
  const content = {
    schoolId: payload.schoolId,
    authorUid: payload.authorUid,
    kind: payload.kind,
    text: payload.text ?? '',
    mediaUrl: payload.mediaUrl ?? null,
    bgColor: payload.bgColor ?? '#000000',
    poiId: payload.poiId ?? null,
    poiName: payload.poiName ?? null,
  };
  try {
    await setDoc(ref, { ...content, createdAt: serverTimestamp(), expiresAt: payload.expiresAtMs, viewCount: 0 });
  } catch (error) {
    // If the first create was acknowledged only by the server, retrying the
    // reserved ID is an update, which rules deny even to the original author.
    if ((error as { code?: string }).code !== 'permission-denied') throw error;
    const snapshot = await getDocFromServer(ref).catch(() => null);
    const row = snapshot?.data();
    if (!row || typeof row.expiresAt !== 'number' || row.expiresAt <= Date.now() ||
        !Object.entries(content).every(([key, value]) => row[key] === value)) throw error;
  }
  return ref.id;
}

export async function listActiveStoriesForSchool(
  schoolId: string,
  lim = 80,
  options: { throwOnError?: boolean } = {},
): Promise<CampusStoryDoc[]> {
  const db = getDb();
  try {
    // Preserve near-expiry stories with only a small request-latency buffer.
    const read = (expiresAfter: number) => getDocs(
      query(
        storiesCollection(db),
        where('schoolId', '==', schoolId),
        where('expiresAt', '>', expiresAfter),
        orderBy('expiresAt', 'desc'),
        limit(lim),
      ),
    );
    const snap = await read(Date.now() + 3_000).catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code !== 'permission-denied') throw error;
      return read(Date.now() + 15_000);
    });
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CampusStoryDoc, 'id'>) }))
      .filter((s) => typeof s.expiresAt === 'number' && s.expiresAt > Date.now());
  } catch (error) {
    // Never fall back to a school-only query: it exposes expired metadata.
    if (options.throwOnError) throw error;
    return [];
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
